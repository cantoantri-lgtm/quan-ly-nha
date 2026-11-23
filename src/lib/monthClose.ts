import { supabase } from "./supabase";

/** Một phòng thuê tháng trong bảng chốt tháng (hàm SQL month_close). */
export type MCRow = {
  building_id: string; building_code: string; room_id: string; room_code: string; floor: number | null; room_status: string;
  contract_id: string | null; contract_code: string | null; tenant_name: string | null; contract_end: string | null;
  occupants: number; cccd_missing: number;
  meter_period: string; meter_needed: boolean; meter_done: boolean;
  rent_period: string; invoice_id: string | null; invoice_status: string | null; invoice_amount: number | null; due_date: string | null;
  elec_needed: boolean; elec_ok: boolean; collected_at: string | null;
};

export type MCKey = "chua_hd" | "thieu_cccd" | "chua_dien" | "chua_chot" | "chua_thu" | "da_thu";
export const MC_LABEL: Record<MCKey, string> = {
  chua_hd: "Chưa có hợp đồng", thieu_cccd: "Thiếu CCCD", chua_dien: "Chưa ghi điện",
  chua_chot: "Chưa chốt tiền nhà", chua_thu: "Chưa thu tiền", da_thu: "Đã thu",
};
export const MC_KEYS: MCKey[] = ["chua_dien", "chua_chot", "chua_thu", "chua_hd", "thieu_cccd", "da_thu"];

export function mcIs(r: MCRow, k: MCKey): boolean {
  switch (k) {
    case "chua_hd": return !r.contract_id;
    case "thieu_cccd": return r.cccd_missing > 0;
    case "chua_dien": return r.meter_needed && !r.meter_done;
    case "chua_chot": return !!r.contract_id && (!r.invoice_id || !r.elec_ok);
    case "chua_thu": return !!r.invoice_id && r.invoice_status === "chua_thu";
    case "da_thu": return r.invoice_status === "da_thu";
  }
}

/** Lý do chưa chốt, để hiện cạnh mã phòng */
export function notClosedWhy(r: MCRow): string {
  if (!r.invoice_id) return "chưa có hoá đơn";
  if (!r.elec_ok) return "hoá đơn chưa có tiền điện";
  return "";
}

export type MCBuilding = { id: string; code: string; rows: MCRow[]; count: Record<MCKey, number>; rooms: number };

export function groupByBuilding(rows: MCRow[]): MCBuilding[] {
  const m = new Map<string, MCBuilding>();
  for (const r of rows) {
    let b = m.get(r.building_id);
    if (!b) {
      b = { id: r.building_id, code: r.building_code, rows: [], rooms: 0,
        count: { chua_hd: 0, thieu_cccd: 0, chua_dien: 0, chua_chot: 0, chua_thu: 0, da_thu: 0 } };
      m.set(r.building_id, b);
    }
    b.rows.push(r); b.rooms++;
    for (const k of MC_KEYS) if (mcIs(r, k)) b.count[k]++;
  }
  return [...m.values()];
}

/** p_rent: tháng tiền nhà (mặc định tháng này). p_meter: kỳ ghi điện (mặc định kỳ đang cần làm). */
export async function loadMonthClose(rent?: string, meter?: string) {
  const args: Record<string, string> = {};
  if (rent) args.p_rent = rent;
  if (meter) args.p_meter = meter;
  const { data, error } = await supabase.rpc("month_close", args);
  return { rows: (data ?? []) as MCRow[], error };
}

// Dùng chung giữa các ô màn hình chính (Chốt tháng, Tiền nhà, Hợp đồng & CCCD): gọi một lần trong 30 giây
let cache: { at: number; p: ReturnType<typeof loadMonthClose> } | null = null;
export function loadMonthCloseShared() {
  if (!cache || Date.now() - cache.at > 30000) cache = { at: Date.now(), p: loadMonthClose() };
  return cache.p;
}
