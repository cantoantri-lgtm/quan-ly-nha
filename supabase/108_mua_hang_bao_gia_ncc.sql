-- 108: Đề nghị mua hàng 2 bước: duyệt nhu cầu → báo giá NCC → duyệt NCC & giá (26/11/2026)
-- Anh Trí chốt:
--  * Cùng 1 phiếu MH. Bước 1 duyệt nhu cầu (mặc định Leader → Trưởng phòng, loại luồng mua_hang).
--    Bước 2 duyệt NCC & giá (mặc định Kế toán → Giám đốc, loại luồng mua_hang_gia). Sửa được ở Luồng phê duyệt.
--  * Người giữ nhiệm vụ Mua hàng (org_staff.duty = 'mua_hang') nhập báo giá và chọn NCC. Không ai giữ nhiệm vụ này
--    thì người đề nghị tự làm. Quản lý luôn làm thay được.
--  * Theo quy trình mua hàng (Kế hoạch tái cấu trúc, mô tả việc NV mua hàng): đơn trên hạn mức phải có tối thiểu 3 báo giá.
--    Hạn mức lưu ở purchase_settings (mặc định 5.000.000 đ, 3 báo giá), người sửa được luồng duyệt đổi được.
--    Thiếu báo giá hoặc không chọn NCC rẻ nhất thì bắt buộc ghi lý do.
--  * Danh bạ NCC (purchase_vendors) dùng lại; duyệt xong giá thì phiếu tự ghi đơn vị nhận, tài khoản ngân hàng, MST
--    để đề nghị thanh toán dùng.
--  * Chỉ làm đề nghị thanh toán theo phiếu MH khi đã chốt NCC & giá. Phiếu MH cũ (trước 108) giữ cách cũ (buy_stage null).
-- Giai đoạn (requests.buy_stage): nhu_cau → bao_gia → duyet_gia → da_chot. Bước duyệt giá đánh số step_no = 100 × lần + thứ tự.

-- ========== Nhiệm vụ Mua hàng ==========
alter table public.org_staff drop constraint if exists org_staff_duty_check;
alter table public.org_staff add constraint org_staff_duty_check check (duty = any (array['nhan_su', 'ke_toan', 'giam_doc', 'mua_hang']));
-- Vị trí "Nhân viên mua hàng" đang có sẵn trong Sơ đồ: gắn nhiệm vụ Mua hàng nếu chưa có nhiệm vụ khác
update public.org_staff set duty = 'mua_hang'
 where duty is null and position ilike 'Nhân viên mua hàng%' and status in ('co', 'tap_su', 'thu_viec');

-- ========== Cột giai đoạn trên phiếu ==========
alter table public.requests
  add column if not exists buy_stage text check (buy_stage in ('nhu_cau', 'bao_gia', 'duyet_gia', 'da_chot')),
  add column if not exists buy_estimate bigint,
  add column if not exists buy_vendor_id uuid,
  add column if not exists buy_quote_id uuid,
  add column if not exists buy_reason text check (char_length(buy_reason) <= 1000),
  add column if not exists buy_round integer not null default 0;

