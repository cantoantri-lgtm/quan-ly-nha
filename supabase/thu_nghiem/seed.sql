-- =============================================================
-- DỮ LIỆU THỬ NGHIỆM (không phải migration — chạy lại nhiều lần cũng được)
-- Tạo 3 tài khoản thử + "Toà thử nghiệm" + vài phòng, vài việc mẫu.
-- Mật khẩu chung: ThuNghiem2026
--   0900000001  Quản lý (thử)
--   0900000002  Giám sát (thử)   — gán Toà thử nghiệm
--   0900000003  Nhân viên (thử)  — gán Toà thử nghiệm
-- Xoá sạch: chạy supabase/thu_nghiem/cleanup.sql
-- =============================================================
do $$
declare
  acc record;
  uid uuid;
  b   uuid;
  ql  uuid; gs uuid; nv uuid;
  pw  text := 'ThuNghiem2026';
begin
  for acc in
    select * from (values
      ('0900000001', 'Quản lý (thử)',   'quan_ly'),
      ('0900000002', 'Giám sát (thử)',  'giam_sat'),
      ('0900000003', 'Nhân viên (thử)', 'nhan_vien')
    ) v(phone, full_name, role)
  loop
    select id into uid from auth.users where email = acc.phone || '@neonestly.app';
    if uid is null then
      uid := gen_random_uuid();
      insert into auth.users (instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
        raw_app_meta_data, raw_user_meta_data, created_at, updated_at,
        confirmation_token, recovery_token, email_change_token_new, email_change)
      values ('00000000-0000-0000-0000-000000000000', uid, 'authenticated', 'authenticated',
        acc.phone || '@neonestly.app', extensions.crypt(pw, extensions.gen_salt('bf')), now(),
        jsonb_build_object('provider','email','providers',jsonb_build_array('email'),'role',acc.role,'provisioned',true),
        jsonb_build_object('full_name',acc.full_name,'phone',acc.phone),
        now(), now(), '', '', '', '');
      insert into auth.identities (id, user_id, provider_id, provider, identity_data, last_sign_in_at, created_at, updated_at)
      values (gen_random_uuid(), uid, uid::text, 'email',
        jsonb_build_object('sub',uid::text,'email',acc.phone || '@neonestly.app','email_verified',true),
        now(), now(), now());
    end if;
    -- hồ sơ (trigger handle_new_user đã tạo; cập nhật cho chắc)
    insert into public.profiles (id, full_name, phone, role, is_active)
    values (uid, acc.full_name, acc.phone, acc.role::public.user_role, true)
    on conflict (id) do update set full_name = excluded.full_name, phone = excluded.phone,
      role = excluded.role, is_active = true;
    if acc.role = 'quan_ly' then ql := uid; elsif acc.role = 'giam_sat' then gs := uid; else nv := uid; end if;
  end loop;

  -- Toà + phòng
  insert into public.buildings (code, name, address, kind, total_floors, note)
  values ('TEST', 'Toà thử nghiệm', 'Dữ liệu thử — có thể xoá', 'hon_hop', 3, 'Tạo bởi supabase/thu_nghiem/seed.sql')
  on conflict (code) do update set name = excluded.name
  returning id into b;

  insert into public.building_members (building_id, user_id)
  values (b, gs), (b, nv) on conflict do nothing;

  insert into public.rooms (building_id, code, floor, room_type, rent_mode, list_price, max_occupants, status)
  select b, f::text || lpad(r::text, 2, '0'), f,
         case when r = 1 then '1PN' else 'Studio' end,
         'thang', case when r = 1 then 6500000 else 5000000 end, 2,
         (array['trong','dang_o','dang_sua','giu_cho'])[1 + (f + r) % 4]::public.room_status
  from generate_series(1, 3) f, generate_series(1, 4) r
  on conflict (building_id, code) do nothing;

  -- Việc mẫu (chỉ tạo nếu toà chưa có việc nào)
  if not exists (select 1 from public.tasks where building_id = b) then
    insert into public.tasks (building_id, title, description, assignee_id, created_by, due_date, priority, status) values
      (b, 'Kiểm tra bình chữa cháy tầng 1-3', 'Việc mẫu để thử', nv, ql, (now() at time zone 'Asia/Ho_Chi_Minh')::date + 2, 'cao', 'chua_lam'),
      (b, 'Thay bóng đèn hành lang tầng 2', 'Việc mẫu để thử', nv, gs, (now() at time zone 'Asia/Ho_Chi_Minh')::date + 1, 'binh_thuong', 'dang_lam'),
      (b, 'Dọn phòng 301 trước khi khách vào', 'Việc mẫu để thử', nv, ql, (now() at time zone 'Asia/Ho_Chi_Minh')::date - 1, 'gap', 'chua_lam'),
      (b, 'Lập kế hoạch bảo trì quý 4', 'Việc mẫu để thử', gs, ql, (now() at time zone 'Asia/Ho_Chi_Minh')::date + 7, 'binh_thuong', 'chua_lam');
  end if;
end $$;
