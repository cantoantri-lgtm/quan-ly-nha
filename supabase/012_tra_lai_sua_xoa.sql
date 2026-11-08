-- =====================================================================
-- Neo Nestly · TRẢ LẠI, SỬA, XOÁ ĐỀ NGHỊ  (chạy sau 012a)
--   - Cấp duyệt có 3 quyền: Duyệt / Từ chối / Trả lại (trả về người lập để sửa, gửi lại thì duyệt lại từ cấp đầu).
--   - Sửa và xoá chỉ được khi đề nghị KHÔNG đang trong quá trình duyệt: bị trả lại, bị từ chối hoặc đã rút.
--   - Đang chờ duyệt hoặc đã duyệt xong: không sửa, không xoá (người lập vẫn có thể "Rút lại" khi còn chờ duyệt).
-- =====================================================================

alter table public.request_steps drop constraint if exists request_steps_status_check;
alter table public.request_steps add constraint request_steps_status_check
  check (status in ('cho','da_duyet','tu_choi','bo_qua','tra_lai'));

-- Chỉ sửa được khi không đang trong quá trình duyệt
create or replace function public.request_editable(p_request uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.requests r where r.id = p_request and r.status in ('tra_lai','tu_choi','da_huy'))
$$;

-- Chặn thay đổi trái phép trên bảng đề nghị
create or replace function public.tg_requests_guard() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  me   uuid := auth.uid();
  mgr  boolean := public.is_manager();
  flow boolean := coalesce(current_setting('app.step_flow', true), '') = 'on';
  fixed constant text[] := array['status','approver_id','decided_at','decision_note','paid_at','paid_by',
    'actual_start','actual_end','actual_cost','actual_note','reported_at','days','updated_at','created_at'];
  actual constant text[] := array['actual_start','actual_end','actual_cost','actual_note'];
begin
  if tg_op = 'UPDATE' and me is not null then
    new.id := old.id; new.kind := old.kind; new.requester_id := old.requester_id; new.created_at := old.created_at;
    new.approver_id := old.approver_id; new.decided_at := old.decided_at;
    new.paid_at := old.paid_at; new.paid_by := old.paid_by; new.reported_at := old.reported_at;
    if not mgr and not flow then new.decision_note := old.decision_note; end if;

    if not flow and (to_jsonb(new) - fixed) is distinct from (to_jsonb(old) - fixed)
       and not (old.requester_id = me and public.request_editable(old.id)) then
      raise exception 'Chỉ sửa được đề nghị khi không đang trong quá trình duyệt (bị trả lại, bị từ chối hoặc đã rút)';
    end if;
    if (select jsonb_object_agg(k, to_jsonb(new) -> k) from unnest(actual) k)
         is distinct from (select jsonb_object_agg(k, to_jsonb(old) -> k) from unnest(actual) k)
       and not (old.requester_id = me and old.kind = 'cong_tac' and old.status in ('da_duyet','hoan_tat')) then
      raise exception 'Chỉ người đi công tác nhập thực tế sau khi được duyệt';
    end if;

    if new.status is distinct from old.status then
      if new.status = 'da_huy' and old.requester_id = me
         and (old.status = 'cho_duyet'
              or (old.status = 'da_duyet' and old.kind in ('nghi_phep','ra_ngoai','cong_tac')
                  and old.start_date > (now() at time zone 'Asia/Ho_Chi_Minh')::date)) then
        null;
      elsif flow and old.status = 'cho_duyet' and new.status in ('da_duyet','tu_choi','tra_lai') then
        new.approver_id := me; new.decided_at := now();
      elsif flow and old.status in ('tra_lai','tu_choi','da_huy') and new.status = 'cho_duyet' then
        -- gửi lại: xoá dấu vết của lần duyệt trước (hàm resubmit_request dựng lại luồng duyệt)
        new.approver_id := null; new.decided_at := null; new.decision_note := null;
      elsif flow and old.status = 'da_duyet' and new.status = 'hoan_tat' and old.kind in ('thanh_toan','tam_ung') then
        new.paid_at := now(); new.paid_by := me;
      elsif new.status = 'hoan_tat' and old.status = 'da_duyet' and old.kind = 'cong_tac' and old.requester_id = me then
        if new.actual_start is null or new.actual_end is null then
          raise exception 'Cần nhập ngày đi và ngày về thực tế';
        end if;
        new.reported_at := now();
      else
        raise exception 'Không thể chuyển đề nghị sang trạng thái này';
      end if;
    end if;
  end if;

  if tg_op = 'INSERT' then
    if me is not null then new.requester_id := me; end if;
    new.status := 'cho_duyet';
    new.approver_id := null; new.decided_at := null; new.decision_note := null;
    new.paid_at := null; new.paid_by := null; new.reported_at := null;
    new.actual_start := null; new.actual_end := null; new.actual_cost := null; new.actual_note := null;
  end if;

  if new.kind = 'nghi_phep' then
    if new.span <> 'ca_ngay' then new.end_date := new.start_date; end if;
    new.end_date := coalesce(new.end_date, new.start_date);
    new.days := case when new.span = 'ca_ngay'
      then (select count(*) from generate_series(new.start_date, new.end_date, interval '1 day') d
            where extract(isodow from d) <> 7)
      else 0.5 end;
    if new.days = 0 or (new.span <> 'ca_ngay' and extract(isodow from new.start_date) = 7) then
      raise exception 'Chủ nhật công ty nghỉ, không cần xin nghỉ phép';
    end if;
    new.start_time := null; new.end_time := null; new.amount := null;
  elsif new.kind = 'ra_ngoai' then
    new.end_date := coalesce(new.end_date, new.start_date);
    new.days := new.end_date - new.start_date + 1;
    new.amount := null;
  elsif new.kind = 'cong_tac' then
    new.days := new.end_date - new.start_date + 1;
  else
    new.end_date := null; new.days := null;
  end if;
  if new.kind <> 'nghi_phep' then new.span := null; end if;
  if new.kind not in ('nghi_phep','ra_ngoai') then new.sub_type := null; end if;
  if new.kind <> 'tam_ung' then new.settle_due := null; end if;
  if new.kind not in ('nghi_phep','ra_ngoai','cong_tac') then new.handover_to := null; new.contact_phone := null; end if;
  if new.kind <> 'cong_tac' then new.transport := null; end if;
  new.updated_at := now();
  return new;
