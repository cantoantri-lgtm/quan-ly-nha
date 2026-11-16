-- 16/11/2026 20:04: chủ DN mở lại LOA, tạm ứng, thanh toán cho nhân viên (đã chạy trực tiếp).
-- LOA chỉ để tham chiếu: đề nghị tạm ứng / thanh toán không bắt buộc gắn LOA → giữ loa_settings.require_for_payments = false.
-- Nếu có chọn LOA thì CSDL vẫn kiểm tra LOA đó đã duyệt, chi tiền VND, có dự toán và người lập được dùng (tg_requests_guard).
update public.request_kind_settings set staff_enabled = true, updated_at = now() where kind in ('loa','tam_ung','thanh_toan');
update public.loa_settings set require_for_payments = false, updated_at = now();
