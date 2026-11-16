-- LOA phần 3: luồng duyệt, nhãn, số LOA, trigger kiểm soát và thông báo. Chạy sau 046.
create or replace function public.request_label(k public.request_kind, s text) returns text
language sql immutable set search_path = public as $$
  select case k
    when 'nghi_phep' then case s when 'khong_luong' then 'Nghỉ không lương' else 'Nghỉ phép năm' end
    when 'ra_ngoai'  then 'Làm việc bên ngoài'
    when 'cong_tac'  then 'Đi công tác'
    when 'thanh_toan' then 'Đề nghị thanh toán'
    when 'tam_ung'   then 'Đề nghị tạm ứng'
    when 'loa'       then 'Tờ trình (LOA)'
  end
$$;

create or replace function public.approval_chain(p_requester uuid, p_kind public.request_kind)
returns table (step_no integer, duty text, approver_id uuid, skip_reason text)
language plpgsql stable security definer set search_path = public as $$
declare
  me     public.org_staff;
  head_p uuid; lead_p uuid; gd uuid; ns uuid; kt uuid;
  duties text[]; d text; n int := 0; a uuid; why text; seen uuid[] := array[]::uuid[];
begin
  select * into me from public.org_staff o where o.profile_id = p_requester;
  select s.profile_id into head_p from public.departments dp join public.org_staff s on s.id = dp.head_staff_id
   where dp.id = me.department_id;
  select s.profile_id into lead_p from public.org_staff s
   where s.is_leader and s.profile_id is not null and s.profile_id <> p_requester
     and s.department_id = me.department_id and s.team is not distinct from me.team limit 1;
  select o.profile_id into gd from public.org_staff o where o.duty = 'giam_doc';
  select o.profile_id into ns from public.org_staff o where o.duty = 'nhan_su';
  select o.profile_id into kt from public.org_staff o where o.duty = 'ke_toan';

  duties := case when p_kind in ('thanh_toan','tam_ung','loa')
                 then array['leader','truong_phong','ke_toan','giam_doc']
                 else array['leader','truong_phong','nhan_su'] end;
  foreach d in array duties loop
    n := n + 1; why := null; a := null;
    if d = 'leader' then
      a := lead_p; if a is null then why := 'Chưa có Leader'; end if;
    elsif d = 'truong_phong' then
      a := head_p;
      if a is null or a = p_requester then a := gd; end if;
    elsif d = 'nhan_su' then
      a := ns; if a is null then why := 'Chưa có tài khoản Nhân sự'; end if;
    elsif d = 'ke_toan' then
      a := coalesce(kt, gd);
    else
      a := gd;
    end if;
    if why is null and a is not null then
      if a = p_requester then why := 'Chính người đề nghị';
      elsif a = any(seen) then why := 'Đã duyệt ở bước trước';
      end if;
    end if;
    if why is null and a is not null then seen := seen || a; end if;
    step_no := n; duty := d; approver_id := a; skip_reason := why;
    return next;
  end loop;
end $$;

create or replace function public.tg_requests_steps() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.kind <> 'loa' then perform public.build_steps(new.id); end if;   -- LOA bắt đầu là bản nháp, dựng luồng khi trình duyệt
  return null;
end $$;

create or replace function public.tg_requests_doc() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if tg_op = 'INSERT' then
    if new.kind in ('thanh_toan','tam_ung') then
      if new.kind = 'thanh_toan' and (new.pay_method is null or new.pay_type is null) then
        raise exception 'Chọn hình thức thanh toán và loại thanh toán';
      end if;
      new.doc_no := to_char(now() at time zone 'Asia/Ho_Chi_Minh', 'YYMM') || lpad(nextval('public.request_doc_seq')::text, 4, '0');
      new.doc_date := (now() at time zone 'Asia/Ho_Chi_Minh')::date;
      new.currency := 'VND';
    else
      new.doc_no := null; new.doc_date := null;
    end if;
  elsif auth.uid() is not null then
    new.doc_no := old.doc_no; new.doc_date := old.doc_date;
  end if;
  -- Số LOA cấp khi trình duyệt lần đầu
  if tg_op = 'UPDATE' and new.kind = 'loa' and new.doc_no is null and new.status = 'cho_duyet' then
    new.doc_no := 'LOA-' || to_char(now() at time zone 'Asia/Ho_Chi_Minh', 'YYYY') || '-' || lpad(nextval('public.loa_doc_seq')::text, 4, '0');
    new.doc_date := (now() at time zone 'Asia/Ho_Chi_Minh')::date;
  end if;
  return new;
