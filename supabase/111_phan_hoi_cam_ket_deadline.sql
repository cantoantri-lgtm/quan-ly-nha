-- 111: Giao việc gọn + phản hồi có deadline cam kết (27/11/2026)
-- Anh Trí chốt (góp ý trên bản 110):
--  * Giao việc chỉ cần: nội dung công việc, KPI, deadline. Bỏ chỉ tiêu số và đơn vị khỏi giao diện
--    (cột kpi_target, kpi_unit giữ lại trong CSDL cho dữ liệu cũ, không dùng nữa).
--  * Phản hồi gồm: tiến độ (%), vấn đề, nguyên nhân, hành động, deadline cam kết hoàn thành.
--  * Deadline cam kết trễ hơn hạn hiện tại → tự tạo đề xuất gia hạn, người giao duyệt theo deadline mới
--    → hạn công việc cập nhật, người làm tiếp tục báo cáo. Cam kết không trễ hơn hạn thì chỉ ghi nhận.
--  * task_updates.solution dùng làm "Hành động" (đổi nhãn ở giao diện); thêm task_updates.commit_due.

alter table public.task_updates add column if not exists commit_due date;

drop function if exists public.task_feedback(uuid, text, integer, numeric, text, text, text, public.task_status, date);
create or replace function public.task_feedback(
  p_task uuid, p_progress int, p_issue text, p_cause text, p_action text, p_commit_due date,
  p_status public.task_status default null, p_note text default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  me uuid := auth.uid(); t public.tasks; prog int := p_progress; rid uuid; uid uuid; pending boolean; nt text;
  iss text := nullif(btrim(p_issue), ''); cau text := nullif(btrim(p_cause), ''); act text := nullif(btrim(p_action), '');
  today date := (now() at time zone 'Asia/Ho_Chi_Minh')::date;
  done boolean := coalesce(p_status = 'xong', false);
begin
  if me is null or public.app_role() is null then raise exception 'Cần đăng nhập'; end if;
  select * into t from public.tasks where id = p_task for update;
  if not found or not public.can_see_task(p_task) then raise exception 'Không tìm thấy việc'; end if;
  if done then prog := 100; end if;
  if prog is null or prog < 0 or prog > 100 then raise exception 'Ghi tiến độ từ 0 đến 100%%'; end if;
  if not done then
    if iss is null or cau is null or act is null then
      raise exception 'Ghi đủ vấn đề, nguyên nhân và hành động (không có vấn đề thì ghi "Không")';
    end if;
    if p_commit_due is null then raise exception 'Chọn deadline cam kết hoàn thành'; end if;
    if p_commit_due < today then raise exception 'Deadline cam kết phải từ hôm nay trở đi'; end if;
  end if;
  if coalesce(char_length(iss), 0) > 2000 or coalesce(char_length(cau), 0) > 2000 or coalesce(char_length(act), 0) > 2000 then
    raise exception 'Mỗi ô tối đa 2000 ký tự';
  end if;

  nt := coalesce(nullif(btrim(p_note), ''),
    case when done then 'Báo hoàn thành' else 'Báo cáo tiến độ ' || prog || '%' end
    || case when not done then ' · cam kết xong ' || to_char(p_commit_due, 'DD/MM/YYYY') else '' end);

  -- Cam kết trễ hơn hạn hiện tại (hoặc việc chưa có hạn): xin người giao duyệt deadline mới
  if not done and (t.due_date is null or p_commit_due > t.due_date) then
    if t.created_by = me then
      begin   -- tự giao cho mình: đổi hạn luôn (nếu quyền sửa việc cho phép; không thì chỉ ghi cam kết)
        update public.tasks set due_date = p_commit_due where id = p_task;
      exception when others then null;
      end;
    else
      select exists (select 1 from public.deadline_requests d where d.target = 'task' and d.task_id = p_task and d.status = 'cho_duyet') into pending;
      if not pending then
        rid := public.deadline_request_create('task', p_task, p_commit_due, iss, act, cau);
      end if;
    end if;
  end if;

  insert into public.task_updates(task_id, author_id, note, status_after, progress, issue, cause, solution, commit_due, deadline_request_id)
  values (p_task, me, nt, p_status, prog, iss, cau, act, case when done then null else p_commit_due end, rid) returning id into uid;
  update public.tasks set progress = prog where id = p_task;
  return jsonb_build_object('update_id', uid, 'request_id', rid, 'pending', coalesce(pending, false));
end $$;
revoke execute on function public.task_feedback(uuid, integer, text, text, text, date, public.task_status, text) from public, anon;
grant execute on function public.task_feedback(uuid, integer, text, text, text, date, public.task_status, text) to authenticated;

-- Duyệt deadline mới: nhắc người làm tiếp tục báo cáo
do $$
declare d text;
begin
  d := pg_get_functiondef('public.deadline_request_decide(uuid, boolean, date, text)'::regprocedure);
  if position($x$    insert into public.task_updates(task_id, author_id, note) values (r.task_id, me, msg);$x$ in d) = 0 then
    raise exception 'deadline_request_decide đã khác';
  end if;
  d := replace(d, $x$    insert into public.task_updates(task_id, author_id, note) values (r.task_id, me, msg);$x$,
    $x$    insert into public.task_updates(task_id, author_id, note)
    values (r.task_id, me, msg || case when p_approve then '. Tiếp tục báo cáo tiến độ theo deadline mới' else '. Giữ deadline cũ, tiếp tục báo cáo tiến độ' end);$x$);
  execute d;
end $$;

-- Ghi chú: bản chạy đầu có "done boolean := p_status = 'xong'" (NULL khi không chọn trạng thái),
-- đã sửa bằng migration 111b_phan_hoi_sua_trang_thai_rong. File này là bản đúng sau khi sửa.
