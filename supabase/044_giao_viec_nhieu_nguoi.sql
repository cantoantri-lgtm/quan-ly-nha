-- Giao một việc cho nhiều người.
--  * tasks.assignee_id giữ vai trò NGƯỜI PHỤ TRÁCH CHÍNH (như cũ).
--  * task_assignees: những người CÙNG LÀM. Họ xem, cập nhật trạng thái, tick bước, thêm bước, gửi cập nhật như người phụ trách.
--  * Thêm/bớt người cùng làm qua RPC task_set_members: chỉ người được sửa việc (Quản lý, người giao không phải Nhân viên,
--    Giám sát của toà) và chỉ giao cho cấp dưới, không giao cho Cộng tác viên / khách hàng.
--  * Thông báo: người mới được thêm nhận "Bạn được giao việc mới"; cập nhật tiến độ báo cho người giao + mọi người làm;
--    nhắc hạn / trễ hạn gửi cả người cùng làm.

create table public.task_assignees (
  task_id    uuid not null references public.tasks(id) on delete cascade,
  user_id    uuid not null references public.profiles(id) on delete cascade,
  added_by   uuid references public.profiles(id) on delete set null default auth.uid(),
  created_at timestamptz not null default now(),
  primary key (task_id, user_id)
);
create index on public.task_assignees(user_id);
create index on public.task_assignees(added_by);

create or replace function public.is_task_member(t uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.task_assignees a where a.task_id = t and a.user_id = auth.uid())
$$;

create or replace function public.can_see_task(t uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.tasks x
    left join public.tasks p on p.id = x.parent_id
    where x.id = t and public.app_role() is not null and (
         public.is_manager()
      or x.assignee_id = auth.uid() or x.created_by = auth.uid()
      or p.assignee_id = auth.uid() or p.created_by = auth.uid()
      or public.is_task_member(coalesce(x.parent_id, x.id))
      or (public.app_role() = 'giam_sat' and coalesce(x.building_id, p.building_id) is not null
          and public.can_access_building(coalesce(x.building_id, p.building_id)))))
$$;

alter table public.task_assignees enable row level security;
create policy task_assignees_select on public.task_assignees for select to authenticated using (public.can_see_task(task_id));
revoke all on public.task_assignees from anon, authenticated;
grant select on public.task_assignees to authenticated;

drop policy if exists tasks_select on public.tasks;
create policy tasks_select on public.tasks for select to authenticated
  using (public.can_see_task_row(parent_id, building_id, assignee_id, created_by)
         or (public.app_role() is not null and public.is_task_member(coalesce(parent_id, id))));
drop policy if exists tasks_update on public.tasks;
create policy tasks_update on public.tasks for update to authenticated
  using (public.can_see_task_row(parent_id, building_id, assignee_id, created_by)
         or (public.app_role() is not null and public.is_task_member(coalesce(parent_id, id))))
  with check (public.can_see_task_row(parent_id, building_id, assignee_id, created_by)
         or (public.app_role() is not null and public.is_task_member(coalesce(parent_id, id))));
drop policy if exists tasks_insert on public.tasks;
create policy tasks_insert on public.tasks for insert to authenticated
  with check ((created_by = (select auth.uid()))
    and (building_id is null or public.can_access_building(building_id))
    and (parent_id is null or public.can_see_task(parent_id))
    and (public.app_role() in ('quan_ly','giam_sat')
         or (parent_id is not null and assignee_id = (select auth.uid()))
         or (parent_id is not null and public.is_task_member(parent_id))));

-- Đặt danh sách người cùng làm (thay toàn bộ). Người phụ trách chính không nằm trong danh sách này.
create or replace function public.task_set_members(p_task uuid, p_users uuid[]) returns void
language plpgsql security definer set search_path = public as $$
declare
  t public.tasks; me uuid := auth.uid(); my_role public.user_role := public.app_role();
  u uuid; r public.user_role; act boolean; want uuid[];
begin
  if my_role is null then raise exception 'Cần đăng nhập'; end if;
  select * into t from public.tasks where id = p_task for update;
  if not found then raise exception 'Không tìm thấy việc'; end if;
  if t.parent_id is not null then raise exception 'Chỉ giao nhiều người cho việc chính, không cho từng bước'; end if;
  if not (public.is_manager()
          or (t.created_by = me and my_role <> 'nhan_vien')
          or (my_role = 'giam_sat' and t.building_id is not null and public.can_access_building(t.building_id))) then
    raise exception 'Bạn không được đổi người làm của việc này';
  end if;
  select coalesce(array_agg(distinct x), '{}') into want from unnest(coalesce(p_users, '{}')) x
    where x is not null and x is distinct from t.assignee_id;
  if array_length(want, 1) > 20 then raise exception 'Một việc giao tối đa 20 người cùng làm'; end if;
  foreach u in array want loop
    if exists (select 1 from public.task_assignees a where a.task_id = p_task and a.user_id = u) then continue; end if;
    select role, is_active into r, act from public.profiles where id = u;
    if not found or not act then raise exception 'Có người không tồn tại hoặc đã nghỉ'; end if;
    if r in ('cong_tac_vien','khach_hang') then raise exception 'Không giao việc cho Cộng tác viên hoặc khách hàng'; end if;
    if u <> me and public.role_rank(r) >= public.role_rank(my_role) then raise exception 'Chỉ được giao việc cho cấp dưới'; end if;
    insert into public.task_assignees (task_id, user_id, added_by) values (p_task, u, me);
    if u <> me then
      perform public.notify(u, 'giao_viec', 'Bạn được giao việc mới',
        t.title || coalesce(' — hạn ' || to_char(t.due_date, 'DD/MM'), '') || ' (làm cùng nhóm)', 'task', t.id);
    end if;
  end loop;
  delete from public.task_assignees a where a.task_id = p_task and not (a.user_id = any (want));
