-- Thông tin khách: người ở (CCCD), hợp đồng/cọc/đơn giá, số điện nước có ảnh, phiếu thu tháng
alter table public.customer_bills add column if not exists lines jsonb;
create unique index if not exists customer_bills_one_statement_idx
  on public.customer_bills (customer_id, period) where kind = 'phieu_thu' and status <> 'huy';

-- ===== Người ở =====
create table public.customer_occupants (
  id uuid primary key default gen_random_uuid(),
  customer_id uuid not null references public.customer_profiles(id) on delete cascade,
  full_name text not null,
  cccd text not null check (cccd ~ '^[0-9]{12}$'),
  relation text,
  created_by uuid references public.profiles(id) on delete set null default auth.uid(),
  created_at timestamptz not null default now(),
  unique (cccd)
);
create index on public.customer_occupants(customer_id);
create index on public.customer_occupants(created_by);
alter table public.customer_occupants enable row level security;
revoke all on public.customer_occupants from anon, authenticated;

create or replace function public.tg_cp_cccd_vs_occ() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if exists (select 1 from public.customer_occupants where cccd = new.cccd) then
    raise exception 'CCCD này đã được đăng ký là người ở của khách khác';
  end if;
  return new;
end $$;
create trigger cp_cccd_vs_occ before insert or update of cccd on public.customer_profiles
  for each row execute function public.tg_cp_cccd_vs_occ();
revoke execute on function public.tg_cp_cccd_vs_occ() from public, anon, authenticated;

