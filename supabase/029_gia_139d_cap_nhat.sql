-- 139D Nguyễn Đình Chính: đối chiếu với sơ đồ chủ nhà gửi 12/11/2026 (file S_____139D_NDC_revD.xlsx, sheet "sơ đồ").
-- 24 phòng khớp giá; chỉ B204 đổi từ 6.000.000 lên 8.000.000.
update public.rooms r set list_price = 8000000
from public.buildings b
where b.id = r.building_id and b.name like '139D%' and r.code = 'B204' and r.list_price is distinct from 8000000;
