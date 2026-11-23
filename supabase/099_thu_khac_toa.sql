-- 099: Thu khác của toà, ngoài tiền phòng (23/11/2026)
--  Giống "Chi phí toà": nhân sự phụ trách toà ghi khoản thu (gửi xe vãng lai, giặt sấy, bán phế liệu, đền bù hư hỏng…).
--  * method: tien_mat (nhân viên giữ tiền, phải nộp Kế toán trong 24 giờ theo Nội quy Điều 16) | chuyen_khoan (vào tài khoản công ty).
--  * handover_status: chua_nop → da_nop khi Kế toán / Quản lý xác nhận đã nhận tiền mặt. Chuyển khoản ghi da_nop luôn.
--  * Ghi / sửa / xoá qua hàm income_*; người ghi chỉ sửa, xoá khoản của mình khi chưa nộp. Kế toán, Quản lý sửa được mọi khoản.
--  * Xem: Kế toán, Quản lý, Giám sát toà, người ghi. Ghi khoản tiền mặt thì báo Kế toán.
--  * Sổ thu chi toà (building_ledger) và báo cáo thu chi (report_cashflow, report_cashflow_detail) cộng khoản này vào phần thu khác.

create table public.building_incomes (
  id             uuid primary key default gen_random_uuid(),
  building_id    uuid not null references public.buildings(id) on delete cascade,
  received_on    date not null default ((now() at time zone 'Asia/Ho_Chi_Minh')::date),
  category       text not null check (char_length(category) between 1 and 60),
  amount         numeric(14,0) not null check (amount > 0),
  note           text check (note is null or char_length(note) <= 300),
  payer_name     text check (payer_name is null or char_length(payer_name) <= 100),
  method         text not null default 'tien_mat' check (method in ('tien_mat', 'chuyen_khoan')),
  received_by    uuid references public.profiles(id) on delete set null default auth.uid(),
  handover_status text not null default 'chua_nop' check (handover_status in ('chua_nop', 'da_nop')),
  handed_at      timestamptz,
  handed_by      uuid references public.profiles(id) on delete set null,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now()
);
create index building_incomes_building_date on public.building_incomes(building_id, received_on);
create index building_incomes_open on public.building_incomes(received_by, handover_status);
alter table public.building_incomes enable row level security;
create policy binc_select on public.building_incomes for select to authenticated
  using (public.is_payer() or received_by = (select auth.uid()) or public.can_manage_building(building_id));
revoke all on public.building_incomes from anon, authenticated;
grant select on public.building_incomes to authenticated;

-- Danh sách Kế toán và Quản lý đang làm việc (để báo tiền mặt cần nộp)
create or replace function public.payer_ids() returns setof uuid
language sql stable security definer set search_path = public as $$
  select p.id from public.profiles p where p.is_active and p.role = 'quan_ly'
  union
  select s.profile_id from public.org_staff s join public.profiles p on p.id = s.profile_id and p.is_active where s.duty = 'ke_toan'
$$;
revoke execute on function public.payer_ids() from public, anon, authenticated;

create or replace function public.income_save(p_id uuid, p_building uuid, p_date date, p_category text, p_amount numeric,
                                              p_note text, p_method text default 'tien_mat', p_payer_name text default null)
returns uuid language plpgsql security definer set search_path = public as $$
declare nid uuid; x public.building_incomes; me uuid := auth.uid(); payer boolean := public.is_payer();
  m text := coalesce(nullif(p_method, ''), 'tien_mat'); b public.buildings; u record;
begin
  if public.app_role() is null then raise exception 'Cần đăng nhập bằng tài khoản nhân sự'; end if;
  if p_building is null then raise exception 'Chọn toà nhà'; end if;
  if not (payer or public.can_access_building(p_building)) then raise exception 'Bạn không phụ trách toà này'; end if;
  if p_amount is null or p_amount <= 0 then raise exception 'Số tiền thu phải lớn hơn 0'; end if;
  if m not in ('tien_mat', 'chuyen_khoan') then raise exception 'Hình thức thu không hợp lệ'; end if;
  if p_date is not null and p_date > (now() at time zone 'Asia/Ho_Chi_Minh')::date then raise exception 'Ngày thu không được sau hôm nay'; end if;
  if p_id is null then
    insert into public.building_incomes (building_id, received_on, category, amount, note, payer_name, method, received_by, handover_status, handed_at)
    values (p_building, coalesce(p_date, (now() at time zone 'Asia/Ho_Chi_Minh')::date), coalesce(nullif(btrim(p_category), ''), 'Khác'),
            round(p_amount), nullif(btrim(coalesce(p_note, '')), ''), nullif(btrim(coalesce(p_payer_name, '')), ''), m, me,
            case when m = 'chuyen_khoan' then 'da_nop' else 'chua_nop' end, case when m = 'chuyen_khoan' then now() end)
    returning id into nid;
    if m = 'tien_mat' then
      select * into b from public.buildings where id = p_building;
      for u in select id from public.payer_ids() id where id <> me loop
        perform public.notify(u.id, 'khac', 'Tiền mặt thu khác cần nộp',
          coalesce((select full_name from public.profiles where id = me), 'Nhân viên') || ' thu ' || to_char(round(p_amount), 'FM999G999G999G999') || ' đ · '
          || b.code || ' · ' || coalesce(nullif(btrim(p_category), ''), 'Khác'), 'building', p_building, 'thu-khac-' || nid || '-' || u.id);
      end loop;
    end if;
  else
    select * into x from public.building_incomes where id = p_id for update;
    if not found then raise exception 'Không tìm thấy khoản thu'; end if;
    if not payer and (x.received_by is distinct from me or x.handover_status <> 'chua_nop') then
      raise exception 'Chỉ người ghi (khi chưa nộp tiền) hoặc Kế toán sửa khoản thu này';
    end if;
    update public.building_incomes set building_id = p_building, received_on = coalesce(p_date, received_on),
      category = coalesce(nullif(btrim(p_category), ''), 'Khác'), amount = round(p_amount),
      note = nullif(btrim(coalesce(p_note, '')), ''), payer_name = nullif(btrim(coalesce(p_payer_name, '')), ''),
      method = m,
      handover_status = case when m = 'chuyen_khoan' then 'da_nop' else handover_status end,
      handed_at = case when m = 'chuyen_khoan' then coalesce(handed_at, now()) else handed_at end,
      updated_at = now()
    where id = p_id returning id into nid;
  end if;
  return nid;
