-- Thêm vai trò Cộng tác viên (phải chạy riêng, trước 014)
alter type public.user_role add value if not exists 'cong_tac_vien';
