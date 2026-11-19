-- 073: Trợ lý báo cáo AI (chỉ Quản lý).
-- AI không viết truy vấn: Edge Function tro-ly-bao-cao chỉ gọi các hàm ai_* dưới đây bằng phiên của người hỏi.
-- Mọi hàm kiểm tra Quản lý. Không trả tên, số điện thoại, CCCD khách thuê; không có lương.

create or replace function public.ai_guard() returns void
language plpgsql stable security definer set search_path = public as $$
begin
  if not (public.is_manager() or coalesce(auth.role(), '') = 'service_role') then
    raise exception 'Chỉ Quản lý dùng được trợ lý báo cáo AI';
  end if;
end $$;

create or replace function public.ai_today() returns date language sql stable as $$
  select (now() at time zone 'Asia/Ho_Chi_Minh')::date
$$;

-- Toà theo mã hoặc tên (rỗng = tất cả)
create or replace function public.ai_building_ids(p text) returns uuid[]
language sql stable security definer set search_path = public as $$
  select coalesce(array_agg(id), array[]::uuid[]) from public.buildings
   where coalesce(trim(p), '') = '' or code ilike trim(p) or name ilike '%' || trim(p) || '%' or code ilike '%' || trim(p) || '%'
$$;

-- ========== Danh mục toà ==========
create or replace function public.ai_buildings() returns jsonb
language plpgsql stable security definer set search_path = public as $$
begin
  perform public.ai_guard();
  return (select coalesce(jsonb_agg(jsonb_build_object('code', b.code, 'name', b.name, 'kind', b.kind,
            'rooms', (select count(*) from public.rooms r where r.building_id = b.id)) order by b.code), '[]'::jsonb)
          from public.buildings b);
end $$;

-- ========== Phòng & lấp đầy ==========
create or replace function public.ai_occupancy(p_building text default null, p_months int default 6) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare t date := public.ai_today(); ids uuid[]; n int := least(greatest(coalesce(p_months, 6), 1), 24);
begin
  perform public.ai_guard();
  ids := public.ai_building_ids(p_building);
  return jsonb_build_object(
    'as_of', t,
    'note', 'Lấp đầy = phòng đang ở / tổng phòng. Toà khách sạn (thuê theo đêm) không có hợp đồng tháng nên số theo hợp đồng chỉ mang tính tham khảo.',
    'buildings', (select coalesce(jsonb_agg(x order by x->>'code'), '[]'::jsonb) from (
        select jsonb_build_object('code', b.code, 'name', b.name, 'kind', b.kind,
          'rooms', count(r.id), 'occupied', count(r.id) filter (where r.status = 'dang_o'),
          'vacant', count(r.id) filter (where r.status = 'trong'), 'repairing', count(r.id) filter (where r.status = 'dang_sua'),
          'held', count(r.id) filter (where r.status = 'giu_cho'),
          'occupancy_pct', case when count(r.id) > 0 then round(100.0 * count(r.id) filter (where r.status = 'dang_o') / count(r.id), 1) end) x
          from public.buildings b left join public.rooms r on r.building_id = b.id
         where b.id = any(ids) group by b.id) s),
    'vacant_rooms', (select coalesce(jsonb_agg(x order by (x->>'days_vacant')::int desc), '[]'::jsonb) from (
        select jsonb_build_object('building', b.code, 'room', r.code, 'list_price', r.list_price, 'room_type', r.room_type,
          'days_vacant', t - coalesce((select max(c.end_date) from public.contracts c where c.room_id = r.id and c.status <> 'da_huy' and c.end_date <= t), r.created_at::date)) x
          from public.rooms r join public.buildings b on b.id = r.building_id
         where r.building_id = any(ids) and r.status = 'trong') s),
    'expiring_30d', (select coalesce(jsonb_agg(jsonb_build_object('building', b.code, 'room', r.code, 'end_date', c.end_date, 'rent', c.rent_amount) order by c.end_date), '[]'::jsonb)
          from public.contracts c join public.rooms r on r.id = c.room_id join public.buildings b on b.id = c.building_id
         where c.building_id = any(ids) and c.status = 'hieu_luc' and c.end_date between t and t + 30),
    'monthly', (select coalesce(jsonb_agg(jsonb_build_object('month', to_char(m, 'YYYY-MM'), 'building', b.code,
            'rooms', (select count(*) from public.rooms r where r.building_id = b.id),
            'occupied_by_contract', (select count(distinct c.room_id) from public.contracts c
               where c.building_id = b.id and c.status <> 'da_huy' and c.start_date <= (m + interval '14 day')::date
                 and (c.end_date is null or c.end_date >= (m + interval '14 day')::date))) order by m, b.code), '[]'::jsonb)
          from public.buildings b, generate_series(date_trunc('month', t) - make_interval(months => n - 1), date_trunc('month', t), interval '1 month') m
         where b.id = any(ids))
  );
