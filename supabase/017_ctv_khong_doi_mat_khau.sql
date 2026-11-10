-- Cộng tác viên dùng chung một tài khoản do quản lý cấp: không được tự đổi mật khẩu.
-- Chặn ở cơ sở dữ liệu (giao diện chỉ ẩn form). Quản lý đặt lại mật khẩu qua Edge Function
-- quan-ly-tai-khoan: hàm mở khoá 60 giây (pw_unlock_until) rồi mới đổi mật khẩu.

alter table public.profiles add column if not exists pw_unlock_until timestamptz;

create or replace function public.tg_ctv_pw_guard() returns trigger
language plpgsql security definer set search_path = public, auth as $$
begin
  -- Chỉ chặn khi mật khẩu thật sự đổi. Cùng loại băm (vd $2a$10$) = đổi mật khẩu;
  -- khác loại băm = hệ thống đăng nhập tự nâng cấp băm, cho qua.
  if new.encrypted_password is distinct from old.encrypted_password
     and left(coalesce(new.encrypted_password, ''), 7) = left(coalesce(old.encrypted_password, ''), 7)
     and exists (
       select 1 from public.profiles p
       where p.id = new.id and p.role = 'cong_tac_vien'
         and coalesce(p.pw_unlock_until, 'epoch'::timestamptz) < now()
     )
  then
    raise exception 'Tài khoản Cộng tác viên không tự đổi mật khẩu. Liên hệ quản lý.' using errcode = 'P0001';
  end if;
  return new;
end $$;

drop trigger if exists ctv_pw_guard on auth.users;
create trigger ctv_pw_guard before update of encrypted_password on auth.users
  for each row execute function public.tg_ctv_pw_guard();

-- Không ai (kể cả quản lý) mở khoá từ trình duyệt: chỉ Edge Function (service role, auth.uid() rỗng) ghi cột này.
create or replace function public.tg_profiles_guard() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is not null and not public.is_manager()
     and (new.role is distinct from old.role or new.is_active is distinct from old.is_active
          or new.phone is distinct from old.phone or new.annual_leave_days is distinct from old.annual_leave_days) then
    raise exception 'Chỉ quản lý được đổi vai trò, số điện thoại, ngày phép hoặc khoá tài khoản';
  end if;
  if auth.uid() is not null and new.pw_unlock_until is distinct from old.pw_unlock_until then
    raise exception 'Không được tự mở khoá đổi mật khẩu';
  end if;
  return new;
end $$;
