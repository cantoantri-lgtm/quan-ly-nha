-- Quyền thêm cho Kế toán (người giữ nhiệm vụ ke_toan trong Sơ đồ công ty), theo yêu cầu 16/11/2026:
--  * Xem Báo cáo thu chi, lấp đầy, lợi nhuận của MỌI toà (như Quản lý). Báo cáo phản ánh vẫn chỉ Lead Sale trở lên.
--  * Nhập, sửa, xoá chi phí theo toà và tiền thuê nhà.
--  * Xác nhận / từ chối / huỷ khoản thu khách ở mục Thu tiền khách (mọi khách), xem giao dịch ngân hàng SePay.
--  * Xem danh sách toà (mã, tên) để chọn khi nhập chi phí. KHÔNG thêm quyền xem phòng, hợp đồng, CCCD, sửa thông tin khách.
-- is_payer() (041) = Quản lý hoặc Kế toán.

create policy buildings_select_ke_toan on public.buildings for select to authenticated using (public.is_duty('ke_toan'));
create policy profiles_select_ke_toan on public.profiles for select to authenticated using (role = 'khach_hang' and public.is_duty('ke_toan'));
create policy cbills_select_ke_toan on public.customer_bills for select to authenticated using (public.app_role() is not null and public.is_duty('ke_toan'));

drop policy if exists bank_txn_select on public.bank_transactions;
create policy bank_txn_select on public.bank_transactions for select to authenticated using (public.is_payer());
drop policy if exists bexp_select on public.building_expenses;
create policy bexp_select on public.building_expenses for select to authenticated using (public.is_payer());
drop policy if exists brent_select on public.building_rents;
create policy brent_select on public.building_rents for select to authenticated using (public.is_payer());

create or replace function public.cbill_set(p_bill uuid, p_action text) returns void
language plpgsql security definer set search_path = public as $$
declare b public.customer_bills;
begin
  select * into b from public.customer_bills where id = p_bill;
  if not found then raise exception 'Không tìm thấy khoản thu'; end if;
  if public.app_role() is null or not (public.can_handle_customer(b.customer_id) or public.is_duty('ke_toan')) then raise exception 'Không có quyền'; end if;
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

create or replace function public.expense_save(p_id uuid, p_building uuid, p_date date, p_category text, p_amount numeric, p_note text) returns uuid
language plpgsql security definer set search_path = public as $$
declare nid uuid;
begin
  if not public.is_payer() then raise exception 'Chỉ Quản lý hoặc Kế toán nhập chi phí'; end if;
  if p_amount is null or p_amount <= 0 then raise exception 'Số tiền chi phải lớn hơn 0'; end if;
  if p_id is null then
    insert into public.building_expenses (building_id, spent_on, category, amount, note)
    values (p_building, coalesce(p_date, (now() at time zone 'Asia/Ho_Chi_Minh')::date), coalesce(nullif(btrim(p_category),''), 'Khác'), p_amount, nullif(btrim(coalesce(p_note,'')),''))
    returning id into nid;
  else
    update public.building_expenses set building_id = p_building, spent_on = coalesce(p_date, spent_on),
      category = coalesce(nullif(btrim(p_category),''), 'Khác'), amount = p_amount, note = nullif(btrim(coalesce(p_note,'')),'')
    where id = p_id returning id into nid;
    if nid is null then raise exception 'Không tìm thấy khoản chi'; end if;
  end if;
  return nid;
end $$;
create or replace function public.expense_delete(p_id uuid) returns void
language plpgsql security definer set search_path = public as $$
begin
  if not public.is_payer() then raise exception 'Chỉ Quản lý hoặc Kế toán xoá khoản chi'; end if;
  delete from public.building_expenses where id = p_id;
