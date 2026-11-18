import { supabase } from "./supabase";
import { daysBetween, todayVN } from "./dates";

/** Dự án + Gantt (migration 069) */
export type Project = {
  id: string; code: string | null; name: string; description: string | null; status: string;
  start_date: string; end_date: string; budget: number; loa_id: string | null; pic_id: string;
  building_id: string | null; created_by: string; created_at: string; updated_at: string;
};
export type PItem = {
  id: string; project_id: string; parent_id: string | null; level: number; sort: number; name: string;
  start_date: string; end_date: string; pic_id: string | null; budget: number | null; progress: number;
  status: string; note: string | null; updated_at: string; updated_by: string | null;
};
/** Hạng mục đã dựng cây: số WBS, con, tiến độ tự tính cho hạng mục có cấp con */
export type Node = PItem & { wbs: string; children: Node[]; members: string[]; calc: number; planPct: number; late: boolean; hasKids: boolean };
export type PLog = { id: string; item_id: string | null; progress: number | null; status: string | null; note: string | null; by_id: string | null; at: string };
export type BudgetRow = { item_id: string | null; name: string; sort: number; budget: number | null; spent: number; pending: number; n_requests: number };
export type PReq = { id: string; kind: string; doc_no: string | null; reason: string | null; amount: number; status: string; item_id: string | null; requester_name: string | null; created_at: string; can_open: boolean };

export const PROJECT_STATUS: Record<string, string> = {
  ke_hoach: "Lập kế hoạch", dang_thuc_hien: "Đang thực hiện", tam_dung: "Tạm dừng", hoan_thanh: "Hoàn thành", huy: "Đã huỷ",
};
export const ITEM_STATUS: Record<string, string> = { chua_bat_dau: "Chưa bắt đầu", dang_lam: "Đang làm", hoan_thanh: "Hoàn thành", tam_dung: "Tạm dừng" };

const dur = (s: string, e: string) => daysBetween(s, e) + 1;
/** % kế hoạch đến hôm nay (tuyến tính theo ngày) */
export function plannedPct(s: string, e: string, today = todayVN()) {
  if (today < s) return 0;
  if (today >= e) return 100;
  return Math.round((daysBetween(s, today) + 1) / dur(s, e) * 100);
}
/** Chậm khi thực tế thấp hơn kế hoạch đến hôm nay từ 15% trở lên */
export const LATE_GAP = 15;

/** Dựng cây, đánh số WBS 1, 1.1, 1.1.1…; tiến độ hạng mục cha = trung bình theo số ngày của con */
export function buildTree(items: PItem[], members: { item_id: string; user_id: string }[], today = todayVN()): Node[] {
  const by = new Map<string | null, PItem[]>();
  items.forEach((i) => { const k = i.parent_id; by.set(k, [...(by.get(k) ?? []), i]); });
  const sortFn = (a: PItem, b: PItem) => a.sort - b.sort || a.start_date.localeCompare(b.start_date) || a.name.localeCompare(b.name);
  const mem = new Map<string, string[]>();
  members.forEach((m) => mem.set(m.item_id, [...(mem.get(m.item_id) ?? []), m.user_id]));
  const make = (parent: string | null, prefix: string): Node[] =>
    (by.get(parent) ?? []).sort(sortFn).map((it, i) => {
      const wbs = prefix ? `${prefix}.${i + 1}` : `${i + 1}`;
      const children = make(it.id, wbs);
      const hasKids = children.length > 0;
      let calc = it.progress;
      if (hasKids) {
        const tot = children.reduce((t, c) => t + dur(c.start_date, c.end_date), 0);
        calc = tot ? Math.round(children.reduce((t, c) => t + dur(c.start_date, c.end_date) * c.calc, 0) / tot) : 0;
      }
      const planPct = plannedPct(it.start_date, it.end_date, today);
      return { ...it, wbs, children, members: mem.get(it.id) ?? [], calc, planPct, hasKids, late: calc < 100 && planPct - calc >= LATE_GAP };
    });
  return make(null, "");
}
export function flatten(nodes: Node[], collapsed: Set<string>, out: Node[] = []): Node[] {
  nodes.forEach((n) => { out.push(n); if (!collapsed.has(n.id)) flatten(n.children, collapsed, out); });
  return out;
}
export const allNodes = (nodes: Node[]) => flatten(nodes, new Set());
/** Tiến độ dự án = trung bình theo số ngày của hạng mục chính */
export function projectProgress(roots: Node[], today = todayVN()) {
  const tot = roots.reduce((t, c) => t + dur(c.start_date, c.end_date), 0);
  if (!tot) return { act: 0, plan: 0 };
  return {
    act: Math.round(roots.reduce((t, c) => t + dur(c.start_date, c.end_date) * c.calc, 0) / tot),
    plan: Math.round(roots.reduce((t, c) => t + dur(c.start_date, c.end_date) * plannedPct(c.start_date, c.end_date, today), 0) / tot),
  };
}

export async function loadProject(id: string) {
  const [p, it, m] = await Promise.all([
    supabase.from("projects").select("*").eq("id", id).maybeSingle(),
    supabase.from("project_items").select("*").eq("project_id", id),
    supabase.from("project_members").select("user_id").eq("project_id", id),
  ]);
  const items = (it.data ?? []).map((x) => ({ ...x, budget: x.budget == null ? null : Number(x.budget) })) as PItem[];
  const ids = new Set(items.map((x) => x.id));
  const mem = ids.size ? await supabase.from("project_item_members").select("item_id,user_id").in("item_id", [...ids]) : { data: [] };
  return {
    project: p.data ? ({ ...p.data, budget: Number(p.data.budget) } as Project) : null,
    items,
    supporters: ((m.data ?? []) as { user_id: string }[]).map((x) => x.user_id),
    itemMembers: ((mem.data ?? []) as { item_id: string; user_id: string }[]).filter((x) => ids.has(x.item_id)),
  };
}

/** Đặt lại danh sách người hỗ trợ (xoá rồi thêm). Trả về lỗi nếu có. */
export async function setMembers(table: "project_members" | "project_item_members", key: "project_id" | "item_id", id: string, users: string[]): Promise<string | null> {
  const d = await supabase.from(table).delete().eq(key, id);
  if (d.error) return d.error.message;
  if (users.length) {
    const r = await supabase.from(table).insert(users.map((u) => ({ [key]: id, user_id: u })));
    if (r.error) return r.error.message;
  }
  return null;
}
