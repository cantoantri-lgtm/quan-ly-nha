import { friendlyError, supabase } from "./supabase";

/* Xin gia hạn: công việc, hạng mục dự án, dự án. Quyền và cập nhật hạn nằm ở SQL 078. */

export type DlTarget = "task" | "item" | "project";
export type DlStatus = "cho_duyet" | "da_duyet" | "tu_choi" | "da_huy";
export type DlReq = {
  id: string; target: DlTarget; item_id: string | null; item_name: string | null;
  requested_by: string; requester: string | null; old_due: string | null; new_due: string;
  report: string; cause?: string | null; plan: string; status: DlStatus; approved_due: string | null;
  decider: string | null; decided_at: string | null; decision_note: string | null; created_at: string;
  can_decide: boolean; can_cancel: boolean;
};
export const DL_STATUS: Record<DlStatus, string> = { cho_duyet: "Chờ duyệt", da_duyet: "Đã duyệt", tu_choi: "Không duyệt", da_huy: "Đã rút" };

export async function loadDeadlines(q: { task?: string; project?: string }): Promise<DlReq[]> {
  const { data } = await supabase.rpc("deadline_requests_of", { p_task: q.task ?? null, p_project: q.project ?? null });
  return (data ?? []) as DlReq[];
}

async function run(fn: string, args: Record<string, unknown>) {
  const { error } = await supabase.rpc(fn, args);
  if (error) throw new Error(friendlyError(error));
}
export const requestDeadline = (target: DlTarget, id: string, newDue: string, report: string, plan: string) =>
  run("deadline_request_create", { p_target: target, p_id: id, p_new_due: newDue, p_report: report, p_plan: plan });
export const decideDeadline = (id: string, approve: boolean, due: string | null, note: string) =>
  run("deadline_request_decide", { p_id: id, p_approve: approve, p_due: due, p_note: note || null });
export const cancelDeadline = (id: string) => run("deadline_request_cancel", { p_id: id });
