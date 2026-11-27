import { friendlyError, supabase } from "./supabase";
import { daysBetween, todayVN } from "./dates";
import type { Task, TaskStatus } from "./labels";

/* Giao việc theo KPI, phản hồi tiến độ, người làm hạng mục. Quyền và kiểm tra nằm ở SQL 110, 111. */

async function run<T = unknown>(fn: string, args: Record<string, unknown>): Promise<T> {
  const { data, error } = await supabase.rpc(fn, args);
  if (error) throw new Error(friendlyError(error));
  return data as T;
}

/** Phản hồi (SQL 111): tiến độ, vấn đề, nguyên nhân, hành động, deadline cam kết. Báo xong thì chỉ cần tiến độ. */
export type Feedback = {
  progress: number; issue: string; cause: string; action: string; commitDue: string | null; status: TaskStatus | null;
};
/** Gửi phản hồi. Deadline cam kết trễ hơn hạn hiện tại thì CSDL tự tạo đề xuất gia hạn cho người giao duyệt. */
export const sendFeedback = (task: string, f: Feedback) =>
  run<{ update_id: string; request_id: string | null; pending: boolean }>("task_feedback", {
    p_task: task, p_progress: f.progress, p_issue: f.issue || null, p_cause: f.cause || null, p_action: f.action || null,
    p_commit_due: f.commitDue, p_status: f.status,
  });

/** Người chính + người phụ của hạng mục (phải nằm trong nhóm việc chính) */
export const setStepPeople = (step: string, main: string, others: string[]) =>
  run("task_step_set_people", { p_step: step, p_main: main, p_others: others });

/** Số gọn: 12, 12,5 */
export const num = (n: number) => n.toLocaleString("vi-VN", { maximumFractionDigits: 2 });

/** KPI của việc (chỉ tiêu số, đơn vị đã bỏ theo SQL 111) */
export function kpiLine(t: Pick<Task, "kpi">): string {
  return t.kpi?.trim() ?? "";
}

/** Tiến độ theo thời gian: đến hôm nay lẽ ra phải đạt bao nhiêu % (tính từ ngày giao đến hạn) */
export function expectedProgress(t: Pick<Task, "created_at" | "due_date" | "status">): number | null {
  if (!t.due_date || t.status === "xong") return null;
  const start = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Ho_Chi_Minh" }).format(new Date(t.created_at));
  const total = daysBetween(start, t.due_date);
  if (total <= 0) return 100;
  const gone = daysBetween(start, todayVN());
  return Math.max(0, Math.min(100, Math.round((gone / total) * 100)));
}

/** Đánh giá tiến độ so với KPI và thời gian */
export function paceInfo(t: Pick<Task, "created_at" | "due_date" | "status" | "progress">):
  { tone: "ok" | "slow" | "late" | "done"; text: string } | null {
  const p = t.progress ?? 0;
  if (t.status === "xong") return { tone: "done", text: "Đã xong" };
  const exp = expectedProgress(t);
  if (exp == null) return null;
  if (t.due_date && t.due_date < todayVN()) return { tone: "late", text: `Quá hạn, mới đạt ${p}%` };
  if (p + 10 < exp) return { tone: "slow", text: `Chậm: theo thời gian cần ${exp}%` };
  return { tone: "ok", text: `Đúng tiến độ (cần ${exp}%)` };
}
