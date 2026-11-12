-- 139D Nguyễn Đình Chính chỉ có 24 phòng (theo bảng doanh thu). Xoá A201, B203, B205 (đều Trống, không hợp đồng/ảnh/phản ánh/khách gắn kèm; chủ DN yêu cầu 12/11/2026).
delete from public.rooms r using public.buildings b
where b.id = r.building_id and b.name like '139D%' and r.code in ('A201','B203','B205') and r.status = 'trong'
  and not exists (select 1 from public.contracts c where c.room_id = r.id);
