-- 091: Chi phí toà do nhân viên (Sale) tự ứng tiền, quyết toán qua đề nghị thanh toán / tạm ứng
--  * building_expenses: paid_by (người ứng tiền), pay_source ('nhan_vien' tự ứng | 'cong_ty' công ty trả thẳng),
--    settle_status: chua_quyet_toan → cho_quyet_toan (đã gắn vào ĐNTT/tạm ứng) → da_quyet_toan (kế toán đã chi).
--  * Nhân sự phụ trách toà ghi chi (expense_save). Chỉ sửa / xoá khoản của mình khi chưa quyết toán; Quản lý, Kế toán sửa được mọi khoản chưa gắn đề nghị.
--  * expense_link(đề nghị, các khoản): người lập ĐNTT / tạm ứng chọn khoản mình đã ứng.
--  * Kế toán bấm "Kết thúc / đã chi" (status hoan_tat) → các khoản gắn kèm thành "Đã quyết toán với công ty".
--    Đề nghị bị từ chối / huỷ → khoản trả về "Chưa quyết toán".
--  * Sổ thu chi / báo cáo: ĐNTT có khoản chi gắn kèm chỉ tính phần còn lại, tránh tính hai lần.

alter table public.building_expenses
  add column if not exists paid_by uuid references public.profiles(id) on delete set null default auth.uid(),
  add column if not exists pay_source text not null default 'nhan_vien' check (pay_source in ('nhan_vien', 'cong_ty')),
  add column if not exists settle_status text not null default 'chua_quyet_toan'
    check (settle_status in ('chua_quyet_toan', 'cho_quyet_toan', 'da_quyet_toan')),
  add column if not exists request_id uuid references public.requests(id) on delete set null,
  add column if not exists settled_at timestamptz,
  add column if not exists settle_note text;
update public.building_expenses set paid_by = coalesce(paid_by, created_by);
create index if not exists building_expenses_request on public.building_expenses(request_id);
create index if not exists building_expenses_paid_by on public.building_expenses(paid_by, settle_status);

drop policy if exists bexp_select on public.building_expenses;
create policy bexp_select on public.building_expenses for select to authenticated
  using (public.is_payer() or paid_by = (select auth.uid()) or created_by = (select auth.uid())
         or public.can_manage_building(building_id));

-- Ghi / sửa khoản chi
drop function if exists public.expense_save(uuid, uuid, date, text, numeric, text);
create or replace function public.expense_save(p_id uuid, p_building uuid, p_date date, p_category text, p_amount numeric,
                                               p_note text, p_source text default 'nhan_vien')
returns uuid language plpgsql security definer set search_path = public as $$
declare nid uuid; e public.building_expenses; me uuid := auth.uid(); payer boolean := public.is_payer();
  src text := coalesce(nullif(p_source, ''), 'nhan_vien');
begin
  if public.app_role() is null then raise exception 'Cần đăng nhập bằng tài khoản nhân sự'; end if;
  if p_building is null then raise exception 'Chọn toà nhà'; end if;
  if not (payer or public.can_access_building(p_building)) then raise exception 'Bạn không phụ trách toà này'; end if;
  if p_amount is null or p_amount <= 0 then raise exception 'Số tiền chi phải lớn hơn 0'; end if;
  if src not in ('nhan_vien', 'cong_ty') then raise exception 'Hình thức chi không hợp lệ'; end if;
  if src = 'cong_ty' and not payer then raise exception 'Chỉ Quản lý hoặc Kế toán ghi khoản công ty trả trực tiếp'; end if;
  if p_id is null then
    insert into public.building_expenses (building_id, spent_on, category, amount, note, paid_by, pay_source, settle_status, settled_at, settle_note)
    values (p_building, coalesce(p_date, (now() at time zone 'Asia/Ho_Chi_Minh')::date), coalesce(nullif(btrim(p_category),''), 'Khác'), p_amount,
            nullif(btrim(coalesce(p_note,'')),''), case when src = 'cong_ty' then null else me end, src,
            case when src = 'cong_ty' then 'da_quyet_toan' else 'chua_quyet_toan' end,
            case when src = 'cong_ty' then now() end,
            case when src = 'cong_ty' then 'Công ty thanh toán trực tiếp' end)
    returning id into nid;
  else
    select * into e from public.building_expenses where id = p_id for update;
    if not found then raise exception 'Không tìm thấy khoản chi'; end if;
    if e.settle_status <> 'chua_quyet_toan' and not (payer and e.request_id is null) then
      raise exception 'Khoản chi đã gắn đề nghị hoặc đã quyết toán, không sửa được';
    end if;
    if not (payer or e.paid_by = me) then raise exception 'Chỉ người ứng tiền hoặc Kế toán sửa khoản chi này'; end if;
    update public.building_expenses set building_id = p_building, spent_on = coalesce(p_date, spent_on),
      category = coalesce(nullif(btrim(p_category),''), 'Khác'), amount = p_amount, note = nullif(btrim(coalesce(p_note,'')),'')
    where id = p_id returning id into nid;
  end if;
  return nid;
end $$;
revoke execute on function public.expense_save(uuid, uuid, date, text, numeric, text, text) from public, anon;
grant execute on function public.expense_save(uuid, uuid, date, text, numeric, text, text) to authenticated;

