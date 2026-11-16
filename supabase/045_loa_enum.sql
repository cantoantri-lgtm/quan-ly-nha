-- LOA (Tờ trình phê duyệt), phần 1: thêm giá trị enum. Phải chạy và commit TRƯỚC file 046 (Postgres không cho dùng giá trị enum mới trong cùng giao dịch).
alter type public.request_kind add value if not exists 'loa';
alter type public.request_status add value if not exists 'nhap';
