-- =====================================================================
-- Cơ cấu tổ chức (theo Kế hoạch tái cấu trúc 2026–2027) + luồng duyệt nhiều bước
--   Nghỉ phép · Làm việc bên ngoài · Công tác : Người đề nghị → Leader → Trưởng phòng → Nhân sự
--   Thanh toán · Tạm ứng                      : Người đề nghị → Leader → Trưởng phòng → Kế toán → Giám đốc
-- Bước không có người giữ (chưa có Leader, chưa có tài khoản Nhân sự…) tự bỏ qua; người trùng chỉ duyệt một lần.
-- Chạy sau 008.
-- =====================================================================

-- 1) Phòng ban, nhân sự (vị trí), lương ---------------------------------
create table public.departments (
  id            uuid primary key default gen_random_uuid(),
  code          text not null unique,
  name          text not null,
  sort          int  not null default 0,
  head_staff_id uuid                      -- Trưởng phòng (có thể là Phó Giám đốc kiêm)
);

create table public.org_staff (
  id            uuid primary key default gen_random_uuid(),
  department_id uuid references public.departments(id) on delete set null,
  team          text,                     -- bộ phận nhỏ trong phòng, VD: KD tòa nhà
  position      text not null,
  level         int  check (level between 1 and 4),   -- L1 nhân viên · L2 Leader · L3 Trưởng phòng · L4 Phó Giám đốc
  rank          int  check (rank between 1 and 3),
  person_name   text,
  profile_id    uuid unique references public.profiles(id) on delete set null,
  status        text not null default 'co' check (status in ('co','tuyen','thue_ngoai')),
  hire_note     text,
  duty          text check (duty in ('nhan_su','ke_toan','giam_doc')),   -- người giữ nhiệm vụ duyệt cấp công ty
  is_leader     boolean not null default false,
  sort          int  not null default 0,
  created_at    timestamptz not null default now()
);
create unique index org_staff_duty_key on public.org_staff(duty) where duty is not null;
create index on public.org_staff(department_id);
alter table public.departments add constraint departments_head_fk
  foreign key (head_staff_id) references public.org_staff(id) on delete set null;

create table public.org_staff_pay (
  staff_id    uuid primary key references public.org_staff(id) on delete cascade,
  base_salary bigint check (base_salary >= 0),
  note        text,
  updated_at  timestamptz not null default now()
);

create table public.salary_scale (
  level       int not null check (level between 1 and 4),
  rank        int not null check (rank between 1 and 3),
  base_salary bigint not null,
  primary key (level, rank)
);

-- Hàm phân quyền theo cơ cấu
create or replace function public.my_org_level() returns int
language sql stable security definer set search_path = public as $$
  select coalesce((select s.level from public.org_staff s join public.profiles p on p.id = s.profile_id
                   where s.profile_id = auth.uid() and p.is_active), 0)
$$;
create or replace function public.can_see_org() returns boolean
language sql stable security definer set search_path = public as $$
  select public.my_org_level() >= 3
$$;
create or replace function public.is_duty(p_duty text) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.org_staff where duty = p_duty and profile_id = auth.uid())
$$;

alter table public.departments   enable row level security;
alter table public.org_staff     enable row level security;
alter table public.org_staff_pay enable row level security;
alter table public.salary_scale  enable row level security;

create policy dep_select on public.departments for select to authenticated using (public.can_see_org());
create policy dep_write  on public.departments for all to authenticated
  using (public.my_org_level() >= 4) with check (public.my_org_level() >= 4);
create policy staff_select on public.org_staff for select to authenticated
  using (public.can_see_org() or profile_id = (select auth.uid()));
create policy staff_write on public.org_staff for all to authenticated
  using (public.my_org_level() >= 4) with check (public.my_org_level() >= 4);
-- Lương: chỉ Phó Giám đốc trở lên xem và sửa; mỗi người xem được lương của chính mình
create policy pay_select on public.org_staff_pay for select to authenticated
  using (public.my_org_level() >= 4
         or exists (select 1 from public.org_staff s where s.id = staff_id and s.profile_id = (select auth.uid())));
create policy pay_write on public.org_staff_pay for all to authenticated
  using (public.my_org_level() >= 4) with check (public.my_org_level() >= 4);
create policy scale_select on public.salary_scale for select to authenticated using (public.can_see_org());
create policy scale_write  on public.salary_scale for all to authenticated
  using (public.my_org_level() >= 4) with check (public.my_org_level() >= 4);

