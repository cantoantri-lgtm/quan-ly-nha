-- Website phòng trống công khai (giai đoạn 1, 18/11/2026)
-- Người chưa đăng nhập (anon) KHÔNG đọc thẳng bảng nào. Họ chỉ gọi 3 hàm dưới đây, mỗi hàm trả đúng các cột an toàn:
--   web_rooms()      phòng đang trống: loại phòng, tầng, giá, toà, địa chỉ, ảnh. Không có số phòng, khách thuê, hợp đồng.
--   web_room(id)     chi tiết 1 phòng: thêm chi phí, nội thất, tiện ích, đặt cọc của toà (KHÔNG có hoa hồng, mức phạt cọc).
--   web_book_viewing đặt lịch xem phòng; ghi vào viewing_requests, báo cho sale của toà.
-- Ảnh phòng / ảnh toà (đường dẫn anh-phong/, anh-toa/) cho anon xem; tệp riêng tư (CCCD, hợp đồng…) giữ nguyên.

-- ---------- 1. Mã giới thiệu của cộng tác viên / nhân viên ----------
create table if not exists public.ref_codes (
  user_id uuid primary key references public.profiles(id) on delete cascade,
  code text not null unique check (code ~ '^[A-Z0-9]{6}$'),
  created_at timestamptz not null default now()
);
alter table public.ref_codes enable row level security;
revoke all on public.ref_codes from anon, authenticated;
grant select on public.ref_codes to authenticated;
drop policy if exists ref_codes_own on public.ref_codes;
create policy ref_codes_own on public.ref_codes for select to authenticated using (user_id = (select auth.uid()));

-- Lấy (tạo nếu chưa có) mã giới thiệu của chính mình. CTV và nhân sự đang hoạt động mới có mã.
create or replace function public.my_ref_code() returns text
language plpgsql security definer set search_path = public as $$
declare c text; me uuid := auth.uid();
begin
  if me is null or not exists (select 1 from public.profiles where id = me and is_active and role <> 'khach_hang') then
    raise exception 'Chỉ cộng tác viên và nhân sự có mã giới thiệu';
  end if;
  select code into c from public.ref_codes where user_id = me;
  if c is not null then return c; end if;
  loop
    c := upper(substr(md5(gen_random_uuid()::text || clock_timestamp()::text), 1, 6));
    if not exists (select 1 from public.ref_codes where code = c) then
      insert into public.ref_codes (user_id, code) values (me, c);
      return c;
    end if;
  end loop;
end $$;