-- ========== Danh bạ nhà cung cấp ==========
create table public.purchase_vendors (
  id uuid primary key default gen_random_uuid(),
  name text not null check (char_length(btrim(name)) between 2 and 200),
  tax_code text check (tax_code is null or tax_code ~ '^[0-9]{10}([0-9]{3})?$|^[0-9]{10}-[0-9]{3}$'),
  contact_name text check (char_length(contact_name) <= 100),
  phone text check (char_length(phone) <= 30),
  email text check (char_length(email) <= 120),
  address text check (char_length(address) <= 300),
  goods text check (char_length(goods) <= 300),
  bank_name text check (char_length(bank_name) <= 120),
  bank_account text check (char_length(bank_account) <= 40),
  bank_holder text check (char_length(bank_holder) <= 120),
  note text check (char_length(note) <= 500),
  is_active boolean not null default true,
  created_by uuid references public.profiles(id) on delete set null default auth.uid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create unique index purchase_vendors_tax on public.purchase_vendors(tax_code) where tax_code is not null;
create unique index purchase_vendors_name on public.purchase_vendors(lower(btrim(name)));
alter table public.requests add constraint requests_buy_vendor_fk foreign key (buy_vendor_id) references public.purchase_vendors(id) on delete set null;

create or replace function public.can_edit_vendors() returns boolean
language sql stable security definer set search_path = public as $$
  select public.is_active_user() and (public.is_manager() or public.is_duty('mua_hang') or public.is_duty('ke_toan'))
$$;
grant execute on function public.can_edit_vendors() to authenticated;

alter table public.purchase_vendors enable row level security;
revoke all on public.purchase_vendors from anon;
grant select, insert, update on public.purchase_vendors to authenticated;
create policy vendors_select on public.purchase_vendors for select to authenticated
  using (public.app_role() in ('quan_ly', 'giam_sat', 'nhan_vien'));
create policy vendors_insert on public.purchase_vendors for insert to authenticated with check (public.can_edit_vendors());
create policy vendors_update on public.purchase_vendors for update to authenticated
  using (public.can_edit_vendors()) with check (public.can_edit_vendors());

create or replace function public.tg_vendors_touch() returns trigger
language plpgsql set search_path = public as $$
begin
  new.name := btrim(new.name);
  new.tax_code := nullif(regexp_replace(coalesce(new.tax_code, ''), '\s', '', 'g'), '');
  new.updated_at := now();
  if tg_op = 'UPDATE' then new.created_by := old.created_by; new.created_at := old.created_at; end if;
  return new;
end $$;
create trigger purchase_vendors_touch before insert or update on public.purchase_vendors
  for each row execute function public.tg_vendors_touch();

-- ========== Hạn mức báo giá ==========
create table public.purchase_settings (
  id smallint primary key default 1 check (id = 1),
  quote_threshold bigint not null default 5000000 check (quote_threshold >= 0),
  min_quotes smallint not null default 3 check (min_quotes between 1 and 10),
  updated_at timestamptz not null default now(),
  updated_by uuid references public.profiles(id) on delete set null
);
insert into public.purchase_settings (id) values (1) on conflict do nothing;
alter table public.purchase_settings enable row level security;
revoke all on public.purchase_settings from anon, authenticated;
grant select on public.purchase_settings to authenticated;
create policy psettings_select on public.purchase_settings for select to authenticated using (public.app_role() is not null);

create or replace function public.purchase_settings_save(p_threshold bigint, p_min int) returns void
language plpgsql security definer set search_path = public as $$
begin
  if not public.is_flow_admin() then raise exception 'Chỉ người được sửa luồng phê duyệt đổi hạn mức báo giá'; end if;
  if p_threshold is null or p_threshold < 0 or p_min is null or p_min < 1 or p_min > 10 then raise exception 'Hạn mức hoặc số báo giá không hợp lệ'; end if;
  update public.purchase_settings set quote_threshold = p_threshold, min_quotes = p_min, updated_at = now(), updated_by = auth.uid() where id = 1;
end $$;
revoke execute on function public.purchase_settings_save(bigint, int) from public, anon;
grant execute on function public.purchase_settings_save(bigint, int) to authenticated;

-- ========== Ai lấy báo giá ==========
create or replace function public.purchase_has_buyer() returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.org_staff o join public.profiles p on p.id = o.profile_id
                 where o.duty = 'mua_hang' and p.is_active)
$$;

