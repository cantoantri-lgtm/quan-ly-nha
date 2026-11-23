-- 094: Chốt tháng (23/11/2026)
--  Quy trình: ngày 28 đến cuối tháng đi ghi đồng hồ điện từng phòng (kỳ điện = tháng đó).
--  Ngày 1 tháng sau lập hoá đơn (tiền phòng tháng mới + điện tháng trước), thu tiền từ ngày 1 đến ngày 3.
--  * meter_period(d): kỳ ghi điện đang cần làm. Từ ngày 28 là tháng hiện tại, trước ngày 28 là tháng trước
--    (số tháng trước dùng cho hoá đơn tháng này).
--  * room_elec_save: phòng đã có số tháng trước thì số đầu kỳ = số cuối tháng trước. Sale chỉ nhập số cuối kỳ.
--    Phòng chưa có số tháng trước (phòng mới, khách mới) thì nhập cả số đầu kỳ và số cuối kỳ.
--    Giám sát, Quản lý sửa được số đầu kỳ (thay đồng hồ).
--  * Ghi hoặc sửa số điện sau khi đã có hoá đơn chưa thu của tháng kế tiếp: hoá đơn tự tính lại.
--  * month_close(p_rent, p_meter): từng phòng thuê tháng của các toà người dùng được xem:
--    hợp đồng, CCCD người ở, đã ghi điện chưa, đã chốt tiền nhà chưa (có hoá đơn và đã có tiền điện), đã thu chưa.
--  * Nhắc việc: ngày 28 nhắc ghi điện, ngày 1 nhắc thu tiền, ngày 4 nhắc phòng chưa đóng (gặp Chủ nhật thì dời sang thứ Hai).

-- ---------- Kỳ ghi điện ----------
create or replace function public.meter_period(p_date date default null) returns date
language sql stable set search_path = public as $$
  select case when extract(day from d) >= 28 then date_trunc('month', d)::date
              else (date_trunc('month', d) - interval '1 month')::date end
  from (select coalesce(p_date, (now() at time zone 'Asia/Ho_Chi_Minh')::date) d) x
$$;
grant execute on function public.meter_period(date) to authenticated;

-- ---------- Số đầu kỳ lấy theo số cuối tháng trước ----------
do $$
declare def text := pg_get_functiondef('public.room_elec_save(uuid,date,numeric,numeric,text)'::regprocedure);
  old_txt text := '  if p_end < p_start then';
  new_txt text := '  select x.end_reading into prev from public.room_elec_readings x where x.room_id = p_room and x.period < per order by x.period desc limit 1;
  if prev is not null and p_start is distinct from prev and not public.can_manage_building(rm.building_id) then
    raise exception ''Phòng %: số đầu kỳ phải bằng số cuối tháng trước (%). Thay đồng hồ thì báo Giám sát hoặc Quản lý sửa.'', rm.code, prev;
  end if;
  if p_end < p_start then';
begin
  if position(old_txt in def) = 0 then raise exception 'room_elec_save: không tìm thấy đoạn cần sửa'; end if;
  def := replace(def, old_txt, new_txt);
  def := replace(def, 'declare rm public.rooms;', 'declare prev numeric; rm public.rooms;');
  if position('declare prev numeric;' in def) = 0 then raise exception 'room_elec_save: không thêm được biến prev'; end if;
  execute def;
end $$;

-- ---------- Ghi số điện xong thì tính lại hoá đơn chưa thu của tháng kế tiếp ----------
do $$
declare def text := pg_get_functiondef('public.tg_invoices_before()'::regprocedure);
  old_txt text := 'if tg_op = ''UPDATE'' and auth.uid() is not null and not public.can_manage_building(old.building_id) then';
