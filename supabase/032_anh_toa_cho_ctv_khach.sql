-- Ảnh toà và ảnh phòng là ảnh công khai (trên R2 nằm ở bucket công khai). CTV và khách hàng không có app_role()
-- nên link ký của kho Supabase bị từ chối và bản đồ không hiện ảnh toà. Cho mọi tài khoản đang hoạt động ĐỌC hai thư mục này;
-- ghi vẫn như cũ.
create or replace function public.storage_path_ok(p_name text, p_write boolean) returns boolean
language plpgsql stable security definer set search_path = public as $$
declare
  parts text[] := string_to_array(coalesce(p_name, ''), '/');
  o uuid;
begin
  if array_length(parts, 1) is null or array_length(parts, 1) < 3 then return false; end if;
  begin o := parts[2]::uuid; exception when others then return false; end;
  if parts[1] = 'phan-anh' then
    return public.is_active_user() and exists (
      select 1 from public.feedback_threads f
      where f.id = o and (f.customer_id = auth.uid() or public.feedback_can_handle(f.id))
        and (not p_write or f.status <> 'dong'));
  end if;
  if not p_write and parts[1] in ('anh-toa', 'anh-phong') and public.is_active_user() then return true; end if;
  if public.app_role() is null then return false; end if;
  return case parts[1]
    when 'cccd'      then public.can_manage_building(o)
    when 'hop-dong'  then case when p_write then public.can_manage_building(o) else public.can_access_building(o) end
    when 'anh-phong' then public.can_access_building(o)
    when 'anh-toa'   then case when p_write then public.can_manage_building(o) else public.can_access_building(o) end
    when 'de-nghi'   then exists (select 1 from public.requests r
                                  where r.id = o and (r.requester_id = auth.uid() or public.is_manager()
                                                      or (not p_write and public.is_request_approver(r.id))))
    else false end;
end $$;
revoke execute on function public.storage_path_ok(text, boolean) from public, anon;
grant execute on function public.storage_path_ok(text, boolean) to authenticated;
