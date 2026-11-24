-- 100: Điều chỉnh số tiền hoá đơn khi thu (24/11/2026)
--  App tự tính hoá đơn nhưng có thể sai (đồng hồ hỏng, khách được giảm, phát sinh thêm…). Khi thu tiền, nhân viên
--  sửa được số tiền phải thu, kèm lý do. App ghi một dòng "Điều chỉnh: <lý do>" (k = 'dieu_chinh') vào hoá đơn,
--  tính lại tổng, nội dung chuyển khoản và mã QR. Tiền chuyển khoản về vẫn tự khớp theo số mới.
--  * Ai sửa: Sale phụ trách toà, Giám sát, Kế toán, Quản lý; chỉ khi hoá đơn chưa thu. Mỗi lần sửa báo Kế toán và Quản lý.
--  * Dòng điều chỉnh không có thuế GTGT tách riêng (ghi vào phần "PS" của nội dung chuyển khoản).
--  * Tạo lại hoá đơn tháng (generate_monthly_invoices) hoặc ghi số điện muộn (tg_room_elec_refresh) giữ nguyên dòng điều chỉnh.

-- Các dòng điều chỉnh trong một mảng dòng hoá đơn
create or replace function public.invoice_adj_lines(p_lines jsonb) returns jsonb
language sql immutable set search_path = public as $$
  select coalesce(jsonb_agg(x), '[]'::jsonb) from jsonb_array_elements(coalesce(p_lines, '[]'::jsonb)) x
  where jsonb_typeof(x) = 'object' and x->>'k' = 'dieu_chinh'
$$;
create or replace function public.invoice_lines_sum(p_lines jsonb, p_field text) returns numeric
language sql immutable set search_path = public as $$
  select coalesce(sum((x->>p_field)::numeric), 0) from jsonb_array_elements(coalesce(p_lines, '[]'::jsonb)) x
  where jsonb_typeof(x) = 'object' and x ? p_field
$$;

create or replace function public.invoice_adjust(p_invoice uuid, p_total numeric, p_reason text) returns numeric
language plpgsql security definer set search_path = public as $$
declare i public.invoices; base jsonb; auto numeric; delta numeric; nl jsonb; who text; rm text; bc text; u uuid;
  rs text := btrim(coalesce(p_reason, ''));
begin
  select * into i from public.invoices where id = p_invoice for update;
  if not found then raise exception 'Không tìm thấy hoá đơn'; end if;
  if not (public.is_payer() or public.can_manage_building(i.building_id) or public.can_edit_building(i.building_id)) then
    raise exception 'Chỉ Sale phụ trách toà, Giám sát, Kế toán hoặc Quản lý điều chỉnh hoá đơn';
  end if;
  if i.status <> 'chua_thu' then raise exception 'Hoá đơn đã thu hoặc đã huỷ, không điều chỉnh được'; end if;
  if p_total is null or p_total < 0 then raise exception 'Số tiền phải thu không hợp lệ'; end if;
  p_total := round(p_total);
  -- Dòng app tự tính (bỏ dòng điều chỉnh cũ)
  select coalesce(jsonb_agg(x), '[]'::jsonb) into base from jsonb_array_elements(coalesce(i.lines, '[]'::jsonb)) x
   where not (jsonb_typeof(x) = 'object' and x->>'k' = 'dieu_chinh');
  auto := public.invoice_lines_sum(base, 'amount');
  delta := p_total - auto;
  if delta <> 0 and char_length(rs) < 5 then raise exception 'Ghi lý do điều chỉnh (ít nhất 5 ký tự)'; end if;
  select full_name into who from public.profiles where id = auth.uid();
  nl := base || case when delta = 0 then '[]'::jsonb else jsonb_build_array(jsonb_build_object(
          'k', 'dieu_chinh', 'label', left('Điều chỉnh: ' || rs, 120), 'amount', delta, 'pre', delta, 'vat', 0, 'rate', 0,
          'by', coalesce(who, ''), 'at', to_char(now() at time zone 'Asia/Ho_Chi_Minh', 'DD/MM/YYYY HH24:MI'))) end;
  perform set_config('app.invoice_refresh', '1', true);
  update public.invoices set lines = nl, amount = p_total, vat_amount = public.invoice_lines_sum(nl, 'vat') where id = i.id;
  perform set_config('app.invoice_refresh', '', true);
  -- Báo Kế toán, Quản lý (trừ người sửa)
  select r.code, b.code into rm, bc from public.contracts c join public.rooms r on r.id = c.room_id join public.buildings b on b.id = c.building_id where c.id = i.contract_id;
  for u in select id from public.payer_ids() id where id <> auth.uid() loop
    perform public.notify(u, 'nhac_thu_tien', 'Hoá đơn được điều chỉnh · ' || bc || ' P.' || rm,
      coalesce(who, 'Nhân viên') || ': ' || to_char(i.amount, 'FM999G999G999G999') || ' → ' || to_char(p_total, 'FM999G999G999G999') || ' đ'
      || case when delta <> 0 then ' · ' || rs else ' (về số app tính)' end,
      'building', i.building_id, 'inv-adj-' || i.id || '-' || extract(epoch from now())::bigint || '-' || u);
  end loop;
  return p_total;
end $$;
revoke execute on function public.invoice_adjust(uuid, numeric, text) from public, anon;
grant execute on function public.invoice_adjust(uuid, numeric, text) to authenticated;

-- Tạo lại hoá đơn tháng: giữ dòng điều chỉnh
do $$
declare d text := pg_get_functiondef('public.generate_monthly_invoices(date)'::regprocedure);
  a text := 'on conflict (contract_id, period) do update set lines = excluded.lines, amount = excluded.amount, vat_amount = excluded.vat_amount';
begin
  if position(a in d) = 0 then raise exception '100: không thấy đoạn cần vá trong generate_monthly_invoices'; end if;
  execute replace(d, a, 'on conflict (contract_id, period) do update set lines = excluded.lines || public.invoice_adj_lines(public.invoices.lines),'
    || ' amount = excluded.amount + public.invoice_lines_sum(public.invoice_adj_lines(public.invoices.lines), ''amount''),'
    || ' vat_amount = excluded.vat_amount');
end $$;

-- Ghi số điện muộn: giữ dòng điều chỉnh
create or replace function public.tg_room_elec_refresh() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  rid uuid := coalesce(new.room_id, old.room_id);
  per date := (date_trunc('month', coalesce(new.period, old.period)) + interval '1 month')::date;
  i record; l jsonb;
begin
  for i in select inv.id, inv.contract_id, inv.lines from public.invoices inv join public.contracts c on c.id = inv.contract_id
           where c.room_id = rid and inv.period = per and inv.status = 'chua_thu' loop
    l := public.invoice_lines(i.contract_id, per) || public.invoice_adj_lines(i.lines);
    perform set_config('app.invoice_refresh', '1', true);
    update public.invoices set lines = l, amount = public.invoice_lines_sum(l, 'amount'), vat_amount = public.invoice_lines_sum(l, 'vat')
    where id = i.id;
    perform set_config('app.invoice_refresh', '', true);
  end loop;
  return null;
end $$;
