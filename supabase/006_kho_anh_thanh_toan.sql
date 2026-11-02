-- =====================================================================
-- Neo Nestly · KHO ẢNH + KHÁCH THUÊ (CCCD, đánh dấu) + THU TIỀN PHÒNG QUA CHUYỂN KHOẢN
-- Chạy sau 005. Gồm:
--   1. Kho tệp riêng tư (Storage bucket `kho-tai-lieu`) + bảng `files`
--   2. Khách thuê: đánh dấu, ghi nhận đồng ý lưu CCCD
--   3. Hợp đồng: cách ký (giấy / điện tử)
--   4. Thu tiền: thông tin tài khoản công ty, mã nội dung chuyển khoản, nhật ký giao dịch ngân hàng,
--      hàm tự đối soát (gọi từ Edge Function `sepay-webhook`), trang thanh toán công khai
-- =====================================================================

-- ---------- 1. KHO TỆP ----------
-- Quy ước đường dẫn trong bucket:  <thư mục>/<mã chủ>/<uuid>.<đuôi>
--   cccd/<toà>/…        CCCD khách thuê      xem + tải lên: Quản lý, Giám sát của toà
--   hop-dong/<toà>/…    hợp đồng              xem: thành viên toà · tải lên: Quản lý, Giám sát
--   anh-phong/<toà>/…   ảnh phòng             xem + tải lên: thành viên toà
--   de-nghi/<đề nghị>/… đính kèm đề nghị      người tạo đề nghị + Quản lý
create or replace function public.storage_path_ok(p_name text, p_write boolean) returns boolean
language plpgsql stable security definer set search_path = public as $$
declare
  parts text[] := string_to_array(coalesce(p_name, ''), '/');
  o uuid;
begin
  if public.app_role() is null or array_length(parts, 1) < 3 then return false; end if;
  begin o := parts[2]::uuid; exception when others then return false; end;
  return case parts[1]
    when 'cccd'      then public.can_manage_building(o)
    when 'hop-dong'  then case when p_write then public.can_manage_building(o) else public.can_access_building(o) end
    when 'anh-phong' then public.can_access_building(o)
    when 'de-nghi'   then exists (select 1 from public.requests r
                                  where r.id = o and (r.requester_id = auth.uid() or public.is_manager()))
    else false end;
end $$;
revoke execute on function public.storage_path_ok(text, boolean) from public, anon;
grant execute on function public.storage_path_ok(text, boolean) to authenticated;

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('kho-tai-lieu', 'kho-tai-lieu', false, 10485760,
        array['image/jpeg', 'image/png', 'image/webp', 'application/pdf'])
on conflict (id) do update set public = false, file_size_limit = 10485760,
  allowed_mime_types = array['image/jpeg', 'image/png', 'image/webp', 'application/pdf'];

create policy kho_select on storage.objects for select to authenticated
  using (bucket_id = 'kho-tai-lieu' and public.storage_path_ok(name, false));
create policy kho_insert on storage.objects for insert to authenticated
  with check (bucket_id = 'kho-tai-lieu' and public.storage_path_ok(name, true));
create policy kho_delete on storage.objects for delete to authenticated
  using (bucket_id = 'kho-tai-lieu' and public.storage_path_ok(name, true));

create type public.file_kind as enum ('cccd', 'hop_dong', 'anh_phong', 'dinh_kem_de_nghi');

create table public.files (
  id          uuid primary key default gen_random_uuid(),
  kind        public.file_kind not null,
  path        text not null unique,
  file_name   text,
  mime_type   text,
  size_bytes  int,
  building_id uuid references public.buildings(id) on delete cascade,
  tenant_id   uuid references public.tenants(id) on delete cascade,
  contract_id uuid references public.contracts(id) on delete cascade,
  room_id     uuid references public.rooms(id) on delete cascade,
  request_id  uuid references public.requests(id) on delete cascade,
  label       text,                         -- cccd: 'truoc' | 'sau' | 'khac'
  is_cover    boolean not null default false,
  created_by  uuid references public.profiles(id) on delete set null default auth.uid(),
  created_at  timestamptz not null default now(),
  constraint files_shape check (case kind
    when 'cccd'             then tenant_id is not null
    when 'hop_dong'         then contract_id is not null
    when 'anh_phong'        then room_id is not null
    else request_id is not null end),
  constraint files_path_kind check (path like (case kind
    when 'cccd' then 'cccd/' when 'hop_dong' then 'hop-dong/'
    when 'anh_phong' then 'anh-phong/' else 'de-nghi/' end) || '%')
);
create index on public.files(tenant_id) where tenant_id is not null;
create index on public.files(contract_id) where contract_id is not null;
create index on public.files(room_id) where room_id is not null;
create index on public.files(request_id) where request_id is not null;
create index on public.files(building_id);
create index on public.files(created_by);
create unique index files_one_cover_per_room on public.files(room_id) where is_cover;

