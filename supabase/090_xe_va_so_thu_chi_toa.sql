-- 090: Xe đăng ký theo hợp đồng, danh sách khách ở theo toà, sổ thu chi toà (theo file SỔ ĐẦU TƯ LTR)
--  * contract_vehicles: loại xe, dòng xe, biển số; một biển số chỉ đăng ký ở một hợp đồng đang ở.
--    Thêm/bỏ xe thì contracts.vehicles (số xe tính phí gửi, trừ xe đạp) tự cập nhật.
--  * building_roster(toà): mỗi phòng đang thuê: người đứng tên, người ở, SĐT, xe, ngày HĐ, tiền phòng.
--  * requests.expense_category: khoản chi của toà trên đề nghị thanh toán / tạm ứng.
--  * building_ledger(toà, từ, đến): sổ thu chi chi tiết. Thu: hoá đơn đã thu (tách theo khoản), khoản thu khách,
--    thuê đêm. Chi: chi nhập tay, ĐNTT/tạm ứng đã duyệt gắn toà, tiền thuê nhà theo tháng. Chỉ Quản lý, Kế toán.
--  * report_cashflow: chi tính cả ĐNTT/tạm ứng đã duyệt gắn toà (trước chỉ có chi nhập tay).

-- ============ Xe đăng ký ============
create table if not exists public.contract_vehicles (
  id uuid primary key default gen_random_uuid(),
  contract_id uuid not null references public.contracts(id) on delete cascade,
  building_id uuid references public.buildings(id) on delete cascade,
  kind text not null default 'xe_may' check (kind in ('xe_may', 'xe_dien', 'xe_dap', 'o_to', 'khac')),
  model text,
  plate text,
  plate_norm text generated always as (upper(regexp_replace(coalesce(plate, ''), '[^A-Za-z0-9]', '', 'g'))) stored,
  owner_name text,
  registered_on date not null default ((now() at time zone 'Asia/Ho_Chi_Minh')::date),
  removed_on date,
  created_by uuid default auth.uid() references public.profiles(id) on delete set null,
  created_at timestamptz not null default now()
);
create index if not exists contract_vehicles_contract on public.contract_vehicles(contract_id);
create unique index if not exists contract_vehicles_plate_active on public.contract_vehicles(plate_norm)
  where removed_on is null and plate_norm <> '';
alter table public.contract_vehicles enable row level security;

create policy cv_select on public.contract_vehicles for select to authenticated
  using (exists (select 1 from public.contracts c where c.id = contract_id and public.can_access_building(c.building_id)));
create policy cv_insert on public.contract_vehicles for insert to authenticated
  with check (exists (select 1 from public.contracts c where c.id = contract_id and public.can_edit_building(c.building_id)));
create policy cv_update on public.contract_vehicles for update to authenticated
  using (exists (select 1 from public.contracts c where c.id = contract_id and public.can_edit_building(c.building_id)))
  with check (exists (select 1 from public.contracts c where c.id = contract_id and public.can_edit_building(c.building_id)));
create policy cv_delete on public.contract_vehicles for delete to authenticated
  using (exists (select 1 from public.contracts c where c.id = contract_id and public.can_manage_building(c.building_id)));

create or replace function public.tg_contract_vehicles_before() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  select building_id into new.building_id from public.contracts where id = new.contract_id;
  new.model := nullif(btrim(coalesce(new.model, '')), '');
  new.plate := nullif(upper(btrim(coalesce(new.plate, ''))), '');
  new.owner_name := nullif(btrim(coalesce(new.owner_name, '')), '');
  if new.kind not in ('xe_dap') and new.plate is null then raise exception 'Nhập biển số xe'; end if;
  if tg_op = 'UPDATE' then new.contract_id := old.contract_id; new.created_by := old.created_by; end if;
  if new.removed_on is null and new.plate is not null and exists (
       select 1 from public.contract_vehicles v
        where v.removed_on is null and v.id <> new.id
          and v.plate_norm = upper(regexp_replace(new.plate, '[^A-Za-z0-9]', '', 'g'))) then
    raise exception 'Biển số % đang đăng ký ở phòng khác', new.plate;
  end if;
  return new;
end $$;
create trigger contract_vehicles_before before insert or update on public.contract_vehicles
  for each row execute function public.tg_contract_vehicles_before();

create or replace function public.tg_contract_vehicles_after() returns trigger
language plpgsql security definer set search_path = public as $$
declare cid uuid := coalesce(new.contract_id, old.contract_id);
begin
  update public.contracts set vehicles = (select count(*) from public.contract_vehicles v
                                           where v.contract_id = cid and v.removed_on is null and v.kind <> 'xe_dap')
   where id = cid;
  return null;
