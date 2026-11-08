-- =====================================================================
-- Neo Nestly · CỘNG TÁC VIÊN  (chạy sau 013, sau 014a)
--   Cộng tác viên chỉ xem bản đồ và phòng trống của các toà. Thiết kế "chặn mặc định":
--   app_role() trả NULL cho Cộng tác viên nên MỌI chính sách và hàm cũ (đang dùng app_role() / can_access_building ...)
--   đều coi họ như người ngoài. Chỉ có hai đường mở riêng: building_map() và vacant_rooms().
-- =====================================================================

create or replace function public.app_role() returns public.user_role
language sql stable security definer set search_path = public as $$
  select role from public.profiles where id = auth.uid() and is_active and role <> 'cong_tac_vien'
$$;

-- Tài khoản đang hoạt động, kể cả Cộng tác viên
create or replace function public.is_active_user() returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.profiles where id = auth.uid() and is_active)
$$;
revoke execute on function public.is_active_user() from public, anon;
grant execute on function public.is_active_user() to authenticated;

create or replace function public.role_rank(r public.user_role) returns int
language sql immutable set search_path = public as $$
  select case r when 'quan_ly' then 3 when 'giam_sat' then 2 when 'cong_tac_vien' then 0 else 1 end
$$;

-- Ai cũng đọc được hồ sơ của chính mình (Cộng tác viên cần để đăng nhập); danh bạ vẫn chỉ cho nhân sự
drop policy if exists profiles_select on public.profiles;
create policy profiles_select on public.profiles for select to authenticated
  using (public.app_role() is not null or id = (select auth.uid()));

-- Không giao việc cho Cộng tác viên
create or replace function public.tg_tasks_no_collab() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.assignee_id is not null
     and exists (select 1 from public.profiles where id = new.assignee_id and role = 'cong_tac_vien') then
    raise exception 'Không giao việc cho Cộng tác viên';
  end if;
  return new;
end $$;
create trigger tasks_no_collab before insert or update of assignee_id on public.tasks
  for each row execute function public.tg_tasks_no_collab();
revoke execute on function public.tg_tasks_no_collab() from public, anon, authenticated;

-- Bản đồ: mọi tài khoản đang hoạt động (cả Cộng tác viên). Chỉ tên, địa chỉ, vị trí, số phòng, số phòng trống.
create or replace function public.building_map()
returns table (
  id uuid, code text, name text, address text, kind public.building_kind,
  lat double precision, lng double precision,
  total_rooms int, vacant_rooms int, can_open boolean
)
language sql stable security definer set search_path = public as $$
  select b.id, b.code, b.name, b.address, b.kind, b.lat, b.lng,
         count(r.id)::int,
         (count(r.id) filter (where r.status = 'trong'))::int,
         public.can_access_building(b.id)
  from public.buildings b
  left join public.rooms r on r.building_id = b.id
  where public.is_active_user()
  group by b.id
  order by b.code
$$;
revoke execute on function public.building_map() from public, anon;
grant execute on function public.building_map() to authenticated;

-- Phòng trống của mọi toà, kèm thông tin loại phòng và ảnh đại diện của loại.
-- Không có khách, hợp đồng, ghi chú nội bộ.
create or replace function public.vacant_rooms()
returns table (
  room_id uuid, building_id uuid, building_code text, building_name text, code text, floor int,
  type_id uuid, type_name text, area_m2 numeric, furniture text, description text,
  rent_mode public.rent_mode, list_price numeric, max_occupants int,
  cover_path text, cover_store text, cover_thumb boolean
)
language sql stable security definer set search_path = public as $$
  select r.id, r.building_id, b.code, b.name, r.code, r.floor,
         t.id, coalesce(t.name, r.room_type), t.area_m2, t.furniture, t.description,
         r.rent_mode, r.list_price, coalesce(r.max_occupants, t.max_occupants),
         c.path, c.store, c.thumb
  from public.rooms r
  join public.buildings b on b.id = r.building_id
  left join public.room_types t on t.id = r.room_type_id
  left join lateral (
    select f.path, f.store, f.thumb from public.files f
    where f.kind = 'anh_loai_phong' and f.room_type_id = t.id and f.mime_type like 'image/%'
    order by f.is_cover desc, f.created_at limit 1
  ) c on true
  where r.status = 'trong' and public.is_active_user()
  order by b.code, r.floor nulls last, r.code
$$;
revoke execute on function public.vacant_rooms() from public, anon;
grant execute on function public.vacant_rooms() to authenticated;