create or replace function public.expense_delete(p_id uuid) returns void
language plpgsql security definer set search_path = public as $$
declare e public.building_expenses;
begin
  select * into e from public.building_expenses where id = p_id for update;
  if not found then raise exception 'Không tìm thấy khoản chi'; end if;
  if e.request_id is not null or e.settle_status = 'cho_quyet_toan' then raise exception 'Khoản chi đang gắn đề nghị, gỡ khỏi đề nghị trước'; end if;
  if not (public.is_payer() or (e.paid_by = auth.uid() and e.settle_status = 'chua_quyet_toan')) then
    raise exception 'Chỉ người ứng tiền (khi chưa quyết toán) hoặc Kế toán xoá khoản chi';
  end if;
  delete from public.building_expenses where id = p_id;
end $$;

-- Người lập ĐNTT / tạm ứng chọn các khoản mình đã ứng. Gọi lại để thay danh sách.
create or replace function public.expense_link(p_request uuid, p_ids uuid[]) returns numeric
language plpgsql security definer set search_path = public as $$
declare r public.requests; me uuid := auth.uid(); n int; tot numeric;
begin
  select * into r from public.requests where id = p_request for update;
  if not found then raise exception 'Không tìm thấy đề nghị'; end if;
  if r.kind not in ('thanh_toan', 'tam_ung') then raise exception 'Chỉ gắn khoản chi vào đề nghị thanh toán hoặc tạm ứng'; end if;
  if r.requester_id <> me then raise exception 'Chỉ người lập đề nghị chọn khoản chi'; end if;
  if r.status not in ('nhap', 'cho_duyet', 'tra_lai') then raise exception 'Đề nghị đã duyệt, không đổi khoản chi được'; end if;
  p_ids := coalesce(p_ids, '{}');
  select count(*) into n from public.building_expenses e
   where e.id = any(p_ids) and not (e.paid_by = me and (e.settle_status = 'chua_quyet_toan' or e.request_id = p_request));
  if n > 0 then raise exception 'Có khoản chi không phải bạn ứng hoặc đã gắn đề nghị khác'; end if;
  update public.building_expenses set request_id = null, settle_status = 'chua_quyet_toan'
   where request_id = p_request and not (id = any(p_ids));
  update public.building_expenses set request_id = p_request, settle_status = 'cho_quyet_toan'
   where id = any(p_ids);
  select coalesce(sum(amount), 0) into tot from public.building_expenses where request_id = p_request;
  return tot;
end $$;
revoke execute on function public.expense_link(uuid, uuid[]) from public, anon;
grant execute on function public.expense_link(uuid, uuid[]) to authenticated;

-- Kế toán chi xong → đã quyết toán; từ chối / huỷ → trả về chưa quyết toán
create or replace function public.tg_requests_settle_expenses() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.status is not distinct from old.status then return null; end if;
  if new.status = 'hoan_tat' then
    update public.building_expenses set settle_status = 'da_quyet_toan', settled_at = now(),
      settle_note = 'Đã quyết toán với công ty · ' || coalesce(new.doc_no, 'đề nghị') || ' · '
                    || to_char(now() at time zone 'Asia/Ho_Chi_Minh', 'DD/MM/YYYY')
     where request_id = new.id;
  elsif new.status in ('tu_choi', 'da_huy') then
    update public.building_expenses set settle_status = 'chua_quyet_toan', request_id = null
     where request_id = new.id;
  end if;
  return null;
end $$;
revoke execute on function public.tg_requests_settle_expenses() from public, anon, authenticated;
drop trigger if exists requests_settle_expenses on public.requests;
create trigger requests_settle_expenses after update of status on public.requests
  for each row execute function public.tg_requests_settle_expenses();

-- Sổ thu chi: ĐNTT/tạm ứng chỉ tính phần không trùng với khoản chi đã gắn
do $$
declare d text := pg_get_functiondef('public.building_ledger(uuid,date,date)'::regprocedure);
        a text := 'coalesce(q.reason, ''''), q.amount, case q.kind when ''tam_ung'' then ''Tạm ứng'' else ''ĐNTT'' end, q.doc_no, q.building_id, null::text';
        b text := 'where q.kind in (''thanh_toan'', ''tam_ung'') and q.status in (''da_duyet'', ''hoan_tat'') and q.amount > 0';
begin
  if position(a in d) = 0 or position(b in d) = 0 then raise exception '091: không thấy đoạn cần vá trong building_ledger'; end if;
  d := replace(d, a, 'coalesce(q.reason, ''''), q.amount - coalesce((select sum(x.amount) from public.building_expenses x where x.request_id = q.id), 0), case q.kind when ''tam_ung'' then ''Tạm ứng'' else ''ĐNTT'' end, q.doc_no, q.building_id, null::text');
  d := replace(d, b, b || ' and q.amount > coalesce((select sum(x.amount) from public.building_expenses x where x.request_id = q.id), 0)');
  execute d;
end $$;

do $$
declare d text := pg_get_functiondef('public.report_cashflow(date,date,text)'::regprocedure);
        a text := 'select q.building_id, q.requester_id, ''chi'', q.amount from public.requests q';
begin
  if position(a in d) = 0 then raise exception '091: không thấy đoạn cần vá trong report_cashflow'; end if;
  d := replace(d, a, 'select q.building_id, q.requester_id, ''chi'', q.amount - coalesce((select sum(x.amount) from public.building_expenses x where x.request_id = q.id), 0) from public.requests q');
  execute d;
end $$;
