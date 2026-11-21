-- 082: Người giao đổi người phụ trách chính của công việc và PIC dự án
--  * task_change_main: Quản lý, người giao (không phải Nhân viên), Giám sát của toà. Người mới phải là cấp dưới
--    (tg_tasks_guard kiểm tra). Người cũ được giữ lại cùng làm hoặc rời việc. Ghi nhật ký vào task_updates.
--  * project_change_pic: chỉ Quản lý hoặc người giao dự án (created_by). PIC không tự đổi PIC.
--    Người cũ giữ lại làm hỗ trợ hoặc rời. Ghi nhật ký vào project_logs.
--  * tg_projects_guard: chặn PIC tự đổi pic_id qua form sửa dự án.
--  * Thông báo: người mới, người cũ, người cùng làm, người giao (nếu không phải người đổi).

-- ============ A. Cờ bỏ qua thông báo "Cập nhật tiến độ" cho dòng nhật ký tự sinh ============
do $$
declare d text := pg_get_functiondef('public.tg_task_updates_after'::regproc);
        a text := 'select * into t from public.tasks where id = new.task_id;';
begin
  if position(a in d) = 0 then raise exception '082: không thấy đoạn cần vá trong tg_task_updates_after'; end if;
  d := replace(d, a, a || E'\n  if current_setting(''app.silent_task_log'', true) = ''1'' then return null; end if;');
  execute d;
end $$;

-- Người mới được giao làm phụ trách chính (khi sửa việc): ghi rõ thay vì "Bạn được giao việc mới"
do $$
declare d text := pg_get_functiondef('public.tg_tasks_notify'::regproc);
        a text := 'perform public.notify(new.assignee_id, ''giao_viec'', ''Bạn được giao việc mới'',';
begin
  if position(a in d) = 0 then raise exception '082: không thấy đoạn cần vá trong tg_tasks_notify'; end if;
  d := replace(d, a, 'perform public.notify(new.assignee_id, ''giao_viec'', case when tg_op = ''UPDATE'' then ''Bạn được giao phụ trách chính'' else ''Bạn được giao việc mới'' end,');
  execute d;
end $$;

-- ============ B. PIC dự án chỉ người giao đổi ============
do $$
declare d text := pg_get_functiondef('public.tg_projects_guard'::regproc);
        a text := 'new.id := old.id; new.code := old.code;';
begin
  if position(a in d) = 0 then raise exception '082: không thấy đoạn cần vá trong tg_projects_guard'; end if;
  d := replace(d, a,
    'if new.pic_id is distinct from old.pic_id and auth.uid() is not null and not (public.is_manager() or old.created_by = auth.uid()) then' || E'\n' ||
    '      raise exception ''Chỉ người giao dự án đổi được người phụ trách (PIC)'';' || E'\n' ||
    '    end if;' || E'\n    ' || a);
  execute d;
end $$;

-- ============ C. Đổi người phụ trách chính của việc ============
create or replace function public.task_change_main(p_task uuid, p_user uuid, p_keep_old boolean default false, p_note text default null)
returns void language plpgsql security definer set search_path = public as $$
declare
  t public.tasks; me uuid := auth.uid(); my_role public.user_role := public.app_role();
  old_id uuid; old_name text; new_name text; r public.user_role; act boolean; u uuid; msg text;
