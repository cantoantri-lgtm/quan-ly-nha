-- =============================================================
-- 005 · VỊ TRÍ TOÀ NHÀ + BẢN ĐỒ
-- - Thêm toạ độ (lat, lng) cho từng toà. Chỉ Quản lý sửa được
--   (dùng lại policy buildings_update có sẵn).
-- - Hàm building_map(): mọi nhân sự đang hoạt động xem được bản đồ
--   TẤT CẢ các toà, nhưng chỉ gồm tên, địa chỉ, vị trí, số phòng
--   và số phòng trống. Giá thuê, chi tiết phòng vẫn theo RLS cũ
--   (Giám sát / Nhân viên chỉ mở được toà mình được gán).
-- =============================================================

alter table public.buildings
  add column if not exists lat double precision,
  add column if not exists lng double precision;

do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'buildings_latlng_chk') then
    alter table public.buildings add constraint buildings_latlng_chk check (
      (lat is null) = (lng is null)
      and (lat is null or (lat between -90 and 90 and lng between -180 and 180))
    );
  end if;
end $$;

comment on column public.buildings.lat is 'Vĩ độ toà nhà (WGS84), Quản lý đặt trên màn hình Bản đồ';
comment on column public.buildings.lng is 'Kinh độ toà nhà (WGS84)';

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
  where public.app_role() is not null          -- chỉ tài khoản đang hoạt động
  group by b.id
  order by b.code
$$;

revoke execute on function public.building_map() from public, anon;
grant execute on function public.building_map() to authenticated;
