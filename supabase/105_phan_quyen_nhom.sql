-- 105: Phân quyền theo nhóm nhân sự (26/11/2026)
-- Anh Trí chốt:
--  * Mỗi tài khoản nhân sự thuộc 1 nhóm quyền. App tự xếp theo Sơ đồ công ty, anh Trí / Admin chỉnh tay được từng người.
--  * Bảng quyền: nhóm × chức năng, mỗi ô Không (0) / Xem (1) / Sửa (2).
--  * Người chỉnh bảng quyền: anh Trí (perm_super) và nhóm Admin. Admin không chỉnh nhóm Phó Giám đốc, nhóm Admin,
--    cột Sơ đồ công ty, cột Bảng lương; không xếp ai vào hoặc ra khỏi 2 nhóm đó; không tự đổi nhóm của mình.
--  * Admin: mọi chức năng trừ Sơ đồ công ty và Bảng lương.
-- Phạm vi: các chức năng quản trị dưới đây. Việc ở toà (phòng, hợp đồng, hoá đơn, ghi điện, thu chi toà) vẫn theo
-- vai trò app (Quản lý / Giám sát / Nhân viên) và toà được gán như cũ.
-- Mặc định của bảng quyền giữ gần đúng quyền đang chạy, để đổi sang không ai mất việc.

-- ===== Bảng =====
create table public.perm_groups (
  code text primary key,
  name text not null,
  note text,
  sort int not null default 0
);
create table public.perm_features (
  code text primary key,
  name text not null,
  note text,
  max_level smallint not null check (max_level in (1, 2)),
  sort int not null default 0
);
create table public.perm_matrix (
  group_code text not null references public.perm_groups(code) on delete cascade,
  feature text not null references public.perm_features(code) on delete cascade,
  level smallint not null check (level between 0 and 2),
  updated_at timestamptz not null default now(),
  updated_by uuid references public.profiles(id) on delete set null,
  primary key (group_code, feature)
);
-- Nhóm chỉnh tay (không có dòng = tự xếp theo Sơ đồ)
create table public.perm_user_group (
  user_id uuid primary key references public.profiles(id) on delete cascade,
  group_code text not null references public.perm_groups(code),
  updated_at timestamptz not null default now(),
  updated_by uuid references public.profiles(id) on delete set null
);
-- Người toàn quyền và luôn chỉnh được bảng quyền (anh Trí)
create table public.perm_super (user_id uuid primary key references public.profiles(id) on delete cascade);
insert into public.perm_super (user_id) select user_id from public.flow_admins on conflict do nothing;

alter table public.perm_groups enable row level security;
alter table public.perm_features enable row level security;
alter table public.perm_matrix enable row level security;
alter table public.perm_user_group enable row level security;
alter table public.perm_super enable row level security;
revoke all on public.perm_groups, public.perm_features, public.perm_matrix, public.perm_user_group, public.perm_super from anon, authenticated;
grant select on public.perm_groups, public.perm_features, public.perm_matrix to authenticated;
create policy perm_groups_select on public.perm_groups for select to authenticated using (public.app_role() is not null);
create policy perm_features_select on public.perm_features for select to authenticated using (public.app_role() is not null);
create policy perm_matrix_select on public.perm_matrix for select to authenticated using (public.app_role() is not null);

insert into public.perm_groups (code, name, note, sort) values
  ('pho_giam_doc', 'Phó Giám đốc', 'Tự xếp: vị trí cấp Phó Giám đốc trong Sơ đồ công ty.', 1),
  ('admin', 'Admin', 'Chỉ xếp tay. Mọi chức năng trừ Sơ đồ công ty và Bảng lương. Được chỉnh bảng quyền, trừ nhóm Phó Giám đốc và Admin.', 2),
  ('truong_phong', 'Trưởng phòng', 'Tự xếp: vị trí cấp Trưởng phòng.', 3),
  ('hr', 'Nhân viên HR', 'Tự xếp: người giữ nhiệm vụ Nhân sự.', 4),
  ('ke_toan', 'Kế toán', 'Tự xếp: người giữ nhiệm vụ Kế toán.', 5),
  ('it', 'IT', 'Tự xếp: vị trí có chữ IT.', 6),
  ('leader_kd', 'Leader kinh doanh', 'Tự xếp: Leader hoặc cấp Leader ở Phòng Kinh doanh.', 7),
  ('nhan_vien_kd', 'Nhân viên kinh doanh', 'Tự xếp: nhân viên Phòng Kinh doanh.', 8),
  ('nhan_vien', 'Nhân viên khác', 'Các vị trí còn lại và tài khoản chưa có trong Sơ đồ công ty.', 9);