end $$;

create or replace function public.tg_requests_guard() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  me   uuid := auth.uid();
  mgr  boolean := public.is_manager();
  flow boolean := coalesce(current_setting('app.step_flow', true), '') = 'on';
  loa_rpc boolean := coalesce(current_setting('app.loa_rpc', true), '') = 'on';
  need_loa boolean := coalesce((select s.require_for_payments from public.loa_settings s limit 1), false);
  loa_changed boolean := true;   -- INSERT: coi như vừa chọn LOA
  loa_check boolean := true;
  fixed constant text[] := array['status','approver_id','decided_at','decision_note','paid_at','paid_by',
    'actual_start','actual_end','actual_cost','actual_note','reported_at','days','updated_at','created_at'];
  actual constant text[] := array['actual_start','actual_end','actual_cost','actual_note'];
begin
  if tg_op = 'UPDATE' and me is not null then
    new.id := old.id; new.kind := old.kind; new.requester_id := old.requester_id; new.created_at := old.created_at;
    new.approver_id := old.approver_id; new.decided_at := old.decided_at;
    new.paid_at := old.paid_at; new.paid_by := old.paid_by; new.reported_at := old.reported_at;
    if not mgr and not flow then new.decision_note := old.decision_note; end if;

    if old.kind = 'loa' and not flow and (to_jsonb(new) - fixed) is distinct from (to_jsonb(old) - fixed) then
      raise exception 'Tờ trình (LOA) chỉ sửa được ở màn hình lập tờ trình';
    end if;
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
      elsif flow and old.status in ('nhap','tra_lai','tu_choi','da_huy') and new.status = 'cho_duyet' then
        if old.kind = 'loa' and not loa_rpc then
          raise exception 'Trình duyệt tờ trình (LOA) ở màn hình lập tờ trình: bấm Sửa rồi Trình duyệt';
        end if;
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
    if new.kind = 'loa' and me is not null and not loa_rpc then
      raise exception 'Lập tờ trình (LOA) ở mục Văn phòng số → Tờ trình (LOA)';
    end if;
    if me is not null then new.requester_id := me; end if;
    new.status := case when new.kind = 'loa' then 'nhap'::public.request_status else 'cho_duyet'::public.request_status end;
    new.approver_id := null; new.decided_at := null; new.decision_note := null;
    new.paid_at := null; new.paid_by := null; new.reported_at := null;
    new.actual_start := null; new.actual_end := null; new.actual_cost := null; new.actual_note := null;
  end if;

  -- Đề nghị thanh toán / tạm ứng phải gắn một LOA chi tiền (VND, có dự toán) đã duyệt. Bắt buộc khi loa_settings.require_for_payments = true
  if new.kind in ('thanh_toan','tam_ung') then
    if tg_op = 'UPDATE' then
      loa_changed := new.loa_id is distinct from old.loa_id;
      loa_check := loa_changed or (new.status = 'cho_duyet' and old.status <> 'cho_duyet');
    end if;
    if me is not null and loa_check then
      if new.loa_id is null then
        if need_loa then
          raise exception 'Cần gắn Tờ trình (LOA) đã được duyệt cho đề nghị này. Chưa có thì lập LOA trước';
        end if;
      else
        if not exists (select 1 from public.requests l join public.loa_details d on d.request_id = l.id
                       where l.id = new.loa_id and l.kind = 'loa' and l.status = 'da_duyet' and d.pay_receive = 'chi'
                         and l.currency = 'VND' and coalesce(l.amount, 0) > 0) then
          raise exception 'LOA được chọn chưa duyệt xong, hoặc không phải LOA chi tiền (VND) có dự toán';
        end if;
        if loa_changed and not public.loa_can_use(new.loa_id) then
          raise exception 'Bạn chưa được dùng LOA này. Nhờ người lập LOA thêm bạn hoặc phòng bạn vào danh sách được xem';
        end if;
      end if;
    end if;
    if new.loa_id is not null then new.loa_no := (select l.doc_no from public.requests l where l.id = new.loa_id); end if;
  else
    new.loa_id := null;
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

