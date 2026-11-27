import { friendlyError, supabase } from "./supabase";
import { daysBetween, todayVN } from "./dates";
import type { Task, TaskStatus } from "./labels";

/* Giao việc theo KPI, phản hồi tiến độ, người làm hạng mục. Quyền và kiểm tra nằm ở SQL 110. */

async function run<T = unknown>(fn: string, args: Record<string, unknown>): Promise<T> {
  const { data, error } = await supabase.rpc(fn, args);
  if (error) throw new Error(friendlyError(error));
  return data as T;
}

export type Feedback = {
  note: string; progress: number | null; actual: number | null;
  issue: string; cause: string; solution: string;
  status: TaskStatus | null; newDue: string | null;
};
/** Gửi phản hồi: tiến độ so với KPI, kết quả, vấn đề – nguyên nhân – giải pháp, xin gia hạn (nếu có) */
export const sendFeedback = (task: string, f: Feedback) =>
  run<{ update_id: string; request_id: string | null }>("task_feedback", {
    p_task: task, p_note: f.note, p_progress: f.progress, p_actual: f.actual,
    p_issue: f.issue || null, p_cause: f.cause || null, p_solution: f.solution || null,
    p_status: f.status, p_new_due: f.newDue,
  });

/** Người chính + người phụ của hạng mục (phải nằm trong nhóm việc chính) */
export const setStepPeople = (step: string, main: string, others: string[]) =>
  run("task_step_set_people", { p_step: step, p_main: main, p_others: others });

/** Số gọn: 12, 12,5 */
export const num = (n: number) => n.toLocaleString("vi-VN", { maximumFractionDigits: 2 });

/** "Kiểm tra 30 phòng · chỉ tiêu 30 phòng" */
export function kpiLine(t: Pick<Task, "kpi" | "kpi_target" | "kpi_unit">): string {
  const target = t.kpi_target != null ? `chỉ tiêu ${num(t.kpi_target)}${t.kpi_unit ? ` ${t.kpi_unit}` : ""}` : "";
  return [t.kpi?.trim(), target].filter(Boolean).join(" · ");
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
