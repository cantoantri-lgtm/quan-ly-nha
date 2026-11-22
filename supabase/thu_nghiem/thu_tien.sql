-- =============================================================
-- DỮ LIỆU THỬ CHỨC NĂNG THU TIỀN (không phải migration, chạy lại nhiều lần cũng được)
--   * Tài khoản 0900000003 "Nhân viên (thử)", gán Toà thử nghiệm.
--     Mật khẩu ngẫu nhiên, không ai biết: Quản lý đặt mật khẩu trong app (Quản trị → Nhân sự → Cấp lại mật khẩu).
--   * Toà TEST "Toà thử nghiệm", tình trạng Ngưng hoạt động để không hiện ở Phòng trống, bản đồ, website.
--   * Phòng 101 (đang ở, có hợp đồng + hoá đơn tháng này) và 102 (trống). Giá 10.000 đ để chuyển khoản thật cho rẻ.
--   * Khách "Khách thử nghiệm" (không có CCCD), hợp đồng HD-TEST-101 ngày thu 25.
-- Xoá sạch: chạy supabase/thu_nghiem/cleanup.sql
-- =============================================================
do $$
declare
  uid uuid; b uuid; r101 uuid; ten uuid; con uuid;
  per date := date_trunc('month', (now() at time zone 'Asia/Ho_Chi_Minh')::date)::date;
  l jsonb;
begin
  -- 1. Tài khoản
  select id into uid from auth.users where email = '0900000003@neonestly.app';
  if uid is null then
    uid := gen_random_uuid();
    insert into auth.users (instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
      raw_app_meta_data, raw_user_meta_data, created_at, updated_at,
      confirmation_token, recovery_token, email_change_token_new, email_change)
    values ('00000000-0000-0000-0000-000000000000', uid, 'authenticated', 'authenticated',
      '0900000003@neonestly.app',
      extensions.crypt(encode(extensions.gen_random_bytes(24), 'base64'), extensions.gen_salt('bf')), now(),
      jsonb_build_object('provider','email','providers',jsonb_build_array('email'),'role','nhan_vien','provisioned',true),
      jsonb_build_object('full_name','Nhân viên (thử)','phone','0900000003'),
      now(), now(), '', '', '', '');
    insert into auth.identities (id, user_id, provider_id, provider, identity_data, last_sign_in_at, created_at, updated_at)
    values (gen_random_uuid(), uid, uid::text, 'email',
      jsonb_build_object('sub',uid::text,'email','0900000003@neonestly.app','email_verified',true), now(), now(), now());
  end if;
  insert into public.profiles (id, full_name, phone, role, is_active)
  values (uid, 'Nhân viên (thử)', '0900000003', 'nhan_vien', true)
  on conflict (id) do update set full_name = excluded.full_name, phone = excluded.phone, role = excluded.role, is_active = true;

  -- 2. Toà
  insert into public.buildings (code, name, address, kind, total_floors, note, status, status_note, status_since)
  values ('TEST', 'Toà thử nghiệm', 'Dữ liệu thử, có thể xoá', 'hon_hop', 1, 'Tạo bởi supabase/thu_nghiem/thu_tien.sql',
          'ngung', 'Toà thử nghiệm, không chào thuê', (now() at time zone 'Asia/Ho_Chi_Minh')::date)
  on conflict (code) do update set name = excluded.name
  returning id into b;
  insert into public.building_members (building_id, user_id) values (b, uid) on conflict do nothing;

  -- 3. Phòng
  insert into public.rooms (building_id, code, floor, room_type, rent_mode, list_price, max_occupants, status) values
    (b, '101', 1, 'Studio', 'thang', 10000, 2, 'trong'),
    (b, '102', 1, 'Studio', 'thang', 10000, 2, 'trong')
  on conflict (building_id, code) do nothing;
  select id into r101 from public.rooms where building_id = b and code = '101';

  -- 4. Khách + hợp đồng + hoá đơn tháng này (chỉ tạo một lần)
  select id into con from public.contracts where code = 'HD-TEST-101';
  if con is null then
    insert into public.tenants (building_id, full_name, phone, note)
    values (b, 'Khách thử nghiệm', null, 'Dữ liệu thử') returning id into ten;
    insert into public.contracts (code, room_id, building_id, tenant_id, start_date, end_date, rent_amount, deposit_amount, billing_day, note)
    values ('HD-TEST-101', r101, b, ten, per, (per + interval '12 months' - interval '1 day')::date, 10000, 0, 25, 'Hợp đồng thử')
    returning id into con;   -- trigger chuyển phòng 101 sang "đang ở"
  end if;
  l := public.invoice_lines(con, per);
  insert into public.invoices (contract_id, building_id, period, amount, due_date, lines, vat_amount)
  values (con, b, per, (select coalesce(sum((x->>'amount')::numeric), 0) from jsonb_array_elements(l) x), per + 24, l,
          (select sum((x->>'vat')::numeric) from jsonb_array_elements(l) x))
  on conflict (contract_id, period) do nothing;
end $$;

select b.code, r.code room, r.status, i.amount, i.due_date, i.pay_code, i.status inv
  from public.buildings b join public.rooms r on r.building_id = b.id
  left join public.contracts c on c.room_id = r.id left join public.invoices i on i.contract_id = c.id
 where b.code = 'TEST' order by r.code;
