-- Nhân viên được gán phụ trách toà (building_members) cập nhật được toà và phòng của mình (17/11/2026).
-- Được: sửa thông tin toà (trừ mã toà, loại hình), thêm / sửa phòng (giá, loại, nội thất, trạng thái…), thêm / sửa loại phòng,
--       sửa dịch vụ & chính sách (trừ hoa hồng), tải / xoá ảnh toà và ảnh phòng.
-- Giữ cho Quản lý / Giám sát toà (can_manage_building): xoá toà, xoá phòng, xoá loại phòng, khách thuê, hợp đồng, CCCD.
-- Chỉ Quản lý: hoa hồng CTV, hoa hồng bỏ cọc, tài khoản nhận tiền của toà, thêm toà mới.

create or replace function public.can_edit_building(b uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select public.can_manage_building(b)
      or (public.app_role() is not null and exists (
            select 1 from public.building_members m where m.building_id = b and m.user_id = auth.uid()))
$$;

-- Toà nhà: nhân viên phụ trách sửa được, nhưng không đổi mã toà và loại hình
drop policy if exists buildings_update on public.buildings;
create policy buildings_update on public.buildings for update to authenticated
  using (public.can_edit_building(id)) with check (public.can_edit_building(id));

create or replace function public.tg_buildings_guard() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is not null and not public.is_manager() then
    if new.code is distinct from old.code or new.kind is distinct from old.kind then
      raise exception 'Chỉ Quản lý đổi được mã toà và loại hình toà';
    end if;
  end if;
  return new;
end $$;
drop trigger if exists buildings_guard on public.buildings;
create trigger buildings_guard before update on public.buildings for each row execute function public.tg_buildings_guard();

-- Phòng
drop policy if exists rooms_insert on public.rooms;
create policy rooms_insert on public.rooms for insert to authenticated with check (public.can_edit_building(building_id));

create or replace function public.tg_rooms_guard() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is not null and not public.can_edit_building(old.building_id)
     and (to_jsonb(new) - 'status' - 'note') is distinct from (to_jsonb(old) - 'status' - 'note') then
    raise exception 'Chỉ người phụ trách toà, Giám sát hoặc Quản lý được sửa thông tin phòng. Bạn chỉ đổi được trạng thái và ghi chú.';
  end if;
  if auth.uid() is not null and new.building_id is distinct from old.building_id and not public.is_manager() then
    raise exception 'Chỉ Quản lý chuyển được phòng sang toà khác';
  end if;
  return new;
end $$;

-- Loại phòng
drop policy if exists rt_insert on public.room_types;
create policy rt_insert on public.room_types for insert to authenticated with check (public.can_edit_building(building_id));
drop policy if exists rt_update on public.room_types;
create policy rt_update on public.room_types for update to authenticated
  using (public.can_edit_building(building_id)) with check (public.can_edit_building(building_id));

-- Dịch vụ & chính sách: nhân viên phụ trách sửa được, phần hoa hồng giữ nguyên (chỉ Quản lý đổi)
drop policy if exists bp_insert on public.building_policy;
create policy bp_insert on public.building_policy for insert to authenticated with check (public.can_edit_building(building_id));
drop policy if exists bp_update on public.building_policy;
create policy bp_update on public.building_policy for update to authenticated
  using (public.can_edit_building(building_id)) with check (public.can_edit_building(building_id));

create or replace function public.tg_building_policy_commission() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is not null and not public.is_manager() then
    if tg_op = 'INSERT' then
      new.commission_terms := '[]'::jsonb; new.forfeit_min := null; new.forfeit_pct := null;
    else
      new.commission_terms := old.commission_terms; new.forfeit_min := old.forfeit_min; new.forfeit_pct := old.forfeit_pct;
    end if;
  end if;
  return new;
end $$;
drop trigger if exists building_policy_commission on public.building_policy;
create trigger building_policy_commission before insert or update on public.building_policy
  for each row execute function public.tg_building_policy_commission();

-- Ảnh toà: người phụ trách toà tải / xoá được
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
    when 'cccd'      then public.can_manage_building(o)
    when 'hop-dong'  then case when p_write then public.can_manage_building(o) else public.can_access_building(o) end
    when 'anh-phong' then public.can_access_building(o)
    when 'anh-toa'   then case when p_write then public.can_edit_building(o) else public.can_access_building(o) end
    else false end;
end $$;

revoke execute on function public.can_edit_building(uuid), public.tg_buildings_guard(), public.tg_building_policy_commission(), public.storage_path_ok(text, boolean) from public, anon;
grant execute on function public.can_edit_building(uuid), public.storage_path_ok(text, boolean) to authenticated;