revoke all on public.departments, public.org_staff, public.org_staff_pay, public.salary_scale from anon;
grant select, insert, update, delete on public.departments, public.org_staff, public.org_staff_pay, public.salary_scale to authenticated;
revoke execute on function public.my_org_level(), public.can_see_org(), public.is_duty(text) from public, anon;
grant execute on function public.my_org_level(), public.can_see_org(), public.is_duty(text) to authenticated;

-- 2) Số liệu theo file kế hoạch -----------------------------------------
insert into public.salary_scale(level, rank, base_salary) values
  (1,1,8500000),(1,2,10500000),(1,3,13000000),
  (2,1,17000000),(2,2,21000000),(2,3,26000000),
  (3,1,30000000),(3,2,37000000),(3,3,45000000),
  (4,1,50000000),(4,2,60000000),(4,3,70000000);

insert into public.departments(code, name, sort) values
  ('BGD','Ban Giám đốc',0), ('PL','Phòng Pháp lý',1), ('DTXD','Phòng Đầu tư & Xây dựng',2),
  ('KD','Phòng Kinh doanh',3), ('MKT','Phòng Marketing',4), ('HCKT','Phòng HC – QT – NS – Kế toán',5);

do $$
declare
  d_bgd uuid; d_pl uuid; d_dt uuid; d_kd uuid; d_mkt uuid; d_hc uuid;
  s_duong uuid; s_tri uuid; pid uuid;
begin
  select id into d_bgd from public.departments where code='BGD';
  select id into d_pl  from public.departments where code='PL';
  select id into d_dt  from public.departments where code='DTXD';
  select id into d_kd  from public.departments where code='KD';
  select id into d_mkt from public.departments where code='MKT';
  select id into d_hc  from public.departments where code='HCKT';

  insert into public.org_staff(department_id, position, person_name, status, sort)
    values (d_bgd, 'Giám đốc / Chủ doanh nghiệp', 'Chủ doanh nghiệp', 'co', 0);

  select id into pid from public.profiles where full_name = 'Mrs Dương' limit 1;
  insert into public.org_staff(department_id, position, level, rank, person_name, profile_id, duty, sort)
    values (d_bgd, 'Phó Giám đốc (kiêm Trưởng phòng Pháp lý, Đầu tư & Xây dựng)', 4, 2, 'Mrs Dương', pid, 'giam_doc', 1)
    returning id into s_duong;
  select id into pid from public.profiles where full_name = 'Cấn Toàn Trí' limit 1;
  insert into public.org_staff(department_id, position, level, rank, person_name, profile_id, sort)
    values (d_bgd, 'Phó Giám đốc (kiêm Trưởng phòng Kinh doanh, Marketing, HC – Kế toán)', 4, 2, 'Mr Trí', pid, 2)
    returning id into s_tri;

  update public.departments set head_staff_id = s_duong where id in (d_pl, d_dt);
  update public.departments set head_staff_id = s_tri   where id in (d_kd, d_mkt, d_hc);

  -- Pháp lý
  insert into public.org_staff(department_id, position, level, rank, person_name, sort) values
    (d_pl, 'Chuyên viên pháp lý', 1, 2, 'Trinh', 1),
    (d_pl, 'Kỹ sư hồ sơ xây dựng (pháp lý)', 1, 1, 'Hiệp', 2);
  -- Đầu tư & Xây dựng
  insert into public.org_staff(department_id, team, position, level, rank, person_name, status, hire_note, sort) values
    (d_dt, 'Đầu tư',   'Nhân viên thẩm định & quản lý đầu tư', 1, null, null, 'tuyen', 'Cần có người T5/2027', 1),
    (d_dt, 'Xây dựng', 'Nhân viên mua hàng (Xây dựng)', 1, 1, 'Đào', 'co', null, 2),
    (d_dt, 'Xây dựng', 'Admin xây dựng', 1, null, null, 'co', 'Đã có người, bổ sung tên', 3),
    (d_dt, 'Xây dựng', 'Kỹ sư xây dựng – giám sát đội thi công thuê ngoài', 1, null, null, 'tuyen', 'Cần có người T1/2027', 4),
    (d_dt, 'Xây dựng', 'Đội thi công thuê ngoài (khoán 15–20% giá trị thi công)', null, null, null, 'thue_ngoai', null, 5);
  -- Kinh doanh
  insert into public.org_staff(department_id, team, position, level, rank, person_name, status, hire_note, is_leader, sort) values
    (d_kd, 'KD pháp lý',   'Nhân viên KD pháp lý (Sales B2B)', 1, null, null, 'tuyen', 'Cần có người T3/2027', false, 1),
    (d_kd, 'KD xây dựng',  'Nhân viên KD xây dựng', 1, null, null, 'tuyen', 'Cần có người T3/2027', false, 2),
    (d_kd, 'KD tòa nhà',   'Trưởng nhóm KD tòa nhà (Lead Sale)', 2, null, null, 'tuyen', 'Đang tuyển, cần có người T12/2026', true, 3);
  select id into pid from public.profiles where full_name = 'Thi' limit 1;
  insert into public.org_staff(department_id, team, position, level, rank, person_name, profile_id, sort)
    values (d_kd, 'KD tòa nhà', 'Nhân viên KD tòa nhà – quản lý phòng cho thuê', 1, 1, 'Thi', pid, 4);
  select id into pid from public.profiles where full_name = 'Vy' limit 1;
  insert into public.org_staff(department_id, team, position, level, rank, person_name, profile_id, sort)
    values (d_kd, 'KD tòa nhà', 'Nhân viên KD tòa nhà – quản lý phòng cho thuê', 1, 1, 'Vy', pid, 5);
  -- Marketing
  insert into public.org_staff(department_id, position, level, status, hire_note, sort)
    values (d_mkt, 'Nhân viên Marketing', 1, 'tuyen', 'Cần có người T3/2027', 1);
  -- HC – QT – NS – Kế toán
  insert into public.org_staff(department_id, team, position, level, rank, person_name, duty, sort) values
    (d_hc, 'Hành chính', 'Hành chính – Nhân sự', 1, 1, 'Trân', 'nhan_su', 1),
    (d_hc, 'Kế toán',    'Kế toán', 1, 3, 'Đào lớn', 'ke_toan', 5);
  insert into public.org_staff(department_id, team, position, level, status, hire_note, sort) values
    (d_hc, 'Hành chính', 'Nhân viên bảo trì', 1, 'co', 'Đã có người, bổ sung tên', 2),
    (d_hc, 'Hành chính', 'Nhân viên tạp vụ', 1, 'co', 'Đã có người, bổ sung tên', 3),
    (d_hc, 'Hành chính', 'Tài xế', 1, 'co', 'Đã có người, bổ sung tên', 4);
