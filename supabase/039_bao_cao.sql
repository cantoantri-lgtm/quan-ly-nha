-- Báo cáo thu chi, lấp đầy, phản ánh, lợi nhuận + nhập chi phí theo toà + tiền thuê nhà hằng tháng.
-- Quản lý nhập chi phí và tiền thuê nhà. Quản lý, Giám sát, Lead Sale xem báo cáo (trong phạm vi toà mình được xem); lợi nhuận, chi và thuê nhà chỉ Quản lý.

create table public.building_expenses (
  id uuid primary key default gen_random_uuid(),
  building_id uuid not null references public.buildings(id) on delete cascade,
  spent_on date not null default (now() at time zone 'Asia/Ho_Chi_Minh')::date,
  category text not null default 'Khác' check (char_length(category) between 1 and 40),
  amount numeric(14,0) not null check (amount > 0),
  note text check (note is null or char_length(note) <= 300),
  created_by uuid references public.profiles(id) on delete set null default auth.uid(),
  created_at timestamptz not null default now()
);
create index on public.building_expenses(building_id, spent_on);
create index on public.building_expenses(created_by);

-- Tiền thuê nhà công ty trả chủ nhà mỗi tháng: áp dụng từ tháng "effective_from" đến khi có dòng mới hơn
create table public.building_rents (
  id uuid primary key default gen_random_uuid(),
  building_id uuid not null references public.buildings(id) on delete cascade,
  effective_from date not null check (effective_from = date_trunc('month', effective_from)::date),
  monthly_rent numeric(14,0) not null check (monthly_rent >= 0),
  note text check (note is null or char_length(note) <= 300),
  created_by uuid references public.profiles(id) on delete set null default auth.uid(),
  created_at timestamptz not null default now(),
  unique (building_id, effective_from)
);
create index on public.building_rents(created_by);

alter table public.building_expenses enable row level security;
alter table public.building_rents enable row level security;
create policy bexp_select on public.building_expenses for select to authenticated using (public.is_manager());
create policy brent_select on public.building_rents for select to authenticated using (public.is_manager());
revoke all on public.building_expenses, public.building_rents from anon, authenticated;
grant select on public.building_expenses, public.building_rents to authenticated;

create or replace function public.expense_save(p_id uuid, p_building uuid, p_date date, p_category text, p_amount numeric, p_note text) returns uuid
language plpgsql security definer set search_path = public as $$
declare nid uuid;
begin
  if not public.is_manager() then raise exception 'Chỉ Quản lý nhập chi phí'; end if;
  if p_amount is null or p_amount <= 0 then raise exception 'Số tiền chi phải lớn hơn 0'; end if;
  if p_id is null then
    insert into public.building_expenses (building_id, spent_on, category, amount, note)
    values (p_building, coalesce(p_date, (now() at time zone 'Asia/Ho_Chi_Minh')::date), coalesce(nullif(btrim(p_category),''), 'Khác'), p_amount, nullif(btrim(coalesce(p_note,'')),''))
    returning id into nid;
  else
    update public.building_expenses set building_id = p_building, spent_on = coalesce(p_date, spent_on),
      category = coalesce(nullif(btrim(p_category),''), 'Khác'), amount = p_amount, note = nullif(btrim(coalesce(p_note,'')),'')
    where id = p_id returning id into nid;
    if nid is null then raise exception 'Không tìm thấy khoản chi'; end if;
  end if;
  return nid;
end $$;
create or replace function public.expense_delete(p_id uuid) returns void
language plpgsql security definer set search_path = public as $$
begin
  if not public.is_manager() then raise exception 'Chỉ Quản lý xoá khoản chi'; end if;
  delete from public.building_expenses where id = p_id;
