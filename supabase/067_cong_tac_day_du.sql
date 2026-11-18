-- 067: Đi công tác đầy đủ (kế hoạch, chi phí, thực tế, Nhân sự xác nhận, liên kết tạm ứng / thanh toán)
--      + sửa lỗi: đề nghị vừa gửi không lưu được dòng chi tiết / tạm ứng (RLS chỉ cho khi nháp hoặc bị trả lại)

-- ============ A. Sửa lỗi ghi dòng chi tiết của đề nghị vừa gửi ============
-- Người lập ghi được dòng chi tiết khi: nháp / bị trả lại / bị từ chối / đã rút, hoặc vừa gửi (chờ duyệt, trong 30 phút,
-- chưa ai duyệt bước nào). Đủ để form lưu xong các dòng ngay sau khi tạo đề nghị.
create or replace function public.request_lines_writable(p_request uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.requests r
     where r.id = p_request and r.requester_id = auth.uid()
       and (r.status in ('nhap','tra_lai','tu_choi','da_huy')
            or (r.status = 'cho_duyet' and r.created_at > now() - interval '30 minutes'
                and not exists (select 1 from public.request_steps s where s.request_id = r.id and s.status = 'da_duyet'))))
$$;
revoke execute on function public.request_lines_writable(uuid) from public, anon;
grant execute on function public.request_lines_writable(uuid) to authenticated;

drop policy if exists rl_write on public.request_lines;
create policy rl_write on public.request_lines for all to authenticated
  using (public.request_lines_writable(request_id)) with check (public.request_lines_writable(request_id));
drop policy if exists ra_write on public.request_advances;
create policy ra_write on public.request_advances for all to authenticated
  using (public.request_lines_writable(request_id)) with check (public.request_lines_writable(request_id));

-- Tổng tiền tự cộng: cập nhật số tiền đề nghị qua cờ app.step_flow (không vướng chốt chặn sửa đề nghị đang duyệt)
create or replace function public.tg_request_recalc() returns trigger
language plpgsql security definer set search_path = public as $$
declare rid uuid := coalesce(new.request_id, old.request_id); gross bigint; adv bigint;
begin
  select sum(total) into gross from public.request_lines where request_id = rid;
  if gross is not null then
    select coalesce(sum(amount), 0) into adv from public.request_advances where request_id = rid;
    if gross - adv <= 0 then
      raise exception 'Tiền tạm ứng trừ vào phải nhỏ hơn tổng thanh toán';
    end if;
    perform set_config('app.step_flow', 'on', true);
    update public.requests set amount = gross - adv where id = rid and amount is distinct from gross - adv;
    perform set_config('app.step_flow', 'off', true);
  end if;
  return null;
end $$;
revoke execute on function public.tg_request_recalc() from public, anon, authenticated;

-- ============ B. Thông tin phiếu công tác ============
alter table public.requests
  add column if not exists trip_type       text check (trip_type in ('trong_nuoc','trong_nuoc_may_bay','nuoc_ngoai')),
  add column if not exists trip_area       text check (char_length(trip_area) <= 200),
  add column if not exists visa_type       text check (visa_type in ('khong_yeu_cau','du_lich','cong_tac','khac')),
  add column if not exists traveler_id     uuid references public.profiles(id) on delete set null,
  add column if not exists hr_confirmed_at timestamptz,
  add column if not exists hr_confirmed_by uuid references public.profiles(id) on delete set null,
  add column if not exists hr_note         text check (char_length(hr_note) <= 500),
  add column if not exists trip_id         uuid references public.requests(id) on delete set null;
create index if not exists requests_trip_id on public.requests(trip_id) where trip_id is not null;

-- Nhân sự (duty nhan_su) xem các chuyến công tác đã duyệt để xác nhận ngày công; người được cử đi xem phiếu của mình
drop policy if exists requests_select_trip on public.requests;
create policy requests_select_trip on public.requests for select to authenticated
  using (kind = 'cong_tac' and status <> 'nhap'
         and (traveler_id = (select auth.uid())
              or (public.is_duty('nhan_su') and status in ('da_duyet','hoan_tat'))));

