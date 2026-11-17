-- (1) Hoá đơn tháng nhiều dòng, tách thuế GTGT; (2) Hồ sơ thuê toà nhà (17/11/2026). Chạy sau 057.
--
-- (1) Hoá đơn tháng M của mỗi hợp đồng gồm:
--     Tiền phòng tháng M (GTGT 10%) · Tiền điện tháng M-1 theo số điện phòng (GTGT 8%)
--     · Tiền nước tháng M-1 khoán theo số người đang ở (GTGT 5%) · Phí dịch vụ + phí xe (số xe ghi ở hợp đồng) (GTGT 10%).
--     Giá niêm yết ĐÃ GỒM thuế: app tách tiền trước thuế = làm tròn(giá / (1 + thuế suất)), tiền thuế = giá − tiền trước thuế.
--     Khách trả đúng tổng giá niêm yết. Điện, nước chỉ tính khi hợp đồng bắt đầu trước tháng M (đã ở tháng M-1).
--     Tạo lại hoá đơn tháng thì các hoá đơn CHƯA THU được tính lại (VD vừa nhập số điện); hoá đơn đã thu giữ nguyên.
-- (2) Hồ sơ thuê toà: bên cho thuê, thời hạn, cọc, GPKD, ghi chú + tệp GPKD / hợp đồng thuê toà (thư mục ho-so-toa, riêng tư).
--     Xem: Quản lý, Lead Sale (Trưởng nhóm / Trưởng phòng Kinh doanh), Kế toán. Sửa (kể cả tiền thuê toà hằng tháng): Quản lý, Lead Sale.

-- ---------- (1) Hoá đơn ----------
alter table public.contracts add column if not exists vehicles int not null default 0 check (vehicles between 0 and 20);
alter table public.invoices add column if not exists lines jsonb not null default '[]'::jsonb;
alter table public.invoices add column if not exists vat_amount numeric;

create or replace function public.building_unit_price(p_building uuid, p_kind text) returns numeric
language sql stable security definer set search_path = public as $$
  select (f->>'amount')::numeric from public.building_policy bp, jsonb_array_elements(bp.fees) f
  where bp.building_id = p_building
    and case p_kind
          when 'dien' then lower(f->>'label') like 'điện%' and lower(coalesce(f->>'unit','')) in ('kwh','số','kw')
          when 'nuoc_nguoi' then lower(f->>'label') like 'nước%' and lower(coalesce(f->>'unit','')) in ('người','nguoi')
          when 'dich_vu' then lower(f->>'label') like 'dịch vụ%' and lower(coalesce(f->>'unit','')) in ('tháng','thang','phòng')
          when 'xe' then lower(f->>'label') like 'xe%' and lower(coalesce(f->>'unit','')) in ('chiếc','xe','chiec')
        end
  limit 1
$$;

-- Một dòng hoá đơn: giá đã gồm thuế → tách tiền trước thuế và tiền thuế
create or replace function public.invoice_line(p_kind text, p_label text, p_detail text, p_gross numeric, p_rate numeric) returns jsonb
language sql immutable set search_path = public as $$
  select jsonb_build_object('k', p_kind, 'label', p_label, 'detail', p_detail, 'amount', round(p_gross), 'rate', p_rate,
    'pre', round(round(p_gross) / (1 + p_rate / 100.0)), 'vat', round(p_gross) - round(round(p_gross) / (1 + p_rate / 100.0)))
$$;

create or replace function public.invoice_lines(p_contract uuid, p_period date) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare
  c public.contracts; rm public.rooms; per date := date_trunc('month', p_period)::date; prev date := (date_trunc('month', p_period) - interval '1 month')::date;
  out jsonb := '[]'::jsonb; e public.room_elec_readings; ep numeric; wp numeric; sp numeric; xp numeric; n int;
  vn constant text := 'FM999G999G999';
