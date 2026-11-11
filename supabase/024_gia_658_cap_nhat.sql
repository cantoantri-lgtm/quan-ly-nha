-- 658/25-27 Lê Thị Riêng (658 CMT8): theo sơ đồ chủ nhà gửi 11/11, G01 còn 6,2tr và 201 còn 7,5tr.
-- Tình trạng đã khớp sơ đồ (G01, 201 trống; 16 phòng còn lại LOCK = đang cho thuê).
update public.rooms r set list_price = case r.code when 'G01' then 6200000 else 7500000 end
from public.buildings b
where b.id = r.building_id and b.name = '658 CMT8' and r.code in ('G01','201');
