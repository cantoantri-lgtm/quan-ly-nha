-- =====================================================================
-- Neo Nestly · DANH SÁCH XUẤT HOÁ ĐƠN GTGT CUỐI NGÀY  (chạy sau 015)
--   Mỗi khoản tiền thuê nhân viên ghi nhận "đã thu" (hoặc hệ thống tự ghi khi nối SePay) trong ngày
--   → cuối ngày (21:00) app báo Quản lý / Kế toán, và có trang liệt kê đủ thông tin để xuất hoá đơn GTGT.
--   Có số CCCD nên chỉ Quản lý và người giữ nhiệm vụ Kế toán xem được.
-- =====================================================================

-- Địa chỉ ghi trên CCCD (khác "quê quán"): để ghi vào hoá đơn
alter table public.tenants add column if not exists id_address text;

-- id_address cũng là dữ liệu nhạy cảm: chỉ đọc qua hàm, giống số CCCD (không cấp select cột này)
drop function if exists public.tenant_private(uuid);
create function public.tenant_private(p_id uuid)
returns table (id_number text, id_issued_date date, id_issued_place text, id_address text)
language sql stable security definer set search_path = public as $$
  select t.id_number, t.id_issued_date, t.id_issued_place, t.id_address
  from public.tenants t
  where t.id = p_id and public.can_manage_building(t.building_id)
$$;
revoke execute on function public.tenant_private(uuid) from public, anon;
grant execute on function public.tenant_private(uuid) to authenticated;

-- Danh sách khoản thu tiền thuê đã ghi nhận trong một ngày (giờ Việt Nam)
create or replace function public.vat_daily_report(p_date date)
returns table (
  invoice_id uuid, collected_at date, building_code text, room_code text, tenant_name text, phone text,
  id_number text, id_address text, amount numeric, content text, paid_via text, collected_by_name text, contract_code text
)
language plpgsql stable security definer set search_path = public as $$
begin
  if not (public.is_manager() or public.is_duty('ke_toan')) then
    raise exception 'Chỉ Quản lý hoặc Kế toán xem được danh sách xuất hoá đơn';
  end if;
  return query
    select i.id, i.collected_at, b.code, r.code, t.full_name, t.phone, t.id_number, t.id_address,
           i.amount,
           ('Tiền thuê phòng ' || r.code || ' tháng ' || to_char(i.period, 'MM/YYYY'))::text,
           i.paid_via, p.full_name, c.code
    from public.invoices i
    join public.contracts c on c.id = i.contract_id
    join public.rooms r on r.id = c.room_id
    join public.buildings b on b.id = i.building_id
    join public.tenants t on t.id = c.tenant_id
    left join public.profiles p on p.id = i.collected_by
    where i.status = 'da_thu' and i.collected_at = p_date
    order by b.code, r.code;
end $$;
revoke execute on function public.vat_daily_report(date) from public, anon;
grant execute on function public.vat_daily_report(date) to authenticated;

-- 21:00 giờ Việt Nam: báo Quản lý + Kế toán nếu hôm nay có khoản thu
create or replace function public.notify_vat_daily() returns void
language plpgsql security definer set search_path = public as $$
declare d date := (now() at time zone 'Asia/Ho_Chi_Minh')::date; n int; total numeric; u record;
begin
  select count(*), coalesce(sum(amount), 0) into n, total from public.invoices where status = 'da_thu' and collected_at = d;
  if n = 0 then return; end if;
  for u in
    select pr.id from public.profiles pr
    where pr.is_active and pr.role <> 'cong_tac_vien'
      and (pr.role = 'quan_ly' or exists (select 1 from public.org_staff o where o.profile_id = pr.id and o.duty = 'ke_toan'))
  loop
    perform public.notify(u.id, 'khac', 'Danh sách xuất hoá đơn GTGT hôm nay',
      n || ' khoản thu tiền thuê, tổng ' || to_char(total, 'FM999G999G999G999') || ' đ', 'vat_day', null, 'vat-' || d || '-' || u.id);
  end loop;
end $$;
revoke execute on function public.notify_vat_daily() from public, anon, authenticated;

-- 14:00 UTC = 21:00 giờ Việt Nam
select cron.schedule('bao-hoa-don-gtgt-cuoi-ngay', '0 14 * * *', $$select public.notify_vat_daily()$$);
