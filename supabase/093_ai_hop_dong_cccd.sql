-- 093: Dữ liệu "Hợp đồng & CCCD" cho trợ lý báo cáo AI (chỉ Quản lý, qua ai_guard)
--  Chỉ trạng thái đủ / thiếu theo phòng. KHÔNG có tên, SĐT, số giấy tờ của khách.
--  CCCD đủ = có số giấy tờ + xác nhận đồng ý lưu + ảnh mặt trước và mặt sau (hộ chiếu: 1 ảnh) — giống tenant_has_cccd.
create or replace function public.ai_contracts(p_building text default null)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare t date := public.ai_today(); ids uuid[];
begin
  perform public.ai_guard();
  ids := public.ai_building_ids(p_building);
  return (
  with b as (select id, code, kind from public.buildings where id = any(ids)),
  rm as (select r.id, r.building_id, r.code, r.status from public.rooms r where r.building_id in (select id from b)),
  ct as (
    select c.id, c.room_id, c.building_id, c.code, c.start_date, c.end_date, c.tenant_id
      from public.contracts c where c.status = 'hieu_luc' and c.building_id in (select id from b)
  ),
  ppl as (   -- người đang ở theo hợp đồng hiệu lực (gồm người đứng tên)
    select o.contract_id, t2.id tenant_id,
      coalesce(btrim(t2.id_number), '') <> '' has_no,
      t2.cccd_consent_at is not null has_consent,
      case when t2.id_type = 'passport'
           then exists (select 1 from public.files f where f.kind = 'cccd' and f.tenant_id = t2.id and f.label = 'ho_chieu')
           else exists (select 1 from public.files f where f.kind = 'cccd' and f.tenant_id = t2.id and f.label = 'truoc')
            and exists (select 1 from public.files f where f.kind = 'cccd' and f.tenant_id = t2.id and f.label = 'sau') end has_photo
      from public.contract_occupants o join public.tenants t2 on t2.id = o.tenant_id
     where o.move_out is null and o.contract_id in (select id from ct)
  ),
  per_room as (
    select rm.building_id, rm.code room, rm.status::text room_status, ct.id cid, ct.code contract_code, ct.start_date, ct.end_date,
      (select count(*) from ppl where ppl.contract_id = ct.id) people,
      (select count(*) from ppl where ppl.contract_id = ct.id and has_no and has_consent and has_photo) cccd_ok,
      (select count(*) from ppl where ppl.contract_id = ct.id and not has_no) miss_no,
      (select count(*) from ppl where ppl.contract_id = ct.id and not has_consent) miss_consent,
      (select count(*) from ppl where ppl.contract_id = ct.id and not has_photo) miss_photo,
      (select count(*) from public.contract_vehicles v where v.contract_id = ct.id and v.removed_on is null) vehicles,
      exists (select 1 from public.customer_profiles cp where cp.tenant_id = ct.tenant_id) app_account
    from rm left join ct on ct.room_id = rm.id
  )
  select jsonb_build_object(
    'as_of', t,
    'note', 'Chỉ có trạng thái, không có tên hay số giấy tờ khách. CCCD đủ = có số giấy tờ, xác nhận đồng ý lưu, ảnh mặt trước và mặt sau (hộ chiếu 1 ảnh). '
            || 'occupied_no_contract: phòng đang ở nhưng chưa có hợp đồng hiệu lực trên app. Toà khách sạn thuê theo đêm không cần hợp đồng tháng.',
    'buildings', (select coalesce(jsonb_agg(x order by x->>'code'), '[]'::jsonb) from (
      select jsonb_build_object('code', b.code, 'kind', b.kind,
        'rooms', count(p.room),
        'occupied_rooms', count(*) filter (where p.room_status = 'dang_o'),
        'active_contracts', count(p.cid),
        'occupied_no_contract', count(*) filter (where p.room_status = 'dang_o' and p.cid is null),
        'contracts_no_end_date', count(*) filter (where p.cid is not null and p.end_date is null),
        'contracts_expired_still_active', count(*) filter (where p.end_date < t),
        'contracts_end_in_30d', count(*) filter (where p.end_date between t and t + 30),
        'people', coalesce(sum(p.people), 0), 'cccd_ok', coalesce(sum(p.cccd_ok), 0),
        'cccd_missing', coalesce(sum(p.people - p.cccd_ok), 0),
        'missing_id_number', coalesce(sum(p.miss_no), 0), 'missing_consent', coalesce(sum(p.miss_consent), 0),
        'missing_photo', coalesce(sum(p.miss_photo), 0),
        'contracts_with_all_cccd', count(*) filter (where p.cid is not null and p.people > 0 and p.cccd_ok = p.people),
        'vehicles', coalesce(sum(p.vehicles), 0),
        'contracts_with_app_account', count(*) filter (where p.app_account),
        'rooms_with_contract', coalesce(jsonb_agg(p.room order by p.room) filter (where p.cid is not null), '[]'::jsonb),
        'rooms_occupied_no_contract', coalesce(jsonb_agg(p.room order by p.room) filter (where p.room_status = 'dang_o' and p.cid is null), '[]'::jsonb)
      ) x
      from b left join per_room p on p.building_id = b.id
      group by b.id, b.code, b.kind) s),
    'rooms_need_action', (select coalesce(jsonb_agg(x order by x->>'building', x->>'room'), '[]'::jsonb) from (
      select jsonb_build_object('building', b.code, 'room', p.room, 'room_status', p.room_status,
        'has_contract', p.cid is not null, 'contract_code', p.contract_code,
        'start', p.start_date, 'end', p.end_date, 'days_to_end', p.end_date - t,
        'people', p.people, 'cccd_ok', p.cccd_ok,
        'missing', jsonb_strip_nulls(jsonb_build_object(
          'so_giay_to', nullif(p.miss_no, 0), 'dong_y_luu', nullif(p.miss_consent, 0), 'anh_giay_to', nullif(p.miss_photo, 0))),
        'issues', to_jsonb(array_remove(array[
          case when p.room_status = 'dang_o' and p.cid is null then 'dang_o_chua_co_hop_dong' end,
          case when p.cid is not null and p.end_date is null then 'thieu_ngay_ket_thuc' end,
          case when p.end_date < t then 'hop_dong_qua_han' end,
          case when p.end_date between t and t + 30 then 'sap_het_han_30_ngay' end,
          case when p.cid is not null and p.people > p.cccd_ok then 'thieu_cccd' end], null))) x
      from per_room p join b on b.id = p.building_id
      where (p.room_status = 'dang_o' and p.cid is null)
         or (p.cid is not null and (p.end_date is null or p.end_date <= t + 30 or p.people > p.cccd_ok))
      limit 300) s)
  ));
end $$;
revoke execute on function public.ai_contracts(text) from public, anon;
grant execute on function public.ai_contracts(text) to authenticated;
