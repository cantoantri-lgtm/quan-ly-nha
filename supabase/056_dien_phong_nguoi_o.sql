-- Điện từng phòng, nước khoán theo người, nhiều người ở một phòng phải đủ CCCD (17/11/2026).
--  * room_elec_readings: mỗi phòng mỗi tháng một dòng (số đầu kỳ, số cuối kỳ). Không ghi số nước:
--    nước tính khoán = số người đang ở × giá nước/người trong Dịch vụ & chính sách của toà.
--  * Người ở (contract_occupants, gồm cả người đứng tên do trigger hợp đồng tự thêm). Người ở cùng: mỗi người là một khách thuê có đủ số CCCD, xác nhận đồng ý lưu CCCD,
--    ảnh CCCD mặt trước và mặt sau. Khách đứng tên hợp đồng cũng phải đủ CCCD khi lập hợp đồng mới.
--  * Tổng người ở (đứng tên + ở cùng) không vượt "Số người tối đa" của phòng (nếu phòng có ghi).
--  * Quyền ghi: can_edit_building (Quản lý, Giám sát toà, sale phòng Kinh doanh phụ trách toà).

-- ---------- CCCD đủ hay chưa ----------
create or replace function public.tenant_has_cccd(p_tenant uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.tenants t
    where t.id = p_tenant and coalesce(btrim(t.id_number), '') <> '' and t.cccd_consent_at is not null
      and exists (select 1 from public.files f where f.kind = 'cccd' and f.tenant_id = t.id and f.label = 'truoc')
      and exists (select 1 from public.files f where f.kind = 'cccd' and f.tenant_id = t.id and f.label = 'sau'))
$$;

-- Hợp đồng mới: khách đứng tên phải đủ CCCD
create or replace function public.tg_contracts_cccd() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is not null and not public.tenant_has_cccd(new.tenant_id) then
    raise exception 'Khách đứng tên chưa đủ CCCD: cần số CCCD, xác nhận đồng ý lưu CCCD và ảnh mặt trước, mặt sau.';
  end if;
  return new;
end $$;
drop trigger if exists contracts_cccd on public.contracts;
create trigger contracts_cccd before insert on public.contracts for each row execute function public.tg_contracts_cccd();

-- ---------- Người ở cùng ----------
create or replace function public.tg_occupants_guard() returns trigger
language plpgsql security definer set search_path = public as $$
declare c public.contracts; mx int; n int; tb uuid;
begin
  select * into c from public.contracts where id = new.contract_id;
  if not found then raise exception 'Không tìm thấy hợp đồng'; end if;
  -- Người đứng tên do trigger hợp đồng tự thêm (đã kiểm CCCD khi lập hợp đồng)
  if new.tenant_id = c.tenant_id then return new; end if;
  if tg_op = 'INSERT' or new.tenant_id is distinct from old.tenant_id or (old.move_out is not null and new.move_out is null) then
    if c.status <> 'hieu_luc' then raise exception 'Hợp đồng không còn hiệu lực'; end if;
    select building_id into tb from public.tenants where id = new.tenant_id;
    if tb is distinct from c.building_id then raise exception 'Người ở phải là khách thuê của cùng toà'; end if;
    if not public.tenant_has_cccd(new.tenant_id) then
      raise exception 'Người ở cùng chưa đủ CCCD: cần số CCCD, xác nhận đồng ý lưu CCCD và ảnh mặt trước, mặt sau.';
    end if;
    if new.move_out is null then
      select max_occupants into mx from public.rooms where id = c.room_id;
      -- đếm người đang ở (gồm người đứng tên), trừ chính dòng này
      select count(*) into n from public.contract_occupants o
        where o.contract_id = c.id and o.move_out is null and o.id is distinct from new.id;
      if mx is not null and n + 1 > mx then
        raise exception 'Phòng tối đa % người (tính cả người đứng tên hợp đồng)', mx;
      end if;
    end if;
  end if;
  new.move_in := coalesce(new.move_in, (now() at time zone 'Asia/Ho_Chi_Minh')::date);
  if new.move_out is not null and new.move_out < new.move_in then raise exception 'Ngày chuyển đi phải sau ngày vào ở'; end if;
  return new;
end $$;
drop trigger if exists occupants_guard on public.contract_occupants;
create trigger occupants_guard before insert or update on public.contract_occupants for each row execute function public.tg_occupants_guard();

drop policy if exists occupants_insert on public.contract_occupants;
create policy occupants_insert on public.contract_occupants for insert to authenticated with check (
  exists (select 1 from public.contracts c where c.id = contract_occupants.contract_id and public.can_edit_building(c.building_id)));
drop policy if exists occupants_update on public.contract_occupants;
create policy occupants_update on public.contract_occupants for update to authenticated
  using (exists (select 1 from public.contracts c where c.id = contract_occupants.contract_id and public.can_edit_building(c.building_id)))
  with check (exists (select 1 from public.contracts c where c.id = contract_occupants.contract_id and public.can_edit_building(c.building_id)));

-- ---------- Số điện từng phòng ----------
create table public.room_elec_readings (
  id            uuid primary key default gen_random_uuid(),
  room_id       uuid not null references public.rooms(id) on delete cascade,
  building_id   uuid not null references public.buildings(id) on delete cascade,
  period        date not null check (extract(day from period) = 1),
  start_reading numeric(12,1) not null check (start_reading >= 0),
  end_reading   numeric(12,1) not null,
  note          text check (note is null or char_length(note) <= 200),
  created_by    uuid references public.profiles(id) on delete set null default auth.uid(),
  updated_by    uuid references public.profiles(id) on delete set null,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  unique (room_id, period),
  check (end_reading >= start_reading)
);
create index on public.room_elec_readings(building_id, period);
create index on public.room_elec_readings(created_by);
create index on public.room_elec_readings(updated_by);
alter table public.room_elec_readings enable row level security;
create policy room_elec_select on public.room_elec_readings for select to authenticated using (public.can_access_building(building_id));
revoke all on public.room_elec_readings from anon, authenticated;
grant select on public.room_elec_readings to authenticated;

