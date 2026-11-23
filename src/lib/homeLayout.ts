import { supabase } from "./supabase";

/** Các ô báo cáo có thể đặt ở màn hình chính. `need` = ai được thêm ô này (số liệu vẫn do hàm SQL kiểm quyền). */
export type WidgetKey = "duyet" | "viec" | "chot_thang" | "tien_nha" | "hop_dong" | "lap_day" | "thu_chi" | "phan_anh";
type Who = { isManager: boolean; isLeadUp: boolean; isAccountant: boolean };
export type WidgetDef = { key: WidgetKey; title: string; desc: string; need: (w: Who) => boolean };

const all = () => true;
const lead = (w: Who) => w.isLeadUp || w.isManager || w.isAccountant;
export const WIDGETS: WidgetDef[] = [
  { key: "duyet", title: "Chờ bạn duyệt", desc: "Phiếu đến lượt bạn duyệt hoặc chi tiền", need: all },
  { key: "viec", title: "Việc cần làm", desc: "Việc chưa xong, trễ hạn và sắp đến hạn", need: all },
  { key: "chot_thang", title: "Chốt tháng", desc: "Phòng chưa ghi điện, chưa chốt tiền nhà, chưa thu theo toà", need: all },
  { key: "tien_nha", title: "Tiền nhà tháng này", desc: "Phải thu, đã thu, còn lại theo toà", need: all },
  { key: "hop_dong", title: "Hợp đồng & CCCD", desc: "Phòng chưa có hợp đồng, thiếu CCCD, hợp đồng sắp hết hạn", need: all },
  { key: "lap_day", title: "Lấp đầy hôm nay", desc: "Tỉ lệ phòng đang ở theo toà", need: lead },
  { key: "thu_chi", title: "Thu chi tháng này", desc: "Tiền đã thu từ đầu tháng theo toà", need: lead },
  { key: "phan_anh", title: "Phản ánh tháng này", desc: "Phản ánh của khách chưa trả lời, chưa đóng", need: (w) => w.isLeadUp || w.isManager },
];

export function defaultLayout(w: Who): WidgetKey[] {
  const base: WidgetKey[] = w.isManager ? ["duyet", "chot_thang", "viec"] : ["chot_thang", "duyet", "viec"];
  return base.filter((k) => WIDGETS.find((x) => x.key === k)!.need(w));
}

/** Bỏ ô không còn quyền hoặc không còn tồn tại */
export function cleanLayout(keys: string[], w: Who): WidgetKey[] {
  const seen = new Set<string>();
  return keys.filter((k) => {
    const d = WIDGETS.find((x) => x.key === k);
    if (!d || !d.need(w) || seen.has(k)) return false;
    seen.add(k); return true;
  }) as WidgetKey[];
}

export async function loadLayout(): Promise<string[] | null> {
  const { data } = await supabase.from("home_layouts").select("widgets").maybeSingle();
  return (data as { widgets: string[] } | null)?.widgets ?? null;
}

export async function saveLayout(userId: string, keys: WidgetKey[]) {
  return supabase.from("home_layouts").upsert({ user_id: userId, widgets: keys }, { onConflict: "user_id" });
}
