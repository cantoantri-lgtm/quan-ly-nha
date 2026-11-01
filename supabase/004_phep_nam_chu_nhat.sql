-- Phép năm do Quản lý nhập (bỏ mặc định 12), nghỉ phép không tính Chủ nhật
alter table public.profiles alter column annual_leave_days drop not null, alter column annual_leave_days drop default;
update public.profiles set annual_leave_days = null;
create or replace function public.tg_requests_guard() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  me  uuid := auth.uid();
  mgr boolean := public.is_manager();
  fixed constant text[] := array['status','approver_id','decided_at','decision_note','paid_at','paid_by',
    'actual_start','actual_end','actual_cost','actual_note','reported_at','days','updated_at','created_at'];
  actual constant text[] := array['actual_start','actual_end','actual_cost','actual_note'];
begin
  if tg_op = 'UPDATE' and me is not null then
    -- Trường hệ thống: không cho sửa tay
    new.id := old.id; new.kind := old.kind; new.requester_id := old.requester_id; new.created_at := old.created_at;
    new.approver_id := old.approver_id; new.decided_at := old.decided_at;
    new.paid_at := old.paid_at; new.paid_by := old.paid_by; new.reported_at := old.reported_at;
    if not mgr then new.decision_note := old.decision_note; end if;

    -- Nội dung đề nghị: chỉ người tạo, khi còn chờ duyệt
    if (to_jsonb(new) - fixed) is distinct from (to_jsonb(old) - fixed)
       and not (old.requester_id = me and old.status = 'cho_duyet') then
      raise exception 'Chỉ sửa được đề nghị của mình khi đang chờ duyệt';
    end if;
    -- Thực tế công tác: người đi công tác, sau khi được duyệt
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
        null;   -- rút lại: khi chờ duyệt, hoặc đã duyệt nhưng chưa tới ngày
      elsif new.status in ('da_duyet','tu_choi') and old.status = 'cho_duyet' and mgr then
        if new.status = 'tu_choi' and coalesce(trim(new.decision_note), '') = '' then
          raise exception 'Cần ghi lý do từ chối';
        end if;
        new.approver_id := me; new.decided_at := now();
      elsif new.status = 'hoan_tat' and old.status = 'da_duyet' and old.kind = 'cong_tac' and old.requester_id = me then
        if new.actual_start is null or new.actual_end is null then
          raise exception 'Cần nhập ngày đi và ngày về thực tế';
        end if;
        new.reported_at := now();
      elsif new.status = 'hoan_tat' and old.status = 'da_duyet' and old.kind in ('thanh_toan','tam_ung') and mgr then
        new.paid_at := now(); new.paid_by := me;
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

  -- Chuẩn hoá & tính số ngày
  if new.kind = 'nghi_phep' then
    if new.span <> 'ca_ngay' then new.end_date := new.start_date; end if;
    new.end_date := coalesce(new.end_date, new.start_date);
    -- Công ty nghỉ Chủ nhật: không tính Chủ nhật vào ngày nghỉ phép
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
  new.updated_at := now();
  return new;
end $$;
