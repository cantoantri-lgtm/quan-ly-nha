-- 117: Lập hợp đồng thuê tháng bắt buộc có số điện đầu kỳ kèm ảnh đồng hồ (bật cùng bản giao diện có ô nhập).
-- Kiểm tra khi lập hợp đồng; sửa số nhận phòng về sau chỉ Giám sát / Quản lý (kèm ảnh mới)
create or replace function public.tg_contracts_elec_start() returns trigger
language plpgsql security definer set search_path = public as $$
declare rm public.rooms;
begin
  if auth.uid() is null then return new; end if;            -- nhập liệu nội bộ bằng SQL
  select * into rm from public.rooms where id = new.room_id;
  if not found or rm.rent_mode <> 'thang' then return new; end if;
  if tg_op = 'UPDATE' then
    if new.elec_start is not distinct from old.elec_start and new.elec_start_photo_path is not distinct from old.elec_start_photo_path then return new; end if;
    if not public.can_manage_building(rm.building_id) then raise exception 'Chỉ Giám sát hoặc Quản lý sửa số điện lúc nhận phòng'; end if;
    if new.elec_start_photo_path is not distinct from old.elec_start_photo_path then raise exception 'Sửa số điện nhận phòng cần chụp ảnh đồng hồ mới'; end if;
  end if;
  if new.elec_start is null then raise exception 'Phòng %: nhập số điện đầu kỳ lúc khách nhận phòng', rm.code; end if;
  if new.elec_start_photo_path is null then raise exception 'Phòng %: chụp ảnh đồng hồ điện lúc khách nhận phòng', rm.code; end if;
  if new.elec_start_photo_path not like 'dong-ho/' || rm.building_id::text || '/%' then raise exception 'Ảnh đồng hồ không thuộc toà này'; end if;
  if coalesce(new.elec_start_photo_store, '') not in ('r2', 'supabase') then raise exception 'Kho ảnh không hợp lệ'; end if;
  new.elec_start_at := now();
  new.elec_start_taken_at := coalesce(new.elec_start_taken_at, now());
  return new;
end $$;
drop trigger if exists contracts_elec_start on public.contracts;
create trigger contracts_elec_start before insert or update of elec_start, elec_start_photo_path on public.contracts
  for each row execute function public.tg_contracts_elec_start();

