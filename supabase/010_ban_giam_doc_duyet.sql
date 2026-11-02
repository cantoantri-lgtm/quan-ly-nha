-- Tạm thời Mr Trí chưa phụ trách công việc: Mrs Dương (Giám đốc) ký duyệt thay Ban Giám đốc.
--  - Các phòng Kinh doanh, Marketing, HC–KT tạm do Mrs Dương làm Trưởng phòng.
--  - Bước Trưởng phòng / Kế toán chưa có người giữ chuyển cho Giám đốc thay vì "bất kỳ Quản lý".
-- Khi Mr Trí nhận việc lại: đổi Trưởng phòng ở trang Sơ đồ công ty, không cần sửa SQL.

update public.departments
   set head_staff_id = (select id from public.org_staff where duty = 'giam_doc')
 where code in ('KD','MKT','HCKT');

update public.org_staff set hire_note = 'Tạm thời chưa phụ trách công việc'
 where person_name = 'Mr Trí';

create or replace function public.approval_chain(p_requester uuid, p_kind public.request_kind)
returns table(step_no int, duty text, approver_id uuid, skip_reason text)
language plpgsql stable security definer set search_path = public as $$
declare
  me     public.org_staff;
  head_p uuid; lead_p uuid; gd uuid; ns uuid; kt uuid;
  duties text[]; d text; n int := 0; a uuid; why text; seen uuid[] := array[]::uuid[];
begin
  select * into me from public.org_staff o where o.profile_id = p_requester;
  select s.profile_id into head_p from public.departments dp join public.org_staff s on s.id = dp.head_staff_id
   where dp.id = me.department_id;
  select s.profile_id into lead_p from public.org_staff s
   where s.is_leader and s.profile_id is not null and s.profile_id <> p_requester
     and s.department_id = me.department_id and s.team is not distinct from me.team limit 1;
  select o.profile_id into gd from public.org_staff o where o.duty = 'giam_doc';
  select o.profile_id into ns from public.org_staff o where o.duty = 'nhan_su';
  select o.profile_id into kt from public.org_staff o where o.duty = 'ke_toan';

  duties := case when p_kind in ('thanh_toan','tam_ung')
                 then array['leader','truong_phong','ke_toan','giam_doc']
                 else array['leader','truong_phong','nhan_su'] end;
  foreach d in array duties loop
    n := n + 1; why := null; a := null;
    if d = 'leader' then
      a := lead_p; if a is null then why := 'Chưa có Leader'; end if;
    elsif d = 'truong_phong' then
      a := head_p;
      if a is null or a = p_requester then a := gd; end if;   -- chưa có Trưởng phòng / chính là Trưởng phòng: Giám đốc
    elsif d = 'nhan_su' then
      a := ns; if a is null then why := 'Chưa có tài khoản Nhân sự'; end if;
    elsif d = 'ke_toan' then
      a := coalesce(kt, gd);                                  -- chưa có tài khoản Kế toán: Giám đốc kiêm
    else
      a := gd;
    end if;
    if why is null and a is not null then
      if a = p_requester then why := 'Chính người đề nghị';
      elsif a = any(seen) then why := 'Đã duyệt ở bước trước';
      end if;
    end if;
    if why is null and a is not null then seen := seen || a; end if;
    step_no := n; duty := d; approver_id := a; skip_reason := why;
    return next;
  end loop;
end $$;
revoke execute on function public.approval_chain(uuid, public.request_kind) from public, anon, authenticated;
