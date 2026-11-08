-- =====================================================================
-- Neo Nestly · LOẠI PHÒNG  (chạy sau 012, sau 013a)
--   Mỗi toà có nhiều "loại phòng": cùng diện tích, nội thất, ảnh, giá. Phòng chọn loại thì thấy thông tin của loại đó.
--   Giữ cột rooms.room_type (chữ) để các màn hình cũ vẫn chạy; trigger tự điền tên loại vào đó.
-- =====================================================================

create table public.room_types (
  id            uuid primary key default gen_random_uuid(),
  building_id   uuid not null references public.buildings(id) on delete cascade,
  name          text not null check (length(btrim(name)) > 0),
  area_m2       numeric(6,1) check (area_m2 is null or area_m2 > 0),
  furniture     text,                                   -- nội thất, mỗi dòng một món
  description   text,
  rent_mode     public.rent_mode not null default 'thang',
  list_price    numeric(14,0) check (list_price is null or list_price >= 0),
  max_occupants int check (max_occupants is null or max_occupants > 0),
  sort          int not null default 0,
  created_at    timestamptz not null default now(),
  unique (building_id, name)
);
create index on public.room_types(building_id);

alter table public.rooms add column room_type_id uuid references public.room_types(id) on delete set null;
create index on public.rooms(room_type_id) where room_type_id is not null;

-- Phòng thuộc loại nào thì loại đó phải cùng toà; tên loại được chép vào rooms.room_type
create or replace function public.tg_rooms_type() returns trigger
language plpgsql security definer set search_path = public as $$
declare t public.room_types;
begin
  if new.room_type_id is not null then
    select * into t from public.room_types where id = new.room_type_id;
    if t.id is null or t.building_id <> new.building_id then raise exception 'Loại phòng không thuộc toà này'; end if;
    new.room_type := t.name;
  end if;
  return new;
end $$;
create trigger rooms_type before insert or update of room_type_id, room_type, building_id on public.rooms
  for each row execute function public.tg_rooms_type();
revoke execute on function public.tg_rooms_type() from public, anon, authenticated;

-- Đổi tên loại → cập nhật tên hiển thị trên các phòng
create or replace function public.tg_room_types_rename() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.name is distinct from old.name then
    update public.rooms set room_type = new.name where room_type_id = new.id;
  end if;
  return new;
end $$;
create trigger room_types_rename after update of name on public.room_types
  for each row execute function public.tg_room_types_rename();
revoke execute on function public.tg_room_types_rename() from public, anon, authenticated;

-- Quyền: thành viên toà xem; quản lý / giám sát toà thêm, sửa, xoá (giống phòng)
alter table public.room_types enable row level security;
create policy rt_select on public.room_types for select to authenticated using (public.can_access_building(building_id));
create policy rt_insert on public.room_types for insert to authenticated with check (public.can_manage_building(building_id));
create policy rt_update on public.room_types for update to authenticated
  using (public.can_manage_building(building_id)) with check (public.can_manage_building(building_id));
create policy rt_delete on public.room_types for delete to authenticated using (public.can_manage_building(building_id));
revoke all on public.room_types from anon;
grant select, insert, update, delete on public.room_types to authenticated;

-- ---------- Ảnh loại phòng (dùng chung kho ảnh, thư mục anh-phong/<toà>/) ----------
alter table public.files add column room_type_id uuid references public.room_types(id) on delete cascade;
create index on public.files(room_type_id) where room_type_id is not null;
create unique index files_one_cover_per_room_type on public.files(room_type_id) where is_cover and room_type_id is not null;

alter table public.files drop constraint files_shape;
alter table public.files add constraint files_shape check (case kind
  when 'cccd'           then tenant_id is not null
  when 'hop_dong'       then contract_id is not null
  when 'anh_phong'      then room_id is not null
  when 'anh_loai_phong' then room_type_id is not null
  else request_id is not null end);
alter table public.files drop constraint files_path_kind;
alter table public.files add constraint files_path_kind check (path like (case kind
  when 'cccd' then 'cccd/' when 'hop_dong' then 'hop-dong/'
  when 'anh_phong' then 'anh-phong/' when 'anh_loai_phong' then 'anh-phong/' else 'de-nghi/' end) || '%');

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

-- ---------- Chuyển các tên loại đang gõ tay thành loại phòng ----------
insert into public.room_types(building_id, name, rent_mode, list_price, max_occupants)
select building_id, btrim(room_type),
       mode() within group (order by rent_mode),
       mode() within group (order by list_price),
       mode() within group (order by max_occupants)
from public.rooms
where room_type is not null and btrim(room_type) <> ''
group by building_id, btrim(room_type)
on conflict (building_id, name) do nothing;

update public.rooms r set room_type_id = t.id
from public.room_types t
where t.building_id = r.building_id and t.name = btrim(r.room_type) and r.room_type_id is null;