end $$;

-- ========== Doanh thu & công nợ ==========
create or replace function public.ai_revenue(p_from date default null, p_to date default null, p_building text default null) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare t date := public.ai_today(); f date; e date; ids uuid[];
begin
  perform public.ai_guard();
  f := date_trunc('month', coalesce(p_from, (date_trunc('month', t) - interval '5 month')::date))::date;
  e := coalesce(p_to, t);
  ids := public.ai_building_ids(p_building);
  return jsonb_build_object(
    'as_of', t, 'from', f, 'to', e,
    'note', 'invoiced = tổng hoá đơn của kỳ; collected = đã thu; outstanding = còn phải thu. Hoá đơn đã huỷ không tính.',
    'monthly', (select coalesce(jsonb_agg(x order by x->>'month', x->>'building'), '[]'::jsonb) from (
        select jsonb_build_object('month', to_char(i.period, 'YYYY-MM'), 'building', b.code, 'invoices', count(*),
          'invoiced', sum(i.amount),
          'collected', sum(case when i.status = 'da_thu' then coalesce(i.paid_amount, i.amount) else coalesce(i.paid_amount, 0) end),
          'outstanding', sum(case when i.status = 'da_thu' then 0 else i.amount - coalesce(i.paid_amount, 0) end)) x
          from public.invoices i join public.buildings b on b.id = i.building_id
         where i.status <> 'huy' and i.building_id = any(ids) and i.period between f and e
         group by to_char(i.period, 'YYYY-MM'), b.code) s),
    'overdue_total', (select jsonb_build_object('amount', coalesce(sum(i.amount - coalesce(i.paid_amount, 0)), 0), 'invoices', count(*),
            'rooms', count(distinct c.room_id), 'over_15_days', coalesce(sum(i.amount - coalesce(i.paid_amount, 0)) filter (where t - i.due_date > 15), 0))
          from public.invoices i left join public.contracts c on c.id = i.contract_id
         where i.status = 'chua_thu' and i.due_date < t and i.building_id = any(ids)),
    'overdue', (select coalesce(jsonb_agg(x order by (x->>'days_overdue')::int desc), '[]'::jsonb) from (
        select jsonb_build_object('building', b.code, 'room', r.code, 'period', to_char(i.period, 'YYYY-MM'),
          'amount_due', i.amount - coalesce(i.paid_amount, 0), 'days_overdue', t - i.due_date) x
          from public.invoices i join public.buildings b on b.id = i.building_id
          left join public.contracts c on c.id = i.contract_id left join public.rooms r on r.id = c.room_id
         where i.status = 'chua_thu' and i.due_date < t and i.building_id = any(ids)
         order by t - i.due_date desc limit 40) s),
    'on_time_rate_pct', (select case when count(*) > 0 then round(100.0 * count(*) filter (where i.status = 'da_thu' and i.collected_at <= i.due_date) / count(*), 1) end
          from public.invoices i where i.status <> 'huy' and i.due_date between f and least(e, t) and i.building_id = any(ids))
  );
end $$;

