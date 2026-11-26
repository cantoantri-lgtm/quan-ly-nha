-- 104: Mở quyền cho người giữ nhiệm vụ Nhân sự (Sơ đồ công ty, duty nhan_su) (26/11/2026)
--  Anh Trí chốt: nhân viên Hành chính – Nhân sự được dùng Cài đặt website, Luồng phê duyệt, tạo tài khoản app, hồ sơ nhân sự.
--  * is_hr_staff(): tài khoản đang hoạt động và giữ nhiệm vụ Nhân sự (không tính Quản lý).
--  * Tài khoản app: Nhân sự tạo và sửa tài khoản Nhân viên, Giám sát (tên, SĐT, vai trò, phép năm, toà, khoá, cấp lại mật khẩu).
--    Không tạo, không nâng lên, không sửa tài khoản Quản lý, không tự sửa vai trò, khoá, phép năm của chính mình.
--    Edge Function quan-ly-tai-khoan kiểm tra cùng quy tắc.
--  * Website: web_settings_get / web_settings_save và kho ảnh web-media mở cho Nhân sự.
--  * Luồng phê duyệt: is_flow_admin() thêm Nhân sự (trước đây chỉ anh Trí).

create or replace function public.is_hr_staff() returns boolean
language sql stable security definer set search_path = public as $$
  select public.is_active_user() and public.is_duty('nhan_su')
$$;
grant execute on function public.is_hr_staff() to authenticated;

-- Người đang đăng nhập được quản lý tài khoản p_user không
create or replace function public.can_admin_account(p_user uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select public.is_manager()
      or (public.is_hr_staff() and p_user is distinct from auth.uid()
          and exists (select 1 from public.profiles where id = p_user and role in ('nhan_vien', 'giam_sat')))
$$;
grant execute on function public.can_admin_account(uuid) to authenticated;

create or replace function public.can_edit_website() returns boolean
language sql stable security definer set search_path = public as $$
  select public.is_manager() or public.is_hr_staff()
$$;
grant execute on function public.can_edit_website() to authenticated;

-- Bảng profiles
create or replace function public.tg_profiles_guard() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is not null and not public.is_manager()
     and (new.role is distinct from old.role or new.is_active is distinct from old.is_active
          or new.phone is distinct from old.phone or new.annual_leave_days is distinct from old.annual_leave_days) then
    if not (public.is_hr_staff() and old.id <> auth.uid()
            and old.role in ('nhan_vien', 'giam_sat') and new.role in ('nhan_vien', 'giam_sat')) then
      raise exception 'Chỉ Quản lý hoặc Nhân sự được đổi vai trò, số điện thoại, ngày phép hoặc khoá tài khoản (Nhân sự không sửa tài khoản Quản lý và tài khoản của chính mình)';
    end if;
  end if;
  if auth.uid() is not null and new.pw_unlock_until is distinct from old.pw_unlock_until then
    raise exception 'Không được tự mở khoá đổi mật khẩu';
  end if;
  return new;
end $$;

drop policy if exists profiles_update on public.profiles;
create policy profiles_update on public.profiles for update to authenticated
  using (id = (select auth.uid()) or public.is_manager()
         or (public.is_hr_staff() and id <> (select auth.uid()) and role in ('nhan_vien', 'giam_sat')))
  with check (id = (select auth.uid()) or public.is_manager()
         or (public.is_hr_staff() and id <> (select auth.uid()) and role in ('nhan_vien', 'giam_sat')));

-- Gán toà
drop policy if exists members_insert on public.building_members;
create policy members_insert on public.building_members for insert to authenticated
  with check (public.can_admin_account(user_id));
drop policy if exists members_delete on public.building_members;
create policy members_delete on public.building_members for delete to authenticated
  using (public.can_admin_account(user_id));
drop policy if exists members_select on public.building_members;
create policy members_select on public.building_members for select to authenticated
  using (user_id = (select auth.uid()) or public.can_manage_building(building_id) or public.is_hr_staff());

-- Website
do $$
declare d text;
begin
  d := pg_get_functiondef('public.web_settings_get()'::regprocedure);
  if position('public.is_manager()' in d) = 0 then raise exception 'web_settings_get đổi khác dự kiến'; end if;
  execute replace(d, 'public.is_manager()', 'public.can_edit_website()');
  d := pg_get_functiondef('public.web_settings_save(jsonb)'::regprocedure);
  if position('if not public.is_manager() then raise exception ''Chỉ Quản lý được sửa website''' in d) = 0 then raise exception 'web_settings_save đổi khác dự kiến'; end if;
  execute replace(d, 'if not public.is_manager() then raise exception ''Chỉ Quản lý được sửa website''',
                     'if not public.can_edit_website() then raise exception ''Chỉ Quản lý hoặc Nhân sự được sửa website''');
end $$;

drop policy if exists web_media_insert on storage.objects;
create policy web_media_insert on storage.objects for insert to authenticated
  with check (bucket_id = 'web-media' and public.can_edit_website() and name ~ '^hero/[0-9a-f-]{36}\.(jpg|png|webp|mp4|webm)$');
drop policy if exists web_media_select on storage.objects;
create policy web_media_select on storage.objects for select to authenticated
  using (bucket_id = 'web-media' and public.can_edit_website());
drop policy if exists web_media_delete on storage.objects;
create policy web_media_delete on storage.objects for delete to authenticated
  using (bucket_id = 'web-media' and public.can_edit_website());

-- Luồng phê duyệt
create or replace function public.is_flow_admin() returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.flow_admins f join public.profiles p on p.id = f.user_id
                 where f.user_id = auth.uid() and p.is_active)
      or public.is_hr_staff()
$$;
do $$
declare d text; f text;
begin
  foreach f in array array['public.approval_flow_save(public.request_kind, jsonb)', 'public.approval_flow_reset(public.request_kind)'] loop
    d := pg_get_functiondef(f::regprocedure);
    if position('Chỉ anh Trí được cài đặt luồng phê duyệt' in d) = 0 then raise exception '% đổi khác dự kiến', f; end if;
    execute replace(d, 'Chỉ anh Trí được cài đặt luồng phê duyệt', 'Chỉ anh Trí hoặc Nhân sự được cài đặt luồng phê duyệt');
  end loop;
end $$;
