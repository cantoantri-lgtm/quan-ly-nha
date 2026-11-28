-- 114: Ảnh đồng hồ điện khi ghi số điện từng phòng (khung chi tiết phòng).
-- Ảnh nằm ở dong-ho/<mã toà>/... (storage_path_ok đã cho nhân sự của toà đọc/ghi), có vị trí GPS và giờ chụp.
-- Ảnh không bắt buộc: bảng ghi điện cả toà vẫn ghi số không ảnh. Ghi lại số mà không chụp mới thì giữ ảnh cũ.

alter table public.room_elec_readings
  add column if not exists photo_path text,
  add column if not exists photo_store text check (photo_store in ('r2', 'supabase')),
  add column if not exists photo_thumb boolean not null default false,
  add column if not exists lat double precision,
  add column if not exists lng double precision,
  add column if not exists geo_accuracy double precision,
  add column if not exists taken_at timestamptz;

drop function if exists public.room_elec_save(uuid, date, numeric, numeric, text);
create function public.room_elec_save(
  p_room uuid, p_period date, p_start numeric, p_end numeric, p_note text default null,
  p_path text default null, p_store text default null, p_thumb boolean default false,
  p_lat double precision default null, p_lng double precision default null, p_accuracy double precision default null,
  p_taken_at timestamptz default null)
returns uuid language plpgsql security definer set search_path = public as $$
declare prev numeric; rm public.rooms; per date := date_trunc('month', p_period)::date; rid uuid;
begin
  select * into rm from public.rooms where id = p_room;
  if not found then raise exception 'Không tìm thấy phòng'; end if;
  if not public.can_edit_building(rm.building_id) then raise exception 'Chỉ sale phụ trách toà, Giám sát hoặc Quản lý ghi số điện phòng'; end if;
  if p_start is null or p_end is null or p_start < 0 then raise exception 'Nhập số đầu kỳ và số cuối kỳ'; end if;
  if p_path is not null then
    if p_path not like 'dong-ho/' || rm.building_id::text || '/%' then raise exception 'Ảnh đồng hồ không thuộc toà này'; end if;
    if coalesce(p_store, '') not in ('r2', 'supabase') then raise exception 'Kho ảnh không hợp lệ'; end if;
  end if;
  select x.end_reading into prev from public.room_elec_readings x where x.room_id = p_room and x.period < per order by x.period desc limit 1;
  if prev is not null and p_start is distinct from prev and not public.can_manage_building(rm.building_id) then
    raise exception 'Phòng %: số đầu kỳ phải bằng số cuối tháng trước (%). Thay đồng hồ thì báo Giám sát hoặc Quản lý sửa.', rm.code, prev;
  end if;
  if p_end < p_start then raise exception 'Phòng %: số mới (%) nhỏ hơn số cũ (%)', rm.code, p_end, p_start; end if;
  if per > date_trunc('month', (now() at time zone 'Asia/Ho_Chi_Minh'))::date then raise exception 'Chưa tới tháng này'; end if;
  insert into public.room_elec_readings (room_id, building_id, period, start_reading, end_reading, note, created_by, updated_by,
    photo_path, photo_store, photo_thumb, lat, lng, geo_accuracy, taken_at)
  values (p_room, rm.building_id, per, p_start, p_end, nullif(btrim(coalesce(p_note, '')), ''), auth.uid(), auth.uid(),
    p_path, case when p_path is null then null else p_store end, coalesce(p_path is not null and p_thumb, false),
    case when p_path is null then null else p_lat end, case when p_path is null then null else p_lng end,
    case when p_path is null then null else p_accuracy end, case when p_path is null then null else coalesce(p_taken_at, now()) end)
  on conflict (room_id, period) do update set start_reading = excluded.start_reading, end_reading = excluded.end_reading,
    note = excluded.note, updated_by = auth.uid(), updated_at = now(),
    photo_path   = coalesce(excluded.photo_path, room_elec_readings.photo_path),
    photo_store  = case when excluded.photo_path is null then room_elec_readings.photo_store else excluded.photo_store end,
    photo_thumb  = case when excluded.photo_path is null then room_elec_readings.photo_thumb else excluded.photo_thumb end,
    lat          = case when excluded.photo_path is null then room_elec_readings.lat else excluded.lat end,
    lng          = case when excluded.photo_path is null then room_elec_readings.lng else excluded.lng end,
    geo_accuracy = case when excluded.photo_path is null then room_elec_readings.geo_accuracy else excluded.geo_accuracy end,
    taken_at     = case when excluded.photo_path is null then room_elec_readings.taken_at else excluded.taken_at end
  returning id into rid;
  return rid;
end $$;
revoke all on function public.room_elec_save(uuid, date, numeric, numeric, text, text, text, boolean, double precision, double precision, double precision, timestamptz) from public, anon;
grant execute on function public.room_elec_save(uuid, date, numeric, numeric, text, text, text, boolean, double precision, double precision, double precision, timestamptz) to authenticated;
