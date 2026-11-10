-- Ghi chú công khai của toà (hiện ở danh sách Phòng trống cho Cộng tác viên và khách). Chỉ Quản lý sửa (RLS buildings).
alter table public.buildings add column if not exists public_note text;
alter table public.buildings drop constraint if exists buildings_public_note_len;
alter table public.buildings add constraint buildings_public_note_len check (public_note is null or char_length(public_note) <= 200);

drop function if exists public.vacant_rooms();
create or replace function public.vacant_rooms()
returns table(room_id uuid, building_id uuid, building_code text, building_name text, building_note text, code text, floor integer,
              type_id uuid, type_name text, area_m2 numeric, furniture text, description text, rent_mode rent_mode,
              list_price numeric, max_occupants integer, cover_path text, cover_store text, cover_thumb boolean)
language sql stable security definer set search_path = public as $$
  select r.id, r.building_id, b.code, b.name, nullif(btrim(b.public_note), ''), r.code, r.floor,
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
revoke execute on function public.vacant_rooms() from public, anon;
grant execute on function public.vacant_rooms() to authenticated;