-- Giá điện (đ/kWh) và giá nước khoán (đ/người) lấy từ Dịch vụ & chính sách của toà
create or replace function public.building_unit_price(p_building uuid, p_kind text) returns numeric
language sql stable security definer set search_path = public as $$
  select (f->>'amount')::numeric from public.building_policy bp, jsonb_array_elements(bp.fees) f
  where bp.building_id = p_building
    and case p_kind
          when 'dien' then lower(f->>'label') like 'điện%' and lower(coalesce(f->>'unit','')) in ('kwh','số','kw')
          when 'nuoc_nguoi' then lower(f->>'label') like 'nước%' and lower(coalesce(f->>'unit','')) in ('người','nguoi')
        end
  limit 1
$$;

-- Ghi / sửa số điện một phòng trong tháng
create or replace function public.room_elec_save(p_room uuid, p_period date, p_start numeric, p_end numeric, p_note text default null)
returns uuid language plpgsql security definer set search_path = public as $$
declare rm public.rooms; per date := date_trunc('month', p_period)::date; rid uuid;
begin
  select * into rm from public.rooms where id = p_room;
  if not found then raise exception 'Không tìm thấy phòng'; end if;
  if not public.can_edit_building(rm.building_id) then raise exception 'Chỉ sale phụ trách toà, Giám sát hoặc Quản lý ghi số điện phòng'; end if;
  if p_start is null or p_end is null or p_start < 0 then raise exception 'Nhập số đầu kỳ và số cuối kỳ'; end if;
  if p_end < p_start then raise exception 'Phòng %: số mới (%) nhỏ hơn số cũ (%)', rm.code, p_end, p_start; end if;
  if per > date_trunc('month', (now() at time zone 'Asia/Ho_Chi_Minh'))::date then raise exception 'Chưa tới tháng này'; end if;
  insert into public.room_elec_readings (room_id, building_id, period, start_reading, end_reading, note, created_by, updated_by)
  values (p_room, rm.building_id, per, p_start, p_end, nullif(btrim(coalesce(p_note, '')), ''), auth.uid(), auth.uid())
  on conflict (room_id, period) do update set start_reading = excluded.start_reading, end_reading = excluded.end_reading,
    note = excluded.note, updated_by = auth.uid(), updated_at = now()
  returning id into rid;
  return rid;
end $$;

create or replace function public.room_elec_delete(p_id uuid) returns void
language plpgsql security definer set search_path = public as $$
declare b uuid;
begin
  select building_id into b from public.room_elec_readings where id = p_id;
  if not found then return; end if;
  if not public.can_edit_building(b) then raise exception 'Không có quyền xoá số điện phòng này'; end if;
  delete from public.room_elec_readings where id = p_id;
end $$;

-- Bảng điện nước từng phòng thuê tháng trong một tháng
create or replace function public.room_utility_month(p_building uuid, p_period date)
returns table (room_id uuid, room_code text, floor int, room_status text, max_occupants int,
  contract_id uuid, tenant_name text, occupants int,
  reading_id uuid, prev_end numeric, start_reading numeric, end_reading numeric, kwh numeric, note text,
  elec_price numeric, elec_amount numeric, water_price numeric, water_amount numeric, updated_at timestamptz)
language sql stable security definer set search_path = public as $$
  with per as (select date_trunc('month', p_period)::date d),
  pr as (select public.building_unit_price(p_building, 'dien') ep, public.building_unit_price(p_building, 'nuoc_nguoi') wp)
  select r.id, r.code, r.floor, r.status::text, r.max_occupants,
    c.id, t.full_name,
    case when c.id is null then 0 else greatest(1, (select count(*) from public.contract_occupants o where o.contract_id = c.id and o.move_out is null))::int end,
    e.id,
    (select x.end_reading from public.room_elec_readings x, per where x.room_id = r.id and x.period < per.d order by x.period desc limit 1),
    e.start_reading, e.end_reading, e.end_reading - e.start_reading, e.note,
    pr.ep, round((e.end_reading - e.start_reading) * pr.ep),
    pr.wp, case when c.id is null then null else pr.wp * greatest(1, (select count(*) from public.contract_occupants o where o.contract_id = c.id and o.move_out is null)) end,
    e.updated_at
  from public.rooms r cross join per cross join pr
  left join public.contracts c on c.room_id = r.id and c.status = 'hieu_luc'
  left join public.tenants t on t.id = c.tenant_id
  left join public.room_elec_readings e on e.room_id = r.id and e.period = per.d
  where r.building_id = p_building and r.rent_mode = 'thang' and public.can_access_building(p_building)
  order by r.floor nulls last, r.code
$$;

revoke execute on function public.tenant_has_cccd(uuid), public.tg_contracts_cccd(), public.tg_occupants_guard(), public.building_unit_price(uuid, text),
  public.room_elec_save(uuid, date, numeric, numeric, text), public.room_elec_delete(uuid), public.room_utility_month(uuid, date) from public, anon;
grant execute on function public.tenant_has_cccd(uuid), public.building_unit_price(uuid, text),
  public.room_elec_save(uuid, date, numeric, numeric, text), public.room_elec_delete(uuid), public.room_utility_month(uuid, date) to authenticated;
