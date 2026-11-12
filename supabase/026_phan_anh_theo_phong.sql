-- Phản ánh gắn với toà và phòng để biết Sale phụ trách (Sale = nhân viên được gán toà đó, kèm người tạo tài khoản khách).
-- Toà/phòng lưu cả mã chữ (khách hàng không đọc được bảng buildings/rooms nên cần bản ghi sẵn trong phản ánh).
alter table public.feedback_threads
  add column if not exists building_id   uuid references public.buildings(id) on delete set null,
  add column if not exists room_id       uuid references public.rooms(id) on delete set null,
  add column if not exists building_code text,
  add column if not exists building_name text,
  add column if not exists room_code     text;

-- Người xử lý một phản ánh: Quản lý, Giám sát, Sale của toà đó, hoặc Sale đã tạo tài khoản khách
create or replace function public.feedback_can_handle(t uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.feedback_threads f where f.id = t and (
           public.can_handle_customer(f.customer_id)
        or (f.building_id is not null and public.can_access_building(f.building_id))))
$$;
revoke execute on function public.feedback_can_handle(uuid) from public, anon;
grant execute on function public.feedback_can_handle(uuid) to authenticated;

drop policy if exists feedback_threads_select on public.feedback_threads;
create policy feedback_threads_select on public.feedback_threads for select to authenticated
  using (customer_id = (select auth.uid()) or public.feedback_can_handle(id));

create or replace function public.feedback_can_see(t uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.feedback_threads f where f.id = t and f.customer_id = auth.uid())
      or public.feedback_can_handle(t)
$$;

-- Danh sách phòng của một toà cho khách chọn (chỉ mã phòng và tầng, không lộ tình trạng hay khách thuê)
create or replace function public.feedback_rooms(p_building uuid)
returns table (id uuid, code text, floor int)
language sql stable security definer set search_path = public as $$
  select r.id, r.code, r.floor from public.rooms r
  where r.building_id = p_building and public.is_active_user()
  order by r.floor nulls last, r.code
$$;
revoke execute on function public.feedback_rooms(uuid) from public, anon;
grant execute on function public.feedback_rooms(uuid) to authenticated;

-- Sale phụ trách của phản ánh (tên): nhân viên được gán toà + người tạo tài khoản khách
create or replace function public.feedback_sales(p_thread uuid) returns text[]
language sql stable security definer set search_path = public as $$
  select coalesce(array_agg(distinct x.full_name order by x.full_name), '{}')
  from (
    select p.full_name from public.feedback_threads f
      join public.building_members m on m.building_id = f.building_id
      join public.profiles p on p.id = m.user_id and p.is_active and p.role = 'nhan_vien'
      where f.id = p_thread
    union
    select s.full_name from public.feedback_threads f
      join public.customer_profiles c on c.id = f.customer_id
      join public.profiles s on s.id = c.created_by and s.is_active and s.role = 'nhan_vien'
      where f.id = p_thread
  ) x
  where public.feedback_can_see(p_thread)
$$;
revoke execute on function public.feedback_sales(uuid) from public, anon;
grant execute on function public.feedback_sales(uuid) to authenticated;

-- Báo cho: Quản lý, Giám sát, Sale của toà, Sale tạo tài khoản khách
create or replace function public.feedback_notify_handlers(p_thread uuid, p_title text, p_body text) returns void
language plpgsql security definer set search_path = public as $$
declare cust uuid; bld uuid; m uuid;
begin
  select customer_id, building_id into cust, bld from public.feedback_threads where id = p_thread;
  for m in
    select id from public.profiles where is_active and role in ('quan_ly','giam_sat')
    union
    select s.id from public.building_members bm join public.profiles s on s.id = bm.user_id and s.is_active
      where bm.building_id = bld
    union
    select c.created_by from public.customer_profiles c
      join public.profiles s on s.id = c.created_by and s.is_active
      where c.id = cust and c.created_by is not null
  loop
    perform public.notify(m, 'khac', p_title, p_body, 'feedback', p_thread);
  end loop;