end $$;

-- Lương hiện tại theo bảng 5 của file kế hoạch (Phó Giám đốc: theo thỏa thuận riêng, không đưa vào)
insert into public.org_staff_pay(staff_id, base_salary)
select s.id, v.pay from (values ('Trinh',10500000),('Hiệp',8500000),('Thi',8500000),('Vy',8500000),
                               ('Đào',8500000),('Trân',8500000),('Đào lớn',13000000)) v(name, pay)
join public.org_staff s on s.person_name = v.name;

-- 3) Thêm trường cho form mới -------------------------------------------
alter table public.requests
  add column if not exists handover_to   uuid references public.profiles(id) on delete set null,  -- người nhận bàn giao công việc
  add column if not exists contact_phone text,        -- số liên hệ khi vắng mặt
  add column if not exists transport     text,        -- phương tiện đi công tác
  add column if not exists settle_due    date;        -- hạn hoàn ứng (tạm ứng)

alter table public.requests drop constraint if exists req_pay_method;
alter table public.requests add constraint req_pay_method
  check (pay_method is null or pay_method in ('chuyen_khoan','tien_mat','bu_tru','khac'));

-- Số chứng từ cho cả thanh toán và tạm ứng
create or replace function public.tg_requests_doc() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if tg_op = 'INSERT' then
    if new.kind in ('thanh_toan','tam_ung') then
      if new.kind = 'thanh_toan' and (new.pay_method is null or new.pay_type is null) then
        raise exception 'Chọn hình thức thanh toán và loại thanh toán';
      end if;
      new.doc_no := to_char(now() at time zone 'Asia/Ho_Chi_Minh', 'YYMM') || lpad(nextval('public.request_doc_seq')::text, 4, '0');
      new.doc_date := (now() at time zone 'Asia/Ho_Chi_Minh')::date;
      new.currency := 'VND';
    else
      new.doc_no := null; new.doc_date := null;
    end if;
  elsif auth.uid() is not null then
    new.doc_no := old.doc_no; new.doc_date := old.doc_date;
  end if;
  return new;
end $$;

