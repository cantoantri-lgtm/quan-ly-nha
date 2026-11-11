-- =====================================================================
-- Neo Nestly · TÀI KHOẢN KHÁCH HÀNG + PHẢN ÁNH  (chạy sau 025a)
--   Khách hàng: đăng nhập bằng SĐT, xem phòng trống / giá / phí / dịch vụ / nội thất; KHÔNG thấy hoa hồng,
--   điều khoản ký hợp đồng, ghi chú nội bộ (ẩn ngay trong building_policies(), không chỉ ẩn ở giao diện).
--   Mỗi CCCD chỉ đăng ký một tài khoản (customer_profiles.cccd unique).
--   Phản ánh: khách gửi, công ty trả lời theo luồng tin nhắn; chỉ khách kết thúc, hoặc tự kết thúc
--   sau 3 ngày kể từ lần công ty trả lời mà khách không phản hồi.
-- =====================================================================

set check_function_bodies = off; -- customers_list() nhắc tới bảng tạo ở bên dưới

-- Khách hàng giống Cộng tác viên: app_role() = NULL nên mọi chính sách nghiệp vụ cũ coi như người ngoài
create or replace function public.app_role() returns public.user_role
language sql stable security definer set search_path = public as $$
  select role from public.profiles where id = auth.uid() and is_active and role not in ('cong_tac_vien','khach_hang')
$$;

create or replace function public.role_rank(r public.user_role) returns int
language sql immutable set search_path = public as $$
  select case r when 'quan_ly' then 3 when 'giam_sat' then 2 when 'cong_tac_vien' then 0 when 'khach_hang' then 0 else 1 end
$$;

create or replace function public.is_customer() returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.profiles where id = auth.uid() and is_active and role = 'khach_hang')
$$;
revoke execute on function public.is_customer() from public, anon;
grant execute on function public.is_customer() to authenticated;

create or replace function public.tg_tasks_no_collab() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.assignee_id is not null
     and exists (select 1 from public.profiles where id = new.assignee_id and role in ('cong_tac_vien','khach_hang')) then
    raise exception 'Không giao việc cho Cộng tác viên hoặc khách hàng';
  end if;
  return new;
end $$;

-- Hồ sơ khách hàng: CCCD duy nhất. Không ai đọc/ghi trực tiếp từ trình duyệt (chỉ RPC và Edge Function).
create table if not exists public.customer_profiles (
  id         uuid primary key references public.profiles(id) on delete cascade,
  cccd       text not null unique check (cccd ~ '^[0-9]{12}$'),
  created_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now()
);
alter table public.customer_profiles enable row level security;
revoke all on public.customer_profiles from anon, authenticated;

