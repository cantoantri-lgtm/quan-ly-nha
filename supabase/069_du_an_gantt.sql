-- 069: Dự án (Gantt). Dự án → hạng mục chính (cấp 1) → tối đa 3 cấp con.
-- PIC + người hỗ trợ cho dự án và từng hạng mục. Ngân sách dự án và hạng mục chính.
-- Gắn LOA đã duyệt cho dự án. Chi phí thực tế = đề nghị tạm ứng + thanh toán gắn dự án
-- (DNTT đã trừ tạm ứng nên cộng cả hai không bị trùng).

-- ============ A. Bảng ============
create table if not exists public.projects (
  id          uuid primary key default gen_random_uuid(),
  code        text unique,
  name        text not null check (char_length(trim(name)) between 2 and 200),
  description text check (char_length(description) <= 4000),
  status      text not null default 'ke_hoach' check (status in ('ke_hoach','dang_thuc_hien','tam_dung','hoan_thanh','huy')),
  start_date  date not null,
  end_date    date not null,
  budget      bigint not null default 0 check (budget >= 0 and budget < 1000000000000000),
  loa_id      uuid references public.requests(id) on delete set null,
  pic_id      uuid not null references public.profiles(id),
  building_id uuid references public.buildings(id) on delete set null,
  created_by  uuid not null references public.profiles(id),
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  constraint projects_dates check (end_date >= start_date)
);

create table if not exists public.project_members (
  project_id uuid not null references public.projects(id) on delete cascade,
  user_id    uuid not null references public.profiles(id) on delete cascade,
  primary key (project_id, user_id)
);
create index if not exists project_members_user on public.project_members(user_id);

create table if not exists public.project_items (
  id          uuid primary key default gen_random_uuid(),
  project_id  uuid not null references public.projects(id) on delete cascade,
  parent_id   uuid references public.project_items(id) on delete cascade,
  level       int  not null default 1 check (level between 1 and 4),
  sort        int  not null default 0,
  name        text not null check (char_length(trim(name)) between 1 and 300),
  start_date  date not null,
  end_date    date not null,
  pic_id      uuid references public.profiles(id) on delete set null,
  budget      bigint check (budget is null or (budget >= 0 and budget < 1000000000000000)),
  progress    int  not null default 0 check (progress between 0 and 100),
  status      text not null default 'chua_bat_dau' check (status in ('chua_bat_dau','dang_lam','hoan_thanh','tam_dung')),
  note        text check (char_length(note) <= 1000),
  updated_at  timestamptz not null default now(),
  updated_by  uuid references public.profiles(id) on delete set null,
  constraint project_items_dates check (end_date >= start_date)
);
create index if not exists project_items_project on public.project_items(project_id, sort);
create index if not exists project_items_parent on public.project_items(parent_id);
create index if not exists project_items_pic on public.project_items(pic_id);