insert into public.perm_features (code, name, note, max_level, sort) values
  ('so_do', 'Sơ đồ công ty', 'Xem: sơ đồ, vị trí, nhiệm vụ. Sửa: thêm, đổi vị trí, gắn người, đặt Leader và nhiệm vụ.', 2, 1),
  ('luong', 'Bảng lương', 'Thang lương và lương cơ bản từng người. Thông tin bảo mật.', 2, 2),
  ('ho_so_ns', 'Hồ sơ nhân sự', 'Mã NV, ngày sinh, CCCD, xuất Excel.', 2, 3),
  ('tai_khoan', 'Tài khoản app', 'Xem: danh sách tài khoản, toà được gán. Sửa: tạo, gán toà, khoá, cấp lại mật khẩu. Tài khoản Quản lý chỉ người có vai trò Quản lý sửa.', 2, 4),
  ('bao_cao', 'Báo cáo', 'Thu chi, chốt tháng, lấp đầy, phản ánh. Số chi phí, lợi nhuận vẫn chỉ Quản lý, Kế toán thấy.', 1, 5),
  ('bao_cao_ai', 'Báo cáo AI', 'Trợ lý hỏi đáp số liệu và nhận định tuần.', 1, 6),
  ('hd_gtgt', 'Hoá đơn GTGT', 'Danh sách khoản cần xuất hoá đơn trong ngày.', 1, 7),
  ('tk_nhan_tien', 'Tài khoản nhận tiền', 'Xem trang. Sửa: tài khoản ngân hàng chung và của từng toà.', 2, 8),
  ('website', 'Cài đặt website', 'Xem trang. Sửa: nội dung, ảnh đầu trang, nút Liên hệ, bản tiếng Anh.', 2, 9),
  ('luong_duyet', 'Luồng phê duyệt', 'Ai cũng xem được luồng. Sửa: đổi người duyệt từng bước.', 2, 10);

-- Mặc định (thứ tự cột: PGĐ, Admin, Trưởng phòng, HR, Kế toán, IT, Leader KD, NV KD, NV khác)
insert into public.perm_matrix (group_code, feature, level)
select g, f, lv from (values
  ('so_do',        array[2,0,1,1,0,0,0,0,0]),
  ('luong',        array[2,0,0,0,0,0,0,0,0]),
  ('ho_so_ns',     array[2,2,0,2,0,0,0,0,0]),
  ('tai_khoan',    array[2,2,0,2,0,2,0,0,0]),
  ('bao_cao',      array[1,1,1,0,1,0,1,0,0]),
  ('bao_cao_ai',   array[1,1,0,0,0,0,0,0,0]),
  ('hd_gtgt',      array[1,1,0,0,1,0,0,0,0]),
  ('tk_nhan_tien', array[2,2,0,0,1,0,0,0,0]),
  ('website',      array[2,2,0,2,0,2,0,0,0]),
  ('luong_duyet',  array[1,2,0,2,0,0,0,0,0])
) v(f, lvs)
cross join lateral unnest(array['pho_giam_doc','admin','truong_phong','hr','ke_toan','it','leader_kd','nhan_vien_kd','nhan_vien'], lvs) u(g, lv);

-- ===== Hàm =====
create or replace function public.is_perm_super(p_user uuid default auth.uid()) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.perm_super s join public.profiles p on p.id = s.user_id where s.user_id = p_user and p.is_active)
$$;

