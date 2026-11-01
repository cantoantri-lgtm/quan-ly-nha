-- =====================================================================
--  QUẢN LÝ NHÀ CHO THUÊ & GIAO VIỆC — Supabase schema v2
--  Vai trò: quan_ly (thấy tất cả) · giam_sat (theo toà được gán) · nhan_vien
--  Đăng nhập bằng SĐT + mật khẩu do quản lý cấp.
--  Nhân viên chỉ đánh dấu đã thu / chưa thu (không ghi chứng từ).
-- =====================================================================

-- ---------- 1. KIỂU DỮ LIỆU ----------
create type public.user_role       as enum ('quan_ly','giam_sat','nhan_vien');
create type public.building_kind   as enum ('khach_san','can_ho','hon_hop');
create type public.rent_mode       as enum ('thang','dem');
create type public.room_status     as enum ('trong','dang_o','dang_sua','giu_cho');
create type public.contract_status as enum ('hieu_luc','da_ket_thuc','da_huy');
create type public.deposit_status  as enum ('chua_thu','da_thu','da_hoan');
create type public.invoice_status  as enum ('chua_thu','da_thu','huy');
create type public.task_status     as enum ('chua_lam','dang_lam','vuong','xong');
create type public.task_priority   as enum ('thap','binh_thuong','cao','gap');
create type public.notif_type      as enum ('giao_viec','nhac_viec','tre_han','cap_nhat_viec',
                                            'nhac_thu_tien','hop_dong_sap_het','khac');

-- ---------- 2. BẢNG ----------
-- Nhân sự (1-1 với tài khoản đăng nhập)
create table public.profiles (
  id          uuid primary key references auth.users(id) on delete cascade,
  full_name   text not null,
  phone       text unique,                        -- số điện thoại đăng nhập
  role        public.user_role not null default 'nhan_vien',
  is_active   boolean not null default true,
  created_at  timestamptz not null default now()
);

-- Toà nhà
create table public.buildings (
  id           uuid primary key default gen_random_uuid(),
  code         text not null unique,              -- VD: 89CMT8
  name         text not null,
  address      text,
  kind         public.building_kind not null default 'hon_hop',
  total_floors int,
  note         text,
  created_at   timestamptz not null default now()
);

-- Ai làm ở toà nào (giám sát / nhân viên chỉ thấy toà của mình)
create table public.building_members (
  building_id uuid not null references public.buildings(id) on delete cascade,
  user_id     uuid not null references public.profiles(id)  on delete cascade,
  primary key (building_id, user_id)
);

-- Phòng
create table public.rooms (
  id            uuid primary key default gen_random_uuid(),
  building_id   uuid not null references public.buildings(id) on delete cascade,
  code          text not null,                    -- VD: 301
  floor         int,
  room_type     text,                             -- VD: Studio, 1PN, Deluxe
  rent_mode     public.rent_mode not null default 'thang',
  list_price    numeric(14,0),                    -- giá niêm yết (tháng hoặc đêm)
  max_occupants int,
  status        public.room_status not null default 'trong',
  note          text,
  created_at    timestamptz not null default now(),
  unique (building_id, code)
);

-- Khách thuê
create table public.tenants (
  id            uuid primary key default gen_random_uuid(),
  building_id   uuid not null references public.buildings(id),
  full_name     text not null,
  phone         text,
  id_number     text,                             -- CCCD
  date_of_birth date,
  hometown      text,
  note          text,
  created_by    uuid references public.profiles(id) default auth.uid(),
  created_at    timestamptz not null default now()
);

-- Hợp đồng thuê tháng
create table public.contracts (
  id             uuid primary key default gen_random_uuid(),
  code           text,                            -- số hợp đồng
  room_id        uuid not null references public.rooms(id),
  building_id    uuid not null references public.buildings(id),  -- tự điền từ phòng
  tenant_id      uuid not null references public.tenants(id),    -- người đứng tên
  start_date     date not null,
  end_date       date,
  rent_amount    numeric(14,0) not null check (rent_amount >= 0),
  deposit_amount numeric(14,0) not null default 0 check (deposit_amount >= 0),
  deposit_status public.deposit_status not null default 'chua_thu',
  billing_day    smallint not null default 5 check (billing_day between 1 and 28),
  status         public.contract_status not null default 'hieu_luc',
  note           text,
  created_by     uuid references public.profiles(id) default auth.uid(),
  created_at     timestamptz not null default now(),
  check (end_date is null or end_date >= start_date)
);
create unique index contracts_one_active_per_room on public.contracts(room_id) where status = 'hieu_luc';

