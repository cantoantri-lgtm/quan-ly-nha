-- 085: Tài khoản khách gắn với khách đứng tên hợp đồng (khách đại diện)
--  * customer_profiles.tenant_id (mỗi khách thuê tối đa một tài khoản)
--  * Tạo tài khoản khách: SĐT phải là SĐT của khách đứng tên một hợp đồng đang hiệu lực, ở toà người tạo phụ trách.
--    Giấy tờ phải khớp hồ sơ khách thuê (nếu hồ sơ đã có số). Toà + phòng lấy từ hợp đồng.
--    Mỗi CCCD / hộ chiếu một tài khoản (đã có unique cccd).
--  * Gắn sẵn các tài khoản cũ có SĐT trùng khách đứng tên hợp đồng.
--  * Khách xem được hoá đơn tiền phòng của hợp đồng mình đứng tên (RLS + customer_invoices),
--    công nợ gồm cả hoá đơn chưa thu, hợp đồng lấy từ bảng contracts khi chưa có customer_leases.
--  * account_candidates(): danh sách khách đứng tên hợp đồng chưa có tài khoản, cho form tạo tài khoản.

alter table public.customer_profiles add column if not exists tenant_id uuid references public.tenants(id) on delete set null;
create unique index if not exists customer_profiles_tenant_key on public.customer_profiles(tenant_id) where tenant_id is not null;

create or replace function public.norm_phone(p text) returns text
language sql immutable set search_path = public as $$
  select case
    when s like '84%' and length(s) = 11 then '0' || substr(s, 3)
    else s end
  from (select regexp_replace(coalesce(p, ''), '[^0-9]', '', 'g') s) x
$$;

-- Hợp đồng đang hiệu lực mới nhất do khách có SĐT này đứng tên
create or replace function public.rep_contract_by_phone(p_phone text)
returns table (tenant_id uuid, contract_id uuid, building_id uuid, room_id uuid, id_number text, full_name text)
language sql stable security definer set search_path = public as $$
  select t.id, c.id, c.building_id, c.room_id, t.id_number, t.full_name
    from public.tenants t
    join public.contracts c on c.tenant_id = t.id and c.status = 'hieu_luc'
   where public.norm_phone(t.phone) = public.norm_phone(p_phone) and public.norm_phone(p_phone) <> ''
   order by c.start_date desc, c.created_at desc
   limit 1
$$;
revoke execute on function public.rep_contract_by_phone(text) from public, anon, authenticated;

create or replace function public.tg_customer_profiles_rep() returns trigger
language plpgsql security definer set search_path = public as $$
declare ph text; m record; cr public.user_role; ok boolean;
begin
  select phone into ph from public.profiles where id = new.id;
  select * into m from public.rep_contract_by_phone(ph);
  if m.tenant_id is null then
    raise exception 'Số điện thoại % chưa phải của khách đứng tên hợp đồng đang hiệu lực. Nhập số điện thoại cho khách đại diện trong hồ sơ khách thuê trước khi tạo tài khoản.', coalesce(ph, '');
  end if;
  if m.id_number is not null and upper(m.id_number) <> upper(new.cccd) then
    raise exception 'Số giấy tờ không khớp với hồ sơ khách thuê %.', m.full_name;
  end if;
  if exists (select 1 from public.customer_profiles x where x.tenant_id = m.tenant_id and x.id <> new.id) then
    raise exception 'Khách % đã có tài khoản app.', m.full_name;
  end if;
  -- Người tạo phải phụ trách toà của hợp đồng (Quản lý: mọi toà)
  if new.created_by is not null then
    select role into cr from public.profiles where id = new.created_by;
    ok := cr = 'quan_ly' or exists (select 1 from public.building_members bm where bm.user_id = new.created_by and bm.building_id = m.building_id);
    if not ok then raise exception 'Bạn không phụ trách toà của hợp đồng này.'; end if;
  end if;
  new.tenant_id := m.tenant_id; new.building_id := m.building_id; new.room_id := m.room_id;
  return new;
end $$;
revoke execute on function public.tg_customer_profiles_rep() from public, anon, authenticated;
drop trigger if exists customer_profiles_rep on public.customer_profiles;
create trigger customer_profiles_rep before insert on public.customer_profiles
  for each row execute function public.tg_customer_profiles_rep();

-- Gắn các tài khoản cũ (chỉ khi SĐT khớp đúng một khách đứng tên, chưa ai giữ)
update public.customer_profiles cp set tenant_id = m.tenant_id
  from public.profiles p, lateral public.rep_contract_by_phone(p.phone) m
 where p.id = cp.id and cp.tenant_id is null and m.tenant_id is not null
   and not exists (select 1 from public.customer_profiles x where x.tenant_id = m.tenant_id);

-- Khách sở hữu hợp đồng?
create or replace function public.customer_owns_contract(p_contract uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.customer_profiles cp join public.contracts c on c.tenant_id = cp.tenant_id
                  where cp.id = auth.uid() and c.id = p_contract)
$$;
revoke execute on function public.customer_owns_contract(uuid) from public, anon;
grant execute on function public.customer_owns_contract(uuid) to authenticated;