-- Nhóm tự xếp theo Sơ đồ công ty (vị trí cấp cao nhất nếu một người giữ nhiều vị trí)
create or replace function public.perm_auto_group(p_user uuid) returns text
language sql stable security definer set search_path = public as $$
  select case
    when s.id is null then 'nhan_vien'
    when coalesce(s.level, 0) >= 4 then 'pho_giam_doc'
    when s.duty = 'nhan_su' then 'hr'
    when s.duty = 'ke_toan' then 'ke_toan'
    when s.position ~ '(^|[^[:alpha:]])IT([^[:alpha:]]|$)' then 'it'
    when s.level = 3 then 'truong_phong'
    when d.name ilike '%kinh doanh%' and (s.is_leader or s.level = 2) then 'leader_kd'
    when d.name ilike '%kinh doanh%' then 'nhan_vien_kd'
    else 'nhan_vien' end
  from public.profiles p
  left join lateral (select * from public.org_staff o where o.profile_id = p.id
                     and o.status in ('co', 'tap_su', 'thu_viec', 'thue_ngoai')
                     order by o.level desc nulls last, o.sort limit 1) s on true
  left join public.departments d on d.id = s.department_id
  where p.id = p_user and p.role in ('quan_ly', 'giam_sat', 'nhan_vien')
$$;

create or replace function public.perm_group_of(p_user uuid) returns text
language sql stable security definer set search_path = public as $$
  select coalesce((select group_code from public.perm_user_group where user_id = p_user), public.perm_auto_group(p_user))
$$;

create or replace function public.perm_level_for(p_user uuid, p_feature text) returns int
language sql stable security definer set search_path = public as $$
  select case
    when not exists (select 1 from public.profiles where id = p_user and is_active and role in ('quan_ly', 'giam_sat', 'nhan_vien')) then 0
    when public.is_perm_super(p_user) then coalesce((select max_level from public.perm_features where code = p_feature), 0)
    else coalesce((select m.level from public.perm_matrix m where m.group_code = public.perm_group_of(p_user) and m.feature = p_feature), 0)
  end
$$;

create or replace function public.perm_level(p_feature text) returns int
language sql stable security definer set search_path = public as $$
  select case when auth.uid() is null then 0 else public.perm_level_for(auth.uid(), p_feature) end
$$;

create or replace function public.is_perm_editor() returns boolean
language sql stable security definer set search_path = public as $$
  select public.is_perm_super() or (public.app_role() is not null and public.perm_group_of(auth.uid()) = 'admin')
$$;

revoke execute on function public.is_perm_super(uuid), public.perm_auto_group(uuid), public.perm_group_of(uuid), public.perm_level_for(uuid, text) from public, anon, authenticated;
grant execute on function public.perm_level_for(uuid, text) to service_role;
revoke execute on function public.perm_level(text), public.is_perm_editor() from public, anon;
grant execute on function public.perm_level(text), public.is_perm_editor() to authenticated;

-- Quyền của người đang đăng nhập (giao diện ẩn/hiện; CSDL vẫn chặn)
create or replace function public.my_perms() returns jsonb
language sql stable security definer set search_path = public as $$
  select case when public.app_role() is null or public.app_role() not in ('quan_ly', 'giam_sat', 'nhan_vien') then
      jsonb_build_object('group', null, 'perms', '{}'::jsonb, 'editor', false, 'super', false)
    else jsonb_build_object(
      'group', public.perm_group_of(auth.uid()),
      'group_name', (select name from public.perm_groups where code = public.perm_group_of(auth.uid())),
      'perms', (select jsonb_object_agg(f.code, public.perm_level(f.code)) from public.perm_features f),
      'editor', public.is_perm_editor(),
      'super', public.is_perm_super())
  end
$$;
revoke execute on function public.my_perms() from public, anon;
grant execute on function public.my_perms() to authenticated;

-- Danh sách người cho trang Phân quyền
create or replace function public.perm_people()
returns table (user_id uuid, full_name text, role text, is_active boolean, job_title text, department text,
  auto_group text, manual_group text, group_code text, is_super boolean)
language plpgsql stable security definer set search_path = public as $$
begin
  if not public.is_perm_editor() then raise exception 'Chỉ anh Trí hoặc nhóm Admin xem trang Phân quyền'; end if;
  return query
  select p.id, p.full_name, p.role::text, p.is_active, s.position, d.name,
         public.perm_auto_group(p.id), ug.group_code, public.perm_group_of(p.id), public.is_perm_super(p.id)
  from public.profiles p
  left join lateral (select * from public.org_staff o where o.profile_id = p.id
                     and o.status in ('co', 'tap_su', 'thu_viec', 'thue_ngoai')
                     order by o.level desc nulls last, o.sort limit 1) s on true
  left join public.departments d on d.id = s.department_id
  left join public.perm_user_group ug on ug.user_id = p.id
  where p.role in ('quan_ly', 'giam_sat', 'nhan_vien')
  order by p.is_active desc, d.sort nulls last, s.level desc nulls last, p.full_name;
