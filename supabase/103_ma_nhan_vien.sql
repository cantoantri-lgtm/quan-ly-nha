-- 103: Mã nhân viên (26/11/2026)
--  * Mã dạng NV01, NV02… như Kế hoạch tái cấu trúc 2026–2027 (PL4). Lưu cùng hồ sơ nhân sự (staff_personal),
--    Quản lý và Nhân sự sửa. Không trùng. Đổi người ở vị trí thì mã cũ cũng xoá như ngày sinh, CCCD.
--  * staff_personal_save thêm tham số p_code. hr_staff_list trả thêm staff_code và profile_id
--    (để trang Nhân sự gắn mã vào tài khoản app).
--  * Gắn sẵn mã đã có trong kế hoạch cho người khớp tên duy nhất: NV01 Trinh, NV02 Hiệp, NV05 Thi.

alter table public.staff_personal add column staff_code text
  check (staff_code is null or staff_code ~ '^NV[0-9]{2,4}$');
create unique index staff_personal_code on public.staff_personal(staff_code) where staff_code is not null;

drop function if exists public.staff_personal_save(uuid, date, text);
create or replace function public.staff_personal_save(p_staff uuid, p_code text, p_birth date, p_id_number text) returns void
language plpgsql security definer set search_path = public as $$
declare
  idn text := nullif(regexp_replace(coalesce(p_id_number, ''), '\D', '', 'g'), '');
  code text := nullif(upper(regexp_replace(coalesce(p_code, ''), '\s', '', 'g')), '');
begin
  if not public.is_hr() then raise exception 'Chỉ Quản lý hoặc Nhân sự cập nhật hồ sơ nhân sự'; end if;
  if not exists (select 1 from public.org_staff where id = p_staff) then raise exception 'Không tìm thấy nhân sự'; end if;
  if code is not null and code !~ '^NV[0-9]{2,4}$' then raise exception 'Mã nhân viên dạng NV kèm số, ví dụ NV10'; end if;
  if code is not null and exists (select 1 from public.staff_personal where staff_code = code and staff_id <> p_staff) then
    raise exception 'Mã % đã gán cho nhân sự khác', code;
  end if;
  if idn is not null and idn !~ '^([0-9]{9}|[0-9]{12})$' then raise exception 'Số CCCD gồm 12 chữ số (CMND cũ 9 chữ số)'; end if;
  if p_birth is not null and p_birth > ((now() at time zone 'Asia/Ho_Chi_Minh')::date - interval '15 years') then
    raise exception 'Ngày sinh chưa đúng: nhân sự phải từ đủ 15 tuổi';
  end if;
  if idn is not null and exists (select 1 from public.staff_personal where id_number = idn and staff_id <> p_staff) then
    raise exception 'Số CCCD này đã gán cho nhân sự khác';
  end if;
  insert into public.staff_personal (staff_id, staff_code, birth_date, id_number, updated_at, updated_by)
  values (p_staff, code, p_birth, idn, now(), auth.uid())
  on conflict (staff_id) do update set staff_code = excluded.staff_code, birth_date = excluded.birth_date,
    id_number = excluded.id_number, updated_at = now(), updated_by = auth.uid();
end $$;
revoke execute on function public.staff_personal_save(uuid, text, date, text) from public, anon;
grant execute on function public.staff_personal_save(uuid, text, date, text) to authenticated;

drop function if exists public.hr_staff_list();
create or replace function public.hr_staff_list()
returns table (staff_id uuid, staff_code text, profile_id uuid, full_name text, job_title text, department text, team text,
  level int, rank int, status text, duty text, is_leader boolean, trial_end date, phone text, has_account boolean,
  account_active boolean, birth_date date, id_number text, personal_updated_at timestamptz)
language plpgsql stable security definer set search_path = public as $$
begin
  if not public.is_hr() then raise exception 'Chỉ Quản lý hoặc Nhân sự xem danh sách nhân sự'; end if;
  return query
  select s.id, sp.staff_code, s.profile_id, coalesce(p.full_name, s.person_name), s.position, d.name, s.team, s.level, s.rank,
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

-- Mã đã có trong Kế hoạch tái cấu trúc (khớp tên duy nhất)
insert into public.staff_personal (staff_id, staff_code)
select s.id, m.code
from (values ('NV01', 'Trinh'), ('NV02', 'Hiệp'), ('NV05', 'Thi')) m(code, short)
join public.org_staff s on s.status in ('co', 'tap_su', 'thu_viec')
left join public.profiles p on p.id = s.profile_id
where (select count(*) from public.org_staff s2 left join public.profiles p2 on p2.id = s2.profile_id
        where s2.status in ('co', 'tap_su', 'thu_viec')
          and regexp_replace(coalesce(p2.full_name, s2.person_name, ''), '^.* ', '') = m.short) = 1
  and regexp_replace(coalesce(p.full_name, s.person_name, ''), '^.* ', '') = m.short
on conflict (staff_id) do update set staff_code = coalesce(public.staff_personal.staff_code, excluded.staff_code);
