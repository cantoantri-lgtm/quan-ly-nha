-- 110: Giao việc có KPI, phản hồi tiến độ theo KPI, gia hạn cho cả việc chính và hạng mục (bước)
--  Giao việc (việc chính và từng hạng mục): nội dung, người chính, người phụ, KPI, hạn.
--    * tasks.kpi (kết quả cần đạt), kpi_target + kpi_unit (chỉ tiêu số, không bắt buộc), kpi_actual, progress (0–100 %).
--    * Hạng mục (tasks có parent_id) có người chính (assignee_id) và người phụ (task_assignees của hạng mục).
--      Người làm hạng mục phải nằm trong nhóm của việc chính (người chính + người cùng làm).
--    * Người giao hạng mục = created_by của hạng mục. Người giao việc chính cũng sửa được hạng mục.
--  Phản hồi (task_feedback): tiến độ so với KPI, kết quả, vấn đề, nguyên nhân, giải pháp, xin gia hạn.
--    * Xin gia hạn đi kèm phản hồi: tạo deadline_requests (có nguyên nhân). Người giao duyệt.
--    * Hạng mục gia hạn quá hạn việc chính: người giao việc chính (hoặc Quản lý) duyệt thì hạn việc chính lùi theo;
--      người khác duyệt thì báo phải gia hạn việc chính trước.

-- ============ A. Cột mới ============
alter table public.tasks
  add column if not exists kpi        text check (char_length(kpi) <= 500),
  add column if not exists kpi_target numeric check (kpi_target > 0),
  add column if not exists kpi_unit   text check (char_length(kpi_unit) <= 30),
  add column if not exists kpi_actual numeric check (kpi_actual >= 0),
  add column if not exists progress   smallint not null default 0 check (progress between 0 and 100);
update public.tasks set progress = 100 where status = 'xong' and progress = 0;

alter table public.task_updates
  add column if not exists progress   smallint check (progress between 0 and 100),
  add column if not exists kpi_actual numeric check (kpi_actual >= 0),
  add column if not exists issue      text check (char_length(issue) <= 2000),
  add column if not exists cause      text check (char_length(cause) <= 2000),
  add column if not exists solution   text check (char_length(solution) <= 2000),
  add column if not exists deadline_request_id uuid references public.deadline_requests(id) on delete set null;
create index if not exists task_updates_dl on public.task_updates(deadline_request_id) where deadline_request_id is not null;

alter table public.deadline_requests
  add column if not exists cause text check (char_length(cause) <= 2000);

-- Người trong nhóm của một việc chính: người chính + người cùng làm
create or replace function public.task_in_team(p_parent uuid, p_user uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.tasks t where t.id = p_parent and t.assignee_id = p_user)
      or exists (select 1 from public.task_assignees a where a.task_id = p_parent and a.user_id = p_user)
$$;
revoke execute on function public.task_in_team(uuid, uuid) from public, anon;
grant execute on function public.task_in_team(uuid, uuid) to authenticated;

-- ============ B. Chặn sửa: KPI theo người giao; người làm hạng mục thuộc nhóm việc chính ============
create or replace function public.tg_tasks_guard() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  me      uuid := auth.uid();
  my_role public.user_role := public.app_role();
  a_role  public.user_role;
  p       public.tasks;
