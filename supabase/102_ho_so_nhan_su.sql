-- 102: Hồ sơ nhân sự: ngày sinh, CCCD; danh sách nhân sự để xuất Excel (26/11/2026)
--  * CCCD và ngày sinh là dữ liệu cá nhân (Nghị định 13/2023): bảng riêng staff_personal, gắn theo vị trí trong
--    Sơ đồ công ty (org_staff.id), vì nhiều người chưa có tài khoản app.
--  * Xem: Quản lý, người giữ nhiệm vụ Nhân sự (duty nhan_su), và chính người đó. Sửa: Quản lý, Nhân sự (qua staff_personal_save).
--  * Vị trí chuyển sang "Đang tuyển" hoặc đổi sang tài khoản người khác thì xoá ngày sinh, CCCD cũ của vị trí đó,
--    tránh gán nhầm cho người mới. Sửa chính tả tên thì giữ nguyên.
--  * hr_staff_list(): danh sách nhân sự đang làm (chính thức, tập sự, thử việc, thuê ngoài) cho Quản lý / Nhân sự.
--    Không có lương.

create table public.staff_personal (
  staff_id   uuid primary key references public.org_staff(id) on delete cascade,
  birth_date date check (birth_date is null or birth_date >= date '1940-01-01'),
  id_number  text check (id_number is null or id_number ~ '^([0-9]{9}|[0-9]{12})$'),
  updated_at timestamptz not null default now(),
  updated_by uuid references public.profiles(id) on delete set null
);
create unique index staff_personal_id_number on public.staff_personal(id_number) where id_number is not null;
alter table public.staff_personal enable row level security;

create or replace function public.is_hr() returns boolean
language sql stable security definer set search_path = public as $$
  select public.app_role() is not null and (public.is_manager() or public.is_duty('nhan_su'))
$$;
grant execute on function public.is_hr() to authenticated;

create policy staff_personal_select on public.staff_personal for select to authenticated
  using (public.is_hr() or exists (select 1 from public.org_staff s where s.id = staff_id and s.profile_id = (select auth.uid())));
revoke all on public.staff_personal from anon, authenticated;
grant select on public.staff_personal to authenticated;

create or replace function public.staff_personal_save(p_staff uuid, p_birth date, p_id_number text) returns void
language plpgsql security definer set search_path = public as $$
declare idn text := nullif(regexp_replace(coalesce(p_id_number, ''), '\D', '', 'g'), '');
begin
  if not public.is_hr() then raise exception 'Chỉ Quản lý hoặc Nhân sự cập nhật hồ sơ nhân sự'; end if;
  if not exists (select 1 from public.org_staff where id = p_staff) then raise exception 'Không tìm thấy nhân sự'; end if;
  if idn is not null and idn !~ '^([0-9]{9}|[0-9]{12})$' then raise exception 'Số CCCD gồm 12 chữ số (CMND cũ 9 chữ số)'; end if;
  if p_birth is not null and p_birth > ((now() at time zone 'Asia/Ho_Chi_Minh')::date - interval '15 years') then
    raise exception 'Ngày sinh chưa đúng: nhân sự phải từ đủ 15 tuổi';
  end if;
  if idn is not null and exists (select 1 from public.staff_personal where id_number = idn and staff_id <> p_staff) then
    raise exception 'Số CCCD này đã gán cho nhân sự khác';
  end if;
  insert into public.staff_personal (staff_id, birth_date, id_number, updated_at, updated_by)
  values (p_staff, p_birth, idn, now(), auth.uid())
  on conflict (staff_id) do update set birth_date = excluded.birth_date, id_number = excluded.id_number, updated_at = now(), updated_by = auth.uid();
end $$;
revoke execute on function public.staff_personal_save(uuid, date, text) from public, anon;
grant execute on function public.staff_personal_save(uuid, date, text) to authenticated;

-- Đổi người ở vị trí → xoá dữ liệu cá nhân của người cũ
create or replace function public.tg_org_staff_clear_personal() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if (new.status in ('tuyen') and old.status is distinct from new.status)
     or (old.profile_id is not null and new.profile_id is distinct from old.profile_id) then
    delete from public.staff_personal where staff_id = new.id;
  end if;
  return null;
end $$;
revoke execute on function public.tg_org_staff_clear_personal() from public, anon, authenticated;
drop trigger if exists org_staff_clear_personal on public.org_staff;
create trigger org_staff_clear_personal after update of status, profile_id on public.org_staff
  for each row execute function public.tg_org_staff_clear_personal();

create or replace function public.hr_staff_list()
returns table (staff_id uuid, full_name text, job_title text, department text, team text, level int, rank int,
  status text, duty text, is_leader boolean, trial_end date, phone text, has_account boolean, account_active boolean,
  birth_date date, id_number text, personal_updated_at timestamptz)
language plpgsql stable security definer set search_path = public as $$
begin
  if not public.is_hr() then raise exception 'Chỉ Quản lý hoặc Nhân sự xem danh sách nhân sự'; end if;
  return query
  select s.id, coalesce(p.full_name, s.person_name), s.position, d.name, s.team, s.level, s.rank,
         s.status::text, s.duty, s.is_leader, s.trial_end, p.phone, s.profile_id is not null, coalesce(p.is_active, false),
         sp.birth_date, sp.id_number, sp.updated_at
  from public.org_staff s
  left join public.profiles p on p.id = s.profile_id
  left join public.departments d on d.id = s.department_id
  left join public.staff_personal sp on sp.staff_id = s.id
  where s.status::text in ('co', 'tap_su', 'thu_viec', 'thue_ngoai')
  order by d.sort nulls last, s.level desc nulls last, s.sort;
end $$;
revoke execute on function public.hr_staff_list() from public, anon;
grant execute on function public.hr_staff_list() to authenticated;