-- Quản lý, Giám sát xử lý mọi khách; Sale (nhân viên) chỉ khách do mình tạo
create or replace function public.can_handle_customer(c uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select public.app_role() in ('quan_ly','giam_sat')
      or (public.app_role() is not null and exists (
            select 1 from public.customer_profiles x where x.id = c and x.created_by = auth.uid()))
$$;
revoke execute on function public.can_handle_customer(uuid) from public, anon;
grant execute on function public.can_handle_customer(uuid) to authenticated;

drop policy if exists profiles_select on public.profiles;
create policy profiles_select on public.profiles for select to authenticated
  using (id = (select auth.uid())
         or (public.app_role() is not null and (role <> 'khach_hang' or public.can_handle_customer(id))));

-- Danh sách khách cho nhân sự; CCCD đầy đủ chỉ Quản lý thấy, người khác thấy 4 số cuối
create or replace function public.customers_list()
returns table (id uuid, full_name text, phone text, cccd text, is_active boolean, created_at timestamptz,
               created_by_name text, open_threads int)
language sql stable security definer set search_path = public as $$
  select p.id, p.full_name, p.phone,
         case when public.app_role() = 'quan_ly' then c.cccd else '********' || right(c.cccd, 4) end,
         p.is_active, c.created_at, cb.full_name,
         (select count(*)::int from public.feedback_threads t where t.customer_id = p.id and t.status <> 'dong')
  from public.customer_profiles c
  join public.profiles p on p.id = c.id
  left join public.profiles cb on cb.id = c.created_by
  where public.can_handle_customer(p.id)
  order by c.created_at desc
$$;
revoke execute on function public.customers_list() from public, anon;
grant execute on function public.customers_list() to authenticated;

-- ===== Phản ánh =====
create table if not exists public.feedback_threads (
  id          uuid primary key default gen_random_uuid(),
  customer_id uuid not null references public.profiles(id) on delete cascade,
  subject     text not null check (char_length(subject) between 1 and 120),
  status      text not null default 'cho_cong_ty' check (status in ('cho_cong_ty','cho_khach','dong')),
  closed_reason text check (closed_reason in ('khach_ket_thuc','tu_dong')),
  last_company_reply_at timestamptz,
  closed_at   timestamptz,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);
create index if not exists feedback_threads_customer on public.feedback_threads(customer_id, updated_at desc);
create index if not exists feedback_threads_autoclose on public.feedback_threads(last_company_reply_at) where status = 'cho_khach';

create table if not exists public.feedback_messages (
  id         uuid primary key default gen_random_uuid(),
  thread_id  uuid not null references public.feedback_threads(id) on delete cascade,
  author_id  uuid references public.profiles(id) on delete set null,
  sender     text not null check (sender in ('khach','cong_ty','he_thong')),
  body       text not null check (char_length(body) between 1 and 2000),
  created_at timestamptz not null default now()
);
create index if not exists feedback_messages_thread on public.feedback_messages(thread_id, created_at);

alter table public.feedback_threads  enable row level security;
alter table public.feedback_messages enable row level security;
revoke insert, update, delete on public.feedback_threads, public.feedback_messages from anon, authenticated;

create policy feedback_threads_select on public.feedback_threads for select to authenticated
  using (customer_id = (select auth.uid()) or public.can_handle_customer(customer_id));
create or replace function public.feedback_can_see(t uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.feedback_threads f
                 where f.id = t and (f.customer_id = auth.uid() or public.can_handle_customer(f.customer_id)))
$$;
revoke execute on function public.feedback_can_see(uuid) from public, anon;
grant execute on function public.feedback_can_see(uuid) to authenticated;
create policy feedback_messages_select on public.feedback_messages for select to authenticated
  using (public.feedback_can_see(thread_id));

-- Báo cho người xử lý: Quản lý, Giám sát và Sale đã tạo tài khoản khách
create or replace function public.feedback_notify_handlers(p_thread uuid, p_title text, p_body text) returns void
language plpgsql security definer set search_path = public as $$
declare cust uuid; m uuid;
begin
  select customer_id into cust from public.feedback_threads where id = p_thread;
  for m in
    select id from public.profiles where is_active and role in ('quan_ly','giam_sat')
    union
    select c.created_by from public.customer_profiles c
      join public.profiles s on s.id = c.created_by and s.is_active
      where c.id = cust and c.created_by is not null
  loop
    perform public.notify(m, 'khac', p_title, p_body, 'feedback', p_thread);
  end loop;
end $$;
revoke execute on function public.feedback_notify_handlers(uuid, text, text) from public, anon, authenticated;

create or replace function public.feedback_create(p_subject text, p_body text) returns uuid
language plpgsql security definer set search_path = public as $$
declare tid uuid; nm text;
begin
  if not public.is_customer() then raise exception 'Chỉ khách hàng gửi phản ánh'; end if;
  p_subject := btrim(coalesce(p_subject, '')); p_body := btrim(coalesce(p_body, ''));
  if p_subject = '' or p_body = '' then raise exception 'Cần nhập tiêu đề và nội dung'; end if;
  if (select count(*) from public.feedback_threads where customer_id = auth.uid() and status <> 'dong') >= 5 then
    raise exception 'Bạn đang có 5 phản ánh chưa kết thúc. Hãy kết thúc bớt trước khi gửi thêm';
  end if;
  insert into public.feedback_threads (customer_id, subject) values (auth.uid(), left(p_subject, 120)) returning id into tid;
  insert into public.feedback_messages (thread_id, author_id, sender, body) values (tid, auth.uid(), 'khach', left(p_body, 2000));
  select full_name into nm from public.profiles where id = auth.uid();
  perform public.feedback_notify_handlers(tid, 'Phản ánh mới của khách', nm || ': ' || left(p_subject, 80));
  return tid;
end $$;

create or replace function public.feedback_reply(p_thread uuid, p_body text) returns void
language plpgsql security definer set search_path = public as $$
declare t public.feedback_threads; nm text; cust boolean;
begin
  p_body := btrim(coalesce(p_body, ''));
  if p_body = '' then raise exception 'Chưa nhập nội dung'; end if;
  select * into t from public.feedback_threads where id = p_thread for update;
  if not found then raise exception 'Không tìm thấy phản ánh'; end if;
  if t.status = 'dong' then raise exception 'Phản ánh này đã kết thúc'; end if;
  cust := public.is_customer();
  if cust then
    if t.customer_id <> auth.uid() then raise exception 'Không có quyền'; end if;
    insert into public.feedback_messages (thread_id, author_id, sender, body) values (t.id, auth.uid(), 'khach', left(p_body, 2000));
    update public.feedback_threads set status = 'cho_cong_ty', updated_at = now() where id = t.id;
    select full_name into nm from public.profiles where id = auth.uid();
    perform public.feedback_notify_handlers(t.id, 'Khách trả lời phản ánh', nm || ': ' || left(t.subject, 80));
  else
    if not public.can_handle_customer(t.customer_id) then raise exception 'Không có quyền'; end if;
    insert into public.feedback_messages (thread_id, author_id, sender, body) values (t.id, auth.uid(), 'cong_ty', left(p_body, 2000));
    update public.feedback_threads set status = 'cho_khach', last_company_reply_at = now(), updated_at = now() where id = t.id;
    perform public.notify(t.customer_id, 'khac', 'Neo Nestly đã trả lời phản ánh của bạn', left(t.subject, 80), 'feedback', t.id);
  end if;
end $$;

-- Chỉ khách kết thúc (công ty không đóng thay)
create or replace function public.feedback_close(p_thread uuid) returns void
language plpgsql security definer set search_path = public as $$
declare t public.feedback_threads;
begin
  if not public.is_customer() then raise exception 'Chỉ khách hàng kết thúc phản ánh'; end if;
  select * into t from public.feedback_threads where id = p_thread and customer_id = auth.uid() for update;
  if not found then raise exception 'Không tìm thấy phản ánh'; end if;
  if t.status = 'dong' then return; end if;
  update public.feedback_threads set status = 'dong', closed_reason = 'khach_ket_thuc', closed_at = now(), updated_at = now() where id = t.id;
  insert into public.feedback_messages (thread_id, sender, body) values (t.id, 'he_thong', 'Khách đã kết thúc phản ánh.');
  perform public.feedback_notify_handlers(t.id, 'Khách đã kết thúc phản ánh', left(t.subject, 80));
end $$;

-- Công ty đã trả lời mà khách im lặng 3 ngày: tự kết thúc
create or replace function public.feedback_autoclose() returns int
language plpgsql security definer set search_path = public as $$
declare t record; n int := 0;
begin
  for t in
    select id, customer_id, subject from public.feedback_threads
    where status = 'cho_khach' and last_company_reply_at < now() - interval '3 days' for update
  loop
    update public.feedback_threads set status = 'dong', closed_reason = 'tu_dong', closed_at = now(), updated_at = now() where id = t.id;
    insert into public.feedback_messages (thread_id, sender, body)
      values (t.id, 'he_thong', 'Phản ánh tự kết thúc vì sau 3 ngày chưa có phản hồi mới của khách.');
    perform public.notify(t.customer_id, 'khac', 'Phản ánh đã tự kết thúc', left(t.subject, 80), 'feedback', t.id);
    n := n + 1;
  end loop;
  return n;
end $$;

revoke execute on function public.feedback_create(text, text), public.feedback_reply(uuid, text),
  public.feedback_close(uuid) from public, anon;
grant execute on function public.feedback_create(text, text), public.feedback_reply(uuid, text),
  public.feedback_close(uuid) to authenticated;
revoke execute on function public.feedback_autoclose() from public, anon, authenticated;

select cron.schedule('dong-phan-anh-3-ngay', '7 * * * *', $$select public.feedback_autoclose()$$);

-- Chính sách toà: khách hàng không nhận phần ký hợp đồng, hoa hồng, ghi chú nội bộ (ẩn ngay từ máy chủ)
create or replace function public.building_policies()
returns table (
  building_id uuid, code text, name text, address text,
  fees jsonb, amenities text[], furniture text[], deposit_lines text[], commission_terms jsonb,
  forfeit_min numeric, forfeit_pct numeric, note text, updated_at timestamptz
)
language sql stable security definer set search_path = public as $$
  select b.id, b.code, b.name, b.address,
         coalesce(p.fees, '[]'::jsonb), coalesce(p.amenities, '{}'), coalesce(p.furniture, '{}'),
         case when c.x then '{}'::text[] else coalesce(p.deposit_lines, '{}') end,
         case when c.x then '[]'::jsonb  else coalesce(p.commission_terms, '[]'::jsonb) end,
         case when c.x then null else p.forfeit_min end,
         case when c.x then null else p.forfeit_pct end,
         case when c.x then null else p.note end,
         p.updated_at
  from public.buildings b
  left join public.building_policy p on p.building_id = b.id
  cross join (select public.is_customer() as x) c
  where public.is_active_user()
  order by b.code
$$;
