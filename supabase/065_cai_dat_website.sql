-- 065: Chỉnh sửa website phòng trống (/phong) ngay trong app
-- Một dòng cài đặt (id = 1), nội dung dạng jsonb với danh sách khoá cố định.
-- Chỉ Quản lý đọc / sửa qua hàm web_settings_get / web_settings_save (bảng không có policy nào).
-- Website công khai đọc qua web_config(): chỉ phần hiển thị, không có danh sách ẩn.
-- Toà / phòng bị ẩn được loại ngay trong web_rooms() và web_room(): người ngoài không xem được dù biết mã.

create table if not exists public.web_settings (
  id         smallint primary key default 1 check (id = 1),
  data       jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now(),
  updated_by uuid references public.profiles(id) on delete set null
);
insert into public.web_settings (id) values (1) on conflict (id) do nothing;
alter table public.web_settings enable row level security;
revoke all on public.web_settings from anon, authenticated;

-- Kiểm tra và làm sạch nội dung gửi lên. Sai thì báo lỗi tiếng Việt.
create or replace function public.web_settings_clean(p jsonb) returns jsonb
language plpgsql immutable set search_path = public as $$
declare
  o jsonb := '{}'::jsonb;
  k text; v text; lim int;
  texts constant jsonb := '{"eyebrow":60,"title1":60,"title2":60,"subtitle":200,"notice":160,"address":200,"hours":100,
                            "seo_title":70,"seo_desc":160,"footer_note":200}';
  flags constant text[] := array['notice_on','show_features','show_buildings','show_app','show_brands'];
  x jsonb;
