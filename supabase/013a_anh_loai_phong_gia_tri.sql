-- Thêm loại tệp "ảnh loại phòng" (phải chạy riêng, trước 013)
alter type public.file_kind add value if not exists 'anh_loai_phong';
