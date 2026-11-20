-- 080: Đề nghị mua hàng (kind = 'mua_hang') và tham chiếu từ Đề nghị thanh toán.
-- Luồng duyệt mặc định như đề nghị tiền: Trưởng nhóm → Trưởng phòng → Kế toán → Giám đốc (Mr Trí chỉnh ở Luồng phê duyệt).
-- Số chứng từ: MH + YYMM + 4 số. Danh sách hàng ở bảng purchase_lines. Tổng tiền dự kiến = requests.amount.
-- Đề nghị thanh toán có cột purchase_id trỏ tới đề nghị mua hàng đã duyệt.

create sequence if not exists public.purchase_doc_seq;

create or replace function public.request_label(k request_kind, s text) returns text
language sql immutable set search_path = public as $$
  select case k
    when 'nghi_phep' then case s when 'khong_luong' then 'Nghỉ không lương' else 'Nghỉ phép năm' end
    when 'ra_ngoai'  then 'Làm việc bên ngoài'
    when 'cong_tac'  then 'Đi công tác'
    when 'thanh_toan' then 'Đề nghị thanh toán'
    when 'tam_ung'   then 'Đề nghị tạm ứng'
    when 'loa'       then 'Tờ trình (LOA)'
    when 'mua_hang'  then 'Đề nghị mua hàng'
  end
$$;

create or replace function public.default_flow(p_kind request_kind) returns text[]
language sql immutable as $$
  select case when p_kind in ('thanh_toan','tam_ung','loa','mua_hang')
              then array['leader','truong_phong','ke_toan','giam_doc']
              else array['leader','truong_phong','nhan_su'] end
$$;

-- Vá các hàm có sẵn: chỉ đổi đúng đoạn cần, báo lỗi nếu hàm đã khác bản đang chạy
do $$
declare d text;
begin
  -- Số chứng từ cho đề nghị mua hàng
  d := pg_get_functiondef('public.tg_requests_doc()'::regprocedure);
  if position(E'    else\n      new.doc_no := null; new.doc_date := null;' in d) = 0 then raise exception 'tg_requests_doc đã khác'; end if;
  d := replace(d, E'    else\n      new.doc_no := null; new.doc_date := null;',
    E'    elsif new.kind = ''mua_hang'' then\n      new.doc_no := ''MH'' || to_char(now() at time zone ''Asia/Ho_Chi_Minh'', ''YYMM'') || lpad(nextval(''public.purchase_doc_seq'')::text, 4, ''0'');\n      new.doc_date := (now() at time zone ''Asia/Ho_Chi_Minh'')::date;\n      new.currency := ''VND'';\n    else\n      new.doc_no := null; new.doc_date := null;');
  execute d;

  -- Thông báo hiện số tiền của đề nghị mua hàng
  d := pg_get_functiondef('public.tg_requests_notify()'::regprocedure);
  if position($x$when new.kind in ('thanh_toan','tam_ung') then ' · '$x$ in d) = 0 then raise exception 'tg_requests_notify đã khác'; end if;
  d := replace(d, $x$when new.kind in ('thanh_toan','tam_ung') then ' · '$x$, $x$when new.kind in ('thanh_toan','tam_ung','mua_hang') then ' · '$x$);
  execute d;

  -- Đề nghị mua hàng được gắn dự án / hạng mục như đề nghị tiền
  d := pg_get_functiondef('public.tg_requests_project_guard()'::regprocedure);
  if position($x$if new.kind not in ('thanh_toan','tam_ung') then$x$ in d) = 0 then raise exception 'tg_requests_project_guard đã khác'; end if;
  d := replace(d, $x$if new.kind not in ('thanh_toan','tam_ung') then$x$, $x$if new.kind not in ('thanh_toan','tam_ung','mua_hang') then$x$);
  execute d;
end $$;

-- ========== Danh sách hàng cần mua ==========
create table if not exists public.purchase_lines (
  id          uuid primary key default gen_random_uuid(),
  request_id  uuid not null references public.requests(id) on delete cascade,
  line_no     integer not null,
  item_name   text not null check (char_length(btrim(item_name)) between 1 and 300),
  spec        text check (char_length(spec) <= 500),
  unit        text check (char_length(unit) <= 30),
  quantity    numeric(14,2) not null check (quantity > 0),
  unit_price  bigint not null check (unit_price >= 0),
  amount      bigint generated always as (round(quantity * unit_price)::bigint) stored,
  note        text check (char_length(note) <= 500),
  created_at  timestamptz not null default now()
);
create index if not exists purchase_lines_req on public.purchase_lines(request_id, line_no);
alter table public.purchase_lines enable row level security;
revoke all on public.purchase_lines from anon;
grant select, insert, update, delete on public.purchase_lines to authenticated;
drop policy if exists pl_select on public.purchase_lines;
create policy pl_select on public.purchase_lines for select to authenticated using (public.can_see_request(request_id));
drop policy if exists pl_write on public.purchase_lines;
create policy pl_write on public.purchase_lines for all to authenticated
  using (public.request_lines_writable(request_id)) with check (public.request_lines_writable(request_id));