-- Kiểm tra chủ của tệp khớp với đường dẫn; CCCD chỉ lưu khi khách đã đồng ý
create or replace function public.tg_files_before() returns trigger
language plpgsql security definer set search_path = public as $$
declare owner uuid := (string_to_array(new.path, '/'))[2]::uuid; b uuid; consent timestamptz;
begin
  if tg_op = 'UPDATE' then
    if to_jsonb(new) - 'is_cover' - 'label' is distinct from to_jsonb(old) - 'is_cover' - 'label' then
      raise exception 'Chỉ được đổi nhãn hoặc ảnh đại diện của tệp';
    end if;
    return new;
  end if;
  if new.kind = 'cccd' then
    select building_id, cccd_consent_at into b, consent from public.tenants where id = new.tenant_id;
    if consent is null then raise exception 'Cần ghi nhận khách đã đồng ý cho lưu ảnh CCCD trước khi tải ảnh lên'; end if;
  elsif new.kind = 'hop_dong' then
    select building_id into b from public.contracts where id = new.contract_id;
  elsif new.kind = 'anh_phong' then
    select building_id into b from public.rooms where id = new.room_id;
  else
    select building_id into b from public.requests where id = new.request_id;
    if owner is distinct from new.request_id then raise exception 'Đường dẫn tệp không khớp đề nghị'; end if;
    new.building_id := b;
    return new;
  end if;
  if b is null or owner is distinct from b then raise exception 'Đường dẫn tệp không khớp toà'; end if;
  new.building_id := b;
  return new;
end $$;
create trigger files_before before insert or update on public.files
  for each row execute function public.tg_files_before();
revoke execute on function public.tg_files_before() from public, anon, authenticated;

alter table public.files enable row level security;
create policy files_select on public.files for select to authenticated using (public.storage_path_ok(path, false));
create policy files_insert on public.files for insert to authenticated
  with check (created_by = (select auth.uid()) and public.storage_path_ok(path, true));
create policy files_update on public.files for update to authenticated
  using (public.storage_path_ok(path, true)) with check (public.storage_path_ok(path, true));
create policy files_delete on public.files for delete to authenticated using (public.storage_path_ok(path, true));
revoke all on public.files from anon;
grant select, insert, update, delete on public.files to authenticated;

-- ---------- 2. KHÁCH THUÊ ----------
alter table public.tenants
  add column if not exists flag             text check (flag in ('luu_y', 'quen')),   -- đánh dấu: cần lưu ý / khách quen
  add column if not exists flag_note        text,
  add column if not exists id_issued_date   date,
  add column if not exists id_issued_place  text,
  add column if not exists cccd_consent_at  timestamptz,   -- thời điểm khách đồng ý cho lưu CCCD
  add column if not exists cccd_consent_by  uuid references public.profiles(id) on delete set null,
  add column if not exists cccd_consent_note text;         -- VD: "đồng ý trực tiếp", "đồng ý qua Zalo ngày…"
create index if not exists tenants_consent_by_idx on public.tenants(cccd_consent_by);

create or replace function public.tg_tenants_before() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.cccd_consent_at is not null and (tg_op = 'INSERT' or old.cccd_consent_at is null) then
    new.cccd_consent_by := coalesce(auth.uid(), new.cccd_consent_by);
  elsif new.cccd_consent_at is null then
    new.cccd_consent_by := null; new.cccd_consent_note := null;
  end if;
  return new;