create or replace function public.can_see_request(p_request uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select public.app_role() is not null and exists (
    select 1 from public.requests r where r.id = p_request and (
      r.requester_id = auth.uid()
      or (r.status <> 'nhap' and (public.is_manager() or public.is_request_approver(r.id)
           or (public.is_duty('ke_toan') and r.kind in ('thanh_toan','tam_ung') and r.status in ('da_duyet','hoan_tat'))))
      or (r.kind = 'loa' and (public.loa_can_use(r.id) or public.loa_linked_visible(r.id)))
      or (r.kind = 'cong_tac' and r.status <> 'nhap'
          and (r.traveler_id = auth.uid() or (public.is_duty('nhan_su') and r.status in ('da_duyet','hoan_tat'))))))
$$;

-- Chốt chặn riêng cho công tác (chạy sau requests_guard): Nhân sự xác nhận chỉ qua hàm; liên kết chuyến công tác hợp lệ
create or replace function public.tg_requests_trip_guard() returns trigger
language plpgsql security definer set search_path = public as $$
declare hr boolean := coalesce(current_setting('app.trip_hr', true), '') = 'on';
begin
  if auth.uid() is not null and not hr then
    if tg_op = 'INSERT' then
      new.hr_confirmed_at := null; new.hr_confirmed_by := null; new.hr_note := null;
    else
      new.hr_confirmed_at := old.hr_confirmed_at; new.hr_confirmed_by := old.hr_confirmed_by; new.hr_note := old.hr_note;
    end if;
  end if;
  if new.kind = 'cong_tac' then
    new.trip_type := coalesce(new.trip_type, 'trong_nuoc');
    if new.trip_type <> 'nuoc_ngoai' then new.visa_type := null; end if;
    new.traveler_id := coalesce(new.traveler_id, new.requester_id);
  else
    new.trip_type := null; new.trip_area := null; new.visa_type := null; new.traveler_id := null;
  end if;
  if new.kind not in ('thanh_toan','tam_ung') then
    new.trip_id := null;
  elsif new.trip_id is not null and auth.uid() is not null
        and (tg_op = 'INSERT' or new.trip_id is distinct from old.trip_id) then
    if not exists (select 1 from public.requests t
                    where t.id = new.trip_id and t.kind = 'cong_tac' and t.status in ('da_duyet','hoan_tat')
                      and (t.requester_id = new.requester_id or t.traveler_id = new.requester_id)) then
      raise exception 'Chỉ gắn được chuyến công tác đã duyệt của chính bạn';
    end if;
  end if;
  if tg_op = 'UPDATE' and old.hr_confirmed_at is not null and not hr
     and (new.actual_start is distinct from old.actual_start or new.actual_end is distinct from old.actual_end) then
    raise exception 'Nhân sự đã xác nhận thời gian công tác thực tế, không sửa được nữa';
  end if;
  return new;
end $$;
revoke execute on function public.tg_requests_trip_guard() from public, anon, authenticated;
drop trigger if exists requests_trip on public.requests;
create trigger requests_trip before insert or update on public.requests
  for each row execute function public.tg_requests_trip_guard();

-- ============ C. Kế hoạch / thực tế lộ trình và chi phí ============
create table if not exists public.trip_legs (
  id          uuid primary key default gen_random_uuid(),
  request_id  uuid not null references public.requests(id) on delete cascade,
  phase       text not null default 'ke_hoach' check (phase in ('ke_hoach','thuc_te')),
  line_no     int  not null default 1,
  staff_id    uuid references public.profiles(id) on delete set null,
  start_date  date,
  end_date    date,
  from_place  text check (char_length(from_place) <= 200),
  to_place    text check (char_length(to_place) <= 200),
  content     text check (char_length(content) <= 500),
  transport   text check (char_length(transport) <= 100),
  distance    text check (char_length(distance) <= 50),
  stay_reason text check (char_length(stay_reason) <= 200),
  note        text check (char_length(note) <= 300),
  constraint trip_legs_dates check (end_date is null or start_date is null or end_date >= start_date)
);
create index if not exists trip_legs_req on public.trip_legs (request_id, phase, line_no);

create table if not exists public.trip_costs (
  id          uuid primary key default gen_random_uuid(),
  request_id  uuid not null references public.requests(id) on delete cascade,
  phase       text not null default 'ke_hoach' check (phase in ('ke_hoach','thuc_te')),
  line_no     int  not null default 1,
  category    text not null check (char_length(btrim(category)) between 1 and 200),
  location    text check (char_length(location) <= 200),
  days        numeric(7,2) not null default 1 check (days >= 0 and days <= 999),
  persons     numeric(7,2) not null default 1 check (persons >= 0 and persons <= 999),
  unit_price  bigint not null default 0 check (unit_price >= 0 and unit_price < 1000000000000),
  amount      bigint generated always as (round(days * persons * unit_price)::bigint) stored,
  note        text check (char_length(note) <= 300)
);
create index if not exists trip_costs_req on public.trip_costs (request_id, phase, line_no);

-- Ai được ghi: kế hoạch = người lập khi còn sửa được; thực tế = người lập sau khi được duyệt
-- (lộ trình thực tế khoá khi Nhân sự đã xác nhận; bảng kê chi phí thực tế vẫn sửa được)
create or replace function public.trip_writable(p_request uuid, p_phase text, p_leg boolean) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.requests r
     where r.id = p_request and r.kind = 'cong_tac' and r.requester_id = auth.uid()
       and case p_phase
             when 'ke_hoach' then public.request_lines_writable(r.id)
             when 'thuc_te'  then r.status in ('da_duyet','hoan_tat') and (not p_leg or r.hr_confirmed_at is null)
             else false end)