-- 4) Các bước duyệt -------------------------------------------------------
create table public.request_steps (
  id          uuid primary key default gen_random_uuid(),
  request_id  uuid not null references public.requests(id) on delete cascade,
  step_no     int  not null,
  duty        text not null check (duty in ('leader','truong_phong','nhan_su','ke_toan','giam_doc')),
  approver_id uuid references public.profiles(id) on delete set null,   -- null = bất kỳ Quản lý (ngoài người đề nghị)
  status      text not null default 'cho' check (status in ('cho','da_duyet','tu_choi','bo_qua')),
  skip_reason text,
  decided_by  uuid references public.profiles(id) on delete set null,
  decided_at  timestamptz,
  note        text,
  unique (request_id, step_no)
);
create index on public.request_steps(approver_id) where status = 'cho';

-- Ai xem được đề nghị: người tạo, Quản lý, người đứng trong chuỗi duyệt (hàm definer để tránh vòng lặp RLS)
create or replace function public.is_request_approver(p_request uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.request_steps s
                 where s.request_id = p_request and (s.approver_id = auth.uid() or s.decided_by = auth.uid()))
$$;
create or replace function public.can_see_request(p_request uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select public.app_role() is not null and exists (
    select 1 from public.requests r where r.id = p_request
      and (r.requester_id = auth.uid() or public.is_manager() or public.is_request_approver(r.id)))
$$;
-- Đề nghị còn sửa được: đang chờ duyệt và chưa có bước nào được duyệt
create or replace function public.request_editable(p_request uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.requests r where r.id = p_request and r.status = 'cho_duyet'
           and not exists (select 1 from public.request_steps s where s.request_id = r.id and s.status = 'da_duyet'))
$$;

alter table public.request_steps enable row level security;
create policy steps_select on public.request_steps for select to authenticated using (public.can_see_request(request_id));
revoke all on public.request_steps from anon;
grant select on public.request_steps to authenticated;

drop policy requests_select on public.requests;
create policy requests_select on public.requests for select to authenticated
  using (requester_id = (select auth.uid()) or public.is_manager() or public.is_request_approver(id));

-- Chuỗi duyệt theo người đề nghị và loại đề nghị
create or replace function public.approval_chain(p_requester uuid, p_kind public.request_kind)
returns table(step_no int, duty text, approver_id uuid, skip_reason text)
language plpgsql stable security definer set search_path = public as $$
declare
  me     public.org_staff;
  head_p uuid; lead_p uuid; gd uuid; ns uuid; kt uuid;
  duties text[]; d text; n int := 0; a uuid; why text; seen uuid[] := array[]::uuid[];
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

  duties := case when p_kind in ('thanh_toan','tam_ung')
                 then array['leader','truong_phong','ke_toan','giam_doc']
                 else array['leader','truong_phong','nhan_su'] end;
  foreach d in array duties loop
    n := n + 1; why := null; a := null;
    if d = 'leader' then
      a := lead_p; if a is null then why := 'Chưa có Leader'; end if;
    elsif d = 'truong_phong' then
      a := head_p;
      if a = p_requester then a := gd; end if;   -- người đề nghị là Trưởng phòng: lên cấp trên
    elsif d = 'nhan_su' then
      a := ns; if a is null then why := 'Chưa có tài khoản Nhân sự'; end if;
    elsif d = 'ke_toan' then
      a := kt;                                  -- chưa có: bất kỳ Quản lý
    else
      a := gd;
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
revoke execute on function public.approval_chain(uuid, public.request_kind) from public, anon, authenticated;

-- Xem trước chuỗi duyệt khi lập form (chỉ cho chính mình)
create or replace function public.approval_preview(p_kind public.request_kind)
returns table(step_no int, duty text, approver_id uuid, approver_name text, skip_reason text)
language sql stable security definer set search_path = public as $$
  select c.step_no, c.duty, c.approver_id, pr.full_name, c.skip_reason
  from public.approval_chain(auth.uid(), p_kind) c left join public.profiles pr on pr.id = c.approver_id
  order by c.step_no
$$;
revoke execute on function public.approval_preview(public.request_kind) from public, anon;
grant execute on function public.approval_preview(public.request_kind) to authenticated;

-- Báo người đang đến lượt duyệt
create or replace function public.notify_step(p_request uuid, p_step public.request_steps, p_title text) returns void
language plpgsql security definer set search_path = public as $$
declare r public.requests; who text; m record; body text;
begin
  select * into r from public.requests where id = p_request;
  select full_name into who from public.profiles where id = r.requester_id;
  body := coalesce(who, '?') || ': ' || public.request_label(r.kind, r.sub_type)
    || case when r.kind in ('thanh_toan','tam_ung') then ' · ' || replace(to_char(r.amount, 'FM999,999,999,999'), ',', '.') || ' đ' else '' end;
  if p_step.approver_id is not null then
    perform public.notify(p_step.approver_id, 'khac', p_title, body, 'request', p_request);
  else
    for m in select id from public.profiles where role = 'quan_ly' and is_active and id <> r.requester_id loop
      perform public.notify(m.id, 'khac', p_title, body, 'request', p_request);
    end loop;
  end if;
end $$;
revoke execute on function public.notify_step(uuid, public.request_steps, text) from public, anon, authenticated;

-- Tạo các bước khi có đề nghị mới
create or replace function public.build_steps(p_request uuid) returns void
language plpgsql security definer set search_path = public as $$
declare r public.requests; s public.request_steps;
begin
  select * into r from public.requests where id = p_request;
  insert into public.request_steps(request_id, step_no, duty, approver_id, status, skip_reason)
  select p_request, c.step_no, c.duty, c.approver_id, case when c.skip_reason is null then 'cho' else 'bo_qua' end, c.skip_reason
  from public.approval_chain(r.requester_id, r.kind) c;

  select * into s from public.request_steps where request_id = p_request and status = 'cho' order by step_no limit 1;
  if not found then
    -- Không có cấp nào phải duyệt (VD: Giám đốc tự đề nghị): duyệt luôn
    perform set_config('app.step_flow', 'on', true);
    update public.requests set status = 'da_duyet', decision_note = 'Tự động duyệt: không có cấp trên cần duyệt' where id = p_request;
    perform set_config('app.step_flow', 'off', true);
  else
    perform public.notify_step(p_request, s, 'Đề nghị mới cần duyệt');
  end if;
end $$;
revoke execute on function public.build_steps(uuid) from public, anon, authenticated;

create or replace function public.tg_requests_steps() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  perform public.build_steps(new.id);
  return null;
end $$;
create trigger requests_steps after insert on public.requests
  for each row execute function public.tg_requests_steps();
revoke execute on function public.tg_requests_steps() from public, anon, authenticated;

-- Duyệt / từ chối bước hiện tại
create or replace function public.decide_step(p_request uuid, p_approve boolean, p_note text default null) returns void
language plpgsql security definer set search_path = public as $$
declare me uuid := auth.uid(); r public.requests; s public.request_steps; nxt public.request_steps;
  v_note text := nullif(trim(coalesce(p_note, '')), '');
begin
  if me is null or public.app_role() is null then raise exception 'Cần đăng nhập'; end if;
  select * into r from public.requests where id = p_request for update;
  if not found then raise exception 'Không tìm thấy đề nghị'; end if;
  if r.status <> 'cho_duyet' then raise exception 'Đề nghị không còn chờ duyệt'; end if;
  if r.requester_id = me then raise exception 'Không tự duyệt đề nghị của mình'; end if;
  select * into s from public.request_steps where request_id = p_request and status = 'cho' order by step_no limit 1;
  if not found then raise exception 'Đề nghị không có bước nào chờ duyệt'; end if;
  if not (s.approver_id = me or (s.approver_id is null and public.is_manager())) then
    raise exception 'Chưa đến lượt bạn duyệt đề nghị này';
  end if;
  if not p_approve and v_note is null then raise exception 'Cần ghi lý do từ chối'; end if;

  update public.request_steps set status = case when p_approve then 'da_duyet' else 'tu_choi' end,
         decided_by = me, decided_at = now(), note = v_note
   where id = s.id;

  if not p_approve then
    update public.request_steps set status = 'bo_qua', skip_reason = 'Đề nghị bị từ chối'
     where request_id = p_request and status = 'cho';
    perform set_config('app.step_flow', 'on', true);
    update public.requests set status = 'tu_choi', decision_note = v_note where id = p_request;
    perform set_config('app.step_flow', 'off', true);
    return;
  end if;

  -- Cùng một người đứng ở các bước sau thì chỉ duyệt một lần
  update public.request_steps set status = 'bo_qua', skip_reason = 'Đã duyệt ở bước trước'
   where request_id = p_request and status = 'cho' and approver_id = me;

  select * into nxt from public.request_steps where request_id = p_request and status = 'cho' order by step_no limit 1;
  if not found then
    perform set_config('app.step_flow', 'on', true);
    update public.requests set status = 'da_duyet', decision_note = null where id = p_request;
    perform set_config('app.step_flow', 'off', true);
  else
    perform public.notify_step(p_request, nxt, 'Đến lượt bạn duyệt');
  end if;
end $$;
revoke execute on function public.decide_step(uuid, boolean, text) from public, anon;
grant execute on function public.decide_step(uuid, boolean, text) to authenticated;

-- Đánh dấu đã chi tiền: Quản lý hoặc người giữ nhiệm vụ Kế toán
create or replace function public.mark_paid(p_request uuid) returns void
language plpgsql security definer set search_path = public as $$
declare r public.requests;
begin
  if public.app_role() is null then raise exception 'Cần đăng nhập'; end if;
  select * into r from public.requests where id = p_request for update;
  if not found then raise exception 'Không tìm thấy đề nghị'; end if;
  if r.kind not in ('thanh_toan','tam_ung') or r.status <> 'da_duyet' then raise exception 'Đề nghị này chưa thể ghi nhận chi tiền'; end if;
  if not (public.is_manager() or public.is_duty('ke_toan')) then raise exception 'Chỉ Quản lý hoặc Kế toán ghi nhận chi tiền'; end if;
  perform set_config('app.step_flow', 'on', true);
  update public.requests set status = 'hoan_tat' where id = p_request;
  perform set_config('app.step_flow', 'off', true);
end $$;
revoke execute on function public.mark_paid(uuid) from public, anon;
grant execute on function public.mark_paid(uuid) to authenticated;

-- Hàng đợi của tôi: đề nghị đang đến lượt tôi duyệt, và đề nghị đã duyệt chờ tôi chi
create or replace function public.my_approval_queue() returns table(request_id uuid, phase text)
language sql stable security definer set search_path = public as $$
  select r.id, 'duyet'::text from public.requests r
   where r.status = 'cho_duyet' and r.requester_id <> auth.uid() and public.app_role() is not null
     and exists (select 1 from (select s.* from public.request_steps s where s.request_id = r.id and s.status = 'cho'
                                order by s.step_no limit 1) cur
                 where cur.approver_id = auth.uid() or (cur.approver_id is null and public.is_manager()))
  union all
  select r.id, 'chi'::text from public.requests r
   where r.status = 'da_duyet' and r.kind in ('thanh_toan','tam_ung') and public.app_role() is not null
     and (public.is_manager() or public.is_duty('ke_toan'))
$$;
revoke execute on function public.my_approval_queue() from public, anon;
grant execute on function public.my_approval_queue() to authenticated;

-- 5) Kiểm soát cập nhật đề nghị: duyệt chỉ đi qua decide_step / mark_paid ----
create or replace function public.tg_requests_guard() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  me   uuid := auth.uid();
  mgr  boolean := public.is_manager();
  flow boolean := coalesce(current_setting('app.step_flow', true), '') = 'on';
  fixed constant text[] := array['status','approver_id','decided_at','decision_note','paid_at','paid_by',
    'actual_start','actual_end','actual_cost','actual_note','reported_at','days','updated_at','created_at'];
  actual constant text[] := array['actual_start','actual_end','actual_cost','actual_note'];