end $$;
create or replace function public.rent_save(p_building uuid, p_from date, p_amount numeric, p_note text) returns uuid
language plpgsql security definer set search_path = public as $$
declare nid uuid; m date := date_trunc('month', coalesce(p_from, (now() at time zone 'Asia/Ho_Chi_Minh')::date))::date;
begin
  if not public.is_manager() then raise exception 'Chỉ Quản lý nhập tiền thuê nhà'; end if;
  if p_amount is null or p_amount < 0 then raise exception 'Số tiền thuê không hợp lệ'; end if;
  insert into public.building_rents (building_id, effective_from, monthly_rent, note)
  values (p_building, m, p_amount, nullif(btrim(coalesce(p_note,'')),''))
  on conflict (building_id, effective_from) do update set monthly_rent = excluded.monthly_rent, note = excluded.note, created_by = auth.uid()
  returning id into nid;
  return nid;
end $$;
create or replace function public.rent_delete(p_id uuid) returns void
language plpgsql security definer set search_path = public as $$
begin
  if not public.is_manager() then raise exception 'Chỉ Quản lý xoá tiền thuê nhà'; end if;
  delete from public.building_rents where id = p_id;
end $$;

-- Người -> lead sale: Lead là người is_leader cùng "team" trong sơ đồ công ty. Chưa có thì xếp "Chưa gán lead".
create or replace function public.report_lead_of(p_user uuid) returns table (lead_key text, lead_name text)
language sql stable security definer set search_path = public as $$
  select coalesce(l.id::text, 'none'), coalesce(l.person_name, l.position, 'Chưa gán lead')
  from (select 1) x
  left join public.org_staff s on s.profile_id = p_user
  left join lateral (select o.* from public.org_staff o where o.is_leader and o.team is not distinct from s.team and s.team is not null
                     order by o.sort limit 1) l on true
$$;

create or replace function public.report_cashflow(p_from date, p_to date, p_group text) returns table (
  grp_key text, grp_name text, tien_phong numeric, phieu_thu numeric, doanh_thu_dem numeric, tien_coc numeric, chi numeric, thu numeric, rong numeric)
language plpgsql stable security definer set search_path = public as $$
declare mgr boolean := public.is_manager();
begin
  if not public.is_lead_up() then raise exception 'Chỉ Lead Sale, Giám sát, Quản lý xem báo cáo'; end if;
  if p_from is null or p_to is null or p_to < p_from then raise exception 'Khoảng ngày không hợp lệ'; end if;
  if p_group not in ('toa','nhan_vien','lead') then raise exception 'Nhóm báo cáo không hợp lệ'; end if;
  return query
  with f as (
    select i.building_id b, i.collected_by u, 'tp' k, i.amount a from public.invoices i
      where i.status = 'da_thu' and i.collected_at between p_from and p_to
    union all
    select c.building_id, c.confirmed_by, case when c.kind = 'tien_coc' then 'coc' else 'pt' end, c.amount from public.customer_bills c
      where c.status = 'da_thanh_toan' and (c.confirmed_at at time zone 'Asia/Ho_Chi_Minh')::date between p_from and p_to
    union all
    select n.building_id, n.created_by, 'dem', n.amount from public.nightly_revenues n where n.revenue_date between p_from and p_to
    union all
    select e.building_id, e.created_by, 'chi', e.amount from public.building_expenses e where mgr and e.spent_on between p_from and p_to
  ), g as (
    select f.*,
      case p_group when 'toa' then coalesce(f.b::text, 'none')
                   when 'nhan_vien' then coalesce(f.u::text, 'none')
                   else coalesce((select lead_key from public.report_lead_of(f.u)), 'none') end gk,
      case p_group when 'toa' then coalesce((select bd.code || ' · ' || bd.name from public.buildings bd where bd.id = f.b), 'Không gắn toà')
                   when 'nhan_vien' then coalesce((select pr.full_name from public.profiles pr where pr.id = f.u), 'Chuyển khoản tự động / chưa rõ người')
                   else coalesce((select lead_name from public.report_lead_of(f.u)), 'Chưa gán lead') end gn
    from f where f.b is null or public.can_access_building(f.b)
  )
  select g.gk, max(g.gn),
    coalesce(sum(g.a) filter (where g.k = 'tp'), 0), coalesce(sum(g.a) filter (where g.k = 'pt'), 0), coalesce(sum(g.a) filter (where g.k = 'dem'), 0),
    coalesce(sum(g.a) filter (where g.k = 'coc'), 0), coalesce(sum(g.a) filter (where g.k = 'chi'), 0),
    coalesce(sum(g.a) filter (where g.k in ('tp','pt','dem')), 0),
    coalesce(sum(g.a) filter (where g.k in ('tp','pt','dem')), 0) - coalesce(sum(g.a) filter (where g.k = 'chi'), 0)
  from g group by g.gk order by 9 desc;
