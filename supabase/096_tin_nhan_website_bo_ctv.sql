-- 096: Tin nhắn từ website và bỏ chức năng Cộng tác viên (23/11/2026)
--  (1) Khung chat trên website: người gửi chưa đăng nhập phải nhập số điện thoại di động trước khi gửi.
--      Tin nhắn vào mục Phản ánh (loại 'web', thay chỗ phản ánh CTV), tiêu đề "SĐT: tin nhắn".
--      Người xử lý: Lead Sale trở lên; tin gửi từ trang một phòng thì thêm nhân sự của toà đó.
--      Người gửi xem lại cuộc trò chuyện bằng mã bí mật lưu trên trình duyệt (chỉ lưu mã băm ở CSDL).
--      Chống gửi tràn: mỗi số tối đa 3 cuộc mới / ngày, mỗi địa chỉ mạng 5 cuộc mới / giờ,
--      mỗi cuộc tối đa 8 tin / 10 phút và 60 tin.
--  (2) Bỏ Cộng tác viên: khoá các tài khoản CTV đang có (mở lại được), không tạo hoặc đổi sang vai trò CTV nữa.
--      Hoa hồng do sale trao đổi trực tiếp, app không hiện mục hoa hồng CTV.

-- ---------- (1) Tin nhắn website ----------
alter table public.feedback_threads alter column customer_id drop not null;
alter table public.feedback_threads add column if not exists guest_phone text,
  add column if not exists guest_name text,
  add column if not exists guest_token_hash text,
  add column if not exists guest_ip_hash text;
create unique index if not exists feedback_threads_guest_token on public.feedback_threads(guest_token_hash) where guest_token_hash is not null;
create index if not exists feedback_threads_guest_phone on public.feedback_threads(guest_phone, created_at) where guest_phone is not null;
alter table public.feedback_threads drop constraint if exists feedback_threads_kind_check;
alter table public.feedback_threads add constraint feedback_threads_kind_check check (kind in ('khach','ctv','web'));
alter table public.feedback_threads add constraint feedback_threads_web_guest check (
  (kind = 'web' and customer_id is null and guest_phone ~ '^0[0-9]{9}$' and guest_token_hash is not null)
  or (kind <> 'web' and customer_id is not null));
alter table public.feedback_threads add constraint feedback_threads_guest_name_len check (guest_name is null or char_length(guest_name) <= 60);