-- ========== Chi phí & ngân sách ==========
create or replace function public.ai_costs(p_from date default null, p_to date default null, p_building text default null) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare t date := public.ai_today(); f date; e date; ids uuid[]; all_b boolean := coalesce(trim(p_building), '') = '';
begin
  perform public.ai_guard();
  f := date_trunc('month', coalesce(p_from, (date_trunc('month', t) - interval '5 month')::date))::date;
  e := coalesce(p_to, t);
  ids := public.ai_building_ids(p_building);
  return jsonb_build_object(
    'as_of', t, 'from', f, 'to', e,
    'note', 'Chi phí = đề nghị thanh toán + tạm ứng đã duyệt hoặc đã chi. Đề nghị thanh toán đã trừ phần tạm ứng nên cộng hai loại không bị trùng. pay_type: loại thanh toán.',
    'monthly', (select coalesce(jsonb_agg(x order by x->>'month'), '[]'::jsonb) from (
        select jsonb_build_object('month', to_char(coalesce(q.doc_date, q.created_at::date), 'YYYY-MM'), 'kind', q.kind,
          'building', coalesce(b.code, 'Chung'), 'pay_type', q.pay_type, 'requests', count(*), 'amount', sum(q.amount)) x
          from public.requests q left join public.buildings b on b.id = q.building_id
         where q.kind in ('thanh_toan', 'tam_ung') and q.status in ('da_duyet', 'hoan_tat')
           and coalesce(q.doc_date, q.created_at::date) between f and e
           and (all_b or q.building_id = any(ids))
         group by to_char(coalesce(q.doc_date, q.created_at::date), 'YYYY-MM'), q.kind, coalesce(b.code, 'Chung'), q.pay_type) s),
    'pending_approval', (select jsonb_build_object('requests', count(*), 'amount', coalesce(sum(q.amount), 0))
          from public.requests q where q.kind in ('thanh_toan', 'tam_ung') and q.status = 'cho_duyet' and (all_b or q.building_id = any(ids))),
    'largest', (select coalesce(jsonb_agg(x), '[]'::jsonb) from (
        select jsonb_build_object('doc_no', q.doc_no, 'kind', q.kind, 'reason', left(q.reason, 140), 'amount', q.amount,
          'building', coalesce(b.code, 'Chung'), 'date', coalesce(q.doc_date, q.created_at::date)) x
          from public.requests q left join public.buildings b on b.id = q.building_id
         where q.kind in ('thanh_toan', 'tam_ung') and q.status in ('da_duyet', 'hoan_tat')
           and coalesce(q.doc_date, q.created_at::date) between f and e and (all_b or q.building_id = any(ids))
         order by q.amount desc nulls last limit 10) s),
    'loa', (select coalesce(jsonb_agg(jsonb_build_object('doc_no', l.doc_no, 'subject', left(l.reason, 140), 'budget', l.amount,
            'used', coalesce((select sum(q.amount) from public.requests q where q.loa_id = l.id and q.status in ('da_duyet', 'hoan_tat')), 0),
            'pending', coalesce((select sum(q.amount) from public.requests q where q.loa_id = l.id and q.status = 'cho_duyet'), 0)) order by l.created_at desc), '[]'::jsonb)
          from public.requests l where l.kind = 'loa' and l.status = 'da_duyet' and (all_b or l.building_id = any(ids))),
    'projects', (select coalesce(jsonb_agg(jsonb_build_object('code', p.code, 'name', p.name, 'status', p.status, 'budget', p.budget,
            'spent', coalesce((select sum(q.amount) from public.requests q where q.project_id = p.id and q.kind in ('thanh_toan', 'tam_ung') and q.status in ('da_duyet', 'hoan_tat')), 0),
            'pending', coalesce((select sum(q.amount) from public.requests q where q.project_id = p.id and q.kind in ('thanh_toan', 'tam_ung') and q.status = 'cho_duyet'), 0)) order by p.start_date desc), '[]'::jsonb)
          from public.projects p where p.status <> 'huy' and (all_b or p.building_id = any(ids)))
  );
end $$;

-- Tiến độ dự án: trung bình theo số ngày của các hạng mục lá
create or replace function public.ai_project_progress(p_project uuid) returns jsonb
language sql stable security definer set search_path = public as $$
  with leaf as (
    select i.*, (i.end_date - i.start_date + 1) w,
      case when public.ai_today() < i.start_date then 0 when public.ai_today() >= i.end_date then 100
           else round(100.0 * (public.ai_today() - i.start_date + 1) / (i.end_date - i.start_date + 1)) end plan
      from public.project_items i
     where i.project_id = p_project and not exists (select 1 from public.project_items k where k.parent_id = i.id))
  select jsonb_build_object('actual_pct', coalesce(round(sum(w * progress)::numeric / nullif(sum(w), 0)), 0),
    'planned_pct', coalesce(round(sum(w * plan)::numeric / nullif(sum(w), 0)), 0),
    'items', count(*), 'done', count(*) filter (where progress >= 100),
    'late_items', count(*) filter (where progress < 100 and plan - progress >= 15))
  from leaf
$$;
revoke execute on function public.ai_project_progress(uuid) from public, anon, authenticated;

