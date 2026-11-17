-- Chỉ nhân viên phòng Kinh doanh (sale) được gán phụ trách toà mới sửa dữ liệu toà và phòng (17/11/2026).
-- Nhân viên phòng ban khác được gán toà (VD Kế toán) chỉ xem, không sửa toà, phòng, loại phòng, chính sách, ảnh toà / ảnh phòng,
-- kể cả trạng thái và ghi chú phòng. Quản lý và Giám sát toà (can_manage_building) giữ nguyên quyền.

create or replace function public.can_edit_building(b uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select public.can_manage_building(b)
      or (public.app_role() is not null and exists (
            select 1 from public.building_members m
            join public.org_staff o on o.profile_id = m.user_id
            join public.departments d on d.id = o.department_id and d.code = 'KD'
            where m.building_id = b and m.user_id = auth.uid()))
$$;

-- Trạng thái, ghi chú phòng: cũng chỉ người sửa được toà
drop policy if exists rooms_update on public.rooms;
create policy rooms_update on public.rooms for update to authenticated
  using (public.can_edit_building(building_id)) with check (public.can_edit_building(building_id));

-- Ảnh phòng: xem như cũ, tải / xoá chỉ người sửa được toà
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
    when 'anh-phong' then case when p_write then public.can_edit_building(o) else public.can_access_building(o) end
    when 'anh-toa'   then case when p_write then public.can_edit_building(o) else public.can_access_building(o) end
    else false end;
end $$;

revoke execute on function public.can_edit_building(uuid), public.storage_path_ok(text, boolean) from public, anon;
grant execute on function public.can_edit_building(uuid), public.storage_path_ok(text, boolean) to authenticated;