end $$;

-- Tỉ lệ lấp đầy: hiện tại (trạng thái phòng) và trong kỳ (số ngày có hợp đồng / tổng ngày phòng). Chỉ phòng thuê tháng.
create or replace function public.report_occupancy(p_from date, p_to date) returns table (
  building_id uuid, building_name text, rooms int, dang_o int, trong int, dang_sua int, giu_cho int, room_days int, occupied_days int)
language plpgsql stable security definer set search_path = public as $$
begin
  if not public.is_lead_up() then raise exception 'Chỉ Lead Sale, Giám sát, Quản lý xem báo cáo'; end if;
  if p_from is null or p_to is null or p_to < p_from then raise exception 'Khoảng ngày không hợp lệ'; end if;
  return query
  select b.id, b.code || ' · ' || b.name,
    count(r.id)::int,
    (count(r.id) filter (where r.status = 'dang_o'))::int, (count(r.id) filter (where r.status = 'trong'))::int,
    (count(r.id) filter (where r.status = 'dang_sua'))::int, (count(r.id) filter (where r.status = 'giu_cho'))::int,
    (count(r.id) * (p_to - p_from + 1))::int,
    coalesce(sum((select least(sum(greatest(0, least(coalesce(c.end_date, p_to), p_to) - greatest(c.start_date, p_from) + 1)), (p_to - p_from + 1))
                  from public.contracts c where c.room_id = r.id and c.status <> 'da_huy' and c.start_date <= p_to and coalesce(c.end_date, p_to) >= p_from)), 0)::int
  from public.buildings b join public.rooms r on r.building_id = b.id and r.rent_mode = 'thang'
  where public.can_access_building(b.id)
  group by b.id, b.code, b.name order by b.code;
end $$;

-- Phản ánh trong kỳ theo toà / người trả lời đầu tiên / lead của người đó
create or replace function public.report_feedback(p_from date, p_to date, p_group text) returns table (
  grp_key text, grp_name text, total int, cho_cong_ty int, cho_khach int, da_dong int, chua_tra_loi int, avg_reply_hours numeric)