end $$;
revoke execute on function public.perm_people() from public, anon;
grant execute on function public.perm_people() to authenticated;

-- Đổi 1 ô trong bảng quyền
create or replace function public.perm_matrix_save(p_group text, p_feature text, p_level int) returns void
language plpgsql security definer set search_path = public as $$
declare mx int;
begin
  if not public.is_perm_editor() then raise exception 'Chỉ anh Trí hoặc nhóm Admin chỉnh bảng quyền'; end if;
  select max_level into mx from public.perm_features where code = p_feature;
  if mx is null or not exists (select 1 from public.perm_groups where code = p_group) then raise exception 'Không có nhóm hoặc chức năng này'; end if;
  if p_level is null or p_level < 0 or p_level > mx then raise exception 'Mức quyền không hợp lệ'; end if;
  if not public.is_perm_super() and (p_group in ('pho_giam_doc', 'admin') or p_feature in ('so_do', 'luong')) then
    raise exception 'Nhóm Phó Giám đốc, nhóm Admin, Sơ đồ công ty và Bảng lương chỉ anh Trí chỉnh';
  end if;
  insert into public.perm_matrix (group_code, feature, level, updated_at, updated_by)
  values (p_group, p_feature, p_level, now(), auth.uid())
  on conflict (group_code, feature) do update set level = excluded.level, updated_at = now(), updated_by = auth.uid();
end $$;
revoke execute on function public.perm_matrix_save(text, text, int) from public, anon;
grant execute on function public.perm_matrix_save(text, text, int) to authenticated;

-- Xếp nhóm cho 1 người (p_group null = trả về tự xếp)
create or replace function public.perm_user_set(p_user uuid, p_group text) returns void
language plpgsql security definer set search_path = public as $$
declare cur text; nxt text; nm text;
begin
  if not public.is_perm_editor() then raise exception 'Chỉ anh Trí hoặc nhóm Admin xếp nhóm quyền'; end if;
  if not exists (select 1 from public.profiles where id = p_user and role in ('quan_ly', 'giam_sat', 'nhan_vien')) then
    raise exception 'Chỉ xếp nhóm cho tài khoản nhân sự';
  end if;
  if p_group is not null and not exists (select 1 from public.perm_groups where code = p_group) then raise exception 'Không có nhóm này'; end if;
  cur := public.perm_group_of(p_user);
  nxt := coalesce(p_group, public.perm_auto_group(p_user));
  if not public.is_perm_super() then
    if p_user = auth.uid() then raise exception 'Không tự đổi nhóm quyền của mình. Nhờ anh Trí.'; end if;
    if cur in ('pho_giam_doc', 'admin') or nxt in ('pho_giam_doc', 'admin') then
      raise exception 'Xếp vào hoặc ra khỏi nhóm Phó Giám đốc, Admin chỉ anh Trí làm';
    end if;
  end if;
  if p_group is null then
    delete from public.perm_user_group where user_id = p_user;
  else
    insert into public.perm_user_group (user_id, group_code, updated_at, updated_by) values (p_user, p_group, now(), auth.uid())
    on conflict (user_id) do update set group_code = excluded.group_code, updated_at = now(), updated_by = auth.uid();
  end if;
  if nxt is distinct from cur and p_user <> auth.uid() then
    select name into nm from public.perm_groups where code = nxt;
    perform public.notify(p_user, 'khac', 'Quyền trên app đã đổi',
      'Bạn được xếp vào nhóm ' || coalesce(nm, nxt) || '. Mở lại app để thấy chức năng mới.', 'perm', null, 'perm:' || p_user::text);
  end if;
end $$;
revoke execute on function public.perm_user_set(uuid, text) from public, anon;
grant execute on function public.perm_user_set(uuid, text) to authenticated;

-- ===== Chốt chặn các chức năng theo bảng quyền =====
-- Sơ đồ công ty
create or replace function public.can_see_org() returns boolean
language sql stable security definer set search_path = public as $$ select public.perm_level('so_do') >= 1 $$;
drop policy if exists dep_write on public.departments;
create policy dep_write on public.departments for all to authenticated
  using (public.perm_level('so_do') >= 2) with check (public.perm_level('so_do') >= 2);
