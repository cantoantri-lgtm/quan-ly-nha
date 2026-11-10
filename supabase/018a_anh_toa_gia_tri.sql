-- Thêm loại tệp "ảnh toà nhà" (phải chạy riêng, trước 018)
alter type public.file_kind add value if not exists 'anh_toa';