-- Người ở cùng trong hợp đồng (để đếm số người đang trọ)
create table public.contract_occupants (
  id          uuid primary key default gen_random_uuid(),
  contract_id uuid not null references public.contracts(id) on delete cascade,
  tenant_id   uuid not null references public.tenants(id),
  move_in     date not null default current_date,
  move_out    date,
  unique (contract_id, tenant_id)
);

-- Hoá đơn tiền phòng hằng tháng (nhân viên chỉ đánh dấu đã thu / chưa thu)
create table public.invoices (
  id           uuid primary key default gen_random_uuid(),
  contract_id  uuid not null references public.contracts(id) on delete cascade,
  building_id  uuid not null references public.buildings(id),
  period       date not null check (extract(day from period) = 1),  -- ngày 1 của tháng
  amount       numeric(14,0) not null default 0 check (amount >= 0),
  due_date     date not null,
  status       public.invoice_status not null default 'chua_thu',
  collected_at date,                              -- ngày đánh dấu đã thu
  collected_by uuid references public.profiles(id),
  note         text,
  created_at   timestamptz not null default now(),
  unique (contract_id, period)
);

-- Doanh thu thuê theo đêm (chỉ ghi nhận)
create table public.nightly_revenues (
  id           uuid primary key default gen_random_uuid(),
  building_id  uuid not null references public.buildings(id),
  room_id      uuid references public.rooms(id),
  revenue_date date not null default current_date,  -- ngày nhận phòng
  nights       int not null default 1 check (nights > 0),
  guests       int check (guests > 0),
  source       text,                                -- Booking, Agoda, khách lẻ...
  amount       numeric(14,0) not null check (amount >= 0),
  note         text,
  created_by   uuid references public.profiles(id) default auth.uid(),
  created_at   timestamptz not null default now()
);

-- Công việc (parent_id = null là việc chính, có parent_id là bước con)
create table public.tasks (
  id           uuid primary key default gen_random_uuid(),
  parent_id    uuid references public.tasks(id) on delete cascade,
  building_id  uuid references public.buildings(id),
  title        text not null,
  description  text,
  assignee_id  uuid references public.profiles(id),
  created_by   uuid references public.profiles(id) default auth.uid(),
  due_date     date,
  priority     public.task_priority not null default 'binh_thuong',
  status       public.task_status not null default 'chua_lam',
  sort_order   int not null default 0,
  completed_at timestamptz,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);

-- Cập nhật tiến độ hằng ngày của công việc
create table public.task_updates (
  id           uuid primary key default gen_random_uuid(),
  task_id      uuid not null references public.tasks(id) on delete cascade,
  author_id    uuid not null references public.profiles(id) default auth.uid(),
  note         text not null,
  status_after public.task_status,
  created_at   timestamptz not null default now()
);

-- Thông báo trong app
create table public.notifications (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references public.profiles(id) on delete cascade,
  type        public.notif_type not null,
  title       text not null,
  body        text,
  entity_type text,                               -- task / invoice / contract / building
  entity_id   uuid,
  dedupe_key  text unique,                        -- chống gửi trùng nhắc nhở trong ngày
  read_at     timestamptz,
  created_at  timestamptz not null default now()
);

-- ---------- 3. CHỈ MỤC ----------
create index on public.building_members(user_id);
create index on public.rooms(building_id, status);
create index on public.tenants(building_id);
create index on public.contracts(building_id, status);
create index on public.contracts(tenant_id);
create index on public.contract_occupants(contract_id) where move_out is null;
create index on public.contract_occupants(tenant_id);
create index on public.invoices(building_id, period);
create index on public.invoices(status, due_date);
create index on public.invoices(collected_by);
create index on public.nightly_revenues(building_id, revenue_date);
create index on public.nightly_revenues(room_id);
create index on public.tasks(assignee_id, status);
create index on public.tasks(created_by);
create index on public.tasks(parent_id);
create index on public.tasks(building_id);
create index on public.tasks(due_date) where status <> 'xong';
create index on public.task_updates(task_id, created_at);
create index on public.task_updates(author_id);
create index on public.notifications(user_id, read_at, created_at desc);
create index on public.tenants(created_by);
create index on public.contracts(created_by);
create index on public.nightly_revenues(created_by);

-- ---------- 4. HÀM PHÂN QUYỀN ----------
create or replace function public.app_role() returns public.user_role
language sql stable security definer set search_path = public as $$
  select role from public.profiles where id = auth.uid() and is_active
$$;

create or replace function public.role_rank(r public.user_role) returns int
language sql immutable set search_path = public as $$
  select case r when 'quan_ly' then 3 when 'giam_sat' then 2 else 1 end
$$;

