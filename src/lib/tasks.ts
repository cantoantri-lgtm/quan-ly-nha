import { friendlyError, supabase } from "./supabase";
import { daysBetween, todayVN } from "./dates";
import type { Task, TaskStatus } from "./labels";

/* Giao việc theo KPI, phản hồi tiến độ, người làm hạng mục. Quyền và kiểm tra nằm ở SQL 110, 111. */

async function run<T = unknown>(fn: string, args: Record<string, unknown>): Promise<T> {
  const { data, error } = await supabase.rpc(fn, args);
  if (error) throw new Error(friendlyError(error));
  return data as T;
}

/** Phản hồi (SQL 111, 112): tiến độ (chữ), vấn đề, nguyên nhân, hành động, deadline cam kết. Báo xong thì không cần ghi gì thêm. */
export type Feedback = {
  progress: string; issue: string; cause: string; action: string; commitDue: string | null; status: TaskStatus | null;
};
/** Gửi phản hồi. Deadline cam kết trễ hơn hạn hiện tại thì CSDL tự tạo đề xuất gia hạn cho người giao duyệt. */
export const sendFeedback = (task: string, f: Feedback) =>
  run<{ update_id: string; request_id: string | null; pending: boolean }>("task_feedback", {
    p_task: task, p_progress: null, p_note: f.progress || null, p_issue: f.issue || null, p_cause: f.cause || null, p_action: f.action || null,
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

/** Tình trạng theo deadline (tiến độ ghi bằng chữ từ SQL 112, không so %) */
export function paceInfo(t: Pick<Task, "created_at" | "due_date" | "status" | "progress">):
  { tone: "ok" | "slow" | "late" | "done"; text: string } | null {
  if (t.status === "xong") return { tone: "done", text: "Đã xong" };
  if (!t.due_date) return null;
  const today = todayVN();
  if (t.due_date < today) return { tone: "late", text: `Quá deadline ${daysBetween(t.due_date, today)} ngày` };
  const left = daysBetween(today, t.due_date);
  return left <= 2 ? { tone: "slow", text: left === 0 ? "Deadline hôm nay" : `Còn ${left} ngày` } : { tone: "ok", text: `Còn ${left} ngày` };
}