begin
  if tg_op = 'UPDATE' and me is not null then
    -- Trường hệ thống: không cho sửa tay
    new.id := old.id; new.kind := old.kind; new.requester_id := old.requester_id; new.created_at := old.created_at;
    new.approver_id := old.approver_id; new.decided_at := old.decided_at;
    new.paid_at := old.paid_at; new.paid_by := old.paid_by; new.reported_at := old.reported_at;
    if not mgr and not flow then new.decision_note := old.decision_note; end if;

    -- Nội dung đề nghị: chỉ người tạo, khi còn chờ duyệt và chưa có cấp nào duyệt
    if not flow and (to_jsonb(new) - fixed) is distinct from (to_jsonb(old) - fixed)
       and not (old.requester_id = me and public.request_editable(old.id)) then
      raise exception 'Chỉ sửa được đề nghị của mình khi chưa có cấp nào duyệt';
    end if;
    -- Thực tế công tác: người đi công tác, sau khi được duyệt
    if (select jsonb_object_agg(k, to_jsonb(new) -> k) from unnest(actual) k)
         is distinct from (select jsonb_object_agg(k, to_jsonb(old) -> k) from unnest(actual) k)
       and not (old.requester_id = me and old.kind = 'cong_tac' and old.status in ('da_duyet','hoan_tat')) then
      raise exception 'Chỉ người đi công tác nhập thực tế sau khi được duyệt';
    end if;

    if new.status is distinct from old.status then
      if new.status = 'da_huy' and old.requester_id = me
         and (old.status = 'cho_duyet'
              or (old.status = 'da_duyet' and old.kind in ('nghi_phep','ra_ngoai','cong_tac')
                  and old.start_date > (now() at time zone 'Asia/Ho_Chi_Minh')::date)) then
        null;   -- rút lại: khi chờ duyệt, hoặc đã duyệt nhưng chưa tới ngày
      elsif flow and old.status = 'cho_duyet' and new.status in ('da_duyet','tu_choi') then
        new.approver_id := me; new.decided_at := now();   -- do decide_step / build_steps đặt
      elsif flow and old.status = 'da_duyet' and new.status = 'hoan_tat' and old.kind in ('thanh_toan','tam_ung') then
        new.paid_at := now(); new.paid_by := me;          -- do mark_paid đặt
      elsif new.status = 'hoan_tat' and old.status = 'da_duyet' and old.kind = 'cong_tac' and old.requester_id = me then
        if new.actual_start is null or new.actual_end is null then
          raise exception 'Cần nhập ngày đi và ngày về thực tế';
        end if;
        new.reported_at := now();
      else
        raise exception 'Không thể chuyển đề nghị sang trạng thái này';
      end if;
    end if;
  end if;

  if tg_op = 'INSERT' then
    if me is not null then new.requester_id := me; end if;
    new.status := 'cho_duyet';
    new.approver_id := null; new.decided_at := null; new.decision_note := null;
    new.paid_at := null; new.paid_by := null; new.reported_at := null;
    new.actual_start := null; new.actual_end := null; new.actual_cost := null; new.actual_note := null;
  end if;

  -- Chuẩn hoá & tính số ngày
  if new.kind = 'nghi_phep' then
    if new.span <> 'ca_ngay' then new.end_date := new.start_date; end if;
    new.end_date := coalesce(new.end_date, new.start_date);
    -- Công ty nghỉ Chủ nhật: không tính Chủ nhật vào ngày nghỉ phép
    new.days := case when new.span = 'ca_ngay'
      then (select count(*) from generate_series(new.start_date, new.end_date, interval '1 day') d
            where extract(isodow from d) <> 7)
      else 0.5 end;
    if new.days = 0 or (new.span <> 'ca_ngay' and extract(isodow from new.start_date) = 7) then
      raise exception 'Chủ nhật công ty nghỉ, không cần xin nghỉ phép';
    end if;
    new.start_time := null; new.end_time := null; new.amount := null;
  elsif new.kind = 'ra_ngoai' then
    new.end_date := coalesce(new.end_date, new.start_date);
    new.days := new.end_date - new.start_date + 1;
    new.amount := null;
  elsif new.kind = 'cong_tac' then
    new.days := new.end_date - new.start_date + 1;
  else
    new.end_date := null; new.days := null;
  end if;
  if new.kind <> 'nghi_phep' then new.span := null; end if;
  if new.kind not in ('nghi_phep','ra_ngoai') then new.sub_type := null; end if;
  if new.kind <> 'tam_ung' then new.settle_due := null; end if;
  if new.kind not in ('nghi_phep','ra_ngoai','cong_tac') then new.handover_to := null; new.contact_phone := null; end if;
  if new.kind <> 'cong_tac' then new.transport := null; end if;
  new.updated_at := now();
  return new;