create or replace function public.is_manager() returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce(public.app_role() = 'quan_ly', false)
$$;

create or replace function public.can_access_building(b uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select public.is_manager()
      or (public.app_role() is not null and exists (
            select 1 from public.building_members m
            where m.building_id = b and m.user_id = auth.uid()))
$$;

-- quản lý, hoặc giám sát của toà
create or replace function public.can_manage_building(b uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select public.is_manager()
      or (public.app_role() = 'giam_sat' and public.can_access_building(b))
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
      or (public.app_role() = 'giam_sat' and coalesce(x.building_id, p.building_id) is not null
          and public.can_access_building(coalesce(x.building_id, p.building_id)))))
$$;

-- ---------- 5. TRIGGER NGHIỆP VỤ ----------
-- Tự tạo hồ sơ nhân sự khi tạo tài khoản
create or replace function public.handle_new_user() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  insert into public.profiles (id, full_name, phone, role)
  values (new.id,
          coalesce(nullif(new.raw_user_meta_data->>'full_name',''), split_part(new.email,'@',1)),
          nullif(new.raw_user_meta_data->>'phone',''),
          coalesce((new.raw_app_meta_data->>'role')::public.user_role, 'nhan_vien'))
  on conflict (id) do nothing;
  return new;
end $$;
create trigger on_auth_user_created after insert on auth.users
  for each row execute function public.handle_new_user();

-- Chỉ quản lý được đổi vai trò / khoá tài khoản / đổi SĐT đăng nhập
create or replace function public.tg_profiles_guard() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is not null and not public.is_manager()
     and (new.role is distinct from old.role or new.is_active is distinct from old.is_active
          or new.phone is distinct from old.phone) then
    raise exception 'Chỉ quản lý được đổi vai trò, số điện thoại hoặc khoá tài khoản';
  end if;
  return new;
end $$;
create trigger profiles_guard before update on public.profiles
  for each row execute function public.tg_profiles_guard();

-- Gửi thông báo (chỉ gọi nội bộ từ trigger / lịch nhắc)
create or replace function public.notify(p_user uuid, p_type public.notif_type, p_title text,
  p_body text, p_entity_type text, p_entity_id uuid, p_key text default null) returns void
language sql security definer set search_path = public as $$
  insert into public.notifications (user_id, type, title, body, entity_type, entity_id, dedupe_key)
  select p_user, p_type, p_title, p_body, p_entity_type, p_entity_id, p_key
  where p_user is not null
  on conflict (dedupe_key) do nothing
$$;

-- Hợp đồng: điền toà từ phòng
create or replace function public.tg_contracts_before() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if tg_op = 'UPDATE' and auth.uid() is not null and not public.can_manage_building(old.building_id) then
    -- nhân viên: chỉ được đánh dấu đã thu cọc
    if (to_jsonb(new) - 'deposit_status') is distinct from (to_jsonb(old) - 'deposit_status')
       or not (old.deposit_status = 'chua_thu' and new.deposit_status in ('chua_thu','da_thu')) then
      raise exception 'Nhân viên chỉ được đánh dấu đã thu cọc. Cần sửa hợp đồng thì báo giám sát.';
    end if;
    return new;
  end if;
  select building_id into new.building_id from public.rooms where id = new.room_id;
  return new;
end $$;
create trigger contracts_before before insert or update on public.contracts
  for each row execute function public.tg_contracts_before();

-- Hợp đồng: thêm người đứng tên vào danh sách ở, đồng bộ trạng thái phòng
create or replace function public.tg_contracts_after() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if tg_op = 'INSERT' then
    insert into public.contract_occupants (contract_id, tenant_id, move_in)
    values (new.id, new.tenant_id, new.start_date) on conflict do nothing;
  end if;
  if new.status = 'hieu_luc' then
    update public.rooms set status = 'dang_o' where id = new.room_id and status <> 'dang_o';
  elsif tg_op = 'UPDATE' and old.status = 'hieu_luc' then
    update public.contract_occupants set move_out = coalesce(new.end_date, current_date)
      where contract_id = new.id and move_out is null;
    update public.rooms set status = 'trong' where id = new.room_id;
  end if;
  return null;
end $$;
create trigger contracts_after after insert or update of status on public.contracts
  for each row execute function public.tg_contracts_after();