-- ========== Thanh toán tham chiếu đề nghị mua hàng ==========
alter table public.requests add column if not exists purchase_id uuid references public.requests(id) on delete set null;
create index if not exists requests_purchase on public.requests(purchase_id) where purchase_id is not null;

-- Ai xem được đề nghị mua hàng qua đề nghị thanh toán tham chiếu tới nó (người lập / người duyệt / kế toán của thanh toán)
create or replace function public.purchase_linked_visible(p_pr uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.requests q
     where q.purchase_id = p_pr and q.kind = 'thanh_toan'
       and (q.requester_id = auth.uid()
            or (q.status <> 'nhap' and (public.is_manager() or public.is_request_approver(q.id)
                 or (public.is_duty('ke_toan') and q.status in ('da_duyet','hoan_tat'))))))
$$;

create or replace function public.can_see_request(p_request uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select public.app_role() is not null and exists (
    select 1 from public.requests r where r.id = p_request and (
      r.requester_id = auth.uid()
      or (r.status <> 'nhap' and (public.is_manager() or public.is_request_approver(r.id)
           or (public.is_duty('ke_toan') and r.kind in ('thanh_toan','tam_ung','mua_hang') and r.status in ('da_duyet','hoan_tat'))))
      or (r.kind = 'loa' and (public.loa_can_use(r.id) or public.loa_linked_visible(r.id)))
      or (r.kind = 'mua_hang' and r.status <> 'nhap' and public.purchase_linked_visible(r.id))
      or (r.kind = 'cong_tac' and r.status <> 'nhap'
          and (r.traveler_id = auth.uid() or (public.is_duty('nhan_su') and r.status in ('da_duyet','hoan_tat'))))))
$$;

drop policy if exists requests_select_purchase on public.requests;
create policy requests_select_purchase on public.requests for select to authenticated
  using (kind = 'mua_hang' and status <> 'nhap'
         and ((public.is_duty('ke_toan') and status in ('da_duyet','hoan_tat')) or public.purchase_linked_visible(id)));

create or replace function public.tg_requests_purchase_guard() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.kind <> 'thanh_toan' then new.purchase_id := null; return new; end if;
  if new.purchase_id is not null and (tg_op = 'INSERT' or new.purchase_id is distinct from old.purchase_id) then
    if not exists (select 1 from public.requests p where p.id = new.purchase_id and p.kind = 'mua_hang' and p.status in ('da_duyet','hoan_tat')) then
      raise exception 'Chỉ tham chiếu được đề nghị mua hàng đã duyệt xong';
    end if;
    if auth.uid() is not null and not public.can_see_request(new.purchase_id) then
      raise exception 'Bạn không xem được đề nghị mua hàng này';
    end if;
  end if;
  return new;
end $$;
drop trigger if exists requests_purchase_guard on public.requests;
create trigger requests_purchase_guard before insert or update on public.requests
  for each row execute function public.tg_requests_purchase_guard();

-- Đề nghị mua hàng đã duyệt mà mình được dùng để lập thanh toán, kèm số đã đề nghị thanh toán
create or replace function public.purchase_pickable() returns table(
  id uuid, doc_no text, reason text, amount bigint, requester_name text, doc_date date, building_id uuid,
  project_id uuid, project_item_id uuid, payee text, paid bigint, pending bigint)
language sql stable security definer set search_path = public as $$
  select p.id, p.doc_no, p.reason, p.amount, pr.full_name, p.doc_date, p.building_id, p.project_id, p.project_item_id, p.payee,
    coalesce((select sum(q.amount) from public.requests q where q.purchase_id = p.id and q.kind = 'thanh_toan' and q.status in ('da_duyet','hoan_tat')), 0)::bigint,
    coalesce((select sum(q.amount) from public.requests q where q.purchase_id = p.id and q.kind = 'thanh_toan' and q.status = 'cho_duyet'), 0)::bigint
  from public.requests p left join public.profiles pr on pr.id = p.requester_id
  where p.kind = 'mua_hang' and p.status in ('da_duyet','hoan_tat') and public.can_see_request(p.id)
  order by p.doc_date desc nulls last, p.created_at desc
  limit 300
$$;

-- Các đề nghị thanh toán tham chiếu một đề nghị mua hàng
create or replace function public.purchase_linked(p_pr uuid) returns table(
  id uuid, doc_no text, reason text, amount bigint, status request_status, requester_name text, created_at timestamptz, can_open boolean)
language sql stable security definer set search_path = public as $$
  select q.id, q.doc_no, case when public.can_see_request(q.id) then q.reason end, q.amount, q.status, pr.full_name, q.created_at,
         public.can_see_request(q.id)
    from public.requests q left join public.profiles pr on pr.id = q.requester_id
   where q.purchase_id = p_pr and q.kind = 'thanh_toan' and q.status <> 'nhap' and public.can_see_request(p_pr)
   order by q.created_at desc
$$;

do $$ declare f text; begin
  foreach f in array array['purchase_linked_visible(uuid)', 'purchase_pickable()', 'purchase_linked(uuid)'] loop
    execute format('revoke execute on function public.%s from public, anon', f);
    execute format('grant execute on function public.%s to authenticated', f);
  end loop;
end $$;
revoke execute on function public.tg_requests_purchase_guard() from public, anon, authenticated;