end $$;
revoke execute on function public.income_save(uuid, uuid, date, text, numeric, text, text, text) from public, anon;
grant execute on function public.income_save(uuid, uuid, date, text, numeric, text, text, text) to authenticated;

create or replace function public.income_delete(p_id uuid) returns void
language plpgsql security definer set search_path = public as $$
declare x public.building_incomes;
begin
  select * into x from public.building_incomes where id = p_id for update;
  if not found then raise exception 'Không tìm thấy khoản thu'; end if;
  if not (public.is_payer() or (x.received_by = auth.uid() and x.handover_status = 'chua_nop')) then
    raise exception 'Chỉ người ghi (khi chưa nộp tiền) hoặc Kế toán xoá khoản thu';
  end if;
  delete from public.building_incomes where id = p_id;
end $$;
revoke execute on function public.income_delete(uuid) from public, anon;
grant execute on function public.income_delete(uuid) to authenticated;

-- Kế toán / Quản lý xác nhận đã nhận tiền mặt
create or replace function public.income_confirm(p_ids uuid[]) returns int
language plpgsql security definer set search_path = public as $$
declare n int; r record;
begin
  if not public.is_payer() then raise exception 'Chỉ Kế toán hoặc Quản lý xác nhận đã nhận tiền'; end if;
  update public.building_incomes set handover_status = 'da_nop', handed_at = now(), handed_by = auth.uid(), updated_at = now()
   where id = any(coalesce(p_ids, '{}')) and handover_status = 'chua_nop';
  get diagnostics n = row_count;
  for r in select received_by, building_id, sum(amount) s from public.building_incomes
            where id = any(coalesce(p_ids, '{}')) and handed_by = auth.uid() and received_by is not null and received_by <> auth.uid()
            group by received_by, building_id loop
    perform public.notify(r.received_by, 'khac', 'Kế toán đã nhận tiền thu khác',
      'Đã xác nhận ' || to_char(r.s, 'FM999G999G999G999') || ' đ tiền mặt bạn nộp.', 'building', r.building_id);
  end loop;
  return n;
end $$;
revoke execute on function public.income_confirm(uuid[]) from public, anon;
grant execute on function public.income_confirm(uuid[]) to authenticated;

-- ---------- Sổ thu chi và báo cáo ----------
do $$
declare d text := pg_get_functiondef('public.building_ledger(uuid,date,date)'::regprocedure);
  a text := E'  chi_tay as (';
  b text := 'select * from thu_inv union all select * from thu_bill union all select * from thu_dem';
begin
  if position(a in d) = 0 or position(b in d) = 0 then raise exception '099: không thấy đoạn cần vá trong building_ledger'; end if;
  d := replace(d, a, E'  thu_khac as (\n'
    || E'    select x.received_on, ''thu'', x.category, coalesce(x.note, x.category), x.amount,\n'
    || E'      case x.method when ''chuyen_khoan'' then ''Thu khác · chuyển khoản'' else ''Thu khác · tiền mặt'' end, x.payer_name, x.building_id, null::text\n'
    || E'    from public.building_incomes x where x.received_on between p_from and p_to and x.building_id in (select id from bl)\n'
    || E'  ),\n' || a);
  d := replace(d, b, b || ' union all select * from thu_khac');
  execute d;
end $$;

do $$
declare fn text; d text; a text := 'select n.building_id, n.created_by, ''dem''';
begin
  foreach fn in array array['public.report_cashflow(date,date,text)', 'public.report_cashflow_detail(date,date)'] loop
    d := pg_get_functiondef(fn::regprocedure);
    if position(a in d) = 0 then raise exception '099: không thấy đoạn cần vá trong %', fn; end if;
    d := replace(d, a, 'select x.building_id, x.received_by, ''pt'', x.amount from public.building_incomes x where x.received_on between p_from and p_to'
                       || E'\n    union all\n    ' || a);
    execute d;
  end loop;
end $$;
