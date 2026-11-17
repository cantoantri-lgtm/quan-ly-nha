-- Lead Sale (Trưởng nhóm / Trưởng phòng Kinh doanh) xem được danh sách toà để mở hồ sơ thuê toà, kể cả toà mình không được gán.
-- Chỉ thấy thông tin toà; phòng, khách thuê vẫn theo quyền được gán toà.
drop policy if exists buildings_select_kd_lead on public.buildings;
create policy buildings_select_kd_lead on public.buildings for select to authenticated using (public.is_kd_lead());
