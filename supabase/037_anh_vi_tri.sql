-- Ảnh đồng hồ kèm vị trí GPS và thời điểm chụp
alter table public.meter_readings
  add column if not exists lat numeric(9,6), add column if not exists lng numeric(9,6),
  add column if not exists geo_accuracy int, add column if not exists taken_at timestamptz;

drop function if exists public.meter_add(uuid, text, numeric, text, text, boolean, numeric, text);
create or replace function public.meter_add(p_customer uuid, p_kind text, p_reading numeric, p_path text, p_store text,
  p_thumb boolean, p_ocr numeric, p_note text, p_lat numeric default null, p_lng numeric default null,
  p_accuracy int default null, p_taken_at timestamptz default null) returns uuid
language plpgsql security definer set search_path = public as $$
declare c public.customer_profiles; self boolean := (p_customer = auth.uid() and public.is_customer()); last_r numeric; nid uuid; nm text; u uuid; lbl text;
begin
  if not self and (public.app_role() is null or not public.can_handle_customer(p_customer)) then raise exception 'Không có quyền nhập số cho khách này'; end if;
  if p_kind not in ('dien','nuoc') then raise exception 'Loại đồng hồ không hợp lệ'; end if;
  if self and p_kind <> 'dien' then raise exception 'Khách chỉ gửi số điện. Số nước do nhân viên ghi'; end if;
  select * into c from public.customer_profiles where id = p_customer;
  if not found then raise exception 'Không phải tài khoản khách hàng'; end if;
  if c.room_id is null then raise exception 'Khách chưa được gán phòng'; end if;
  if p_reading is null or p_reading < 0 then raise exception 'Số đồng hồ không hợp lệ'; end if;
  if coalesce(p_path,'') not like 'dong-ho/' || p_customer::text || '/%' then raise exception 'Cần chụp ảnh đồng hồ'; end if;
  if p_lat is null or p_lng is null or p_lat not between -90 and 90 or p_lng not between -180 and 180 then
    raise exception 'Ảnh đồng hồ cần kèm vị trí. Hãy bật định vị (GPS) rồi chụp lại';
  end if;
  select reading into last_r from public.meter_readings where customer_id = p_customer and kind = p_kind order by read_on desc, created_at desc, reading desc limit 1;
  if last_r is not null and p_reading < last_r then raise exception 'Số mới (%) nhỏ hơn số đã ghi trước đó (%)', p_reading, last_r; end if;
  insert into public.meter_readings (customer_id, room_id, kind, reading, photo_path, photo_store, photo_thumb, source, ocr_value, note, lat, lng, geo_accuracy, taken_at)
    values (p_customer, c.room_id, p_kind, p_reading, p_path, coalesce(p_store,'supabase'), coalesce(p_thumb,false),
            case when self then 'khach' else 'nhan_vien' end, p_ocr, left(nullif(btrim(coalesce(p_note,'')),''), 200),
            round(p_lat, 6), round(p_lng, 6), p_accuracy, coalesce(p_taken_at, now())) returning id into nid;
  lbl := case p_kind when 'dien' then 'điện' else 'nước' end;
  if self then
    select full_name into nm from public.profiles where id = p_customer;
    for u in select distinct s.x from (select c.created_by as x union select id from public.profiles where role in ('quan_ly','giam_sat') and is_active) s where s.x is not null loop
      perform public.notify(u, 'khac', 'Khách gửi số ' || lbl, coalesce(nm,'Khách') || ' · ' || p_reading::text, 'customer', p_customer, 'meter-' || nid || '-' || u);
    end loop;
  else
    perform public.notify(p_customer, 'khac', 'Nhân viên ghi số ' || lbl, 'Số ' || lbl || ': ' || p_reading::text, 'customer', p_customer, 'meter-' || nid);
  end if;
  return nid;
end $$;
revoke execute on function public.meter_add(uuid, text, numeric, text, text, boolean, numeric, text, numeric, numeric, int, timestamptz) from public, anon;
grant execute on function public.meter_add(uuid, text, numeric, text, text, boolean, numeric, text, numeric, numeric, int, timestamptz) to authenticated;