end $$;
create trigger contract_vehicles_after after insert or update or delete on public.contract_vehicles
  for each row execute function public.tg_contract_vehicles_after();
revoke execute on function public.tg_contract_vehicles_before() from public, anon, authenticated;
revoke execute on function public.tg_contract_vehicles_after() from public, anon, authenticated;

-- ============ Danh sách khách ở theo toà ============
create or replace function public.building_roster(p_building uuid)
returns table (contract_id uuid, room_code text, floor int, contract_code text, start_date date, end_date date,
               rent numeric, deposit numeric, holder_name text, holder_phone text, occupants jsonb, vehicles jsonb)
language plpgsql stable security definer set search_path = public as $$
begin
  if not public.can_access_building(p_building) then raise exception 'Bạn không phụ trách toà này'; end if;
  return query
    select c.id, r.code, r.floor::int, c.code, c.start_date, c.end_date, c.rent_amount, c.deposit_amount, t.full_name, t.phone,
      coalesce((select jsonb_agg(jsonb_build_object('name', ot.full_name, 'phone', ot.phone) order by o.move_in)
                  from public.contract_occupants o join public.tenants ot on ot.id = o.tenant_id
                 where o.contract_id = c.id and o.move_out is null and o.tenant_id <> c.tenant_id), '[]'::jsonb),
      coalesce((select jsonb_agg(jsonb_build_object('kind', v.kind, 'model', v.model, 'plate', v.plate) order by v.created_at)
                  from public.contract_vehicles v where v.contract_id = c.id and v.removed_on is null), '[]'::jsonb)
      from public.contracts c
      join public.rooms r on r.id = c.room_id
      join public.tenants t on t.id = c.tenant_id
     where c.building_id = p_building and c.status = 'hieu_luc'
     order by r.floor nulls last, r.code;
end $$;
revoke execute on function public.building_roster(uuid) from public, anon;
grant execute on function public.building_roster(uuid) to authenticated;

-- ============ Khoản chi trên đề nghị thanh toán / tạm ứng ============
alter table public.requests add column if not exists expense_category text;

-- ============ Sổ thu chi toà ============
create or replace function public.building_ledger(p_building uuid, p_from date, p_to date)
returns table (d date, side text, category text, content text, amount numeric, source text, ref text,
               building_id uuid, building_code text, room_code text)