begin
  if new.parent_id is not null then
    select * into p from public.tasks where id = new.parent_id;
    if tg_op = 'INSERT' and p.parent_id is not null then raise exception 'Hạng mục chỉ chia một cấp'; end if;
    new.building_id := coalesce(new.building_id, p.building_id);
    new.assignee_id := coalesce(new.assignee_id, p.assignee_id);
    if tg_op = 'INSERT' then new.due_date := coalesce(new.due_date, p.due_date); end if;
  end if;

  if new.status = 'xong' and (tg_op = 'INSERT' or old.status <> 'xong') then
    new.completed_at := now();
    new.progress := 100;
  elsif new.status <> 'xong' then
    new.completed_at := null;
  end if;
  new.updated_at := now();

  if me is null then return new; end if;            -- chạy từ SQL Editor / lịch hệ thống

  if tg_op = 'INSERT' then
    new.created_by := me;
  else
    new.created_by := old.created_by;
    if not (public.is_manager()
            or (old.created_by = me and (my_role <> 'nhan_vien' or old.parent_id is not null))
            or (old.parent_id is not null and p.created_by = me)
            or (my_role = 'giam_sat' and old.building_id is not null
                and public.can_access_building(old.building_id))) then
      if new.title is distinct from old.title or new.description is distinct from old.description
         or new.assignee_id is distinct from old.assignee_id or new.due_date is distinct from old.due_date
         or new.building_id is distinct from old.building_id or new.parent_id is distinct from old.parent_id
         or new.priority is distinct from old.priority
         or new.kpi is distinct from old.kpi or new.kpi_target is distinct from old.kpi_target
         or new.kpi_unit is distinct from old.kpi_unit then
        raise exception 'Nội dung, người làm, KPI và hạn do người giao việc quyết định. Bạn gửi phản hồi hoặc xin gia hạn';
      end if;
    end if;
  end if;

  if new.assignee_id is not null and new.assignee_id <> me
     and (tg_op = 'INSERT' or new.assignee_id is distinct from old.assignee_id) then
    if new.parent_id is not null then
      if not public.task_in_team(p.id, new.assignee_id) then
        raise exception 'Người làm hạng mục phải nằm trong nhóm làm việc chính';
      end if;
    else
      select role into a_role from public.profiles where id = new.assignee_id;
      if public.role_rank(a_role) >= public.role_rank(my_role) then
        raise exception 'Chỉ được giao việc cho cấp dưới';
      end if;
    end if;
  end if;
  return new;
end $$;

-- ============ C. Thông báo khi giao hạng mục, khi hạng mục xong / vướng ============
create or replace function public.tg_tasks_notify() returns trigger
language plpgsql security definer set search_path = public as $$
declare actor uuid := auth.uid(); p public.tasks;
begin
  if new.parent_id is not null then
    select * into p from public.tasks where id = new.parent_id;
    if new.assignee_id is not null and new.assignee_id is distinct from actor
       and new.assignee_id is distinct from p.assignee_id
       and (tg_op = 'INSERT' or new.assignee_id is distinct from old.assignee_id) then
      perform public.notify(new.assignee_id, 'giao_viec', 'Bạn được giao hạng mục',
        new.title || ' · ' || p.title || coalesce(' — hạn ' || to_char(new.due_date, 'DD/MM'), ''), 'task', new.id);
    end if;
    if tg_op = 'UPDATE' and new.status is distinct from old.status and new.status in ('xong', 'vuong')
       and new.created_by is distinct from actor
       and (actor = new.assignee_id or exists (select 1 from public.task_assignees a where a.task_id = new.id and a.user_id = actor)) then
      perform public.notify(new.created_by, 'cap_nhat_viec',
        case new.status when 'xong' then 'Hạng mục đã xong' else 'Hạng mục đang vướng' end,
        new.title || ' · ' || p.title, 'task', new.id);
    end if;
    return null;
  end if;
  if new.assignee_id is not null and new.assignee_id is distinct from new.created_by
     and (tg_op = 'INSERT' or new.assignee_id is distinct from old.assignee_id) then
    perform public.notify(new.assignee_id, 'giao_viec', case when tg_op = 'UPDATE' then 'Bạn được giao phụ trách chính' else 'Bạn được giao việc mới' end,
      new.title || coalesce(' — hạn ' || to_char(new.due_date, 'DD/MM'), ''), 'task', new.id);
  end if;
  if tg_op = 'UPDATE' and new.status is distinct from old.status and new.created_by <> actor
     and (actor = new.assignee_id or exists (select 1 from public.task_assignees a where a.task_id = new.id and a.user_id = actor)) then
    perform public.notify(new.created_by, 'cap_nhat_viec',
      case new.status when 'xong' then 'Việc đã hoàn thành' when 'vuong' then 'Việc đang vướng'
                      else 'Việc được cập nhật trạng thái' end,
      new.title, 'task', new.id);
  end if;
  return null;
end $$;

