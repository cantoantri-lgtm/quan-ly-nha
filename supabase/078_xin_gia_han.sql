-- 078: Xin gia hạn (deadline) cho công việc, hạng mục dự án và dự án.
-- Người được giao báo cáo vướng mắc + phương án xử lý + hạn mới → người giao duyệt → hạn tự cập nhật.
--   Công việc: người làm / người cùng làm xin, người giao việc (hoặc Quản lý) duyệt.
--   Hạng mục dự án: PIC / người hỗ trợ hạng mục xin, người quản lý dự án (PIC dự án, người tạo, Quản lý) duyệt.
--   Dự án: PIC dự án xin, người giao dự án (người tạo) hoặc Quản lý duyệt. PIC không tự đổi hạn dự án nữa.

create table if not exists public.deadline_requests (
  id            uuid primary key default gen_random_uuid(),
  target        text not null check (target in ('task', 'item', 'project')),
  task_id       uuid references public.tasks(id) on delete cascade,
  project_id    uuid references public.projects(id) on delete cascade,
  item_id       uuid references public.project_items(id) on delete cascade,
  requested_by  uuid not null references public.profiles(id) on delete cascade,
  old_due       date,
  new_due       date not null,
  report        text not null check (char_length(btrim(report)) between 1 and 2000),
  plan          text not null check (char_length(btrim(plan)) between 1 and 2000),
  status        text not null default 'cho_duyet' check (status in ('cho_duyet', 'da_duyet', 'tu_choi', 'da_huy')),
  approved_due  date,
  decided_by    uuid references public.profiles(id) on delete set null,
  decided_at    timestamptz,
  decision_note text check (char_length(decision_note) <= 1000),
  created_at    timestamptz not null default now(),
  check ((target = 'task') = (task_id is not null)),
  check (target <> 'task' or (project_id is null and item_id is null)),
  check (target <> 'item' or (project_id is not null and item_id is not null)),
  check (target <> 'project' or (project_id is not null and item_id is null))
);
create unique index if not exists deadline_requests_one_pending on public.deadline_requests
  ((case target when 'task' then task_id when 'item' then item_id else project_id end)) where status = 'cho_duyet';
create index if not exists deadline_requests_task on public.deadline_requests(task_id) where task_id is not null;
create index if not exists deadline_requests_project on public.deadline_requests(project_id) where project_id is not null;

alter table public.deadline_requests enable row level security;
revoke all on public.deadline_requests from anon, authenticated;
grant select on public.deadline_requests to authenticated;
drop policy if exists dr_select on public.deadline_requests;
create policy dr_select on public.deadline_requests for select to authenticated
  using (case when task_id is not null then public.can_see_task(task_id) else public.project_can_see(project_id) end);

