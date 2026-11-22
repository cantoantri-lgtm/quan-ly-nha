-- 084: Ghi mã giao dịch ngân hàng (SePay referenceCode) vào sổ thu
--  * invoices.txn_ref, invoices.txn_at; customer_bills.txn_ref
--  * apply_bank_transfer: khớp đủ tiền thì đánh dấu đã thu + chuyển khoản + mã giao dịch + giờ tiền về
--  * tg_invoices_paycode: người dùng không tự ghi "chuyển khoản"/mã GD (chỉ SePay ghi). Sửa hoá đơn đã thu
--    mà không đổi trạng thái thì giữ nguyên hình thức và mã GD (trước đây bị đổi thành "thu công").
--  * vat_daily_report: thêm cột txn_ref

alter table public.invoices add column if not exists txn_ref text, add column if not exists txn_at timestamptz;
alter table public.customer_bills add column if not exists txn_ref text;

create or replace function public.tg_invoices_paycode() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if tg_op = 'UPDATE' then
    new.pay_code := old.pay_code;
    if auth.uid() is not null then
      if new.status = 'da_thu' and old.status = 'da_thu' then
        new.paid_via := old.paid_via; new.paid_amount := old.paid_amount;
        new.txn_ref := old.txn_ref; new.txn_at := old.txn_at;
      else
        new.paid_via := case when new.status = 'da_thu' then 'thu_cong' else null end;
        new.paid_amount := case when new.status = 'da_thu' then new.amount else null end;
        new.txn_ref := null; new.txn_at := null;
      end if;
    end if;
  end if;
  return new;
end $$;
revoke execute on function public.tg_invoices_paycode() from public, anon, authenticated;

do $$
declare d text := pg_get_functiondef('public.apply_bank_transfer(text,text,text,numeric,text,timestamptz,jsonb)'::regprocedure);
        a1 text := 'update public.invoices set status = ''da_thu'', paid_via = ''chuyen_khoan'', paid_amount = p_amount,';
        a2 text := 'update public.customer_bills set status = ''da_thanh_toan'', confirmed_at = now(), confirmed_by = null,';
        a3 text := 'code := substring(norm from ''NN[0-9A-F]{10}'');';
begin
  if position(a1 in d) = 0 or position(a2 in d) = 0 or position(a3 in d) = 0 then
    raise exception '084: không thấy đoạn cần vá trong apply_bank_transfer';
  end if;
  d := replace(d, 'declare' || E'\n', 'declare' || E'\n  v_ref text := left(coalesce(nullif(btrim(p_raw->>''referenceCode''), ''''), p_provider_id), 60);' || E'\n');
  d := replace(d, a1, a1 || ' txn_ref = v_ref, txn_at = coalesce(p_time, now()),');
  d := replace(d, a2, a2 || ' txn_ref = v_ref,');
  execute d;
end $$;

drop function if exists public.vat_daily_report(date);
create function public.vat_daily_report(p_date date)
returns table (
  invoice_id uuid, collected_at date, building_code text, room_code text, tenant_name text, phone text,
  id_number text, id_address text, amount numeric, content text, paid_via text, collected_by_name text, contract_code text,
  lines jsonb, vat_amount numeric, txn_ref text
)
language plpgsql stable security definer set search_path = public as $$
begin
  if not (public.is_manager() or public.is_duty('ke_toan')) then
    raise exception 'Chỉ Quản lý hoặc Kế toán xem được danh sách xuất hoá đơn';
  end if;
  return query
    select i.id, i.collected_at, b.code, r.code, t.full_name, t.phone, t.id_number, t.id_address,
           i.amount,
           ('Tiền thuê phòng ' || r.code || ' tháng ' || to_char(i.period, 'MM/YYYY'))::text,
           i.paid_via, p.full_name, c.code, i.lines, i.vat_amount, i.txn_ref
    from public.invoices i
    join public.contracts c on c.id = i.contract_id
    join public.rooms r on r.id = c.room_id
    join public.buildings b on b.id = i.building_id
    join public.tenants t on t.id = c.tenant_id
    left join public.profiles p on p.id = i.collected_by
    where i.status = 'da_thu' and i.collected_at = p_date
    order by b.code, r.code;
end $$;
revoke execute on function public.vat_daily_report(date) from public, anon;
grant execute on function public.vat_daily_report(date) to authenticated;