-- Hoá đơn: điền toà, hạn thu (mặc định ngày 5); ghi ai/khi nào đánh dấu đã thu;
-- nhân viên chỉ được chuyển "chưa thu" → "đã thu"
create or replace function public.tg_invoices_before() returns trigger
language plpgsql security definer set search_path = public as $$
declare c public.contracts;
begin
  if tg_op = 'UPDATE' and auth.uid() is not null and not public.can_manage_building(old.building_id) then
    if new.amount is distinct from old.amount or new.due_date is distinct from old.due_date
       or new.contract_id is distinct from old.contract_id or new.period is distinct from old.period
       or old.status <> 'chua_thu' or new.status not in ('chua_thu','da_thu') then
      raise exception 'Nhân viên chỉ được đánh dấu hoá đơn đã thu. Cần sửa thì báo giám sát.';
    end if;
  end if;

  if tg_op = 'INSERT' or new.contract_id is distinct from old.contract_id or new.period is distinct from old.period then
    select * into c from public.contracts where id = new.contract_id;
    new.building_id := c.building_id;
    new.period := date_trunc('month', new.period)::date;
    if new.due_date is null then new.due_date := new.period + (c.billing_day - 1); end if;
  end if;

  if new.status = 'da_thu' and (tg_op = 'INSERT' or old.status <> 'da_thu') then
    new.collected_at := coalesce(new.collected_at, (now() at time zone 'Asia/Ho_Chi_Minh')::date);
    new.collected_by := coalesce(auth.uid(), new.collected_by);
  elsif new.status <> 'da_thu' then
    new.collected_at := null; new.collected_by := null;
  end if;
  return new;
end $$;
create trigger invoices_before before insert or update on public.invoices
  for each row execute function public.tg_invoices_before();

-- Công việc: chỉ giao cho cấp dưới; nhân viên chỉ được đổi trạng thái việc được giao
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
    new.building_id := coalesce(new.building_id, p.building_id);
    new.assignee_id := coalesce(new.assignee_id, p.assignee_id);
  end if;

  if new.status = 'xong' and (tg_op = 'INSERT' or old.status <> 'xong') then
    new.completed_at := now();
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
            or (my_role = 'giam_sat' and old.building_id is not null
                and public.can_access_building(old.building_id))) then
      if new.title is distinct from old.title or new.description is distinct from old.description
         or new.assignee_id is distinct from old.assignee_id or new.due_date is distinct from old.due_date
         or new.building_id is distinct from old.building_id or new.parent_id is distinct from old.parent_id
         or new.priority is distinct from old.priority then
        raise exception 'Bạn chỉ được cập nhật trạng thái của việc được giao';
      end if;
    end if;
  end if;

  if new.assignee_id is not null and new.assignee_id <> me
     and (tg_op = 'INSERT' or new.assignee_id is distinct from old.assignee_id)
     and not (new.parent_id is not null and new.assignee_id = p.assignee_id) then
    select role into a_role from public.profiles where id = new.assignee_id;
    if public.role_rank(a_role) >= public.role_rank(my_role) then
      raise exception 'Chỉ được giao việc cho cấp dưới';
    end if;
  end if;
  return new;
end $$;
create trigger tasks_guard before insert or update on public.tasks
  for each row execute function public.tg_tasks_guard();

create or replace function public.tg_tasks_notify() returns trigger
language plpgsql security definer set search_path = public as $$
declare actor uuid := auth.uid();
begin
  if new.parent_id is not null then return null; end if;   -- bước con: không báo
  if new.assignee_id is not null and new.assignee_id is distinct from new.created_by
     and (tg_op = 'INSERT' or new.assignee_id is distinct from old.assignee_id) then
    perform public.notify(new.assignee_id, 'giao_viec', 'Bạn được giao việc mới',
      new.title || coalesce(' — hạn ' || to_char(new.due_date, 'DD/MM'), ''), 'task', new.id);
  end if;
  if tg_op = 'UPDATE' and new.status is distinct from old.status
     and actor = new.assignee_id and new.created_by <> actor then
    perform public.notify(new.created_by, 'cap_nhat_viec',
      case new.status when 'xong' then 'Việc đã hoàn thành' when 'vuong' then 'Việc đang vướng'
                      else 'Việc được cập nhật trạng thái' end,
      new.title, 'task', new.id);
  end if;
  return null;
end $$;
create trigger tasks_notify after insert or update on public.tasks
  for each row execute function public.tg_tasks_notify();

create or replace function public.tg_task_updates_after() returns trigger
language plpgsql security definer set search_path = public as $$
declare t public.tasks; target uuid;
begin
  select * into t from public.tasks where id = new.task_id;
  if t.parent_id is not null then select * into t from public.tasks where id = t.parent_id; end if;
  target := case when new.author_id = t.assignee_id then t.created_by else t.assignee_id end;
  if target is not null and target <> new.author_id then
    perform public.notify(target, 'cap_nhat_viec', 'Cập nhật tiến độ: ' || t.title,
                          left(new.note, 200), 'task', t.id);
  end if;
  if new.status_after is not null then
    update public.tasks set status = new.status_after where id = new.task_id;
  end if;
  return null;
