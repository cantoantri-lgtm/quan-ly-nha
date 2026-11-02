-- =====================================================================
-- Đề nghị thanh toán (DNTT) đầy đủ: thông tin chứng từ, chi tiết hoá đơn, trừ tạm ứng, đính kèm tệp + liên kết.
-- Chạy sau 007. Không đụng dữ liệu cũ: đề nghị thanh toán cũ vẫn mở bình thường (không có chi tiết).
-- =====================================================================

-- 1) Thông tin chứng từ trên bảng requests
alter table public.requests
  add column if not exists doc_no       text,
  add column if not exists doc_date     date,
  add column if not exists currency     text not null default 'VND',
  add column if not exists loa_no       text,
  add column if not exists pay_method   text,
  add column if not exists pay_type     text,
  add column if not exists vendor_code  text,
  add column if not exists contact_code text,
  add column if not exists contact_name text;

alter table public.requests
  add constraint req_pay_method check (pay_method is null or pay_method in ('tien_mat','chuyen_khoan')),
  add constraint req_pay_type   check (pay_type is null or pay_type in ('nha_cung_cap','hoan_ung','chi_phi_van_hanh','sua_chua','luong_thuong','khac')),
  add constraint req_pay_bank   check (kind <> 'thanh_toan' or pay_method is distinct from 'chuyen_khoan' or coalesce(trim(bank_info), '') <> '');
create unique index if not exists requests_doc_no_key on public.requests(doc_no) where doc_no is not null;

create sequence if not exists public.request_doc_seq;
revoke all on sequence public.request_doc_seq from public, anon, authenticated;

-- Số chứng từ tự cấp (YYMM + số thứ tự), không cho sửa tay; đề nghị thanh toán mới phải có hình thức và loại thanh toán
create or replace function public.tg_requests_doc() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if tg_op = 'INSERT' then
    if new.kind = 'thanh_toan' then
      if new.pay_method is null or new.pay_type is null then
        raise exception 'Chọn hình thức thanh toán và loại thanh toán';
      end if;
      new.doc_no := to_char(now() at time zone 'Asia/Ho_Chi_Minh', 'YYMM') || lpad(nextval('public.request_doc_seq')::text, 4, '0');
      new.doc_date := (now() at time zone 'Asia/Ho_Chi_Minh')::date;
      new.currency := 'VND';
    else
      new.doc_no := null; new.doc_date := null;
    end if;
  elsif auth.uid() is not null then
    new.doc_no := old.doc_no; new.doc_date := old.doc_date;
  end if;
  return new;
end $$;
create trigger requests_doc before insert or update on public.requests
  for each row execute function public.tg_requests_doc();
revoke execute on function public.tg_requests_doc() from public, anon, authenticated;

-- 2) Chi tiết thanh toán (từng hoá đơn / khoản chi)
create table public.request_lines (
  id             uuid primary key default gen_random_uuid(),
  request_id     uuid not null references public.requests(id) on delete cascade,
  line_no        int  not null default 1,
  invoice_serial text,
  invoice_no     text,
  invoice_date   date,
  seller_name    text,
  seller_tax     text,
  amount_pre_vat bigint not null check (amount_pre_vat > 0),
  quantity       numeric(12,2),
  vat_pct        numeric(4,1) not null default 0 check (vat_pct between 0 and 100),
  vat_amount     bigint not null default 0,
  total          bigint not null default 0,
  description    text,
  cost_center    text not null check (length(trim(cost_center)) > 0),
  object_ref     text,
  created_at     timestamptz not null default now()
);
create index on public.request_lines(request_id);

-- 3) Chi tiết tạm ứng trừ vào đề nghị
create table public.request_advances (
  id          uuid primary key default gen_random_uuid(),
  request_id  uuid not null references public.requests(id) on delete cascade,
  amount      bigint not null check (amount > 0),
  description text,
  created_at  timestamptz not null default now()
);
create index on public.request_advances(request_id);

