-- 077: số ngày nghỉ lưu 2 chữ số thập phân để ghi đúng 0,25 ngày (nghỉ 2 giờ)
alter table public.requests alter column days type numeric(6,2);
