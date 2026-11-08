export type RoomType = {
  id: string; building_id: string; name: string; area_m2: number | null; furniture: string | null; description: string | null;
  rent_mode: "thang" | "dem"; list_price: number | null; max_occupants: number | null; sort: number;
};

/** Nội thất nhập mỗi dòng (hoặc cách nhau bằng dấu phẩy) một món */
export const furnitureList = (s: string | null | undefined) =>
  (s ?? "").split(/[\n,;]+/).map((x) => x.trim()).filter(Boolean);
