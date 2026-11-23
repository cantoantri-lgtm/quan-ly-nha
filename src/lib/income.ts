import { friendlyError, supabase } from "./supabase";

/* ---------- Thu khác của toà, ngoài tiền phòng (SQL 099) ---------- */
export const OTHER_INCOME_CATS = ["Gửi xe vãng lai", "Giặt sấy", "Dọn phòng", "Bán phế liệu", "Làm thẻ, chìa khoá", "Đền bù hư hỏng", "Khác"] as const;
export const otherIncomeOptions = OTHER_INCOME_CATS.map((c) => [c, c] as const);

export type IncomeMethod = "tien_mat" | "chuyen_khoan";
export const INCOME_METHOD: Record<IncomeMethod, string> = { tien_mat: "Tiền mặt", chuyen_khoan: "Chuyển khoản vào tài khoản công ty" };
export type Handover = "chua_nop" | "da_nop";
export const HANDOVER_LABEL: Record<Handover, string> = { chua_nop: "Chưa nộp Kế toán", da_nop: "Đã nộp" };

export type OtherIncome = {
  id: string; building_id: string; received_on: string; category: string; amount: number; note: string | null; payer_name: string | null;
  method: IncomeMethod; received_by: string | null; handover_status: Handover; handed_at: string | null; handed_by: string | null; created_at: string;
};
export const INC_COLS = "id,building_id,received_on,category,amount,note,payer_name,method,received_by,handover_status,handed_at,handed_by,created_at";

export async function saveIncome(x: { id?: string | null; building: string; date: string; category: string; amount: number; note: string; method: IncomeMethod; payer: string }) {
  const { error } = await supabase.rpc("income_save", {
    p_id: x.id ?? null, p_building: x.building, p_date: x.date, p_category: x.category, p_amount: x.amount, p_note: x.note,
    p_method: x.method, p_payer_name: x.payer,
  });
  if (error) throw new Error(friendlyError(error));
}
