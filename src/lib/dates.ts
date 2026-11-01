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
export function dueInfo(due: string | null, done: boolean): { text: string; tone: "late" | "today" | "soon" | "plain" } | null {
  if (!due) return null;
  if (done) return { text: `Hạn ${ddmm(due)}`, tone: "plain" };
  const diff = daysBetween(todayVN(), due);
  if (diff < 0) return { text: `Trễ ${-diff} ngày`, tone: "late" };
  if (diff === 0) return { text: "Hạn hôm nay", tone: "today" };
  if (diff === 1) return { text: "Hạn ngày mai", tone: "soon" };
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