language plpgsql stable security definer set search_path = public as $$
begin
  if not public.is_lead_up() then raise exception 'Chỉ Lead Sale, Giám sát, Quản lý xem báo cáo'; end if;
  if p_from is null or p_to is null or p_to < p_from then raise exception 'Khoảng ngày không hợp lệ'; end if;
  if p_group not in ('toa','nhan_vien','lead') then raise exception 'Nhóm báo cáo không hợp lệ'; end if;
  return query
  with t as (
    select f.id, f.status, f.building_id b, f.created_at,
      (select m.author_id from public.feedback_messages m where m.thread_id = f.id and m.sender = 'cong_ty' order by m.created_at limit 1) u,
      (select min(m.created_at) from public.feedback_messages m where m.thread_id = f.id and m.sender = 'cong_ty') first_reply
    from public.feedback_threads f
    where (f.created_at at time zone 'Asia/Ho_Chi_Minh')::date between p_from and p_to and public.feedback_can_handle(f.id)
  ), g as (
    select t.*,
      case p_group when 'toa' then coalesce(t.b::text, 'none') when 'nhan_vien' then coalesce(t.u::text, 'none')
                   else case when t.u is null then 'none' else coalesce((select lead_key from public.report_lead_of(t.u)), 'none') end end gk,
      case p_group when 'toa' then coalesce((select bd.code || ' · ' || bd.name from public.buildings bd where bd.id = t.b), 'Không gắn toà (CTV)')
                   when 'nhan_vien' then coalesce((select pr.full_name from public.profiles pr where pr.id = t.u), 'Chưa ai trả lời')
                   else case when t.u is null then 'Chưa ai trả lời' else coalesce((select lead_name from public.report_lead_of(t.u)), 'Chưa gán lead') end end gn
    from t
  )
  select g.gk, max(g.gn), count(*)::int,
    (count(*) filter (where g.status = 'cho_cong_ty'))::int, (count(*) filter (where g.status = 'cho_khach'))::int, (count(*) filter (where g.status = 'dong'))::int,
    (count(*) filter (where g.first_reply is null))::int,
    round(avg(extract(epoch from (g.first_reply - g.created_at)) / 3600.0) filter (where g.first_reply is not null)::numeric, 1)
  from g group by g.gk order by 3 desc;
end $$;

-- Lợi nhuận theo toà = thu (tiền phòng, phiếu thu, doanh thu đêm; KHÔNG gồm tiền cọc) - chi - tiền thuê nhà (chia theo ngày trong tháng)
create or replace function public.report_profit(p_from date, p_to date) returns table (
  building_id uuid, building_name text, thu numeric, chi numeric, thue_nha numeric, loi_nhuan numeric, tien_coc numeric)
language plpgsql stable security definer set search_path = public as $$
begin
  if not public.is_manager() then raise exception 'Chỉ Quản lý xem báo cáo lợi nhuận'; end if;
  if p_from is null or p_to is null or p_to < p_from then raise exception 'Khoảng ngày không hợp lệ'; end if;
  return query
  with cf as (select * from public.report_cashflow(p_from, p_to, 'toa')),
  rent as (
    select b.id bid, coalesce(sum(
      coalesce((select br.monthly_rent from public.building_rents br where br.building_id = b.id and br.effective_from <= m.ms order by br.effective_from desc limit 1), 0)
      * (least(p_to, (m.ms + interval '1 month')::date - 1) - greatest(p_from, m.ms) + 1)
      / extract(day from ((m.ms + interval '1 month')::date - 1))::numeric), 0) amt
    from public.buildings b
    cross join lateral (select generate_series(date_trunc('month', p_from)::date, p_to, interval '1 month')::date ms) m
    group by b.id
  )
  select b.id, b.code || ' · ' || b.name,
    coalesce(cf.thu, 0), coalesce(cf.chi, 0), round(coalesce(rent.amt, 0), 0),
    coalesce(cf.thu, 0) - coalesce(cf.chi, 0) - round(coalesce(rent.amt, 0), 0), coalesce(cf.tien_coc, 0)
  from public.buildings b left join cf on cf.grp_key = b.id::text left join rent on rent.bid = b.id
  order by b.code;
end $$;

revoke execute on function public.expense_save(uuid, uuid, date, text, numeric, text), public.expense_delete(uuid), public.rent_save(uuid, date, numeric, text), public.rent_delete(uuid),
  public.report_lead_of(uuid), public.report_cashflow(date, date, text), public.report_occupancy(date, date), public.report_feedback(date, date, text), public.report_profit(date, date) from public, anon;
grant execute on function public.expense_save(uuid, uuid, date, text, numeric, text), public.expense_delete(uuid), public.rent_save(uuid, date, numeric, text), public.rent_delete(uuid),
  public.report_cashflow(date, date, text), public.report_occupancy(date, date), public.report_feedback(date, date, text), public.report_profit(date, date) to authenticated;