end $$;

-- Thông báo: thêm "được trả lại" cho người lập
create or replace function public.tg_requests_notify() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  who   text;
  label text := public.request_label(new.kind, new.sub_type);
  what  text;
  m     record;
  cur   public.request_steps;
begin
  if tg_op = 'INSERT' then return null; end if;
  select full_name into who from public.profiles where id = new.requester_id;
  what := label || case
    when new.kind in ('thanh_toan','tam_ung') then ' · ' || replace(to_char(new.amount, 'FM999,999,999,999'), ',', '.') || ' đ'
    when new.kind = 'nghi_phep' then ' · ' || case when new.days = 0.5 then 'nửa ngày' else trim(to_char(new.days, 'FM990.0')) || ' ngày' end
      || ' từ ' || to_char(new.start_date, 'DD/MM')
    else ' · ' || to_char(new.start_date, 'DD/MM') end;
  what := replace(what, '.0 ngày', ' ngày');

  if new.status is distinct from old.status then
    if new.status = 'tra_lai' then
      perform public.notify(new.requester_id, 'khac', 'Đề nghị được trả lại để sửa',
        what || coalesce(' — ' || nullif(trim(new.decision_note), ''), ''), 'request', new.id);
    elsif new.status in ('da_duyet','tu_choi') and new.approver_id is distinct from new.requester_id then
      perform public.notify(new.requester_id, 'khac',
        case new.status when 'da_duyet' then 'Đề nghị đã được duyệt xong' else 'Đề nghị bị từ chối' end,
        what || coalesce(' — ' || nullif(trim(new.decision_note), ''), ''), 'request', new.id);
      if new.status = 'da_duyet' and new.kind in ('thanh_toan','tam_ung') then
        for m in select pr.id from public.profiles pr where pr.is_active and pr.id <> new.requester_id
                   and (pr.role = 'quan_ly' or exists (select 1 from public.org_staff o where o.profile_id = pr.id and o.duty = 'ke_toan')) loop
          perform public.notify(m.id, 'khac', 'Đã duyệt, chờ chi tiền', coalesce(who, '?') || ': ' || what, 'request', new.id);
        end loop;
      end if;
    elsif new.status = 'hoan_tat' and new.kind = 'cong_tac' and new.approver_id is distinct from new.requester_id then
      perform public.notify(new.approver_id, 'khac', 'Đã nhập thực tế công tác', coalesce(who, '?') || ': ' || what, 'request', new.id);
    elsif new.status = 'hoan_tat' and new.kind in ('thanh_toan','tam_ung') and new.paid_by is distinct from new.requester_id then
      perform public.notify(new.requester_id, 'khac', 'Đã chi tiền', what, 'request', new.id);
    elsif new.status = 'da_huy' then
      select * into cur from public.request_steps where request_id = new.id and status = 'cho' order by step_no limit 1;
      if found then perform public.notify_step(new.id, cur, 'Đề nghị đã được rút lại'); end if;
      update public.request_steps set status = 'bo_qua', skip_reason = 'Đề nghị đã rút lại' where request_id = new.id and status = 'cho';
    end if;
  end if;
  return null;
