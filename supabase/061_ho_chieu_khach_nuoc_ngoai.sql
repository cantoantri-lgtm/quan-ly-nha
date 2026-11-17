-- Khách nước ngoài: giấy tờ là CCCD hoặc Hộ chiếu (17/11/2026).
--  * tenants.id_type: 'cccd' (mặc định) | 'passport'; tenants.nationality: quốc tịch (bắt buộc ở giao diện khi là hộ chiếu).
--  * Đủ giấy tờ: CCCD = số + đồng ý lưu + ảnh mặt trước, mặt sau; Hộ chiếu = số + đồng ý lưu + ảnh trang thông tin.
--  * Tài khoản app khách hàng, người ở đăng ký trong app: nhận số CCCD 12 số hoặc số hộ chiếu (6–20 chữ/số, viết hoa).

alter table public.tenants
  add column if not exists id_type text not null default 'cccd' check (id_type in ('cccd','passport')),
  add column if not exists nationality text check (nationality is null or length(nationality) <= 60);
grant select (id_type, nationality) on public.tenants to authenticated;   -- loại giấy tờ, quốc tịch không phải số nhạy cảm

create or replace function public.tenant_has_cccd(p_tenant uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.tenants t
    where t.id = p_tenant and coalesce(btrim(t.id_number), '') <> '' and t.cccd_consent_at is not null
      and case when t.id_type = 'passport'
        then exists (select 1 from public.files f where f.kind = 'cccd' and f.tenant_id = t.id and f.label = 'ho_chieu')
        else exists (select 1 from public.files f where f.kind = 'cccd' and f.tenant_id = t.id and f.label = 'truoc')
         and exists (select 1 from public.files f where f.kind = 'cccd' and f.tenant_id = t.id and f.label = 'sau')
      end)
$$;

-- Số giấy tờ của tài khoản khách: CCCD 12 số hoặc hộ chiếu
alter table public.customer_profiles drop constraint if exists customer_profiles_cccd_check;
alter table public.customer_profiles add constraint customer_profiles_cccd_check check (cccd ~ '^[A-Z0-9]{6,20}$');
alter table public.customer_occupants drop constraint if exists customer_occupants_cccd_check;
alter table public.customer_occupants add constraint customer_occupants_cccd_check check (cccd ~ '^[A-Z0-9]{6,20}$');

-- Người ở đăng ký trong app khách: thêm loại giấy tờ (mặc định CCCD như cũ)
drop function if exists public.occupant_add(uuid, text, text, text);
create or replace function public.occupant_add(p_customer uuid, p_name text, p_cccd text, p_relation text, p_type text default 'cccd') returns uuid
language plpgsql security definer set search_path = public as $$
declare cc text := upper(regexp_replace(coalesce(p_cccd,''), '[^A-Za-z0-9]', '', 'g')); mx int; n int; nid uuid;
begin
  if not public.customer_access_ok(p_customer) then raise exception 'Không có quyền'; end if;
  if not exists (select 1 from public.customer_profiles where id = p_customer) then raise exception 'Không phải tài khoản khách hàng'; end if;
  p_name := btrim(coalesce(p_name,''));
  if p_name = '' then raise exception 'Cần nhập họ tên người ở'; end if;
  if coalesce(p_type, 'cccd') = 'passport' then
    if cc !~ '^[A-Z0-9]{6,20}$' then raise exception 'Số hộ chiếu gồm 6–20 chữ và số'; end if;
  elsif cc !~ '^[0-9]{12}$' then raise exception 'CCCD phải đủ 12 số. Khách nước ngoài: chọn Hộ chiếu';
  end if;
  if exists (select 1 from public.customer_profiles where cccd = cc) or exists (select 1 from public.customer_occupants where cccd = cc) then
    raise exception 'Số CCCD / hộ chiếu này đã được đăng ký. Mỗi giấy tờ chỉ đăng ký một lần';
  end if;
  select max_occupants into mx from public.customer_leases where customer_id = p_customer;
  select count(*) + 1 into n from public.customer_occupants where customer_id = p_customer;
  if mx is not null and n + 1 > mx then raise exception 'Phòng chỉ cho tối đa % người ở', mx; end if;
  insert into public.customer_occupants (customer_id, full_name, cccd, relation)
    values (p_customer, left(p_name, 100), cc, left(nullif(btrim(coalesce(p_relation,'')),''), 40)) returning id into nid;
  return nid;
end $$;
revoke execute on function public.occupant_add(uuid, text, text, text, text) from public, anon;
grant execute on function public.occupant_add(uuid, text, text, text, text) to authenticated;
