-- 068: Cài đặt luồng phê duyệt theo từng loại đề nghị.
-- Chỉ người trong flow_admins (anh Cấn Toàn Trí) được sửa. Mỗi bước: chức danh theo sơ đồ tổ chức,
-- hoặc chỉ định một người cụ thể. Chưa cài thì dùng luồng mặc định như trước.
-- Đổi luồng chỉ áp dụng cho phiếu gửi sau đó; phiếu đang chờ giữ luồng đã dựng.

-- Bước "Người duyệt" (chỉ định người, không theo chức danh)
alter table public.request_steps drop constraint if exists request_steps_duty_check;
alter table public.request_steps add constraint request_steps_duty_check
  check (duty in ('leader','truong_phong','nhan_su','ke_toan','giam_doc','khac'));

create table if not exists public.flow_admins (
  user_id    uuid primary key references public.profiles(id) on delete cascade,
  created_at timestamptz not null default now()
);
alter table public.flow_admins enable row level security;
revoke all on public.flow_admins from anon, authenticated;
insert into public.flow_admins(user_id)
  select id from public.profiles where full_name = 'Cấn Toàn Trí' and role = 'quan_ly'
  on conflict do nothing;

create or replace function public.is_flow_admin() returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.flow_admins f join public.profiles p on p.id = f.user_id
                  where f.user_id = auth.uid() and p.is_active)
$$;
revoke execute on function public.is_flow_admin() from public, anon;
grant execute on function public.is_flow_admin() to authenticated;

create table if not exists public.approval_flows (
  kind       public.request_kind primary key,
  steps      jsonb not null,          -- [{"duty":"truong_phong","approver_id":null}, {"duty":"khac","approver_id":"<uuid>"}]
  updated_at timestamptz not null default now(),
  updated_by uuid references public.profiles(id) on delete set null
);
alter table public.approval_flows enable row level security;
revoke all on public.approval_flows from anon, authenticated;   -- đọc / ghi qua hàm bên dưới

create or replace function public.default_flow(p_kind public.request_kind) returns text[]
language sql immutable as $$
  select case when p_kind in ('thanh_toan','tam_ung','loa')
              then array['leader','truong_phong','ke_toan','giam_doc']
              else array['leader','truong_phong','nhan_su'] end
$$;

-- Dựng chuỗi duyệt cho người đề nghị: theo cài đặt nếu có, không thì mặc định
create or replace function public.approval_chain(p_requester uuid, p_kind public.request_kind)
returns table (step_no integer, duty text, approver_id uuid, skip_reason text)
language plpgsql stable security definer set search_path = public as $$
declare
  me     public.org_staff;
  head_p uuid; lead_p uuid; gd uuid; ns uuid; kt uuid;
  cfg jsonb; st jsonb; d text; pick uuid; n int := 0; a uuid; why text; seen uuid[] := array[]::uuid[];
begin
  select * into me from public.org_staff o where o.profile_id = p_requester;
  select s.profile_id into head_p from public.departments dp join public.org_staff s on s.id = dp.head_staff_id
   where dp.id = me.department_id;
  select s.profile_id into lead_p from public.org_staff s
   where s.is_leader and s.profile_id is not null and s.profile_id <> p_requester
     and s.department_id = me.department_id and s.team is not distinct from me.team limit 1;
  select o.profile_id into gd from public.org_staff o where o.duty = 'giam_doc';
  select o.profile_id into ns from public.org_staff o where o.duty = 'nhan_su';
  select o.profile_id into kt from public.org_staff o where o.duty = 'ke_toan';

  select f.steps into cfg from public.approval_flows f where f.kind = p_kind;
  if cfg is null or jsonb_array_length(cfg) = 0 then
    select jsonb_agg(jsonb_build_object('duty', x, 'approver_id', null)) into cfg from unnest(public.default_flow(p_kind)) x;
  end if;

  for st in select value from jsonb_array_elements(cfg) loop
    n := n + 1; why := null; a := null;
    d := st->>'duty';
    pick := nullif(st->>'approver_id', '')::uuid;
    if pick is not null then
      a := pick;
      if not exists (select 1 from public.profiles p where p.id = a and p.is_active) then
        why := 'Người duyệt đã ngừng hoạt động'; a := null;
      end if;
    elsif d = 'leader' then
      a := lead_p; if a is null then why := 'Chưa có Leader'; end if;
    elsif d = 'truong_phong' then
      a := head_p;
      if a is null or a = p_requester then a := gd; end if;
    elsif d = 'nhan_su' then
      a := ns; if a is null then why := 'Chưa có tài khoản Nhân sự'; end if;
    elsif d = 'ke_toan' then
      a := coalesce(kt, gd);
    elsif d = 'giam_doc' then
      a := gd;
    else
      why := 'Chưa chọn người duyệt';
    end if;
    if why is null and a is not null then
      if a = p_requester then why := 'Chính người đề nghị';
      elsif a = any(seen) then why := 'Đã duyệt ở bước trước';
      end if;
    end if;
    if why is null and a is not null then seen := seen || a; end if;
    step_no := n; duty := d; approver_id := a; skip_reason := why;
    return next;
  end loop;
