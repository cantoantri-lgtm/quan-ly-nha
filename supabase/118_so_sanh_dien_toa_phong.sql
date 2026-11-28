-- 118: So sánh điện đồng hồ tổng toà với tổng điện các phòng theo kỳ; dữ liệu điện cho trợ lý báo cáo AI.
-- Kỳ ghi điện: tháng P ghi từ ngày 28 đến cuối tháng P. kWh toà kỳ P = số đồng hồ tổng kỳ P − số kỳ trước đó.
-- Chênh lệch = kWh toà − tổng kWh các phòng (điện khu chung, phòng trống, hao hụt hoặc phòng chưa ghi).

create or replace function public.meter_period_vn(p_day date default null) returns date
language sql stable set search_path = public as $$
  select case when extract(day from d) >= 28 then date_trunc('month', d)::date
              else (date_trunc('month', d) - interval '1 month')::date end
  from (select coalesce(p_day, (now() at time zone 'Asia/Ho_Chi_Minh')::date) d) x
$$;

-- Bảng so sánh của một toà, p_months kỳ gần nhất (tính từ kỳ ghi điện hiện tại lùi về)
create or replace function public.elec_compare(p_building uuid, p_months int default 6)
returns table(period date, building_reading numeric, building_prev numeric, building_kwh numeric,
  rooms_kwh numeric, rooms_recorded int, rooms_to_record int, rooms_missing int, diff_kwh numeric, diff_pct numeric, complete boolean)
language sql stable security definer set search_path = public as $$
  with per as (
    select (public.meter_period_vn() - make_interval(months => g))::date p
    from generate_series(0, greatest(1, least(coalesce(p_months, 6), 24)) - 1) g
  ),
  bm as (
    select per.p,
      (select m.reading from public.building_meter_readings m where m.building_id = p_building and m.kind = 'dien' and m.period = per.p) cur,
      (select m.reading from public.building_meter_readings m where m.building_id = p_building and m.kind = 'dien' and m.period < per.p order by m.period desc limit 1) prv
    from per
  ),
  rr as (
    select per.p, count(e.id)::int n, sum(e.end_reading - e.start_reading) kwh
    from per left join public.room_elec_readings e on e.building_id = p_building and e.period = per.p
    group by per.p
  ),
  -- Phòng cần ghi: phòng thuê tháng có hợp đồng hiệu lực trong kỳ (bắt đầu trước cuối kỳ, chưa kết thúc trước đầu kỳ)
  need as (
    select per.p, count(distinct c.room_id)::int n,
      count(distinct c.room_id) filter (where not exists (select 1 from public.room_elec_readings e where e.room_id = c.room_id and e.period = per.p))::int miss
    from per left join public.contracts c on c.building_id = p_building and c.status in ('hieu_luc', 'da_ket_thuc')
      and c.start_date <= (per.p + interval '1 month' - interval '1 day')::date
      and (c.status = 'hieu_luc' or coalesce(c.end_date, per.p) >= per.p)
      and exists (select 1 from public.rooms r where r.id = c.room_id and r.rent_mode = 'thang')
    group by per.p
  )
  select bm.p, bm.cur, bm.prv, bm.cur - bm.prv, coalesce(rr.kwh, 0), rr.n, need.n, need.miss,
    case when bm.cur is not null and bm.prv is not null then bm.cur - bm.prv - coalesce(rr.kwh, 0) end,
    case when bm.cur is not null and bm.prv is not null and bm.cur - bm.prv > 0
         then round((bm.cur - bm.prv - coalesce(rr.kwh, 0)) * 100 / (bm.cur - bm.prv), 1) end,
    bm.cur is not null and bm.prv is not null and need.miss = 0
  from bm join rr on rr.p = bm.p join need on need.p = bm.p
  where public.can_access_building(p_building) or coalesce(auth.role(), '') = 'service_role'
  order by bm.p desc
$$;
revoke all on function public.elec_compare(uuid, int) from public, anon;
grant execute on function public.elec_compare(uuid, int) to authenticated;

