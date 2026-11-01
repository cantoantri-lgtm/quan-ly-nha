# Neo Nestly

Web app nội bộ để giao việc, quản lý toà nhà cho thuê và làm thủ tục văn phòng (nghỉ phép, công tác, thanh toán…).
Quy mô thiết kế: khoảng 10 toà, 500 phòng, 50 nhân sự. Giao diện ưu tiên điện thoại.

- App đang chạy: https://neo-nestly.vercel.app
- Đăng nhập: số điện thoại + mật khẩu do Quản lý cấp (nội bộ dùng email `<sđt>@neonestly.app`)

## Tính năng

| Mục | Nội dung |
|---|---|
| Công việc | Quản lý / Giám sát giao việc cho cấp dưới, chia bước, cập nhật tiến độ, nhắc việc 7h sáng, báo trễ hạn. Nhân viên chỉ nhận việc, đổi trạng thái, thêm bước vào việc của mình. |
| Giao việc bằng giọng nói | Ghi âm hoặc dán tin nhắn Zalo → AI (Google Gemini) tách thành danh sách việc → kiểm tra rồi giao. Chỉ Quản lý / Giám sát. |
| Toà nhà & phòng | Lưới phòng theo tầng, giá thuê, trạng thái phòng, tạo nhanh nhiều phòng, dán từ Excel, xoá toà / xoá phòng. |
| Văn phòng | Xin nghỉ phép (phép năm / không lương, cả ngày / nửa ngày, không tính Chủ nhật), làm việc bên ngoài, đi công tác (duyệt trước, nhập thực tế sau), đề nghị thanh toán, tạm ứng. Chỉ Quản lý duyệt. |
| Quản trị | Cấp tài khoản, cấp lại mật khẩu, khoá tài khoản, gán toà, nhập số ngày phép năm. |
| Thông báo | Trong app, thời gian thực. |

Đã có sẵn trong cơ sở dữ liệu nhưng chưa có màn hình: khách thuê, hợp đồng, tiền cọc, hoá đơn tháng (tự tạo ngày 1), doanh thu thuê theo đêm, dashboard doanh thu (`dashboard_month`).

## Công nghệ

- Giao diện: React 18 + TypeScript + Vite 5, không dùng thư viện UI (CSS tự viết trong `src/*.css`)
- Dữ liệu: Supabase (Postgres, Auth, Realtime, Edge Functions, pg_cron, Vault)
- Hosting: Vercel (build tĩnh, `vercel.json` chuyển mọi đường dẫn về `index.html`)
- AI: Google Gemini API (gọi từ Edge Function, khoá không bao giờ xuống trình duyệt)

## Nơi đặt hệ thống

| Thành phần | Ở đâu |
|---|---|
| Supabase | Project `Quan ly nha cho thue`, mã `nbxnupvceeyqqwrabjfc`, vùng Singapore — https://supabase.com/dashboard/project/nbxnupvceeyqqwrabjfc |
| Vercel | Project `neo-nestly` — https://vercel.com/cantoantri-lgtms-projects/neo-nestly |
| Mã nguồn | Repo này |

## Cấu trúc thư mục

```
src/
  main.tsx, App.tsx          khởi động, định tuyến, chặn quyền theo vai trò
  lib/supabase.ts            kết nối Supabase, đổi SĐT ↔ email, thông báo lỗi tiếng Việt
  lib/session.tsx            phiên đăng nhập, hồ sơ, toà, danh sách người, thông báo realtime
  lib/labels.ts dates.ts money.ts office.ts recorder.ts   nhãn, ngày giờ VN, tiền VNĐ, văn phòng, ghi âm WAV
  components/ui.tsx          thanh trên/dưới, sheet, toast, icon
  pages/                     mỗi màn hình một file
  styles.css rooms.css voice.css office.css
supabase/
  001_schema.sql             bảng, phân quyền (RLS), trigger nghiệp vụ, hàm hỗ trợ
  002_lich_tu_dong.sql       lịch pg_cron: nhắc việc 7h sáng, tạo hoá đơn ngày 1
  003_van_phong.sql          module Văn phòng (bảng requests, duyệt, thông báo)
  004_phep_nam_chu_nhat.sql  phép năm do Quản lý nhập, nghỉ phép không tính Chủ nhật
  functions/quan-ly-tai-khoan    cấp / khoá tài khoản, đổi SĐT, cấp lại mật khẩu (dùng service role)
  functions/phan-tich-giao-viec  ghi âm / tin nhắn → danh sách việc (Gemini)
```

