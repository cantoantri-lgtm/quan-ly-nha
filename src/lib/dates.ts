// Ngày theo giờ Việt Nam, dạng YYYY-MM-DD
export function todayVN(): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Ho_Chi_Minh" }).format(new Date());
}

export function daysBetween(fromISO: string, toISO: string): number {
  const a = Date.parse(fromISO + "T00:00:00Z");
  const b = Date.parse(toISO + "T00:00:00Z");
  return Math.round((b - a) / 86400000);
}

export function ddmm(iso: string | null | undefined): string {
  if (!iso) return "";
  const [, m, d] = iso.slice(0, 10).split("-");
  return `${d}/${m}`;
}

export function ddmmyyyy(iso: string | null | undefined): string {
  if (!iso) return "";
  const [y, m, d] = iso.slice(0, 10).split("-");
  return `${d}/${m}/${y}`;
}

const DOW = ["CN", "T2", "T3", "T4", "T5", "T6", "T7"];
export function dow(iso: string): string {
  return DOW[new Date(iso.slice(0, 10) + "T00:00:00Z").getUTCDay()];
}

/** "Trễ 2 ngày" / "Hôm nay" / "Ngày mai" / "T7 31/10" */
/** Cộng n ngày vào ngày dạng YYYY-MM-DD */
export function addDaysISO(iso: string, n: number): string {
  return new Date(Date.parse(iso + "T00:00:00Z") + n * 86400000).toISOString().slice(0, 10);
}

/** Ngày kết thúc hợp đồng n tháng tính từ ngày bắt đầu: 01/12 + 12 tháng → 30/11 năm sau; 31/01 + 1 tháng → 27/02 */
export function termEndISO(start: string, months: number): string {
  const [y, m, d] = start.split("-").map(Number);
  const last = new Date(Date.UTC(y, m - 1 + months + 1, 0)).getUTCDate();   // ngày cuối của tháng đích
  const same = new Date(Date.UTC(y, m - 1 + months, Math.min(d, last)));
  return addDaysISO(same.toISOString().slice(0, 10), -1);
}

/** Số tháng tròn giữa 2 ngày theo cách tính thời hạn hợp đồng; null nếu không tròn tháng */
export function termMonths(start: string, end: string): number | null {
  for (let n = 1; n <= 120; n++) if (termEndISO(start, n) === end) return n;
  return null;
}

/** Sắp đến hạn = hạn hôm nay hoặc trong SOON_DAYS ngày tới (việc chưa xong) */
export const SOON_DAYS = 2;
/** Mức nhắc hạn để tô màu: trễ, hạn hôm nay, sắp đến hạn; null nếu còn xa hoặc không có hạn */
export function dueLevel(due: string | null, done: boolean): "late" | "today" | "soon" | null {
  if (!due || done) return null;
  const diff = daysBetween(todayVN(), due);
  return diff < 0 ? "late" : diff === 0 ? "today" : diff <= SOON_DAYS ? "soon" : null;
}

export function dueInfo(due: string | null, done: boolean): { text: string; tone: "late" | "today" | "soon" | "plain" } | null {
  if (!due) return null;
  if (done) return { text: `Hạn ${ddmm(due)}`, tone: "plain" };
  const diff = daysBetween(todayVN(), due);
  if (diff < 0) return { text: `Trễ ${-diff} ngày`, tone: "late" };
  if (diff === 0) return { text: "Hạn hôm nay", tone: "today" };
  if (diff === 1) return { text: "Hạn ngày mai", tone: "soon" };
  if (diff <= SOON_DAYS) return { text: `Còn ${diff} ngày · ${dow(due)} ${ddmm(due)}`, tone: "soon" };
  return { text: `${dow(due)} ${ddmm(due)}`, tone: "plain" };
}

export function timeAgo(ts: string): string {
  const s = Math.max(0, (Date.now() - Date.parse(ts)) / 1000);
  if (s < 60) return "vừa xong";
  if (s < 3600) return `${Math.floor(s / 60)} phút trước`;
  if (s < 86400) return `${Math.floor(s / 3600)} giờ trước`;
  if (s < 86400 * 7) return `${Math.floor(s / 86400)} ngày trước`;
  return ddmmyyyy(new Date(ts).toISOString());
}

export function clock(ts: string): string {
  return new Intl.DateTimeFormat("vi-VN", {
    timeZone: "Asia/Ho_Chi_Minh", hour: "2-digit", minute: "2-digit", day: "2-digit", month: "2-digit",
  }).format(new Date(ts));
}

/** Số ngày từ a đến b (tính cả hai đầu), không tính Chủ nhật — công ty nghỉ Chủ nhật */
export function workDays(fromISO: string, toISO: string): number {
  let n = 0;
  for (let t = Date.parse(fromISO + "T00:00:00Z"), end = Date.parse(toISO + "T00:00:00Z"); t <= end; t += 86400000) {
    if (new Date(t).getUTCDay() !== 0) n++;
  }
  return n;
}