end $$;
create trigger task_updates_after after insert on public.task_updates
  for each row execute function public.tg_task_updates_after();

-- ---------- 6. LỊCH NHẮC & TẠO HOÁ ĐƠN ----------
-- Nhắc việc + nhắc thu tiền + hợp đồng sắp hết hạn (chạy mỗi sáng 7h)
create or replace function public.run_daily_reminders() returns void
language plpgsql security definer set search_path = public as $$
declare d date := (now() at time zone 'Asia/Ho_Chi_Minh')::date;
begin
  -- Việc đến hạn ngày mai / hôm nay
  insert into public.notifications (user_id, type, title, body, entity_type, entity_id, dedupe_key)
  select t.assignee_id, 'nhac_viec',
         case when t.due_date = d then 'Hạn hôm nay' else 'Hạn ngày mai' end,
         t.title, 'task', coalesce(t.parent_id, t.id), 'nhac:' || t.id || ':' || d
  from public.tasks t
  where t.status <> 'xong' and t.assignee_id is not null and t.due_date in (d, d + 1)
  on conflict (dedupe_key) do nothing;

  -- Việc trễ hạn: báo người làm và người giao
  insert into public.notifications (user_id, type, title, body, entity_type, entity_id, dedupe_key)
  select distinct u.uid, 'tre_han'::public.notif_type, 'Việc trễ hạn ' || (d - t.due_date) || ' ngày', t.title,
         'task', t.id, 'tre:' || t.id || ':' || u.uid || ':' || d
  from public.tasks t
  cross join lateral (values (t.assignee_id), (t.created_by)) u(uid)
  where t.status <> 'xong' and t.due_date < d and t.parent_id is null and u.uid is not null
  on conflict (dedupe_key) do nothing;

  -- Nhắc thu tiền: gửi giám sát của toà 1 tin tổng hợp / ngày
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

  -- Hợp đồng hết hạn: nhắc trước 30, 7 và 1 ngày
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

-- Tạo hoá đơn tiền phòng cho tháng (chạy ngày 1 hằng tháng; chạy lại không bị trùng)
create or replace function public.generate_monthly_invoices(p_period date default null) returns int
language plpgsql security definer set search_path = public as $$
declare
  per date := date_trunc('month', coalesce(p_period, (now() at time zone 'Asia/Ho_Chi_Minh')::date))::date;
  n int;
begin
  if auth.uid() is not null and not public.is_manager() then
    raise exception 'Chỉ quản lý được tạo hoá đơn hằng loạt';
  end if;
  insert into public.invoices (contract_id, building_id, period, amount, due_date)
  select c.id, c.building_id, per, c.rent_amount, per + (c.billing_day - 1)
  from public.contracts c
  where c.status = 'hieu_luc'
    and c.start_date < per + interval '1 month'
    and (c.end_date is null or c.end_date >= per)
  on conflict (contract_id, period) do nothing;
  get diagnostics n = row_count;
  return n;
end $$;

-- ---------- 7. SỐ LIỆU TỔNG QUAN THEO THÁNG ----------
-- Doanh số = tiền phòng theo hoá đơn tháng + doanh thu thuê đêm trong tháng
-- Đã thu   = hoá đơn được đánh dấu đã thu trong tháng (không tính cọc)
-- Còn nợ   = hoá đơn chưa thu từ tháng này trở về trước
create or replace function public.dashboard_month(p_month date default null)
returns table (building_id uuid, building_code text, building_name text,
               total_rooms bigint, occupied_rooms bigint, occupants bigint,
               revenue_monthly numeric, revenue_nightly numeric, revenue_total numeric,
               collected numeric, outstanding numeric, unpaid_invoices bigint)
