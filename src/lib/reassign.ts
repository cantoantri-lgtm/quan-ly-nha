import { friendlyError, supabase } from "./supabase";
import { ROLE_RANK, type Profile } from "./labels";
import type { DirEntry } from "./directory";

/* Đổi người phụ trách chính (việc) và PIC (dự án). Quyền nằm ở SQL 082. */

async function run(fn: string, args: Record<string, unknown>) {
  const { error } = await supabase.rpc(fn, args);
  if (error) throw new Error(friendlyError(error));
}
export const changeTaskMain = (task: string, user: string, keepOld: boolean, note: string) =>
  run("task_change_main", { p_task: task, p_user: user, p_keep_old: keepOld, p_note: note || null });
export const changeProjectPic = (project: string, user: string, keepOld: boolean, note: string) =>
  run("project_change_pic", { p_project: project, p_user: user, p_keep_old: keepOld, p_note: note || null });

/** Người được giao việc: cấp dưới hoặc chính mình. Có toà thì chỉ người của toà đó; Giám sát chỉ thấy nhân viên các toà mình. */
export function assignableFor(o: {
  me: Profile; people: Profile[]; members: { building_id: string; user_id: string }[];
  buildingId: string; isManager: boolean; dir: Map<string, DirEntry>;
}): Profile[] {
  const { me, people, members, buildingId, isManager, dir } = o;
  const myRank = ROLE_RANK[me.role];
  return people.filter((p) => {
    if (!p.is_active) return false;
    if (p.id === me.id) return true;
    if (ROLE_RANK[p.role] >= myRank) return false;
    if (buildingId && members.length) return members.some((m) => m.building_id === buildingId && m.user_id === p.id);
    if (!isManager) return members.some((m) => m.user_id === p.id);
    return true;
  }).sort((a, b) => {
    if (a.id === me.id) return -1;
    if (b.id === me.id) return 1;
    // Xếp theo phòng ban rồi tên; người chưa có vị trí xuống cuối
    const da = dir.get(a.id), db = dir.get(b.id);
    const sa = da ? da.dept_sort : 9999, sb = db ? db.dept_sort : 9999;
    if (sa !== sb) return sa - sb;
    const ka = `${da?.department ?? ""}|${da?.team ?? ""}`, kb = `${db?.department ?? ""}|${db?.team ?? ""}`;
    if (ka !== kb) return ka.localeCompare(kb, "vi");
    return a.full_name.localeCompare(b.full_name, "vi");
  });
}
