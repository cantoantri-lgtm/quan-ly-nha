-- Neo Nestly · 012a: thêm trạng thái "Trả lại" cho đề nghị (chạy riêng, trước 012)
alter type public.request_status add value if not exists 'tra_lai';