drop policy if exists invoices_select_customer on public.invoices;
create policy invoices_select_customer on public.invoices for select to authenticated
  using (public.app_role() = 'khach_hang' and public.customer_owns_contract(contract_id));

-- Hoá đơn tiền phòng của khách (khách tự xem hoặc nhân sự xem hộ)
create or replace function public.customer_invoices(p_customer uuid default null)
returns table (id uuid, period date, amount numeric, due_date date, status text, pay_code text, lines jsonb,
               paid_via text, txn_ref text, collected_at date, room_code text)
language plpgsql stable security definer set search_path = public as $$
declare c uuid := coalesce(p_customer, auth.uid());
begin
  if not public.customer_access_ok(c) then raise exception 'Không có quyền xem'; end if;
  return query
    select i.id, i.period, i.amount, i.due_date, i.status::text, i.pay_code, i.lines, i.paid_via, i.txn_ref, i.collected_at, r.code
      from public.customer_profiles cp
      join public.contracts k on k.tenant_id = cp.tenant_id
      join public.invoices i on i.contract_id = k.id and i.status <> 'huy'
      join public.rooms r on r.id = k.room_id
     where cp.id = c
     order by i.period desc;
end $$;
revoke execute on function public.customer_invoices(uuid) from public, anon;
grant execute on function public.customer_invoices(uuid) to authenticated;

-- Tổng quan khách: hợp đồng lấy từ contracts khi chưa nhập customer_leases; công nợ gồm hoá đơn chưa thu
create or replace function public.customer_overview(p_customer uuid default null)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare c uuid := coalesce(p_customer, auth.uid()); today date := (now() at time zone 'Asia/Ho_Chi_Minh')::date;
  k public.contracts; inv_debt numeric; inv_over numeric;
begin
  if not public.customer_access_ok(c) then raise exception 'Không có quyền xem'; end if;
  select ct.* into k from public.customer_profiles cp join public.contracts ct on ct.tenant_id = cp.tenant_id and ct.status = 'hieu_luc'
   where cp.id = c order by ct.start_date desc limit 1;
  select coalesce(sum(i.amount), 0), coalesce(sum(i.amount) filter (where i.due_date < today), 0) into inv_debt, inv_over
    from public.customer_profiles cp join public.contracts ct on ct.tenant_id = cp.tenant_id
    join public.invoices i on i.contract_id = ct.id and i.status = 'chua_thu'
   where cp.id = c;
  return jsonb_build_object(
    'customer', (select jsonb_build_object('id', p.id, 'full_name', p.full_name, 'phone', p.phone) from public.profiles p where p.id = c),
    'place', (select jsonb_build_object('building_id', cp.building_id, 'building_code', b.code, 'building_name', b.name, 'room_id', cp.room_id, 'room_code', r.code)
              from public.customer_profiles cp left join public.buildings b on b.id = cp.building_id left join public.rooms r on r.id = cp.room_id where cp.id = c),
    'lease', coalesce(
      (select to_jsonb(l) - 'updated_by' from public.customer_leases l where l.customer_id = c),
      case when k.id is not null then jsonb_build_object('customer_id', c, 'start_date', k.start_date, 'end_date', k.end_date,
        'rent', k.rent_amount, 'deposit', k.deposit_amount, 'elec_price', null, 'water_price', null, 'water_mode', 'm3',
        'service_fee', 0, 'max_occupants', null, 'contract_code', k.code, 'from_contract', true) end),
    'occupant_count', (select count(*) from public.customer_occupants where customer_id = c) + 1,
    'debt', coalesce((select sum(amount) from public.customer_bills where customer_id = c and status in ('chua_thanh_toan','cho_xac_nhan')), 0) + inv_debt,
    'overdue', coalesce((select sum(amount) from public.customer_bills where customer_id = c and status in ('chua_thanh_toan','cho_xac_nhan') and due_date < today), 0) + inv_over
  );
end $$;

-- Khách đứng tên hợp đồng đang hiệu lực, có SĐT, chưa có tài khoản, ở toà người gọi phụ trách
-- Không trả số giấy tờ: người tạo nhập số trên CCCD khách đưa, trigger đối chiếu với hồ sơ.
create or replace function public.account_candidates()
returns table (tenant_id uuid, full_name text, phone text, id_type text, has_id boolean, building_code text, room_code text, has_account_phone boolean)
language sql stable security definer set search_path = public as $$
  select distinct on (t.id) t.id, t.full_name, public.norm_phone(t.phone), t.id_type, t.id_number is not null, b.code, r.code,
         exists (select 1 from public.profiles p where public.norm_phone(p.phone) = public.norm_phone(t.phone))
    from public.tenants t
    join public.contracts c on c.tenant_id = t.id and c.status = 'hieu_luc'
    join public.buildings b on b.id = c.building_id
    join public.rooms r on r.id = c.room_id
   where public.app_role() in ('quan_ly', 'giam_sat', 'nhan_vien') and public.can_access_building(c.building_id)
     and public.norm_phone(t.phone) ~ '^0[0-9]{9}$'
     and not exists (select 1 from public.customer_profiles cp where cp.tenant_id = t.id)
   order by t.id, c.start_date desc
$$;
revoke execute on function public.account_candidates() from public, anon;
grant execute on function public.account_candidates() to authenticated;