end $$;

-- Cấp duyệt TRẢ LẠI đề nghị cho người lập (bắt buộc ghi lý do)
create or replace function public.return_step(p_request uuid, p_note text) returns void
language plpgsql security definer set search_path = public as $$
declare me uuid := auth.uid(); r public.requests; s public.request_steps;
  v_note text := nullif(trim(coalesce(p_note, '')), '');
begin
  if me is null or public.app_role() is null then raise exception 'Cần đăng nhập'; end if;
  select * into r from public.requests where id = p_request for update;
  if not found then raise exception 'Không tìm thấy đề nghị'; end if;
  if r.status <> 'cho_duyet' then raise exception 'Đề nghị không còn chờ duyệt'; end if;
  if r.requester_id = me then raise exception 'Không tự trả lại đề nghị của mình'; end if;
  select * into s from public.request_steps where request_id = p_request and status = 'cho' order by step_no limit 1;
  if not found then raise exception 'Đề nghị không có bước nào chờ duyệt'; end if;
  if not (s.approver_id = me or (s.approver_id is null and public.is_manager())) then
    raise exception 'Chưa đến lượt bạn xử lý đề nghị này';
  end if;
  if v_note is null then raise exception 'Cần ghi lý do trả lại'; end if;

  update public.request_steps set status = 'tra_lai', decided_by = me, decided_at = now(), note = v_note where id = s.id;
  update public.request_steps set status = 'bo_qua', skip_reason = 'Đề nghị được trả lại'
   where request_id = p_request and status = 'cho';
  perform set_config('app.step_flow', 'on', true);
  update public.requests set status = 'tra_lai', decision_note = v_note where id = p_request;
  perform set_config('app.step_flow', 'off', true);
end $$;
revoke execute on function public.return_step(uuid, text) from public, anon;
grant execute on function public.return_step(uuid, text) to authenticated;

-- Người lập gửi lại sau khi sửa: duyệt lại từ cấp đầu
create or replace function public.resubmit_request(p_request uuid) returns void
language plpgsql security definer set search_path = public as $$
declare me uuid := auth.uid(); r public.requests;
begin
  if me is null or public.app_role() is null then raise exception 'Cần đăng nhập'; end if;
  select * into r from public.requests where id = p_request for update;
  if not found then raise exception 'Không tìm thấy đề nghị'; end if;
  if r.requester_id <> me then raise exception 'Chỉ người lập đề nghị mới gửi lại được'; end if;
  if r.status not in ('tra_lai','tu_choi','da_huy') then raise exception 'Đề nghị này không ở trạng thái cần gửi lại'; end if;
  delete from public.request_steps where request_id = p_request;
  perform set_config('app.step_flow', 'on', true);
  update public.requests set status = 'cho_duyet' where id = p_request;
  perform set_config('app.step_flow', 'off', true);
  perform public.build_steps(p_request);
end $$;
revoke execute on function public.resubmit_request(uuid) from public, anon;
grant execute on function public.resubmit_request(uuid) to authenticated;

-- Xoá: người lập hoặc Quản lý, chỉ khi KHÔNG đang trong quá trình duyệt (cùng điều kiện với sửa)
drop policy if exists requests_delete on public.requests;
create policy requests_delete on public.requests for delete to authenticated
  using ((requester_id = (select auth.uid()) or public.is_manager()) and status in ('tra_lai','tu_choi','da_huy'));

-- Link đính kèm: người lập thêm / xoá được khi còn chờ duyệt hoặc ở trạng thái được phép sửa
drop policy if exists rk_delete on public.request_links;
create policy rk_delete on public.request_links for delete to authenticated
  using (exists (select 1 from public.requests r where r.id = request_links.request_id
         and ((r.requester_id = (select auth.uid()) and r.status in ('cho_duyet','tra_lai','tu_choi','da_huy')) or public.is_manager())));
drop policy if exists rk_insert on public.request_links;
create policy rk_insert on public.request_links for insert to authenticated
  with check (exists (select 1 from public.requests r where r.id = request_links.request_id
         and ((r.requester_id = (select auth.uid()) and r.status in ('cho_duyet','da_duyet','tra_lai','tu_choi','da_huy')) or public.is_manager())));