-- ============ D. Phản hồi: báo người giao, người chính, người phụ của việc và của hạng mục ============
create or replace function public.tg_task_updates_after() returns trigger
language plpgsql security definer set search_path = public as $$
declare s public.tasks; t public.tasks; u uuid; head text; body text; skip uuid;
begin
  if current_setting('app.silent_task_log', true) = '1' then return null; end if;
  select * into s from public.tasks where id = new.task_id;
  t := s;
  if s.parent_id is not null then select * into t from public.tasks where id = s.parent_id; end if;
  head := case when new.deadline_request_id is not null then 'Báo vướng, xin gia hạn: '
               when new.issue is not null then 'Báo vướng: '
               else 'Cập nhật tiến độ: ' end
       || case when s.parent_id is not null then s.title || ' · ' else '' end || t.title;
  body := coalesce('Đạt ' || new.progress || '%. ', '') || coalesce('Vấn đề: ' || new.issue || '. ', '') || new.note;
  -- Người giao đã nhận thông báo "Xin gia hạn" riêng
  if new.deadline_request_id is not null then skip := s.created_by; end if;
  for u in select distinct x from (
      select t.created_by x union all select t.assignee_id
      union all select a.user_id from public.task_assignees a where a.task_id = t.id
      union all select s.created_by union all select s.assignee_id
      union all select a.user_id from public.task_assignees a where a.task_id = s.id) q
    where x is not null and x <> new.author_id and x is distinct from skip loop
    perform public.notify(u, 'cap_nhat_viec', left(head, 160), left(body, 200), 'task', s.id);
  end loop;
  if new.status_after is not null then
    update public.tasks set status = new.status_after where id = new.task_id;
  end if;
  return null;
end $$;

-- ============ E. Đặt người chính + người phụ cho hạng mục ============
create or replace function public.task_step_set_people(p_step uuid, p_main uuid, p_others uuid[]) returns void
language plpgsql security definer set search_path = public as $$
declare
  s public.tasks; p public.tasks; me uuid := auth.uid(); my_role public.user_role := public.app_role();
  u uuid; want uuid[];
begin
  if my_role is null then raise exception 'Cần đăng nhập'; end if;
  select * into s from public.tasks where id = p_step for update;
  if not found or s.parent_id is null then raise exception 'Không tìm thấy hạng mục'; end if;
  select * into p from public.tasks where id = s.parent_id;
  if not (public.is_manager() or s.created_by = me or p.created_by = me
          or (my_role = 'giam_sat' and p.building_id is not null and public.can_access_building(p.building_id))) then
    raise exception 'Chỉ người giao hạng mục đổi được người làm';
  end if;
  if p_main is null then raise exception 'Chọn người chính của hạng mục'; end if;
  if not public.task_in_team(p.id, p_main) then raise exception 'Người chính phải nằm trong nhóm làm việc chính'; end if;
  select coalesce(array_agg(distinct x), '{}') into want from unnest(coalesce(p_others, '{}')) x
    where x is not null and x <> p_main;
  foreach u in array want loop
    if not public.task_in_team(p.id, u) then raise exception 'Người phụ phải nằm trong nhóm làm việc chính'; end if;
  end loop;

  if s.assignee_id is distinct from p_main then
    update public.tasks set assignee_id = p_main where id = p_step;   -- guard + notify chạy
  end if;
  foreach u in array want loop
    if exists (select 1 from public.task_assignees a where a.task_id = p_step and a.user_id = u) then continue; end if;
    insert into public.task_assignees (task_id, user_id, added_by) values (p_step, u, me);
    if u <> me then
      perform public.notify(u, 'giao_viec', 'Bạn được giao hỗ trợ hạng mục',
        s.title || ' · ' || p.title || coalesce(' — hạn ' || to_char(s.due_date, 'DD/MM'), ''), 'task', s.id);
    end if;
  end loop;
  delete from public.task_assignees a where a.task_id = p_step and not (a.user_id = any (want));
end $$;
revoke execute on function public.task_step_set_people(uuid, uuid, uuid[]) from public, anon;
grant execute on function public.task_step_set_people(uuid, uuid, uuid[]) to authenticated;

-- Nhóm việc chính đổi: người rời nhóm thì rời hạng mục; hạng mục mất người chính thì về người chính của việc
create or replace function public.task_steps_sync_team(p_parent uuid) returns void
language plpgsql security definer set search_path = public as $$
declare p public.tasks;
begin
  select * into p from public.tasks where id = p_parent;
  if not found or p.parent_id is not null then return; end if;
  delete from public.task_assignees a using public.tasks s
   where s.parent_id = p_parent and a.task_id = s.id
     and (not public.task_in_team(p_parent, a.user_id) or a.user_id = s.assignee_id);
  perform set_config('app.silent_task_log', '1', true);
  update public.tasks s set assignee_id = p.assignee_id
   where s.parent_id = p_parent and s.status <> 'xong' and p.assignee_id is not null
     and (s.assignee_id is null or not public.task_in_team(p_parent, s.assignee_id));
  perform set_config('app.silent_task_log', '', true);
