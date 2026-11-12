# Neo Nestly

Web app nội bộ để giao việc, quản lý toà nhà cho thuê và làm thủ tục văn phòng (nghỉ phép, công tác, thanh toán…).
Quy mô thiết kế: khoảng 10 toà, 500 phòng, 50 nhân sự. Giao diện ưu tiên điện thoại.

- App đang chạy: https://neo-nestly.vercel.app
- Đăng nhập: số điện thoại + mật khẩu do Quản lý cấp (nội bộ dùng email `<sđt>@neonestly.app`)

## Tính năng

| Mục | Nội dung |
|---|---|
| Công việc | Quản lý / Giám sát giao việc cho cấp dưới, chia bước, cập nhật tiến độ, nhắc việc 7h sáng, báo trễ hạn. Nhân viên chỉ nhận việc, đổi trạng thái, thêm bước vào việc của mình. |
| Bản đồ toà nhà | Một bản đồ hiện tất cả toà, mỗi toà một ghim ghi số phòng trống; bấm ghim xem tên toà, chỉ đường bằng Google Maps. Mọi người xem được tất cả toà (chỉ tên, vị trí, số phòng trống); Quản lý đặt vị trí (chạm/kéo ghim trên bản đồ, dán toạ độ / link Google Maps, vị trí hiện tại, hoặc nhập Lat/Long trong Sửa toà). |
| Giao việc bằng giọng nói | Ghi âm hoặc dán tin nhắn Zalo → AI (Google Gemini) tách thành danh sách việc → kiểm tra rồi giao. Chỉ Quản lý / Giám sát. |
| Toà nhà & phòng | Lưới phòng theo tầng, giá thuê, trạng thái phòng, tạo nhanh nhiều phòng, dán từ Excel, xoá toà / xoá phòng. |
| Văn phòng | Xin nghỉ phép (phép năm / không lương, cả ngày / nửa ngày, không tính Chủ nhật), làm việc bên ngoài, đi công tác (duyệt trước, nhập thực tế sau), đề nghị thanh toán (số chứng từ tự cấp, chi tiết hoá đơn + VAT, trừ tạm ứng, đính kèm tệp và link, bằng chữ, bản in theo mẫu), đề nghị tạm ứng. Duyệt nhiều bước: nghỉ phép / ra ngoài / công tác đi Người đề nghị → Leader → Trưởng phòng → Nhân sự; thanh toán / tạm ứng đi Người đề nghị → Leader → Trưởng phòng → Kế toán → Giám đốc. Bước chưa có người giữ tự bỏ qua, một người đứng nhiều bước chỉ duyệt một lần. |
| Sơ đồ công ty | `/to-chuc`: Chủ DN → 2 Phó Giám đốc → 5 phòng → vị trí / nhân sự (đang có, đang tuyển, thuê ngoài), thang lương L1–L4, lương cơ bản từng người (theo file Kế hoạch tái cấu trúc 2026–2027). Chỉ cấp Trưởng phòng trở lên xem sơ đồ; chỉ Phó Giám đốc xem và sửa lương; mỗi người xem được lương của chính mình. Người giữ nhiệm vụ Giám đốc / Kế toán / Nhân sự và Leader đặt ở từng vị trí. |
| Khách thuê | Hồ sơ khách theo toà, đánh dấu (Khách quen / Cần lưu ý), ảnh CCCD hai mặt (chỉ Quản lý và Giám sát của toà xem; phải ghi nhận khách đồng ý trước khi tải). |
| Hợp đồng | Lập hợp đồng gắn phòng và khách (phòng tự chuyển "Đang ở"), cách ký giấy hay điện tử, tải ảnh/PDF hợp đồng đã ký, thu và hoàn cọc, kết thúc hợp đồng. |
| Thu tiền phòng | Hoá đơn tháng theo toà, mã QR chuyển khoản (VietQR) đúng số tiền và nội dung, link thanh toán gửi khách `/thanh-toan/<mã>`, tự đánh dấu "Đã thu" khi tiền về qua SePay, hoặc đánh dấu tay. |
| Kho ảnh | Ảnh phòng, CCCD, hợp đồng, chứng từ đính kèm đề nghị thanh toán. Tệp mới nằm ở Cloudflare R2 (tải thẳng từ trình duyệt bằng link tạm do Edge Function `kho-anh` ký, kèm ảnh nhỏ cho danh sách nhanh; ảnh phòng xem qua địa chỉ công khai, các tệp riêng tư xem bằng link tạm 10 phút). Tệp cũ ở bucket riêng tư `kho-tai-lieu` của Supabase vẫn xem được (cột `files.store`). Chưa cấu hình R2 thì app tự dùng kho Supabase. Ảnh được thu nhỏ trước khi tải. |
| Khách hàng | Tài khoản khách (ID = SĐT, mỗi CCCD một tài khoản) do Quản lý / Giám sát / Sale tạo ở `/khach-hang`. Khách xem phòng trống, giá, phí, dịch vụ, nội thất (không thấy hoa hồng, ký hợp đồng, ghi chú nội bộ) và gửi phản ánh `/phan-anh`: công ty trả lời theo luồng tin nhắn, chỉ khách kết thúc, hoặc tự kết thúc sau 3 ngày kể từ lần công ty trả lời. Sale chỉ xử lý khách do mình tạo. |
| Quản trị | Cấp tài khoản, cấp lại mật khẩu, khoá tài khoản, gán toà, nhập số ngày phép năm. |
| Thông báo | Trong app, thời gian thực. |

