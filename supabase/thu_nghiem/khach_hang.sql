-- Khách hàng thử: SĐT 0900000004, mật khẩu ThuNghiem2026, CCCD giả 079000000004. Chạy lại nhiều lần cũng được.
-- Xoá: delete from auth.users where email = '0900000004@neonestly.app';  (hồ sơ và phản ánh xoá theo)
do $$
declare uid uuid; ql uuid; pw text := 'ThuNghiem2026'; ph text := '0900000004';
begin
  select id into uid from auth.users where email = ph || '@neonestly.app';
  if uid is null then
    uid := gen_random_uuid();
    insert into auth.users (instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
      raw_app_meta_data, raw_user_meta_data, created_at, updated_at,
      confirmation_token, recovery_token, email_change_token_new, email_change)
    values ('00000000-0000-0000-0000-000000000000', uid, 'authenticated', 'authenticated',
      ph || '@neonestly.app', extensions.crypt(pw, extensions.gen_salt('bf')), now(),
      jsonb_build_object('provider','email','providers',jsonb_build_array('email'),'role','khach_hang','provisioned',true),
      jsonb_build_object('full_name','Khách hàng (thử)','phone',ph), now(), now(), '', '', '', '');
    insert into auth.identities (id, user_id, provider_id, provider, identity_data, last_sign_in_at, created_at, updated_at)
    values (gen_random_uuid(), uid, uid::text, 'email',
      jsonb_build_object('sub',uid::text,'email',ph || '@neonestly.app','email_verified',true), now(), now(), now());
  end if;
  insert into public.profiles (id, full_name, phone, role, is_active)
  values (uid, 'Khách hàng (thử)', ph, 'khach_hang', true)
  on conflict (id) do update set role = 'khach_hang', is_active = true, full_name = excluded.full_name;
  select id into ql from auth.users where email = '0900000001@neonestly.app';
  insert into public.customer_profiles (id, cccd, created_by) values (uid, '079000000004', ql)
  on conflict (id) do nothing;
end $$;