end $$;
revoke execute on function public.task_steps_sync_team(uuid) from public, anon, authenticated;

do $$
declare d text := pg_get_functiondef('public.task_set_members(uuid, uuid[])'::regprocedure);
        a text := 'delete from public.task_assignees a where a.task_id = p_task and not (a.user_id = any (want));';
begin
  if position(a in d) = 0 then raise exception '110: không thấy đoạn cần vá trong task_set_members'; end if;
  d := replace(d, a, a || E'\n  perform public.task_steps_sync_team(p_task);');
  execute d;
end $$;

do $$
declare d text := pg_get_functiondef('public.task_change_main(uuid, uuid, boolean, text)'::regprocedure);
        a text := '  msg := ''Đổi người phụ trách chính: ''';
begin
  if position(a in d) = 0 then raise exception '110: không thấy đoạn cần vá trong task_change_main'; end if;
  d := replace(d, a, '  perform public.task_steps_sync_team(p_task);' || E'\n' || a);
  execute d;
end $$;

-- ============ F. Xin gia hạn: thêm nguyên nhân, áp dụng cho hạng mục ============
drop function if exists public.deadline_request_create(text, uuid, date, text, text);
create or replace function public.deadline_request_create(p_target text, p_id uuid, p_new_due date, p_report text, p_plan text, p_cause text default null)
returns uuid language plpgsql security definer set search_path = public as $$
declare
  me uuid := auth.uid(); who text; rid uuid; old date; ttl text;
  t public.tasks; pt public.tasks; it public.project_items; pj public.projects; u uuid;
  today date := (now() at time zone 'Asia/Ho_Chi_Minh')::date;
  cau text := nullif(btrim(p_cause), '');