begin
  select * into c from public.contracts where id = p_contract;
  if not found then raise exception 'Không tìm thấy hợp đồng'; end if;
  if auth.uid() is not null and not public.can_access_building(c.building_id) then raise exception 'Không có quyền'; end if;
  select * into rm from public.rooms where id = c.room_id;
  out := out || public.invoice_line('phong', 'Tiền thuê phòng ' || rm.code || ' tháng ' || to_char(per, 'MM/YYYY'), null, c.rent_amount, 10);
  if c.start_date < per then
    ep := public.building_unit_price(c.building_id, 'dien');
    select * into e from public.room_elec_readings where room_id = c.room_id and period = prev;
    if found and ep is not null and e.end_reading > e.start_reading then
      out := out || public.invoice_line('dien', 'Tiền điện tháng ' || to_char(prev, 'MM/YYYY'),
        replace(trim(to_char(e.end_reading - e.start_reading, 'FM999999990.9'), '.'), '.', ',') || ' kWh × ' || replace(to_char(ep, vn), ',', '.')
          || ' (' || replace(trim(to_char(e.start_reading, 'FM999999990.9'), '.'), '.', ',') || ' → ' || replace(trim(to_char(e.end_reading, 'FM999999990.9'), '.'), '.', ',') || ')',
        (e.end_reading - e.start_reading) * ep, 8);
    end if;
    wp := public.building_unit_price(c.building_id, 'nuoc_nguoi');
    if wp is not null then
      select greatest(1, count(*)) into n from public.contract_occupants o where o.contract_id = c.id and o.move_out is null;
      out := out || public.invoice_line('nuoc', 'Tiền nước tháng ' || to_char(prev, 'MM/YYYY'), n || ' người × ' || replace(to_char(wp, vn), ',', '.'), n * wp, 5);
    end if;
  end if;
  sp := public.building_unit_price(c.building_id, 'dich_vu');
  if sp is not null and sp > 0 then
    out := out || public.invoice_line('dich_vu', 'Phí dịch vụ tháng ' || to_char(per, 'MM/YYYY'), null, sp, 10);
  end if;
  xp := public.building_unit_price(c.building_id, 'xe');
  if xp is not null and xp > 0 and c.vehicles > 0 then
    out := out || public.invoice_line('xe', 'Phí gửi xe tháng ' || to_char(per, 'MM/YYYY'), c.vehicles || ' xe × ' || replace(to_char(xp, vn), ',', '.'), c.vehicles * xp, 10);
  end if;
  return out;
end $$;

create or replace function public.generate_monthly_invoices(p_period date default null) returns integer
language plpgsql security definer set search_path = public as $$
declare
  per date := date_trunc('month', coalesce(p_period, (now() at time zone 'Asia/Ho_Chi_Minh')::date))::date;
  n int := 0; k int; c record; l jsonb;
begin
  if auth.uid() is not null and not public.is_manager() then
    raise exception 'Chỉ quản lý được tạo hoá đơn hằng loạt';
  end if;
  for c in select * from public.contracts ct
           where ct.status = 'hieu_luc' and ct.start_date < per + interval '1 month' and (ct.end_date is null or ct.end_date >= per) loop
    l := public.invoice_lines(c.id, per);
    insert into public.invoices (contract_id, building_id, period, amount, due_date, lines, vat_amount)
    values (c.id, c.building_id, per,
            (select sum((x->>'amount')::numeric) from jsonb_array_elements(l) x), per + (c.billing_day - 1), l,
            (select sum((x->>'vat')::numeric) from jsonb_array_elements(l) x))
    on conflict (contract_id, period) do update set lines = excluded.lines, amount = excluded.amount, vat_amount = excluded.vat_amount
      where public.invoices.status = 'chua_thu';
    get diagnostics k = row_count;
    n := n + k;
  end loop;
  return n;
end $$;

