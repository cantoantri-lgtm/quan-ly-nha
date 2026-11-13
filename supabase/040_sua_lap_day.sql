-- Sửa report_occupancy: phòng không có hợp đồng bị tính lấp đầy 100% (least() bỏ qua NULL). Dùng coalesce(...,0) trước khi so với số ngày.
create or replace function public.report_occupancy(p_from date, p_to date) returns table (
  building_id uuid, building_name text, rooms int, dang_o int, trong int, dang_sua int, giu_cho int, room_days int, occupied_days int)
language plpgsql stable security definer set search_path = public as $$
begin
  if not public.is_lead_up() then raise exception 'Chỉ Lead Sale, Giám sát, Quản lý xem báo cáo'; end if;
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
  where public.can_access_building(b.id)
  group by b.id, b.code, b.name order by b.code;
end $$;
revoke execute on function public.report_occupancy(date, date) from public, anon;
grant execute on function public.report_occupancy(date, date) to authenticated;
