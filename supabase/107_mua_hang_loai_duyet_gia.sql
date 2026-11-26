-- 107: Loại luồng duyệt "Duyệt NCC & giá" cho đề nghị mua hàng (26/11/2026)
-- Chỉ dùng làm khoá cấu hình luồng (approval_flows / approval_chain), không phải loại phiếu tạo mới.
-- Tách file vì giá trị enum mới phải được ghi nhận trước khi dùng ở 108.
alter type public.request_kind add value if not exists 'mua_hang_gia';
