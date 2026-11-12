-- SePay tự đối soát khoản thu của khách (mã nội dung KH + 10 ký tự hex)
alter table public.bank_transactions add column if not exists customer_bill_id uuid references public.customer_bills(id) on delete set null;
create index if not exists bank_transactions_cbill_idx on public.bank_transactions(customer_bill_id);

create or replace function public.apply_bank_transfer(
  p_provider text, p_provider_id text, p_account text, p_amount numeric, p_content text, p_time timestamptz, p_raw jsonb
) returns text
language plpgsql security definer set search_path = public as $$
declare
  norm text := upper(regexp_replace(coalesce(p_content, ''), '[^A-Za-z0-9]', '', 'g'));
  code text;
  kcode text;
  inv public.invoices; bill public.customer_bills; res text; txn bigint; room text; bname text; u uuid;
begin
  code := substring(norm from 'NN[0-9A-F]{10}');
  kcode := substring(norm from 'KH[0-9A-F]{10}');
  if exists (select 1 from public.bank_transactions where provider = p_provider and provider_id = p_provider_id) then
    return 'trung_giao_dich';
  end if;

  if code is not null then select * into inv from public.invoices where pay_code = code; end if;
  if inv.id is null and kcode is not null then select * into bill from public.customer_bills where pay_code = kcode; end if;

  if inv.id is not null then
    if inv.status = 'da_thu' then res := 'da_thu_truoc';
    elsif p_amount < inv.amount then res := 'lech_so_tien';
    else res := 'khop'; end if;
  elsif bill.id is not null then
    if bill.status = 'da_thanh_toan' or bill.status = 'huy' then res := 'da_thu_truoc';
    elsif p_amount < bill.amount then res := 'lech_so_tien';
    else res := 'khop'; end if;
  else
    res := 'khong_khop';
  end if;

  insert into public.bank_transactions (provider, provider_id, account_no, amount, content, txn_time, invoice_id, customer_bill_id, result, raw)
  values (p_provider, p_provider_id, p_account, p_amount, p_content, p_time, inv.id, bill.id, res, p_raw)
  returning id into txn;

  if inv.id is not null then
    select r.code, b.name into room, bname
    from public.contracts c join public.rooms r on r.id = c.room_id join public.buildings b on b.id = c.building_id
    where c.id = inv.contract_id;
    if res = 'khop' then
      update public.invoices set status = 'da_thu', paid_via = 'chuyen_khoan', paid_amount = p_amount,
        note = concat_ws(' · ', nullif(note, ''), 'Khách chuyển khoản ' || to_char(coalesce(p_time, now()) at time zone 'Asia/Ho_Chi_Minh', 'DD/MM HH24:MI'))
      where id = inv.id;
    end if;
    if res in ('khop', 'lech_so_tien') then
      perform public.notify(x.id, 'nhac_thu_tien',
        case res when 'khop' then 'Đã nhận tiền phòng ' || room else 'Chuyển thiếu tiền phòng ' || room end,
        bname || ' · nhận ' || to_char(p_amount, 'FM999G999G999G999') || ' đ' ||
          case res when 'lech_so_tien' then ' / cần ' || to_char(inv.amount, 'FM999G999G999G999') || ' đ, hoá đơn chưa đóng' else '' end,
        'building', inv.building_id, 'ck:' || txn || ':' || x.id)
      from public.profiles x
      where x.is_active and (x.role = 'quan_ly'
         or (x.role = 'giam_sat' and exists (select 1 from public.building_members m where m.user_id = x.id and m.building_id = inv.building_id)));
    end if;
  elsif bill.id is not null then
    if res = 'khop' then
      update public.customer_bills set status = 'da_thanh_toan', confirmed_at = now(), confirmed_by = null,
        note = concat_ws(' · ', nullif(note, ''), 'Ngân hàng báo có ' || to_char(coalesce(p_time, now()) at time zone 'Asia/Ho_Chi_Minh', 'DD/MM HH24:MI'))
      where id = bill.id;
      perform public.notify(bill.customer_id, 'khac', 'Đã nhận thanh toán', to_char(p_amount, 'FM999G999G999G999') || ' đ · ' || bill.pay_code, 'bill', bill.id, 'bill-ok-' || bill.id);
    end if;
    if res in ('khop', 'lech_so_tien') then
      for u in select distinct s.x from (
          select bill.created_by as x
          union select id from public.profiles where role in ('quan_ly','giam_sat') and is_active) s where s.x is not null loop
        perform public.notify(u, 'nhac_thu_tien',
          case res when 'khop' then 'Khách đã chuyển khoản (tự đối soát)' else 'Khách chuyển thiếu tiền' end,
          'Nhận ' || to_char(p_amount, 'FM999G999G999G999') || ' đ' ||
            case res when 'lech_so_tien' then ' / cần ' || to_char(bill.amount, 'FM999G999G999G999') || ' đ, khoản chưa đóng' else '' end ||
            ' · ' || bill.pay_code,
          'bill', bill.id, 'ckb:' || txn || ':' || u);
      end loop;
    end if;
  end if;
  return res;
end $$;
revoke execute on function public.apply_bank_transfer(text, text, text, numeric, text, timestamptz, jsonb) from public, anon, authenticated;
grant execute on function public.apply_bank_transfer(text, text, text, numeric, text, timestamptz, jsonb) to service_role;
