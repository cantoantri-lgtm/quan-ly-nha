-- 081: Đề nghị mua hàng gắn Tờ trình (LOA) tham khảo (không bắt buộc).
-- Cùng điều kiện như thanh toán / tạm ứng: LOA chi tiền VND đã duyệt, người lập được dùng LOA đó.
-- Cài đặt "bắt buộc LOA cho đề nghị chi tiền" không áp cho mua hàng.
-- Mua hàng KHÔNG trừ dự toán LOA (chỉ thanh toán / tạm ứng trừ), để không tính 2 lần khi thanh toán theo mua hàng.

do $$
declare d text;
begin
  d := pg_get_functiondef('public.tg_requests_guard()'::regprocedure);
  if position($x$if new.kind in ('thanh_toan','tam_ung') then$x$ in d) = 0 or position('if need_loa then' in d) = 0 then
    raise exception 'tg_requests_guard đã khác bản đang chạy';
  end if;
  d := replace(d, $x$if new.kind in ('thanh_toan','tam_ung') then$x$, $x$if new.kind in ('thanh_toan','tam_ung','mua_hang') then$x$);
  d := replace(d, 'if need_loa then', $x$if need_loa and new.kind <> 'mua_hang' then$x$);
  execute d;
end $$;

-- Trang LOA liệt kê cả đề nghị mua hàng dùng LOA; người duyệt mua hàng xem được LOA tham khảo
create or replace function public.loa_linked(p_loa uuid)
returns table(id uuid, kind text, doc_no text, requester_name text, amount bigint, status text, created_at timestamptz, can_open boolean)
language sql stable security definer set search_path = public as $$
  select x.id, x.kind::text, x.doc_no, pr.full_name, x.amount, x.status::text, x.created_at, public.can_see_request(x.id)
  from public.requests x left join public.profiles pr on pr.id = x.requester_id
  where x.loa_id = p_loa and x.kind in ('thanh_toan','tam_ung','mua_hang') and public.can_see_request(p_loa)
  order by x.created_at
$$;

create or replace function public.loa_linked_visible(p_loa uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select public.app_role() is not null and exists (
    select 1 from public.requests l join public.requests p on p.loa_id = l.id and p.kind in ('thanh_toan','tam_ung','mua_hang')
    where l.id = p_loa and l.kind = 'loa' and l.status <> 'nhap'
      and (p.requester_id = auth.uid() or public.is_request_approver(p.id)
           or (public.is_duty('ke_toan') and p.status in ('da_duyet','hoan_tat'))))
$$;

-- Đề nghị mua hàng để chọn khi lập thanh toán: thêm LOA để điền sẵn
drop function if exists public.purchase_pickable();
create function public.purchase_pickable() returns table(
  id uuid, doc_no text, reason text, amount bigint, requester_name text, doc_date date, building_id uuid,
  project_id uuid, project_item_id uuid, payee text, paid bigint, pending bigint, loa_id uuid)
language sql stable security definer set search_path = public as $$
  select p.id, p.doc_no, p.reason, p.amount, pr.full_name, p.doc_date, p.building_id, p.project_id, p.project_item_id, p.payee,
    coalesce((select sum(q.amount) from public.requests q where q.purchase_id = p.id and q.kind = 'thanh_toan' and q.status in ('da_duyet','hoan_tat')), 0)::bigint,
    coalesce((select sum(q.amount) from public.requests q where q.purchase_id = p.id and q.kind = 'thanh_toan' and q.status = 'cho_duyet'), 0)::bigint,
    p.loa_id
  from public.requests p left join public.profiles pr on pr.id = p.requester_id
  where p.kind = 'mua_hang' and p.status in ('da_duyet','hoan_tat') and public.can_see_request(p.id)
  order by p.doc_date desc nulls last, p.created_at desc
  limit 300
$$;
revoke execute on function public.purchase_pickable() from public, anon;
grant execute on function public.purchase_pickable() to authenticated;