language sql stable security invoker set search_path = public as $$
  with m as (select date_trunc('month', coalesce(p_month, (now() at time zone 'Asia/Ho_Chi_Minh')::date))::date as s),
  x as (
    select b.id, b.code, b.name,
      (select count(*) from public.rooms r where r.building_id = b.id) as total_rooms,
      (select count(*) from public.rooms r where r.building_id = b.id and r.status = 'dang_o') as occupied_rooms,
      (select count(*) from public.contract_occupants o join public.contracts c on c.id = o.contract_id
        where c.building_id = b.id and c.status = 'hieu_luc' and o.move_out is null) as occupants,
      coalesce((select sum(i.amount) from public.invoices i
        where i.building_id = b.id and i.period = m.s and i.status <> 'huy'), 0) as rev_m,
      coalesce((select sum(n.amount) from public.nightly_revenues n
        where n.building_id = b.id and n.revenue_date >= m.s and n.revenue_date < m.s + interval '1 month'), 0) as rev_n,
      coalesce((select sum(i.amount) from public.invoices i
        where i.building_id = b.id and i.status = 'da_thu'
          and i.collected_at >= m.s and i.collected_at < m.s + interval '1 month'), 0) as collected,
      coalesce((select sum(i.amount) from public.invoices i
        where i.building_id = b.id and i.period <= m.s and i.status = 'chua_thu'), 0) as outstanding,
      (select count(*) from public.invoices i
        where i.building_id = b.id and i.period <= m.s and i.status = 'chua_thu') as unpaid
    from public.buildings b, m
  )
  select id, code, name, total_rooms, occupied_rooms, occupants, rev_m, rev_n, rev_m + rev_n,
         collected, outstanding, unpaid
  from x order by code
$$;

-- ---------- 8. BẢO MẬT DÒNG (RLS) ----------
alter table public.profiles           enable row level security;
alter table public.buildings          enable row level security;
alter table public.building_members   enable row level security;
alter table public.rooms              enable row level security;
alter table public.tenants            enable row level security;
alter table public.contracts          enable row level security;
alter table public.contract_occupants enable row level security;
alter table public.invoices           enable row level security;
alter table public.nightly_revenues   enable row level security;
alter table public.tasks              enable row level security;
alter table public.task_updates       enable row level security;
alter table public.notifications      enable row level security;

-- Nhân sự: người đang hoạt động xem được danh bạ; tự sửa tên mình; quản lý sửa tất cả
create policy profiles_select on public.profiles for select to authenticated
  using (public.app_role() is not null);
create policy profiles_update on public.profiles for update to authenticated
  using (id = (select auth.uid()) or public.is_manager())
  with check (id = (select auth.uid()) or public.is_manager());

-- Toà nhà & thành viên: quản lý tạo/sửa; người được gán thì xem
create policy buildings_select on public.buildings for select to authenticated using (public.can_access_building(id));
create policy buildings_insert on public.buildings for insert to authenticated with check (public.is_manager());
create policy buildings_update on public.buildings for update to authenticated
  using (public.is_manager()) with check (public.is_manager());
create policy buildings_delete on public.buildings for delete to authenticated using (public.is_manager());

create policy members_select on public.building_members for select to authenticated
  using (user_id = (select auth.uid()) or public.can_manage_building(building_id));
create policy members_insert on public.building_members for insert to authenticated with check (public.is_manager());
create policy members_delete on public.building_members for delete to authenticated using (public.is_manager());

-- Phòng: thành viên toà xem và đổi trạng thái; quản lý/giám sát thêm, xoá
create policy rooms_select on public.rooms for select to authenticated using (public.can_access_building(building_id));
create policy rooms_update on public.rooms for update to authenticated
  using (public.can_access_building(building_id)) with check (public.can_access_building(building_id));
create policy rooms_insert on public.rooms for insert to authenticated with check (public.can_manage_building(building_id));
create policy rooms_delete on public.rooms for delete to authenticated using (public.can_manage_building(building_id));

-- Khách thuê, hợp đồng, người ở, hoá đơn: thành viên toà xem; quản lý/giám sát nhập & sửa.
-- Nhân viên được update hợp đồng / hoá đơn nhưng trigger chỉ cho đánh dấu "đã thu".
create policy tenants_select on public.tenants for select to authenticated using (public.can_access_building(building_id));
create policy tenants_insert on public.tenants for insert to authenticated with check (public.can_manage_building(building_id));
create policy tenants_update on public.tenants for update to authenticated
  using (public.can_manage_building(building_id)) with check (public.can_manage_building(building_id));
create policy tenants_delete on public.tenants for delete to authenticated using (public.can_manage_building(building_id));

create policy contracts_select on public.contracts for select to authenticated using (public.can_access_building(building_id));
create policy contracts_insert on public.contracts for insert to authenticated with check (public.can_manage_building(building_id));
create policy contracts_update on public.contracts for update to authenticated
  using (public.can_access_building(building_id)) with check (public.can_access_building(building_id));
create policy contracts_delete on public.contracts for delete to authenticated using (public.can_manage_building(building_id));

create policy occupants_select on public.contract_occupants for select to authenticated
  using (exists (select 1 from public.contracts c where c.id = contract_id and public.can_access_building(c.building_id)));
create policy occupants_insert on public.contract_occupants for insert to authenticated
  with check (exists (select 1 from public.contracts c where c.id = contract_id and public.can_manage_building(c.building_id)));