create or replace function public.purchase_can_quote(p_request uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select public.is_active_user() and exists (
    select 1 from public.requests r where r.id = p_request and r.kind = 'mua_hang' and r.buy_stage = 'bao_gia'
      and (public.is_duty('mua_hang') or public.is_manager()
           or (r.requester_id = auth.uid() and not public.purchase_has_buyer())))
$$;
grant execute on function public.purchase_can_quote(uuid) to authenticated;

-- ========== Báo giá ==========
create table public.purchase_quotes (
  id uuid primary key default gen_random_uuid(),
  request_id uuid not null references public.requests(id) on delete cascade,
  vendor_id uuid not null references public.purchase_vendors(id),
  total bigint not null check (total >= 0),
  vat_included boolean not null default true,
  delivery_days integer check (delivery_days between 0 and 365),
  payment_terms text check (char_length(payment_terms) <= 200),
  warranty text check (char_length(warranty) <= 200),
  note text check (char_length(note) <= 500),
  created_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (request_id, vendor_id)
);
create index purchase_quotes_req on public.purchase_quotes(request_id);
alter table public.requests add constraint requests_buy_quote_fk foreign key (buy_quote_id) references public.purchase_quotes(id) on delete set null;
alter table public.purchase_quotes enable row level security;
revoke all on public.purchase_quotes from anon, authenticated;
grant select on public.purchase_quotes to authenticated;
create policy quotes_select on public.purchase_quotes for select to authenticated using (public.can_see_request(request_id));

create or replace function public.purchase_quote_save(p_request uuid, p_id uuid, p_vendor uuid, p_total bigint, p_vat boolean,
  p_delivery int, p_terms text, p_warranty text, p_note text) returns uuid
language plpgsql security definer set search_path = public as $$
declare v_id uuid;
begin
  if not public.purchase_can_quote(p_request) then raise exception 'Phiếu chưa ở bước báo giá hoặc bạn không phải người lấy báo giá'; end if;
  if not exists (select 1 from public.purchase_vendors where id = p_vendor and is_active) then raise exception 'Chọn nhà cung cấp trong danh bạ'; end if;
  if p_total is null or p_total <= 0 then raise exception 'Nhập tổng tiền báo giá'; end if;
  if p_id is null then
    insert into public.purchase_quotes (request_id, vendor_id, total, vat_included, delivery_days, payment_terms, warranty, note, created_by)
    values (p_request, p_vendor, p_total, coalesce(p_vat, true), p_delivery, nullif(btrim(p_terms), ''), nullif(btrim(p_warranty), ''), nullif(btrim(p_note), ''), auth.uid())
    returning id into v_id;
  else
    update public.purchase_quotes set vendor_id = p_vendor, total = p_total, vat_included = coalesce(p_vat, true), delivery_days = p_delivery,
      payment_terms = nullif(btrim(p_terms), ''), warranty = nullif(btrim(p_warranty), ''), note = nullif(btrim(p_note), ''), updated_at = now()
    where id = p_id and request_id = p_request returning id into v_id;
    if v_id is null then raise exception 'Không tìm thấy báo giá'; end if;
  end if;
  return v_id;
exception when unique_violation then
  raise exception 'Nhà cung cấp này đã có báo giá trong phiếu. Sửa báo giá cũ thay vì thêm mới';
end $$;
revoke execute on function public.purchase_quote_save(uuid, uuid, uuid, bigint, boolean, int, text, text, text) from public, anon;
grant execute on function public.purchase_quote_save(uuid, uuid, uuid, bigint, boolean, int, text, text, text) to authenticated;

create or replace function public.purchase_quote_delete(p_id uuid) returns void
language plpgsql security definer set search_path = public as $$
declare rq uuid;
begin
  select request_id into rq from public.purchase_quotes where id = p_id;
  if rq is null then raise exception 'Không tìm thấy báo giá'; end if;
  if not public.purchase_can_quote(rq) then raise exception 'Phiếu chưa ở bước báo giá hoặc bạn không phải người lấy báo giá'; end if;
  update public.requests set buy_quote_id = null where id = rq and buy_quote_id = p_id;
  delete from public.purchase_quotes where id = p_id;
end $$;
revoke execute on function public.purchase_quote_delete(uuid) from public, anon;
grant execute on function public.purchase_quote_delete(uuid) to authenticated;

-- Chọn NCC và trình duyệt NCC & giá
create or replace function public.purchase_price_submit(p_request uuid, p_quote uuid, p_reason text) returns void
language plpgsql security definer set search_path = public as $$
declare
  r public.requests; q public.purchase_quotes; v public.purchase_vendors; cfg public.purchase_settings;
  n int; low bigint; why text := nullif(btrim(coalesce(p_reason, '')), ''); rd int; s public.request_steps; me uuid := auth.uid();
begin
  if not public.purchase_can_quote(p_request) then raise exception 'Phiếu chưa ở bước báo giá hoặc bạn không phải người lấy báo giá'; end if;
  select * into r from public.requests where id = p_request for update;
  select * into q from public.purchase_quotes where id = p_quote and request_id = p_request;
  if not found then raise exception 'Chọn một báo giá của phiếu này'; end if;
  select * into v from public.purchase_vendors where id = q.vendor_id;
  select * into cfg from public.purchase_settings where id = 1;
  select count(*), min(total) into n, low from public.purchase_quotes where request_id = p_request;
  if q.total >= cfg.quote_threshold and n < cfg.min_quotes and why is null then
    raise exception 'Đơn từ % đ cần tối thiểu % báo giá (đang có %). Thêm báo giá hoặc ghi lý do',
      replace(to_char(cfg.quote_threshold, 'FM999,999,999,999'), ',', '.'), cfg.min_quotes, n;
  end if;
  if q.total > low and why is null then raise exception 'NCC được chọn không phải giá thấp nhất. Ghi lý do chọn'; end if;

  rd := r.buy_round + 1;
  perform set_config('app.step_flow', 'on', true);
  perform set_config('app.buy_rpc', 'on', true);
  update public.requests set
    buy_estimate = coalesce(buy_estimate, amount), amount = q.total,
    payee = v.name, vendor_code = v.tax_code,
    bank_info = nullif(concat_ws(' · ', nullif(v.bank_account, ''), nullif(v.bank_name, ''), nullif(v.bank_holder, '')), ''),
    buy_vendor_id = v.id, buy_quote_id = q.id, buy_reason = why, buy_round = rd,
    buy_stage = 'duyet_gia', status = 'cho_duyet'
  where id = p_request;
  perform set_config('app.buy_rpc', 'off', true);
  perform set_config('app.step_flow', 'off', true);

  insert into public.request_steps (request_id, step_no, duty, approver_id, status, skip_reason)
  select p_request, rd * 100 + c.step_no, c.duty, c.approver_id,
         case when c.skip_reason is null and c.approver_id is distinct from me then 'cho' else 'bo_qua' end,
         coalesce(c.skip_reason, case when c.approver_id = me then 'Chính người báo giá' end)
  from public.approval_chain(r.requester_id, 'mua_hang_gia') c;

  select * into s from public.request_steps where request_id = p_request and status = 'cho' order by step_no limit 1;
  if not found then
    perform set_config('app.step_flow', 'on', true);
    update public.requests set status = 'da_duyet', decision_note = 'Tự động duyệt: không có người duyệt NCC & giá' where id = p_request;
    perform set_config('app.step_flow', 'off', true);
  else
    perform public.notify_step(p_request, s, 'Đề nghị mua hàng cần duyệt NCC & giá');
  end if;
end $$;
revoke execute on function public.purchase_price_submit(uuid, uuid, text) from public, anon;
grant execute on function public.purchase_price_submit(uuid, uuid, text) to authenticated;

-- ========== Giai đoạn theo trạng thái (chạy sau requests_guard) ==========
create or replace function public.tg_requests_buy_stage() returns trigger
language plpgsql security definer set search_path = public as $$
declare rpc boolean := coalesce(current_setting('app.buy_rpc', true), '') = 'on';
begin
  if tg_op = 'INSERT' then
    if new.kind = 'mua_hang_gia' then raise exception 'Không tạo được phiếu loại này'; end if;
    if new.kind = 'mua_hang' then new.buy_stage := 'nhu_cau'; else new.buy_stage := null; end if;
    new.buy_estimate := null; new.buy_vendor_id := null; new.buy_quote_id := null; new.buy_reason := null; new.buy_round := 0;
    return new;
  end if;
  if not rpc then
    new.buy_stage := old.buy_stage; new.buy_estimate := old.buy_estimate; new.buy_vendor_id := old.buy_vendor_id;
    new.buy_quote_id := old.buy_quote_id; new.buy_reason := old.buy_reason; new.buy_round := old.buy_round;
  end if;
  if new.kind <> 'mua_hang' or new.buy_stage is null or new.status is not distinct from old.status then return new; end if;

  if old.status = 'cho_duyet' and new.status = 'da_duyet' then
    if new.buy_stage = 'nhu_cau' then new.buy_stage := 'bao_gia';
    elsif new.buy_stage = 'duyet_gia' then new.buy_stage := 'da_chot';
    end if;
  elsif new.buy_stage = 'duyet_gia' and new.status in ('tu_choi', 'tra_lai') then
    -- Không duyệt giá: nhu cầu vẫn được duyệt, quay về bước báo giá
    new.status := 'da_duyet'; new.buy_stage := 'bao_gia';
  end if;
  return new;
end $$;
drop trigger if exists requests_zz_buy_stage on public.requests;
create trigger requests_zz_buy_stage before insert or update on public.requests
  for each row execute function public.tg_requests_buy_stage();

-- Thông báo theo giai đoạn
create or replace function public.purchase_stage_notify(p_new public.requests, p_old public.requests) returns void
language plpgsql security definer set search_path = public as $$
declare who text; what text; m record; vname text;
begin
  select full_name into who from public.profiles where id = p_new.requester_id;
  what := 'Đề nghị mua hàng' || coalesce(' ' || p_new.doc_no, '') || ' · ' || left(coalesce(p_new.reason, ''), 80);
  if p_old.buy_stage = 'nhu_cau' and p_new.buy_stage = 'bao_gia' then
    perform public.notify(p_new.requester_id, 'khac', 'Đã duyệt nhu cầu mua hàng, chờ báo giá', what, 'request', p_new.id);
    for m in select distinct o.profile_id id from public.org_staff o join public.profiles p on p.id = o.profile_id
             where o.duty = 'mua_hang' and p.is_active and o.profile_id <> p_new.requester_id loop
      perform public.notify(m.id, 'khac', 'Cần lấy báo giá NCC', coalesce(who, '?') || ': ' || what, 'request', p_new.id);
    end loop;
  elsif p_old.buy_stage = 'duyet_gia' and p_new.buy_stage = 'bao_gia' then
    for m in select p_new.requester_id id union
             select o.profile_id from public.org_staff o join public.profiles p on p.id = o.profile_id where o.duty = 'mua_hang' and p.is_active loop
      perform public.notify(m.id, 'khac', 'Chưa duyệt NCC & giá, cần báo giá lại',
        what || coalesce(' — ' || nullif(btrim(p_new.decision_note), ''), ''), 'request', p_new.id);
    end loop;
  elsif p_new.buy_stage = 'da_chot' and p_old.buy_stage is distinct from 'da_chot' then
    select name into vname from public.purchase_vendors where id = p_new.buy_vendor_id;
    for m in select p_new.requester_id id union
             select o.profile_id from public.org_staff o join public.profiles p on p.id = o.profile_id where o.duty = 'mua_hang' and p.is_active loop
      perform public.notify(m.id, 'khac', 'Đã duyệt NCC & giá, tiến hành mua',
        what || ' · ' || coalesce(vname, '?') || ' · ' || replace(to_char(p_new.amount, 'FM999,999,999,999'), ',', '.') || ' đ', 'request', p_new.id);
    end loop;
  end if;
end $$;
revoke execute on function public.purchase_stage_notify(public.requests, public.requests) from public, anon, authenticated;

do $$
declare d text;
begin
  -- Cho phép trình lại phiếu mua hàng từ "đã duyệt nhu cầu" sang "chờ duyệt NCC & giá" (chỉ qua purchase_price_submit)
  d := pg_get_functiondef('public.tg_requests_guard()'::regprocedure);
  if position($x$      elsif flow and old.status in ('nhap','tra_lai','tu_choi','da_huy') and new.status = 'cho_duyet' then$x$ in d) = 0 then
    raise exception 'tg_requests_guard đã khác';
  end if;
  d := replace(d, $x$      elsif flow and old.status in ('nhap','tra_lai','tu_choi','da_huy') and new.status = 'cho_duyet' then$x$,
    $x$      elsif flow and old.status = 'da_duyet' and new.status = 'cho_duyet' and old.kind = 'mua_hang'
            and coalesce(current_setting('app.buy_rpc', true), '') = 'on' then
        new.approver_id := null; new.decided_at := null; new.decision_note := null;
      elsif flow and old.status in ('nhap','tra_lai','tu_choi','da_huy') and new.status = 'cho_duyet' then$x$);
  execute d;

  -- Thông báo: phiếu mua hàng 2 bước dùng thông báo riêng theo giai đoạn
  d := pg_get_functiondef('public.tg_requests_notify()'::regprocedure);
  if position($x$  if tg_op = 'INSERT' then return null; end if;$x$ in d) = 0 then raise exception 'tg_requests_notify đã khác'; end if;
  d := replace(d, $x$  if tg_op = 'INSERT' then return null; end if;$x$,
    $x$  if tg_op = 'INSERT' then return null; end if;
  if new.kind = 'mua_hang' and new.buy_stage is not null and new.buy_stage is distinct from old.buy_stage then
    perform public.purchase_stage_notify(new, old);
    return null;
  end if;$x$);
  execute d;

  -- Người mua hàng tải được báo giá vào phiếu ở bước báo giá
  d := pg_get_functiondef('public.storage_path_ok(text,boolean)'::regprocedure);
  if position($x$      return rq.requester_id = auth.uid() or public.is_manager()
        or (public.is_payer() and rq.kind in ('thanh_toan','tam_ung') and rq.status = 'da_duyet');$x$ in d) = 0 then
    raise exception 'storage_path_ok đã khác';
  end if;
  d := replace(d, $x$      return rq.requester_id = auth.uid() or public.is_manager()
        or (public.is_payer() and rq.kind in ('thanh_toan','tam_ung') and rq.status = 'da_duyet');$x$,
    $x$      return rq.requester_id = auth.uid() or public.is_manager()
        or (public.is_payer() and rq.kind in ('thanh_toan','tam_ung') and rq.status = 'da_duyet')
        or (rq.kind = 'mua_hang' and public.purchase_can_quote(o));$x$);
  execute d;

  -- Người mua hàng xem được phiếu từ khi duyệt xong nhu cầu
  d := pg_get_functiondef('public.can_see_request(uuid)'::regprocedure);
  if position($x$      or (r.kind = 'mua_hang' and r.status <> 'nhap' and public.purchase_linked_visible(r.id))$x$ in d) = 0 then
    raise exception 'can_see_request đã khác';
  end if;
  d := replace(d, $x$      or (r.kind = 'mua_hang' and r.status <> 'nhap' and public.purchase_linked_visible(r.id))$x$,
    $x$      or (r.kind = 'mua_hang' and r.status <> 'nhap' and public.purchase_linked_visible(r.id))
      or (r.kind = 'mua_hang' and r.buy_stage in ('bao_gia', 'duyet_gia', 'da_chot') and public.is_duty('mua_hang'))$x$);
  execute d;

  -- Đề nghị thanh toán chỉ tham chiếu phiếu MH đã chốt NCC & giá (phiếu cũ không có giai đoạn: như trước)
  d := pg_get_functiondef('public.purchase_pickable()'::regprocedure);
  if position($x$where p.kind = 'mua_hang' and p.status in ('da_duyet','hoan_tat') and public.can_see_request(p.id)$x$ in d) = 0 then
    raise exception 'purchase_pickable đã khác';
  end if;
  d := replace(d, $x$where p.kind = 'mua_hang' and p.status in ('da_duyet','hoan_tat') and public.can_see_request(p.id)$x$,
    $x$where p.kind = 'mua_hang' and p.status in ('da_duyet','hoan_tat') and coalesce(p.buy_stage, 'da_chot') = 'da_chot' and public.can_see_request(p.id)$x$);
  execute d;

  d := pg_get_functiondef('public.tg_requests_purchase_guard()'::regprocedure);
  if position($x$p.kind = 'mua_hang' and p.status in ('da_duyet','hoan_tat'))$x$ in d) = 0 then raise exception 'tg_requests_purchase_guard đã khác'; end if;
  d := replace(d, $x$p.kind = 'mua_hang' and p.status in ('da_duyet','hoan_tat'))$x$,
    $x$p.kind = 'mua_hang' and p.status in ('da_duyet','hoan_tat') and coalesce(p.buy_stage, 'da_chot') = 'da_chot')$x$);
  d := replace(d, 'Chỉ tham chiếu được đề nghị mua hàng đã duyệt xong', 'Chỉ tham chiếu được đề nghị mua hàng đã duyệt xong NCC & giá');
  execute d;