end $$;

-- 6) Thông báo: bước duyệt do notify_step lo; ở đây báo kết quả cho người đề nghị ----
create or replace function public.tg_requests_notify() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  who   text;
  label text := public.request_label(new.kind, new.sub_type);
  what  text;
  m     record;
  cur   public.request_steps;
begin
  if tg_op = 'INSERT' then return null; end if;
  select full_name into who from public.profiles where id = new.requester_id;
  what := label || case
    when new.kind in ('thanh_toan','tam_ung') then ' · ' || replace(to_char(new.amount, 'FM999,999,999,999'), ',', '.') || ' đ'
    when new.kind = 'nghi_phep' then ' · ' || case when new.days = 0.5 then 'nửa ngày' else trim(to_char(new.days, 'FM990.0')) || ' ngày' end
      || ' từ ' || to_char(new.start_date, 'DD/MM')
    else ' · ' || to_char(new.start_date, 'DD/MM') end;
  what := replace(what, '.0 ngày', ' ngày');

  if new.status is distinct from old.status then
    if new.status in ('da_duyet','tu_choi') and new.approver_id is distinct from new.requester_id then
      perform public.notify(new.requester_id, 'khac',
        case new.status when 'da_duyet' then 'Đề nghị đã được duyệt xong' else 'Đề nghị bị từ chối' end,
        what || coalesce(' — ' || nullif(trim(new.decision_note), ''), ''), 'request', new.id);
      if new.status = 'da_duyet' and new.kind in ('thanh_toan','tam_ung') then
        for m in select id from public.profiles pr where pr.is_active and pr.id <> new.requester_id
                   and (pr.role = 'quan_ly' or exists (select 1 from public.org_staff o where o.profile_id = pr.id and o.duty = 'ke_toan')) loop
          perform public.notify(m.id, 'khac', 'Đã duyệt, chờ chi tiền', coalesce(who, '?') || ': ' || what, 'request', new.id);
        end loop;
      end if;
    elsif new.status = 'hoan_tat' and new.kind = 'cong_tac' and new.approver_id is distinct from new.requester_id then
      perform public.notify(new.approver_id, 'khac', 'Đã nhập thực tế công tác', coalesce(who, '?') || ': ' || what, 'request', new.id);
    elsif new.status = 'hoan_tat' and new.kind in ('thanh_toan','tam_ung') and new.paid_by is distinct from new.requester_id then
      perform public.notify(new.requester_id, 'khac', 'Đã chi tiền', what, 'request', new.id);
    elsif new.status = 'da_huy' then
      select * into cur from public.request_steps where request_id = new.id and status = 'cho' order by step_no limit 1;
      if found then perform public.notify_step(new.id, cur, 'Đề nghị đã được rút lại'); end if;
      update public.request_steps set status = 'bo_qua', skip_reason = 'Đề nghị đã rút lại' where request_id = new.id and status = 'cho';
    end if;
  end if;
  return null;