-- Danh sách xuất hoá đơn GTGT: thêm các dòng (tên hàng, trước thuế, thuế suất, tiền thuế)
drop function if exists public.vat_daily_report(date);
create function public.vat_daily_report(p_date date)
returns table (
  invoice_id uuid, collected_at date, building_code text, room_code text, tenant_name text, phone text,
  id_number text, id_address text, amount numeric, content text, paid_via text, collected_by_name text, contract_code text,
  lines jsonb, vat_amount numeric
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
           i.paid_via, p.full_name, c.code, i.lines, i.vat_amount
    from public.invoices i
    join public.contracts c on c.id = i.contract_id
    join public.rooms r on r.id = c.room_id
    join public.buildings b on b.id = i.building_id
    join public.tenants t on t.id = c.tenant_id
    left join public.profiles p on p.id = i.collected_by
    where i.status = 'da_thu' and i.collected_at = p_date
    order by b.code, r.code;
end $$;

-- ---------- (2) Hồ sơ thuê toà ----------
-- Lead Sale: Trưởng nhóm hoặc Trưởng phòng phòng Kinh doanh
create or replace function public.is_kd_lead() returns boolean
language sql stable security definer set search_path = public as $$
  select public.app_role() is not null and exists (
    select 1 from public.org_staff o join public.departments d on d.id = o.department_id and d.code = 'KD'
    where o.profile_id = auth.uid() and (o.is_leader or d.head_staff_id = o.id))
$$;
create or replace function public.can_lease_edit() returns boolean
language sql stable security definer set search_path = public as $$ select public.is_manager() or public.is_kd_lead() $$;
create or replace function public.can_lease_view() returns boolean
language sql stable security definer set search_path = public as $$ select public.can_lease_edit() or public.is_payer() $$;

create table public.building_leases (
  building_id   uuid primary key references public.buildings(id) on delete cascade,
  lessor_name   text check (lessor_name is null or char_length(lessor_name) <= 200),
  lessor_phone  text check (lessor_phone is null or char_length(lessor_phone) <= 30),
  lease_start   date,
  lease_end     date,
  deposit       numeric check (deposit is null or deposit >= 0),
  pay_terms     text check (pay_terms is null or char_length(pay_terms) <= 500),
  gpkd_no       text check (gpkd_no is null or char_length(gpkd_no) <= 60),
  gpkd_date     date,
  gpkd_place    text check (gpkd_place is null or char_length(gpkd_place) <= 200),
  gpkd_name     text check (gpkd_name is null or char_length(gpkd_name) <= 200),
  note          text check (note is null or char_length(note) <= 2000),
  updated_by    uuid references public.profiles(id) on delete set null,
  updated_at    timestamptz not null default now(),
  check (lease_end is null or lease_start is null or lease_end >= lease_start)
);
create index on public.building_leases(updated_by);
alter table public.building_leases enable row level security;
create policy blease_select on public.building_leases for select to authenticated using (public.can_lease_view());
revoke all on public.building_leases from anon, authenticated;
grant select on public.building_leases to authenticated;

create or replace function public.building_lease_save(p_building uuid, p jsonb) returns void
language plpgsql security definer set search_path = public as $$
declare v jsonb := '{}'::jsonb; k text;
begin
  if not public.can_lease_edit() then raise exception 'Chỉ Quản lý hoặc Lead Sale cập nhật hồ sơ thuê toà'; end if;
  if not exists (select 1 from public.buildings where id = p_building) then raise exception 'Không tìm thấy toà'; end if;
  foreach k in array array['lessor_name','lessor_phone','pay_terms','gpkd_no','gpkd_place','gpkd_name','note','lease_start','lease_end','gpkd_date','deposit'] loop
    v := v || jsonb_build_object(k, nullif(btrim(coalesce(p->>k, '')), ''));
  end loop;
  insert into public.building_leases (building_id, lessor_name, lessor_phone, lease_start, lease_end, deposit, pay_terms, gpkd_no, gpkd_date, gpkd_place, gpkd_name, note, updated_by, updated_at)
  values (p_building, v->>'lessor_name', v->>'lessor_phone', (v->>'lease_start')::date, (v->>'lease_end')::date, (v->>'deposit')::numeric, v->>'pay_terms',
          v->>'gpkd_no', (v->>'gpkd_date')::date, v->>'gpkd_place', v->>'gpkd_name', v->>'note', auth.uid(), now())
  on conflict (building_id) do update set lessor_name = excluded.lessor_name, lessor_phone = excluded.lessor_phone, lease_start = excluded.lease_start,
    lease_end = excluded.lease_end, deposit = excluded.deposit, pay_terms = excluded.pay_terms, gpkd_no = excluded.gpkd_no, gpkd_date = excluded.gpkd_date,
    gpkd_place = excluded.gpkd_place, gpkd_name = excluded.gpkd_name, note = excluded.note, updated_by = auth.uid(), updated_at = now();
end $$;

-- Tiền thuê toà hằng tháng: Quản lý, Lead Sale sửa; Kế toán chỉ xem (báo cáo lợi nhuận vẫn tính đủ)
drop policy if exists brent_select on public.building_rents;
create policy brent_select on public.building_rents for select to authenticated using (public.can_lease_view());

create or replace function public.rent_save(p_building uuid, p_from date, p_amount numeric, p_note text) returns uuid
language plpgsql security definer set search_path = public as $$
declare nid uuid; m date := date_trunc('month', coalesce(p_from, (now() at time zone 'Asia/Ho_Chi_Minh')::date))::date;
begin
  if not public.can_lease_edit() then raise exception 'Chỉ Quản lý hoặc Lead Sale nhập tiền thuê toà nhà'; end if;
  if p_amount is null or p_amount < 0 then raise exception 'Số tiền thuê không hợp lệ'; end if;
  insert into public.building_rents (building_id, effective_from, monthly_rent, note)
  values (p_building, m, p_amount, nullif(btrim(coalesce(p_note,'')),''))
  on conflict (building_id, effective_from) do update set monthly_rent = excluded.monthly_rent, note = excluded.note, created_by = auth.uid()
  returning id into nid;
  return nid;
end $$;

create or replace function public.rent_delete(p_id uuid) returns void
language plpgsql security definer set search_path = public as $$
begin
  if not public.can_lease_edit() then raise exception 'Chỉ Quản lý hoặc Lead Sale xoá tiền thuê toà nhà'; end if;
  delete from public.building_rents where id = p_id;
end $$;

-- Tệp hồ sơ thuê toà (thư mục ho-so-toa, riêng tư)
create or replace function public.storage_path_ok(p_name text, p_write boolean) returns boolean
language plpgsql stable security definer set search_path = public as $$
declare
  parts text[] := string_to_array(coalesce(p_name, ''), '/');
  o uuid;
  st text;
  rq public.requests;
begin
  if array_length(parts, 1) is null or array_length(parts, 1) < 3 then return false; end if;
  begin o := parts[2]::uuid; exception when others then return false; end;
  if parts[1] = 'phan-anh' then
    return public.is_active_user() and exists (
      select 1 from public.feedback_threads f
      where f.id = o and (f.customer_id = auth.uid() or public.feedback_can_handle(f.id))
        and (not p_write or f.status <> 'dong'));
  end if;
  if parts[1] = 'dong-ho' then
    return public.is_active_user() and (public.customer_access_ok(o)
      or (public.app_role() is not null and public.can_access_building(o)));
  end if;
  if not p_write and parts[1] in ('anh-toa', 'anh-phong') and public.is_active_user() then return true; end if;
  if public.app_role() is null then return false; end if;
  if parts[1] = 'de-nghi' then
    if p_write then
      select * into rq from public.requests where id = o;
      if not found then return false; end if;
      if rq.kind = 'loa' then
        return rq.status not in ('da_duyet','hoan_tat')
          and (rq.requester_id = auth.uid() or public.loa_can_edit(o) or (public.is_manager() and rq.status <> 'nhap'));
      end if;
      st := public.unc_file_status(p_name);
      if st is not null then
        return public.is_payer() and st = 'da_duyet';
      end if;
      return rq.requester_id = auth.uid() or public.is_manager()
        or (public.is_payer() and rq.kind in ('thanh_toan','tam_ung') and rq.status = 'da_duyet');
    end if;
    return public.can_see_request(o) or public.can_pay_request(o);
  end if;
  if parts[1] = 'ho-so-toa' then
    return exists (select 1 from public.buildings where id = o)
      and case when p_write then public.can_lease_edit() else public.can_lease_view() end;
  end if;
  return case parts[1]
    when 'cccd'      then public.can_edit_building(o)
    when 'hop-dong'  then case when p_write then public.can_edit_building(o) else public.can_access_building(o) end
    when 'anh-phong' then case when p_write then public.can_edit_building(o) else public.can_access_building(o) end
    when 'anh-toa'   then case when p_write then public.can_edit_building(o) else public.can_access_building(o) end
    else false end;
end $$;

revoke execute on function public.building_unit_price(uuid, text), public.invoice_lines(uuid, date), public.generate_monthly_invoices(date),
  public.vat_daily_report(date), public.is_kd_lead(), public.can_lease_edit(), public.can_lease_view(), public.building_lease_save(uuid, jsonb),
  public.rent_save(uuid, date, numeric, text), public.rent_delete(uuid), public.storage_path_ok(text, boolean) from public, anon;
grant execute on function public.building_unit_price(uuid, text), public.invoice_lines(uuid, date), public.generate_monthly_invoices(date),
  public.vat_daily_report(date), public.is_kd_lead(), public.can_lease_edit(), public.can_lease_view(), public.building_lease_save(uuid, jsonb),
  public.rent_save(uuid, date, numeric, text), public.rent_delete(uuid), public.storage_path_ok(text, boolean) to authenticated;
