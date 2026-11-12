-- Phản ánh của Cộng tác viên (không gắn toà/phòng; chỉ Lead Sale trở lên đọc và trả lời) + đính kèm ảnh vào tin nhắn phản ánh.
-- "Lead Sale trở lên" = Quản lý, Giám sát, hoặc người đứng Leader / cấp L2 trở lên trong sơ đồ công ty (org_staff).
alter table public.feedback_threads add column if not exists kind text not null default 'khach' check (kind in ('khach','ctv'));

create or replace function public.is_ctv() returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.profiles where id = auth.uid() and is_active and role = 'cong_tac_vien')
$$;
revoke execute on function public.is_ctv() from public, anon;
grant execute on function public.is_ctv() to authenticated;

create or replace function public.is_lead_up() returns boolean
language sql stable security definer set search_path = public as $$
  select public.app_role() in ('quan_ly','giam_sat')
      or (public.app_role() is not null and exists (
            select 1 from public.org_staff s
            where s.profile_id = auth.uid() and (s.is_leader or coalesce(s.level, 0) >= 2)))
$$;
revoke execute on function public.is_lead_up() from public, anon;
grant execute on function public.is_lead_up() to authenticated;

-- Quyền xử lý: phản ánh CTV chỉ Lead Sale trở lên; phản ánh khách như cũ
create or replace function public.feedback_can_handle(t uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.feedback_threads f where f.id = t and
    case when f.kind = 'ctv' then public.is_lead_up()
         else public.can_handle_customer(f.customer_id)
              or (f.building_id is not null and public.can_access_building(f.building_id)) end)
$$;

create or replace function public.feedback_notify_handlers(p_thread uuid, p_title text, p_body text) returns void
language plpgsql security definer set search_path = public as $$
declare t public.feedback_threads; m uuid;
begin
  select * into t from public.feedback_threads where id = p_thread;
  for m in
    select id from public.profiles where is_active and role in ('quan_ly','giam_sat')
    union
    select s.profile_id from public.org_staff s join public.profiles p on p.id = s.profile_id and p.is_active
      where t.kind = 'ctv' and (s.is_leader or coalesce(s.level, 0) >= 2)
    union
    select s.id from public.building_members bm join public.profiles s on s.id = bm.user_id and s.is_active
      where t.kind = 'khach' and bm.building_id = t.building_id
    union
    select c.created_by from public.customer_profiles c join public.profiles s on s.id = c.created_by and s.is_active
      where t.kind = 'khach' and c.id = t.customer_id and c.created_by is not null
  loop
    perform public.notify(m, 'khac', p_title, p_body, 'feedback', p_thread);
  end loop;
end $$;

drop function if exists public.feedback_create(text, text);
create or replace function public.feedback_create(p_subject text, p_body text)
returns table (thread_id uuid, message_id uuid)
language plpgsql security definer set search_path = public as $$
declare tid uuid; mid uuid; nm text; c record; b record; r record; k text;
begin
  p_subject := btrim(coalesce(p_subject, '')); p_body := btrim(coalesce(p_body, ''));
  if p_subject = '' or p_body = '' then raise exception 'Cần nhập tiêu đề và nội dung'; end if;
  if public.is_customer() then k := 'khach';
  elsif public.is_ctv() then k := 'ctv';
  else raise exception 'Chỉ khách hàng hoặc Cộng tác viên gửi phản ánh'; end if;
  if (select count(*) from public.feedback_threads f where f.customer_id = auth.uid() and f.status <> 'dong') >= 5 then
    raise exception 'Bạn đang có 5 phản ánh chưa kết thúc. Hãy kết thúc bớt trước khi gửi thêm';
  end if;
  if k = 'khach' then
    select * into c from public.customer_profiles where id = auth.uid();
    if c.building_id is null then
      raise exception 'Tài khoản của bạn chưa được gán toà nhà và phòng. Vui lòng liên hệ nhân viên Neo Nestly';
    end if;
    select id, code, name into b from public.buildings where id = c.building_id;
    if c.room_id is not null then select id, code into r from public.rooms where id = c.room_id; end if;
    insert into public.feedback_threads (customer_id, kind, subject, building_id, room_id, building_code, building_name, room_code)
      values (auth.uid(), 'khach', left(p_subject, 120), b.id, r.id, b.code, b.name, r.code) returning id into tid;
  else
    insert into public.feedback_threads (customer_id, kind, subject) values (auth.uid(), 'ctv', left(p_subject, 120)) returning id into tid;
  end if;
  insert into public.feedback_messages (thread_id, author_id, sender, body)
    values (tid, auth.uid(), 'khach', left(p_body, 2000)) returning id into mid;
  select full_name into nm from public.profiles where id = auth.uid();
  perform public.feedback_notify_handlers(tid,
    case when k = 'ctv' then 'Phản ánh mới của CTV' else 'Phản ánh mới · ' || b.code || coalesce(' · P.' || r.code, '') end,
    nm || ': ' || left(p_subject, 80));
  return query select tid, mid;
