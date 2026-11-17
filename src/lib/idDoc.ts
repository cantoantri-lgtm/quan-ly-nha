// Giấy tờ tuỳ thân của khách thuê: CCCD (người Việt) hoặc Hộ chiếu (khách nước ngoài).
// Khớp CSDL: tenants.id_type, tenant_has_cccd() (CCCD: ảnh mặt trước + sau; Hộ chiếu: ảnh trang thông tin).
export type IdType = "cccd" | "passport";

export const ID_NAME: Record<IdType, string> = { cccd: "CCCD", passport: "Hộ chiếu" };
export const ID_TYPES: [IdType, string][] = [["cccd", "CCCD (người Việt)"], ["passport", "Hộ chiếu (nước ngoài)"]];

/** Ảnh giấy tờ cần chụp: nhãn lưu trong files.label */
export const ID_PHOTOS: Record<IdType, { label: string; text: string; required: boolean }[]> = {
  cccd: [{ label: "truoc", text: "Mặt trước", required: true }, { label: "sau", text: "Mặt sau", required: true }],
  passport: [{ label: "ho_chieu", text: "Trang thông tin hộ chiếu", required: true }, { label: "thi_thuc", text: "Thị thực / thẻ tạm trú", required: false }],
};

/** Chuẩn hoá số giấy tờ: CCCD chỉ giữ chữ số; hộ chiếu giữ chữ + số, viết hoa */
export function normId(t: IdType, raw: string): string {
  return t === "passport" ? raw.replace(/[^A-Za-z0-9]/g, "").toUpperCase() : raw.replace(/\D/g, "");
}

/** Lỗi số giấy tờ (null = hợp lệ). CCCD 12 số hoặc CMND cũ 9 số; hộ chiếu 6–20 chữ/số. */
export function idError(t: IdType, id: string): string | null {
  if (t === "passport") return /^[A-Z0-9]{6,20}$/.test(id) ? null : "số hộ chiếu gồm 6–20 chữ và số";
  return /^(\d{9}|\d{12})$/.test(id) ? null : "số CCCD phải đủ 12 số (CMND cũ 9 số). Khách nước ngoài: chọn Hộ chiếu";
}

/** Tài khoản app khách: CCCD phải đủ 12 số (CMND 9 số không dùng được) */
export function accountIdError(t: IdType, id: string): string | null {
  if (t === "passport") return idError(t, id);
  return /^\d{12}$/.test(id) ? null : "tài khoản app cần CCCD 12 số (CMND 9 số không tạo được)";
}
