-- Toà 283/65 Nguyễn Thái Bình theo sơ đồ phòng chủ DN gửi 16/11/2026 (11 phòng: trệt + 4 lầu).
-- Lưu ý: tiêu đề sơ đồ ghi "165/73 Nguyễn Thái Bình"; địa chỉ lấy theo tin nhắn của chủ DN (283/65), sửa được ở trang toà.
-- Màu trong sơ đồ: đỏ LOCK = đã có khách; vàng CHDV = căn hộ dịch vụ còn trống. MB = mặt bằng tầng trệt.
-- Sale phụ trách theo dòng "Liên hệ": Lê Thị Mộng Thi (0984281198).
do $$
declare
  b uuid; t uuid; t_mb uuid;
  furn constant text[] := array['Nệm','Tủ quần áo','Bàn ăn + ghế','Kệ bếp','Tủ lạnh','Máy lạnh'];
begin
  if exists (select 1 from public.buildings where code = '283NTB') then raise exception 'Toà 283NTB đã có'; end if;

  insert into public.buildings (code, name, address, kind, total_floors)
  values ('283NTB', '283 Nguyễn Thái Bình', '283/65 Nguyễn Thái Bình', 'hon_hop', 5)
  returning id into b;

  insert into public.room_types (building_id, name, rent_mode, list_price, furniture, description, sort, color)
  values (b, 'Phòng trọ tiêu chuẩn', 'thang', 10000000, array_to_string(furn, E'\n'),
          'Nội thất theo chính sách dự án. Giá từng phòng nhập riêng ở phòng.', 0, 'xam_xanh')
  returning id into t;
  insert into public.room_types (building_id, name, rent_mode, list_price, description, sort, color)
  values (b, 'Mặt bằng', 'thang', 12000000, 'Mặt bằng tầng trệt.', 1, 'cam')
  returning id into t_mb;

  insert into public.rooms (building_id, code, floor, room_type_id, room_type, rent_mode, list_price, status, note) values
    (b, 'MB',  0, t_mb, 'Mặt bằng',            'thang', 12000000, 'trong',  'CHDV · mặt bằng còn trống'),
    (b, 'G01', 0, t,    'Phòng trọ tiêu chuẩn', 'thang',  5000000, 'dang_o', 'LOCK · đã có khách'),
    (b, 'G02', 0, t,    'Phòng trọ tiêu chuẩn', 'thang',  6600000, 'dang_o', 'LOCK · đã có khách'),
    (b, '101', 1, t,    'Phòng trọ tiêu chuẩn', 'thang', 10000000, 'dang_o', 'LOCK · đã có khách'),
    (b, '102', 1, t,    'Phòng trọ tiêu chuẩn', 'thang', 10000000, 'trong',  'CHDV · căn hộ dịch vụ'),
    (b, '201', 2, t,    'Phòng trọ tiêu chuẩn', 'thang',  9900000, 'dang_o', 'LOCK · đã có khách'),
    (b, '202', 2, t,    'Phòng trọ tiêu chuẩn', 'thang', 10500000, 'dang_o', 'LOCK · đã có khách'),
    (b, '301', 3, t,    'Phòng trọ tiêu chuẩn', 'thang', 11000000, 'dang_o', 'LOCK · đã có khách'),
    (b, '302', 3, t,    'Phòng trọ tiêu chuẩn', 'thang', 12000000, 'dang_o', 'LOCK · đã có khách'),
    (b, '401', 4, t,    'Phòng trọ tiêu chuẩn', 'thang', 11500000, 'dang_o', 'LOCK · đã có khách'),
    (b, '402', 4, t,    'Phòng trọ tiêu chuẩn', 'thang', 11500000, 'dang_o', 'LOCK · đã có khách');

  insert into public.building_policy (building_id, fees, amenities, deposit_lines, commission_terms, forfeit_min, forfeit_pct, furniture)
  values (b,
    '[{"label":"Điện","amount":4000,"unit":"kWh"},{"label":"Nước","amount":120000,"unit":"người"},{"label":"Xe","amount":100000,"unit":"chiếc"},{"label":"Dịch vụ","amount":200000,"unit":"tháng"}]'::jsonb,
    array['Bãi giữ xe','Wifi mỗi tầng','Cho nuôi pet nhỏ','Khu giặt – phơi','Vệ sinh hành lang'],
    array['Cọc ký quỹ: 1 tháng',
          'Cọc giữ chỗ tối thiểu 2.000.000 đ, bổ sung đủ cọc trong 3 ngày',
          'Kỳ hợp đồng: 6 – 12 – 18 tháng'],
    '[{"months":6,"pct":40},{"months":12,"pct":80},{"months":18,"pct":100}]'::jsonb,
    null, 30, furn);

  insert into public.building_members (building_id, user_id)
  select b, p.id from public.profiles p where p.id = 'b6155260-26c0-453d-8aba-54044e5500ca' and p.is_active;
end $$;