begin
  if position(old_txt in def) = 0 then raise exception 'tg_invoices_before: không tìm thấy đoạn cần sửa'; end if;
  execute replace(def, old_txt,
    'if tg_op = ''UPDATE'' and auth.uid() is not null and not public.can_manage_building(old.building_id)
     and coalesce(current_setting(''app.invoice_refresh'', true), '''') <> ''1'' then');
end $$;

create or replace function public.tg_room_elec_refresh() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  rid uuid := coalesce(new.room_id, old.room_id);
  per date := (date_trunc('month', coalesce(new.period, old.period)) + interval '1 month')::date;
  i record; l jsonb;
begin
  for i in select inv.id, inv.contract_id from public.invoices inv join public.contracts c on c.id = inv.contract_id
           where c.room_id = rid and inv.period = per and inv.status = 'chua_thu' loop
    l := public.invoice_lines(i.contract_id, per);
    perform set_config('app.invoice_refresh', '1', true);
    update public.invoices set lines = l,
      amount = (select coalesce(sum((x->>'amount')::numeric), 0) from jsonb_array_elements(l) x),
      vat_amount = (select coalesce(sum((x->>'vat')::numeric), 0) from jsonb_array_elements(l) x)
    where id = i.id;
    perform set_config('app.invoice_refresh', '', true);
  end loop;
  return null;
end $$;
drop trigger if exists room_elec_refresh on public.room_elec_readings;
create trigger room_elec_refresh after insert or update or delete on public.room_elec_readings
  for each row execute function public.tg_room_elec_refresh();

-- ---------- Bảng chốt tháng từng phòng ----------
create or replace function public.month_close(p_rent date default null, p_meter date default null)
returns table (
  building_id uuid, building_code text, room_id uuid, room_code text, floor int, room_status text,
  contract_id uuid, contract_code text, tenant_name text, contract_end date,
  occupants int, cccd_missing int,
  meter_period date, meter_needed boolean, meter_done boolean,
  rent_period date, invoice_id uuid, invoice_status text, invoice_amount numeric, due_date date,
  elec_needed boolean, elec_ok boolean, collected_at date)
language sql stable security definer set search_path = public as $$
  with prm as (
    select coalesce(date_trunc('month', p_rent)::date, date_trunc('month', (now() at time zone 'Asia/Ho_Chi_Minh'))::date) rp,
           coalesce(date_trunc('month', p_meter)::date, public.meter_period()) mp
  ),
  rw as (
    select b.id bid, b.code bcode, r.id rid, r.code rcode, r.floor, r.status::text rstatus, c.*, prm.rp, prm.mp,
      public.building_unit_price(b.id, 'dien') is not null has_price
    from public.buildings b cross join prm
    join public.rooms r on r.building_id = b.id and r.rent_mode = 'thang'
    left join lateral (
      select ct.id cid, ct.code ccode, ct.start_date cstart, ct.end_date cend, t.full_name tname
        from public.contracts ct join public.tenants t on t.id = ct.tenant_id
       where ct.room_id = r.id and ct.status = 'hieu_luc' order by ct.start_date desc limit 1) c on true
    where b.status <> 'ngung' and public.can_access_building(b.id)
      and (c.cid is not null or r.status = 'dang_o')
  )
  select x.bid, x.bcode, x.rid, x.rcode, x.floor, x.rstatus,
    x.cid, x.ccode, x.tname, x.cend,
    coalesce((select count(*) from public.contract_occupants o where o.contract_id = x.cid and o.move_out is null), 0)::int,
    coalesce((select count(*) from public.contract_occupants o where o.contract_id = x.cid and o.move_out is null
               and not public.tenant_has_cccd(o.tenant_id)), 0)::int,
    x.mp,
    x.cid is not null and x.cstart < (x.mp + interval '1 month')::date,
    exists (select 1 from public.room_elec_readings e where e.room_id = x.rid and e.period = x.mp),
    x.rp, i.id, i.status::text, i.amount, i.due_date,
    x.cid is not null and x.cstart < x.rp and x.has_price,
    not (x.cid is not null and x.cstart < x.rp and x.has_price)
      or coalesce(i.lines @> '[{"k":"dien"}]', false)
      or exists (select 1 from public.room_elec_readings e where e.room_id = x.rid
                  and e.period = (x.rp - interval '1 month')::date and e.end_reading = e.start_reading),
    i.collected_at
  from rw x
  left join public.invoices i on i.contract_id = x.cid and i.period = x.rp and i.status <> 'huy'
  order by x.bcode, x.floor nulls last, x.rcode
$$;
revoke execute on function public.month_close(date, date) from public, anon;
grant execute on function public.month_close(date, date) to authenticated;

-- ---------- Nhắc việc chốt tháng ----------
-- Gửi cho nhân viên, giám sát gắn với toà. Ngày rơi vào Chủ nhật thì gửi thứ Hai.
create or replace function public.notify_month_close() returns void
language plpgsql security definer set search_path = public as $$
declare
  d date := (now() at time zone 'Asia/Ho_Chi_Minh')::date;
  dd int := extract(day from d); dw int := extract(dow from d);
  step text; per date; b record; n int; u uuid;
begin
  step := case
    when (dd = 28 and dw <> 0) or (dd = 29 and dw = 1) then 'dien'
    when (dd = 1 and dw <> 0) or (dd = 2 and dw = 1) then 'thu'
    when (dd = 4 and dw <> 0) or (dd = 5 and dw = 1) then 'no' end;
  if step is null then return; end if;
  per := date_trunc('month', d)::date;
  for b in select * from public.buildings where status <> 'ngung' loop
    if step = 'dien' then
      select count(*) into n from public.contracts c join public.rooms r on r.id = c.room_id
       where c.building_id = b.id and c.status = 'hieu_luc' and r.rent_mode = 'thang'
         and c.start_date < (per + interval '1 month')::date
         and not exists (select 1 from public.room_elec_readings e where e.room_id = c.room_id and e.period = per);
    else
      select count(*) into n from public.invoices i where i.building_id = b.id and i.period = per and i.status = 'chua_thu';
    end if;
    if n = 0 then continue; end if;
    for u in select distinct m.user_id from public.building_members m join public.profiles p on p.id = m.user_id
              where m.building_id = b.id and p.is_active and p.role in ('nhan_vien','giam_sat') loop
      perform public.notify(u, case when step = 'dien' then 'khac' else 'nhac_thu_tien' end::public.notif_type,
        case step when 'dien' then 'Ghi đồng hồ điện toà ' || b.code
                  when 'thu' then 'Thu tiền nhà toà ' || b.code
                  else 'Còn phòng chưa đóng tiền toà ' || b.code end,
        case step when 'dien' then 'Toà ' || b.code || ' còn ' || n || ' phòng chưa ghi số điện tháng ' || to_char(per, 'MM/YYYY') || '. Ghi trước ngày 1 để kịp lập hoá đơn.'
                  when 'thu' then 'Tháng ' || to_char(per, 'MM/YYYY') || ' toà ' || b.code || ' có ' || n || ' phòng cần thu tiền nhà, hạn thu ngày 1 đến ngày 3.'
                  else 'Toà ' || b.code || ' còn ' || n || ' phòng chưa đóng tiền nhà tháng ' || to_char(per, 'MM/YYYY') || '.' end,
        'building', b.id, 'chot-' || step || '-' || b.id || '-' || to_char(d, 'YYYYMM') || '-' || u);
    end loop;
  end loop;
end $$;
revoke execute on function public.notify_month_close() from public, anon, authenticated;

select cron.schedule('nhac-chot-thang', '15 1 * * *', $$select public.notify_month_close()$$);