end $$;

drop function if exists public.feedback_create(text, text);
create or replace function public.feedback_create(p_building uuid, p_room uuid, p_subject text, p_body text) returns uuid
language plpgsql security definer set search_path = public as $$
declare tid uuid; nm text; b record; r record;
begin
  if not public.is_customer() then raise exception 'Chỉ khách hàng gửi phản ánh'; end if;
  p_subject := btrim(coalesce(p_subject, '')); p_body := btrim(coalesce(p_body, ''));
  if p_subject = '' or p_body = '' then raise exception 'Cần nhập tiêu đề và nội dung'; end if;
  select id, code, name into b from public.buildings where id = p_building;
  if not found then raise exception 'Chọn toà nhà bạn đang phản ánh'; end if;
  if p_room is not null then
    select id, code into r from public.rooms where id = p_room and building_id = p_building;
    if not found then raise exception 'Phòng không thuộc toà đã chọn'; end if;
  end if;
  if (select count(*) from public.feedback_threads where customer_id = auth.uid() and status <> 'dong') >= 5 then
    raise exception 'Bạn đang có 5 phản ánh chưa kết thúc. Hãy kết thúc bớt trước khi gửi thêm';
  end if;
  insert into public.feedback_threads (customer_id, subject, building_id, room_id, building_code, building_name, room_code)
    values (auth.uid(), left(p_subject, 120), b.id, r.id, b.code, b.name, r.code) returning id into tid;
  insert into public.feedback_messages (thread_id, author_id, sender, body) values (tid, auth.uid(), 'khach', left(p_body, 2000));
  select full_name into nm from public.profiles where id = auth.uid();
  perform public.feedback_notify_handlers(tid, 'Phản ánh mới · ' || b.code || coalesce(' · P.' || r.code, ''), nm || ': ' || left(p_subject, 80));
  return tid;
end $$;
revoke execute on function public.feedback_create(uuid, uuid, text, text) from public, anon;
grant execute on function public.feedback_create(uuid, uuid, text, text) to authenticated;

-- Trả lời: người xử lý theo toà cũng trả lời được
create or replace function public.feedback_reply(p_thread uuid, p_body text) returns void
language plpgsql security definer set search_path = public as $$
declare t public.feedback_threads; nm text;
begin
  p_body := btrim(coalesce(p_body, ''));
  if p_body = '' then raise exception 'Chưa nhập nội dung'; end if;
  select * into t from public.feedback_threads where id = p_thread for update;
  if not found then raise exception 'Không tìm thấy phản ánh'; end if;
  if t.status = 'dong' then raise exception 'Phản ánh này đã kết thúc'; end if;
  if public.is_customer() then
    if t.customer_id <> auth.uid() then raise exception 'Không có quyền'; end if;
    insert into public.feedback_messages (thread_id, author_id, sender, body) values (t.id, auth.uid(), 'khach', left(p_body, 2000));
    update public.feedback_threads set status = 'cho_cong_ty', updated_at = now() where id = t.id;
    select full_name into nm from public.profiles where id = auth.uid();
    perform public.feedback_notify_handlers(t.id, 'Khách trả lời phản ánh', nm || ': ' || left(t.subject, 80));
  else
    if not public.feedback_can_handle(t.id) then raise exception 'Không có quyền'; end if;
    insert into public.feedback_messages (thread_id, author_id, sender, body) values (t.id, auth.uid(), 'cong_ty', left(p_body, 2000));
    update public.feedback_threads set status = 'cho_khach', last_company_reply_at = now(), updated_at = now() where id = t.id;
    perform public.notify(t.customer_id, 'khac', 'Neo Nestly đã trả lời phản ánh của bạn', left(t.subject, 80), 'feedback', t.id);
  end if;
end $$;