begin
  if me is null or public.app_role() is null then raise exception 'Cần đăng nhập'; end if;
  if coalesce(btrim(p_report), '') = '' then raise exception 'Cần nêu vấn đề, vướng mắc'; end if;
  if coalesce(btrim(p_plan), '') = '' then raise exception 'Cần đề xuất giải pháp'; end if;
  if p_new_due is null or p_new_due < today then raise exception 'Hạn mới phải từ hôm nay trở đi'; end if;
  select full_name into who from public.profiles where id = me;

  if p_target = 'task' then
    select * into t from public.tasks where id = p_id;
    if not found then raise exception 'Không tìm thấy công việc'; end if;
    if cau is null then raise exception 'Cần nêu nguyên nhân'; end if;
    if t.status = 'xong' then raise exception 'Việc đã xong, không cần gia hạn'; end if;
    if not (t.assignee_id = me or exists (select 1 from public.task_assignees a where a.task_id = t.id and a.user_id = me)) then
      raise exception '%', case when t.parent_id is null then 'Chỉ người được giao việc mới xin gia hạn'
                                else 'Chỉ người chính hoặc người phụ của hạng mục mới xin gia hạn' end;
    end if;
    if t.created_by = me then raise exception 'Bạn tự giao mục này: sửa hạn trực tiếp'; end if;
    old := t.due_date; ttl := t.title;
    if t.parent_id is not null then
      select * into pt from public.tasks where id = t.parent_id;
      ttl := t.title || ' · ' || pt.title;
    end if;
    if old is not null and p_new_due <= old then raise exception 'Hạn mới phải sau hạn hiện tại %', to_char(old, 'DD/MM/YYYY'); end if;
    insert into public.deadline_requests(target, task_id, requested_by, old_due, new_due, report, plan, cause)
    values ('task', t.id, me, old, p_new_due, btrim(p_report), btrim(p_plan), cau) returning id into rid;
    if t.created_by is not null then
      perform public.notify(t.created_by, 'cap_nhat_viec', 'Xin gia hạn: ' || ttl,
        coalesce(who, 'Nhân viên') || ' đề xuất hạn mới ' || to_char(p_new_due, 'DD/MM') || coalesce(' (hạn cũ ' || to_char(old, 'DD/MM') || ')', '')
          || '. Nguyên nhân: ' || left(cau, 100) || '. Giải pháp: ' || left(btrim(p_plan), 100),
        'task', t.id, 'gia-han-' || rid);
    end if;

  elsif p_target = 'item' then
    select * into it from public.project_items where id = p_id;
    if not found then raise exception 'Không tìm thấy hạng mục'; end if;
    select * into pj from public.projects where id = it.project_id;
    if pj.status in ('hoan_thanh', 'huy') then raise exception 'Dự án đã đóng'; end if;
    if it.progress >= 100 then raise exception 'Hạng mục đã hoàn thành, không cần gia hạn'; end if;
    if not public.project_item_can_progress(it.id) then raise exception 'Chỉ PIC hoặc người hỗ trợ hạng mục mới xin gia hạn'; end if;
    if public.project_can_edit(it.project_id) then raise exception 'Bạn quản lý dự án này: sửa hạn hạng mục trực tiếp'; end if;
    old := it.end_date; ttl := it.name || ' · ' || pj.name;
    if p_new_due <= old then raise exception 'Hạn mới phải sau hạn hiện tại %', to_char(old, 'DD/MM/YYYY'); end if;
    insert into public.deadline_requests(target, project_id, item_id, requested_by, old_due, new_due, report, plan, cause)
    values ('item', pj.id, it.id, me, old, p_new_due, btrim(p_report), btrim(p_plan), cau) returning id into rid;
    for u in select distinct x from (select pj.pic_id x union all select pj.created_by) s where x is not null and x <> me loop
      perform public.notify(u, 'cap_nhat_viec', 'Xin gia hạn hạng mục: ' || it.name,
        coalesce(who, 'Nhân viên') || ' đề xuất hạn mới ' || to_char(p_new_due, 'DD/MM') || ' (hạn cũ ' || to_char(old, 'DD/MM') || ') · ' || pj.name,
        'project', pj.id, 'gia-han-' || rid || '-' || u);
    end loop;

  elsif p_target = 'project' then
    select * into pj from public.projects where id = p_id;
    if not found then raise exception 'Không tìm thấy dự án'; end if;
    if pj.status in ('hoan_thanh', 'huy') then raise exception 'Dự án đã đóng'; end if;
    if pj.pic_id is distinct from me then raise exception 'Chỉ PIC dự án mới xin gia hạn dự án'; end if;
    if pj.created_by = me or public.is_manager() then raise exception 'Bạn được sửa hạn dự án trực tiếp ở nút Sửa dự án'; end if;
    old := pj.end_date; ttl := pj.name;
    if p_new_due <= old then raise exception 'Hạn mới phải sau hạn hiện tại %', to_char(old, 'DD/MM/YYYY'); end if;
    insert into public.deadline_requests(target, project_id, requested_by, old_due, new_due, report, plan, cause)
    values ('project', pj.id, me, old, p_new_due, btrim(p_report), btrim(p_plan), cau) returning id into rid;
    if pj.created_by is not null then
      perform public.notify(pj.created_by, 'cap_nhat_viec', 'Xin gia hạn dự án: ' || pj.name,
        coalesce(who, 'PIC') || ' đề xuất kết thúc ' || to_char(p_new_due, 'DD/MM/YYYY') || ' (hạn cũ ' || to_char(old, 'DD/MM/YYYY') || ')',
        'project', pj.id, 'gia-han-' || rid);
    end if;
  else
    raise exception 'Loại đề xuất không hợp lệ';
  end if;
  return rid;
exception when unique_violation then
  raise exception 'Đã có đề xuất gia hạn đang chờ duyệt cho mục này';
end $$;

