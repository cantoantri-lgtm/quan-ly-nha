-- 071: Sơ đồ công ty: thêm tình trạng Tập sự (tập nghề, Điều 61 BLLĐ 2019: tối đa 3 tháng, ký hợp đồng đào tạo,
-- có làm việc thì phải trả lương) và Thử việc (Điều 24–27: tối đa 60 ngày với công việc cần cao đẳng trở lên,
-- 180 ngày với quản lý doanh nghiệp, lương thử việc ≥ 85%). Ghi ngày kết thúc để nhắc đánh giá.
alter table public.org_staff drop constraint if exists org_staff_status_check;
alter table public.org_staff add constraint org_staff_status_check
  check (status in ('co','tap_su','thu_viec','tuyen','thue_ngoai'));
alter table public.org_staff add column if not exists trial_end date;
comment on column public.org_staff.trial_end is 'Ngày kết thúc tập sự / thử việc (chỉ dùng khi status là tap_su hoặc thu_viec)';
