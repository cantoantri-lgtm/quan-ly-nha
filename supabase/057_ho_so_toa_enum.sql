-- Hồ sơ thuê toà (GPKD, hợp đồng thuê toà nhà), phần 1: thêm loại tệp. Chạy và commit TRƯỚC file 058.
alter type public.file_kind add value if not exists 'ho_so_toa';