## Phân quyền (kiểm soát ở cơ sở dữ liệu, không chỉ ở giao diện)

- **Quản lý**: toàn quyền, thấy mọi toà, duyệt đề nghị văn phòng, đánh dấu đã chi.
- **Giám sát**: giao việc cho Nhân viên trong toà được gán, sửa việc của toà mình.
- **Nhân viên**: xem và cập nhật việc được giao, thêm bước vào việc của mình, tạo đề nghị văn phòng. Không tạo / giao việc.

Các quy tắc nằm trong policy RLS và trigger `tg_tasks_guard`, `tg_requests_guard`, `tg_profiles_guard`. Sửa quyền thì sửa ở SQL, giao diện chỉ ẩn/hiện nút.

## Chạy trên máy

Cần Node.js 20+.

```bash
npm install
npm run dev          # http://localhost:5173, dùng thẳng dữ liệu thật trên Supabase
npm run build        # kiểm tra kiểu + build ra dist/
```

Biến môi trường (không bắt buộc — đã có giá trị mặc định trỏ tới project thật), xem `.env.example`:
`VITE_SUPABASE_URL`, `VITE_SUPABASE_KEY` (khoá publishable, an toàn để công khai).

> Lưu ý: chạy trên máy vẫn ghi vào dữ liệu thật. Muốn thử nghiệm an toàn, tạo một Supabase project riêng, chạy lần lượt các file SQL bên dưới rồi trỏ `.env.local` sang project đó.

## Thay đổi cơ sở dữ liệu

Chạy các file trong `supabase/` theo thứ tự số trong **SQL Editor** của Supabase. Thay đổi mới: tạo file kế tiếp (`005_...sql`), không sửa file cũ đã chạy.

Dựng một project mới từ đầu:
1. Chạy `001` → `004` theo thứ tự.
2. Deploy 2 Edge Function (bên dưới).
3. Lưu khoá Gemini (bên dưới).
4. Tạo tài khoản Quản lý đầu tiên: Authentication → Add user, email `<sđt>@neonestly.app` + mật khẩu, rồi trong SQL Editor:
   ```sql
   update public.profiles set role = 'quan_ly', is_active = true, full_name = '<Họ tên>', phone = '<sđt>'
   where id = (select id from auth.users where email = '<sđt>@neonestly.app');
   ```
   Các tài khoản sau đó cấp ngay trong app (Quản trị → Nhân sự).

## Edge Functions

Dùng Supabase CLI (`npm i -g supabase`, rồi `supabase login`):

```bash
supabase functions deploy quan-ly-tai-khoan   --project-ref nbxnupvceeyqqwrabjfc
supabase functions deploy phan-tich-giao-viec --project-ref nbxnupvceeyqqwrabjfc
```

Khoá Gemini: hàm `phan-tich-giao-viec` đọc secret `GEMINI_API_KEY`; nếu không có thì đọc trong Supabase Vault tên `gemini_api_key` (đang dùng cách này).
Đổi khoá trong SQL Editor:

```sql
select vault.update_secret((select id from vault.secrets where name = 'gemini_api_key'), '<khoá mới>');
```

Đổi model AI không cần sửa code: đặt secret `GEMINI_MODEL`, ví dụ `gemini-3.6-flash:minimal,gemini-3.5-flash-lite` (thử lần lượt, phần sau dấu `:` là mức "suy nghĩ").

## Đưa bản mới lên mạng

**Cách khuyên dùng — nối Vercel với GitHub:** Vercel → project `neo-nestly` → Settings → Git → Connect Git Repository → chọn repo này, nhánh `main`.
Từ đó mỗi lần đẩy code lên `main` là app tự build và cập nhật; đẩy lên nhánh khác sẽ có link xem thử riêng.

Cách thủ công: `npx vercel --prod` trong thư mục này (lần đầu chạy `npx vercel link` và chọn project `neo-nestly`).

Thứ tự khi một thay đổi đụng cả dữ liệu lẫn giao diện: **chạy SQL trước → deploy Edge Function (nếu có) → rồi mới đẩy giao diện.**

## Việc nên làm tiếp

- Đổi khoá Gemini (khoá hiện tại từng được dán qua chat).
- Bật "Leaked password protection" trong Supabase → Authentication → Policies.
- Xoá Edge Function tạm `do-toc-do-ai` (Supabase → Edge Functions) — đã vô hiệu, không còn dùng.
- Màn hình module Cho thuê: khách thuê, hợp đồng, cọc, đánh dấu đã thu; dashboard doanh thu.