-- Dữ liệu "Điện các phòng & toà" cho trợ lý AI: chỉ mã phòng, số kWh, trạng thái ghi. Không có tên khách.
create or replace function public.ai_electricity(p_building text default null)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare ids uuid[]; cur date := public.meter_period_vn(); prv date := (public.meter_period_vn() - interval '1 month')::date;
begin
  perform public.ai_guard();
  ids := public.ai_building_ids(p_building);
  return jsonb_build_object(
    'as_of', public.ai_today(),
    'current_period', to_char(cur, 'MM/YYYY'),
    'note', 'Kỳ ghi điện tháng P: ghi đồng hồ từ ngày 28 đến cuối tháng P, tính vào hoá đơn ngày 1 tháng sau. '
            || 'rooms_not_recorded: phòng đang có hợp đồng thuê tháng nhưng chưa ghi số kỳ này. '
            || 'compare: building_kwh = điện đồng hồ tổng toà trong kỳ; rooms_kwh = tổng điện các phòng đã ghi; diff_kwh = chênh lệch (khu chung, phòng trống, hao hụt); '
            || 'complete = đã có số đồng hồ tổng 2 kỳ liên tiếp và đã ghi đủ các phòng có hợp đồng. building_kwh null = chưa ghi đồng hồ tổng điện của toà.',
    'buildings', (select coalesce(jsonb_agg(x order by x->>'code'), '[]'::jsonb) from (
      select jsonb_build_object(
        'code', b.code, 'kind', b.kind,
        'elec_price', public.building_unit_price(b.id, 'dien'),
        'rooms_to_record', (select count(distinct c.room_id) from public.contracts c join public.rooms r on r.id = c.room_id
                             where c.building_id = b.id and c.status = 'hieu_luc' and r.rent_mode = 'thang'),
        'rooms_recorded', (select count(*) from public.room_elec_readings e where e.building_id = b.id and e.period = cur),
        'rooms_recorded_with_photo', (select count(*) from public.room_elec_readings e where e.building_id = b.id and e.period = cur and e.photo_path is not null),
        'rooms_not_recorded', (select coalesce(jsonb_agg(r.code order by r.floor nulls last, r.code), '[]'::jsonb)
                                from public.contracts c join public.rooms r on r.id = c.room_id
                               where c.building_id = b.id and c.status = 'hieu_luc' and r.rent_mode = 'thang'
                                 and not exists (select 1 from public.room_elec_readings e where e.room_id = r.id and e.period = cur)),
        'room_kwh', (select coalesce(jsonb_agg(jsonb_build_object('room', r.code,
                        'kwh_this', (select e.end_reading - e.start_reading from public.room_elec_readings e where e.room_id = r.id and e.period = cur),
                        'kwh_prev', (select e.end_reading - e.start_reading from public.room_elec_readings e where e.room_id = r.id and e.period = prv))
                      order by r.floor nulls last, r.code), '[]'::jsonb)
                      from public.rooms r where r.building_id = b.id and r.rent_mode = 'thang'
                       and exists (select 1 from public.room_elec_readings e where e.room_id = r.id and e.period in (cur, prv))),
        'compare', (select coalesce(jsonb_agg(jsonb_build_object('period', to_char(x.period, 'MM/YYYY'),
                        'building_kwh', x.building_kwh, 'rooms_kwh', x.rooms_kwh, 'rooms_recorded', x.rooms_recorded,
                        'rooms_to_record', x.rooms_to_record, 'diff_kwh', x.diff_kwh, 'diff_pct', x.diff_pct, 'complete', x.complete)
                      order by x.period desc), '[]'::jsonb)
                    from public.elec_compare(b.id, 6) x)
      ) x
      from public.buildings b where b.id = any(ids)) s)
  );
end $$;
revoke all on function public.ai_electricity(text) from public, anon;
grant execute on function public.ai_electricity(text) to authenticated, service_role;
