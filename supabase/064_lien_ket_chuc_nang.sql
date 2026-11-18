-- 064: Liên kết qua lại giữa các chức năng
-- Toà, phòng, công việc, đề nghị (văn phòng số), phản ánh, hợp đồng, khách thuê, lịch hẹn xem phòng.
-- Hai loại liên kết:
--   1. Tự động: suy ra từ dữ liệu sẵn có (việc thuộc toà, hợp đồng của phòng, phản ánh của phòng…).
--   2. Gắn tay: nhân viên gắn hai mục với nhau (bảng entity_links), xem được từ cả hai phía.
-- Quyền: chỉ thấy một liên kết khi thấy được CẢ HAI đầu. Các hàm chạy bằng quyền người gọi (security invoker)
-- nên RLS của từng bảng gốc quyết định ai thấy gì. Khách hàng và CTV không dùng tính năng này.

create table if not exists public.entity_links (
  id         uuid primary key default gen_random_uuid(),
  a_type     text not null,
  a_id       uuid not null,
  b_type     text not null,
  b_id       uuid not null,
  created_by uuid references public.profiles(id) on delete set null default auth.uid(),
  created_at timestamptz not null default now(),
  constraint entity_links_types check (
    a_type in ('building','room','task','request','feedback','contract','tenant','viewing')
    and b_type in ('building','room','task','request','feedback','contract','tenant','viewing')),
  constraint entity_links_not_self check (not (a_type = b_type and a_id = b_id)),
  constraint entity_links_uniq unique (a_type, a_id, b_type, b_id)
);
create index if not exists entity_links_a on public.entity_links (a_type, a_id);
create index if not exists entity_links_b on public.entity_links (b_type, b_id);

-- Người gọi có xem được mục này không (theo RLS của bảng gốc)
create or replace function public.link_can_see(p_type text, p_id uuid) returns boolean
language plpgsql stable security invoker set search_path = public as $$
begin
  if p_id is null or not public.is_active_user() or public.is_customer() or public.is_ctv() then return false; end if;
  return case p_type
    when 'building' then exists (select 1 from public.buildings where id = p_id)
    when 'room'     then exists (select 1 from public.rooms where id = p_id)
    when 'task'     then exists (select 1 from public.tasks where id = p_id)
    when 'request'  then exists (select 1 from public.requests where id = p_id)
    when 'feedback' then exists (select 1 from public.feedback_threads where id = p_id)
    when 'contract' then exists (select 1 from public.contracts where id = p_id)
    when 'tenant'   then exists (select 1 from public.tenants where id = p_id)
    when 'viewing'  then exists (select 1 from public.viewing_requests where id = p_id)
    else false end;
end $$;
revoke execute on function public.link_can_see(text, uuid) from public, anon;
grant execute on function public.link_can_see(text, uuid) to authenticated;

-- Chuẩn hoá thứ tự hai đầu (để không trùng A–B và B–A) và khoá người tạo
create or replace function public.tg_entity_links_guard() returns trigger
language plpgsql security invoker set search_path = public as $$
declare t text; i uuid;
begin
  if (new.a_type, new.a_id::text) > (new.b_type, new.b_id::text) then
    t := new.a_type; i := new.a_id;
    new.a_type := new.b_type; new.a_id := new.b_id;
    new.b_type := t; new.b_id := i;
  end if;
  new.created_by := auth.uid();
  new.created_at := now();
  return new;
end $$;
drop trigger if exists tg_entity_links_guard on public.entity_links;
create trigger tg_entity_links_guard before insert on public.entity_links
  for each row execute function public.tg_entity_links_guard();

alter table public.entity_links enable row level security;
drop policy if exists entity_links_select on public.entity_links;
create policy entity_links_select on public.entity_links for select to authenticated
  using (public.link_can_see(a_type, a_id) and public.link_can_see(b_type, b_id));
drop policy if exists entity_links_insert on public.entity_links;
create policy entity_links_insert on public.entity_links for insert to authenticated
  with check (created_by = (select auth.uid()) and public.link_can_see(a_type, a_id) and public.link_can_see(b_type, b_id));
drop policy if exists entity_links_delete on public.entity_links;
create policy entity_links_delete on public.entity_links for delete to authenticated
  using ((created_by = (select auth.uid()) or public.is_manager())
         and public.link_can_see(a_type, a_id) and public.link_can_see(b_type, b_id));
-- không có policy update: liên kết chỉ thêm hoặc gỡ
revoke all on public.entity_links from anon;
grant select, insert, delete on public.entity_links to authenticated;

