-- 139D Nguyễn Đình Chính: giá theo bảng doanh thu (sheet "DT NDC", cột GIÁ PHÒNG min, file S_____139D_NDC_revD.xlsx 12/11/2026).
-- Chủ DN chọn bảng doanh thu làm chuẩn thay cho sơ đồ. A201, B203, B205 không có trong bảng nên giữ nguyên.
update public.rooms r set list_price = v.price
from (values
  ('A001',6000000),('A002',6000000),('A003',8000000),('A004',8000000),('A005',7500000),
  ('A101',8500000),('A102',8000000),('A103',8500000),('A104',8000000),
  ('A202',8000000),('A203',4500000),('A204',8000000),
  ('B001',7500000),('B002',6000000),('B003',7500000),('B004',6000000),('B005',8000000),
  ('B101',8500000),('B102',8000000),('B103',8500000),('B104',8000000),
  ('B201',4500000),('B202',8000000),('B204',8000000)
) as v(code, price), public.buildings b
where b.id = r.building_id and b.name like '139D%' and r.code = v.code and r.list_price is distinct from v.price;