end $$;

-- Danh sách luồng của mọi loại (ai đăng nhập cũng xem được, để biết đề nghị đi qua ai)
create or replace function public.approval_flow_list()
returns table (kind public.request_kind, steps jsonb, is_custom boolean, updated_at timestamptz, updated_by_name text)
language sql stable security definer set search_path = public as $$
  with k as (select unnest(enum_range(null::public.request_kind)) as kind)
  select k.kind,
         (select jsonb_agg(jsonb_build_object('duty', e->>'duty', 'approver_id', e->>'approver_id',
                   'approver_name', (select p.full_name from public.profiles p where p.id = nullif(e->>'approver_id','')::uuid)) order by o)
            from jsonb_array_elements(coalesce(f.steps,
                   (select jsonb_agg(jsonb_build_object('duty', x, 'approver_id', null)) from unnest(public.default_flow(k.kind)) x)))
                 with ordinality as t(e, o)),
         f.kind is not null, f.updated_at, (select p.full_name from public.profiles p where p.id = f.updated_by)
    from k left join public.approval_flows f on f.kind = k.kind
   where auth.uid() is not null
   order by k.kind
$$;
revoke execute on function public.approval_flow_list() from public, anon;
grant execute on function public.approval_flow_list() to authenticated;

create or replace function public.approval_flow_save(p_kind public.request_kind, p_steps jsonb) returns timestamptz
language plpgsql security definer set search_path = public as $$
declare st jsonb; d text; pick uuid; clean jsonb := '[]'::jsonb; t timestamptz := now();
begin
  if not public.is_flow_admin() then raise exception 'Chỉ anh Trí được cài đặt luồng phê duyệt'; end if;
  if p_steps is null or jsonb_typeof(p_steps) <> 'array' then raise exception 'Luồng duyệt không hợp lệ'; end if;
  if jsonb_array_length(p_steps) < 1 then raise exception 'Luồng duyệt cần ít nhất 1 bước'; end if;
  if jsonb_array_length(p_steps) > 8 then raise exception 'Luồng duyệt tối đa 8 bước'; end if;
  for st in select value from jsonb_array_elements(p_steps) loop
    d := st->>'duty';
    if d is null or d not in ('leader','truong_phong','nhan_su','ke_toan','giam_doc','khac') then
      raise exception 'Chức danh duyệt không hợp lệ';
    end if;
    begin pick := nullif(st->>'approver_id', '')::uuid;
    exception when others then raise exception 'Người duyệt không hợp lệ'; end;
    if d = 'khac' and pick is null then raise exception 'Bước "Người duyệt" cần chọn một người'; end if;
    if pick is not null and not exists (
      select 1 from public.profiles p where p.id = pick and p.is_active and p.role in ('quan_ly','giam_sat','nhan_vien')) then
      raise exception 'Người duyệt phải là nhân sự đang làm việc';
    end if;
    clean := clean || jsonb_build_array(jsonb_build_object('duty', d, 'approver_id', pick));
  end loop;
  insert into public.approval_flows(kind, steps, updated_at, updated_by) values (p_kind, clean, t, auth.uid())
  on conflict (kind) do update set steps = excluded.steps, updated_at = excluded.updated_at, updated_by = excluded.updated_by;
  return t;
end $$;
revoke execute on function public.approval_flow_save(public.request_kind, jsonb) from public, anon;
grant execute on function public.approval_flow_save(public.request_kind, jsonb) to authenticated;

create or replace function public.approval_flow_reset(p_kind public.request_kind) returns void
language plpgsql security definer set search_path = public as $$
begin
  if not public.is_flow_admin() then raise exception 'Chỉ anh Trí được cài đặt luồng phê duyệt'; end if;
  delete from public.approval_flows where kind = p_kind;
end $$;
revoke execute on function public.approval_flow_reset(public.request_kind) from public, anon;
grant execute on function public.approval_flow_reset(public.request_kind) to authenticated;