Đã có sẵn trong cơ sở dữ liệu nhưng chưa có màn hình: khách thuê, hợp đồng, tiền cọc, hoá đơn tháng (tự tạo ngày 1), doanh thu thuê theo đêm, dashboard doanh thu (`dashboard_month`).

## Công nghệ

- Giao diện: React 18 + TypeScript + Vite 5, không dùng thư viện UI (CSS tự viết trong `src/*.css`)
- Dữ liệu: Supabase (Postgres, Auth, Realtime, Edge Functions, pg_cron, Vault)
- Hosting: Vercel (build tĩnh, `vercel.json` chuyển mọi đường dẫn về `index.html`)
- AI: Google Gemini API (gọi từ Edge Function, khoá không bao giờ xuống trình duyệt)
- Bản đồ: MapLibre GL JS + nền OpenFreeMap (miễn phí, không cần khoá, được dùng cho doanh nghiệp); nút Chỉ đường mở Google Maps

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
  005_vi_tri_toa.sql         toạ độ toà (lat/lng), hàm building_map() cho màn hình Bản đồ
  006_kho_anh_thanh_toan.sql kho tệp riêng tư + bảng files, đánh dấu khách, đồng ý lưu CCCD, tài khoản nhận tiền, mã chuyển khoản, đối soát SePay
  007_an_so_cccd.sql         ẩn cột số CCCD với nhân viên; Quản lý/Giám sát đọc qua tenant_private()
  008_dntt_day_du.sql        đề nghị thanh toán đầy đủ: số chứng từ, chi tiết hoá đơn, tạm ứng trừ, link đính kèm
  009_to_chuc_phe_duyet.sql  cơ cấu tổ chức, nhân sự, lương; luồng duyệt nhiều bước (request_steps, decide_step, mark_paid, my_approval_queue)
  010_ban_giam_doc_duyet.sql Ban Giám đốc duyệt thay khi Trưởng phòng / Kế toán chưa có người
  011_kho_r2.sql            files.store / files.thumb (tệp ở Supabase hay R2), hàm storage_paths_ok() cho Edge Function kho-anh
  012a_tra_lai_gia_tri.sql  thêm giá trị 'tra_lai' cho enum request_status
  012_tra_lai_sua_xoa.sql   Trả lại (return_step) / gửi lại (resubmit_request, duyệt lại từ cấp đầu); Sửa/Xoá chỉ khi trả lại, từ chối hoặc đã rút
  013a_anh_loai_phong_gia_tri.sql  thêm loại tệp 'anh_loai_phong'
  013_loai_phong.sql        bảng room_types (ảnh, diện tích, nội thất, giá theo loại), rooms.room_type_id, trigger điền tên loại vào rooms.room_type
  014a_cong_tac_vien_gia_tri.sql  thêm vai trò 'cong_tac_vien'
  014_cong_tac_vien.sql     Cộng tác viên: app_role() = NULL (không thấy dữ liệu nghiệp vụ), is_active_user(), hàm vacant_rooms(); chỉ xem bản đồ + phòng trống (/phong-trong)
  015_tk_ngan_hang_toa.sql  bảng building_bank_accounts: tài khoản nhận tiền riêng từng toà (QR tiền thuê + cọc trong hợp đồng)
  016_hoa_don_gtgt.sql      tenants.id_address, vat_daily_report(ngày) cho Quản lý/Kế toán, cron 21:00 báo danh sách xuất hoá đơn GTGT; trang /hoa-don-gtgt + tải Excel
  017_ctv_khong_doi_mat_khau.sql   trigger ctv_pw_guard: Cộng tác viên không tự đổi mật khẩu; quản lý đặt lại qua Edge Function (mở khoá 60 giây)
  018a_anh_toa_gia_tri.sql, 018_anh_toa.sql   ảnh đại diện toà nhà (kind anh_toa, thư mục anh-toa/ công khai trên R2); building_map() trả thêm photo_path/photo_store/photo_thumb
  019_chinh_sach_toa.sql   bảng building_policy (phí dịch vụ, tiện ích, cọc, hoa hồng CTV theo toà; Quản lý ghi, mọi người đọc qua building_policies()); rooms.furniture; trigger rooms_guard (người không quản lý toà chỉ đổi trạng thái và ghi chú)
  019b_du_lieu_339_le_van_si.sql   dữ liệu toà 339 Lê Văn Sĩ theo sơ đồ 10/11/2026 (17 phòng, chính sách)
  thu_nghiem/                seed.sql / cleanup.sql: tài khoản + toà thử nghiệm (không phải migration)
  functions/quan-ly-tai-khoan    cấp / khoá tài khoản, đổi SĐT, cấp lại mật khẩu (dùng service role)
  functions/phan-tich-giao-viec  ghi âm / tin nhắn → danh sách việc (Gemini)
  functions/kho-anh          ký link tải lên / xem tệp trên Cloudflare R2 (SigV4), hỏi quyền qua storage_paths_ok; cần secrets R2_*
  functions/sepay-webhook        nhận "tiền vào tài khoản" từ SePay, tự đánh dấu hoá đơn đã thu (không dùng JWT, tự kiểm khoá)
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

