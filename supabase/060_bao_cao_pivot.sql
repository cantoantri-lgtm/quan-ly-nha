-- Báo cáo dạng pivot (bấm mở xuống từng cấp): trả số liệu ở mức chi tiết nhất, giao diện tự gom theo
-- Leader sale → Sale → Toà → Phòng (Lấp đầy) hoặc → Người thu (Thu chi). Quyền giống report_occupancy / report_cashflow.

-- Lấp đầy từng phòng thuê tháng
create or replace function public.report_occupancy_rooms(p_from date, p_to date)
returns table (building_id uuid, building_name text, room_id uuid, room_code text, floor int, status text, room_days int, occupied_days int)
language plpgsql stable security definer set search_path = public as $$
declare fin boolean := public.is_payer();
begin
  if not (public.is_lead_up() or fin) then raise exception 'Chỉ Lead Sale, Giám sát, Kế toán, Quản lý xem báo cáo'; end if;
  if p_from is null or p_to is null or p_to < p_from then raise exception 'Khoảng ngày không hợp lệ'; end if;
  return query
  select b.id, b.code || ' · ' || b.name, r.id, r.code, r.floor, r.status::text, (p_to - p_from + 1)::int,
    least(coalesce((select sum(greatest(0, least(coalesce(c.end_date, p_to), p_to) - greatest(c.start_date, p_from) + 1))
                    from public.contracts c where c.room_id = r.id and c.status <> 'da_huy' and c.start_date <= p_to and coalesce(c.end_date, p_to) >= p_from), 0),
          (p_to - p_from + 1))::int
  from public.buildings b join public.rooms r on r.building_id = b.id and r.rent_mode = 'thang'
  where fin or public.can_access_building(b.id)
  order by b.code, r.floor nulls last, r.code;
end $$;

-- Thu chi theo toà × người thu (mỗi khoản đúng một dòng)
create or replace function public.report_cashflow_detail(p_from date, p_to date)
returns table (building_id uuid, building_name text, user_key text, user_name text, tien_phong numeric, phieu_thu numeric, doanh_thu_dem numeric,
               tien_coc numeric, chi numeric, thu numeric, rong numeric)
language plpgsql stable security definer set search_path = public as $$
declare fin boolean := public.is_payer();
begin
  if not (public.is_lead_up() or fin) then raise exception 'Chỉ Lead Sale, Giám sát, Kế toán, Quản lý xem báo cáo'; end if;
  if p_from is null or p_to is null or p_to < p_from then raise exception 'Khoảng ngày không hợp lệ'; end if;
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
  )
  select v.b, coalesce(max(bd.code || ' · ' || bd.name), 'Không gắn toà'),
    coalesce(v.u::text, 'none'), coalesce(max(pr.full_name), 'Chuyển khoản tự động / chưa rõ người'),
    coalesce(sum(v.a) filter (where v.k = 'tp'), 0), coalesce(sum(v.a) filter (where v.k = 'pt'), 0), coalesce(sum(v.a) filter (where v.k = 'dem'), 0),
    coalesce(sum(v.a) filter (where v.k = 'coc'), 0), coalesce(sum(v.a) filter (where v.k = 'chi'), 0),
    coalesce(sum(v.a) filter (where v.k in ('tp','pt','dem')), 0),
    coalesce(sum(v.a) filter (where v.k in ('tp','pt','dem')), 0) - coalesce(sum(v.a) filter (where v.k = 'chi'), 0)
  from v left join public.buildings bd on bd.id = v.b left join public.profiles pr on pr.id = v.u
  group by v.b, v.u;
end $$;

revoke execute on function public.report_occupancy_rooms(date, date), public.report_cashflow_detail(date, date) from public, anon;
grant execute on function public.report_occupancy_rooms(date, date), public.report_cashflow_detail(date, date) to authenticated;