end $$;
create or replace function public.rent_save(p_building uuid, p_from date, p_amount numeric, p_note text) returns uuid
language plpgsql security definer set search_path = public as $$
declare nid uuid; m date := date_trunc('month', coalesce(p_from, (now() at time zone 'Asia/Ho_Chi_Minh')::date))::date;
begin
  if not public.is_payer() then raise exception 'Chỉ Quản lý hoặc Kế toán nhập tiền thuê nhà'; end if;
  if p_amount is null or p_amount < 0 then raise exception 'Số tiền thuê không hợp lệ'; end if;
  insert into public.building_rents (building_id, effective_from, monthly_rent, note)
  values (p_building, m, p_amount, nullif(btrim(coalesce(p_note,'')),''))
  on conflict (building_id, effective_from) do update set monthly_rent = excluded.monthly_rent, note = excluded.note, created_by = auth.uid()
  returning id into nid;
  return nid;
end $$;
create or replace function public.rent_delete(p_id uuid) returns void
language plpgsql security definer set search_path = public as $$
begin
  if not public.is_payer() then raise exception 'Chỉ Quản lý hoặc Kế toán xoá tiền thuê nhà'; end if;
  delete from public.building_rents where id = p_id;
end $$;

create or replace function public.report_cashflow(p_from date, p_to date, p_group text) returns table (
  grp_key text, grp_name text, tien_phong numeric, phieu_thu numeric, doanh_thu_dem numeric, tien_coc numeric, chi numeric, thu numeric, rong numeric)
language plpgsql stable security definer set search_path = public as $$
declare fin boolean := public.is_payer();
begin
  if not (public.is_lead_up() or fin) then raise exception 'Chỉ Lead Sale, Giám sát, Kế toán, Quản lý xem báo cáo'; end if;
  if p_from is null or p_to is null or p_to < p_from then raise exception 'Khoảng ngày không hợp lệ'; end if;
  if p_group not in ('toa','nhan_vien','lead') then raise exception 'Nhóm báo cáo không hợp lệ'; end if;
  return query
  with f as (
    select i.building_id b, i.collected_by u, 'tp' k, i.amount a from public.invoices i
      where i.status = 'da_thu' and i.collected_at between p_from and p_to
    union all
    select c.building_id, c.confirmed_by, case when c.kind = 'tien_coc' then 'coc' else 'pt' end, c.amount from public.customer_bills c
      where c.status = 'da_thanh_toan' and (c.confirmed_at at time zone 'Asia/Ho_Chi_Minh')::date between p_from and p_to
    union all
    select n.building_id, n.created_by, 'dem', n.amount from public.nightly_revenues n where n.revenue_date between p_from and p_to
    union all
    select e.building_id, e.created_by, 'chi', e.amount from public.building_expenses e where fin and e.spent_on between p_from and p_to
  ), g as (
    select f.*,
      case p_group when 'toa' then coalesce(f.b::text, 'none')
                   when 'nhan_vien' then coalesce(f.u::text, 'none')
                   else coalesce((select lead_key from public.report_lead_of(f.u)), 'none') end gk,
      case p_group when 'toa' then coalesce((select bd.code || ' · ' || bd.name from public.buildings bd where bd.id = f.b), 'Không gắn toà')
                   when 'nhan_vien' then coalesce((select pr.full_name from public.profiles pr where pr.id = f.u), 'Chuyển khoản tự động / chưa rõ người')
                   else coalesce((select lead_name from public.report_lead_of(f.u)), 'Chưa gán lead') end gn
    from f where fin or f.b is null or public.can_access_building(f.b)
  )
  select g.gk, max(g.gn),
    coalesce(sum(g.a) filter (where g.k = 'tp'), 0), coalesce(sum(g.a) filter (where g.k = 'pt'), 0), coalesce(sum(g.a) filter (where g.k = 'dem'), 0),
    coalesce(sum(g.a) filter (where g.k = 'coc'), 0), coalesce(sum(g.a) filter (where g.k = 'chi'), 0),
    coalesce(sum(g.a) filter (where g.k in ('tp','pt','dem')), 0),
    coalesce(sum(g.a) filter (where g.k in ('tp','pt','dem')), 0) - coalesce(sum(g.a) filter (where g.k = 'chi'), 0)
  from g group by g.gk order by 9 desc;
end $$;