## Bản đồ

Màn hình Bản đồ dùng MapLibre GL JS (thư viện mã nguồn mở) với nền bản đồ OpenFreeMap (`tiles.openfreemap.org`):
miễn phí, không cần đăng ký hay khoá, cho phép dùng cho doanh nghiệp, phải giữ dòng ghi công OpenStreetMap ở góc bản đồ.
Kiểu `liberty` cho giao diện sáng, `dark` cho chế độ tối; nhãn ưu tiên tên tiếng Việt (`name:vi`).
Toạ độ lấy từ cột `lat`, `lng` của bảng `buildings` qua hàm `building_map()`.

Lưu ý:
- Không dùng `tile.openstreetmap.org` vì mạng công ty không kết nối được máy chủ đó.
- MapLibre 6 chạy phần xử lý trong web worker riêng: `MapPage.tsx` gọi `setWorkerUrl()` với file worker do Vite xuất ra (`?url`).
- Thư viện bản đồ khá nặng (~300 KB nén) nên trang Bản đồ được tải riêng khi mở.
- Muốn đổi sang Google Maps nhiều ghim thì phải dùng Google Maps JavaScript API (cần khoá + thanh toán Google Cloud).

## Môi trường thử nghiệm

Bản thử có địa chỉ cố định https://neo-nestly-thu-nghiem.vercel.app (alias trên Vercel, trỏ vào bản preview mới nhất cần thử).
Dữ liệu dùng chung CSDL thật; tài khoản/toà thử tạo bằng `supabase/thu_nghiem/seed.sql`, xoá bằng `cleanup.sql`.

## Thu tiền chuyển khoản (SePay)

1. Quản lý vào Quản trị → Thu tiền chuyển khoản, nhập ngân hàng và số tài khoản nhận tiền.
2. Đăng ký SePay (sepay.vn), liên kết đúng tài khoản đó. Thêm webhook trỏ tới `https://<project>.supabase.co/functions/v1/sepay-webhook`, kiểu chứng thực API Key.
3. Đặt cùng chuỗi API Key vào Supabase → Edge Functions → Secrets với tên `SEPAY_WEBHOOK_KEY`.
4. Mỗi hoá đơn có mã `NN` + 10 ký tự (cột `invoices.pay_code`) đặt làm nội dung chuyển khoản. Tiền về, hàm `apply_bank_transfer()` khớp mã và số tiền: đủ tiền thì đánh dấu đã thu, thiếu thì chỉ báo cho Quản lý/Giám sát. Mọi giao dịch được ghi ở `bank_transactions`.