create policy occupants_update on public.contract_occupants for update to authenticated
  using (exists (select 1 from public.contracts c where c.id = contract_id and public.can_manage_building(c.building_id)))
  with check (exists (select 1 from public.contracts c where c.id = contract_id and public.can_manage_building(c.building_id)));
create policy occupants_delete on public.contract_occupants for delete to authenticated
  using (exists (select 1 from public.contracts c where c.id = contract_id and public.can_manage_building(c.building_id)));

create policy invoices_select on public.invoices for select to authenticated using (public.can_access_building(building_id));
create policy invoices_insert on public.invoices for insert to authenticated with check (public.can_manage_building(building_id));
create policy invoices_update on public.invoices for update to authenticated
  using (public.can_access_building(building_id)) with check (public.can_access_building(building_id));
create policy invoices_delete on public.invoices for delete to authenticated using (public.can_manage_building(building_id));

-- Doanh thu đêm: thành viên toà ghi nhận; sửa: người nhập hoặc quản lý/giám sát; xoá: quản lý/giám sát
create policy nightly_select on public.nightly_revenues for select to authenticated using (public.can_access_building(building_id));
create policy nightly_insert on public.nightly_revenues for insert to authenticated with check (public.can_access_building(building_id));
create policy nightly_update on public.nightly_revenues for update to authenticated
  using (public.can_manage_building(building_id) or created_by = (select auth.uid()))
  with check (public.can_access_building(building_id));
create policy nightly_delete on public.nightly_revenues for delete to authenticated using (public.can_manage_building(building_id));

-- Công việc
create policy tasks_select on public.tasks for select to authenticated using (public.can_see_task(id));
create policy tasks_insert on public.tasks for insert to authenticated
  with check (
    created_by = (select auth.uid())
    and (building_id is null or public.can_access_building(building_id))
    and (parent_id is null or public.can_see_task(parent_id))
    and (public.app_role() in ('quan_ly','giam_sat') or assignee_id = (select auth.uid())));
create policy tasks_update on public.tasks for update to authenticated
  using (public.can_see_task(id)) with check (public.can_see_task(id));
create policy tasks_delete on public.tasks for delete to authenticated
  using (public.is_manager() or created_by = (select auth.uid()));

create policy task_updates_select on public.task_updates for select to authenticated using (public.can_see_task(task_id));
create policy task_updates_insert on public.task_updates for insert to authenticated
  with check (author_id = (select auth.uid()) and public.can_see_task(task_id));

-- Thông báo: chỉ xem và đánh dấu đã đọc thông báo của mình
create policy notif_select on public.notifications for select to authenticated using (user_id = (select auth.uid()));
create policy notif_update on public.notifications for update to authenticated
  using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));

-- Hàm nội bộ: không cho gọi trực tiếp từ app / người chưa đăng nhập
revoke execute on function public.notify(uuid, public.notif_type, text, text, text, uuid, text) from public, anon, authenticated;
revoke execute on function public.run_daily_reminders() from public, anon, authenticated;
revoke execute on function public.handle_new_user() from public, anon, authenticated;
revoke execute on function public.generate_monthly_invoices(date) from public, anon;
revoke execute on function public.dashboard_month(date) from public, anon;

-- Thông báo hiện ngay trên app (Realtime)
do $$ begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    alter publication supabase_realtime add table public.notifications;
  end if;
end $$;