create or replace function public.feedback_can_handle(t uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.feedback_threads f where f.id = t and
    case when f.kind = 'ctv' then public.is_lead_up()
         when f.kind = 'web' then public.is_lead_up() or (f.building_id is not null and public.can_access_building(f.building_id))
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
      where t.kind in ('ctv','web') and (s.is_leader or coalesce(s.level, 0) >= 2)
    union
    select s.id from public.building_members bm join public.profiles s on s.id = bm.user_id and s.is_active
      where t.kind in ('khach','web') and t.building_id is not null and bm.building_id = t.building_id
    union
    select c.created_by from public.customer_profiles c join public.profiles s on s.id = c.created_by and s.is_active
      where t.kind = 'khach' and c.id = t.customer_id and c.created_by is not null
  loop
    perform public.notify(m, 'khac', p_title, p_body, 'feedback', p_thread);
  end loop;
end $$;

create or replace function public.web_guest_hash(p text) returns text
language sql immutable set search_path = public as $$ select encode(sha256(convert_to(coalesce(p, ''), 'UTF8')), 'hex') $$;
revoke execute on function public.web_guest_hash(text) from public, anon, authenticated;

-- Gửi tin từ website. p_token rỗng = cuộc mới. Trả về {token, thread_id}.
create or replace function public.web_chat_send(p_token text, p_phone text, p_text text, p_name text default null, p_room uuid default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  ph text := regexp_replace(coalesce(p_phone, ''), '\D', '', 'g');
  tx text := btrim(coalesce(p_text, ''));
  nm text := nullif(left(btrim(coalesce(p_name, '')), 60), '');
  ip text; th public.feedback_threads; tok text; n int;
  r public.rooms; b public.buildings;
begin
  if ph ~ '^84[0-9]{9}$' then ph := '0' || substr(ph, 3); end if;
  if ph !~ '^0[35789][0-9]{8}$' then raise exception 'Vui lòng nhập số điện thoại di động 10 số để Next Living liên hệ lại'; end if;
  if tx = '' then raise exception 'Bạn chưa nhập tin nhắn'; end if;
  if char_length(tx) > 1000 then raise exception 'Tin nhắn dài quá 1000 ký tự'; end if;
  ip := public.web_guest_hash(split_part(coalesce(current_setting('request.headers', true)::jsonb->>'x-forwarded-for', ''), ',', 1));

  if coalesce(p_token, '') <> '' then
    select * into th from public.feedback_threads
     where guest_token_hash = public.web_guest_hash(p_token) and kind = 'web' and status <> 'dong' for update;
  end if;

  if th.id is null then
    select count(*) into n from public.feedback_threads where kind = 'web' and guest_phone = ph and created_at > now() - interval '1 day';
    if n >= 3 then raise exception 'Số điện thoại này đã gửi nhiều lần hôm nay. Next Living sẽ liên hệ lại sớm.'; end if;
    select count(*) into n from public.feedback_threads where kind = 'web' and guest_ip_hash = ip and created_at > now() - interval '1 hour';
    if n >= 5 then raise exception 'Bạn gửi nhanh quá, vui lòng thử lại sau ít phút.'; end if;
    if p_room is not null then
      select * into r from public.rooms where id = p_room;
      if found and not public.web_is_hidden(r.building_id, r.id) then
        select * into b from public.buildings where id = r.building_id;
      else r := null; end if;
    end if;
    tok := replace(gen_random_uuid()::text, '-', '') || replace(gen_random_uuid()::text, '-', '');
    insert into public.feedback_threads (kind, customer_id, subject, status, guest_phone, guest_name, guest_token_hash, guest_ip_hash,
                                         building_id, room_id, building_code, building_name, room_code)
    values ('web', null, left(ph || ': ' || regexp_replace(tx, '\s+', ' ', 'g'), 120), 'cho_cong_ty', ph, nm, public.web_guest_hash(tok), ip,
            b.id, r.id, b.code, b.name, r.code)
    returning * into th;
    insert into public.feedback_messages (thread_id, sender, body) values (th.id, 'khach', tx);
    perform public.feedback_notify_handlers(th.id, 'Tin nhắn mới từ website',
      left(ph || coalesce(' (' || nm || ')', '') || coalesce(' · ' || b.code || ' P.' || r.code, '') || ': ' || tx, 200));
  else
    if th.guest_phone <> ph then raise exception 'Số điện thoại khác với cuộc trò chuyện đang mở. Bấm "Cuộc mới" để gửi bằng số khác.'; end if;
    select count(*) into n from public.feedback_messages where thread_id = th.id and sender = 'khach' and created_at > now() - interval '10 minutes';
    if n >= 8 then raise exception 'Bạn gửi nhanh quá, vui lòng chờ ít phút.'; end if;
    select count(*) into n from public.feedback_messages where thread_id = th.id;
    if n >= 60 then raise exception 'Cuộc trò chuyện đã dài, Next Living sẽ gọi lại cho bạn.'; end if;
    insert into public.feedback_messages (thread_id, sender, body) values (th.id, 'khach', tx);
    update public.feedback_threads set status = 'cho_cong_ty', updated_at = now(), guest_name = coalesce(nm, guest_name) where id = th.id;
    perform public.feedback_notify_handlers(th.id, 'Khách trên website nhắn thêm', left(ph || ': ' || tx, 200));
    tok := p_token;
  end if;
  return jsonb_build_object('token', tok, 'thread_id', th.id);
end $$;
revoke execute on function public.web_chat_send(text, text, text, text, uuid) from public;
grant execute on function public.web_chat_send(text, text, text, text, uuid) to anon, authenticated;

-- Người gửi xem lại cuộc trò chuyện của mình (không có tên nhân viên).
create or replace function public.web_chat_get(p_token text) returns jsonb
language sql stable security definer set search_path = public as $$
  select case when t.id is null then null else jsonb_build_object(
    'status', t.status, 'phone', t.guest_phone, 'room_code', t.room_code, 'building_code', t.building_code,
    'messages', coalesce((select jsonb_agg(jsonb_build_object('sender', m.sender, 'body', m.body, 'at', m.created_at) order by m.created_at)
                            from public.feedback_messages m where m.thread_id = t.id), '[]'::jsonb)) end
  from (select 1) x left join public.feedback_threads t
    on coalesce(p_token, '') <> '' and t.kind = 'web' and t.guest_token_hash = public.web_guest_hash(p_token)
$$;
revoke execute on function public.web_chat_get(text) from public;
grant execute on function public.web_chat_get(text) to anon, authenticated;

-- ---------- (2) Bỏ Cộng tác viên ----------
update public.profiles set is_active = false where role = 'cong_tac_vien' and is_active;

create or replace function public.tg_profiles_no_ctv() returns trigger
language plpgsql set search_path = public as $$
begin
  if new.role = 'cong_tac_vien' and new.is_active and (tg_op = 'INSERT' or old.role <> 'cong_tac_vien' or not old.is_active) then
    raise exception 'Đã bỏ chức năng Cộng tác viên. Tạo tài khoản Nhân viên hoặc gửi link website phòng trống.';
  end if;
  return new;
end $$;
drop trigger if exists profiles_no_ctv on public.profiles;
create trigger profiles_no_ctv before insert or update on public.profiles for each row execute function public.tg_profiles_no_ctv();

-- ---------- (3) Cài đặt khung Liên hệ trên website ----------
--  contact_on: hiện nút Liên hệ; chat_on: cho nhắn tin trong khung; messenger: tên trang Facebook (m.me/<tên>);
--  hotline2: số gọi thứ hai (hỗ trợ khách thuê); nhãn từng nút; giờ tư vấn; lời chào trong khung chat.
do $$
declare def text := pg_get_functiondef('public.web_settings_clean(jsonb)'::regprocedure);
begin
  if position('"footer_note":200}' in def) = 0 or position('''show_brands'']' in def) = 0 or position(E'  return o;\nend' in def) = 0 then
    raise exception 'web_settings_clean: không tìm thấy đoạn cần sửa';
  end if;
  def := replace(def, '"footer_note":200}', '"footer_note":200,"contact_title":60,"hotline_label":40,"hotline2_label":40,"contact_hours":40,"chat_greeting":160}');
  def := replace(def, '''show_brands'']', '''show_brands'',''contact_on'',''chat_on'']');
  def := replace(def, E'  return o;\nend', $x$
  v := btrim(coalesce(p->>'messenger', ''));
  v := regexp_replace(v, '^(https?://)?(www\.|m\.|web\.)?(facebook\.com|fb\.com|m\.me)/', '', 'i');
  v := split_part(split_part(v, '?', 1), '/', 1);
  if v <> '' then
    if v !~ '^[A-Za-z0-9.]{3,80}$' then raise exception 'Messenger: nhập tên trang Facebook hoặc link m.me/tên-trang'; end if;
    o := o || jsonb_build_object('messenger', v);
  end if;
  v := btrim(coalesce(p->>'hotline2', ''));
  if v <> '' then
    if v !~ '^\+?[0-9 .]{8,16}$' then raise exception 'Số gọi thứ hai chỉ gồm số, dấu cách hoặc dấu chấm (8–16 ký tự)'; end if;
    o := o || jsonb_build_object('hotline2', v);
  end if;
  return o;
end$x$);
  execute def;
end $$;
