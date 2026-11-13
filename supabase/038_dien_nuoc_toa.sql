-- Số điện, số nước tổng của từng toà: mỗi tháng Sale trở lên (Nhân viên, Giám sát, Quản lý của toà) phải cập nhật.
-- Ảnh đồng hồ nằm ở dong-ho/<mã toà>/..., bắt buộc có vị trí GPS. Mỗi toà mỗi loại một số cho mỗi tháng; ghi lại trong tháng thì thay số cũ.
create table public.building_meter_readings (
  id uuid primary key default gen_random_uuid(),
  building_id uuid not null references public.buildings(id) on delete cascade,
  kind text not null check (kind in ('dien','nuoc')),
  period date not null check (period = date_trunc('month', period)::date),
  reading numeric(12,1) not null check (reading >= 0),
  photo_path text not null,
  photo_store text not null default 'supabase' check (photo_store in ('supabase','r2')),
  photo_thumb boolean not null default false,
  lat numeric(9,6) not null, lng numeric(9,6) not null, geo_accuracy int, taken_at timestamptz,
  note text,
  created_by uuid references public.profiles(id) on delete set null default auth.uid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (building_id, kind, period)
);
create index on public.building_meter_readings(created_by);
alter table public.building_meter_readings enable row level security;
create policy bmeter_select on public.building_meter_readings for select to authenticated
  using (public.app_role() is not null and public.can_access_building(building_id));
revoke all on public.building_meter_readings from anon, authenticated;
grant select on public.building_meter_readings to authenticated;

-- Tệp dong-ho/<mã>/...: mã là khách (như cũ) hoặc toà (nhân sự của toà đọc/ghi)
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
    return public.is_active_user() and (public.customer_access_ok(o)
      or (public.app_role() is not null and public.can_access_building(o)));
  end if;
  if not p_write and parts[1] in ('anh-toa', 'anh-phong') and public.is_active_user() then return true; end if;
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

create or replace function public.building_meter_save(p_building uuid, p_kind text, p_reading numeric, p_path text, p_store text,
  p_thumb boolean, p_lat numeric, p_lng numeric, p_accuracy int, p_taken_at timestamptz, p_note text) returns uuid
language plpgsql security definer set search_path = public as $$
declare per date := date_trunc('month', (now() at time zone 'Asia/Ho_Chi_Minh'))::date; prev_r numeric; next_r numeric; nid uuid;
begin
  if public.app_role() is null or not public.can_access_building(p_building) then raise exception 'Không có quyền ghi số điện nước của toà này'; end if;
  if p_kind not in ('dien','nuoc') then raise exception 'Loại đồng hồ không hợp lệ'; end if;
  if p_reading is null or p_reading < 0 then raise exception 'Số đồng hồ không hợp lệ'; end if;
  if coalesce(p_path,'') not like 'dong-ho/' || p_building::text || '/%' then raise exception 'Cần chụp ảnh đồng hồ'; end if;
  if p_lat is null or p_lng is null or p_lat not between -90 and 90 or p_lng not between -180 and 180 then
    raise exception 'Ảnh đồng hồ cần kèm vị trí. Hãy bật định vị (GPS) rồi chụp lại';
  end if;
  select reading into prev_r from public.building_meter_readings where building_id = p_building and kind = p_kind and period < per order by period desc limit 1;
  if prev_r is not null and p_reading < prev_r then raise exception 'Số mới (%) nhỏ hơn số tháng trước (%)', p_reading, prev_r; end if;
  select reading into next_r from public.building_meter_readings where building_id = p_building and kind = p_kind and period > per order by period limit 1;
  if next_r is not null and p_reading > next_r then raise exception 'Số mới (%) lớn hơn số tháng sau (%)', p_reading, next_r; end if;
  insert into public.building_meter_readings (building_id, kind, period, reading, photo_path, photo_store, photo_thumb, lat, lng, geo_accuracy, taken_at, note, created_by)
    values (p_building, p_kind, per, p_reading, p_path, coalesce(p_store,'supabase'), coalesce(p_thumb,false), round(p_lat,6), round(p_lng,6), p_accuracy,
            coalesce(p_taken_at, now()), left(nullif(btrim(coalesce(p_note,'')),''), 200), auth.uid())
    on conflict (building_id, kind, period) do update set reading = excluded.reading, photo_path = excluded.photo_path, photo_store = excluded.photo_store,
      photo_thumb = excluded.photo_thumb, lat = excluded.lat, lng = excluded.lng, geo_accuracy = excluded.geo_accuracy, taken_at = excluded.taken_at,
      note = excluded.note, created_by = auth.uid(), updated_at = now()
    returning id into nid;
  return nid;
end $$;
revoke execute on function public.building_meter_save(uuid, text, numeric, text, text, boolean, numeric, numeric, int, timestamptz, text) from public, anon;
grant execute on function public.building_meter_save(uuid, text, numeric, text, text, boolean, numeric, numeric, int, timestamptz, text) to authenticated;

-- Nhắc mỗi sáng (08:30) vào ngày 1, 5, 10 hằng tháng nếu toà còn thiếu số điện hoặc số nước của tháng
create or replace function public.notify_building_meters() returns void
language plpgsql security definer set search_path = public as $$
declare d date := (now() at time zone 'Asia/Ho_Chi_Minh')::date; per date := date_trunc('month', d)::date; b record; u uuid; miss text;
begin
  if extract(day from d) not in (1, 5, 10) then return; end if;
  for b in select * from public.buildings loop
    miss := concat_ws(' và ',
      case when not exists (select 1 from public.building_meter_readings r where r.building_id = b.id and r.kind = 'dien' and r.period = per) then 'số điện' end,
      case when not exists (select 1 from public.building_meter_readings r where r.building_id = b.id and r.kind = 'nuoc' and r.period = per) then 'số nước' end);
    if miss = '' then continue; end if;
    for u in select distinct s.x from (
        select m.user_id as x from public.building_members m join public.profiles p on p.id = m.user_id
          where m.building_id = b.id and p.is_active and p.role in ('nhan_vien','giam_sat')
        union select id from public.profiles where role = 'quan_ly' and is_active) s where s.x is not null loop
      perform public.notify(u, 'khac', 'Cập nhật điện nước toà ' || b.code,
        'Tháng ' || to_char(per, 'MM/YYYY') || ' toà ' || b.code || ' còn thiếu ' || miss || '. Chụp đồng hồ và ghi số.',
        'building_meter', b.id, 'bmeter-' || b.id || '-' || to_char(d, 'YYYYMMDD') || '-' || u);
    end loop;
  end loop;
end $$;
revoke execute on function public.notify_building_meters() from public, anon, authenticated;
select cron.schedule('nhac-dien-nuoc-toa', '30 1 * * *', $$select public.notify_building_meters()$$);
