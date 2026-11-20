import { parseMoney } from "./money";
import { friendlyError, supabase } from "./supabase";

/* Đề nghị mua hàng (kind = mua_hang): danh sách hàng ở purchase_lines, SQL 080 */

export type PLine = {
  id: string; request_id: string; line_no: number; item_name: string; spec: string | null; unit: string | null;
  quantity: number; unit_price: number; amount: number; note: string | null;
};
export type PLineDraft = { item_name: string; spec: string; unit: string; quantity: string; unit_price: string; note: string };
export type PurchasePick = {
  id: string; doc_no: string | null; reason: string; amount: number; requester_name: string | null; doc_date: string | null;
  building_id: string | null; project_id: string | null; project_item_id: string | null; payee: string | null; paid: number; pending: number; loa_id: string | null;
};

export const emptyPLine = (): PLineDraft => ({ item_name: "", spec: "", unit: "", quantity: "1", unit_price: "", note: "" });
const qty = (s: string) => { const n = Number(String(s).replace(/\s/g, "").replace(",", ".")); return Number.isFinite(n) ? n : 0; };
export const pQty = qty;
export const pAmount = (l: PLineDraft) => Math.round(qty(l.quantity) * (parseMoney(l.unit_price) ?? 0));
export const pFilled = (l: PLineDraft) => !!(l.item_name.trim() || l.unit_price.trim() || l.spec.trim());
export const pTotal = (list: PLineDraft[]) => list.filter(pFilled).reduce((s, l) => s + pAmount(l), 0);
const fmt = (n: number) => new Intl.NumberFormat("vi-VN").format(n);
export const pFromRow = (r: PLine): PLineDraft => ({
  item_name: r.item_name, spec: r.spec ?? "", unit: r.unit ?? "", quantity: String(r.quantity).replace(".", ","),
  unit_price: fmt(Number(r.unit_price)), note: r.note ?? "",
});

/** Kiểm tra trước khi gửi: trả về câu báo lỗi hoặc null */
export function checkPLines(list: PLineDraft[]): string | null {
  const rows = list.filter(pFilled);
  if (!rows.length) return "Nhập ít nhất một mặt hàng cần mua.";
  for (let i = 0; i < rows.length; i++) {
    const n = list.indexOf(rows[i]) + 1;
    if (!rows[i].item_name.trim()) return `Dòng ${n}: nhập tên hàng.`;
    if (!(qty(rows[i].quantity) > 0)) return `Dòng ${n}: số lượng phải lớn hơn 0.`;
    if (parseMoney(rows[i].unit_price) == null) return `Dòng ${n}: nhập đơn giá dự kiến.`;
  }
  return null;
}

export async function loadPLines(requestId: string): Promise<PLine[]> {
  const { data } = await supabase.from("purchase_lines").select("*").eq("request_id", requestId).order("line_no");
  return (data ?? []) as PLine[];
}

/** Ghi lại toàn bộ danh sách hàng (xoá rồi thêm). Trả về lỗi hoặc null */
export async function savePLines(requestId: string, list: PLineDraft[], replace: boolean): Promise<string | null> {
  if (replace) {
    const d = await supabase.from("purchase_lines").delete().eq("request_id", requestId);
    if (d.error) return friendlyError(d.error);
  }
  const rows = list.filter(pFilled).map((l, i) => ({
    request_id: requestId, line_no: i + 1, item_name: l.item_name.trim(), spec: l.spec.trim() || null, unit: l.unit.trim() || null,
    quantity: qty(l.quantity), unit_price: parseMoney(l.unit_price) ?? 0, note: l.note.trim() || null,
  }));
  if (!rows.length) return null;
  const r = await supabase.from("purchase_lines").insert(rows);
  return r.error ? friendlyError(r.error) : null;
}