$$;
revoke execute on function public.trip_writable(uuid, text, boolean) from public, anon;
grant execute on function public.trip_writable(uuid, text, boolean) to authenticated;

alter table public.trip_legs  enable row level security;
alter table public.trip_costs enable row level security;
revoke all on public.trip_legs, public.trip_costs from anon;
grant select, insert, update, delete on public.trip_legs, public.trip_costs to authenticated;

drop policy if exists tl_select on public.trip_legs;
create policy tl_select on public.trip_legs for select to authenticated using (public.can_see_request(request_id));
drop policy if exists tl_write on public.trip_legs;
create policy tl_write on public.trip_legs for all to authenticated
  using (public.trip_writable(request_id, phase, true)) with check (public.trip_writable(request_id, phase, true));
drop policy if exists tc_select on public.trip_costs;
create policy tc_select on public.trip_costs for select to authenticated using (public.can_see_request(request_id));
drop policy if exists tc_write on public.trip_costs;
create policy tc_write on public.trip_costs for all to authenticated
  using (public.trip_writable(request_id, phase, false)) with check (public.trip_writable(request_id, phase, false));

-- Tổng chi phí kế hoạch → requests.amount (dự trù); tổng thực tế → requests.actual_cost
create or replace function public.tg_trip_costs_recalc() returns trigger
language plpgsql security definer set search_path = public as $$
declare rid uuid := coalesce(new.request_id, old.request_id); plan bigint; act bigint;
begin
  select sum(amount) filter (where phase = 'ke_hoach'), sum(amount) filter (where phase = 'thuc_te')
    into plan, act from public.trip_costs where request_id = rid;
  perform set_config('app.step_flow', 'on', true);
  update public.requests set amount = coalesce(plan, amount)
   where id = rid and kind = 'cong_tac' and plan is not null and amount is distinct from plan;
  update public.requests set actual_cost = act
   where id = rid and kind = 'cong_tac' and status in ('da_duyet','hoan_tat') and actual_cost is distinct from act;
  perform set_config('app.step_flow', 'off', true);
  return null;
end $$;
revoke execute on function public.tg_trip_costs_recalc() from public, anon, authenticated;
drop trigger if exists trip_costs_recalc on public.trip_costs;
create trigger trip_costs_recalc after insert or update or delete on public.trip_costs
  for each row execute function public.tg_trip_costs_recalc();