-- ---------- 2. Lịch hẹn xem phòng ----------
create table if not exists public.viewing_requests (
  id uuid primary key default gen_random_uuid(),
  room_id uuid not null references public.rooms(id) on delete cascade,
  building_id uuid not null references public.buildings(id) on delete cascade,
  full_name text not null check (length(btrim(full_name)) between 2 and 100),
  phone text not null check (phone ~ '^0[0-9]{9}$'),
  visit_date date not null,
  slot text not null check (slot in ('sang','chieu','toi')),
  note text check (note is null or length(note) <= 500),
  consent_at timestamptz not null,
  referrer_id uuid references public.profiles(id) on delete set null,
  status text not null default 'moi' check (status in ('moi','da_goi','da_xem','khong_den','da_thue','huy')),
  staff_note text check (staff_note is null or length(staff_note) <= 500),
  handled_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists viewing_requests_building_idx on public.viewing_requests (building_id, created_at desc);
create index if not exists viewing_requests_phone_idx on public.viewing_requests (phone, created_at desc);
alter table public.viewing_requests enable row level security;
revoke all on public.viewing_requests from anon, authenticated;
grant select on public.viewing_requests to authenticated;
-- Nhân sự của toà (và quản lý) xem lịch hẹn; CTV, khách không đọc bảng này
drop policy if exists vr_select on public.viewing_requests;
create policy vr_select on public.viewing_requests for select to authenticated using (public.can_access_building(building_id));

-- Sale cập nhật trạng thái, ghi chú
create or replace function public.viewing_update(p_id uuid, p_status text, p_note text) returns void
language plpgsql security definer set search_path = public as $$
declare b uuid;
begin
  select building_id into b from public.viewing_requests where id = p_id;
  if b is null or not public.can_access_building(b) then raise exception 'Không có quyền'; end if;
  if p_status not in ('moi','da_goi','da_xem','khong_den','da_thue','huy') then raise exception 'Trạng thái không hợp lệ'; end if;
  update public.viewing_requests
     set status = p_status, staff_note = nullif(left(btrim(coalesce(p_note, '')), 500), ''), handled_by = auth.uid(), updated_at = now()
   where id = p_id;
end $$;

-- Báo cho sale (phòng KD) được gán toà; toà chưa có sale thì báo quản lý
create or replace function public.tg_viewing_notify() returns trigger
language plpgsql security definer set search_path = public as $$
declare u uuid; n int := 0; t text; rt text;
begin
  select coalesce(rt0.name, r.room_type, 'Phòng') into rt from public.rooms r left join public.room_types rt0 on rt0.id = r.room_type_id where r.id = new.room_id;
  t := format('%s · %s %s', (select name from public.buildings where id = new.building_id), rt,
              (select 'P.' || code from public.rooms where id = new.room_id));
  for u in
    select distinct m.user_id from public.building_members m
      join public.org_staff o on o.profile_id = m.user_id
      join public.departments d on d.id = o.department_id and d.code = 'KD'
      join public.profiles p on p.id = m.user_id and p.is_active
     where m.building_id = new.building_id
  loop
    perform public.notify(u, 'khac', 'Lịch hẹn xem phòng mới', format('%s: %s, %s, ngày %s (%s)', t, new.full_name, new.phone,
      to_char(new.visit_date, 'DD/MM'), case new.slot when 'sang' then 'sáng' when 'chieu' then 'chiều' else 'tối' end), 'viewing', new.id, 'viewing:' || new.id || ':' || u);
    n := n + 1;
  end loop;
  if n = 0 then
    for u in select id from public.profiles where role = 'quan_ly' and is_active loop
      perform public.notify(u, 'khac', 'Lịch hẹn xem phòng mới (toà chưa có sale)', format('%s: %s, %s', t, new.full_name, new.phone), 'viewing', new.id, 'viewing:' || new.id || ':' || u);
    end loop;
  end if;
  return new;
end $$;
drop trigger if exists viewing_notify on public.viewing_requests;
create trigger viewing_notify after insert on public.viewing_requests for each row execute function public.tg_viewing_notify();

-- ---------- 3. Hàm công khai ----------
-- Ảnh đầu tiên (ưu tiên ảnh bìa) theo thứ tự: phòng → loại phòng → toà
create or replace function public.web_photo(p_room uuid, p_type uuid, p_building uuid) returns jsonb
language sql stable security definer set search_path = public as $$
  select jsonb_build_object('path', f.path, 'store', f.store, 'thumb', f.thumb)
    from public.files f
   where (f.kind = 'anh_phong' and f.room_id = p_room)
      or (f.kind = 'anh_loai_phong' and f.room_type_id = p_type and p_type is not null)
      or (f.kind = 'anh_toa' and f.building_id = p_building)
   order by case f.kind when 'anh_phong' then 0 when 'anh_loai_phong' then 1 else 2 end, f.is_cover desc, f.created_at
   limit 1
$$;

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
   order by b.name, coalesce(r.list_price, t.list_price)
$$;

create or replace function public.web_room(p_room uuid) returns jsonb
language sql stable security definer set search_path = public as $$
  select jsonb_build_object(
    'room_id', r.id, 'status', r.status, 'type_name', coalesce(t.name, nullif(btrim(r.room_type), ''), 'Phòng'),
    'floor', r.floor, 'rent_mode', r.rent_mode, 'list_price', coalesce(r.list_price, t.list_price),
    'max_occupants', coalesce(r.max_occupants, t.max_occupants), 'area_m2', t.area_m2,
    'description', t.description, 'room_furniture', coalesce(nullif(btrim(r.furniture), ''), t.furniture),
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
   where r.id = p_room
$$;

-- Đặt lịch xem: kiểm tra đủ thông tin, phòng còn trống, chặn gửi dồn dập theo số điện thoại
create or replace function public.web_book_viewing(p_room uuid, p_name text, p_phone text, p_date date, p_slot text,
                                                   p_note text, p_consent boolean, p_ref text default null) returns uuid
language plpgsql security definer set search_path = public as $$
declare b uuid; ph text; nid uuid; ref uuid; today date := (now() at time zone 'Asia/Ho_Chi_Minh')::date;
begin
  if coalesce(p_consent, false) is false then raise exception 'Cần đồng ý cho Next Living liên hệ để đặt lịch'; end if;
  p_name := btrim(coalesce(p_name, ''));
  if length(p_name) < 2 or length(p_name) > 100 then raise exception 'Nhập họ tên'; end if;
  ph := regexp_replace(coalesce(p_phone, ''), '[^0-9+]', '', 'g');
  if ph like '+84%' then ph := '0' || substr(ph, 4); elsif ph like '84%' and length(ph) = 11 then ph := '0' || substr(ph, 3); end if;
  if ph !~ '^0[0-9]{9}$' then raise exception 'Số điện thoại cần 10 số, bắt đầu bằng 0'; end if;
  if p_date is null or p_date < today or p_date > today + 30 then raise exception 'Chọn ngày xem trong 30 ngày tới'; end if;
  if p_slot not in ('sang','chieu','toi') then raise exception 'Chọn khung giờ'; end if;
  select r.building_id into b from public.rooms r where r.id = p_room and r.status = 'trong';
  if b is null then raise exception 'Phòng này vừa có người thuê. Mời anh chị xem phòng khác.'; end if;
  if (select count(*) from public.viewing_requests where phone = ph and created_at > now() - interval '1 day') >= 5 then
    raise exception 'Số điện thoại này đã đặt nhiều lịch hôm nay. Sale sẽ gọi lại, hoặc nhắn Zalo cho nhanh.';
  end if;
  if exists (select 1 from public.viewing_requests where phone = ph and room_id = p_room and status = 'moi') then
    raise exception 'Anh chị đã đặt lịch xem phòng này. Sale sẽ gọi lại để xác nhận.';
  end if;
  if nullif(btrim(coalesce(p_ref, '')), '') is not null then
    select user_id into ref from public.ref_codes where code = upper(btrim(p_ref));
  end if;
  insert into public.viewing_requests (room_id, building_id, full_name, phone, visit_date, slot, note, consent_at, referrer_id)
  values (p_room, b, left(p_name, 100), ph, p_date, p_slot, nullif(left(btrim(coalesce(p_note, '')), 500), ''), now(), ref)
  returning id into nid;
  return nid;
end $$;

-- Quyền gọi hàm: mặc định Postgres cho PUBLIC gọi mọi hàm, nên thu hồi rồi cấp đúng người
revoke execute on function public.web_photo(uuid, uuid, uuid), public.web_rooms(), public.web_room(uuid),
  public.web_book_viewing(uuid, text, text, date, text, text, boolean, text), public.my_ref_code(),
  public.viewing_update(uuid, text, text), public.tg_viewing_notify() from public, anon, authenticated;
grant execute on function public.web_rooms(), public.web_room(uuid),
  public.web_book_viewing(uuid, text, text, date, text, text, boolean, text) to anon, authenticated;
grant execute on function public.my_ref_code(), public.viewing_update(uuid, text, text) to authenticated;

-- ---------- 4. Ảnh phòng / ảnh toà ở kho Supabase: cho người chưa đăng nhập xem ----------
drop policy if exists web_public_photos on storage.objects;
create policy web_public_photos on storage.objects for select to anon
  using (bucket_id = 'kho-tai-lieu' and (name like 'anh-phong/%' or name like 'anh-toa/%'));
