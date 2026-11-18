-- Ảnh phòng / ảnh toà trên website: người đã đăng nhập (CTV, khách, nhân sự toà khác) mở trang /phong cũng xem được,
-- giống người chưa đăng nhập (062 chỉ cho anon).
-- web_room: bỏ mô tả loại phòng (đang dùng làm ghi chú nội bộ, VD "Giá từng phòng nhập riêng ở phòng").
drop policy if exists web_public_photos on storage.objects;
create policy web_public_photos on storage.objects for select to anon, authenticated
  using (bucket_id = 'kho-tai-lieu' and (name like 'anh-phong/%' or name like 'anh-toa/%'));

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
   where r.id = p_room
$$;