drop policy if exists staff_write on public.org_staff;
create policy staff_write on public.org_staff for all to authenticated
  using (public.perm_level('so_do') >= 2) with check (public.perm_level('so_do') >= 2);

-- Bảng lương
drop policy if exists scale_select on public.salary_scale;
create policy scale_select on public.salary_scale for select to authenticated using (public.perm_level('luong') >= 1);
drop policy if exists scale_write on public.salary_scale;
create policy scale_write on public.salary_scale for all to authenticated
  using (public.perm_level('luong') >= 2) with check (public.perm_level('luong') >= 2);
drop policy if exists pay_select on public.org_staff_pay;
create policy pay_select on public.org_staff_pay for select to authenticated
  using (public.perm_level('luong') >= 1
         or exists (select 1 from public.org_staff s where s.id = org_staff_pay.staff_id and s.profile_id = (select auth.uid())));
drop policy if exists pay_write on public.org_staff_pay;
create policy pay_write on public.org_staff_pay for all to authenticated
  using (public.perm_level('luong') >= 2) with check (public.perm_level('luong') >= 2);

-- Hồ sơ nhân sự
create or replace function public.is_hr() returns boolean
language sql stable security definer set search_path = public as $$ select public.perm_level('ho_so_ns') >= 1 $$;
do $$
declare d text;
begin
  d := pg_get_functiondef('public.staff_personal_save(uuid, text, date, text)'::regprocedure);
  if position('if not public.is_hr() then raise exception ''Chỉ Quản lý hoặc Nhân sự cập nhật hồ sơ nhân sự''' in d) = 0 then
    raise exception 'staff_personal_save đổi khác dự kiến';
  end if;
  execute replace(d, 'if not public.is_hr() then raise exception ''Chỉ Quản lý hoặc Nhân sự cập nhật hồ sơ nhân sự''',
                     'if public.perm_level(''ho_so_ns'') < 2 then raise exception ''Bạn chưa được quyền sửa hồ sơ nhân sự''');
end $$;

