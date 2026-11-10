-- Danh mục nội thất chung của toà (chuỗi text, mỗi mục một dòng) trong chính sách toà.
-- Hiển thị cho mọi người dùng; phần "Ký hợp đồng & Hoa hồng" chỉ nhân viên và CTV thấy, giao diện có chế độ "Khách xem" để ẩn khi đưa màn hình cho khách.
alter table public.building_policy add column if not exists furniture text[] not null default '{}';

drop function if exists public.building_policies();
create or replace function public.building_policies()
returns table (
  building_id uuid, code text, name text, address text,
  fees jsonb, amenities text[], furniture text[], deposit_lines text[], commission_terms jsonb,
  forfeit_min numeric, forfeit_pct numeric, note text, updated_at timestamptz
)
language sql stable security definer set search_path = public as $$
  select b.id, b.code, b.name, b.address,
         coalesce(p.fees, '[]'::jsonb), coalesce(p.amenities, '{}'), coalesce(p.furniture, '{}'), coalesce(p.deposit_lines, '{}'),
         coalesce(p.commission_terms, '[]'::jsonb), p.forfeit_min, p.forfeit_pct, p.note, p.updated_at
  from public.buildings b
  left join public.building_policy p on p.building_id = b.id
  where public.is_active_user()
  order by b.code
$$;
revoke execute on function public.building_policies() from public, anon;
grant execute on function public.building_policies() to authenticated;

-- Nội thất mặc định theo hình chính sách chủ nhà gửi (quản lý sửa được trong app)
update public.building_policy p set furniture = case
    when b.name like '139D%' then array['Giường & nệm','Tủ quần áo','Bàn ăn + ghế / Sofa','Kệ bếp','Tủ lạnh','Máy lạnh','Tivi']
    else array['Giường & nệm','Tủ quần áo','Bàn ăn + ghế','Kệ bếp','Tủ lạnh','Máy lạnh']
  end
from public.buildings b
where b.id = p.building_id and cardinality(p.furniture) = 0;
