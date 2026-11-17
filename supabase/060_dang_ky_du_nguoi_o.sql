-- Phòng ở bao nhiêu người thì đăng ký đủ bấy nhiêu người, ai cũng có số CCCD + ảnh mặt trước, mặt sau.
-- 1) Hợp đồng ghi "Số người ở" (khai khi ký). Tiền nước tính theo max(số khai, số đã đăng ký) để không thất thu.
-- 2) Danh sách hợp đồng còn thiếu người đăng ký (hiện ở trang chủ, trang hợp đồng).
-- 3) Không xoá được ảnh CCCD / số CCCD của khách đang ở (chỉ thay ảnh mới).

-- ---------- 1. Số người ở trên hợp đồng ----------
alter table public.contracts add column if not exists people int not null default 1 check (people between 1 and 20);
update public.contracts c set people = greatest(1, (select count(*) from public.contract_occupants o where o.contract_id = c.id and o.move_out is null));

create or replace function public.tg_contracts_people() returns trigger
language plpgsql security definer set search_path = public as $$
declare mx int;
begin
  if tg_op = 'INSERT' or new.people is distinct from old.people or new.room_id is distinct from old.room_id then
    select max_occupants into mx from public.rooms where id = new.room_id;
    if mx is not null and new.people > mx then
      raise exception 'Phòng này tối đa % người, hợp đồng khai % người.', mx, new.people;
    end if;
  end if;
  return new;
end $$;
drop trigger if exists contracts_people on public.contracts;
create trigger contracts_people before insert or update on public.contracts for each row execute function public.tg_contracts_people();

-- Số người đang ở đã đăng ký (gồm người đứng tên)
create or replace function public.contract_registered(p_contract uuid) returns int
language sql stable security definer set search_path = public as $$
  select count(*)::int from public.contract_occupants o where o.contract_id = p_contract and o.move_out is null
$$;

-- ---------- 2. Hợp đồng còn thiếu người đăng ký ----------
create or replace function public.contracts_missing_people(p_building uuid default null)
returns table (contract_id uuid, building_id uuid, building_code text, room_code text, tenant_name text, people int, registered int)
language sql stable security definer set search_path = public as $$
  select c.id, c.building_id, b.code, r.code, t.full_name, c.people, public.contract_registered(c.id)
  from public.contracts c
  join public.buildings b on b.id = c.building_id
  join public.rooms r on r.id = c.room_id
  join public.tenants t on t.id = c.tenant_id
  where c.status = 'hieu_luc'
    and (p_building is null or c.building_id = p_building)
    and public.can_edit_building(c.building_id)
    and public.contract_registered(c.id) < c.people
  order by b.code, r.code
$$;

-- Tiền nước: theo số người khai hoặc số đã đăng ký, lấy số lớn hơn
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
      n := greatest(1, c.people, public.contract_registered(c.id));
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

-- ---------- 3. Giữ CCCD của khách đang ở ----------
create or replace function public.tenant_living(p_tenant uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.contract_occupants o join public.contracts c on c.id = o.contract_id
                 where o.tenant_id = p_tenant and o.move_out is null and c.status = 'hieu_luc')
      or exists (select 1 from public.contracts c where c.tenant_id = p_tenant and c.status = 'hieu_luc')
$$;

-- Ảnh CCCD: xoá hoặc đổi nhãn ảnh mặt trước/sau chỉ khi còn ảnh khác cùng mặt (tức là đang thay ảnh mới)
create or replace function public.tg_files_cccd_keep() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is null or old.kind <> 'cccd' or old.tenant_id is null or old.label not in ('truoc', 'sau') then
    return case when tg_op = 'DELETE' then old else new end;
  end if;
  if tg_op = 'UPDATE' and new.label is not distinct from old.label and new.tenant_id is not distinct from old.tenant_id then return new; end if;
  if public.tenant_living(old.tenant_id)
     and not exists (select 1 from public.files f where f.kind = 'cccd' and f.tenant_id = old.tenant_id and f.label = old.label and f.id <> old.id) then
    raise exception 'Khách đang ở phải giữ ảnh CCCD mặt %. Muốn đổi ảnh thì tải ảnh mới lên (ảnh cũ tự thay).',
      case old.label when 'truoc' then 'trước' else 'sau' end;
  end if;
  return case when tg_op = 'DELETE' then old else new end;
end $$;
drop trigger if exists files_cccd_keep on public.files;
create trigger files_cccd_keep before delete or update on public.files for each row execute function public.tg_files_cccd_keep();

-- Số CCCD, xác nhận đồng ý: không xoá trắng khi khách đang ở
create or replace function public.tg_tenants_cccd_keep() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is not null and public.tenant_living(old.id)
     and (coalesce(btrim(new.id_number), '') = '' or new.cccd_consent_at is null) then
    raise exception 'Khách đang ở phải có số CCCD và xác nhận đồng ý lưu CCCD.';
  end if;
  return new;
end $$;
drop trigger if exists tenants_cccd_keep on public.tenants;
create trigger tenants_cccd_keep before update of id_number, cccd_consent_at on public.tenants for each row execute function public.tg_tenants_cccd_keep();

revoke execute on function public.tg_contracts_people(), public.tg_files_cccd_keep(), public.tg_tenants_cccd_keep(),
  public.contract_registered(uuid), public.contracts_missing_people(uuid), public.tenant_living(uuid) from public, anon;
grant execute on function public.contract_registered(uuid), public.contracts_missing_people(uuid) to authenticated;
