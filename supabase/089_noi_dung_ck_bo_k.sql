-- 089: Bỏ chữ K trong nội dung chuyển khoản (số tiền mặc định hiểu là nghìn đồng)
--   "<mã> 3500T 420D 200N 150DV"  T trọ · D điện · N nước · DV dịch vụ · X gửi xe · PS khác
--   Quá 50 ký tự thì "<mã> TONG <tổng>". Không dùng chữ "KH" để khỏi lẫn với mã khoản thu khách.

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
  if tot = 0 then return p_code; end if;
  out := p_code
    || case when kt <> 0 then ' ' || public.money_k(kt) || 'T' else '' end
    || case when kd <> 0 then ' ' || public.money_k(kd) || 'D' else '' end
    || case when kn <> 0 then ' ' || public.money_k(kn) || 'N' else '' end
    || case when kdv <> 0 then ' ' || public.money_k(kdv) || 'DV' else '' end
    || case when kx <> 0 then ' ' || public.money_k(kx) || 'X' else '' end
    || case when kk <> 0 then ' ' || public.money_k(kk) || 'PS' else '' end;
  if length(out) > 50 then out := p_code || ' TONG ' || public.money_k(tot); end if;
  return out;
end $$;

update public.invoices set lines = lines;
