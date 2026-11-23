-- 097: Mở lại hoa hồng CTV theo từng toà (23/11/2026)
--  Nhân viên (Sale) xem được mục hoa hồng trong Dịch vụ & chính sách của toà. Khách không thấy (như cũ).
--  Chỉ Lead Sale trở lên (Quản lý, Giám sát, Trưởng nhóm / cấp L2 trở lên trong sơ đồ công ty) cập nhật,
--  qua hàm policy_commission_save, áp dụng cho mọi toà. Lưu chính sách toà thông thường không đổi được hoa hồng.

create or replace function public.tg_building_policy_commission() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is not null and not public.is_lead_up()
     and coalesce(current_setting('app.commission_save', true), '') <> '1' then
    if tg_op = 'INSERT' then
      new.commission_terms := '[]'::jsonb; new.forfeit_min := null; new.forfeit_pct := null;
    else
      new.commission_terms := old.commission_terms; new.forfeit_min := old.forfeit_min; new.forfeit_pct := old.forfeit_pct;
    end if;
  end if;
  return new;
end $$;

create or replace function public.policy_commission_save(p_building uuid, p_terms jsonb, p_forfeit_min numeric, p_forfeit_pct numeric)
returns void language plpgsql security definer set search_path = public as $$
declare t jsonb := coalesce(p_terms, '[]'::jsonb); clean jsonb;
begin
  if not public.is_lead_up() then raise exception 'Chỉ Lead Sale trở lên cập nhật hoa hồng CTV'; end if;
  if not exists (select 1 from public.buildings where id = p_building) then raise exception 'Không tìm thấy toà'; end if;
  if jsonb_typeof(t) <> 'array' or jsonb_array_length(t) > 10 then raise exception 'Tối đa 10 mức hoa hồng'; end if;
  if exists (select 1 from jsonb_array_elements(t) e
              where jsonb_typeof(e->'months') <> 'number' or jsonb_typeof(e->'pct') <> 'number'
                 or (e->>'months')::numeric <> trunc((e->>'months')::numeric)
                 or (e->>'months')::int not between 1 and 120 or (e->>'pct')::numeric not between 0 and 100) then
    raise exception 'Hoa hồng theo kỳ hợp đồng: số tháng nguyên từ 1 đến 120, tỷ lệ từ 0 đến 100%%';
  end if;
  if (select count(distinct (e->>'months')::int) from jsonb_array_elements(t) e) <> jsonb_array_length(t) then
    raise exception 'Mỗi kỳ hợp đồng chỉ nhập một mức hoa hồng';
  end if;
  if p_forfeit_min is not null and p_forfeit_min < 0 then raise exception 'Mức cọc tối thiểu không hợp lệ'; end if;
  if p_forfeit_pct is not null and (p_forfeit_pct < 0 or p_forfeit_pct > 100) then raise exception 'Hoa hồng bỏ cọc từ 0 đến 100%%'; end if;
  select coalesce(jsonb_agg(jsonb_build_object('months', (e->>'months')::int, 'pct', (e->>'pct')::numeric) order by (e->>'months')::int), '[]'::jsonb)
    into clean from jsonb_array_elements(t) e;
  perform set_config('app.commission_save', '1', true);
  insert into public.building_policy (building_id, commission_terms, forfeit_min, forfeit_pct, updated_by)
  values (p_building, clean, p_forfeit_min, p_forfeit_pct, auth.uid())
  on conflict (building_id) do update set commission_terms = excluded.commission_terms,
    forfeit_min = excluded.forfeit_min, forfeit_pct = excluded.forfeit_pct, updated_at = now(), updated_by = auth.uid();
  perform set_config('app.commission_save', '', true);
end $$;
revoke execute on function public.policy_commission_save(uuid, jsonb, numeric, numeric) from public, anon;
grant execute on function public.policy_commission_save(uuid, jsonb, numeric, numeric) to authenticated;
