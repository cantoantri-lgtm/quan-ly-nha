-- Dữ liệu toà 339 Lê Văn Sĩ theo sơ đồ phòng chủ DN gửi 10/11/2026 (17 phòng: trệt + 4 lầu).
-- Màu trong sơ đồ: đỏ LOCK = đã có khách; cam nhạt Home = nhân viên công ty ở; vàng CHDV = căn hộ dịch vụ còn trống.
-- Đã được chủ DN đồng ý xoá 31 phòng A101–A510 cũ (đều Trống) và 1 hợp đồng thử đã kết thúc ở A204 (Cấn Toàn Trí, 02/11/2026).
do $$
declare
  b constant uuid := 'd74a910c-43f9-4121-82f0-cb0c385c08b1';
  t uuid;
begin
  delete from public.contract_occupants where contract_id in
    (select c.id from public.contracts c join public.rooms r on r.id = c.room_id where r.building_id = b);
  delete from public.contracts where room_id in (select id from public.rooms where building_id = b);
  delete from public.rooms where building_id = b;
  delete from public.room_types where building_id = b;   -- 3 nhóm cũ theo diện tích, không có thông tin, không có ảnh

  insert into public.room_types (building_id, name, rent_mode, list_price, furniture, description, sort)
  values (b, 'Phòng trọ tiêu chuẩn', 'thang', 6000000,
          E'Giường, nệm\nTủ quần áo\nBàn ăn + ghế\nKệ bếp\nTủ lạnh\nMáy lạnh',
          'Nội thất theo chính sách dự án. Giá từng phòng nhập riêng ở phòng.', 0)
  returning id into t;

  insert into public.rooms (building_id, code, floor, room_type_id, rent_mode, list_price, status, note) values
    (b, 'G01', 0, t, 'thang', 13000000, 'dang_o', 'HOME · nhân viên công ty ở'),
    (b, '101', 1, t, 'thang', 11000000, 'dang_o', 'LOCK · đã có khách'),
    (b, '102', 1, t, 'thang', 10000000, 'dang_o', 'HOME · nhân viên công ty ở'),
    (b, '103', 1, t, 'thang', 11000000, 'dang_o', 'HOME · nhân viên công ty ở'),
    (b, '201', 2, t, 'thang', 11000000, 'dang_o', 'LOCK · đã có khách'),
    (b, '202', 2, t, 'thang', 10000000, 'dang_o', 'HOME · nhân viên công ty ở'),
    (b, '203', 2, t, 'thang', 11000000, 'dang_o', 'HOME · nhân viên công ty ở'),
    (b, '301', 3, t, 'thang',  6000000, 'dang_o', 'LOCK · đã có khách'),
    (b, '302', 3, t, 'thang',  6800000, 'dang_o', 'LOCK · đã có khách'),
    (b, '303', 3, t, 'thang',  6000000, 'dang_o', 'LOCK · đã có khách'),
    (b, '304', 3, t, 'thang',  7300000, 'dang_o', 'LOCK · đã có khách'),
    (b, '305', 3, t, 'thang',  7500000, 'dang_o', 'LOCK · đã có khách'),
    (b, '401', 4, t, 'thang',  5800000, 'trong',  'CHDV · căn hộ dịch vụ'),
    (b, '402', 4, t, 'thang',  6000000, 'dang_o', 'LOCK · đã có khách'),
    (b, '403', 4, t, 'thang',  5500000, 'dang_o', 'LOCK · đã có khách'),
    (b, '404', 4, t, 'thang',  6000000, 'dang_o', 'LOCK · đã có khách'),
    (b, '405', 4, t, 'thang',  6000000, 'trong',  'CHDV · căn hộ dịch vụ');

  insert into public.building_policy (building_id, fees, amenities, deposit_lines, commission_terms, forfeit_min, forfeit_pct)
  values (b,
    '[{"label":"Điện","amount":4000,"unit":"kWh"},{"label":"Nước","amount":120000,"unit":"người"},{"label":"Xe","amount":150000,"unit":"chiếc"},{"label":"Dịch vụ","amount":200000,"unit":"tháng"}]'::jsonb,
    array['Bãi giữ xe','Wifi mỗi tầng','Cho nuôi pet nhỏ','Khu giặt sấy','Vệ sinh hành lang'],
    array['Cọc ký quỹ: 1 tháng (hợp đồng 9–12 tháng), 1,5 tháng (hợp đồng 18 tháng)',
          'Cọc giữ chỗ tối thiểu 2.000.000 đ, bổ sung đủ cọc trong 3 ngày',
          'Kỳ hợp đồng: 9 – 12 – 18 tháng'],
    '[{"months":9,"pct":60},{"months":12,"pct":80},{"months":18,"pct":100}]'::jsonb,
    3000000, 30)
  on conflict (building_id) do update set fees = excluded.fees, amenities = excluded.amenities,
    deposit_lines = excluded.deposit_lines, commission_terms = excluded.commission_terms,
    forfeit_min = excluded.forfeit_min, forfeit_pct = excluded.forfeit_pct;
end $$;
