import { supabase } from "./supabase";
import { parseMoney } from "./money";

/** Đi công tác đầy đủ (migration 067): kế hoạch / thực tế lộ trình và chi phí */
export type Phase = "ke_hoach" | "thuc_te";
export const TRIP_TYPE: Record<string, string> = {
  trong_nuoc: "Trong nước · không đi máy bay",
  trong_nuoc_may_bay: "Trong nước · có đi máy bay",
  nuoc_ngoai: "Nước ngoài",
};
export const VISA_TYPE: Record<string, string> = { khong_yeu_cau: "Không yêu cầu", du_lich: "Visa du lịch", cong_tac: "Visa công tác", khac: "Khác" };
/** Gợi ý hạng mục chi phí (công ty chưa có định mức: nhân viên tự nhập đơn giá) */
export const COST_CATEGORIES = [
  "Vé máy bay", "Vé xe khách", "Khách sạn", "Phụ cấp hàng ngày", "Phụ cấp bán hàng", "Tiền ăn", "Tiền tiêu vặt",
  "Taxi / xe ôm từ bến đến nơi công tác", "Phụ cấp di chuyển", "Xăng xe", "Chi phí khác",
];

export type TripLeg = {
  id?: string; request_id?: string; phase: Phase; line_no: number; staff_id: string | null;
  start_date: string | null; end_date: string | null; from_place: string | null; to_place: string | null;
  content: string | null; transport: string | null; distance: string | null; stay_reason: string | null; note: string | null;
};
export type TripCost = {
  id?: string; request_id?: string; phase: Phase; line_no: number; category: string; location: string | null;
  days: number; persons: number; unit_price: number; amount?: number; note: string | null;
};

/** Bản nháp trong form: chuỗi cho tới khi lưu */
export type LegDraft = { staff_id: string; start_date: string; end_date: string; from_place: string; to_place: string; content: string; transport: string; distance: string; stay_reason: string; note: string };
export type CostDraft = { category: string; location: string; days: string; persons: string; unit_price: string; note: string };
export const emptyLeg = (staff = ""): LegDraft => ({ staff_id: staff, start_date: "", end_date: "", from_place: "", to_place: "", content: "", transport: "", distance: "", stay_reason: "", note: "" });
export const emptyCost = (): CostDraft => ({ category: "", location: "", days: "1", persons: "1", unit_price: "", note: "" });

const num = (s: string) => { const n = Number(String(s).replace(",", ".")); return Number.isFinite(n) ? n : 0; };
export const costAmount = (c: CostDraft) => Math.round(num(c.days) * num(c.persons) * (parseMoney(c.unit_price) ?? 0));
export const costTotal = (list: CostDraft[]) => list.reduce((s, c) => s + costAmount(c), 0);
export const legFilled = (l: LegDraft) => !!(l.start_date || l.from_place.trim() || l.to_place.trim() || l.content.trim());
export const costFilled = (c: CostDraft) => !!(c.category.trim() || parseMoney(c.unit_price));
const fmt = (n: number) => new Intl.NumberFormat("vi-VN").format(n);

export const legFromRow = (l: TripLeg): LegDraft => ({
  staff_id: l.staff_id ?? "", start_date: l.start_date ?? "", end_date: l.end_date ?? "", from_place: l.from_place ?? "", to_place: l.to_place ?? "",
  content: l.content ?? "", transport: l.transport ?? "", distance: l.distance ?? "", stay_reason: l.stay_reason ?? "", note: l.note ?? "",
});
export const costFromRow = (c: TripCost): CostDraft => ({
  category: c.category, location: c.location ?? "", days: String(c.days).replace(".", ","), persons: String(c.persons).replace(".", ","),
  unit_price: fmt(Number(c.unit_price)), note: c.note ?? "",
});
const nz = (s: string) => (s.trim() ? s.trim() : null);
export const legToRow = (l: LegDraft, i: number, phase: Phase, request_id: string) => ({
  request_id, phase, line_no: i + 1, staff_id: l.staff_id || null, start_date: l.start_date || null, end_date: l.end_date || null,
  from_place: nz(l.from_place), to_place: nz(l.to_place), content: nz(l.content), transport: nz(l.transport),
  distance: nz(l.distance), stay_reason: nz(l.stay_reason), note: nz(l.note),
});
export const costToRow = (c: CostDraft, i: number, phase: Phase, request_id: string) => ({
  request_id, phase, line_no: i + 1, category: c.category.trim() || "Chi phí khác", location: nz(c.location),
  days: num(c.days), persons: num(c.persons), unit_price: parseMoney(c.unit_price) ?? 0, note: nz(c.note),
});

export async function loadTrip(requestId: string) {
  const [l, c] = await Promise.all([
    supabase.from("trip_legs").select("*").eq("request_id", requestId).order("line_no"),
    supabase.from("trip_costs").select("*").eq("request_id", requestId).order("line_no"),
  ]);
  const legs = (l.data ?? []) as TripLeg[];
  const costs = (c.data ?? []).map((x) => ({ ...x, days: Number(x.days), persons: Number(x.persons), unit_price: Number(x.unit_price), amount: Number(x.amount) })) as TripCost[];
  return {
    planLegs: legs.filter((x) => x.phase === "ke_hoach"), actLegs: legs.filter((x) => x.phase === "thuc_te"),
    planCosts: costs.filter((x) => x.phase === "ke_hoach"), actCosts: costs.filter((x) => x.phase === "thuc_te"),
  };
}

/** Ghi đè toàn bộ dòng của một giai đoạn (xoá rồi thêm lại). Trả về thông báo lỗi nếu có. */
export async function saveTrip(requestId: string, phase: Phase, legs: LegDraft[] | null, costs: CostDraft[] | null): Promise<string | null> {
  if (legs) {
    const d = await supabase.from("trip_legs").delete().eq("request_id", requestId).eq("phase", phase);
    if (d.error) return d.error.message;
    const rows = legs.filter(legFilled).map((l, i) => legToRow(l, i, phase, requestId));
    if (rows.length) { const r = await supabase.from("trip_legs").insert(rows); if (r.error) return r.error.message; }
  }
  if (costs) {
    const d = await supabase.from("trip_costs").delete().eq("request_id", requestId).eq("phase", phase);
    if (d.error) return d.error.message;
    const rows = costs.filter(costFilled).map((c, i) => costToRow(c, i, phase, requestId));
    if (rows.length) { const r = await supabase.from("trip_costs").insert(rows); if (r.error) return r.error.message; }
  }
  return null;
}
