-- LOA phần 4: các RPC (lập / sửa / trình duyệt, chọn LOA cho đề nghị tiền, số đã dùng). Chạy sau 047.
-- Danh sách phòng ban cho mọi nhân viên (bảng departments chỉ Trưởng phòng trở lên đọc trực tiếp)
create or replace function public.loa_departments() returns table (id uuid, code text, name text, mine boolean)
language sql stable security definer set search_path = public as $$
  select d.id, d.code, d.name,
    exists (select 1 from public.org_staff o where o.profile_id = auth.uid() and (o.department_id = d.id or o.id = d.head_staff_id))
  from public.departments d where public.app_role() is not null order by d.sort, d.name
$$;

-- Lập / sửa / trình duyệt một LOA. p: subject, category, propose_dept, sbu[], background, seek_approval, pay_receive, currency,
-- amount, tax, budget_status, budget_item_no, details, autosum, start_date, ref_loa_id, report_due, building_id,
-- lines[{description, unit, quantity, unit_price, note}], cowriters[], viewers[], viewer_depts[]
create or replace function public.loa_save(p_id uuid, p jsonb, p_submit boolean default false) returns uuid
language plpgsql security definer set search_path = public as $$
declare
  me uuid := auth.uid(); r public.requests; d public.loa_details; rid uuid := p_id; owner uuid;
  today date := (now() at time zone 'Asia/Ho_Chi_Minh')::date;
  txt constant text[] := array['subject','category','background','seek_approval','pay_receive','currency','tax','budget_status','budget_item_no','details'];
  v jsonb := '{}'::jsonb; k text;
  v_amount bigint := nullif(p->>'amount', '')::bigint;
  v_start date := nullif(p->>'start_date', '')::date;
  v_due date := nullif(p->>'report_due', '')::date;
  v_auto boolean := coalesce((p->>'autosum')::boolean, false);
  v_dept uuid := nullif(p->>'propose_dept', '')::uuid;
  v_ref uuid := nullif(p->>'ref_loa_id', '')::uuid;
  v_building uuid := nullif(p->>'building_id', '')::uuid;
  v_sbu text[] := coalesce((select array_agg(distinct x) from jsonb_array_elements_text(coalesce(p->'sbu', '[]'::jsonb)) x), '{}');
  ln jsonb; i int := 0; q numeric; up bigint; total bigint := 0; u uuid; old_co uuid[];
