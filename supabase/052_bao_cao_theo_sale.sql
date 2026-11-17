-- Báo cáo Thu chi và Lấp đầy: thêm nhóm theo Sale phụ trách toà và Leader sale (17/11/2026).
--  * Sale = nhân viên phòng Kinh doanh (departments.code = 'KD') được gán vào toà (building_members).
--    Kế toán, nhân viên khác phòng được gán toà để làm việc thì không tính là sale.
--  * Leader sale = Trưởng nhóm cùng nhóm của sale đó trong Sơ đồ công ty (report_lead_of).
--  * Toà có nhiều sale: số liệu toà tính đủ cho mỗi sale (cột Cộng trên giao diện lấy theo toà, không cộng trùng).
--    Toà chưa có sale: nhóm "Chưa gán sale". Khoản thu không gắn toà: "Không gắn toà".

-- Bảng toà → sale → leader sale
create or replace function public.report_building_sales()
returns table (building_id uuid, sale_key text, sale_name text, lead_key text, lead_name text)
language sql stable security definer set search_path = public as $$
  select b.id,
    coalesce(s.user_id::text, 'none'), coalesce(p.full_name, 'Chưa gán sale'),
    case when s.user_id is null then 'none' else coalesce(l.lead_key, 'none') end,
    case when s.user_id is null then 'Chưa gán sale' else coalesce(l.lead_name, 'Chưa gán Leader sale') end
  from public.buildings b
  left join lateral (
    select m.user_id from public.building_members m
    join public.org_staff o on o.profile_id = m.user_id
    join public.departments d on d.id = o.department_id and d.code = 'KD'
    join public.profiles pr on pr.id = m.user_id and pr.is_active
    where m.building_id = b.id
  ) s on true
  left join public.profiles p on p.id = s.user_id
  left join lateral (select * from public.report_lead_of(s.user_id)) l on s.user_id is not null
  where public.app_role() is not null
$$;

create or replace function public.report_cashflow(p_from date, p_to date, p_group text)
returns table (grp_key text, grp_name text, tien_phong numeric, phieu_thu numeric, doanh_thu_dem numeric, tien_coc numeric, chi numeric, thu numeric, rong numeric)
language plpgsql stable security definer set search_path = public as $$
declare fin boolean := public.is_payer();
begin
  if not (public.is_lead_up() or fin) then raise exception 'Chỉ Lead Sale, Giám sát, Kế toán, Quản lý xem báo cáo'; end if;
  if p_from is null or p_to is null or p_to < p_from then raise exception 'Khoảng ngày không hợp lệ'; end if;
  if p_group not in ('toa','nhan_vien','lead','sale','lead_sale') then raise exception 'Nhóm báo cáo không hợp lệ'; end if;
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
  ), v as (
    select * from f where fin or f.b is null or public.can_access_building(f.b)
  ), m as (
    select * from public.report_building_sales()
  ), g as (
    -- toà, người thu, lead của người thu: mỗi khoản đúng 1 nhóm
    select v.k, v.a,
      case p_group when 'toa' then coalesce(v.b::text, 'none')
                   when 'nhan_vien' then coalesce(v.u::text, 'none')
                   else coalesce((select lead_key from public.report_lead_of(v.u)), 'none') end gk,
      case p_group when 'toa' then coalesce((select bd.code || ' · ' || bd.name from public.buildings bd where bd.id = v.b), 'Không gắn toà')
                   when 'nhan_vien' then coalesce((select pr.full_name from public.profiles pr where pr.id = v.u), 'Chuyển khoản tự động / chưa rõ người')
                   else coalesce((select lead_name from public.report_lead_of(v.u)), 'Chưa gán lead') end gn
    from v where p_group in ('toa','nhan_vien','lead')
    union all
    -- sale phụ trách toà: toà nhiều sale thì tính cho mỗi sale
    select v.k, v.a, x.sale_key, x.sale_name
    from v join (select distinct m.building_id, m.sale_key, m.sale_name from m) x on x.building_id = v.b
    where p_group = 'sale'
    union all
    select v.k, v.a, x.lead_key, x.lead_name
    from v join (select distinct m.building_id, m.lead_key, m.lead_name from m) x on x.building_id = v.b
    where p_group = 'lead_sale'
    union all
    select v.k, v.a, 'khong_toa', 'Không gắn toà' from v where p_group in ('sale','lead_sale') and v.b is null
  )
  select g.gk, max(g.gn),
    coalesce(sum(g.a) filter (where g.k = 'tp'), 0), coalesce(sum(g.a) filter (where g.k = 'pt'), 0), coalesce(sum(g.a) filter (where g.k = 'dem'), 0),
    coalesce(sum(g.a) filter (where g.k = 'coc'), 0), coalesce(sum(g.a) filter (where g.k = 'chi'), 0),
    coalesce(sum(g.a) filter (where g.k in ('tp','pt','dem')), 0),
    coalesce(sum(g.a) filter (where g.k in ('tp','pt','dem')), 0) - coalesce(sum(g.a) filter (where g.k = 'chi'), 0)
  from g group by g.gk order by 9 desc;
end $$;

-- Lấp đầy nhóm theo toà / sale / leader sale
create or replace function public.report_occupancy_group(p_from date, p_to date, p_group text)
returns table (grp_key text, grp_name text, buildings integer, rooms integer, dang_o integer, trong integer, dang_sua integer, giu_cho integer, room_days integer, occupied_days integer)
language plpgsql stable security definer set search_path = public as $$
declare fin boolean := public.is_payer();
begin
  if not (public.is_lead_up() or fin) then raise exception 'Chỉ Lead Sale, Giám sát, Kế toán, Quản lý xem báo cáo'; end if;
  if p_from is null or p_to is null or p_to < p_from then raise exception 'Khoảng ngày không hợp lệ'; end if;
  if p_group not in ('toa','sale','lead_sale') then raise exception 'Nhóm báo cáo không hợp lệ'; end if;
  return query
  with o as (select * from public.report_occupancy(p_from, p_to)),
  m as (select * from public.report_building_sales()),
  x as (
    select o.*, o.building_id::text gk, o.building_name gn from o where p_group = 'toa'
    union all
    select o.*, s.sale_key, s.sale_name from o join (select distinct m.building_id, m.sale_key, m.sale_name from m) s on s.building_id = o.building_id where p_group = 'sale'
    union all
    select o.*, s.lead_key, s.lead_name from o join (select distinct m.building_id, m.lead_key, m.lead_name from m) s on s.building_id = o.building_id where p_group = 'lead_sale'
  )
  select x.gk, max(x.gn), count(distinct x.building_id)::int, sum(x.rooms)::int, sum(x.dang_o)::int, sum(x.trong)::int, sum(x.dang_sua)::int, sum(x.giu_cho)::int,
    sum(x.room_days)::int, sum(x.occupied_days)::int
  from x group by x.gk order by case when x.gk in ('none') then 1 else 0 end, max(x.gn);
end $$;

revoke execute on function public.report_building_sales(), public.report_cashflow(date, date, text), public.report_occupancy_group(date, date, text) from public, anon;
grant execute on function public.report_building_sales(), public.report_cashflow(date, date, text), public.report_occupancy_group(date, date, text) to authenticated;