create or replace function public.customer_access_ok(c uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select c = auth.uid() or (public.app_role() is not null and public.can_handle_customer(c))
$$;
revoke execute on function public.customer_access_ok(uuid) from public, anon;
grant execute on function public.customer_access_ok(uuid) to authenticated;

create or replace function public.occupants_list(p_customer uuid)
returns table (id uuid, full_name text, cccd text, relation text, created_at timestamptz)
language sql stable security definer set search_path = public as $$
  select o.id, o.full_name,
         case when o.customer_id = auth.uid() or public.is_manager() then o.cccd else '••••••••' || right(o.cccd, 4) end,
         o.relation, o.created_at
  from public.customer_occupants o
  where o.customer_id = p_customer and public.customer_access_ok(p_customer)
  order by o.created_at
$$;
revoke execute on function public.occupants_list(uuid) from public, anon;
grant execute on function public.occupants_list(uuid) to authenticated;

-- ===== Hợp đồng, tiền cọc, đơn giá của khách =====
create table public.customer_leases (
  customer_id uuid primary key references public.customer_profiles(id) on delete cascade,
  start_date date, end_date date,
  rent numeric(14,0) not null default 0 check (rent >= 0),
  deposit numeric(14,0) not null default 0 check (deposit >= 0),
  elec_price numeric(12,0) check (elec_price >= 0),
  water_price numeric(12,0) check (water_price >= 0),
  water_mode text not null default 'm3' check (water_mode in ('m3','nguoi')),
  service_fee numeric(14,0) not null default 0 check (service_fee >= 0),
  max_occupants int check (max_occupants > 0),
  updated_by uuid references public.profiles(id) on delete set null,
  updated_at timestamptz not null default now(),
  check (end_date is null or start_date is null or end_date >= start_date)
);
create index on public.customer_leases(updated_by);
alter table public.customer_leases enable row level security;
create policy leases_select on public.customer_leases for select to authenticated
  using (customer_id = (select auth.uid()) or (public.app_role() is not null and public.can_handle_customer(customer_id)));
revoke all on public.customer_leases from anon, authenticated;
grant select on public.customer_leases to authenticated;

create or replace function public.lease_save(p_customer uuid, p_start date, p_end date, p_rent numeric, p_deposit numeric,
  p_elec numeric, p_water numeric, p_water_mode text, p_service numeric, p_max int) returns void
language plpgsql security definer set search_path = public as $$
begin
  if public.app_role() is null or not public.can_handle_customer(p_customer) then raise exception 'Không có quyền cập nhật hợp đồng của khách này'; end if;
  if not exists (select 1 from public.customer_profiles where id = p_customer) then raise exception 'Không phải tài khoản khách hàng'; end if;
  if p_end is not null and p_start is not null and p_end < p_start then raise exception 'Ngày kết thúc phải sau ngày bắt đầu'; end if;
  insert into public.customer_leases (customer_id, start_date, end_date, rent, deposit, elec_price, water_price, water_mode, service_fee, max_occupants, updated_by, updated_at)
  values (p_customer, p_start, p_end, coalesce(p_rent,0), coalesce(p_deposit,0), p_elec, p_water, coalesce(nullif(p_water_mode,''),'m3'), coalesce(p_service,0), p_max, auth.uid(), now())
  on conflict (customer_id) do update set start_date = excluded.start_date, end_date = excluded.end_date, rent = excluded.rent,
    deposit = excluded.deposit, elec_price = excluded.elec_price, water_price = excluded.water_price, water_mode = excluded.water_mode,
    service_fee = excluded.service_fee, max_occupants = excluded.max_occupants, updated_by = auth.uid(), updated_at = now();
end $$;
revoke execute on function public.lease_save(uuid, date, date, numeric, numeric, numeric, numeric, text, numeric, int) from public, anon;
grant execute on function public.lease_save(uuid, date, date, numeric, numeric, numeric, numeric, text, numeric, int) to authenticated;

create or replace function public.occupant_add(p_customer uuid, p_name text, p_cccd text, p_relation text) returns uuid
language plpgsql security definer set search_path = public as $$
declare cc text := regexp_replace(coalesce(p_cccd,''), '\D', '', 'g'); mx int; n int; nid uuid;
begin
  if not public.customer_access_ok(p_customer) then raise exception 'Không có quyền'; end if;
  if not exists (select 1 from public.customer_profiles where id = p_customer) then raise exception 'Không phải tài khoản khách hàng'; end if;
  p_name := btrim(coalesce(p_name,''));
  if p_name = '' then raise exception 'Cần nhập họ tên người ở'; end if;
  if cc !~ '^[0-9]{12}$' then raise exception 'CCCD phải đủ 12 số'; end if;
  if exists (select 1 from public.customer_profiles where cccd = cc) or exists (select 1 from public.customer_occupants where cccd = cc) then
    raise exception 'CCCD này đã được đăng ký. Mỗi CCCD chỉ đăng ký một lần';
  end if;
  select max_occupants into mx from public.customer_leases where customer_id = p_customer;
  select count(*) + 1 into n from public.customer_occupants where customer_id = p_customer;
  if mx is not null and n + 1 > mx then raise exception 'Phòng chỉ cho tối đa % người ở', mx; end if;
  insert into public.customer_occupants (customer_id, full_name, cccd, relation)
    values (p_customer, left(p_name, 100), cc, left(nullif(btrim(coalesce(p_relation,'')),''), 40)) returning id into nid;
  return nid;
end $$;
revoke execute on function public.occupant_add(uuid, text, text, text) from public, anon;
grant execute on function public.occupant_add(uuid, text, text, text) to authenticated;

create or replace function public.occupant_delete(p_id uuid) returns void
language plpgsql security definer set search_path = public as $$
declare c uuid;
begin
  select customer_id into c from public.customer_occupants where id = p_id;
  if c is null then return; end if;
  if public.app_role() is null or not public.can_handle_customer(c) then raise exception 'Chỉ nhân viên phụ trách được xoá người ở'; end if;
  delete from public.customer_occupants where id = p_id;
end $$;
revoke execute on function public.occupant_delete(uuid) from public, anon;
grant execute on function public.occupant_delete(uuid) to authenticated;

-- ===== Số điện nước (có ảnh) =====
create table public.meter_readings (
  id uuid primary key default gen_random_uuid(),
  customer_id uuid not null references public.customer_profiles(id) on delete cascade,
  room_id uuid references public.rooms(id) on delete set null,
  kind text not null check (kind in ('dien','nuoc')),
  reading numeric(12,1) not null check (reading >= 0),
  read_on date not null default (now() at time zone 'Asia/Ho_Chi_Minh')::date,
  photo_path text not null,
  photo_store text not null default 'supabase' check (photo_store in ('supabase','r2')),
  photo_thumb boolean not null default false,
  source text not null check (source in ('khach','nhan_vien')),
  ocr_value numeric(12,1),
  note text,
  statement_bill_id uuid references public.customer_bills(id) on delete set null,
  created_by uuid references public.profiles(id) on delete set null default auth.uid(),
  created_at timestamptz not null default now()
);
create index on public.meter_readings(customer_id, kind, read_on desc);
create index on public.meter_readings(room_id);
create index on public.meter_readings(statement_bill_id);
create index on public.meter_readings(created_by);
alter table public.meter_readings enable row level security;
create policy meter_select on public.meter_readings for select to authenticated
  using (customer_id = (select auth.uid()) or (public.app_role() is not null and public.can_handle_customer(customer_id)));
revoke all on public.meter_readings from anon, authenticated;
grant select on public.meter_readings to authenticated;

-- Quyền tệp dong-ho/<mã khách>/...: khách đó và nhân sự phụ trách đọc/ghi
create or replace function public.storage_path_ok(p_name text, p_write boolean) returns boolean
language plpgsql stable security definer set search_path = public as $$
declare
  parts text[] := string_to_array(coalesce(p_name, ''), '/');
  o uuid;
begin
  if array_length(parts, 1) is null or array_length(parts, 1) < 3 then return false; end if;
  begin o := parts[2]::uuid; exception when others then return false; end;
  if parts[1] = 'phan-anh' then
    return public.is_active_user() and exists (
      select 1 from public.feedback_threads f
      where f.id = o and (f.customer_id = auth.uid() or public.feedback_can_handle(f.id))
        and (not p_write or f.status <> 'dong'));
  end if;
  if parts[1] = 'dong-ho' then
    return public.is_active_user() and public.customer_access_ok(o);
  end if;
  if public.app_role() is null then return false; end if;
  return case parts[1]
    when 'cccd'      then public.can_manage_building(o)
    when 'hop-dong'  then case when p_write then public.can_manage_building(o) else public.can_access_building(o) end
    when 'anh-phong' then public.can_access_building(o)
    when 'anh-toa'   then case when p_write then public.can_manage_building(o) else public.can_access_building(o) end
    when 'de-nghi'   then exists (select 1 from public.requests r
                                  where r.id = o and (r.requester_id = auth.uid() or public.is_manager()
                                                      or (not p_write and public.is_request_approver(r.id))))
    else false end;
end $$;
revoke execute on function public.storage_path_ok(text, boolean) from public, anon;
grant execute on function public.storage_path_ok(text, boolean) to authenticated;

create or replace function public.meter_add(p_customer uuid, p_kind text, p_reading numeric, p_path text, p_store text,
  p_thumb boolean, p_ocr numeric, p_note text) returns uuid
language plpgsql security definer set search_path = public as $$
declare c public.customer_profiles; self boolean := (p_customer = auth.uid() and public.is_customer()); last_r numeric; nid uuid; nm text; u uuid; lbl text;
begin
  if not self and (public.app_role() is null or not public.can_handle_customer(p_customer)) then raise exception 'Không có quyền nhập số cho khách này'; end if;
  if p_kind not in ('dien','nuoc') then raise exception 'Loại đồng hồ không hợp lệ'; end if;
  if self and p_kind <> 'dien' then raise exception 'Khách chỉ gửi số điện. Số nước do nhân viên ghi'; end if;
  select * into c from public.customer_profiles where id = p_customer;
  if not found then raise exception 'Không phải tài khoản khách hàng'; end if;
  if c.room_id is null then raise exception 'Khách chưa được gán phòng'; end if;
  if p_reading is null or p_reading < 0 then raise exception 'Số đồng hồ không hợp lệ'; end if;
  if coalesce(p_path,'') not like 'dong-ho/' || p_customer::text || '/%' then raise exception 'Cần chụp ảnh đồng hồ'; end if;
  select reading into last_r from public.meter_readings where customer_id = p_customer and kind = p_kind order by read_on desc, created_at desc limit 1;
  if last_r is not null and p_reading < last_r then raise exception 'Số mới (%) nhỏ hơn số đã ghi trước đó (%)', p_reading, last_r; end if;
  insert into public.meter_readings (customer_id, room_id, kind, reading, photo_path, photo_store, photo_thumb, source, ocr_value, note)
    values (p_customer, c.room_id, p_kind, p_reading, p_path, coalesce(p_store,'supabase'), coalesce(p_thumb,false),
            case when self then 'khach' else 'nhan_vien' end, p_ocr, left(nullif(btrim(coalesce(p_note,'')),''), 200)) returning id into nid;
  lbl := case p_kind when 'dien' then 'điện' else 'nước' end;
  if self then
    select full_name into nm from public.profiles where id = p_customer;
    for u in select distinct s.x from (select c.created_by as x union select id from public.profiles where role in ('quan_ly','giam_sat') and is_active) s where s.x is not null loop
      perform public.notify(u, 'khac', 'Khách gửi số ' || lbl, coalesce(nm,'Khách') || ' · ' || p_reading::text, 'customer', p_customer, 'meter-' || nid || '-' || u);
    end loop;
  else
    perform public.notify(p_customer, 'khac', 'Nhân viên ghi số ' || lbl, 'Số ' || lbl || ': ' || p_reading::text, 'customer', p_customer, 'meter-' || nid);
  end if;
  return nid;
end $$;
revoke execute on function public.meter_add(uuid, text, numeric, text, text, boolean, numeric, text) from public, anon;
grant execute on function public.meter_add(uuid, text, numeric, text, text, boolean, numeric, text) to authenticated;

create or replace function public.meter_delete(p_id uuid) returns void
language plpgsql security definer set search_path = public as $$
declare m public.meter_readings;
begin
  select * into m from public.meter_readings where id = p_id;
  if not found then return; end if;
  if public.app_role() is null or not public.can_handle_customer(m.customer_id) then raise exception 'Không có quyền'; end if;
  if m.statement_bill_id is not null then raise exception 'Số này đã dùng cho phiếu thu, không xoá được'; end if;
  delete from public.meter_readings where id = p_id;
end $$;
revoke execute on function public.meter_delete(uuid) from public, anon;
grant execute on function public.meter_delete(uuid) to authenticated;

-- Số đầu kỳ = số đã chốt ở phiếu gần nhất (hoặc số ghi đầu tiên); số cuối kỳ = số mới nhất
create or replace function public.meter_cycle(p_customer uuid)
returns table (kind text, open_id uuid, close_id uuid)
language sql stable security definer set search_path = public as $$
  select k.kind,
    coalesce(
      (select m.id from public.meter_readings m where m.customer_id = p_customer and m.kind = k.kind and m.statement_bill_id is not null order by m.read_on desc, m.created_at desc, m.reading desc limit 1),
      (select m.id from public.meter_readings m where m.customer_id = p_customer and m.kind = k.kind order by m.read_on, m.created_at, m.reading limit 1)),
    (select m.id from public.meter_readings m where m.customer_id = p_customer and m.kind = k.kind order by m.read_on desc, m.created_at desc, m.reading desc limit 1)
  from (values ('dien'), ('nuoc')) k(kind)
  where public.customer_access_ok(p_customer)
    and exists (select 1 from public.meter_readings m where m.customer_id = p_customer and m.kind = k.kind)
$$;
revoke execute on function public.meter_cycle(uuid) from public, anon;
grant execute on function public.meter_cycle(uuid) to authenticated;

-- ===== Phiếu thu tháng =====
create or replace function public.statement_preview(p_customer uuid, p_month date, p_extra numeric, p_extra_note text) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare l public.customer_leases; lines jsonb := '[]'::jsonb; tot numeric := 0; amt numeric; n int; mlabel text;
  eo numeric; ec numeric; wo numeric; wc numeric; r record;
begin
  if not public.customer_access_ok(p_customer) then raise exception 'Không có quyền'; end if;
  select * into l from public.customer_leases where customer_id = p_customer;
  if not found then raise exception 'Chưa nhập hợp đồng và đơn giá cho khách này'; end if;
  mlabel := to_char(date_trunc('month', p_month), 'MM/YYYY');
  if l.rent > 0 then
    lines := lines || jsonb_build_object('label', 'Tiền phòng ' || mlabel, 'amount', l.rent); tot := tot + l.rent;
  end if;
  if l.service_fee > 0 then
    lines := lines || jsonb_build_object('label', 'Phí dịch vụ', 'amount', l.service_fee); tot := tot + l.service_fee;
  end if;
  for r in select * from public.meter_cycle(p_customer) loop
    select reading into wo from public.meter_readings where id = r.open_id;
    select reading into wc from public.meter_readings where id = r.close_id;
    if r.kind = 'dien' and l.elec_price is not null and wc > wo then
      amt := round((wc - wo) * l.elec_price);
      lines := lines || jsonb_build_object('label', 'Tiền điện', 'amount', amt,
        'detail', trim(to_char(wc - wo, 'FM999999990.9'), '.') || ' kWh × ' || to_char(l.elec_price, 'FM999G999G999') || ' (' || trim(to_char(wo,'FM999999990.9'),'.') || ' → ' || trim(to_char(wc,'FM999999990.9'),'.') || ')');
      tot := tot + amt;
    elsif r.kind = 'nuoc' and l.water_mode = 'm3' and l.water_price is not null and wc > wo then
      amt := round((wc - wo) * l.water_price);
      lines := lines || jsonb_build_object('label', 'Tiền nước', 'amount', amt,
        'detail', trim(to_char(wc - wo, 'FM999999990.9'), '.') || ' m³ × ' || to_char(l.water_price, 'FM999G999G999') || ' (' || trim(to_char(wo,'FM999999990.9'),'.') || ' → ' || trim(to_char(wc,'FM999999990.9'),'.') || ')');
      tot := tot + amt;
    end if;
  end loop;
  if l.water_mode = 'nguoi' and l.water_price is not null then
    select count(*) + 1 into n from public.customer_occupants where customer_id = p_customer;
    amt := l.water_price * n;
    lines := lines || jsonb_build_object('label', 'Tiền nước', 'amount', amt, 'detail', n || ' người × ' || to_char(l.water_price, 'FM999G999G999'));
    tot := tot + amt;
  end if;
  if coalesce(p_extra, 0) <> 0 then
    lines := lines || jsonb_build_object('label', coalesce(nullif(btrim(p_extra_note),''), 'Khoản khác'), 'amount', p_extra); tot := tot + p_extra;
  end if;
  return jsonb_build_object('lines', lines, 'total', tot);
end $$;
revoke execute on function public.statement_preview(uuid, date, numeric, text) from public, anon;
grant execute on function public.statement_preview(uuid, date, numeric, text) to authenticated;

create or replace function public.statement_create(p_customer uuid, p_month date, p_due date, p_extra numeric, p_extra_note text) returns uuid
language plpgsql security definer set search_path = public as $$
declare c public.customer_profiles; pv jsonb; tot numeric; nid uuid; m date := date_trunc('month', p_month)::date;
begin
  if public.app_role() is null or not public.can_handle_customer(p_customer) then raise exception 'Không có quyền tạo phiếu thu cho khách này'; end if;
  select * into c from public.customer_profiles where id = p_customer;
  if not found then raise exception 'Không phải tài khoản khách hàng'; end if;
  pv := public.statement_preview(p_customer, m, p_extra, p_extra_note);
  tot := (pv->>'total')::numeric;
  if tot <= 0 then raise exception 'Phiếu thu chưa có khoản nào để thu'; end if;
  begin
    insert into public.customer_bills (customer_id, building_id, room_id, kind, period, amount, due_date, lines)
    values (p_customer, c.building_id, c.room_id, 'phieu_thu', m, tot, p_due, pv->'lines') returning id into nid;
  exception when unique_violation then
    raise exception 'Đã có phiếu thu tháng % cho khách này. Huỷ phiếu cũ nếu muốn lập lại', to_char(m, 'MM/YYYY');
  end;
  update public.meter_readings set statement_bill_id = nid
    where id in (select close_id from public.meter_cycle(p_customer)) and statement_bill_id is null;
  perform public.notify(p_customer, 'khac', 'Phiếu thu tháng ' || to_char(m, 'MM/YYYY'), to_char(tot, 'FM999G999G999G999') || ' đ', 'bill', nid, 'bill-new-' || nid);
  return nid;
end $$;
revoke execute on function public.statement_create(uuid, date, date, numeric, text) from public, anon;
grant execute on function public.statement_create(uuid, date, date, numeric, text) to authenticated;

-- Huỷ phiếu thì trả số điện nước về chưa chốt
create or replace function public.cbill_set(p_bill uuid, p_action text) returns void
language plpgsql security definer set search_path = public as $$
declare b public.customer_bills;
begin
  select * into b from public.customer_bills where id = p_bill;
  if not found then raise exception 'Không tìm thấy khoản thu'; end if;
  if public.app_role() is null or not public.can_handle_customer(b.customer_id) then raise exception 'Không có quyền'; end if;
  if p_action = 'xac_nhan' then
    if b.status not in ('chua_thanh_toan','cho_xac_nhan') then raise exception 'Khoản này đã xử lý'; end if;
    update public.customer_bills set status = 'da_thanh_toan', confirmed_at = now(), confirmed_by = auth.uid() where id = p_bill;
    perform public.notify(b.customer_id, 'khac', 'Đã nhận thanh toán', to_char(b.amount,'FM999G999G999G999') || ' đ · ' || b.pay_code, 'bill', b.id, 'bill-ok-' || b.id);
  elsif p_action = 'tu_choi' then
    if b.status <> 'cho_xac_nhan' then raise exception 'Khoản này không chờ xác nhận'; end if;
    update public.customer_bills set status = 'chua_thanh_toan', reported_at = null, reported_note = null where id = p_bill;
    perform public.notify(b.customer_id, 'khac', 'Chưa nhận được tiền', 'Công ty chưa thấy khoản ' || b.pay_code || ' trong tài khoản. Vui lòng kiểm tra lại', 'bill', b.id, 'bill-no-' || b.id || '-' || extract(epoch from now())::bigint);
  elsif p_action = 'huy' then
    if b.status = 'da_thanh_toan' then raise exception 'Khoản đã thanh toán, không huỷ được'; end if;
    update public.customer_bills set status = 'huy' where id = p_bill;
    update public.meter_readings set statement_bill_id = null where statement_bill_id = p_bill;
  else raise exception 'Hành động không hợp lệ'; end if;
end $$;
revoke execute on function public.cbill_set(uuid, text) from public, anon;
grant execute on function public.cbill_set(uuid, text) to authenticated;

-- ===== Tổng quan của một khách (khách tự xem hoặc nhân sự phụ trách) =====
create or replace function public.customer_overview(p_customer uuid default null) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare c uuid := coalesce(p_customer, auth.uid()); today date := (now() at time zone 'Asia/Ho_Chi_Minh')::date;
begin
  if not public.customer_access_ok(c) then raise exception 'Không có quyền xem'; end if;
  return jsonb_build_object(
    'customer', (select jsonb_build_object('id', p.id, 'full_name', p.full_name, 'phone', p.phone) from public.profiles p where p.id = c),
    'place', (select jsonb_build_object('building_id', cp.building_id, 'building_code', b.code, 'building_name', b.name, 'room_id', cp.room_id, 'room_code', r.code)
              from public.customer_profiles cp left join public.buildings b on b.id = cp.building_id left join public.rooms r on r.id = cp.room_id where cp.id = c),
    'lease', (select to_jsonb(l) - 'updated_by' from public.customer_leases l where l.customer_id = c),
    'occupant_count', (select count(*) from public.customer_occupants where customer_id = c) + 1,
    'debt', coalesce((select sum(amount) from public.customer_bills where customer_id = c and status in ('chua_thanh_toan','cho_xac_nhan')), 0),
    'overdue', coalesce((select sum(amount) from public.customer_bills where customer_id = c and status in ('chua_thanh_toan','cho_xac_nhan') and due_date < today), 0)
  );
end $$;
revoke execute on function public.customer_overview(uuid) from public, anon;
grant execute on function public.customer_overview(uuid) to authenticated;