begin
  if my_role is null then raise exception 'Cần đăng nhập'; end if;
  select * into t from public.tasks where id = p_task for update;
  if not found then raise exception 'Không tìm thấy việc'; end if;
  if t.parent_id is not null then raise exception 'Bước của việc theo người phụ trách của việc chính'; end if;
  if not (public.is_manager()
          or (t.created_by = me and my_role <> 'nhan_vien')
          or (my_role = 'giam_sat' and t.building_id is not null and public.can_access_building(t.building_id))) then
    raise exception 'Chỉ người giao việc đổi được người phụ trách chính';
  end if;
  if t.status = 'xong' then raise exception 'Việc đã xong, không đổi người phụ trách'; end if;
  if p_user is null then raise exception 'Chọn người phụ trách mới'; end if;
  if p_user = t.assignee_id then raise exception 'Người này đang phụ trách chính'; end if;
  select role, is_active, full_name into r, act, new_name from public.profiles where id = p_user;
  if not found or not act then raise exception 'Người phụ trách mới không tồn tại hoặc đã nghỉ'; end if;
  if r in ('cong_tac_vien', 'khach_hang') then raise exception 'Không giao việc cho Cộng tác viên hoặc khách hàng'; end if;

  old_id := t.assignee_id;
  select full_name into old_name from public.profiles where id = old_id;

  -- tg_tasks_guard kiểm tra cấp dưới; tg_tasks_main_dedupe bỏ người mới khỏi danh sách cùng làm;
  -- tg_tasks_notify báo người mới
  update public.tasks set assignee_id = p_user where id = p_task;

  if old_id is not null then
    if p_keep_old then
      insert into public.task_assignees (task_id, user_id, added_by) values (p_task, old_id, me) on conflict do nothing;
    else
      delete from public.task_assignees where task_id = p_task and user_id = old_id;
    end if;
  end if;

  msg := 'Đổi người phụ trách chính: ' || coalesce(old_name, 'chưa có') || ' → ' || new_name
      || case when old_id is not null and p_keep_old then ' (' || old_name || ' tiếp tục cùng làm)' else '' end
      || coalesce('. Lý do: ' || nullif(trim(p_note), ''), '');
  perform set_config('app.silent_task_log', '1', true);
  insert into public.task_updates (task_id, author_id, note) values (p_task, me, left(msg, 2000));
  perform set_config('app.silent_task_log', '', true);

  if old_id is not null and old_id <> me then
    perform public.notify(old_id, 'giao_viec',
      case when p_keep_old then 'Bạn chuyển sang cùng làm' else 'Bạn không còn phụ trách việc' end,
      t.title || ' · người phụ trách mới: ' || new_name,
      case when p_keep_old then 'task' end, case when p_keep_old then t.id end);
  end if;
  for u in select distinct x from (
      select a.user_id x from public.task_assignees a where a.task_id = p_task
      union all select t.created_by) s
    where x is not null and x <> me and x <> p_user and x is distinct from old_id loop
    perform public.notify(u, 'cap_nhat_viec', 'Đổi người phụ trách: ' || t.title,
      coalesce(old_name, 'chưa có') || ' → ' || new_name, 'task', t.id);
  end loop;
end $$;
revoke execute on function public.task_change_main(uuid, uuid, boolean, text) from public, anon;
grant execute on function public.task_change_main(uuid, uuid, boolean, text) to authenticated;

-- ============ D. Đổi PIC dự án ============
create or replace function public.project_change_pic(p_project uuid, p_user uuid, p_keep_old boolean default false, p_note text default null)
returns void language plpgsql security definer set search_path = public as $$
declare
  p public.projects; me uuid := auth.uid(); old_id uuid; old_name text; new_name text; act boolean; r public.user_role; msg text;
begin
  if public.app_role() is null then raise exception 'Cần đăng nhập'; end if;
  select * into p from public.projects where id = p_project for update;
  if not found then raise exception 'Không tìm thấy dự án'; end if;
  if not (public.is_manager() or p.created_by = me) then
    raise exception 'Chỉ người giao dự án đổi được người phụ trách (PIC)';
  end if;
  if p.status in ('hoan_thanh', 'huy') then raise exception 'Dự án đã đóng, không đổi PIC'; end if;
  if p_user is null then raise exception 'Chọn PIC mới'; end if;
  if p_user = p.pic_id then raise exception 'Người này đang là PIC'; end if;
  select role, is_active, full_name into r, act, new_name from public.profiles where id = p_user;
  if not found or not act or r not in ('quan_ly', 'giam_sat', 'nhan_vien') then
    raise exception 'PIC phải là nhân sự đang làm việc';
  end if;

  old_id := p.pic_id;
  select full_name into old_name from public.profiles where id = old_id;

  delete from public.project_members where project_id = p_project and user_id = p_user;
  update public.projects set pic_id = p_user where id = p_project;   -- tg_projects_notify báo PIC mới
  if p_keep_old and old_id is not null then
    insert into public.project_members (project_id, user_id) values (p_project, old_id) on conflict do nothing;
  end if;

  msg := 'Đổi PIC dự án: ' || coalesce(old_name, 'chưa có') || ' → ' || new_name
      || case when p_keep_old and old_id is not null then ' (' || old_name || ' chuyển sang hỗ trợ)' else '' end
      || coalesce('. Lý do: ' || nullif(trim(p_note), ''), '');
  insert into public.project_logs (project_id, item_id, note, by_id) values (p_project, null, left(msg, 2000), me);

  if old_id is not null and old_id <> me then
    -- giữ lại: trigger project_members đã báo "được thêm hỗ trợ"; không giữ: báo rời vai trò
    if not p_keep_old then
      perform public.notify(old_id, 'giao_viec', 'Bạn không còn là PIC dự án',
        p.code || ' · ' || p.name || ' · PIC mới: ' || new_name, null, null, null);
    end if;
  end if;
  if p.created_by is not null and p.created_by <> me and p.created_by <> p_user then
    perform public.notify(p.created_by, 'cap_nhat_viec', 'Đổi PIC dự án ' || p.code,
      coalesce(old_name, 'chưa có') || ' → ' || new_name, 'project', p.id, null);
  end if;
end $$;
revoke execute on function public.project_change_pic(uuid, uuid, boolean, text) from public, anon;
grant execute on function public.project_change_pic(uuid, uuid, boolean, text) to authenticated;
