-- 112: Tiến độ công việc ghi bằng chữ (27/11/2026)
-- Anh Trí chốt: tiến độ là ô chữ để nhân sự dễ cập nhật (VD "Đã kiểm tra 25/30 phòng, còn tầng 3"), không nhập %.
--  * task_feedback: p_note là tiến độ (bắt buộc khi chưa xong), p_progress (%) không bắt buộc, giữ cho dữ liệu cũ.
--  * tasks.progress_note / progress_at: tiến độ mới nhất để hiện ở danh sách và chi tiết việc.
--  * Báo xong: tiến độ ghi "Đã hoàn thành" nếu để trống, progress = 100.

alter table public.tasks
  add column if not exists progress_note text check (char_length(progress_note) <= 2000),
  add column if not exists progress_at timestamptz;

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
  nt := nullif(btrim(coalesce(p_note, '')), '');
  if done then prog := 100; nt := coalesce(nt, 'Đã hoàn thành'); end if;
  if nt is null then raise exception 'Ghi tiến độ công việc'; end if;
  if char_length(nt) > 2000 then raise exception 'Tiến độ tối đa 2000 ký tự'; end if;
  if prog is not null and (prog < 0 or prog > 100) then raise exception 'Phần trăm tiến độ từ 0 đến 100'; end if;
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

  -- Cam kết trễ hơn hạn hiện tại (hoặc việc chưa có hạn): xin người giao duyệt deadline mới
  if not done and (t.due_date is null or p_commit_due > t.due_date) then
    if t.created_by = me then
      begin
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
  update public.tasks set progress = coalesce(prog, progress), progress_note = nt, progress_at = now() where id = p_task;
  return jsonb_build_object('update_id', uid, 'request_id', rid, 'pending', coalesce(pending, false));
end $$;