create table if not exists public.project_item_members (
  item_id uuid not null references public.project_items(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  primary key (item_id, user_id)
);
create index if not exists project_item_members_user on public.project_item_members(user_id);

create table if not exists public.project_logs (
  id         uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects(id) on delete cascade,
  item_id    uuid references public.project_items(id) on delete cascade,
  progress   int,
  status     text,
  note       text,
  by_id      uuid references public.profiles(id) on delete set null,
  at         timestamptz not null default now()
);
create index if not exists project_logs_project on public.project_logs(project_id, at desc);

alter table public.requests add column if not exists project_id uuid references public.projects(id) on delete set null;
alter table public.requests add column if not exists project_item_id uuid references public.project_items(id) on delete set null;
create index if not exists requests_project on public.requests(project_id) where project_id is not null;

-- ============ B. Hàm quyền ============
create or replace function public.project_can_edit(p_project uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select public.app_role() is not null and exists (
    select 1 from public.projects p where p.id = p_project
       and (public.is_manager() or p.created_by = auth.uid() or p.pic_id = auth.uid()))
$$;

create or replace function public.project_can_see(p_project uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select public.app_role() is not null and (
       public.project_can_edit(p_project)
    or public.is_duty('ke_toan')
    or exists (select 1 from public.project_members m where m.project_id = p_project and m.user_id = auth.uid())
    or exists (select 1 from public.project_items i where i.project_id = p_project and i.pic_id = auth.uid())
    or exists (select 1 from public.project_item_members im join public.project_items i on i.id = im.item_id
                where i.project_id = p_project and im.user_id = auth.uid()))
$$;

-- PIC / người hỗ trợ của hạng mục (hoặc hạng mục cha) được cập nhật tiến độ
create or replace function public.project_item_can_progress(p_item uuid) returns boolean
language sql stable security definer set search_path = public as $$
  with recursive up as (
    select i.id, i.parent_id, i.project_id from public.project_items i where i.id = p_item
    union all
    select p.id, p.parent_id, p.project_id from public.project_items p join up on p.id = up.parent_id
  )
  select public.app_role() is not null and (
       public.project_can_edit((select project_id from up limit 1))
    or exists (select 1 from public.project_items i join up on up.id = i.id where i.pic_id = auth.uid())
    or exists (select 1 from public.project_item_members m join up on up.id = m.item_id where m.user_id = auth.uid()))
$$;

revoke execute on function public.project_can_edit(uuid) from public, anon;
revoke execute on function public.project_can_see(uuid) from public, anon;
revoke execute on function public.project_item_can_progress(uuid) from public, anon;
grant execute on function public.project_can_edit(uuid), public.project_can_see(uuid), public.project_item_can_progress(uuid) to authenticated;

-- ============ C. Kiểm tra dữ liệu ============
create or replace function public.tg_projects_guard() returns trigger
language plpgsql security definer set search_path = public as $$
declare y text := to_char((now() at time zone 'Asia/Ho_Chi_Minh'), 'YYYY'); n int;
begin
  if tg_op = 'INSERT' then
    if auth.uid() is not null then new.created_by := auth.uid(); end if;
    select count(*) + 1 into n from public.projects where code like 'DA-' || y || '-%';
    new.code := 'DA-' || y || '-' || lpad(n::text, 3, '0');
    while exists (select 1 from public.projects where code = new.code) loop
      n := n + 1; new.code := 'DA-' || y || '-' || lpad(n::text, 3, '0');
    end loop;
  else
    new.id := old.id; new.code := old.code; new.created_by := old.created_by; new.created_at := old.created_at;
  end if;
  new.name := trim(new.name);
  new.updated_at := now();
  if not exists (select 1 from public.profiles p where p.id = new.pic_id and p.is_active and p.role in ('quan_ly','giam_sat','nhan_vien')) then
    raise exception 'Người phụ trách (PIC) phải là nhân sự đang làm việc';
  end if;
  if new.loa_id is not null and (tg_op = 'INSERT' or new.loa_id is distinct from old.loa_id) then
    if not exists (select 1 from public.requests r where r.id = new.loa_id and r.kind = 'loa' and r.status = 'da_duyet') then
      raise exception 'Chỉ gắn được tờ trình (LOA) đã duyệt';
    end if;
    if auth.uid() is not null and not public.can_see_request(new.loa_id) then
      raise exception 'Bạn không xem được tờ trình này';
    end if;
  end if;
  return new;
end $$;
revoke execute on function public.tg_projects_guard() from public, anon, authenticated;
drop trigger if exists projects_guard on public.projects;
create trigger projects_guard before insert or update on public.projects
  for each row execute function public.tg_projects_guard();

create or replace function public.tg_project_items_guard() returns trigger
language plpgsql security definer set search_path = public as $$
declare par public.project_items; editor boolean;
begin
  if tg_op = 'UPDATE' then
    new.id := old.id; new.project_id := old.project_id; new.parent_id := old.parent_id; new.level := old.level;
    editor := auth.uid() is null or public.project_can_edit(old.project_id);
    if not editor then
      -- PIC / người hỗ trợ: chỉ cập nhật tiến độ, trạng thái, ghi chú
      if (to_jsonb(new) - array['progress','status','note','updated_at','updated_by'])
         is distinct from (to_jsonb(old) - array['progress','status','note','updated_at','updated_by']) then
        raise exception 'Bạn chỉ cập nhật được tiến độ, trạng thái và ghi chú của hạng mục';
      end if;
    end if;
  else
    if new.parent_id is null then
      new.level := 1;
    else
      select * into par from public.project_items where id = new.parent_id;
      if not found or par.project_id <> new.project_id then raise exception 'Hạng mục cha không thuộc dự án này'; end if;
      if par.level >= 4 then raise exception 'Chỉ chia tối đa 3 cấp dưới hạng mục chính'; end if;
      new.level := par.level + 1;
    end if;
  end if;
  new.name := trim(new.name);
  if new.level > 1 then new.budget := null; end if;   -- ngân sách chỉ đặt ở hạng mục chính
  if new.status = 'hoan_thanh' then new.progress := 100;
  elsif new.progress = 100 then new.status := 'hoan_thanh';
  elsif new.progress > 0 and new.status = 'chua_bat_dau' then new.status := 'dang_lam';
  end if;
  if new.pic_id is not null and (tg_op = 'INSERT' or new.pic_id is distinct from old.pic_id)
     and not exists (select 1 from public.profiles p where p.id = new.pic_id and p.is_active and p.role in ('quan_ly','giam_sat','nhan_vien')) then
    raise exception 'Người phụ trách hạng mục phải là nhân sự đang làm việc';
  end if;
  new.updated_at := now(); new.updated_by := auth.uid();
  return new;
end $$;
revoke execute on function public.tg_project_items_guard() from public, anon, authenticated;
drop trigger if exists project_items_guard on public.project_items;
create trigger project_items_guard before insert or update on public.project_items
  for each row execute function public.tg_project_items_guard();

-- Đề nghị tạm ứng / thanh toán gắn dự án
create or replace function public.tg_requests_project_guard() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.kind not in ('thanh_toan','tam_ung') then
    new.project_id := null; new.project_item_id := null; return new;
  end if;
  if new.project_item_id is not null then
    select i.project_id into new.project_id from public.project_items i where i.id = new.project_item_id and i.level = 1;
    if new.project_id is null then raise exception 'Chỉ gắn chi phí vào hạng mục chính của dự án'; end if;
  end if;
  if new.project_id is not null and auth.uid() is not null
     and (tg_op = 'INSERT' or new.project_id is distinct from old.project_id) then
    if not public.project_can_see(new.project_id) then raise exception 'Bạn không thuộc dự án này'; end if;
    if exists (select 1 from public.projects p where p.id = new.project_id and p.status in ('hoan_thanh','huy')) then
      raise exception 'Dự án đã kết thúc hoặc đã huỷ, không gắn thêm chi phí';
    end if;
  end if;
  return new;
end $$;
revoke execute on function public.tg_requests_project_guard() from public, anon, authenticated;
drop trigger if exists requests_project on public.requests;
create trigger requests_project before insert or update of project_id, project_item_id, kind on public.requests
  for each row execute function public.tg_requests_project_guard();

-- ============ D. RLS ============
alter table public.projects enable row level security;
alter table public.project_members enable row level security;
alter table public.project_items enable row level security;
alter table public.project_item_members enable row level security;
alter table public.project_logs enable row level security;
revoke all on public.projects, public.project_members, public.project_items, public.project_item_members, public.project_logs from anon;
grant select, insert, update, delete on public.projects, public.project_members, public.project_items, public.project_item_members to authenticated;
grant select on public.project_logs to authenticated;

drop policy if exists pj_select on public.projects;
create policy pj_select on public.projects for select to authenticated using (public.project_can_see(id));
drop policy if exists pj_insert on public.projects;
create policy pj_insert on public.projects for insert to authenticated
  with check (public.app_role() in ('quan_ly','giam_sat') and created_by = (select auth.uid()));
drop policy if exists pj_update on public.projects;
create policy pj_update on public.projects for update to authenticated
  using (public.project_can_edit(id)) with check (public.project_can_edit(id));
drop policy if exists pj_delete on public.projects;
create policy pj_delete on public.projects for delete to authenticated
  using (public.is_manager() or created_by = (select auth.uid()));

drop policy if exists pm_select on public.project_members;
create policy pm_select on public.project_members for select to authenticated using (public.project_can_see(project_id));
drop policy if exists pm_write on public.project_members;
create policy pm_write on public.project_members for all to authenticated
  using (public.project_can_edit(project_id)) with check (public.project_can_edit(project_id));

drop policy if exists pi_select on public.project_items;
create policy pi_select on public.project_items for select to authenticated using (public.project_can_see(project_id));
drop policy if exists pi_insert on public.project_items;
create policy pi_insert on public.project_items for insert to authenticated with check (public.project_can_edit(project_id));
drop policy if exists pi_update on public.project_items;
create policy pi_update on public.project_items for update to authenticated
  using (public.project_item_can_progress(id)) with check (public.project_item_can_progress(id));
drop policy if exists pi_delete on public.project_items;
create policy pi_delete on public.project_items for delete to authenticated using (public.project_can_edit(project_id));

drop policy if exists pim_select on public.project_item_members;
create policy pim_select on public.project_item_members for select to authenticated
  using (exists (select 1 from public.project_items i where i.id = item_id and public.project_can_see(i.project_id)));
drop policy if exists pim_write on public.project_item_members;
create policy pim_write on public.project_item_members for all to authenticated
  using (exists (select 1 from public.project_items i where i.id = item_id and public.project_can_edit(i.project_id)))
  with check (exists (select 1 from public.project_items i where i.id = item_id and public.project_can_edit(i.project_id)));

drop policy if exists pl_select on public.project_logs;
create policy pl_select on public.project_logs for select to authenticated using (public.project_can_see(project_id));

-- Người xem dự án được xem LOA gắn với dự án đó (để mở tờ trình từ trang dự án)
create or replace function public.project_loa(p_project uuid)
returns table (id uuid, doc_no text, reason text, amount bigint, currency text, status public.request_status, can_open boolean)
language sql stable security definer set search_path = public as $$
  select r.id, r.doc_no, r.reason, r.amount, r.currency, r.status, public.can_see_request(r.id)
    from public.projects p join public.requests r on r.id = p.loa_id
   where p.id = p_project and public.project_can_see(p_project)
$$;
revoke execute on function public.project_loa(uuid) from public, anon;
grant execute on function public.project_loa(uuid) to authenticated;

-- ============ E. Nhật ký tiến độ + thông báo ============
create or replace function public.tg_project_items_log() returns trigger
language plpgsql security definer set search_path = public as $$
declare p public.projects; who text;
begin
  if tg_op = 'UPDATE' and new.progress is not distinct from old.progress and new.status is not distinct from old.status
     and new.note is not distinct from old.note and new.pic_id is not distinct from old.pic_id then return null; end if;
  if tg_op = 'INSERT' or new.progress is distinct from old.progress or new.status is distinct from old.status or new.note is distinct from old.note then
    insert into public.project_logs(project_id, item_id, progress, status, note, by_id)
    values (new.project_id, new.id, new.progress, new.status, case when tg_op = 'INSERT' then 'Tạo hạng mục' else new.note end, auth.uid());
  end if;
  select * into p from public.projects where id = new.project_id;
  -- Báo PIC hạng mục khi được giao
  if new.pic_id is not null and new.pic_id is distinct from auth.uid()
     and (tg_op = 'INSERT' or new.pic_id is distinct from old.pic_id) then
    perform public.notify(new.pic_id, 'giao_viec', 'Bạn phụ trách hạng mục dự án',
      new.name || ' · ' || p.name || ' (' || to_char(new.start_date, 'DD/MM') || ' – ' || to_char(new.end_date, 'DD/MM/YYYY') || ')',
      'project', p.id, null);
  end if;
  -- Báo PIC dự án khi hạng mục hoàn thành
  if tg_op = 'UPDATE' and new.status = 'hoan_thanh' and old.status <> 'hoan_thanh' and p.pic_id is distinct from auth.uid() then
    select full_name into who from public.profiles where id = auth.uid();
    perform public.notify(p.pic_id, 'cap_nhat_viec', 'Hạng mục dự án đã hoàn thành',
      new.name || ' · ' || p.name || coalesce(' · ' || who, ''), 'project', p.id, null);
  end if;
  return null;
end $$;
revoke execute on function public.tg_project_items_log() from public, anon, authenticated;
drop trigger if exists project_items_log on public.project_items;
create trigger project_items_log after insert or update on public.project_items
  for each row execute function public.tg_project_items_log();

create or replace function public.tg_projects_notify() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.pic_id is distinct from auth.uid() and (tg_op = 'INSERT' or new.pic_id is distinct from old.pic_id) then
    perform public.notify(new.pic_id, 'giao_viec', 'Bạn là người phụ trách (PIC) dự án',
      new.code || ' · ' || new.name, 'project', new.id, null);
  end if;
  return null;
end $$;
revoke execute on function public.tg_projects_notify() from public, anon, authenticated;
drop trigger if exists projects_notify on public.projects;
create trigger projects_notify after insert or update of pic_id on public.projects
  for each row execute function public.tg_projects_notify();

create or replace function public.tg_project_member_notify() returns trigger
language plpgsql security definer set search_path = public as $$
declare p public.projects; it public.project_items;
begin
  if new.user_id = auth.uid() then return null; end if;
  if tg_table_name = 'project_members' then
    select * into p from public.projects where id = new.project_id;
    perform public.notify(new.user_id, 'giao_viec', 'Bạn được thêm hỗ trợ dự án', p.code || ' · ' || p.name, 'project', p.id, null);
  else
    select * into it from public.project_items where id = new.item_id;
    select * into p from public.projects where id = it.project_id;
    perform public.notify(new.user_id, 'giao_viec', 'Bạn hỗ trợ hạng mục dự án', it.name || ' · ' || p.name, 'project', p.id, null);
  end if;
  return null;
end $$;
revoke execute on function public.tg_project_member_notify() from public, anon, authenticated;
drop trigger if exists project_members_notify on public.project_members;
create trigger project_members_notify after insert on public.project_members
  for each row execute function public.tg_project_member_notify();
drop trigger if exists project_item_members_notify on public.project_item_members;
create trigger project_item_members_notify after insert on public.project_item_members
  for each row execute function public.tg_project_member_notify();

-- ============ F. Báo cáo ngân sách ============
-- Mỗi hạng mục chính + dòng "chưa gắn hạng mục": ngân sách, đã duyệt chi, đang chờ duyệt
create or replace function public.project_budget(p_project uuid)
returns table (item_id uuid, name text, sort int, budget bigint, spent bigint, pending bigint, n_requests int)
language sql stable security definer set search_path = public as $$
  with r as (
    select q.project_item_id, q.amount, q.status from public.requests q
     where q.project_id = p_project and q.kind in ('thanh_toan','tam_ung')
       and q.status in ('cho_duyet','da_duyet','hoan_tat')
  )
  select i.id, i.name, i.sort, i.budget,
         coalesce((select sum(amount) from r where r.project_item_id = i.id and r.status in ('da_duyet','hoan_tat')), 0)::bigint,
         coalesce((select sum(amount) from r where r.project_item_id = i.id and r.status = 'cho_duyet'), 0)::bigint,
         (select count(*) from r where r.project_item_id = i.id)::int
    from public.project_items i
   where i.project_id = p_project and i.level = 1 and public.project_can_see(p_project)
  union all
  select null::uuid, 'Chưa gắn hạng mục', 1000000, null::bigint,
         coalesce((select sum(amount) from r where r.project_item_id is null and r.status in ('da_duyet','hoan_tat')), 0)::bigint,
         coalesce((select sum(amount) from r where r.project_item_id is null and r.status = 'cho_duyet'), 0)::bigint,
         (select count(*) from r where r.project_item_id is null)::int
   where public.project_can_see(p_project) and exists (select 1 from r where r.project_item_id is null)
  order by 3
$$;
revoke execute on function public.project_budget(uuid) from public, anon;
grant execute on function public.project_budget(uuid) to authenticated;

create or replace function public.project_requests(p_project uuid)
returns table (id uuid, kind public.request_kind, doc_no text, reason text, amount bigint, status public.request_status,
               item_id uuid, requester_name text, created_at timestamptz, can_open boolean)
language sql stable security definer set search_path = public as $$
  select q.id, q.kind, q.doc_no, case when public.can_see_request(q.id) then q.reason end, q.amount, q.status,
         q.project_item_id, pr.full_name, q.created_at, public.can_see_request(q.id)
    from public.requests q left join public.profiles pr on pr.id = q.requester_id
   where q.project_id = p_project and q.kind in ('thanh_toan','tam_ung') and q.status <> 'nhap'
     and public.project_can_see(p_project)
   order by q.created_at desc
$$;
revoke execute on function public.project_requests(uuid) from public, anon;
grant execute on function public.project_requests(uuid) to authenticated;

-- Tổng hợp cho danh sách dự án
create or replace function public.project_summary()
returns table (project_id uuid, spent bigint, pending bigint, items int, done_items int)
language sql stable security definer set search_path = public as $$
  select p.id,
    coalesce((select sum(q.amount) from public.requests q where q.project_id = p.id and q.kind in ('thanh_toan','tam_ung') and q.status in ('da_duyet','hoan_tat')), 0)::bigint,
    coalesce((select sum(q.amount) from public.requests q where q.project_id = p.id and q.kind in ('thanh_toan','tam_ung') and q.status = 'cho_duyet'), 0)::bigint,
    (select count(*) from public.project_items i where i.project_id = p.id)::int,
    (select count(*) from public.project_items i where i.project_id = p.id and i.status = 'hoan_thanh')::int
  from public.projects p
  where public.project_can_see(p.id)
$$;
revoke execute on function public.project_summary() from public, anon;
grant execute on function public.project_summary() to authenticated;