-- Ai duyệt được đề xuất này
create or replace function public.deadline_can_decide(p_id uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select public.app_role() is not null and exists (
    select 1 from public.deadline_requests r
     where r.id = p_id and r.requested_by is distinct from auth.uid() and (
       public.is_manager()
       or (r.target = 'task' and exists (select 1 from public.tasks t where t.id = r.task_id and t.created_by = auth.uid()))
       or (r.target = 'item' and public.project_can_edit(r.project_id))
       or (r.target = 'project' and exists (select 1 from public.projects p where p.id = r.project_id and p.created_by = auth.uid()))))
$$;

create or replace function public.deadline_request_create(p_target text, p_id uuid, p_new_due date, p_report text, p_plan text)
returns uuid language plpgsql security definer set search_path = public as $$
declare
  me uuid := auth.uid(); who text; rid uuid; old date; ttl text;
  t public.tasks; it public.project_items; pj public.projects; u uuid;
  today date := (now() at time zone 'Asia/Ho_Chi_Minh')::date;
begin
  if me is null or public.app_role() is null then raise exception 'Cần đăng nhập'; end if;
  if coalesce(btrim(p_report), '') = '' then raise exception 'Cần báo cáo tình hình, vướng mắc'; end if;
  if coalesce(btrim(p_plan), '') = '' then raise exception 'Cần đề xuất phương án xử lý'; end if;
  if p_new_due is null or p_new_due < today then raise exception 'Hạn mới phải từ hôm nay trở đi'; end if;
  select full_name into who from public.profiles where id = me;

  if p_target = 'task' then
    select * into t from public.tasks where id = p_id;
    if not found or t.parent_id is not null then raise exception 'Không tìm thấy công việc'; end if;
    if t.status = 'xong' then raise exception 'Việc đã xong, không cần gia hạn'; end if;
    if not (t.assignee_id = me or exists (select 1 from public.task_assignees a where a.task_id = t.id and a.user_id = me)) then
      raise exception 'Chỉ người được giao việc mới xin gia hạn';
    end if;
    if t.created_by = me then raise exception 'Việc bạn tự giao: sửa hạn trực tiếp ở nút Sửa'; end if;
    old := t.due_date; ttl := t.title;
    if old is not null and p_new_due <= old then raise exception 'Hạn mới phải sau hạn hiện tại %', to_char(old, 'DD/MM/YYYY'); end if;
    insert into public.deadline_requests(target, task_id, requested_by, old_due, new_due, report, plan)
    values ('task', t.id, me, old, p_new_due, btrim(p_report), btrim(p_plan)) returning id into rid;
    if t.created_by is not null then
      perform public.notify(t.created_by, 'cap_nhat_viec', 'Xin gia hạn: ' || ttl,
        coalesce(who, 'Nhân viên') || ' đề xuất hạn mới ' || to_char(p_new_due, 'DD/MM') || coalesce(' (hạn cũ ' || to_char(old, 'DD/MM') || ')', '') || '. ' || left(btrim(p_plan), 120),
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
    insert into public.deadline_requests(target, project_id, item_id, requested_by, old_due, new_due, report, plan)
    values ('item', pj.id, it.id, me, old, p_new_due, btrim(p_report), btrim(p_plan)) returning id into rid;
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
    insert into public.deadline_requests(target, project_id, requested_by, old_due, new_due, report, plan)
    values ('project', pj.id, me, old, p_new_due, btrim(p_report), btrim(p_plan)) returning id into rid;
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

create or replace function public.deadline_request_decide(p_id uuid, p_approve boolean, p_due date default null, p_note text default null)
returns void language plpgsql security definer set search_path = public as $$
declare
  me uuid := auth.uid(); r public.deadline_requests; d date; who text; msg text; nm text; pj public.projects;
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
    if p_approve then update public.tasks set due_date = d where id = r.task_id; end if;
    -- Ghi vào dòng cập nhật tiến độ: người làm và người cùng làm nhận thông báo
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
        -- Hạng mục cha phải bao trùm hạng mục con
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

create or replace function public.deadline_request_cancel(p_id uuid) returns void
language plpgsql security definer set search_path = public as $$
begin
  update public.deadline_requests set status = 'da_huy', decided_at = now()
   where id = p_id and requested_by = auth.uid() and status = 'cho_duyet';
  if not found then raise exception 'Chỉ người đề xuất rút được đề xuất đang chờ duyệt'; end if;
end $$;

-- Danh sách đề xuất của 1 việc hoặc 1 dự án (gồm hạng mục), kèm tên và quyền thao tác
create or replace function public.deadline_requests_of(p_task uuid default null, p_project uuid default null)
returns jsonb language sql stable security definer set search_path = public as $$
  select coalesce(jsonb_agg(jsonb_build_object(
      'id', r.id, 'target', r.target, 'item_id', r.item_id, 'item_name', i.name,
      'requested_by', r.requested_by, 'requester', rp.full_name, 'old_due', r.old_due, 'new_due', r.new_due,
      'report', r.report, 'plan', r.plan, 'status', r.status, 'approved_due', r.approved_due,
      'decider', dp.full_name, 'decided_at', r.decided_at, 'decision_note', r.decision_note, 'created_at', r.created_at,
      'can_decide', r.status = 'cho_duyet' and public.deadline_can_decide(r.id),
      'can_cancel', r.status = 'cho_duyet' and r.requested_by = auth.uid())
    order by (r.status = 'cho_duyet') desc, r.created_at desc), '[]'::jsonb)
  from public.deadline_requests r
  left join public.project_items i on i.id = r.item_id
  left join public.profiles rp on rp.id = r.requested_by
  left join public.profiles dp on dp.id = r.decided_by
  where (p_task is not null and r.task_id = p_task and public.can_see_task(p_task))
     or (p_project is not null and r.project_id = p_project and public.project_can_see(p_project))
$$;

do $$ declare f text; begin
  foreach f in array array['deadline_can_decide(uuid)', 'deadline_request_create(text,uuid,date,text,text)',
    'deadline_request_decide(uuid,boolean,date,text)', 'deadline_request_cancel(uuid)', 'deadline_requests_of(uuid,uuid)'] loop
    execute format('revoke execute on function public.%s from public, anon', f);
    execute format('grant execute on function public.%s to authenticated', f);
  end loop;
end $$;

-- PIC dự án không tự đổi hạn kết thúc dự án: phải xin gia hạn, người giao dự án hoặc Quản lý duyệt
do $$
declare d text;
begin
  d := pg_get_functiondef('public.tg_projects_guard()'::regprocedure);
  if position('new.id := old.id; new.code := old.code;' in d) = 0 then raise exception 'tg_projects_guard đã khác bản 069'; end if;
  d := replace(d, 'new.id := old.id; new.code := old.code;',
    'if new.end_date is distinct from old.end_date and auth.uid() is not null and not (public.is_manager() or old.created_by = auth.uid()) then
      raise exception ''Đổi hạn dự án: PIC gửi đề xuất gia hạn, người giao dự án duyệt'';
    end if;
    new.id := old.id; new.code := old.code;');
  execute d;
end $$;
