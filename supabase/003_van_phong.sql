-- =====================================================================
-- Neo Nestly · Module VĂN PHÒNG
-- Nghỉ phép · Làm việc bên ngoài · Công tác (+ nhập thực tế) · Đề nghị thanh toán / tạm ứng
-- Quản lý duyệt. Chạy sau 001_schema.sql.
-- =====================================================================

create type public.request_kind   as enum ('nghi_phep','ra_ngoai','cong_tac','thanh_toan','tam_ung');
create type public.request_status as enum ('cho_duyet','da_duyet','tu_choi','da_huy','hoan_tat');

-- Số ngày phép năm của mỗi người — do Quản lý nhập (để trống = chưa nhập)
alter table public.profiles add column if not exists annual_leave_days numeric(4,1);

create table public.requests (
  id            uuid primary key default gen_random_uuid(),
  kind          public.request_kind not null,
  requester_id  uuid not null references public.profiles(id) on delete cascade default auth.uid(),
  status        public.request_status not null default 'cho_duyet',
  -- nghi_phep: phep_nam | khong_luong · ra_ngoai: khong_den_cty | co_quay_lai | khong_quay_lai
  sub_type      text,
  span          text,                    -- nghi_phep: ca_ngay | sang | chieu
  start_date    date not null,
  end_date      date,
  start_time    time,
  end_time      time,
  days          numeric(5,1),            -- tự tính
  location      text,
  reason        text not null,
  amount        bigint,                  -- VNĐ (thanh toán / tạm ứng / dự toán công tác)
  payee         text,                    -- người / đơn vị nhận tiền
  bank_info     text,                    -- STK, ngân hàng
  building_id   uuid references public.buildings(id) on delete set null,
  -- công tác: thực tế
  actual_start  date,
  actual_end    date,
  actual_cost   bigint,
  actual_note   text,
  reported_at   timestamptz,
  -- duyệt / chi
  approver_id   uuid references public.profiles(id) on delete set null,
  decided_at    timestamptz,
  decision_note text,
  paid_at       timestamptz,
  paid_by       uuid references public.profiles(id) on delete set null,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  constraint req_dates check (end_date is null or end_date >= start_date),
  constraint req_actual_dates check (actual_end is null or actual_start is null or actual_end >= actual_start),
  constraint req_amount check (amount is null or amount > 0),
  constraint req_actual_cost check (actual_cost is null or actual_cost >= 0),
  constraint req_reason check (length(trim(reason)) > 0),
  constraint req_shape check (
    case kind
      when 'nghi_phep'  then sub_type in ('phep_nam','khong_luong') and span in ('ca_ngay','sang','chieu')
      when 'ra_ngoai'   then sub_type in ('khong_den_cty','co_quay_lai','khong_quay_lai')
      when 'cong_tac'   then end_date is not null and coalesce(trim(location), '') <> ''
      else amount is not null
    end)
);
create index on public.requests(requester_id, created_at desc);
create index on public.requests(status) where status in ('cho_duyet','da_duyet');
create index on public.requests(approver_id);
create index on public.requests(paid_by);
create index on public.requests(building_id);

create or replace function public.request_label(k public.request_kind, s text) returns text
language sql immutable set search_path = public as $$
  select case k
    when 'nghi_phep' then case s when 'khong_luong' then 'Nghỉ không lương' else 'Nghỉ phép năm' end
    when 'ra_ngoai'  then 'Làm việc bên ngoài'
    when 'cong_tac'  then 'Đi công tác'
    when 'thanh_toan' then 'Đề nghị thanh toán'
    when 'tam_ung'   then 'Đề nghị tạm ứng'
  end
$$;

-- Kiểm soát: ai được sửa gì, chuyển trạng thái nào
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
create trigger requests_guard before insert or update on public.requests
  for each row execute function public.tg_requests_guard();

-- Thông báo
create or replace function public.tg_requests_notify() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  who   text;
  label text := public.request_label(new.kind, new.sub_type);
  what  text;
  m     record;
begin
  select full_name into who from public.profiles where id = new.requester_id;
  what := label || case
    when new.kind in ('thanh_toan','tam_ung') then ' · ' || replace(to_char(new.amount, 'FM999,999,999,999'), ',', '.') || ' đ'
    when new.kind = 'nghi_phep' then ' · ' || case when new.days = 0.5 then 'nửa ngày' else trim(to_char(new.days, 'FM990.0')) || ' ngày' end
      || ' từ ' || to_char(new.start_date, 'DD/MM')
    else ' · ' || to_char(new.start_date, 'DD/MM') end;
  what := replace(what, '.0 ngày', ' ngày');

  if tg_op = 'INSERT' then
    for m in select id from public.profiles where role = 'quan_ly' and is_active and id <> new.requester_id loop
      perform public.notify(m.id, 'khac', 'Đề nghị mới cần duyệt', coalesce(who, '?') || ': ' || what, 'request', new.id);
    end loop;
  elsif new.status is distinct from old.status then
    if new.status in ('da_duyet','tu_choi') and new.approver_id is distinct from new.requester_id then
      perform public.notify(new.requester_id, 'khac',
        case new.status when 'da_duyet' then 'Đề nghị đã được duyệt' else 'Đề nghị bị từ chối' end,
        what || coalesce(' — ' || nullif(trim(new.decision_note), ''), ''), 'request', new.id);
    elsif new.status = 'hoan_tat' and new.kind = 'cong_tac' and new.approver_id is distinct from new.requester_id then
      perform public.notify(new.approver_id, 'khac', 'Đã nhập thực tế công tác', coalesce(who, '?') || ': ' || what, 'request', new.id);
    elsif new.status = 'hoan_tat' and new.kind in ('thanh_toan','tam_ung') and new.paid_by is distinct from new.requester_id then
      perform public.notify(new.requester_id, 'khac', 'Đã chi tiền', what, 'request', new.id);
    elsif new.status = 'da_huy' then
      for m in select id from public.profiles where role = 'quan_ly' and is_active and id <> new.requester_id loop
        perform public.notify(m.id, 'khac', 'Đề nghị đã được rút lại', coalesce(who, '?') || ': ' || what, 'request', new.id);
      end loop;
    end if;
  end if;
  return null;
end $$;
create trigger requests_notify after insert or update on public.requests
  for each row execute function public.tg_requests_notify();

-- Quyền: người tạo xem/sửa đề nghị của mình; Quản lý xem & duyệt tất cả. Không xoá (rút lại thay vì xoá).
alter table public.requests enable row level security;
create policy requests_select on public.requests for select to authenticated
  using (requester_id = (select auth.uid()) or public.is_manager());
create policy requests_insert on public.requests for insert to authenticated
  with check (requester_id = (select auth.uid()));
create policy requests_update on public.requests for update to authenticated
  using (requester_id = (select auth.uid()) or public.is_manager())
  with check (requester_id = (select auth.uid()) or public.is_manager());
revoke all on public.requests from anon;
grant select, insert, update on public.requests to authenticated;
revoke execute on function public.tg_requests_guard(), public.tg_requests_notify() from public, anon, authenticated;
revoke execute on function public.request_label(public.request_kind, text) from anon;

-- Chỉ quản lý được đổi số ngày phép năm
create or replace function public.tg_profiles_guard() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is not null and not public.is_manager()
     and (new.role is distinct from old.role or new.is_active is distinct from old.is_active
          or new.phone is distinct from old.phone or new.annual_leave_days is distinct from old.annual_leave_days) then
    raise exception 'Chỉ quản lý được đổi vai trò, số điện thoại, ngày phép hoặc khoá tài khoản';
  end if;
  return new;
end $$;