end $$;
revoke execute on function public.feedback_create(text, text) from public, anon;
grant execute on function public.feedback_create(text, text) to authenticated;

drop function if exists public.feedback_reply(uuid, text);
create or replace function public.feedback_reply(p_thread uuid, p_body text) returns uuid
language plpgsql security definer set search_path = public as $$
declare t public.feedback_threads; nm text; mid uuid;
begin
  p_body := btrim(coalesce(p_body, ''));
  if p_body = '' then raise exception 'Chưa nhập nội dung'; end if;
  select * into t from public.feedback_threads where id = p_thread for update;
  if not found then raise exception 'Không tìm thấy phản ánh'; end if;
  if t.status = 'dong' then raise exception 'Phản ánh này đã kết thúc'; end if;
  if t.customer_id = auth.uid() then
    insert into public.feedback_messages (thread_id, author_id, sender, body) values (t.id, auth.uid(), 'khach', left(p_body, 2000)) returning id into mid;
    update public.feedback_threads set status = 'cho_cong_ty', updated_at = now() where id = t.id;
    select full_name into nm from public.profiles where id = auth.uid();
    perform public.feedback_notify_handlers(t.id, case when t.kind = 'ctv' then 'CTV trả lời phản ánh' else 'Khách trả lời phản ánh' end, nm || ': ' || left(t.subject, 80));
  else
    if not public.feedback_can_handle(t.id) then raise exception 'Không có quyền trả lời phản ánh này'; end if;
    insert into public.feedback_messages (thread_id, author_id, sender, body) values (t.id, auth.uid(), 'cong_ty', left(p_body, 2000)) returning id into mid;
    update public.feedback_threads set status = 'cho_khach', last_company_reply_at = now(), updated_at = now() where id = t.id;
    perform public.notify(t.customer_id, 'khac', 'Neo Nestly đã trả lời phản ánh của bạn', left(t.subject, 80), 'feedback', t.id);
  end if;
  return mid;
end $$;
revoke execute on function public.feedback_reply(uuid, text) from public, anon;
grant execute on function public.feedback_reply(uuid, text) to authenticated;

-- Người gửi (khách hoặc CTV) kết thúc phản ánh của mình
create or replace function public.feedback_close(p_thread uuid) returns void
language plpgsql security definer set search_path = public as $$
declare t public.feedback_threads;
begin
  select * into t from public.feedback_threads where id = p_thread and customer_id = auth.uid() for update;
  if not found then raise exception 'Chỉ người gửi mới kết thúc được phản ánh'; end if;
  if t.status = 'dong' then return; end if;
  update public.feedback_threads set status = 'dong', closed_reason = 'khach_ket_thuc', closed_at = now(), updated_at = now() where id = t.id;
  insert into public.feedback_messages (thread_id, sender, body) values (t.id, 'he_thong', case when t.kind = 'ctv' then 'CTV đã kết thúc phản ánh.' else 'Khách đã kết thúc phản ánh.' end);
  perform public.feedback_notify_handlers(t.id, case when t.kind = 'ctv' then 'CTV đã kết thúc phản ánh' else 'Khách đã kết thúc phản ánh' end, left(t.subject, 80));
end $$;

