import { friendlyError, supabase } from "./supabase";
/** Khoản thu / chi của toà theo sổ thu chi (file SỔ ĐẦU TƯ LTR). SQL 090: building_ledger trả category theo đúng tên này. */
export const INCOME_CATS = ["Tiền phòng", "Điện", "Nước", "Dịch vụ", "Xe", "Thuê đêm", "Khác"] as const;
/** Khoản chi nhập tay hoặc chọn trên đề nghị thanh toán / tạm ứng gắn toà. Tiền thuê nhà nhập riêng ở "Chi phí & thuê nhà". */
export const EXPENSE_CATS = ["Điện", "Nước", "Wifi", "Rác", "Bảo trì", "Hoa hồng môi giới", "Thưởng nóng", "Hoàn cọc",
  "Quản lý", "Dọn vệ sinh", "Lương bảo vệ", "Quảng cáo", "Khác"] as const;
/** Thứ tự dòng chi trên báo cáo tổng: tiền thuê nhà đứng đầu */
export const EXPENSE_ROWS = ["Tiền thuê nhà", ...EXPENSE_CATS] as const;
export const expenseOptions = EXPENSE_CATS.map((c) => [c, c] as const);

/* ---------- Khoản chi toà do nhân viên ứng tiền (SQL 091) ---------- */

export type SettleStatus = "chua_quyet_toan" | "cho_quyet_toan" | "da_quyet_toan";
export const SETTLE_LABEL: Record<SettleStatus, string> = {
  chua_quyet_toan: "Chưa quyết toán", cho_quyet_toan: "Chờ quyết toán", da_quyet_toan: "Đã quyết toán",
};
export type PaySource = "nhan_vien" | "cong_ty";
export const PAY_SOURCE: Record<PaySource, string> = { nhan_vien: "Nhân viên tự ứng tiền", cong_ty: "Công ty trả trực tiếp" };
export type Expense = {
  id: string; building_id: string; spent_on: string; category: string; amount: number; note: string | null;
  paid_by: string | null; pay_source: PaySource; settle_status: SettleStatus; request_id: string | null;
  settled_at: string | null; settle_note: string | null; created_at: string;
};
export const EXP_COLS = "id,building_id,spent_on,category,amount,note,paid_by,pay_source,settle_status,request_id,settled_at,settle_note,created_at";

export async function saveExpense(x: { id?: string | null; building: string; date: string; category: string; amount: number; note: string; source: PaySource }) {
  const { error } = await supabase.rpc("expense_save", {
    p_id: x.id ?? null, p_building: x.building, p_date: x.date, p_category: x.category, p_amount: x.amount, p_note: x.note, p_source: x.source,
  });
  if (error) throw new Error(friendlyError(error));
}
/** Khoản mình đã ứng, chưa quyết toán (và các khoản đang gắn đề nghị requestId khi sửa đề nghị) */
export async function loadMyOpenExpenses(me: string, requestId?: string | null): Promise<Expense[]> {
  let q = supabase.from("building_expenses").select(EXP_COLS).eq("paid_by", me);
  q = requestId ? q.or(`settle_status.eq.chua_quyet_toan,request_id.eq.${requestId}`) : q.eq("settle_status", "chua_quyet_toan");
  const { data } = await q.order("spent_on");
  return ((data as Expense[]) ?? []).map((e) => ({ ...e, amount: Number(e.amount) }));
}
export async function linkExpenses(requestId: string, ids: string[]) {
  const { error } = await supabase.rpc("expense_link", { p_request: requestId, p_ids: ids });
  if (error) throw new Error(friendlyError(error));
}