create or replace function public.notify_step(p_request uuid, p_step public.request_steps, p_title text) returns void
language plpgsql security definer set search_path = public as $$
declare r public.requests; who text; m record; body text;
begin
  select * into r from public.requests where id = p_request;
  select full_name into who from public.profiles where id = r.requester_id;
  body := coalesce(who, '?') || ': ' || public.request_label(r.kind, r.sub_type)
    || case when r.kind = 'loa' then ' · ' || left(r.reason, 80) else '' end
    || case when r.kind in ('thanh_toan','tam_ung') or (r.kind = 'loa' and coalesce(r.amount, 0) > 0)
            then ' · ' || replace(to_char(r.amount, 'FM999,999,999,999'), ',', '.') || case when r.currency = 'VND' then ' đ' else ' ' || r.currency end
            else '' end;
  if p_step.approver_id is not null then
    perform public.notify(p_step.approver_id, 'khac', p_title, body, 'request', p_request);
  else
    for m in select id from public.profiles where role = 'quan_ly' and is_active and id <> r.requester_id loop
      perform public.notify(m.id, 'khac', p_title, body, 'request', p_request);
    end loop;
  end if;
end $$;

create or replace function public.tg_requests_notify() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  who   text;
  label text := public.request_label(new.kind, new.sub_type);
  noun  text := case when new.kind = 'loa' then 'Tờ trình' else 'Đề nghị' end;
  what  text;
  m     record;
  cur   public.request_steps;
begin
  if tg_op = 'INSERT' then return null; end if;
  select full_name into who from public.profiles where id = new.requester_id;
  what := label || case
    when new.kind = 'loa' then coalesce(' ' || new.doc_no, '') || ' · ' || left(new.reason, 80)
      || case when coalesce(new.amount, 0) > 0 then ' · ' || replace(to_char(new.amount, 'FM999,999,999,999'), ',', '.') || case when new.currency = 'VND' then ' đ' else ' ' || new.currency end else '' end
    when new.kind in ('thanh_toan','tam_ung') then ' · ' || replace(to_char(new.amount, 'FM999,999,999,999'), ',', '.') || ' đ'
    when new.kind = 'nghi_phep' then ' · ' || case when new.days = 0.5 then 'nửa ngày' else trim(to_char(new.days, 'FM990.0')) || ' ngày' end
      || ' từ ' || to_char(new.start_date, 'DD/MM')
    else ' · ' || to_char(new.start_date, 'DD/MM') end;
  what := replace(what, '.0 ngày', ' ngày');

  if new.status is distinct from old.status then
    if new.status = 'tra_lai' then
      perform public.notify(new.requester_id, 'khac', noun || ' được trả lại để sửa',
        what || coalesce(' — ' || nullif(trim(new.decision_note), ''), ''), 'request', new.id);
    elsif new.status in ('da_duyet','tu_choi') and new.approver_id is distinct from new.requester_id then
      perform public.notify(new.requester_id, 'khac',
        case new.status when 'da_duyet' then noun || ' đã được duyệt xong' else noun || ' bị từ chối' end,
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
      if found then perform public.notify_step(new.id, cur, noun || ' đã được rút lại'); end if;
      update public.request_steps set status = 'bo_qua', skip_reason = noun || ' đã rút lại' where request_id = new.id and status = 'cho';
    end if;
    -- LOA duyệt xong: báo người cùng soạn và cá nhân được xem
    if new.kind = 'loa' and new.status = 'da_duyet' then
      for m in select lm.user_id from public.loa_members lm join public.profiles pr on pr.id = lm.user_id and pr.is_active
               where lm.request_id = new.id and lm.user_id <> new.requester_id loop
        perform public.notify(m.user_id, 'khac', 'Tờ trình (LOA) đã được duyệt', coalesce(who, '?') || ': ' || what, 'request', new.id);
      end loop;
    end if;
  end if;
  return null;
end $$;