create or replace function public.report_occupancy(p_from date, p_to date) returns table (
  building_id uuid, building_name text, rooms int, dang_o int, trong int, dang_sua int, giu_cho int, room_days int, occupied_days int)
language plpgsql stable security definer set search_path = public as $$
declare fin boolean := public.is_payer();
begin
  if not (public.is_lead_up() or fin) then raise exception 'Chỉ Lead Sale, Giám sát, Kế toán, Quản lý xem báo cáo'; end if;
  if p_from is null or p_to is null or p_to < p_from then raise exception 'Khoảng ngày không hợp lệ'; end if;
  return query
  select b.id, b.code || ' · ' || b.name,
    count(r.id)::int,
    (count(r.id) filter (where r.status = 'dang_o'))::int, (count(r.id) filter (where r.status = 'trong'))::int,
    (count(r.id) filter (where r.status = 'dang_sua'))::int, (count(r.id) filter (where r.status = 'giu_cho'))::int,
    (count(r.id) * (p_to - p_from + 1))::int,
    coalesce(sum(least(coalesce((select sum(greatest(0, least(coalesce(c.end_date, p_to), p_to) - greatest(c.start_date, p_from) + 1))
                  from public.contracts c where c.room_id = r.id and c.status <> 'da_huy' and c.start_date <= p_to and coalesce(c.end_date, p_to) >= p_from), 0),
                  (p_to - p_from + 1))), 0)::int
  from public.buildings b join public.rooms r on r.building_id = b.id and r.rent_mode = 'thang'
  where fin or public.can_access_building(b.id)
  group by b.id, b.code, b.name order by b.code;
end $$;

create or replace function public.report_profit(p_from date, p_to date) returns table (
  building_id uuid, building_name text, thu numeric, chi numeric, thue_nha numeric, loi_nhuan numeric, tien_coc numeric)
language plpgsql stable security definer set search_path = public as $$
begin
  if not public.is_payer() then raise exception 'Chỉ Quản lý hoặc Kế toán xem báo cáo lợi nhuận'; end if;
  if p_from is null or p_to is null or p_to < p_from then raise exception 'Khoảng ngày không hợp lệ'; end if;
  return query
  with cf as (select * from public.report_cashflow(p_from, p_to, 'toa')),
  rent as (
    select b.id bid, coalesce(sum(
      coalesce((select br.monthly_rent from public.building_rents br where br.building_id = b.id and br.effective_from <= m.ms order by br.effective_from desc limit 1), 0)
      * (least(p_to, (m.ms + interval '1 month')::date - 1) - greatest(p_from, m.ms) + 1)
      / extract(day from ((m.ms + interval '1 month')::date - 1))::numeric), 0) amt
    from public.buildings b
    cross join lateral (select generate_series(date_trunc('month', p_from)::date, p_to, interval '1 month')::date ms) m
    group by b.id
  )
  select b.id, b.code || ' · ' || b.name,
    coalesce(cf.thu, 0), coalesce(cf.chi, 0), round(coalesce(rent.amt, 0), 0),
    coalesce(cf.thu, 0) - coalesce(cf.chi, 0) - round(coalesce(rent.amt, 0), 0), coalesce(cf.tien_coc, 0)
  from public.buildings b left join cf on cf.grp_key = b.id::text left join rent on rent.bid = b.id
  order by b.code;
end $$;

revoke execute on function public.cbill_set(uuid, text), public.expense_save(uuid, uuid, date, text, numeric, text), public.expense_delete(uuid),
  public.rent_save(uuid, date, numeric, text), public.rent_delete(uuid), public.report_cashflow(date, date, text), public.report_occupancy(date, date),
  public.report_profit(date, date) from public, anon;
grant execute on function public.cbill_set(uuid, text), public.expense_save(uuid, uuid, date, text, numeric, text), public.expense_delete(uuid),
  public.rent_save(uuid, date, numeric, text), public.rent_delete(uuid), public.report_cashflow(date, date, text), public.report_occupancy(date, date),
  public.report_profit(date, date) to authenticated;
