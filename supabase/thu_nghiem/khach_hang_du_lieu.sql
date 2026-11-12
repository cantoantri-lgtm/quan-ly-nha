-- Dữ liệu mẫu cho khách thử 0900000004 (chạy lại được; xoá dữ liệu mẫu cũ rồi tạo lại)
do $$
declare cu uuid; mg uuid; rm uuid; bd uuid; rent numeric; bid uuid;
begin
  select id into cu from public.profiles where phone = '0900000004';
  select id into mg from public.profiles where role = 'quan_ly' and is_active order by created_at limit 1;
  select r.id, r.building_id, coalesce(r.list_price, 6200000) into rm, bd, rent
    from public.rooms r join public.buildings b on b.id = r.building_id where b.code = 'TEST' order by r.code limit 1;
  update public.customer_profiles set building_id = bd, room_id = rm where id = cu;

  delete from public.meter_readings where customer_id = cu;
  delete from public.customer_bills where customer_id = cu;
  delete from public.customer_occupants where customer_id = cu;

  insert into public.customer_leases (customer_id, start_date, end_date, rent, deposit, elec_price, water_price, water_mode, service_fee, max_occupants, updated_by)
  values (cu, date '2026-10-01', date '2027-11-30', rent, 15000000, 3500, 20000, 'm3', 150000, 3, mg)
  on conflict (customer_id) do update set start_date = excluded.start_date, end_date = excluded.end_date, rent = excluded.rent, deposit = excluded.deposit,
    elec_price = excluded.elec_price, water_price = excluded.water_price, water_mode = excluded.water_mode, service_fee = excluded.service_fee,
    max_occupants = excluded.max_occupants, updated_by = excluded.updated_by, updated_at = now();

  insert into public.customer_occupants (customer_id, full_name, cccd, relation) values (cu, 'Nguyễn Thị Mai (thử)', '079300000005', 'Vợ');

  -- Số điện nước mẫu (chưa có ảnh thật: đường dẫn mau/...), vị trí mẫu tại TP.HCM
  insert into public.meter_readings (customer_id, room_id, kind, reading, read_on, photo_path, source, lat, lng, geo_accuracy, taken_at) values
    (cu, rm, 'dien', 1250.0, date '2026-11-01', 'mau/khong-anh', 'nhan_vien', 10.776900, 106.700900, 20, timestamptz '2026-11-01 09:00+07'),
    (cu, rm, 'dien', 1368.5, date '2026-11-12', 'mau/khong-anh', 'khach',     10.776900, 106.700900, 15, timestamptz '2026-11-12 08:30+07'),
    (cu, rm, 'nuoc',   85.0, date '2026-11-01', 'mau/khong-anh', 'nhan_vien', 10.776900, 106.700900, 20, timestamptz '2026-11-01 09:02+07'),
    (cu, rm, 'nuoc',   91.5, date '2026-11-12', 'mau/khong-anh', 'nhan_vien', 10.776900, 106.700900, 18, timestamptz '2026-11-12 08:40+07');

  -- Tiền cọc đã thu
  insert into public.customer_bills (customer_id, building_id, room_id, kind, amount, status, note, confirmed_at, confirmed_by, created_by)
  values (cu, bd, rm, 'tien_coc', 15000000, 'da_thanh_toan', 'Tiền cọc hợp đồng (mẫu)', timestamptz '2026-10-01 10:00+07', mg, mg);

  -- Phiếu thu tháng 11 (qua hàm thật để tính đúng)
  perform set_config('request.jwt.claims', json_build_object('sub', mg, 'role', 'authenticated')::text, true);
  set local role authenticated;
  bid := public.statement_create(cu, date '2026-11-01', date '2026-11-20', 0, null);
  reset role;
end $$;
