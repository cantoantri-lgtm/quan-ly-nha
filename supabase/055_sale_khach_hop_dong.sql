-- Sale phòng Kinh doanh phụ trách toà cập nhật được khách thuê, CCCD, hợp đồng (17/11/2026).
-- can_edit_building = Quản lý, Giám sát toà, hoặc sale phòng KD được gán toà (054).
-- Vẫn chỉ Quản lý / Giám sát toà: xoá khách thuê, xoá hợp đồng, đánh dấu đã hoàn cọc.

drop policy if exists tenants_insert on public.tenants;
create policy tenants_insert on public.tenants for insert to authenticated with check (public.can_edit_building(building_id));
drop policy if exists tenants_update on public.tenants;
create policy tenants_update on public.tenants for update to authenticated
  using (public.can_edit_building(building_id)) with check (public.can_edit_building(building_id));

drop policy if exists contracts_insert on public.contracts;
create policy contracts_insert on public.contracts for insert to authenticated with check (public.can_edit_building(building_id));

-- Sửa hợp đồng: sale phụ trách sửa được, trừ đánh dấu hoàn cọc; nhân viên khác chỉ đánh dấu đã thu cọc như cũ
create or replace function public.tg_contracts_before() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if tg_op = 'UPDATE' and auth.uid() is not null and not public.can_manage_building(old.building_id) then
    if public.can_edit_building(old.building_id) then
      if new.deposit_status = 'da_hoan' and old.deposit_status is distinct from 'da_hoan' then
        raise exception 'Đánh dấu hoàn cọc do Quản lý hoặc Giám sát toà làm.';
      end if;
      if new.room_id is distinct from old.room_id then
        select building_id into new.building_id from public.rooms where id = new.room_id;
      end if;
      return new;
    end if;
    if (to_jsonb(new) - 'deposit_status') is distinct from (to_jsonb(old) - 'deposit_status')
       or not (old.deposit_status = 'chua_thu' and new.deposit_status in ('chua_thu','da_thu')) then
      raise exception 'Nhân viên chỉ được đánh dấu đã thu cọc. Cần sửa hợp đồng thì báo sale phụ trách toà hoặc giám sát.';
    end if;
    return new;
  end if;
  select building_id into new.building_id from public.rooms where id = new.room_id;
  return new;
end $$;

-- Số CCCD, ngày cấp, địa chỉ: sale phụ trách xem được
create or replace function public.tenant_private(p_id uuid)
returns table (id_number text, id_issued_date date, id_issued_place text, id_address text)
language sql stable security definer set search_path = public as $$
  select t.id_number, t.id_issued_date, t.id_issued_place, t.id_address
  from public.tenants t
  where t.id = p_id and public.can_edit_building(t.building_id)
$$;

-- Ảnh CCCD (xem, tải), file hợp đồng (tải): sale phụ trách
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
  return case parts[1]
    when 'cccd'      then public.can_edit_building(o)
    when 'hop-dong'  then case when p_write then public.can_edit_building(o) else public.can_access_building(o) end
    when 'anh-phong' then case when p_write then public.can_edit_building(o) else public.can_access_building(o) end
    when 'anh-toa'   then case when p_write then public.can_edit_building(o) else public.can_access_building(o) end
    else false end;
end $$;

revoke execute on function public.tg_contracts_before(), public.tenant_private(uuid), public.storage_path_ok(text, boolean) from public, anon;
grant execute on function public.tenant_private(uuid), public.storage_path_ok(text, boolean) to authenticated;