-- ---------- 9. BẢN VÁ SAU KIỂM TRA TRÊN SUPABASE ----------
-- (a) Quyền xem việc theo giá trị của chính dòng đó (để insert ... returning hoạt động)
create or replace function public.can_see_task_row(p_parent uuid, p_building uuid, p_assignee uuid, p_creator uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select public.app_role() is not null and (
       public.is_manager()
    or p_assignee = auth.uid() or p_creator = auth.uid()
    or (public.app_role() = 'giam_sat' and p_building is not null and public.can_access_building(p_building))
    or (p_parent is not null and exists (
          select 1 from public.tasks p where p.id = p_parent
          and (p.assignee_id = auth.uid() or p.created_by = auth.uid()))))
$$;
drop policy tasks_select on public.tasks;
drop policy tasks_update on public.tasks;
create policy tasks_select on public.tasks for select to authenticated
  using (public.can_see_task_row(parent_id, building_id, assignee_id, created_by));
create policy tasks_update on public.tasks for update to authenticated
  using (public.can_see_task_row(parent_id, building_id, assignee_id, created_by))
  with check (public.can_see_task_row(parent_id, building_id, assignee_id, created_by));

-- (b) Khoá quyền gọi hàm
revoke execute on all functions in schema public from anon;
alter default privileges in schema public revoke execute on functions from anon;
revoke execute on function public.handle_new_user(), public.tg_profiles_guard(), public.tg_contracts_before(),
  public.tg_contracts_after(), public.tg_invoices_before(), public.tg_tasks_guard(), public.tg_tasks_notify(),
  public.tg_task_updates_after() from authenticated, public;
grant execute on function public.can_see_task_row(uuid, uuid, uuid, uuid) to authenticated;

-- (c) Kích hoạt tài khoản do quản lý cấp: Supabase ghi app_metadata sau INSERT nên bắt thêm UPDATE
create or replace function public.handle_user_provisioned() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if coalesce((new.raw_app_meta_data->>'provisioned')::boolean, false)
     and not coalesce((old.raw_app_meta_data->>'provisioned')::boolean, false) then
    update public.profiles
       set is_active = true,
           role = coalesce((new.raw_app_meta_data->>'role')::public.user_role, role)
     where id = new.id;
  end if;
  return new;
end $$;
revoke execute on function public.handle_user_provisioned() from public, anon, authenticated;
create trigger on_auth_user_provisioned after update of raw_app_meta_data on auth.users
  for each row execute function public.handle_user_provisioned();

-- (d) Khoá bí mật (VD gemini_api_key) lưu trong Supabase Vault; chỉ Edge Function (service_role) đọc được
create or replace function public.app_secret(p_name text) returns text
language sql stable security definer set search_path = '' as $$
  select decrypted_secret from vault.decrypted_secrets where name = p_name limit 1
$$;
revoke execute on function public.app_secret(text) from public, anon, authenticated;
grant execute on function public.app_secret(text) to service_role;
-- Cài khoá: select vault.create_secret('<khoá>', 'gemini_api_key', 'Khoá Gemini');
-- (e) Xoá phòng / xoá toà
create or replace function public.delete_rooms(p_ids uuid[])
returns table (deleted int, skipped int)
language plpgsql security invoker set search_path = public as $$
declare d int; total int := coalesce(array_length(p_ids, 1), 0);
begin
  with del as (
    delete from public.rooms r
    where r.id = any(p_ids)
      and not exists (select 1 from public.contracts c where c.room_id = r.id)
      and not exists (select 1 from public.nightly_revenues n where n.room_id = r.id)
    returning 1
  ) select count(*) into d from del;
  return query select d, total - d;
end $$;
revoke execute on function public.delete_rooms(uuid[]) from public, anon;
grant execute on function public.delete_rooms(uuid[]) to authenticated;
create or replace function public.delete_building(p_id uuid)
returns json
language plpgsql security definer set search_path = public as $$
declare b public.buildings; n_rooms int; n_tasks int;
begin
  if not public.is_manager() then
    raise exception 'Chỉ quản lý được xoá toà nhà';
  end if;
  select * into b from public.buildings where id = p_id;
  if b.id is null then raise exception 'Không tìm thấy toà nhà'; end if;
  if exists (select 1 from public.contracts where building_id = p_id)
     or exists (select 1 from public.tenants where building_id = p_id)
     or exists (select 1 from public.invoices where building_id = p_id)
     or exists (select 1 from public.nightly_revenues where building_id = p_id) then
    raise exception 'Toà % đã có khách thuê, hợp đồng hoặc doanh thu nên không xoá được. Hãy giữ lại để không mất số liệu.', b.code;
  end if;
  select count(*) into n_rooms from public.rooms where building_id = p_id;
  update public.tasks set building_id = null where building_id = p_id;
  get diagnostics n_tasks = row_count;
  delete from public.buildings where id = p_id;
  return json_build_object('code', b.code, 'rooms', n_rooms, 'tasks_unlinked', n_tasks);
end $$;
revoke execute on function public.delete_building(uuid) from public, anon;
grant execute on function public.delete_building(uuid) to authenticated;

-- (f) Nhân viên không được tạo/giao việc; chỉ cập nhật trạng thái việc được giao
--     (vẫn được thêm bước vào việc của chính mình)
drop policy if exists tasks_insert on public.tasks;
create policy tasks_insert on public.tasks for insert to authenticated
  with check (
    created_by = (select auth.uid())
    and (building_id is null or public.can_access_building(building_id))
    and (parent_id is null or public.can_see_task(parent_id))
    and (public.app_role() in ('quan_ly','giam_sat')
         or (parent_id is not null and assignee_id = (select auth.uid()))));
drop policy if exists tasks_delete on public.tasks;
create policy tasks_delete on public.tasks for delete to authenticated
  using (public.is_manager()
         or (created_by = (select auth.uid()) and (public.app_role() <> 'nhan_vien' or parent_id is not null)));