begin
  if me is null or public.app_role() is null then raise exception 'Cần đăng nhập bằng tài khoản nhân viên'; end if;
  foreach k in array txt loop v := v || jsonb_build_object(k, nullif(btrim(coalesce(p->>k, '')), '')); end loop;
  if v->>'subject' is null then raise exception 'Nhập tiêu đề tờ trình'; end if;
  if v_amount is not null and v_amount < 0 then raise exception 'Số tiền không hợp lệ'; end if;
  if coalesce(v->>'currency', 'VND') not in ('VND','USD') then raise exception 'Loại tiền không hợp lệ'; end if;
  if v_dept is not null and not exists (select 1 from public.departments where id = v_dept) then raise exception 'Đơn vị đề xuất không tồn tại'; end if;

  -- Dự toán: kiểm tra và cộng trước khi ghi
  for ln in select * from jsonb_array_elements(coalesce(p->'lines', '[]'::jsonb)) loop
    i := i + 1;
    if i > 100 then raise exception 'Dự toán tối đa 100 dòng'; end if;
    if nullif(btrim(coalesce(ln->>'description', '')), '') is null then raise exception 'Dự toán dòng %: nhập nội dung', i; end if;
    q := coalesce(nullif(ln->>'quantity', '')::numeric, 1);
    up := coalesce(nullif(ln->>'unit_price', '')::bigint, 0);
    if q <= 0 or up < 0 then raise exception 'Dự toán dòng %: số lượng hoặc đơn giá không hợp lệ', i; end if;
    total := total + round(q * up);
  end loop;
  if v_auto and i > 0 then v_amount := total; end if;

  if rid is null then
    owner := me;
    perform set_config('app.loa_rpc', 'on', true);
    insert into public.requests (kind, status, requester_id, reason, start_date, amount, currency, building_id)
    values ('loa', 'nhap', me, v->>'subject', coalesce(v_start, today), v_amount, coalesce(v->>'currency', 'VND'), v_building)
    returning id into rid;
    perform set_config('app.loa_rpc', 'off', true);
    insert into public.loa_details (request_id, subject, updated_by) values (rid, v->>'subject', me);
  else
    select * into r from public.requests where id = rid for update;
    if not found or r.kind <> 'loa' then raise exception 'Không tìm thấy tờ trình'; end if;
    if not public.loa_can_edit(rid) then raise exception 'Tờ trình đang trong quá trình duyệt, đã duyệt xong, hoặc bạn không có quyền sửa'; end if;
    owner := r.requester_id;
    perform set_config('app.step_flow', 'on', true);
    update public.requests set reason = v->>'subject', start_date = coalesce(v_start, r.start_date), amount = v_amount,
      currency = coalesce(v->>'currency', 'VND'), building_id = v_building where id = rid;
    perform set_config('app.step_flow', 'off', true);
  end if;

  if v_ref is not null and (v_ref = rid or not exists (select 1 from public.requests x where x.id = v_ref and x.kind = 'loa' and public.can_see_request(x.id))) then
    raise exception 'LOA tham chiếu không hợp lệ';
  end if;
  update public.loa_details set subject = v->>'subject', category = v->>'category', propose_dept = v_dept, sbu = v_sbu,
    background = v->>'background', seek_approval = v->>'seek_approval', pay_receive = coalesce(v->>'pay_receive', 'chi'),
    tax = coalesce(v->>'tax', 'chua_gom'), budget_status = coalesce(v->>'budget_status', 'trong'), budget_item_no = v->>'budget_item_no',
    details = v->>'details', autosum = v_auto, ref_loa_id = v_ref, report_due = v_due, updated_by = me, updated_at = now()
  where request_id = rid;

  delete from public.loa_lines where request_id = rid;
  i := 0;
  for ln in select * from jsonb_array_elements(coalesce(p->'lines', '[]'::jsonb)) loop
    i := i + 1;
    q := coalesce(nullif(ln->>'quantity', '')::numeric, 1);
    up := coalesce(nullif(ln->>'unit_price', '')::bigint, 0);
    insert into public.loa_lines (request_id, line_no, description, unit, quantity, unit_price, amount, note)
    values (rid, i, btrim(ln->>'description'), nullif(btrim(coalesce(ln->>'unit', '')), ''), q, up, round(q * up), nullif(btrim(coalesce(ln->>'note', '')), ''));
  end loop;

  -- Người cùng soạn, cá nhân và đơn vị được xem
  select coalesce(array_agg(user_id), '{}') into old_co from public.loa_members where request_id = rid and role = 'soan';
  delete from public.loa_members where request_id = rid;
  for u in select distinct x::uuid from jsonb_array_elements_text(coalesce(p->'cowriters', '[]'::jsonb)) x loop
    if u = owner then continue; end if;
    if not exists (select 1 from public.profiles pr where pr.id = u and pr.is_active and pr.role not in ('cong_tac_vien','khach_hang')) then
      raise exception 'Người cùng soạn phải là nhân viên đang làm việc';
    end if;
    insert into public.loa_members (request_id, user_id, role) values (rid, u, 'soan');
    if u <> me and not (u = any (old_co)) then
      perform public.notify(u, 'khac', 'Bạn được thêm làm người cùng soạn tờ trình',
        (select full_name from public.profiles where id = owner) || ': ' || (v->>'subject'), 'request', rid);
    end if;
  end loop;
  for u in select distinct x::uuid from jsonb_array_elements_text(coalesce(p->'viewers', '[]'::jsonb)) x loop
    if u = owner then continue; end if;
    if not exists (select 1 from public.profiles pr where pr.id = u and pr.is_active and pr.role not in ('cong_tac_vien','khach_hang')) then
      raise exception 'Người được xem phải là nhân viên đang làm việc';
    end if;
    insert into public.loa_members (request_id, user_id, role) values (rid, u, 'xem') on conflict (request_id, user_id) do nothing;
  end loop;
  delete from public.loa_viewer_depts where request_id = rid;
  insert into public.loa_viewer_depts (request_id, department_id)
  select distinct rid, x::uuid from jsonb_array_elements_text(coalesce(p->'viewer_depts', '[]'::jsonb)) x
  where exists (select 1 from public.departments dp where dp.id = x::uuid);

  if p_submit then
    select * into r from public.requests where id = rid for update;
    select * into d from public.loa_details where request_id = rid;
    if r.requester_id <> me then raise exception 'Chỉ người lập tờ trình mới trình duyệt được. Người cùng soạn bấm Lưu nháp'; end if;
    if d.category is null then raise exception 'Chọn phân loại'; end if;
    if d.propose_dept is null then raise exception 'Chọn đơn vị đề xuất cuối cùng'; end if;
    if coalesce(array_length(d.sbu, 1), 0) = 0 then raise exception 'Chọn mảng kinh doanh (chọn Không áp dụng nếu không thuộc mảng nào)'; end if;
    if d.background is null then raise exception 'Nhập bối cảnh'; end if;
    if d.seek_approval is null then raise exception 'Nhập nội dung xin phê duyệt'; end if;
    if r.amount is null then raise exception 'Nhập số tiền (nhập 0 nếu tờ trình không phát sinh tiền)'; end if;
    if v_start is null then raise exception 'Chọn ngày bắt đầu'; end if;
    if d.report_due is null then raise exception 'Chọn hạn báo cáo kết quả'; end if;
    if d.report_due < r.start_date then raise exception 'Hạn báo cáo kết quả phải từ ngày bắt đầu trở đi'; end if;
    if d.pay_receive = 'chi' and r.amount > 0 and not exists (select 1 from public.loa_lines l where l.request_id = rid) then
      raise exception 'Nhập bảng dự toán ngân sách (ít nhất 1 dòng) cho tờ trình có chi tiền';
    end if;
    delete from public.request_steps where request_id = rid;
    perform set_config('app.step_flow', 'on', true);
    perform set_config('app.loa_rpc', 'on', true);
    update public.requests set status = 'cho_duyet' where id = rid;
    perform set_config('app.loa_rpc', 'off', true);
    perform set_config('app.step_flow', 'off', true);
    update public.loa_details set submitted_at = now() where request_id = rid;
    perform public.build_steps(rid);
  end if;
  return rid;
