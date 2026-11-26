-- 106: Lịch sử trợ lý Báo cáo AI theo bảng phân quyền (chức năng bao_cao_ai), thay cho chỉ vai trò Quản lý (26/11/2026)
drop policy if exists aic_own on public.ai_chats;
create policy aic_own on public.ai_chats for all to authenticated
  using (user_id = (select auth.uid()) and public.perm_level('bao_cao_ai') >= 1)
  with check (user_id = (select auth.uid()) and public.perm_level('bao_cao_ai') >= 1);
drop policy if exists aim_own on public.ai_messages;
create policy aim_own on public.ai_messages for all to authenticated
  using (exists (select 1 from public.ai_chats c where c.id = ai_messages.chat_id and c.user_id = (select auth.uid()))
         and public.perm_level('bao_cao_ai') >= 1)
  with check (exists (select 1 from public.ai_chats c where c.id = ai_messages.chat_id and c.user_id = (select auth.uid()))
         and public.perm_level('bao_cao_ai') >= 1);
drop policy if exists air_mgr on public.ai_reports;
create policy air_mgr on public.ai_reports for all to authenticated
  using (public.perm_level('bao_cao_ai') >= 1) with check (public.perm_level('bao_cao_ai') >= 1);
