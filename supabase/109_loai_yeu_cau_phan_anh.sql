-- 109: Ba loại yêu cầu cho khung chat website và mục Phản ánh của khách (26/11/2026)
--  * feedback_threads.category: 'phan_anh' = Phản ánh & khiếu nại, 'tu_van' = Tư vấn & hỗ trợ, 'gop_y' = Phản hồi & góp ý.
--  * Người gửi chọn loại khi mở cuộc mới (website: web_chat_send; app: feedback_create).
--    Website bản cũ chưa gửi loại → mặc định Tư vấn & hỗ trợ; app bản cũ → Phản ánh & khiếu nại.
--  * Người xử lý đổi được loại khi khách chọn nhầm (feedback_set_category), có dòng hệ thống ghi lại.
--  * Theo Quy định QĐ-KN-01: chỉ loại Phản ánh & khiếu nại tính thời hạn giải quyết khiếu nại.

-- ---------- Cột loại ----------
alter table public.feedback_threads add column if not exists category text not null default 'phan_anh';
alter table public.feedback_threads drop constraint if exists feedback_threads_category_check;
alter table public.feedback_threads add constraint feedback_threads_category_check check (category in ('phan_anh','tu_van','gop_y'));
-- Tin nhắn website trước đây chủ yếu là hỏi thuê
update public.feedback_threads set category = 'tu_van' where kind = 'web' and category = 'phan_anh';

create or replace function public.feedback_category_label(c text) returns text
language sql immutable set search_path = public as $$
  select case c when 'phan_anh' then 'Phản ánh & khiếu nại' when 'tu_van' then 'Tư vấn & hỗ trợ' when 'gop_y' then 'Phản hồi & góp ý' else c end
$$;

-- ---------- App: khách gửi phản ánh mới có chọn loại ----------
drop function if exists public.feedback_create(text, text);
create or replace function public.feedback_create(p_subject text, p_body text, p_category text default 'phan_anh')
returns table (thread_id uuid, message_id uuid)
language plpgsql security definer set search_path = public as $$
declare tid uuid; mid uuid; nm text; c record; b record; r record; k text; ttl text; cat text := coalesce(nullif(p_category, ''), 'phan_anh');
begin
  p_subject := btrim(coalesce(p_subject, '')); p_body := btrim(coalesce(p_body, ''));
  if p_subject = '' or p_body = '' then raise exception 'Cần nhập tiêu đề và nội dung'; end if;
  if cat not in ('phan_anh','tu_van','gop_y') then raise exception 'Chọn loại yêu cầu: Phản ánh & khiếu nại, Tư vấn & hỗ trợ hoặc Phản hồi & góp ý'; end if;
  if public.is_customer() then k := 'khach';
  elsif public.is_ctv() then k := 'ctv';
  else raise exception 'Chỉ khách hàng gửi phản ánh'; end if;
  if (select count(*) from public.feedback_threads f where f.customer_id = auth.uid() and f.status <> 'dong') >= 5 then
    raise exception 'Bạn đang có 5 yêu cầu chưa kết thúc. Hãy kết thúc bớt trước khi gửi thêm';
  end if;
  if k = 'khach' then
    select * into c from public.customer_profiles where id = auth.uid();
    if c.building_id is null then
      raise exception 'Tài khoản của bạn chưa được gán toà nhà và phòng. Vui lòng liên hệ nhân viên Next Living';
    end if;
    select id, code, name into b from public.buildings where id = c.building_id;
    if c.room_id is not null then select id, code into r from public.rooms where id = c.room_id; end if;
    insert into public.feedback_threads (customer_id, kind, category, subject, building_id, room_id, building_code, building_name, room_code)
      values (auth.uid(), 'khach', cat, left(p_subject, 120), b.id, r.id, b.code, b.name, r.code) returning id into tid;
    ttl := public.feedback_category_label(cat) || ' · ' || b.code || case when c.room_id is not null then ' · P.' || r.code else '' end;
  else
    insert into public.feedback_threads (customer_id, kind, category, subject) values (auth.uid(), 'ctv', cat, left(p_subject, 120)) returning id into tid;
    ttl := public.feedback_category_label(cat) || ' · CTV';
  end if;
  insert into public.feedback_messages (thread_id, author_id, sender, body)
    values (tid, auth.uid(), 'khach', left(p_body, 2000)) returning id into mid;
  select full_name into nm from public.profiles where id = auth.uid();
  perform public.feedback_notify_handlers(tid, ttl, nm || ': ' || left(p_subject, 80));
  return query select tid, mid;
end $$;
revoke execute on function public.feedback_create(text, text, text) from public, anon;
grant execute on function public.feedback_create(text, text, text) to authenticated;

-- ---------- Website: chọn loại khi mở cuộc mới ----------
drop function if exists public.web_chat_send(text, text, text, text, uuid);
create or replace function public.web_chat_send(p_token text, p_phone text, p_text text, p_name text default null,
                                                p_room uuid default null, p_category text default 'tu_van')
returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  ph text := regexp_replace(coalesce(p_phone, ''), '\D', '', 'g');
  tx text := btrim(coalesce(p_text, ''));
  nm text := nullif(left(btrim(coalesce(p_name, '')), 60), '');
  cat text := coalesce(nullif(p_category, ''), 'tu_van');
  ip text; th public.feedback_threads; tok text; n int;
  r public.rooms; b public.buildings;
begin
  if ph ~ '^84[0-9]{9}$' then ph := '0' || substr(ph, 3); end if;
  if ph !~ '^0[35789][0-9]{8}$' then raise exception 'Vui lòng nhập số điện thoại di động 10 số để Next Living liên hệ lại'; end if;
  if tx = '' then raise exception 'Bạn chưa nhập tin nhắn'; end if;
  if char_length(tx) > 1000 then raise exception 'Tin nhắn dài quá 1000 ký tự'; end if;
  if cat not in ('phan_anh','tu_van','gop_y') then raise exception 'Vui lòng chọn bạn cần: Phản ánh & khiếu nại, Tư vấn & hỗ trợ hoặc Phản hồi & góp ý'; end if;
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
    insert into public.feedback_threads (kind, category, customer_id, subject, status, guest_phone, guest_name, guest_token_hash, guest_ip_hash,
                                         building_id, room_id, building_code, building_name, room_code)
    values ('web', cat, null, left(ph || ': ' || regexp_replace(tx, '\s+', ' ', 'g'), 120), 'cho_cong_ty', ph, nm, public.web_guest_hash(tok), ip,
            b.id, r.id, b.code, b.name, r.code)
    returning * into th;
    insert into public.feedback_messages (thread_id, sender, body) values (th.id, 'khach', tx);
    perform public.feedback_notify_handlers(th.id, 'Website · ' || public.feedback_category_label(cat),
      left(ph || coalesce(' (' || nm || ')', '') || coalesce(' · ' || b.code || ' P.' || r.code, '') || ': ' || tx, 200));
  else
    if th.guest_phone <> ph then raise exception 'Số điện thoại khác với cuộc trò chuyện đang mở. Bấm "Cuộc mới" để gửi bằng số khác.'; end if;
    select count(*) into n from public.feedback_messages where thread_id = th.id and sender = 'khach' and created_at > now() - interval '10 minutes';
    if n >= 8 then raise exception 'Bạn gửi nhanh quá, vui lòng chờ ít phút.'; end if;
    select count(*) into n from public.feedback_messages where thread_id = th.id;
    if n >= 60 then raise exception 'Cuộc trò chuyện đã dài, Next Living sẽ gọi lại cho bạn.'; end if;
    insert into public.feedback_messages (thread_id, sender, body) values (th.id, 'khach', tx);
    update public.feedback_threads set status = 'cho_cong_ty', updated_at = now(), guest_name = coalesce(nm, guest_name) where id = th.id;
    perform public.feedback_notify_handlers(th.id, 'Website · khách nhắn thêm · ' || public.feedback_category_label(th.category), left(ph || ': ' || tx, 200));
    tok := p_token;
  end if;
  return jsonb_build_object('token', tok, 'thread_id', th.id);
end $$;
revoke execute on function public.web_chat_send(text, text, text, text, uuid, text) from public;
grant execute on function public.web_chat_send(text, text, text, text, uuid, text) to anon, authenticated;

-- Người gửi xem lại cuộc trò chuyện: thêm loại yêu cầu
create or replace function public.web_chat_get(p_token text) returns jsonb
language sql stable security definer set search_path = public as $$
  select case when t.id is null then null else jsonb_build_object(
    'status', t.status, 'category', t.category, 'phone', t.guest_phone, 'room_code', t.room_code, 'building_code', t.building_code,
    'messages', coalesce((select jsonb_agg(jsonb_build_object('sender', m.sender, 'body', m.body, 'at', m.created_at) order by m.created_at)
                            from public.feedback_messages m where m.thread_id = t.id), '[]'::jsonb)) end
  from (select 1) x left join public.feedback_threads t
    on coalesce(p_token, '') <> '' and t.kind = 'web' and t.guest_token_hash = public.web_guest_hash(p_token)
$$;

-- ---------- Người xử lý đổi loại khi khách chọn nhầm ----------
create or replace function public.feedback_set_category(p_thread uuid, p_category text) returns void
language plpgsql security definer set search_path = public as $$
declare t public.feedback_threads;
begin
  if p_category not in ('phan_anh','tu_van','gop_y') then raise exception 'Loại yêu cầu không hợp lệ'; end if;
  select * into t from public.feedback_threads where id = p_thread for update;
  if not found then raise exception 'Không tìm thấy yêu cầu'; end if;
  if not public.feedback_can_handle(t.id) then raise exception 'Không có quyền đổi loại yêu cầu này'; end if;
  if t.category = p_category then return; end if;
  update public.feedback_threads set category = p_category, updated_at = now() where id = t.id;
  insert into public.feedback_messages (thread_id, author_id, sender, body)
    values (t.id, auth.uid(), 'he_thong', 'Next Living đã chuyển yêu cầu sang mục ' || public.feedback_category_label(p_category) || '.');
end $$;
revoke execute on function public.feedback_set_category(uuid, text) from public, anon;
grant execute on function public.feedback_set_category(uuid, text) to authenticated;
