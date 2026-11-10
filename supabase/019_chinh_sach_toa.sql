-- Chính sách theo toà: phí dịch vụ, tiện ích, cọc / kỳ hợp đồng, hoa hồng Cộng tác viên.
-- Mọi người dùng đang hoạt động (kể cả Cộng tác viên) đọc qua building_policies(); chỉ Quản lý ghi (RLS).
-- Thêm nội thất riêng cho từng phòng (rooms.furniture, bỏ trống = theo nhóm phòng).
-- Khoá cột phòng ở CSDL: người không quản lý toà chỉ đổi được trạng thái và ghi chú.

alter table public.rooms add column if not exists furniture text;

create table if not exists public.building_policy (
  building_id      uuid primary key references public.buildings(id) on delete cascade,
  fees             jsonb not null default '[]' check (jsonb_typeof(fees) = 'array'),              -- [{label, amount, unit}]
  amenities        text[] not null default '{}',
  deposit_lines    text[] not null default '{}',
  commission_terms jsonb not null default '[]' check (jsonb_typeof(commission_terms) = 'array'),  -- [{months, pct}]
  forfeit_min      numeric check (forfeit_min is null or forfeit_min >= 0),   -- bỏ cọc: từ mức này mới chi hoa hồng
  forfeit_pct      numeric check (forfeit_pct is null or (forfeit_pct >= 0 and forfeit_pct <= 100)),
  note             text,
  updated_at       timestamptz not null default now(),
  updated_by       uuid references auth.users(id) on delete set null
);
alter table public.building_policy enable row level security;
create policy bp_select on public.building_policy for select to authenticated using (public.can_access_building(building_id));
create policy bp_insert on public.building_policy for insert to authenticated with check (public.is_manager());
create policy bp_update on public.building_policy for update to authenticated using (public.is_manager()) with check (public.is_manager());
create policy bp_delete on public.building_policy for delete to authenticated using (public.is_manager());

create or replace function public.tg_building_policy_stamp() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  new.updated_at := now();
  new.updated_by := auth.uid();
  return new;
end $$;
revoke execute on function public.tg_building_policy_stamp() from public, anon, authenticated;
create trigger building_policy_stamp before insert or update on public.building_policy
  for each row execute function public.tg_building_policy_stamp();

-- Mọi người dùng đang hoạt động đọc được (Cộng tác viên không có quyền vào toà nên đi qua hàm này)
create or replace function public.building_policies()
returns table (
  building_id uuid, code text, name text, address text,
  fees jsonb, amenities text[], deposit_lines text[], commission_terms jsonb,
  forfeit_min numeric, forfeit_pct numeric, note text, updated_at timestamptz
)
language sql stable security definer set search_path = public as $$
  select b.id, b.code, b.name, b.address,
         coalesce(p.fees, '[]'::jsonb), coalesce(p.amenities, '{}'), coalesce(p.deposit_lines, '{}'),
         coalesce(p.commission_terms, '[]'::jsonb), p.forfeit_min, p.forfeit_pct, p.note, p.updated_at
  from public.buildings b
  left join public.building_policy p on p.building_id = b.id
  where public.is_active_user()
  order by b.code
$$;
revoke execute on function public.building_policies() from public, anon;
grant execute on function public.building_policies() to authenticated;

-- Phòng trống cho Cộng tác viên: nội thất riêng của phòng (nếu có) đè nội thất của nhóm
create or replace function public.vacant_rooms()
returns table(room_id uuid, building_id uuid, building_code text, building_name text, code text, floor integer,
              type_id uuid, type_name text, area_m2 numeric, furniture text, description text, rent_mode rent_mode,
              list_price numeric, max_occupants integer, cover_path text, cover_store text, cover_thumb boolean)
language sql stable security definer set search_path = public as $$
  select r.id, r.building_id, b.code, b.name, r.code, r.floor,
         t.id, coalesce(t.name, r.room_type), t.area_m2, coalesce(nullif(btrim(r.furniture), ''), t.furniture), t.description,
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

-- Người không quản lý toà chỉ đổi trạng thái và ghi chú của phòng (trước đây chỉ giao diện chặn)
create or replace function public.tg_rooms_guard() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is not null and not public.can_manage_building(old.building_id)
     and (to_jsonb(new) - 'status' - 'note') is distinct from (to_jsonb(old) - 'status' - 'note') then
    raise exception 'Chỉ Quản lý hoặc Giám sát toà được sửa thông tin phòng. Bạn chỉ đổi được trạng thái và ghi chú.';
  end if;
  return new;
end $$;
revoke execute on function public.tg_rooms_guard() from public, anon, authenticated;
drop trigger if exists rooms_guard on public.rooms;
create trigger rooms_guard before update on public.rooms for each row execute function public.tg_rooms_guard();