-- ===== Ảnh đính kèm =====
create table if not exists public.feedback_attachments (
  id         uuid primary key default gen_random_uuid(),
  thread_id  uuid not null references public.feedback_threads(id) on delete cascade,
  message_id uuid not null references public.feedback_messages(id) on delete cascade,
  path       text not null unique,
  file_name  text,
  mime_type  text,
  size_bytes int,
  store      text not null default 'r2' check (store in ('r2','supabase')),
  thumb      boolean not null default false,
  created_by uuid references public.profiles(id) on delete set null default auth.uid(),
  created_at timestamptz not null default now(),
  check (path like 'phan-anh/%')
);
create index if not exists feedback_attachments_thread on public.feedback_attachments(thread_id, created_at);
alter table public.feedback_attachments enable row level security;
revoke insert, update, delete on public.feedback_attachments from anon, authenticated;
create policy feedback_attachments_select on public.feedback_attachments for select to authenticated
  using (public.feedback_can_see(thread_id));

-- Gắn ảnh vào tin nhắn của chính mình, tối đa 4 ảnh mỗi tin
create or replace function public.feedback_attach(p_message uuid, p_path text, p_name text, p_mime text, p_size int, p_store text, p_thumb boolean)
returns void language plpgsql security definer set search_path = public as $$
declare tid uuid;
begin
  select m.thread_id into tid from public.feedback_messages m where m.id = p_message and m.author_id = auth.uid();
  if tid is null then raise exception 'Không phải tin nhắn của bạn'; end if;
  if not public.feedback_can_see(tid) then raise exception 'Không có quyền'; end if;
  if p_path not like 'phan-anh/' || tid::text || '/%' then raise exception 'Đường dẫn ảnh không khớp phản ánh'; end if;
  if p_mime not in ('image/jpeg','image/png','image/webp') then raise exception 'Chỉ đính kèm ảnh JPG, PNG, WebP'; end if;
  if (select count(*) from public.feedback_attachments where message_id = p_message) >= 4 then raise exception 'Mỗi tin nhắn tối đa 4 ảnh'; end if;
  insert into public.feedback_attachments (thread_id, message_id, path, file_name, mime_type, size_bytes, store, thumb)
    values (tid, p_message, p_path, left(p_name, 120), p_mime, p_size, p_store, coalesce(p_thumb, false));
end $$;
revoke execute on function public.feedback_attach(uuid, text, text, text, int, text, boolean) from public, anon;
grant execute on function public.feedback_attach(uuid, text, text, text, int, text, boolean) to authenticated;

-- Quyền tệp: phan-anh/<mã phản ánh>/... — người gửi và người xử lý đọc; ghi khi phản ánh chưa kết thúc
create or replace function public.storage_path_ok(p_name text, p_write boolean) returns boolean
language plpgsql stable security definer set search_path = public as $$
declare
  parts text[] := string_to_array(coalesce(p_name, ''), '/');
  o uuid;
begin
  if array_length(parts, 1) is null or array_length(parts, 1) < 3 then return false; end if;
  begin o := parts[2]::uuid; exception when others then return false; end;
  if parts[1] = 'phan-anh' then
    return public.is_active_user() and exists (
      select 1 from public.feedback_threads f
      where f.id = o and (f.customer_id = auth.uid() or public.feedback_can_handle(f.id))
        and (not p_write or f.status <> 'dong'));
  end if;
  if public.app_role() is null then return false; end if;
  return case parts[1]
    when 'cccd'      then public.can_manage_building(o)
    when 'hop-dong'  then case when p_write then public.can_manage_building(o) else public.can_access_building(o) end
    when 'anh-phong' then public.can_access_building(o)
    when 'anh-toa'   then case when p_write then public.can_manage_building(o) else public.can_access_building(o) end
    when 'de-nghi'   then exists (select 1 from public.requests r
                                  where r.id = o and (r.requester_id = auth.uid() or public.is_manager()
                                                      or (not p_write and public.is_request_approver(r.id))))
    else false end;
end $$;
revoke execute on function public.storage_path_ok(text, boolean) from public, anon;
grant execute on function public.storage_path_ok(text, boolean) to authenticated;