end $$;
create trigger tenants_before before insert or update on public.tenants
  for each row execute function public.tg_tenants_before();
revoke execute on function public.tg_tenants_before() from public, anon, authenticated;

-- ---------- 3. HỢP ĐỒNG ----------
alter table public.contracts
  add column if not exists sign_method text check (sign_method in ('giay', 'dien_tu')),
  add column if not exists signed_on   date;

-- ---------- 4. THU TIỀN QUA CHUYỂN KHOẢN ----------
-- Tài khoản nhận tiền của công ty (một dòng duy nhất). Ai đăng nhập cũng xem được (để hiện QR); chỉ Quản lý sửa.
create table public.payment_settings (
  id           int primary key default 1 check (id = 1),
  bank_bin     text not null,
  bank_name    text not null,
  account_no   text not null,
  account_name text not null,
  updated_by   uuid references public.profiles(id) on delete set null,
  updated_at   timestamptz not null default now()
);
create index on public.payment_settings(updated_by);
alter table public.payment_settings enable row level security;
create policy pay_settings_select on public.payment_settings for select to authenticated using (public.app_role() is not null);
create policy pay_settings_insert on public.payment_settings for insert to authenticated with check (public.is_manager());
create policy pay_settings_update on public.payment_settings for update to authenticated
  using (public.is_manager()) with check (public.is_manager());
revoke all on public.payment_settings from anon;
grant select, insert, update on public.payment_settings to authenticated;
create or replace function public.tg_pay_settings_before() returns trigger
language plpgsql security definer set search_path = public as $$
begin new.updated_at := now(); new.updated_by := coalesce(auth.uid(), new.updated_by); return new; end $$;
create trigger pay_settings_before before insert or update on public.payment_settings
  for each row execute function public.tg_pay_settings_before();
revoke execute on function public.tg_pay_settings_before() from public, anon, authenticated;

-- Mã nội dung chuyển khoản cho từng hoá đơn: NN + 10 ký tự (hex in hoa), chỉ chữ và số để ngân hàng không làm mất
alter table public.invoices
  add column if not exists pay_code text not null default ('NN' || upper(substr(replace(gen_random_uuid()::text, '-', ''), 1, 10))),
  add column if not exists paid_via text check (paid_via in ('thu_cong', 'chuyen_khoan')),
  add column if not exists paid_amount numeric(14,0);
create unique index if not exists invoices_pay_code_key on public.invoices(pay_code);

-- Mã không đổi; chỉ app (Edge Function, auth.uid() rỗng) mới được ghi "chuyển khoản"
create or replace function public.tg_invoices_paycode() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if tg_op = 'UPDATE' then
    new.pay_code := old.pay_code;
    if auth.uid() is not null then
      new.paid_via := case when new.status = 'da_thu' then 'thu_cong' else null end;
      new.paid_amount := case when new.status = 'da_thu' then new.amount else null end;
    end if;
  end if;
  return new;
end $$;
create trigger invoices_paycode before update on public.invoices
  for each row execute function public.tg_invoices_paycode();
revoke execute on function public.tg_invoices_paycode() from public, anon, authenticated;

-- Nhật ký giao dịch ngân hàng nhận từ cổng (SePay). Chỉ Quản lý xem; chỉ hàm hệ thống ghi.
create table public.bank_transactions (
  id          bigint generated always as identity primary key,
  provider    text not null default 'sepay',
  provider_id text not null,
  account_no  text,
  amount      numeric(14,0) not null,
  content     text,
  txn_time    timestamptz,
  invoice_id  uuid references public.invoices(id) on delete set null,
  result      text not null check (result in ('khop', 'khong_khop', 'lech_so_tien', 'da_thu_truoc')),
  raw         jsonb,
  created_at  timestamptz not null default now(),
  unique (provider, provider_id)
);
create index on public.bank_transactions(invoice_id);
alter table public.bank_transactions enable row level security;
create policy bank_txn_select on public.bank_transactions for select to authenticated using (public.is_manager());
revoke all on public.bank_transactions from anon;
grant select on public.bank_transactions to authenticated;