-- 4) Liên kết đính kèm (thêm link thay vì tải tệp)
create table public.request_links (
  id          uuid primary key default gen_random_uuid(),
  request_id  uuid not null references public.requests(id) on delete cascade,
  url         text not null check (url ~* '^https?://' and length(url) <= 1000),
  title       text,
  created_by  uuid references public.profiles(id) on delete set null default auth.uid(),
  created_at  timestamptz not null default now()
);
create index on public.request_links(request_id);

-- Tính tiền: VAT và tổng do CSDL tính; số tiền đề nghị = tổng thanh toán − tạm ứng
create or replace function public.tg_request_lines_calc() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  new.vat_amount := round(new.amount_pre_vat * coalesce(new.vat_pct, 0) / 100.0);
  new.total := new.amount_pre_vat + new.vat_amount;
  return new;
end $$;
create trigger request_lines_calc before insert or update on public.request_lines
  for each row execute function public.tg_request_lines_calc();

create or replace function public.tg_request_recalc() returns trigger
language plpgsql security definer set search_path = public as $$
declare rid uuid := coalesce(new.request_id, old.request_id); gross bigint; adv bigint;
begin
  select sum(total) into gross from public.request_lines where request_id = rid;
  if gross is not null then
    select coalesce(sum(amount), 0) into adv from public.request_advances where request_id = rid;
    if gross - adv <= 0 then
      raise exception 'Tiền tạm ứng trừ vào phải nhỏ hơn tổng thanh toán';
    end if;
    update public.requests set amount = gross - adv where id = rid and amount is distinct from gross - adv;
  end if;
  return null;
end $$;
create trigger request_lines_recalc after insert or update or delete on public.request_lines
  for each row execute function public.tg_request_recalc();
create trigger request_advances_recalc after insert or update or delete on public.request_advances
  for each row execute function public.tg_request_recalc();
revoke execute on function public.tg_request_lines_calc(), public.tg_request_recalc() from public, anon, authenticated;

-- 5) Phân quyền: người tạo xem/sửa khi còn chờ duyệt; Quản lý xem tất cả
alter table public.request_lines    enable row level security;
alter table public.request_advances enable row level security;
alter table public.request_links    enable row level security;

create policy rl_select on public.request_lines for select to authenticated
  using (exists (select 1 from public.requests r where r.id = request_id and (r.requester_id = (select auth.uid()) or public.is_manager())));
create policy rl_write on public.request_lines for all to authenticated
  using (exists (select 1 from public.requests r where r.id = request_id and r.requester_id = (select auth.uid()) and r.status = 'cho_duyet'))
  with check (exists (select 1 from public.requests r where r.id = request_id and r.requester_id = (select auth.uid()) and r.status = 'cho_duyet'));

create policy ra_select on public.request_advances for select to authenticated
  using (exists (select 1 from public.requests r where r.id = request_id and (r.requester_id = (select auth.uid()) or public.is_manager())));
create policy ra_write on public.request_advances for all to authenticated
  using (exists (select 1 from public.requests r where r.id = request_id and r.requester_id = (select auth.uid()) and r.status = 'cho_duyet'))
  with check (exists (select 1 from public.requests r where r.id = request_id and r.requester_id = (select auth.uid()) and r.status = 'cho_duyet'));

create policy rk_select on public.request_links for select to authenticated
  using (exists (select 1 from public.requests r where r.id = request_id and (r.requester_id = (select auth.uid()) or public.is_manager())));
create policy rk_insert on public.request_links for insert to authenticated
  with check (exists (select 1 from public.requests r where r.id = request_id
    and ((r.requester_id = (select auth.uid()) and r.status in ('cho_duyet','da_duyet')) or public.is_manager())));
create policy rk_delete on public.request_links for delete to authenticated
  using (exists (select 1 from public.requests r where r.id = request_id
    and ((r.requester_id = (select auth.uid()) and r.status = 'cho_duyet') or public.is_manager())));

revoke all on public.request_lines, public.request_advances, public.request_links from anon;
grant select, insert, update, delete on public.request_lines, public.request_advances to authenticated;
grant select, insert, delete on public.request_links to authenticated;
