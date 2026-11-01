# Hướng dẫn cho trợ lý lập trình (Claude Code)

Đọc `README.md` trước để nắm kiến trúc. Người dùng là chủ doanh nghiệp, viết tiếng Việt — trả lời và viết giao diện bằng tiếng Việt có dấu.

## Nguyên tắc
- Phân quyền đặt ở Postgres (RLS + trigger `tg_*_guard`), giao diện chỉ ẩn/hiện. Tính năng mới đụng quyền thì sửa SQL trước.
- Thay đổi CSDL: thêm file `supabase/00N_ten.sql` mới, không sửa file đã chạy. Chạy SQL → deploy Edge Function → đẩy giao diện.
- Không đưa service role key hay khoá Gemini xuống trình duyệt. Việc cần quyền cao đi qua Edge Function.
- Ngày giờ theo `Asia/Ho_Chi_Minh` (`todayVN()` trong `src/lib/dates.ts`). Tiền VNĐ: `vnd()` / `parseMoney()` trong `src/lib/money.ts`. Công ty nghỉ Chủ nhật.
- Giao diện ưu tiên điện thoại (~390px), có chế độ tối; dùng token màu trong `:root` của `src/styles.css`, không mã màu cứng.
- Thông báo trong app: gọi `public.notify(...)` từ trigger SQL, không gửi từ client.

## Kiểm tra trước khi đẩy
- `npm run build` phải qua (kiểm tra kiểu TypeScript).
- Thử với 2 vai trò: Quản lý và Nhân viên.