-- Tài khoản app
create or replace function public.can_admin_account(p_user uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select public.perm_level('tai_khoan') >= 2
     and (public.is_manager()
          or (p_user is distinct from auth.uid()
              and exists (select 1 from public.profiles where id = p_user and role in ('nhan_vien', 'giam_sat'))))
$$;
create or replace function public.tg_profiles_guard() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is not null
     and (new.role is distinct from old.role or new.is_active is distinct from old.is_active
          or new.phone is distinct from old.phone or new.annual_leave_days is distinct from old.annual_leave_days)
     and not (public.can_admin_account(old.id) and (public.is_manager() or new.role in ('nhan_vien', 'giam_sat'))) then
    raise exception 'Bạn chưa được quyền đổi vai trò, số điện thoại, ngày phép hoặc khoá tài khoản này';
  end if;
  if auth.uid() is not null and new.pw_unlock_until is distinct from old.pw_unlock_until then
    raise exception 'Không được tự mở khoá đổi mật khẩu';
  end if;
  return new;
end $$;
drop policy if exists profiles_update on public.profiles;
create policy profiles_update on public.profiles for update to authenticated
  using (id = (select auth.uid()) or public.can_admin_account(id))
  with check (id = (select auth.uid()) or public.can_admin_account(id));
drop policy if exists members_select on public.building_members;
create policy members_select on public.building_members for select to authenticated
  using (user_id = (select auth.uid()) or public.can_manage_building(building_id) or public.perm_level('tai_khoan') >= 1);

-- Website
create or replace function public.can_edit_website() returns boolean
language sql stable security definer set search_path = public as $$ select public.perm_level('website') >= 2 $$;
do $$
declare d text;
begin
  d := pg_get_functiondef('public.web_settings_get()'::regprocedure);
  if position('public.can_edit_website()' in d) = 0 then raise exception 'web_settings_get đổi khác dự kiến'; end if;
  execute replace(d, 'public.can_edit_website()', 'public.perm_level(''website'') >= 1');
end $$;

-- Luồng phê duyệt
create or replace function public.is_flow_admin() returns boolean
language sql stable security definer set search_path = public as $$ select public.perm_level('luong_duyet') >= 2 $$;

-- Báo cáo
do $$
declare d text; f text;
begin
  foreach f in array array['report_cashflow(date,date,text)', 'report_cashflow_detail(date,date)', 'report_occupancy',
                           'report_occupancy_group', 'report_occupancy_rooms'] loop
    for d in select pg_get_functiondef(p.oid) from pg_proc p where p.pronamespace = 'public'::regnamespace
               and p.proname = split_part(f, '(', 1) loop
      if position('if not (public.is_lead_up() or fin) then raise exception ''Chỉ Lead Sale, Giám sát, Kế toán, Quản lý xem báo cáo''' in d) = 0 then
        raise exception '% đổi khác dự kiến', f;
      end if;
      execute replace(d, 'if not (public.is_lead_up() or fin) then raise exception ''Chỉ Lead Sale, Giám sát, Kế toán, Quản lý xem báo cáo''',
                         'if public.perm_level(''bao_cao'') < 1 then raise exception ''Bạn chưa được quyền xem báo cáo''');
    end loop;
  end loop;
  for d in select pg_get_functiondef(p.oid) from pg_proc p where p.pronamespace = 'public'::regnamespace and p.proname = 'report_feedback' loop
    if position('if not public.is_lead_up() then raise exception ''Chỉ Lead Sale, Giám sát, Quản lý xem báo cáo''' in d) = 0 then
      raise exception 'report_feedback đổi khác dự kiến';
    end if;
    execute replace(d, 'if not public.is_lead_up() then raise exception ''Chỉ Lead Sale, Giám sát, Quản lý xem báo cáo''',
                       'if public.perm_level(''bao_cao'') < 1 then raise exception ''Bạn chưa được quyền xem báo cáo''');
  end loop;
end $$;

-- Báo cáo AI
create or replace function public.ai_guard() returns void
language plpgsql stable security definer set search_path = public as $$
begin
  if not (public.perm_level('bao_cao_ai') >= 1 or coalesce(auth.role(), '') = 'service_role') then
    raise exception 'Bạn chưa được quyền dùng trợ lý báo cáo AI';
  end if;
end $$;

-- Hoá đơn GTGT (giữ câu báo lỗi cũ, chỉ đổi điều kiện)
do $$
declare d text;
begin
  for d in select pg_get_functiondef(p.oid) from pg_proc p where p.pronamespace = 'public'::regnamespace and p.proname = 'vat_daily_report' loop
    if position('if not (public.is_manager() or public.is_duty(''ke_toan'')) then' in d) = 0 then
      raise exception 'vat_daily_report đổi khác dự kiến';
    end if;
    execute replace(d, 'if not (public.is_manager() or public.is_duty(''ke_toan'')) then', 'if public.perm_level(''hd_gtgt'') < 1 then');
  end loop;
end $$;

-- Tài khoản nhận tiền
drop policy if exists bba_insert on public.building_bank_accounts;
create policy bba_insert on public.building_bank_accounts for insert to authenticated with check (public.perm_level('tk_nhan_tien') >= 2);
drop policy if exists bba_update on public.building_bank_accounts;
create policy bba_update on public.building_bank_accounts for update to authenticated
  using (public.perm_level('tk_nhan_tien') >= 2) with check (public.perm_level('tk_nhan_tien') >= 2);
drop policy if exists bba_delete on public.building_bank_accounts;
create policy bba_delete on public.building_bank_accounts for delete to authenticated using (public.perm_level('tk_nhan_tien') >= 2);
drop policy if exists pay_settings_insert on public.payment_settings;
create policy pay_settings_insert on public.payment_settings for insert to authenticated with check (public.perm_level('tk_nhan_tien') >= 2);
drop policy if exists pay_settings_update on public.payment_settings;
create policy pay_settings_update on public.payment_settings for update to authenticated
  using (public.perm_level('tk_nhan_tien') >= 2) with check (public.perm_level('tk_nhan_tien') >= 2);
drop policy if exists cpa_write on public.customer_pay_account;
create policy cpa_write on public.customer_pay_account for all to authenticated
  using (public.perm_level('tk_nhan_tien') >= 2) with check (public.perm_level('tk_nhan_tien') >= 2);