-- ========== Công việc, dự án, nhân sự ==========
create or replace function public.ai_work() returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare t date := public.ai_today(); m date := date_trunc('month', public.ai_today())::date;
begin
  perform public.ai_guard();
  return jsonb_build_object(
    'as_of', t,
    'tasks', (select jsonb_build_object('open', count(*) filter (where k.status <> 'xong'),
            'overdue', count(*) filter (where k.status <> 'xong' and k.due_date < t),
            'blocked', count(*) filter (where k.status = 'vuong'),
            'done_last_30d', count(*) filter (where k.status = 'xong' and k.completed_at >= now() - interval '30 day'))
          from public.tasks k where k.parent_id is null),
    'overdue_by_person', (select coalesce(jsonb_agg(x order by (x->>'overdue')::int desc), '[]'::jsonb) from (
        select jsonb_build_object('person', p.full_name, 'department', d.name, 'overdue', count(*), 'max_days_late', max(t - k.due_date)) x
          from public.tasks k join public.profiles p on p.id = k.assignee_id
          left join public.org_staff s on s.profile_id = p.id left join public.departments d on d.id = s.department_id
         where k.parent_id is null and k.status <> 'xong' and k.due_date < t
         group by p.full_name, d.name) s),
    'overdue_tasks', (select coalesce(jsonb_agg(x), '[]'::jsonb) from (
        select jsonb_build_object('title', left(k.title, 120), 'assignee', p.full_name, 'due', k.due_date, 'days_late', t - k.due_date,
          'status', k.status, 'building', b.code) x
          from public.tasks k left join public.profiles p on p.id = k.assignee_id left join public.buildings b on b.id = k.building_id
         where k.parent_id is null and k.status <> 'xong' and k.due_date < t order by k.due_date limit 25) s),
    'projects', (select coalesce(jsonb_agg(jsonb_build_object('code', p.code, 'name', p.name, 'status', p.status,
            'start', p.start_date, 'end', p.end_date, 'pic', (select full_name from public.profiles where id = p.pic_id))
            || public.ai_project_progress(p.id) order by p.start_date desc), '[]'::jsonb)
          from public.projects p where p.status not in ('huy')),
    'leave_trip_this_month', (select coalesce(jsonb_agg(x), '[]'::jsonb) from (
        select jsonb_build_object('kind', q.kind, 'department', coalesce(d.name, 'Chưa xếp phòng'), 'requests', count(*), 'days', sum(coalesce(q.days, 0))) x
          from public.requests q left join public.org_staff s on s.profile_id = coalesce(q.traveler_id, q.requester_id)
          left join public.departments d on d.id = s.department_id
         where q.kind in ('nghi_phep', 'cong_tac', 'ra_ngoai') and q.status in ('da_duyet', 'hoan_tat')
           and q.start_date >= m and q.start_date < (m + interval '1 month')::date
         group by q.kind, d.name) s),
    'pending_approvals', (select coalesce(jsonb_object_agg(kind, n), '{}'::jsonb) from (
        select q.kind, count(*) n from public.requests q where q.status = 'cho_duyet' group by q.kind) s)
  );
end $$;

-- ========== Số liệu tổng quan cho 4 thẻ trang Báo cáo AI (không qua AI) ==========
create or replace function public.ai_overview() returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare t date := public.ai_today(); m date := date_trunc('month', public.ai_today())::date; pm date := (date_trunc('month', public.ai_today()) - interval '1 month')::date;
begin
  perform public.ai_guard();
  return jsonb_build_object(
    'as_of', t,
    'revenue', (select jsonb_build_object(
        'this_month', coalesce(sum(i.amount) filter (where i.period >= m), 0),
        'prev_month', coalesce(sum(i.amount) filter (where i.period >= pm and i.period < m), 0),
        'collected_this_month', coalesce(sum(coalesce(i.paid_amount, case when i.status = 'da_thu' then i.amount else 0 end)) filter (where i.period >= m), 0))
      from public.invoices i where i.status <> 'huy' and i.period >= pm),
    'occupancy', (select jsonb_build_object('rooms', count(*), 'occupied', count(*) filter (where status = 'dang_o'),
        'vacant', count(*) filter (where status = 'trong'),
        'expiring_30d', (select count(*) from public.contracts c where c.status = 'hieu_luc' and c.end_date between t and t + 30))
      from public.rooms),
    'debt', (select jsonb_build_object('amount', coalesce(sum(i.amount - coalesce(i.paid_amount, 0)), 0), 'invoices', count(*),
        'over_15_days', coalesce(sum(i.amount - coalesce(i.paid_amount, 0)) filter (where t - i.due_date > 15), 0))
      from public.invoices i where i.status = 'chua_thu' and i.due_date < t),
    'costs', (select jsonb_build_object(
        'this_month', coalesce(sum(q.amount) filter (where coalesce(q.doc_date, q.created_at::date) >= m), 0),
        'prev_month', coalesce(sum(q.amount) filter (where coalesce(q.doc_date, q.created_at::date) >= pm and coalesce(q.doc_date, q.created_at::date) < m), 0),
        'pending', (select coalesce(sum(amount), 0) from public.requests where kind in ('thanh_toan', 'tam_ung') and status = 'cho_duyet'))
      from public.requests q where q.kind in ('thanh_toan', 'tam_ung') and q.status in ('da_duyet', 'hoan_tat') and coalesce(q.doc_date, q.created_at::date) >= pm),
    'projects', (select jsonb_build_object('running', count(*),
        'late', count(*) filter (where ((public.ai_project_progress(p.id)->>'planned_pct')::int - (public.ai_project_progress(p.id)->>'actual_pct')::int) >= 5))
      from public.projects p where p.status in ('ke_hoach', 'dang_thuc_hien')),
    'tasks', (select jsonb_build_object('open', count(*), 'overdue', count(*) filter (where due_date < t))
      from public.tasks where parent_id is null and status <> 'xong')
  );