begin
  if p is null or jsonb_typeof(p) <> 'object' then raise exception 'Dữ liệu cài đặt không hợp lệ'; end if;
  for k, lim in select key, value::int from jsonb_each_text(texts) loop
    if p ? k and jsonb_typeof(p->k) <> 'null' then
      v := btrim(p->>k);
      if char_length(v) > lim then raise exception 'Mục "%" dài quá % ký tự', k, lim; end if;
      if v <> '' then o := o || jsonb_build_object(k, v); end if;
    end if;
  end loop;
  foreach k in array flags loop
    if p ? k then
      if jsonb_typeof(p->k) <> 'boolean' then raise exception 'Mục "%" phải là bật / tắt', k; end if;
      o := o || jsonb_build_object(k, p->k);
    end if;
  end loop;
  v := btrim(coalesce(p->>'hotline', ''));
  if v <> '' then
    if v !~ '^\+?[0-9 .]{8,16}$' then raise exception 'Hotline chỉ gồm số, dấu cách hoặc dấu chấm (8–16 ký tự)'; end if;
    o := o || jsonb_build_object('hotline', v);
  end if;
  v := regexp_replace(coalesce(p->>'zalo', ''), '\D', '', 'g');
  if v <> '' then
    if v !~ '^0[0-9]{9}$' then raise exception 'Số Zalo phải là số điện thoại 10 chữ số, bắt đầu bằng 0'; end if;
    o := o || jsonb_build_object('zalo', v);
  end if;
  v := lower(btrim(coalesce(p->>'email', '')));
  if v <> '' then
    if v !~ '^[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}$' or char_length(v) > 120 then raise exception 'Email chưa đúng định dạng'; end if;
    o := o || jsonb_build_object('email', v);
  end if;
  if coalesce(p->>'hero_building', '') <> '' then
    if p->>'hero_building' !~ '^[0-9a-f-]{36}$' then raise exception 'Toà làm ảnh đầu trang không hợp lệ'; end if;
    o := o || jsonb_build_object('hero_building', p->>'hero_building');
  end if;
  foreach k in array array['hidden_buildings','hidden_rooms'] loop
    x := coalesce(p->k, '[]'::jsonb);
    if jsonb_typeof(x) <> 'array' or jsonb_array_length(x) > 2000
       or exists (select 1 from jsonb_array_elements(x) e where jsonb_typeof(e) <> 'string' or e #>> '{}' !~ '^[0-9a-f-]{36}$') then
      raise exception 'Danh sách ẩn không hợp lệ';
    end if;
    o := o || jsonb_build_object(k, (select coalesce(jsonb_agg(distinct e), '[]'::jsonb) from jsonb_array_elements(x) e));
  end loop;
  return o;
end $$;
revoke execute on function public.web_settings_clean(jsonb) from public, anon, authenticated;

-- Quản lý: đọc toàn bộ cài đặt
create or replace function public.web_settings_get()
returns table (data jsonb, updated_at timestamptz, updated_by_name text)
language sql stable security definer set search_path = public as $$
  select s.data, s.updated_at, p.full_name
    from public.web_settings s left join public.profiles p on p.id = s.updated_by
   where s.id = 1 and public.is_manager()
$$;
revoke execute on function public.web_settings_get() from public, anon;
grant execute on function public.web_settings_get() to authenticated;

-- Quản lý: lưu cài đặt (thay toàn bộ)
create or replace function public.web_settings_save(p_data jsonb) returns timestamptz
language plpgsql security definer set search_path = public as $$
declare t timestamptz;
begin
  if not public.is_manager() then raise exception 'Chỉ Quản lý được sửa website'; end if;
  update public.web_settings
     set data = public.web_settings_clean(p_data), updated_at = now(), updated_by = auth.uid()
   where id = 1
  returning updated_at into t;
  return t;
end $$;
revoke execute on function public.web_settings_save(jsonb) from public, anon;
grant execute on function public.web_settings_save(jsonb) to authenticated;

-- Website công khai: nội dung hiển thị (không gồm danh sách ẩn)
create or replace function public.web_config() returns jsonb
language sql stable security definer set search_path = public as $$
  select coalesce((select data - 'hidden_buildings' - 'hidden_rooms' from public.web_settings where id = 1), '{}'::jsonb)
$$;
revoke execute on function public.web_config() from public;
grant execute on function public.web_config() to anon, authenticated;

-- Toà hoặc phòng có đang bị ẩn khỏi website không
create or replace function public.web_is_hidden(p_building uuid, p_room uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce((select (s.data->'hidden_buildings') ? p_building::text
                       or (p_room is not null and (s.data->'hidden_rooms') ? p_room::text)
                     from public.web_settings s where s.id = 1), false)
$$;
revoke execute on function public.web_is_hidden(uuid, uuid) from public, anon, authenticated;

-- Danh sách phòng trống trên web: bỏ toà / phòng bị ẩn
create or replace function public.web_rooms()
returns table (room_id uuid, building_id uuid, building_name text, address text, type_name text, floor int, rent_mode text,
               list_price numeric, max_occupants int, area_m2 numeric, photo jsonb, building_photo jsonb)
language sql stable security definer set search_path = public as $$
  select r.id, b.id, b.name, b.address, coalesce(t.name, nullif(btrim(r.room_type), ''), 'Phòng'), r.floor, r.rent_mode::text,
         coalesce(r.list_price, t.list_price), coalesce(r.max_occupants, t.max_occupants), t.area_m2,
         public.web_photo(r.id, r.room_type_id, b.id), public.web_photo(null, null, b.id)
    from public.rooms r join public.buildings b on b.id = r.building_id
    left join public.room_types t on t.id = r.room_type_id
   where r.status = 'trong' and coalesce(r.list_price, t.list_price) > 0
     and not public.web_is_hidden(b.id, r.id)
   order by b.name, coalesce(r.list_price, t.list_price)
$$;

-- Chi tiết một phòng trên web: phòng hoặc toà bị ẩn thì không trả gì
create or replace function public.web_room(p_room uuid) returns jsonb
language sql stable security definer set search_path = public as $$
  select jsonb_build_object(
    'room_id', r.id, 'status', r.status, 'type_name', coalesce(t.name, nullif(btrim(r.room_type), ''), 'Phòng'),
    'floor', r.floor, 'rent_mode', r.rent_mode, 'list_price', coalesce(r.list_price, t.list_price),
    'max_occupants', coalesce(r.max_occupants, t.max_occupants), 'area_m2', t.area_m2,
    'room_furniture', coalesce(nullif(btrim(r.furniture), ''), t.furniture),
    'building', jsonb_build_object('id', b.id, 'name', b.name, 'address', b.address, 'note', b.public_note,
                                   'lat', round(b.lat::numeric, 3), 'lng', round(b.lng::numeric, 3)),
    'fees', coalesce(p.fees, '[]'::jsonb), 'amenities', to_jsonb(coalesce(p.amenities, '{}')),
    'furniture', to_jsonb(coalesce(p.furniture, '{}')), 'deposit_lines', to_jsonb(coalesce(p.deposit_lines, '{}')),
    'photos', coalesce((select jsonb_agg(jsonb_build_object('path', f.path, 'store', f.store, 'thumb', f.thumb)
                                         order by case f.kind when 'anh_phong' then 0 when 'anh_loai_phong' then 1 else 2 end, f.is_cover desc, f.created_at)
                          from public.files f
                         where (f.kind = 'anh_phong' and f.room_id = r.id)
                            or (f.kind = 'anh_loai_phong' and f.room_type_id = r.room_type_id and r.room_type_id is not null)
                            or (f.kind = 'anh_toa' and f.building_id = b.id)), '[]'::jsonb),
    'others', coalesce((select jsonb_agg(jsonb_build_object('room_id', o.room_id, 'type_name', o.type_name, 'floor', o.floor,
                                                            'list_price', o.list_price, 'photo', o.photo) order by o.list_price)
                          from public.web_rooms() o where o.building_id = b.id and o.room_id <> r.id), '[]'::jsonb))
    from public.rooms r join public.buildings b on b.id = r.building_id
    left join public.room_types t on t.id = r.room_type_id
    left join public.building_policy p on p.building_id = b.id
   where r.id = p_room and not public.web_is_hidden(b.id, r.id)
$$;
