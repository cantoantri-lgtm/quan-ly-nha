-- Ảnh đại diện toà nhà: hiện trong khung thông tin ghim trên bản đồ (kể cả Cộng tác viên) và danh sách toà.
-- Tải lên / xoá / đặt ảnh đại diện: Quản lý và Giám sát của toà (can_manage_building).
-- Ảnh nằm ở thư mục công khai anh-toa/<mã toà>/ trên R2 (giống ảnh phòng: ai có link mới xem được, link không đoán được).

alter table public.files drop constraint files_shape;
alter table public.files add constraint files_shape check (case kind
  when 'cccd'           then tenant_id is not null
  when 'hop_dong'       then contract_id is not null
  when 'anh_phong'      then room_id is not null
  when 'anh_loai_phong' then room_type_id is not null
  when 'anh_toa'        then building_id is not null
  else request_id is not null end);
alter table public.files drop constraint files_path_kind;
alter table public.files add constraint files_path_kind check (path like (case kind
  when 'cccd' then 'cccd/' when 'hop_dong' then 'hop-dong/'
  when 'anh_phong' then 'anh-phong/' when 'anh_loai_phong' then 'anh-phong/'
  when 'anh_toa' then 'anh-toa/' else 'de-nghi/' end) || '%');
create unique index files_one_cover_per_building on public.files(building_id) where is_cover and kind = 'anh_toa';

create or replace function public.tg_files_before() returns trigger
language plpgsql security definer set search_path = public as $$
declare owner uuid := (string_to_array(new.path, '/'))[2]::uuid; b uuid; consent timestamptz;
begin
  if tg_op = 'UPDATE' then
    if auth.uid() is not null
       and to_jsonb(new) - 'is_cover' - 'label' is distinct from to_jsonb(old) - 'is_cover' - 'label' then
      raise exception 'Chỉ được đổi nhãn hoặc ảnh đại diện của tệp';
    end if;
    return new;
  end if;
  if new.kind = 'cccd' then
    select building_id, cccd_consent_at into b, consent from public.tenants where id = new.tenant_id;
    if consent is null then raise exception 'Cần ghi nhận khách đã đồng ý cho lưu ảnh CCCD trước khi tải ảnh lên'; end if;
  elsif new.kind = 'hop_dong' then
    select building_id into b from public.contracts where id = new.contract_id;
  elsif new.kind = 'anh_phong' then
    select building_id into b from public.rooms where id = new.room_id;
  elsif new.kind = 'anh_loai_phong' then
    select building_id into b from public.room_types where id = new.room_type_id;
  elsif new.kind = 'anh_toa' then
    select id into b from public.buildings where id = new.building_id;
  else
    select building_id into b from public.requests where id = new.request_id;
    if owner is distinct from new.request_id then raise exception 'Đường dẫn tệp không khớp đề nghị'; end if;
    new.building_id := b;
    return new;
  end if;
  if b is null or owner is distinct from b then raise exception 'Đường dẫn tệp không khớp toà'; end if;
  new.building_id := b;
  return new;
end $$;
revoke execute on function public.tg_files_before() from public, anon, authenticated;

-- Quyền theo đường dẫn: anh-toa/ chỉ Quản lý / Giám sát toà được ghi; đọc: mọi người có quyền vào toà
create or replace function public.storage_path_ok(p_name text, p_write boolean) returns boolean
language plpgsql stable security definer set search_path = public as $$
declare
  parts text[] := string_to_array(coalesce(p_name, ''), '/');
  o uuid;
begin
  if public.app_role() is null or array_length(parts, 1) < 3 then return false; end if;
  begin o := parts[2]::uuid; exception when others then return false; end;
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

-- Bản đồ: thêm ảnh đại diện (chỉ đường dẫn ảnh, không thêm thông tin nội bộ)
drop function if exists public.building_map();
create or replace function public.building_map()
returns table (
  id uuid, code text, name text, address text, kind public.building_kind,
  lat double precision, lng double precision,
  total_rooms int, vacant_rooms int, can_open boolean,
  photo_path text, photo_store text, photo_thumb boolean
)
language sql stable security definer set search_path = public as $$
  select b.id, b.code, b.name, b.address, b.kind, b.lat, b.lng,
         count(r.id)::int,
         (count(r.id) filter (where r.status = 'trong'))::int,
         public.can_access_building(b.id),
         p.path, p.store, p.thumb
  from public.buildings b
  left join public.rooms r on r.building_id = b.id
  left join lateral (
    select f.path, f.store, f.thumb from public.files f
    where f.kind = 'anh_toa' and f.building_id = b.id and f.mime_type like 'image/%'
    order by f.is_cover desc, f.created_at limit 1
  ) p on true
  where public.is_active_user()
  group by b.id, p.path, p.store, p.thumb
  order by b.code
$$;
revoke execute on function public.building_map() from public, anon;
grant execute on function public.building_map() to authenticated;