end $$;

-- 7) Bảng chi tiết, tạm ứng, link: người trong chuỗi duyệt cũng xem được; chỉ sửa khi chưa ai duyệt ----
drop policy rl_select on public.request_lines;
drop policy rl_write  on public.request_lines;
drop policy ra_select on public.request_advances;
drop policy ra_write  on public.request_advances;
drop policy rk_select on public.request_links;
create policy rl_select on public.request_lines for select to authenticated using (public.can_see_request(request_id));
create policy rl_write on public.request_lines for all to authenticated
  using (public.request_editable(request_id) and exists (select 1 from public.requests r where r.id = request_id and r.requester_id = (select auth.uid())))
  with check (public.request_editable(request_id) and exists (select 1 from public.requests r where r.id = request_id and r.requester_id = (select auth.uid())));
create policy ra_select on public.request_advances for select to authenticated using (public.can_see_request(request_id));
create policy ra_write on public.request_advances for all to authenticated
  using (public.request_editable(request_id) and exists (select 1 from public.requests r where r.id = request_id and r.requester_id = (select auth.uid())))
  with check (public.request_editable(request_id) and exists (select 1 from public.requests r where r.id = request_id and r.requester_id = (select auth.uid())));
create policy rk_select on public.request_links for select to authenticated using (public.can_see_request(request_id));

