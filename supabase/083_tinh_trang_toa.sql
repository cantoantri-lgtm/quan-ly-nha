-- 083: Tình trạng hoạt động của toà nhà: đang hoạt động / sửa chữa / ngưng hoạt động
--  * buildings.status (+ status_note, status_since, status_by). Chỉ Quản lý đổi (tg_buildings_guard).
--  * Toà không hoạt động: không hiện ở Phòng trống (app), website, bản đồ (đếm 0 phòng trống), không nhận đặt lịch xem.
--  * Đổi tình trạng: báo nhân sự phụ trách toà (public.notify).

create type public.building_status as enum ('hoat_dong', 'sua_chua', 'ngung');

alter table public.buildings
  add column status public.building_status not null default 'hoat_dong',
  add column status_note text,
  add column status_since date,
  add column status_by uuid references public.profiles(id) on delete set null;

-- ============ Guard: chỉ Quản lý đổi tình trạng ============
create or replace function public.tg_buildings_guard()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is not null and not public.is_manager() then
    if new.code is distinct from old.code or new.kind is distinct from old.kind then
      raise exception 'Chỉ Quản lý đổi được mã toà và loại hình toà';
    end if;
    if new.status is distinct from old.status or new.status_note is distinct from old.status_note then
      raise exception 'Chỉ Quản lý đổi được tình trạng hoạt động của toà';
    end if;
  end if;
  new.status_note := nullif(btrim(coalesce(new.status_note, '')), '');
  if new.status = 'hoat_dong' then new.status_note := null; end if;
  if new.status is distinct from old.status then
    new.status_since := (now() at time zone 'Asia/Ho_Chi_Minh')::date;
    new.status_by := auth.uid();
  else
    new.status_since := old.status_since; new.status_by := old.status_by;
  end if;
  return new;
end $$;

-- ============ Thông báo khi đổi tình trạng ============
create or replace function public.tg_buildings_status_notify()
returns trigger language plpgsql security definer set search_path = public as $$
declare u uuid; t text;
begin
  if new.status is not distinct from old.status then return null; end if;
  t := 'Toà ' || new.code || ': ' || case new.status when 'hoat_dong' then 'hoạt động trở lại'
                                                     when 'sua_chua' then 'đang sửa chữa'
                                                     else 'ngưng hoạt động' end;
  for u in select distinct m.user_id from public.building_members m
            join public.profiles p on p.id = m.user_id and p.is_active
           where m.building_id = new.id and m.user_id is distinct from auth.uid() loop
    perform public.notify(u, 'khac', t,
      coalesce(new.status_note, case when new.status = 'hoat_dong' then 'Phòng trống của toà hiện lại cho Sale, CTV và website.'
                                      else 'Phòng trống của toà tạm ẩn khỏi danh sách, bản đồ và website.' end),
      'building', new.id, null);
  end loop;
  return null;
end $$;
create trigger buildings_status_notify after update of status on public.buildings
  for each row execute function public.tg_buildings_status_notify();

-- ============ Phòng trống trong app ============
create or replace function public.vacant_rooms()
returns table(room_id uuid, building_id uuid, building_code text, building_name text, building_note text, code text, floor integer,
              type_id uuid, type_name text, area_m2 numeric, furniture text, description text, rent_mode rent_mode, list_price numeric,
              max_occupants integer, cover_path text, cover_store text, cover_thumb boolean)
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
  where r.status = 'trong' and b.status = 'hoat_dong' and public.is_active_user()
  order by b.code, r.floor nulls last, r.code
$$;

-- ============ Bản đồ: thêm tình trạng, toà không hoạt động đếm 0 phòng trống ============
drop function public.building_map();
create function public.building_map()
returns table(id uuid, code text, name text, address text, kind building_kind, lat double precision, lng double precision,
              total_rooms integer, vacant_rooms integer, can_open boolean, photo_path text, photo_store text, photo_thumb boolean,
              status text)
language sql stable security definer set search_path = public as $$
  select b.id, b.code, b.name, b.address, b.kind, b.lat, b.lng,
         count(r.id)::int,
         (count(r.id) filter (where r.status = 'trong' and b.status = 'hoat_dong'))::int,
         public.can_access_building(b.id),
         p.path, p.store, p.thumb, b.status::text
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

-- ============ Website: toà không hoạt động coi như bị ẩn ============
create or replace function public.web_is_hidden(p_building uuid, p_room uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce((select b.status <> 'hoat_dong' from public.buildings b where b.id = p_building), true)
      or coalesce((select (s.data->'hidden_buildings') ? p_building::text
                       or (p_room is not null and (s.data->'hidden_rooms') ? p_room::text)
                     from public.web_settings s where s.id = 1), false)
$$;
revoke execute on function public.web_is_hidden(uuid, uuid) from public, anon, authenticated;

-- Đặt lịch xem: chặn phòng của toà không hoạt động hoặc bị ẩn
do $$
declare d text := pg_get_functiondef('public.web_book_viewing(uuid,text,text,date,text,text,boolean,text)'::regprocedure);
        a text := 'if b is null then raise exception ''Phòng này vừa có người thuê. Mời anh chị xem phòng khác.''; end if;';
begin
  if position(a in d) = 0 then raise exception '083: không thấy đoạn cần vá trong web_book_viewing'; end if;
  d := replace(d, a, a || E'\n  if public.web_is_hidden(b, p_room) then raise exception ''Phòng này tạm ngưng nhận khách. Mời anh chị xem phòng khác.''; end if;');
  execute d;
end $$;
