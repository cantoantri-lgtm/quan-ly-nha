-- Khách hàng ở phòng nào thì phản ánh đúng toà và phòng đó: toà/phòng gắn vào tài khoản khách (do Sale/Quản lý gán),
-- khách không tự chọn khi gửi phản ánh.
alter table public.customer_profiles
  add column if not exists building_id uuid references public.buildings(id) on delete set null,
  add column if not exists room_id     uuid references public.rooms(id)     on delete set null;

drop function if exists public.feedback_rooms(uuid);
drop function if exists public.feedback_create(uuid, uuid, text, text);

-- Chỗ ở của khách đang đăng nhập (khách không đọc được bảng toà/phòng nên cần hàm riêng)
create or replace function public.customer_my_place()
returns table (building_id uuid, building_code text, building_name text, room_id uuid, room_code text)
language sql stable security definer set search_path = public as $$
  select c.building_id, b.code, b.name, c.room_id, r.code
  from public.customer_profiles c
  left join public.buildings b on b.id = c.building_id
  left join public.rooms r on r.id = c.room_id
  where c.id = auth.uid() and public.is_customer()
$$;
revoke execute on function public.customer_my_place() from public, anon;
grant execute on function public.customer_my_place() to authenticated;

create or replace function public.feedback_create(p_subject text, p_body text) returns uuid
language plpgsql security definer set search_path = public as $$
declare tid uuid; nm text; c record; b record; r record;
begin
  if not public.is_customer() then raise exception 'Chỉ khách hàng gửi phản ánh'; end if;
  p_subject := btrim(coalesce(p_subject, '')); p_body := btrim(coalesce(p_body, ''));
  if p_subject = '' or p_body = '' then raise exception 'Cần nhập tiêu đề và nội dung'; end if;
  select * into c from public.customer_profiles where id = auth.uid();
  if c.building_id is null then
    raise exception 'Tài khoản của bạn chưa được gán toà nhà và phòng. Vui lòng liên hệ nhân viên Neo Nestly';
  end if;
  select id, code, name into b from public.buildings where id = c.building_id;
  if c.room_id is not null then select id, code into r from public.rooms where id = c.room_id; end if;
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
revoke execute on function public.feedback_create(text, text) from public, anon;
grant execute on function public.feedback_create(text, text) to authenticated;

-- Nhân sự gán / đổi phòng cho khách (Sale chỉ trong toà mình được gán)
create or replace function public.customer_assign_room(p_customer uuid, p_room uuid) returns void
language plpgsql security definer set search_path = public as $$
declare r record;
begin
  if not public.can_handle_customer(p_customer) then raise exception 'Không có quyền với khách này'; end if;
  if p_room is null then
    update public.customer_profiles set building_id = null, room_id = null where id = p_customer;
    return;
  end if;
  select id, building_id into r from public.rooms where id = p_room;
  if not found then raise exception 'Không tìm thấy phòng'; end if;
  if not public.can_access_building(r.building_id) then raise exception 'Bạn không phụ trách toà này'; end if;
  update public.customer_profiles set building_id = r.building_id, room_id = r.id where id = p_customer;
end $$;
revoke execute on function public.customer_assign_room(uuid, uuid) from public, anon;
grant execute on function public.customer_assign_room(uuid, uuid) to authenticated;

drop function if exists public.customers_list();
create or replace function public.customers_list()
returns table (id uuid, full_name text, phone text, cccd text, is_active boolean, created_at timestamptz,
               created_by_name text, open_threads int, building_code text, room_id uuid, room_code text)
language sql stable security definer set search_path = public as $$
  select p.id, p.full_name, p.phone,
         case when public.app_role() = 'quan_ly' then c.cccd else '********' || right(c.cccd, 4) end,
         p.is_active, c.created_at, cb.full_name,
         (select count(*)::int from public.feedback_threads t where t.customer_id = p.id and t.status <> 'dong'),
         b.code, c.room_id, r.code
  from public.customer_profiles c
  join public.profiles p on p.id = c.id
  left join public.profiles cb on cb.id = c.created_by
  left join public.buildings b on b.id = c.building_id
  left join public.rooms r on r.id = c.room_id
  where public.can_handle_customer(p.id)
  order by c.created_at desc
$$;
revoke execute on function public.customers_list() from public, anon;
grant execute on function public.customers_list() to authenticated;
