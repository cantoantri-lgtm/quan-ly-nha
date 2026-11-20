-- 079: Thêm loại đề nghị "mua_hang" (Đề nghị mua hàng). Tách riêng vì giá trị enum mới phải commit trước khi dùng.
alter type public.request_kind add value if not exists 'mua_hang';
