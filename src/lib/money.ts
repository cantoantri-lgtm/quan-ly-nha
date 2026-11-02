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

const DIGIT = ["không", "một", "hai", "ba", "bốn", "năm", "sáu", "bảy", "tám", "chín"];
function threeDigits(n: number, full: boolean): string {
  const tram = Math.floor(n / 100), chuc = Math.floor((n % 100) / 10), donvi = n % 10;
  const out: string[] = [];
  if (tram > 0 || full) out.push(DIGIT[tram], "trăm");
  if (chuc > 1) {
    out.push(DIGIT[chuc], "mươi");
    if (donvi === 1) out.push("mốt"); else if (donvi === 5) out.push("lăm"); else if (donvi > 0) out.push(DIGIT[donvi]);
  } else if (chuc === 1) {
    out.push("mười");
    if (donvi === 5) out.push("lăm"); else if (donvi > 0) out.push(DIGIT[donvi]);
  } else if (donvi > 0) {
    if (tram > 0 || full) out.push("lẻ");
    out.push(DIGIT[donvi]);
  }
  return out.join(" ");
}

/** Số tiền bằng chữ, VD 18500000 → "Mười tám triệu năm trăm nghìn đồng" */
export function vndWords(n: number | null | undefined): string {
  if (n == null || !Number.isFinite(n)) return "";
  let x = Math.round(Math.abs(n));
  if (x === 0) return "Không đồng";
  const units = ["", "nghìn", "triệu", "tỷ", "nghìn tỷ", "triệu tỷ"];
  const groups: number[] = [];
  while (x > 0) { groups.push(x % 1000); x = Math.floor(x / 1000); }
  const parts: string[] = [];
  for (let i = groups.length - 1; i >= 0; i--) {
    if (groups[i] === 0) continue;
    const full = i < groups.length - 1;           // nhóm không phải đầu tiên thì đọc đủ "không trăm"
    parts.push(threeDigits(groups[i], full), units[i]);
  }
  const s = parts.filter(Boolean).join(" ").replace(/\s+/g, " ").trim();
  return s.charAt(0).toUpperCase() + s.slice(1) + " đồng";
}