-- Mô tả ngắn một mục (tên, dòng phụ, trạng thái, toà chứa nó). Không thấy mục thì trả về null.
create or replace function public.link_describe(p_type text, p_id uuid,
  out title text, out sub text, out status text, out parent uuid, out at timestamptz)
language plpgsql stable security invoker set search_path = public as $$
begin
  if p_type = 'building' then
    select b.name, b.code, null, b.id, null into title, sub, status, parent, at from public.buildings b where b.id = p_id;
  elsif p_type = 'room' then
    select 'Phòng ' || r.code, coalesce(b.name, ''), r.status::text, r.building_id, null
      into title, sub, status, parent, at
      from public.rooms r left join public.buildings b on b.id = r.building_id where r.id = p_id;
  elsif p_type = 'task' then
    select t.title, coalesce('Hạn ' || to_char(t.due_date, 'DD/MM/YYYY'), 'Chưa có hạn'), t.status::text, t.building_id, t.created_at
      into title, sub, status, parent, at from public.tasks t where t.id = p_id;
  elsif p_type = 'request' then
    select r.reason,
           concat_ws(' · ', public.request_label(r.kind, r.sub_type), r.doc_no,
                     case when r.amount is not null then replace(to_char(r.amount, 'FM999G999G999G999'), ',', '.') || ' đ' end),
           r.status::text, r.building_id, r.created_at
      into title, sub, status, parent, at from public.requests r where r.id = p_id;
  elsif p_type = 'feedback' then
    select f.subject, concat_ws(' · ', 'Phản ánh', case when f.room_code is not null then 'Phòng ' || f.room_code end, f.building_code),
           f.status, f.building_id, f.created_at
      into title, sub, status, parent, at from public.feedback_threads f where f.id = p_id;
  elsif p_type = 'contract' then
    select coalesce(c.code, 'Hợp đồng'), concat_ws(' · ', 'Phòng ' || r.code, to_char(c.start_date, 'DD/MM/YYYY') || coalesce(' – ' || to_char(c.end_date, 'DD/MM/YYYY'), '')),
           c.status::text, c.building_id, c.created_at
      into title, sub, status, parent, at
      from public.contracts c left join public.rooms r on r.id = c.room_id where c.id = p_id;
  elsif p_type = 'tenant' then
    select t.full_name, 'Khách thuê', null, t.building_id, t.created_at
      into title, sub, status, parent, at from public.tenants t where t.id = p_id;
  elsif p_type = 'viewing' then
    select 'Hẹn xem ' || to_char(v.visit_date, 'DD/MM/YYYY') || ' · ' || case v.slot when 'sang' then 'sáng' when 'chieu' then 'chiều' else 'tối' end,
           concat_ws(' · ', v.full_name, 'Phòng ' || r.code), v.status, v.building_id, v.created_at
      into title, sub, status, parent, at
      from public.viewing_requests v left join public.rooms r on r.id = v.room_id where v.id = p_id;
  end if;
end $$;
revoke execute on function public.link_describe(text, uuid) from public, anon;
grant execute on function public.link_describe(text, uuid) to authenticated;

-- Danh sách mục liên quan tới một mục: gắn tay (link_id có giá trị) và tự động (auto = true)
create or replace function public.related_items(p_type text, p_id uuid)
returns table (rel_type text, rel_id uuid, title text, sub text, status text, parent uuid, at timestamptz,
               auto boolean, link_id uuid, link_by uuid, can_unlink boolean)