language plpgsql stable security definer set search_path = public as $$
begin
  if not public.is_payer() then raise exception 'Chỉ Quản lý hoặc Kế toán xem sổ thu chi'; end if;
  if p_from is null or p_to is null or p_to < p_from then raise exception 'Khoảng ngày không hợp lệ'; end if;
  return query
  with bl as (select b.id, b.code from public.buildings b where p_building is null or b.id = p_building),
  thu_inv as (
    select i.collected_at d, 'thu'::text side,
      case when jsonb_typeof(l) <> 'object' then 'Tiền phòng'
           else case l->>'k' when 'phong' then 'Tiền phòng' when 'dien' then 'Điện' when 'nuoc' then 'Nước'
                             when 'dich_vu' then 'Dịch vụ' when 'xe' then 'Xe' else 'Khác' end end category,
      coalesce(l->>'label', 'Tiền phòng') content, coalesce((l->>'amount')::numeric, i.amount) amount,
      case when i.paid_via = 'chuyen_khoan' then 'Hoá đơn · chuyển khoản' else 'Hoá đơn · thu tay' end source,
      coalesce(i.txn_ref, i.pay_code) ref, i.building_id, r.code room_code
    from public.invoices i
    join public.contracts c on c.id = i.contract_id join public.rooms r on r.id = c.room_id
    left join lateral jsonb_array_elements(case when jsonb_array_length(i.lines) > 0 then i.lines else '[null]'::jsonb end) l on true
    where i.status = 'da_thu' and i.collected_at between p_from and p_to and i.building_id in (select id from bl)
  ),
  thu_bill as (
    select (cb.confirmed_at at time zone 'Asia/Ho_Chi_Minh')::date, 'thu',
      case when jsonb_typeof(l) = 'object' then
             case when l->>'label' like 'Tiền phòng%' then 'Tiền phòng' when l->>'label' = 'Tiền điện' then 'Điện'
                  when l->>'label' = 'Tiền nước' then 'Nước' when l->>'label' = 'Phí dịch vụ' then 'Dịch vụ' else 'Khác' end
           else case cb.kind::text when 'tien_phong' then 'Tiền phòng' when 'dien' then 'Điện' when 'nuoc' then 'Nước'
                                   when 'phi_dich_vu' then 'Dịch vụ' when 'tien_coc' then 'Tiền cọc' else 'Khác' end end,
      coalesce(l->>'label', cb.note, cb.kind::text), coalesce((l->>'amount')::numeric, cb.amount),
      'Khoản thu khách', coalesce(cb.txn_ref, cb.pay_code), cb.building_id, r.code
    from public.customer_bills cb
    left join public.customer_profiles cp on cp.id = cb.customer_id left join public.rooms r on r.id = cp.room_id
    left join lateral jsonb_array_elements(case when jsonb_array_length(coalesce(cb.lines, '[]'::jsonb)) > 0 then cb.lines else '[null]'::jsonb end) l on true
    where cb.status = 'da_thanh_toan' and (cb.confirmed_at at time zone 'Asia/Ho_Chi_Minh')::date between p_from and p_to
      and cb.building_id in (select id from bl)
  ),
  thu_dem as (
    select n.revenue_date, 'thu', 'Thuê đêm', coalesce(n.note, n.nights || ' đêm'), n.amount, 'Doanh thu đêm', n.source, n.building_id, r.code
    from public.nightly_revenues n left join public.rooms r on r.id = n.room_id
    where n.revenue_date between p_from and p_to and n.building_id in (select id from bl)
  ),
  chi_tay as (
    select e.spent_on, 'chi', e.category, coalesce(e.note, e.category), e.amount, 'Nhập chi', null::text, e.building_id, null::text
    from public.building_expenses e where e.spent_on between p_from and p_to and e.building_id in (select id from bl)
  ),
  chi_dn as (
    select coalesce((q.paid_at at time zone 'Asia/Ho_Chi_Minh')::date, q.doc_date, (q.created_at at time zone 'Asia/Ho_Chi_Minh')::date), 'chi', coalesce(q.expense_category, 'Khác'),
      coalesce(q.reason, ''), q.amount, case q.kind when 'tam_ung' then 'Tạm ứng' else 'ĐNTT' end, q.doc_no, q.building_id, null::text
    from public.requests q
    where q.kind in ('thanh_toan', 'tam_ung') and q.status in ('da_duyet', 'hoan_tat') and q.amount > 0
      and coalesce((q.paid_at at time zone 'Asia/Ho_Chi_Minh')::date, q.doc_date, (q.created_at at time zone 'Asia/Ho_Chi_Minh')::date) between p_from and p_to
      and q.building_id in (select id from bl)
  ),
  chi_thue as (
    select greatest(p_from, m.ms), 'chi', 'Tiền thuê nhà', 'Tiền thuê nhà tháng ' || to_char(m.ms, 'MM/YYYY'),
      round(rt.monthly_rent * (least(p_to, (m.ms + interval '1 month')::date - 1) - greatest(p_from, m.ms) + 1)
            / extract(day from ((m.ms + interval '1 month')::date - 1))::numeric, 0),
      'Thuê toà', null::text, bl.id, null::text
    from bl
    cross join lateral (select generate_series(date_trunc('month', p_from)::date, p_to, interval '1 month')::date ms) m
    cross join lateral (select br.monthly_rent from public.building_rents br where br.building_id = bl.id and br.effective_from <= m.ms
                        order by br.effective_from desc limit 1) rt
    where rt.monthly_rent > 0
  ),
  allrows as (
    select * from thu_inv union all select * from thu_bill union all select * from thu_dem
    union all select * from chi_tay union all select * from chi_dn union all select * from chi_thue
  )
  select a.d, a.side, a.category, a.content, a.amount, a.source, a.ref, a.building_id, b.code, a.room_code
    from allrows a join public.buildings b on b.id = a.building_id
   where a.amount <> 0
   order by a.d, b.code, a.side desc, a.room_code nulls last;
end $$;
revoke execute on function public.building_ledger(uuid, date, date) from public, anon;
grant execute on function public.building_ledger(uuid, date, date) to authenticated;

-- ============ Báo cáo thu chi: tính cả ĐNTT / tạm ứng đã duyệt gắn toà ============
do $$
declare d text := pg_get_functiondef('public.report_cashflow(date,date,text)'::regprocedure);
        a text := 'select e.building_id, e.created_by, ''chi'', e.amount from public.building_expenses e where fin and e.spent_on between p_from and p_to';
begin
  if position(a in d) = 0 then raise exception '090: không thấy đoạn cần vá trong report_cashflow'; end if;
  d := replace(d, a, a || E'\n    union all\n    select q.building_id, q.requester_id, ''chi'', q.amount from public.requests q' ||
    E'\n      where fin and q.kind in (''thanh_toan'', ''tam_ung'') and q.status in (''da_duyet'', ''hoan_tat'') and q.building_id is not null and q.amount > 0' ||
    E'\n        and coalesce((q.paid_at at time zone ''Asia/Ho_Chi_Minh'')::date, q.doc_date, (q.created_at at time zone ''Asia/Ho_Chi_Minh'')::date) between p_from and p_to');
  execute d;
end $$;