end $$;

drop policy if exists requests_select_buyer on public.requests;
create policy requests_select_buyer on public.requests for select to authenticated
  using (kind = 'mua_hang' and buy_stage in ('bao_gia', 'duyet_gia', 'da_chot') and public.is_duty('mua_hang'));

-- Hàng đợi: người lấy báo giá thấy phiếu chờ báo giá
create or replace function public.my_approval_queue()
returns table(request_id uuid, phase text)
language sql stable security definer set search_path = public as $$
  select r.id, 'duyet'::text from public.requests r
   where r.status = 'cho_duyet' and r.requester_id <> auth.uid() and public.app_role() is not null
     and exists (select 1 from (select s.* from public.request_steps s where s.request_id = r.id and s.status = 'cho'
                                order by s.step_no limit 1) cur
                 where cur.approver_id = auth.uid() or (cur.approver_id is null and public.is_manager()))
  union all
  select r.id, 'chi'::text from public.requests r
   where r.status = 'da_duyet' and r.kind in ('thanh_toan','tam_ung') and public.app_role() is not null
     and (public.is_manager() or public.is_duty('ke_toan'))
  union all
  select r.id, 'bao_gia'::text from public.requests r
   where r.kind = 'mua_hang' and r.buy_stage = 'bao_gia' and public.app_role() is not null
     and (public.is_duty('mua_hang') or (r.requester_id = auth.uid() and not public.purchase_has_buyer()))
$$;

-- Luồng mặc định
create or replace function public.default_flow(p_kind public.request_kind) returns text[]
language sql immutable as $$
  select case
    when p_kind = 'mua_hang' then array['leader','truong_phong']
    when p_kind = 'mua_hang_gia' then array['ke_toan','giam_doc']
    when p_kind in ('thanh_toan','tam_ung','loa') then array['leader','truong_phong','ke_toan','giam_doc']
    else array['leader','truong_phong','nhan_su'] end
$$;

create or replace function public.request_label(k public.request_kind, s text) returns text
language sql immutable set search_path = public as $$
  select case k
    when 'nghi_phep' then case s when 'khong_luong' then 'Nghỉ không lương' else 'Nghỉ phép năm' end
    when 'ra_ngoai'  then 'Làm việc bên ngoài'
    when 'cong_tac'  then 'Đi công tác'
    when 'thanh_toan' then 'Đề nghị thanh toán'
    when 'tam_ung'   then 'Đề nghị tạm ứng'
    when 'loa'       then 'Tờ trình (LOA)'
    when 'mua_hang'  then 'Đề nghị mua hàng'
    when 'mua_hang_gia' then 'Duyệt NCC & giá'
  end
$$;
