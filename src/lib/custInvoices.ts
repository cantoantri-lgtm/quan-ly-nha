import { supabase } from "./supabase";

/** Hoá đơn tiền phòng của hợp đồng khách đứng tên (SQL 085: customer_invoices) */
export type CustInvoice = {
  id: string; period: string; amount: number; due_date: string; status: "chua_thu" | "da_thu";
  pay_code: string; paid_via: string | null; txn_ref: string | null; collected_at: string | null; room_code: string;
};
export async function loadCustInvoices(customerId?: string | null): Promise<CustInvoice[]> {
  const { data } = await supabase.rpc("customer_invoices", { p_customer: customerId ?? null });
  return ((data as CustInvoice[]) ?? []).map((i) => ({ ...i, amount: Number(i.amount) }));
}
export const invMonth = (p: string) => `${p.slice(5, 7)}/${p.slice(0, 4)}`;
/** Trang thanh toán công khai /thanh-toan/<mã>: mở bằng tải trang đầy đủ (định tuyến riêng ở App) */
export const payHref = (code: string) => `/thanh-toan/${code}`;
