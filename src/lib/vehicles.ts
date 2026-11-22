/** Xe đăng ký theo hợp đồng (SQL 090: contract_vehicles). Xe đạp không tính phí gửi xe. */
export type VehicleKind = "xe_may" | "xe_dien" | "xe_dap" | "o_to" | "khac";
export const VEHICLE_KIND: Record<VehicleKind, string> = {
  xe_may: "Xe máy", xe_dien: "Xe điện", xe_dap: "Xe đạp", o_to: "Ô tô", khac: "Khác",
};
export type Vehicle = { id: string; kind: VehicleKind; model: string | null; plate: string | null; registered_on: string };
export const vehicleText = (v: { kind: VehicleKind; model: string | null; plate: string | null }) =>
  [v.plate, v.model, VEHICLE_KIND[v.kind]].filter(Boolean).join(" · ");