-- Tệp đính kèm: người trong chuỗi duyệt được xem (không được tải lên / xoá)
create or replace function public.storage_path_ok(p_name text, p_write boolean) returns boolean
language plpgsql stable security definer set search_path = public as $$
declare
  parts text[] := string_to_array(coalesce(p_name, ''), '/');
  o uuid;
begin
  if public.app_role() is null or array_length(parts, 1) < 3 then return false; end if;
  begin o := parts[2]::uuid; exception when others then return false; end;
  return case parts[1]
    when 'cccd'      then public.can_manage_building(o)
    when 'hop-dong'  then case when p_write then public.can_manage_building(o) else public.can_access_building(o) end
    when 'anh-phong' then public.can_access_building(o)
    when 'de-nghi'   then exists (select 1 from public.requests r
                                  where r.id = o and (r.requester_id = auth.uid() or public.is_manager()
                                                      or (not p_write and public.is_request_approver(r.id))))
    else false end;
end $$;
revoke execute on function public.storage_path_ok(text, boolean) from public, anon;
grant execute on function public.storage_path_ok(text, boolean) to authenticated;

revoke execute on function public.is_request_approver(uuid), public.can_see_request(uuid), public.request_editable(uuid) from public, anon;
grant execute on function public.is_request_approver(uuid), public.can_see_request(uuid), public.request_editable(uuid) to authenticated;

-- 8) Đề nghị đang chờ duyệt từ trước: dựng chuỗi duyệt cho chúng
do $$ declare x uuid; begin
  for x in select id from public.requests r where r.status = 'cho_duyet' and not exists (select 1 from public.request_steps s where s.request_id = r.id) loop
    perform public.build_steps(x);
  end loop;
end $$;
