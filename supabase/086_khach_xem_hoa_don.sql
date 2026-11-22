-- 086: Sửa quyền khách xem hoá đơn (085 dùng app_role() = 'khach_hang', nhưng app_role() trả null với khách)
--  customer_owns_contract tự kiểm: người gọi là khách hàng đang hoạt động và đứng tên hợp đồng.

create or replace function public.customer_owns_contract(p_contract uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.customer_profiles cp
                   join public.profiles p on p.id = cp.id and p.is_active and p.role = 'khach_hang'
                   join public.contracts c on c.tenant_id = cp.tenant_id
                  where cp.id = auth.uid() and c.id = p_contract)
$$;
revoke execute on function public.customer_owns_contract(uuid) from public, anon;
grant execute on function public.customer_owns_contract(uuid) to authenticated;

drop policy if exists invoices_select_customer on public.invoices;
create policy invoices_select_customer on public.invoices for select to authenticated
  using (public.customer_owns_contract(contract_id));