end $$;
revoke execute on function public.task_set_members(uuid, uuid[]) from public, anon;
grant execute on function public.task_set_members(uuid, uuid[]) to authenticated;
revoke execute on function public.is_task_member(uuid) from public, anon;
grant execute on function public.is_task_member(uuid) to authenticated;

-- Đổi người phụ trách chính sang một người đang cùng làm: bỏ người đó khỏi danh sách cùng làm
create or replace function public.tg_tasks_main_dedupe() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.assignee_id is not null then
    delete from public.task_assignees where task_id = new.id and user_id = new.assignee_id;
  end if;
  return null;
end $$;
drop trigger if exists tasks_main_dedupe on public.tasks;
create trigger tasks_main_dedupe after update of assignee_id on public.tasks
  for each row execute function public.tg_tasks_main_dedupe();

create or replace function public.tg_tasks_notify() returns trigger
language plpgsql security definer set search_path = public as $$
declare actor uuid := auth.uid();
begin
  if new.parent_id is not null then return null; end if;
  if new.assignee_id is not null and new.assignee_id is distinct from new.created_by
     and (tg_op = 'INSERT' or new.assignee_id is distinct from old.assignee_id) then
    perform public.notify(new.assignee_id, 'giao_viec', 'Bạn được giao việc mới',
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

-- Cập nhật tiến độ: báo cho người giao + người phụ trách + người cùng làm (trừ người viết)
create or replace function public.tg_task_updates_after() returns trigger
language plpgsql security definer set search_path = public as $$
declare t public.tasks; u uuid;
begin
  select * into t from public.tasks where id = new.task_id;
  if t.parent_id is not null then select * into t from public.tasks where id = t.parent_id; end if;
  for u in select distinct x from (
      select t.created_by x union all select t.assignee_id
      union all select a.user_id from public.task_assignees a where a.task_id = t.id) s
    where x is not null and x <> new.author_id loop
    perform public.notify(u, 'cap_nhat_viec', 'Cập nhật tiến độ: ' || t.title, left(new.note, 200), 'task', t.id);
  end loop;
  if new.status_after is not null then
    update public.tasks set status = new.status_after where id = new.task_id;
  end if;
  return null;
end $$;

create or replace function public.run_daily_reminders() returns void
language plpgsql security definer set search_path = public as $$
declare d date := (now() at time zone 'Asia/Ho_Chi_Minh')::date;
begin
  insert into public.notifications (user_id, type, title, body, entity_type, entity_id, dedupe_key)
  select u.uid, 'nhac_viec',
         case when t.due_date = d then 'Hạn hôm nay' else 'Hạn ngày mai' end,
         t.title, 'task', coalesce(t.parent_id, t.id), 'nhac:' || t.id || ':' || u.uid || ':' || d
  from public.tasks t
  cross join lateral (select t.assignee_id uid
                      union select a.user_id from public.task_assignees a where a.task_id = t.id) u
  where t.status <> 'xong' and u.uid is not null and t.due_date in (d, d + 1)
  on conflict (dedupe_key) do nothing;

  insert into public.notifications (user_id, type, title, body, entity_type, entity_id, dedupe_key)
  select distinct u.uid, 'tre_han'::public.notif_type, 'Việc trễ hạn ' || (d - t.due_date) || ' ngày', t.title,
         'task', t.id, 'tre:' || t.id || ':' || u.uid || ':' || d
  from public.tasks t
  cross join lateral (select t.assignee_id uid union select t.created_by
                      union select a.user_id from public.task_assignees a where a.task_id = t.id) u
  where t.status <> 'xong' and t.due_date < d and t.parent_id is null and u.uid is not null
  on conflict (dedupe_key) do nothing;

  insert into public.notifications (user_id, type, title, body, entity_type, entity_id, dedupe_key)
  select m.user_id, 'nhac_thu_tien', 'Nhắc thu tiền: ' || b.name,
         concat_ws(' · ',
           nullif(count(*) filter (where i.due_date between d and d + 3), 0) || ' phòng đến hạn trong 3 ngày',
           nullif(count(*) filter (where i.due_date < d), 0) || ' phòng quá hạn'),
         'building', b.id, 'thu:' || b.id || ':' || m.user_id || ':' || d
  from public.invoices i
  join public.buildings b on b.id = i.building_id
  join public.building_members m on m.building_id = b.id
  join public.profiles pr on pr.id = m.user_id and pr.role = 'giam_sat' and pr.is_active
  where i.status = 'chua_thu' and i.due_date <= d + 3
  group by m.user_id, b.id, b.name
  on conflict (dedupe_key) do nothing;

  insert into public.notifications (user_id, type, title, body, entity_type, entity_id, dedupe_key)
  select m.user_id, 'hop_dong_sap_het', 'Hợp đồng sắp hết hạn',
         'Phòng ' || r.code || ' — ' || b.name || ' — hết hạn ' || to_char(c.end_date, 'DD/MM/YYYY'),
         'contract', c.id, 'hd:' || c.id || ':' || m.user_id || ':' || d
  from public.contracts c
  join public.rooms r on r.id = c.room_id
  join public.buildings b on b.id = c.building_id
  join public.building_members m on m.building_id = c.building_id
  join public.profiles pr on pr.id = m.user_id and pr.role = 'giam_sat' and pr.is_active
  where c.status = 'hieu_luc' and c.end_date - d in (30, 7, 1)
  on conflict (dedupe_key) do nothing;
end $$;