language plpgsql stable security invoker set search_path = public as $$
begin
  if not public.link_can_see(p_type, p_id) then return; end if;
  return query
  with pairs as (
    -- gắn tay, hai chiều
    select l.b_type as t, l.b_id as i, false as au, l.id as lid, l.created_by as lby from public.entity_links l where l.a_type = p_type and l.a_id = p_id
    union all
    select l.a_type, l.a_id, false, l.id, l.created_by from public.entity_links l where l.b_type = p_type and l.b_id = p_id
    -- tự động theo dữ liệu sẵn có
    union all select 'building', x.building_id, true, null::uuid, null::uuid from public.tasks x where p_type = 'task' and x.id = p_id and x.building_id is not null
    union all select 'task', x.parent_id, true, null, null from public.tasks x where p_type = 'task' and x.id = p_id and x.parent_id is not null
    union all select 'building', x.building_id, true, null, null from public.requests x where p_type = 'request' and x.id = p_id and x.building_id is not null
    union all select 'request', x.loa_id, true, null, null from public.requests x where p_type = 'request' and x.id = p_id and x.loa_id is not null
    union all select 'request', x.id, true, null, null from public.requests x where p_type = 'request' and x.loa_id = p_id
    union all select 'building', x.building_id, true, null, null from public.feedback_threads x where p_type = 'feedback' and x.id = p_id and x.building_id is not null
    union all select 'room', x.room_id, true, null, null from public.feedback_threads x where p_type = 'feedback' and x.id = p_id and x.room_id is not null
    union all select 'building', x.building_id, true, null, null from public.rooms x where p_type = 'room' and x.id = p_id
    union all (select 'contract', x.id, true, null, null from public.contracts x where p_type = 'room' and x.room_id = p_id order by x.start_date desc limit 5)
    union all (select 'feedback', x.id, true, null, null from public.feedback_threads x where p_type = 'room' and x.room_id = p_id order by x.created_at desc limit 10)
    union all (select 'viewing', x.id, true, null, null from public.viewing_requests x where p_type = 'room' and x.room_id = p_id order by x.visit_date desc limit 5)
    union all select 'room', x.room_id, true, null, null from public.contracts x where p_type = 'contract' and x.id = p_id
    union all select 'tenant', x.tenant_id, true, null, null from public.contracts x where p_type = 'contract' and x.id = p_id
    union all (select 'contract', x.id, true, null, null from public.contracts x where p_type = 'tenant' and x.tenant_id = p_id order by x.start_date desc limit 5)
    union all select 'room', x.room_id, true, null, null from public.viewing_requests x where p_type = 'viewing' and x.id = p_id
  ),
  uniq as (
    -- một mục vừa tự động vừa gắn tay: giữ bản gắn tay (để gỡ được)
    select distinct on (p.t, p.i) p.t, p.i, p.au, p.lid, p.lby from pairs p
    where p.i is not null and not (p.t = p_type and p.i = p_id)
    order by p.t, p.i, p.au
  )
  select u.t, u.i, d.title, d.sub, d.status, d.parent, d.at, u.au, u.lid, u.lby,
         (u.lid is not null and (u.lby = auth.uid() or public.is_manager()))
  from uniq u
  cross join lateral public.link_describe(u.t, u.i) d
  where d.title is not null
  order by case u.t when 'building' then 1 when 'room' then 2 when 'contract' then 3 when 'tenant' then 4
                    when 'feedback' then 5 when 'task' then 6 when 'request' then 7 else 8 end,
           d.at desc nulls last;
end $$;
revoke execute on function public.related_items(text, uuid) from public, anon;
grant execute on function public.related_items(text, uuid) to authenticated;

-- Tìm mục để gắn liên kết (tối đa 20 kết quả, theo quyền người gọi)
create or replace function public.link_search(p_type text, p_q text)
returns table (id uuid, title text, sub text, status text)
language plpgsql stable security invoker set search_path = public as $$
declare q text := '%' || coalesce(btrim(p_q), '') || '%';
begin
  if not public.is_active_user() or public.is_customer() or public.is_ctv() then return; end if;
  return query
  select s.i, d.title, d.sub, d.status from (
    select x.id as i, x.created_at as at from public.tasks x where p_type = 'task' and x.title ilike q
    union all select x.id, x.created_at from public.requests x where p_type = 'request' and (x.reason ilike q or coalesce(x.doc_no, '') ilike q)
    union all select x.id, x.created_at from public.feedback_threads x where p_type = 'feedback' and (x.subject ilike q or coalesce(x.room_code, '') ilike q)
    union all select x.id, x.created_at from public.rooms x join public.buildings b on b.id = x.building_id
      where p_type = 'room' and (x.code ilike q or b.code ilike q or b.name ilike q)
    union all select x.id, x.created_at from public.contracts x left join public.rooms r on r.id = x.room_id
      where p_type = 'contract' and (coalesce(x.code, '') ilike q or coalesce(r.code, '') ilike q)
    union all select x.id, x.created_at from public.tenants x where p_type = 'tenant' and x.full_name ilike q
    union all select x.id, null from public.buildings x where p_type = 'building' and (x.code ilike q or x.name ilike q)
  ) s
  cross join lateral public.link_describe(p_type, s.i) d
  where d.title is not null
  order by s.at desc nulls last
  limit 20;
end $$;
revoke execute on function public.link_search(text, text) from public, anon;
grant execute on function public.link_search(text, text) to authenticated;
