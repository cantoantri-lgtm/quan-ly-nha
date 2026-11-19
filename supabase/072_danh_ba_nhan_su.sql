-- 072: Danh bạ nội bộ: phòng ban, bộ phận, vị trí của từng tài khoản để hiện khi giao việc.
-- Sơ đồ đầy đủ (ghi chú tuyển dụng, thử việc, nhiệm vụ duyệt) vẫn chỉ cấp Trưởng phòng trở lên xem (can_see_org).
create or replace function public.staff_directory()
returns table (profile_id uuid, department text, team text, job_title text, dept_sort int)
language sql stable security definer set search_path = public as $$
  select s.profile_id, d.name, nullif(trim(s.team), ''), s.position, coalesce(d.sort, 999)
    from public.org_staff s
    left join public.departments d on d.id = s.department_id
   where s.profile_id is not null
     and public.app_role() in ('quan_ly','giam_sat','nhan_vien')
$$;
revoke execute on function public.staff_directory() from public, anon;
grant execute on function public.staff_directory() to authenticated;