-- Đối soát một giao dịch tiền vào. Chỉ Edge Function (service role) gọi được.
create or replace function public.apply_bank_transfer(
  p_provider text, p_provider_id text, p_account text, p_amount numeric, p_content text, p_time timestamptz, p_raw jsonb
) returns text
language plpgsql security definer set search_path = public as $$
declare
  code text := substring(upper(regexp_replace(coalesce(p_content, ''), '[^A-Za-z0-9]', '', 'g')) from 'NN[0-9A-F]{10}');
  inv public.invoices; res text; txn bigint; room text; bname text;
begin
  if exists (select 1 from public.bank_transactions where provider = p_provider and provider_id = p_provider_id) then
    return 'trung_giao_dich';
  end if;
  select * into inv from public.invoices where pay_code = code;
  if not found then
    res := 'khong_khop';
  elsif inv.status = 'da_thu' then
    res := 'da_thu_truoc';
  elsif p_amount < inv.amount then
    res := 'lech_so_tien';
  else
    res := 'khop';
  end if;

  insert into public.bank_transactions (provider, provider_id, account_no, amount, content, txn_time, invoice_id, result, raw)
  values (p_provider, p_provider_id, p_account, p_amount, p_content, p_time, inv.id, res, p_raw)
  returning id into txn;

  if inv.id is not null then
    select r.code, b.name into room, bname
    from public.contracts c join public.rooms r on r.id = c.room_id join public.buildings b on b.id = c.building_id
    where c.id = inv.contract_id;
  end if;

  if res = 'khop' then
    update public.invoices set status = 'da_thu', paid_via = 'chuyen_khoan', paid_amount = p_amount,
      note = concat_ws(' · ', nullif(note, ''), 'Khách chuyển khoản ' || to_char(coalesce(p_time, now()) at time zone 'Asia/Ho_Chi_Minh', 'DD/MM HH24:MI'))
    where id = inv.id;
  end if;

  if res in ('khop', 'lech_so_tien') then
    perform public.notify(u.id, 'nhac_thu_tien',
      case res when 'khop' then 'Đã nhận tiền phòng ' || room else 'Chuyển thiếu tiền phòng ' || room end,
      bname || ' · nhận ' || to_char(p_amount, 'FM999G999G999G999') || ' đ' ||
        case res when 'lech_so_tien' then ' / cần ' || to_char(inv.amount, 'FM999G999G999G999') || ' đ, hoá đơn chưa đóng' else '' end,
      'building', inv.building_id, 'ck:' || txn || ':' || u.id)
    from public.profiles u
    where u.is_active and (u.role = 'quan_ly'
       or (u.role = 'giam_sat' and exists (select 1 from public.building_members m where m.user_id = u.id and m.building_id = inv.building_id)));
  end if;
  return res;
end $$;
revoke execute on function public.apply_bank_transfer(text, text, text, numeric, text, timestamptz, jsonb) from public, anon, authenticated;
grant execute on function public.apply_bank_transfer(text, text, text, numeric, text, timestamptz, jsonb) to service_role;

-- Trang thanh toán công khai /thanh-toan/<mã>: người có mã (link gửi qua Zalo) xem số tiền và QR, không cần đăng nhập.
-- Chỉ trả: phòng, tháng, số tiền, trạng thái, tài khoản nhận. Không trả tên khách.
create or replace function public.invoice_pay_info(p_code text) returns jsonb
language sql stable security definer set search_path = public as $$
  select jsonb_build_object(
    'pay_code', i.pay_code, 'amount', i.amount, 'status', i.status, 'period', i.period, 'due_date', i.due_date,
    'room', r.code, 'building', b.name,
    'bank_bin', s.bank_bin, 'bank_name', s.bank_name, 'account_no', s.account_no, 'account_name', s.account_name)
  from public.invoices i
  join public.contracts c on c.id = i.contract_id
  join public.rooms r on r.id = c.room_id
  join public.buildings b on b.id = c.building_id
  left join public.payment_settings s on s.id = 1
  where i.pay_code = upper(trim(p_code)) and i.status <> 'huy'
$$;
revoke execute on function public.invoice_pay_info(text) from public;
grant execute on function public.invoice_pay_info(text) to anon, authenticated;
