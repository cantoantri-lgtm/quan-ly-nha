-- Khách hàng thanh toán: tiền phòng, điện, nước, phí dịch vụ, tiền cọc → chuyển khoản TPBank
create type public.cbill_kind as enum ('tien_phong','dien','nuoc','phi_dich_vu','tien_coc');
create type public.cbill_status as enum ('chua_thanh_toan','cho_xac_nhan','da_thanh_toan','huy');

-- Tài khoản nhận tiền của khách (1 dòng); Quản lý sửa được
create table public.customer_pay_account (
  id int primary key default 1 check (id = 1),
  bank_bin text not null check (bank_bin ~ '^[0-9]{6}$'),
  bank_name text not null,
  account_no text not null check (account_no ~ '^[0-9]{6,19}$'),
  account_name text not null,
  updated_at timestamptz not null default now()
);
alter table public.customer_pay_account enable row level security;
create policy cpa_select on public.customer_pay_account for select to authenticated using (public.app_role() is not null);
create policy cpa_write on public.customer_pay_account for all to authenticated
  using (public.is_manager()) with check (public.is_manager());
revoke all on public.customer_pay_account from anon;
grant select, insert, update on public.customer_pay_account to authenticated;
insert into public.customer_pay_account values (1, '970423', 'TPBank', '5342501983', 'NEO NESTLY');

create table public.customer_bills (
  id uuid primary key default gen_random_uuid(),
  customer_id uuid not null references public.customer_profiles(id) on delete cascade,
  building_id uuid references public.buildings(id),
  room_id uuid references public.rooms(id),
  kind public.cbill_kind not null,
  period date check (period is null or extract(day from period) = 1),
  amount numeric(14,0) not null check (amount > 0),
  due_date date,
  status public.cbill_status not null default 'chua_thanh_toan',
  pay_code text not null unique default ('KH' || upper(substr(replace(gen_random_uuid()::text,'-',''),1,10))),
  note text,
  reported_at timestamptz,
  reported_note text,
  confirmed_at timestamptz,
  confirmed_by uuid references public.profiles(id) on delete set null,
  created_by uuid references public.profiles(id) on delete set null default auth.uid(),
  created_at timestamptz not null default now()
);
create index on public.customer_bills(customer_id, status);
create index on public.customer_bills(building_id);
create index on public.customer_bills(room_id);
create index on public.customer_bills(created_by);
create index on public.customer_bills(confirmed_by);
alter table public.customer_bills enable row level security;
-- Khách chỉ đọc khoản của mình; nhân sự đọc khoản của khách mình phụ trách. Mọi thay đổi đi qua RPC.
create policy cbills_select on public.customer_bills for select to authenticated
  using (customer_id = (select auth.uid()) or (public.app_role() is not null and public.can_handle_customer(customer_id)));
revoke all on public.customer_bills from anon, authenticated;
grant select on public.customer_bills to authenticated;

-- Thông tin chuyển khoản cho khách
create or replace function public.customer_pay_info()
returns table (bank_bin text, bank_name text, account_no text, account_name text)
language sql stable security definer set search_path = public as $$
  select a.bank_bin, a.bank_name, a.account_no, a.account_name from public.customer_pay_account a
  where public.is_customer() or public.app_role() is not null
$$;
revoke execute on function public.customer_pay_info() from public, anon;
grant execute on function public.customer_pay_info() to authenticated;

-- Nhân sự tạo khoản thu cho khách (toà/phòng lấy theo phòng khách đang ở)
create or replace function public.cbill_create(p_customer uuid, p_kind public.cbill_kind, p_period date,
  p_amount numeric, p_due date, p_note text) returns uuid
language plpgsql security definer set search_path = public as $$
declare c public.customer_profiles; nid uuid; lbl text;
begin
  if public.app_role() is null or not public.can_handle_customer(p_customer) then raise exception 'Không có quyền tạo khoản thu cho khách này'; end if;
  select * into c from public.customer_profiles where id = p_customer;
  if not found then raise exception 'Không phải tài khoản khách hàng'; end if;
  if coalesce(p_amount, 0) <= 0 then raise exception 'Số tiền phải lớn hơn 0'; end if;
  insert into public.customer_bills (customer_id, building_id, room_id, kind, period, amount, due_date, note)
  values (p_customer, c.building_id, c.room_id, p_kind,
          case when p_period is null then null else date_trunc('month', p_period)::date end,
          p_amount, p_due, nullif(btrim(coalesce(p_note, '')), '')) returning id into nid;
  lbl := case p_kind when 'tien_phong' then 'Tiền phòng' when 'dien' then 'Tiền điện' when 'nuoc' then 'Tiền nước'
                     when 'phi_dich_vu' then 'Phí dịch vụ' else 'Tiền cọc' end;
  perform public.notify(p_customer, 'khac', 'Khoản cần thanh toán: ' || lbl, to_char(p_amount, 'FM999G999G999G999') || ' đ', 'bill', nid, 'bill-new-' || nid);
  return nid;
