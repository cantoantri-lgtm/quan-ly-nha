// Tiền VNĐ: hiển thị và đọc số người dùng gõ (4500000, 4.500.000, 4,5tr, 4tr5, 450k)

export function vnd(n: number | null | undefined): string {
  if (n == null) return "";
  return new Intl.NumberFormat("vi-VN").format(Math.round(n)) + " đ";
}

/** Rút gọn cho ô nhỏ: 4,5tr · 850k · 12tr */
export function vndShort(n: number | null | undefined): string {
  if (n == null) return "—";
  if (n >= 1_000_000) {
    const v = n / 1_000_000;
    return (Number.isInteger(v) ? String(v) : v.toFixed(v < 10 ? 2 : 1).replace(/0+$/, "").replace(/\.$/, "")).replace(".", ",") + "tr";
  }
  if (n >= 1000) return Math.round(n / 1000) + "k";
  return String(n);
}

export function parseMoney(input: string): number | null {
  const s = (input ?? "").toLowerCase().replace(/\s|đ|vnd|vnđ/g, "");
  if (!s) return null;
  // 4tr5 → 4.5tr
  let m = s.match(/^(\d+)(tr|triệu|m)(\d+)$/);
  if (m) return Math.round(parseFloat(`${m[1]}.${m[3]}`) * 1_000_000);
  m = s.match(/^(\d+(?:[.,]\d+)?)(tr|triệu|m)$/);
  if (m) return Math.round(parseFloat(m[1].replace(",", ".")) * 1_000_000);
  m = s.match(/^(\d+(?:[.,]\d+)?)(k|ng|nghìn|ngàn)$/);
  if (m) return Math.round(parseFloat(m[1].replace(",", ".")) * 1000);
  const digits = s.replace(/[.,]/g, "");
  if (/^\d+$/.test(digits)) return parseInt(digits, 10);
  return null;
}

/** Sắp xếp mã phòng tự nhiên: 101 < 102 < 1001, A2 < A10 */
export function naturalCompare(a: string, b: string) {
  return a.localeCompare(b, "vi", { numeric: true, sensitivity: "base" });
}