end $$;

do $$ declare f text; begin
  foreach f in array array['ai_guard()', 'ai_buildings()', 'ai_occupancy(text,integer)', 'ai_revenue(date,date,text)', 'ai_costs(date,date,text)', 'ai_work()', 'ai_overview()'] loop
    execute format('revoke execute on function public.%s from public, anon', f);
    execute format('grant execute on function public.%s to authenticated', f);
  end loop;
end $$;
revoke execute on function public.ai_building_ids(text) from public, anon, authenticated;

-- ========== Lịch sử hỏi đáp + báo cáo tuần ==========
create table if not exists public.ai_chats (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null default auth.uid() references public.profiles(id) on delete cascade,
  title      text not null default 'Cuộc hỏi mới' check (char_length(title) <= 200),
  context    jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists ai_chats_user on public.ai_chats(user_id, updated_at desc);
create table if not exists public.ai_messages (
  id         uuid primary key default gen_random_uuid(),
  chat_id    uuid not null references public.ai_chats(id) on delete cascade,
  role       text not null check (role in ('user', 'assistant')),
  content    jsonb not null,
  created_at timestamptz not null default now()
);
create index if not exists ai_messages_chat on public.ai_messages(chat_id, created_at);
create table if not exists public.ai_reports (
  id         uuid primary key default gen_random_uuid(),
  week_start date not null unique,
  content    jsonb not null,
  created_by uuid references public.profiles(id) on delete set null default auth.uid(),
  created_at timestamptz not null default now()
);
alter table public.ai_chats enable row level security;
alter table public.ai_messages enable row level security;
alter table public.ai_reports enable row level security;
revoke all on public.ai_chats, public.ai_messages, public.ai_reports from anon;
grant select, insert, update, delete on public.ai_chats, public.ai_messages to authenticated;
grant select, insert, update on public.ai_reports to authenticated;

drop policy if exists aic_own on public.ai_chats;
create policy aic_own on public.ai_chats for all to authenticated
  using (user_id = (select auth.uid()) and public.is_manager()) with check (user_id = (select auth.uid()) and public.is_manager());
drop policy if exists aim_own on public.ai_messages;
create policy aim_own on public.ai_messages for all to authenticated
  using (exists (select 1 from public.ai_chats c where c.id = chat_id and c.user_id = (select auth.uid())) and public.is_manager())
  with check (exists (select 1 from public.ai_chats c where c.id = chat_id and c.user_id = (select auth.uid())) and public.is_manager());
drop policy if exists air_mgr on public.ai_reports;
create policy air_mgr on public.ai_reports for all to authenticated using (public.is_manager()) with check (public.is_manager());

-- Thứ Hai 07:00 (giờ VN) báo Quản lý: mở trang Báo cáo AI để AI lập nhận định tuần mới
create or replace function public.ai_weekly_notify() returns void
language plpgsql security definer set search_path = public as $$
declare u record; wk date := date_trunc('week', public.ai_today())::date;
begin
  for u in select id from public.profiles where role = 'quan_ly' and is_active loop
    perform public.notify(u.id, 'khac', 'Báo cáo AI tuần mới',
      'Mở Báo cáo AI để xem nhận định tuần ' || to_char(wk, 'DD/MM') || ': doanh thu, lấp đầy, công nợ, dự án.',
      'ai_report', null, 'ai-week-' || wk);
  end loop;
end $$;
revoke execute on function public.ai_weekly_notify() from public, anon, authenticated;
select cron.unschedule('bao-cao-ai-tuan') where exists (select 1 from cron.job where jobname = 'bao-cao-ai-tuan');
select cron.schedule('bao-cao-ai-tuan', '0 0 * * 1', 'select public.ai_weekly_notify()');