Mã QR sinh ngay trên máy (chuẩn VietQR/NAPAS, `src/lib/vietqr.ts`), không gọi dịch vụ ngoài.

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
- Dashboard doanh thu (hàm `dashboard_month` đã có, chưa có màn hình).
- Nhật ký ai đã xem ảnh CCCD (hiện chỉ giới hạn quyền xem, chưa ghi lịch sử xem).

## Kho ảnh trên Cloudflare R2

Hai bucket: ảnh phòng (công khai qua tên miền ảnh) và tài liệu riêng tư (CCCD, hợp đồng, chứng từ). Cơ sở dữ liệu chỉ giữ đường dẫn tệp (`files.path`) và nơi lưu (`files.store`).

Secrets của Edge Function `kho-anh` (đặt trong Supabase, không bao giờ xuống trình duyệt):
`R2_ACCOUNT_ID`, `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`, `R2_BUCKET_PUBLIC`, `R2_BUCKET_PRIVATE`, `R2_PUBLIC_BASE_URL`.

Mỗi bucket cần CORS cho phép `PUT`/`GET`/`HEAD` từ địa chỉ web của app, header `Content-Type`.
Thiếu secrets thì hàm báo `enabled: false` và app dùng kho Supabase như cũ.


## Giao diện (v mới)
- Khung: logo góc trái (bấm = Trang chủ), menu Ứng dụng, chuông, chế độ sáng/tối (`src/shell.css`).
- Route: `/` Trang chủ (Chờ bạn duyệt, Bàn làm việc, Lịch), `/viec` Công việc, `/van-phong` hub, `/van-phong/ds/:kind` danh sách dạng bảng.
- Logo: `public/logo-neo-nestly.svg` / `.png`.
- `020_mau_nhom_phong.sql`: màu nhóm phòng (room_types.color); trạng thái đỏ = đang cho thuê.
- `021_gia_658_cmt8.sql`: giá niêm yết và 2 nhóm phòng (Studio cửa sổ / ban công) của 658 CMT8.
- `022_noi_that_toa.sql`: danh mục nội thất của toà trong chính sách; giao diện có chế độ "Khách xem" ẩn ký hợp đồng và hoa hồng.
- `023_ghi_chu_toa.sql`: buildings.public_note (ghi chú toà hiện ở Phòng trống); vacant_rooms() trả thêm building_note.
- 024_gia_658_cap_nhat.sql: cập nhật giá G01, 201 của 658 CMT8 theo sơ đồ mới.
- 025a_khach_hang_gia_tri.sql, 025_khach_hang.sql: vai trò khach_hang (CCCD duy nhất, ẩn hoa hồng ngay ở CSDL), phản ánh khách ↔ công ty (tự kết thúc sau 3 ngày). Đã chạy. Edge Function quan-ly-tai-khoan thêm create_customer / reset_customer_password (Quản lý, Giám sát, Sale tạo khách).
- 026_phan_anh_theo_phong.sql: phản ánh gắn toà + phòng (khách chọn), Sale phụ trách = nhân viên được gán toà + người tạo tài khoản khách; hộp phản ánh /phan-anh cho nhân sự.
- 027_khach_o_phong.sql: khách được gán toà + phòng (customer_profiles.building_id/room_id, nhân sự gán qua customer_assign_room); khách gửi phản ánh tự động đúng toà/phòng của mình, không tự chọn.
- 028_phan_anh_ctv_anh.sql: CTV gửi phản ánh (không gắn toà/phòng, chỉ Lead Sale trở lên = Quản lý, Giám sát, Leader/L2+ trong sơ đồ công ty đọc và trả lời); ảnh đính kèm phản ánh (bảng feedback_attachments, thư mục phan-anh/ trên kho ảnh, Edge Function kho-anh nhận thêm thư mục này). Có sửa lỗi tiêu đề thông báo khi khách chưa gán phòng.
