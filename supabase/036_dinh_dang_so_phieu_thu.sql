-- Định dạng số trong chi tiết phiếu thu: 1.234 và 120,5 (kiểu Việt Nam)
create or replace function public.statement_preview(p_customer uuid, p_month date, p_extra numeric, p_extra_note text) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare l public.customer_leases; lines jsonb := '[]'::jsonb; tot numeric := 0; amt numeric; n int; mlabel text;
  eo numeric; ec numeric; wo numeric; wc numeric; r record; ep text; wp text;
begin
  if not public.customer_access_ok(p_customer) then raise exception 'Không có quyền'; end if;
  select * into l from public.customer_leases where customer_id = p_customer;
  if not found then raise exception 'Chưa nhập hợp đồng và đơn giá cho khách này'; end if;
  mlabel := to_char(date_trunc('month', p_month), 'MM/YYYY');
  ep := replace(to_char(coalesce(l.elec_price,0), 'FM999G999G999'), ',', '.');
  wp := replace(to_char(coalesce(l.water_price,0), 'FM999G999G999'), ',', '.');
  if l.rent > 0 then
    lines := lines || jsonb_build_object('label', 'Tiền phòng ' || mlabel, 'amount', l.rent); tot := tot + l.rent;
  end if;
  if l.service_fee > 0 then
    lines := lines || jsonb_build_object('label', 'Phí dịch vụ', 'amount', l.service_fee); tot := tot + l.service_fee;
  end if;
  for r in select * from public.meter_cycle(p_customer) loop
    select reading into wo from public.meter_readings where id = r.open_id;
    select reading into wc from public.meter_readings where id = r.close_id;
    if r.kind = 'dien' and l.elec_price is not null and wc > wo then
      amt := round((wc - wo) * l.elec_price);
      lines := lines || jsonb_build_object('label', 'Tiền điện', 'amount', amt,
        'detail', replace(trim(to_char(wc - wo, 'FM999999990.9'), '.'), '.', ',') || ' kWh × ' || ep || ' (' || trim(to_char(wo,'FM999999990.9'),'.') || ' → ' || trim(to_char(wc,'FM999999990.9'),'.') || ')');
      tot := tot + amt;
    elsif r.kind = 'nuoc' and l.water_mode = 'm3' and l.water_price is not null and wc > wo then
      amt := round((wc - wo) * l.water_price);
      lines := lines || jsonb_build_object('label', 'Tiền nước', 'amount', amt,
        'detail', replace(trim(to_char(wc - wo, 'FM999999990.9'), '.'), '.', ',') || ' m³ × ' || wp || ' (' || trim(to_char(wo,'FM999999990.9'),'.') || ' → ' || trim(to_char(wc,'FM999999990.9'),'.') || ')');
      tot := tot + amt;
    end if;
  end loop;
  if l.water_mode = 'nguoi' and l.water_price is not null then
    select count(*) + 1 into n from public.customer_occupants where customer_id = p_customer;
    amt := l.water_price * n;
    lines := lines || jsonb_build_object('label', 'Tiền nước', 'amount', amt, 'detail', n || ' người × ' || wp);
    tot := tot + amt;
  end if;
  if coalesce(p_extra, 0) <> 0 then
    lines := lines || jsonb_build_object('label', coalesce(nullif(btrim(p_extra_note),''), 'Khoản khác'), 'amount', p_extra); tot := tot + p_extra;
  end if;
  return jsonb_build_object('lines', lines, 'total', tot);
end $$;
revoke execute on function public.statement_preview(uuid, date, numeric, text) from public, anon;
grant execute on function public.statement_preview(uuid, date, numeric, text) to authenticated;