-- ============ D. Nhân sự xác nhận thời gian thực tế (tính ngày công) ============
create or replace function public.trip_hr_confirm(p_request uuid, p_confirm boolean, p_note text default null) returns void
language plpgsql security definer set search_path = public as $$
declare r public.requests; who text;
begin
  if auth.uid() is null or public.app_role() is null then raise exception 'Cần đăng nhập'; end if;
  if not (public.is_duty('nhan_su') or public.is_manager()) then raise exception 'Chỉ Nhân sự hoặc Quản lý xác nhận thời gian công tác'; end if;
  select * into r from public.requests where id = p_request for update;
  if not found or r.kind <> 'cong_tac' then raise exception 'Không tìm thấy phiếu công tác'; end if;
  if r.status <> 'hoan_tat' or r.actual_start is null then raise exception 'Người đi công tác chưa nhập thời gian thực tế'; end if;
  if char_length(coalesce(p_note, '')) > 500 then raise exception 'Ghi chú tối đa 500 ký tự'; end if;
  perform set_config('app.step_flow', 'on', true);
  perform set_config('app.trip_hr', 'on', true);
  update public.requests
     set hr_confirmed_at = case when p_confirm then now() end,
         hr_confirmed_by = case when p_confirm then auth.uid() end,
         hr_note = nullif(btrim(coalesce(p_note, '')), '')
   where id = p_request;
  perform set_config('app.trip_hr', 'off', true);
  perform set_config('app.step_flow', 'off', true);
  select full_name into who from public.profiles where id = auth.uid();
  if r.requester_id <> auth.uid() then
    perform public.notify(r.requester_id, 'khac',
      case when p_confirm then 'Nhân sự đã xác nhận thời gian công tác' else 'Nhân sự bỏ xác nhận thời gian công tác' end,
      coalesce(who, '?') || ': ' || to_char(r.actual_start, 'DD/MM') || ' – ' || to_char(r.actual_end, 'DD/MM')
        || coalesce(' — ' || nullif(btrim(coalesce(p_note, '')), ''), ''), 'request', p_request);
  end if;
end $$;
revoke execute on function public.trip_hr_confirm(uuid, boolean, text) from public, anon;
grant execute on function public.trip_hr_confirm(uuid, boolean, text) to authenticated;

-- Người đi nhập thực tế xong: báo Nhân sự để xác nhận ngày công
create or replace function public.tg_trip_notify_hr() returns trigger
language plpgsql security definer set search_path = public as $$
declare who text; m record;
begin
  if new.kind = 'cong_tac' and new.status = 'hoan_tat' and old.status is distinct from 'hoan_tat' then
    select full_name into who from public.profiles where id = new.requester_id;
    for m in select distinct o.profile_id from public.org_staff o join public.profiles p on p.id = o.profile_id and p.is_active
              where o.duty = 'nhan_su' and o.profile_id <> new.requester_id loop
      perform public.notify(m.profile_id, 'khac', 'Chờ xác nhận thời gian công tác',
        coalesce(who, '?') || ': ' || to_char(new.actual_start, 'DD/MM') || ' – ' || to_char(new.actual_end, 'DD/MM')
          || coalesce(' · ' || new.location, ''), 'request', new.id);
    end loop;
  end if;
  return null;
end $$;
revoke execute on function public.tg_trip_notify_hr() from public, anon, authenticated;
drop trigger if exists requests_trip_notify on public.requests;
create trigger requests_trip_notify after update on public.requests
  for each row execute function public.tg_trip_notify_hr();

-- ============ E. Đề nghị tạm ứng / thanh toán đã lập từ một chuyến công tác ============
create or replace function public.trip_linked(p_trip uuid)
returns table (id uuid, kind public.request_kind, doc_no text, amount bigint, status public.request_status, created_at timestamptz, can_open boolean)
language sql stable security definer set search_path = public as $$
  select r.id, r.kind, r.doc_no, r.amount, r.status, r.created_at, public.can_see_request(r.id)
    from public.requests r
   where r.trip_id = p_trip and public.can_see_request(p_trip)
   order by r.created_at
$$;
revoke execute on function public.trip_linked(uuid) from public, anon;
grant execute on function public.trip_linked(uuid) to authenticated;