-- Ai duyệt: người giao (của việc hoặc hạng mục), người giao việc chính, Quản lý
create or replace function public.deadline_can_decide(p_id uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select public.app_role() is not null and exists (
    select 1 from public.deadline_requests r
     where r.id = p_id and r.requested_by is distinct from auth.uid() and (
       public.is_manager()
       or (r.target = 'task' and exists (
             select 1 from public.tasks t left join public.tasks p on p.id = t.parent_id
              where t.id = r.task_id and (t.created_by = auth.uid() or p.created_by = auth.uid())))
       or (r.target = 'item' and public.project_can_edit(r.project_id))
       or (r.target = 'project' and exists (select 1 from public.projects p where p.id = r.project_id and p.created_by = auth.uid()))))
$$;

create or replace function public.deadline_request_decide(p_id uuid, p_approve boolean, p_due date default null, p_note text default null)
returns void language plpgsql security definer set search_path = public as $$
declare
  me uuid := auth.uid(); r public.deadline_requests; d date; who text; msg text; nm text; pj public.projects;
  tk public.tasks; pt public.tasks;
  today date := (now() at time zone 'Asia/Ho_Chi_Minh')::date;
begin
  select * into r from public.deadline_requests where id = p_id for update;
  if not found then raise exception 'Không tìm thấy đề xuất'; end if;
  if r.status <> 'cho_duyet' then raise exception 'Đề xuất này đã được xử lý'; end if;
  if not public.deadline_can_decide(p_id) then raise exception 'Bạn không có quyền duyệt đề xuất này'; end if;
  if not p_approve and coalesce(btrim(p_note), '') = '' then raise exception 'Ghi lý do không duyệt để người đề xuất biết'; end if;
  d := coalesce(p_due, r.new_due);
  if p_approve and d < today then raise exception 'Hạn duyệt phải từ hôm nay trở đi'; end if;
  select full_name into who from public.profiles where id = me;

  update public.deadline_requests set status = case when p_approve then 'da_duyet' else 'tu_choi' end,
    approved_due = case when p_approve then d end, decided_by = me, decided_at = now(), decision_note = nullif(btrim(p_note), '')
   where id = p_id;

  msg := case when p_approve then 'Đã duyệt gia hạn đến ' || to_char(d, 'DD/MM/YYYY') || coalesce(' (hạn cũ ' || to_char(r.old_due, 'DD/MM/YYYY') || ')', '')
              else 'Không duyệt gia hạn đến ' || to_char(r.new_due, 'DD/MM/YYYY') end
         || coalesce('. ' || nullif(btrim(p_note), ''), '');

  if r.target = 'task' then
    select * into tk from public.tasks where id = r.task_id;
    if p_approve then
      if tk.parent_id is not null then
        select * into pt from public.tasks where id = tk.parent_id;
        if pt.due_date is not null and d > pt.due_date then
          if public.is_manager() or pt.created_by = me then
            update public.tasks set due_date = d where id = pt.id;
            msg := msg || '. Hạn việc chính lùi theo đến ' || to_char(d, 'DD/MM/YYYY');
          else
            raise exception 'Hạn mới % vượt hạn việc chính %. Xin người giao việc chính gia hạn trước',
              to_char(d, 'DD/MM/YYYY'), to_char(pt.due_date, 'DD/MM/YYYY');
          end if;
        end if;
      end if;
      update public.tasks set due_date = d where id = r.task_id;
    end if;
    -- Ghi vào dòng phản hồi: người làm và người phụ nhận thông báo
    insert into public.task_updates(task_id, author_id, note) values (r.task_id, me, msg);
  else
    select * into pj from public.projects where id = r.project_id;
    if r.target = 'item' then
      select name into nm from public.project_items where id = r.item_id;
      if p_approve then
        if d > pj.end_date then
          raise exception 'Hạn mới % vượt hạn dự án %. Gia hạn dự án trước', to_char(d, 'DD/MM/YYYY'), to_char(pj.end_date, 'DD/MM/YYYY');
        end if;
        update public.project_items set end_date = d where id = r.item_id;
        with recursive up as (
          select i.parent_id from public.project_items i where i.id = r.item_id
          union all
          select p.parent_id from public.project_items p join up on p.id = up.parent_id where up.parent_id is not null)
        update public.project_items x set end_date = d from up where x.id = up.parent_id and x.end_date < d;
      end if;
    else
      nm := pj.name;
      if p_approve then update public.projects set end_date = d where id = r.project_id; end if;
    end if;
    insert into public.project_logs(project_id, item_id, note, by_id)
    values (r.project_id, r.item_id, msg || ' · đề xuất: ' || left(r.plan, 300), me);
    perform public.notify(r.requested_by, 'cap_nhat_viec',
      case when p_approve then 'Đã duyệt gia hạn: ' else 'Không duyệt gia hạn: ' end || nm,
      msg, 'project', r.project_id, 'gia-han-kq-' || r.id);
  end if;
end $$;

-- Đề xuất của 1 việc (gồm các hạng mục của nó) hoặc 1 dự án
create or replace function public.deadline_requests_of(p_task uuid default null, p_project uuid default null)
returns jsonb language sql stable security definer set search_path = public as $$
  select coalesce(jsonb_agg(jsonb_build_object(
      'id', r.id, 'target', r.target, 'item_id', coalesce(r.item_id, case when st.parent_id is not null then st.id end),
      'item_name', coalesce(i.name, case when st.parent_id is not null then st.title end),
      'requested_by', r.requested_by, 'requester', rp.full_name, 'old_due', r.old_due, 'new_due', r.new_due,
      'report', r.report, 'cause', r.cause, 'plan', r.plan, 'status', r.status, 'approved_due', r.approved_due,
      'decider', dp.full_name, 'decided_at', r.decided_at, 'decision_note', r.decision_note, 'created_at', r.created_at,
      'can_decide', r.status = 'cho_duyet' and public.deadline_can_decide(r.id),
      'can_cancel', r.status = 'cho_duyet' and r.requested_by = auth.uid())
    order by (r.status = 'cho_duyet') desc, r.created_at desc), '[]'::jsonb)
  from public.deadline_requests r
  left join public.project_items i on i.id = r.item_id
  left join public.tasks st on st.id = r.task_id
  left join public.profiles rp on rp.id = r.requested_by
  left join public.profiles dp on dp.id = r.decided_by
  where (p_task is not null and public.can_see_task(p_task)
         and (r.task_id = p_task or (st.parent_id = p_task and public.can_see_task(st.id))))
     or (p_project is not null and r.project_id = p_project and public.project_can_see(p_project))
$$;

-- ============ G. Phản hồi tiến độ ============
create or replace function public.task_feedback(
  p_task uuid, p_note text, p_progress int default null, p_actual numeric default null,
  p_issue text default null, p_cause text default null, p_solution text default null,
  p_status public.task_status default null, p_new_due date default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  me uuid := auth.uid(); t public.tasks; prog int := p_progress; rid uuid; uid uuid;
  iss text := nullif(btrim(p_issue), ''); cau text := nullif(btrim(p_cause), ''); sol text := nullif(btrim(p_solution), '');
begin
  if me is null or public.app_role() is null then raise exception 'Cần đăng nhập'; end if;
  select * into t from public.tasks where id = p_task for update;
  if not found or not public.can_see_task(p_task) then raise exception 'Không tìm thấy việc'; end if;
  if coalesce(btrim(p_note), '') = '' then raise exception 'Ghi kết quả đã làm được'; end if;
  if char_length(p_note) > 2000 then raise exception 'Kết quả tối đa 2000 ký tự'; end if;
  if (iss is not null or cau is not null or sol is not null) and (iss is null or cau is null or sol is null) then
    raise exception 'Báo vướng cần ghi đủ vấn đề, nguyên nhân và giải pháp';
  end if;
  if p_new_due is not null and iss is null then raise exception 'Xin gia hạn cần nêu vấn đề, nguyên nhân và giải pháp'; end if;
  if prog is not null and (prog < 0 or prog > 100) then raise exception 'Tiến độ từ 0 đến 100%%'; end if;
  if p_actual is not null and p_actual < 0 then raise exception 'Kết quả đạt không được âm'; end if;
  if prog is null and p_actual is not null and t.kpi_target is not null then
    prog := least(100, greatest(0, round(p_actual / t.kpi_target * 100)));
  end if;
  if p_status = 'xong' then prog := 100; end if;

  if p_new_due is not null then
    rid := public.deadline_request_create('task', p_task, p_new_due, iss, sol, cau);
  end if;
  insert into public.task_updates(task_id, author_id, note, status_after, progress, kpi_actual, issue, cause, solution, deadline_request_id)
  values (p_task, me, btrim(p_note), p_status, prog, p_actual, iss, cau, sol, rid) returning id into uid;
  if prog is not null or p_actual is not null then
    update public.tasks set progress = coalesce(prog, progress), kpi_actual = coalesce(p_actual, kpi_actual) where id = p_task;
  end if;
  return jsonb_build_object('update_id', uid, 'request_id', rid);
end $$;

do $$ declare f text; begin
  foreach f in array array['deadline_request_create(text,uuid,date,text,text,text)',
    'task_feedback(uuid,text,integer,numeric,text,text,text,public.task_status,date)'] loop
    execute format('revoke execute on function public.%s from public, anon', f);
    execute format('grant execute on function public.%s to authenticated', f);
  end loop;
end $$;