end $$;
revoke execute on function public.cbill_create(uuid, public.cbill_kind, date, numeric, date, text) from public, anon;
grant execute on function public.cbill_create(uuid, public.cbill_kind, date, numeric, date, text) to authenticated;

-- Khách báo "đã chuyển khoản" → chờ nhân sự xác nhận
create or replace function public.cbill_report_paid(p_bill uuid, p_note text) returns void
language plpgsql security definer set search_path = public as $$
declare b public.customer_bills; nm text; u uuid;
begin
  select * into b from public.customer_bills where id = p_bill and customer_id = auth.uid();
  if not found or not public.is_customer() then raise exception 'Không tìm thấy khoản thu'; end if;
  if b.status <> 'chua_thanh_toan' then raise exception 'Khoản này không ở trạng thái chưa thanh toán'; end if;
  update public.customer_bills set status = 'cho_xac_nhan', reported_at = now(), reported_note = left(nullif(btrim(coalesce(p_note,'')), ''), 300)
    where id = p_bill;
  select full_name into nm from public.profiles where id = auth.uid();
  for u in select distinct x from (
      select b.created_by as x
      union select id from public.profiles where role in ('quan_ly','giam_sat') and is_active) s where x is not null loop
    perform public.notify(u, 'khac', 'Khách báo đã chuyển khoản', coalesce(nm,'Khách') || ' · ' || to_char(b.amount,'FM999G999G999G999') || ' đ · ' || b.pay_code, 'bill', b.id, 'bill-rep-' || b.id || '-' || u);
  end loop;
end $$;
revoke execute on function public.cbill_report_paid(uuid, text) from public, anon;
grant execute on function public.cbill_report_paid(uuid, text) to authenticated;

-- Nhân sự xác nhận đã nhận tiền / từ chối (về chưa thanh toán) / huỷ khoản
create or replace function public.cbill_set(p_bill uuid, p_action text) returns void
language plpgsql security definer set search_path = public as $$
declare b public.customer_bills;
begin
  select * into b from public.customer_bills where id = p_bill;
  if not found then raise exception 'Không tìm thấy khoản thu'; end if;
  if public.app_role() is null or not public.can_handle_customer(b.customer_id) then raise exception 'Không có quyền'; end if;
  if p_action = 'xac_nhan' then
    if b.status not in ('chua_thanh_toan','cho_xac_nhan') then raise exception 'Khoản này đã xử lý'; end if;
    update public.customer_bills set status = 'da_thanh_toan', confirmed_at = now(), confirmed_by = auth.uid() where id = p_bill;
    perform public.notify(b.customer_id, 'khac', 'Đã nhận thanh toán', to_char(b.amount,'FM999G999G999G999') || ' đ · ' || b.pay_code, 'bill', b.id, 'bill-ok-' || b.id);
  elsif p_action = 'tu_choi' then
    if b.status <> 'cho_xac_nhan' then raise exception 'Khoản này không chờ xác nhận'; end if;
    update public.customer_bills set status = 'chua_thanh_toan', reported_at = null, reported_note = null where id = p_bill;
    perform public.notify(b.customer_id, 'khac', 'Chưa nhận được tiền', 'Công ty chưa thấy khoản ' || b.pay_code || ' trong tài khoản. Vui lòng kiểm tra lại', 'bill', b.id, 'bill-no-' || b.id || '-' || extract(epoch from now())::bigint);
  elsif p_action = 'huy' then
    if b.status = 'da_thanh_toan' then raise exception 'Khoản đã thanh toán, không huỷ được'; end if;
    update public.customer_bills set status = 'huy' where id = p_bill;
  else raise exception 'Hành động không hợp lệ'; end if;
end $$;
revoke execute on function public.cbill_set(uuid, text) from public, anon;
grant execute on function public.cbill_set(uuid, text) to authenticated;
