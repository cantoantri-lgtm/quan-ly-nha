-- 087: Nội dung chuyển khoản hoá đơn tiền phòng dễ đọc, không dấu (ngân hàng đổi chữ có dấu thành "???")
--   "<mã NN…> CK TRO DV 11.26 DIEN NUOC 10.26": mã đứng đầu để SePay tự đối soát, sau đó từng khoản theo tháng.
--   Quá 50 ký tự (giới hạn nhiều ngân hàng) thì rút gọn "<mã> CK HD 11.26".
--   invoices.transfer_note là cột sinh tự động; trang thanh toán công khai và trang khách dùng cột này.

create or replace function public.invoice_note(p_code text, p_period date, p_lines jsonb) returns text
language plpgsql immutable set search_path = public as $$
declare l jsonb; k text; m text; mm text[] := '{}'; grp jsonb := '{}'::jsonb; out text := ''; x text;
begin
  for l in select * from jsonb_array_elements(coalesce(p_lines, '[]'::jsonb)) loop
    k := case l->>'k' when 'phong' then 'TRO' when 'dien' then 'DIEN' when 'nuoc' then 'NUOC'
                      when 'dich_vu' then 'DV' when 'xe' then 'XE' else 'KHAC' end;
    m := (regexp_match(l->>'label', '(\d{2})/\d{2}(\d{2})'))[1] || '.' || (regexp_match(l->>'label', '(\d{2})/\d{2}(\d{2})'))[2];
    m := coalesce(m, to_char(p_period, 'MM.YY'));
    if not m = any(mm) then mm := mm || m; grp := grp || jsonb_build_object(m, ''); end if;
    if position(k in grp->>m) = 0 then grp := jsonb_set(grp, array[m], to_jsonb(btrim((grp->>m) || ' ' || k))); end if;
  end loop;
  if array_length(mm, 1) is null then return p_code || ' CK TRO ' || to_char(p_period, 'MM.YY'); end if;
  foreach x in array mm loop out := out || ' ' || (grp->>x) || ' ' || x; end loop;
  out := p_code || ' CK' || out;
  if length(out) > 50 then out := p_code || ' CK HD ' || to_char(p_period, 'MM.YY'); end if;
  return out;
end $$;

alter table public.invoices add column if not exists transfer_note text
  generated always as (public.invoice_note(pay_code, period, lines)) stored;

create or replace function public.invoice_pay_info(p_code text) returns jsonb
language sql stable security definer set search_path = public as $$
  select jsonb_build_object(
    'pay_code', i.pay_code, 'amount', i.amount, 'status', i.status, 'period', i.period, 'due_date', i.due_date,
    'room', r.code, 'building', b.name, 'transfer_note', i.transfer_note,
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
