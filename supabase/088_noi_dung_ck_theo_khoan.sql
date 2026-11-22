-- 088: Nội dung chuyển khoản theo khoản, số tiền tính nghìn đồng, không ghi tháng (yêu cầu 22/11/2026)
--   "<mã NN…> 3500KT 420KD 200KN 150KDV"  KT tiền trọ · KD điện · KN nước · KDV dịch vụ · KX gửi xe · KK khác
--   Quá 50 ký tự thì "<mã> <tổng>K". Số lẻ dưới nghìn ghi 1 chữ số thập phân (563.5KD).
--   Cột sinh invoices.transfer_note tự tính lại khi ghi; cập nhật lại các dòng sẵn có ở cuối file.

create or replace function public.money_k(a numeric) returns text
language sql immutable set search_path = public as $$
  select case when a % 1000 = 0 then (a / 1000)::bigint::text
              else trim(to_char(round(a / 1000.0, 1), 'FM999999990.0')) end
$$;

create or replace function public.invoice_note(p_code text, p_period date, p_lines jsonb) returns text
language plpgsql immutable set search_path = public as $$
declare l jsonb; kt numeric := 0; kd numeric := 0; kn numeric := 0; kdv numeric := 0; kx numeric := 0; kk numeric := 0;
  tot numeric := 0; out text;
begin
  for l in select * from jsonb_array_elements(coalesce(p_lines, '[]'::jsonb)) loop
    case l->>'k'
      when 'phong' then kt := kt + (l->>'amount')::numeric;
      when 'dien' then kd := kd + (l->>'amount')::numeric;
      when 'nuoc' then kn := kn + (l->>'amount')::numeric;
      when 'dich_vu' then kdv := kdv + (l->>'amount')::numeric;
      when 'xe' then kx := kx + (l->>'amount')::numeric;
      else kk := kk + coalesce((l->>'amount')::numeric, 0);
    end case;
  end loop;
  tot := kt + kd + kn + kdv + kx + kk;
  out := p_code
    || case when kt <> 0 then ' ' || public.money_k(kt) || 'KT' else '' end
    || case when kd <> 0 then ' ' || public.money_k(kd) || 'KD' else '' end
    || case when kn <> 0 then ' ' || public.money_k(kn) || 'KN' else '' end
    || case when kdv <> 0 then ' ' || public.money_k(kdv) || 'KDV' else '' end
    || case when kx <> 0 then ' ' || public.money_k(kx) || 'KX' else '' end
    || case when kk <> 0 then ' ' || public.money_k(kk) || 'KK' else '' end;
  if tot = 0 then return p_code; end if;
  if length(out) > 50 then out := p_code || ' ' || public.money_k(tot) || 'K'; end if;
  return out;
end $$;

-- Tính lại cột sinh cho hoá đơn sẵn có
update public.invoices set lines = lines;
