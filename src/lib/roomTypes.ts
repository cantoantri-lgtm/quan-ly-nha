export type RoomType = {
  id: string; building_id: string; name: string; area_m2: number | null; furniture: string | null; description: string | null;
  rent_mode: "thang" | "dem"; list_price: number | null; max_occupants: number | null; sort: number; color?: string | null;
};

/** Nội thất nhập mỗi dòng (hoặc cách nhau bằng dấu phẩy) một món */
export const furnitureList = (s: string | null | undefined) =>
  (s ?? "").split(/[\n,;]+/).map((x) => x.trim()).filter(Boolean);

/** Màu nhóm phòng: khoá lưu ở CSDL, mã màu nằm ở :root của styles.css (--gc-<khoá>, --gc-<khoá>-bg) */
export const GROUP_COLORS: { key: string; label: string }[] = [
  { key: "xam_xanh", label: "Xám xanh" }, { key: "kem", label: "Kem" }, { key: "cam", label: "Cam" }, { key: "xanh_la", label: "Xanh lá" },
  { key: "xanh_duong", label: "Xanh dương" }, { key: "tim", label: "Tím" }, { key: "hong", label: "Hồng" }, { key: "vang", label: "Vàng" },
];
export const groupColorKey = (t: { color?: string | null } | null | undefined) => (t?.color && GROUP_COLORS.some((c) => c.key === t.color) ? t.color : null);