end $$;

-- LOA chi tiền đã duyệt mà người dùng được gắn vào đề nghị thanh toán / tạm ứng, kèm số đã dùng
create or replace function public.loa_pickable() returns table (
  id uuid, doc_no text, subject text, amount bigint, used bigint, pending bigint, start_date date, requester_name text)
language sql stable security definer set search_path = public as $$
  select l.id, l.doc_no, d.subject, l.amount,
    coalesce((select sum(x.amount) from public.requests x where x.loa_id = l.id and x.kind in ('thanh_toan','tam_ung') and x.status in ('da_duyet','hoan_tat')), 0)::bigint,
    coalesce((select sum(x.amount) from public.requests x where x.loa_id = l.id and x.kind in ('thanh_toan','tam_ung') and x.status = 'cho_duyet'), 0)::bigint,
    l.start_date, pr.full_name
  from public.requests l join public.loa_details d on d.request_id = l.id left join public.profiles pr on pr.id = l.requester_id
  where l.kind = 'loa' and l.status = 'da_duyet' and d.pay_receive = 'chi' and l.currency = 'VND' and coalesce(l.amount, 0) > 0
    and public.loa_can_use(l.id)
  order by l.doc_date desc nulls last, l.created_at desc
$$;

-- Tóm tắt một LOA và số đã dùng (cho người xem được LOA đó)
create or replace function public.loa_brief(p_loa uuid) returns table (
  id uuid, doc_no text, subject text, amount bigint, currency text, status text, pay_receive text, used bigint, pending bigint, requester_name text)
language sql stable security definer set search_path = public as $$
  select l.id, l.doc_no, d.subject, l.amount, l.currency, l.status::text, d.pay_receive,
    coalesce((select sum(x.amount) from public.requests x where x.loa_id = l.id and x.kind in ('thanh_toan','tam_ung') and x.status in ('da_duyet','hoan_tat')), 0)::bigint,
    coalesce((select sum(x.amount) from public.requests x where x.loa_id = l.id and x.kind in ('thanh_toan','tam_ung') and x.status = 'cho_duyet'), 0)::bigint,
    pr.full_name
  from public.requests l join public.loa_details d on d.request_id = l.id left join public.profiles pr on pr.id = l.requester_id
  where l.id = p_loa and l.kind = 'loa' and public.can_see_request(l.id)
$$;

-- Các đề nghị thanh toán / tạm ứng đã gắn vào một LOA
create or replace function public.loa_linked(p_loa uuid) returns table (
  id uuid, kind text, doc_no text, requester_name text, amount bigint, status text, created_at timestamptz, can_open boolean)
language sql stable security definer set search_path = public as $$
  select x.id, x.kind::text, x.doc_no, pr.full_name, x.amount, x.status::text, x.created_at, public.can_see_request(x.id)
  from public.requests x left join public.profiles pr on pr.id = x.requester_id
  where x.loa_id = p_loa and x.kind in ('thanh_toan','tam_ung') and public.can_see_request(p_loa)
  order by x.created_at
$$;

revoke execute on function public.loa_departments(), public.loa_save(uuid, jsonb, boolean), public.loa_pickable(), public.loa_brief(uuid), public.loa_linked(uuid) from public, anon;
grant execute on function public.loa_departments(), public.loa_save(uuid, jsonb, boolean), public.loa_pickable(), public.loa_brief(uuid), public.loa_linked(uuid) to authenticated;
