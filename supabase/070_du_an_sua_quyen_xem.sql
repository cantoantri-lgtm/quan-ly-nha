-- 070: Dự án vừa tạo phải đọc lại được ngay (RETURNING). Hàm project_can_see đọc bảng projects
-- theo ảnh chụp đầu câu lệnh nên chưa thấy dòng mới: thêm điều kiện theo chính dòng đó.
drop policy if exists pj_select on public.projects;
create policy pj_select on public.projects for select to authenticated
  using (public.is_manager() or created_by = (select auth.uid()) or pic_id = (select auth.uid()) or public.project_can_see(id));
