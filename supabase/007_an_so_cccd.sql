-- Số CCCD, ngày cấp, nơi cấp là dữ liệu nhạy cảm: nhân viên (xem được danh sách khách của toà mình)
-- không đọc được các cột này. Quản lý / Giám sát của toà đọc qua hàm tenant_private().
-- Ghi (thêm, sửa) các cột này vẫn theo policy cũ: chỉ Quản lý / Giám sát của toà.
revoke select on public.tenants from authenticated;
grant select (id, building_id, full_name, phone, date_of_birth, hometown, note, created_by, created_at,
              flag, flag_note, cccd_consent_at, cccd_consent_by, cccd_consent_note)
  on public.tenants to authenticated;

create or replace function public.tenant_private(p_id uuid)
returns table (id_number text, id_issued_date date, id_issued_place text)
language sql stable security definer set search_path = public as $$
  select t.id_number, t.id_issued_date, t.id_issued_place
  from public.tenants t
  where t.id = p_id and public.can_manage_building(t.building_id)
$$;
revoke execute on function public.tenant_private(uuid) from public, anon;
grant execute on function public.tenant_private(uuid) to authenticated;
