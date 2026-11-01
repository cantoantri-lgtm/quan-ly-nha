-- =====================================================================
--  LỊCH TỰ ĐỘNG (chạy SAU file 001)
--  (Đã chạy trên project "Quan ly nha cho thue". pg_cron được bật bằng lệnh bên dưới.)

-- =====================================================================

create extension if not exists pg_cron with schema pg_catalog;

-- 07:00 sáng giờ Việt Nam (00:00 UTC): nhắc việc, việc trễ hạn, nhắc thu tiền, hợp đồng sắp hết hạn
select cron.schedule('nhac-viec-hang-ngay', '0 0 * * *',
  $$select public.run_daily_reminders()$$);

-- 07:10 sáng ngày 1 hằng tháng: tạo hoá đơn tiền phòng cho mọi hợp đồng đang hiệu lực
select cron.schedule('tao-hoa-don-hang-thang', '10 0 1 * *',
  $$select public.generate_monthly_invoices()$$);
