-- 101: Gộp "Thu tiền khách" vào hợp đồng và hoá đơn (24/11/2026)
--  * Tiền phòng, điện, nước, dịch vụ thu bằng hoá đơn tháng (tự tạo ngày 1). Không tạo tay các khoản này
--    hoặc phiếu thu tháng trong "Thu tiền khách" nữa, tránh thu trùng. Khoản cũ vẫn xem, xác nhận, tự khớp như trước.
--  * Tiền cọc thu trong hợp đồng: customer_bills có contract_id (khách không cần tài khoản app). Mỗi hợp đồng một khoản
--    cọc đang mở, mã KH… riêng, QR chuyển khoản tự khớp (apply_bank_transfer) hoặc xác nhận tiền mặt (cbill_set).
--    Thanh toán xong → hợp đồng tự chuyển "Đã thu cọc". Tiền cọc vẫn tính riêng (cột Tiền cọc) trong sổ thu chi, báo cáo.
--  * Ai thu cọc: Sale phụ trách toà, Giám sát, Kế toán, Quản lý.

alter table public.customer_bills add column if not exists contract_id uuid references public.contracts(id) on delete cascade;
alter table public.customer_bills alter column customer_id drop not null;
alter table public.customer_bills add constraint customer_bills_owner check (customer_id is not null or contract_id is not null);
create unique index if not exists customer_bills_open_deposit on public.customer_bills(contract_id)
  where kind = 'tien_coc' and status in ('chua_thanh_toan', 'cho_xac_nhan') and contract_id is not null;

-- Nhân sự toà xem khoản cọc theo hợp đồng
create policy cbills_select_contract on public.customer_bills for select to authenticated
  using (public.app_role() is not null and contract_id is not null and public.can_access_building(building_id));

-- Tạo hoặc cập nhật khoản cọc đang mở của hợp đồng. p_amount null = theo tiền cọc trên hợp đồng.
create or replace function public.deposit_request(p_contract uuid, p_amount numeric default null) returns jsonb
language plpgsql security definer set search_path = public as $$
declare c public.contracts; b public.customer_bills; cust uuid; amt numeric;
begin
  select * into c from public.contracts where id = p_contract;
  if not found then raise exception 'Không tìm thấy hợp đồng'; end if;
  if not (public.is_payer() or public.can_manage_building(c.building_id) or public.can_edit_building(c.building_id)) then
    raise exception 'Chỉ Sale phụ trách toà, Giám sát, Kế toán hoặc Quản lý thu tiền cọc';
  end if;
  if c.deposit_status <> 'chua_thu' then raise exception 'Hợp đồng này đã thu cọc'; end if;
  amt := round(coalesce(p_amount, c.deposit_amount));
  if amt is null or amt <= 0 then raise exception 'Hợp đồng chưa có số tiền cọc. Sửa hợp đồng hoặc nhập số tiền cọc'; end if;
  select * into b from public.customer_bills
   where contract_id = c.id and kind = 'tien_coc' and status in ('chua_thanh_toan', 'cho_xac_nhan') for update;
  if found then
    if b.amount <> amt then
      if b.status <> 'chua_thanh_toan' then raise exception 'Khách đã báo chuyển tiền, xác nhận hoặc trả về trước khi đổi số tiền'; end if;
      update public.customer_bills set amount = amt where id = b.id returning * into b;
    end if;
  else
    select id into cust from public.customer_profiles where tenant_id = c.tenant_id limit 1;
    insert into public.customer_bills (customer_id, contract_id, building_id, room_id, kind, amount, note, created_by)
    values (cust, c.id, c.building_id, c.room_id, 'tien_coc', amt, 'Tiền cọc hợp đồng ' || coalesce(c.code, ''), auth.uid())
    returning * into b;
    if cust is not null then
      perform public.notify(cust, 'khac', 'Khoản cần thanh toán: Tiền cọc', to_char(amt, 'FM999G999G999G999') || ' đ', 'bill', b.id, 'bill-new-' || b.id);
    end if;
  end if;
  return jsonb_build_object('id', b.id, 'pay_code', b.pay_code, 'amount', b.amount, 'status', b.status);
end $$;
revoke execute on function public.deposit_request(uuid, numeric) from public, anon;
grant execute on function public.deposit_request(uuid, numeric) to authenticated;

-- Xác nhận / huỷ khoản cọc theo hợp đồng: thêm quyền cho nhân sự toà
do $$
declare d text := pg_get_functiondef('public.cbill_set(uuid,text)'::regprocedure);
  a text := 'not (public.can_handle_customer(b.customer_id) or public.is_duty(''ke_toan''))';
begin
  if position(a in d) = 0 then raise exception '101: không thấy đoạn cần vá trong cbill_set'; end if;
  execute replace(d, a, 'not (public.can_handle_customer(b.customer_id) or public.is_duty(''ke_toan'') or public.is_manager()'
    || ' or (b.contract_id is not null and (public.can_manage_building(b.building_id) or public.can_edit_building(b.building_id))))');
end $$;

-- Thanh toán xong khoản cọc → hợp đồng "Đã thu cọc"
create or replace function public.tg_cbills_deposit_done() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.kind = 'tien_coc' and new.contract_id is not null and new.status = 'da_thanh_toan' and old.status is distinct from 'da_thanh_toan' then
    update public.contracts set deposit_status = 'da_thu' where id = new.contract_id and deposit_status = 'chua_thu';
  end if;
  return null;
end $$;
revoke execute on function public.tg_cbills_deposit_done() from public, anon, authenticated;
drop trigger if exists cbills_deposit_done on public.customer_bills;
create trigger cbills_deposit_done after update of status on public.customer_bills
  for each row execute function public.tg_cbills_deposit_done();

-- Không tạo tay tiền phòng, điện, nước, dịch vụ, phiếu thu tháng nữa (đã có hoá đơn tháng)
do $$
declare d text := pg_get_functiondef('public.cbill_create(uuid,cbill_kind,date,numeric,date,text)'::regprocedure);
  a text := 'select * into c from public.customer_profiles where id = p_customer;';
begin
  if position(a in d) = 0 then raise exception '101: không thấy đoạn cần vá trong cbill_create'; end if;
  execute replace(d, a, 'if p_kind <> ''tien_coc'' then raise exception ''Tiền phòng, điện, nước, dịch vụ thu bằng hoá đơn tháng (Thu & chi toà nhà). Khoản phát sinh ghi ở Thu khác.''; end if;'
    || E'\n  ' || a);
end $$;
create or replace function public.statement_create(p_customer uuid, p_month date, p_due date, p_extra numeric, p_extra_note text)
returns uuid language plpgsql security definer set search_path = public as $$
begin
  raise exception 'Phiếu thu tháng đã thay bằng hoá đơn tháng tự tạo ngày 1 (Thu & chi toà nhà).';
end $$;
