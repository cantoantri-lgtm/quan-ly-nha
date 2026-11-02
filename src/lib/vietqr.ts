// Mã VietQR (chuẩn NAPAS 247): tạo ngay trên máy, không gọi dịch vụ ngoài nên không phụ thuộc mạng công ty.
import QRCode from "qrcode";

export type Bank = { bin: string; name: string };
/** Các ngân hàng phổ biến (mã BIN do NAPAS cấp). Ngân hàng khác: nhập BIN thủ công. */
export const BANKS: Bank[] = [
  { bin: "970436", name: "Vietcombank" }, { bin: "970415", name: "VietinBank" }, { bin: "970418", name: "BIDV" },
  { bin: "970405", name: "Agribank" }, { bin: "970407", name: "Techcombank" }, { bin: "970422", name: "MB Bank" },
  { bin: "970416", name: "ACB" }, { bin: "970432", name: "VPBank" }, { bin: "970423", name: "TPBank" },
  { bin: "970403", name: "Sacombank" }, { bin: "970437", name: "HDBank" }, { bin: "970441", name: "VIB" },
  { bin: "970443", name: "SHB" }, { bin: "970448", name: "OCB" }, { bin: "970426", name: "MSB" },
  { bin: "970440", name: "SeABank" }, { bin: "970431", name: "Eximbank" }, { bin: "970449", name: "LPBank" },
  { bin: "970428", name: "Nam A Bank" }, { bin: "970425", name: "ABBank" }, { bin: "970429", name: "SCB" },
];

const tlv = (id: string, v: string) => id + String(v.length).padStart(2, "0") + v;

function crc16(s: string): string {
  let crc = 0xffff;
  for (let i = 0; i < s.length; i++) {
    crc ^= s.charCodeAt(i) << 8;
    for (let b = 0; b < 8; b++) crc = crc & 0x8000 ? ((crc << 1) ^ 0x1021) & 0xffff : (crc << 1) & 0xffff;
  }
  return crc.toString(16).toUpperCase().padStart(4, "0");
}

/** Chuỗi nội dung mã QR chuyển nhanh 24/7 tới số tài khoản, có số tiền và nội dung cố định */
export function vietQrPayload(o: { bin: string; account: string; amount?: number; content?: string }): string {
  const acct = tlv("00", "A000000727") + tlv("01", tlv("00", o.bin) + tlv("01", o.account)) + tlv("02", "QRIBFTTA");
  let s = tlv("00", "01") + tlv("01", o.amount ? "12" : "11") + tlv("38", acct) + tlv("53", "704");
  if (o.amount && o.amount > 0) s += tlv("54", String(Math.round(o.amount)));
  s += tlv("58", "VN");
  if (o.content) s += tlv("62", tlv("08", o.content.replace(/[^A-Za-z0-9 ]/g, "").slice(0, 25)));
  s += "6304";
  return s + crc16(s);
}

export function vietQrSvg(o: Parameters<typeof vietQrPayload>[0]): Promise<string> {
  return QRCode.toString(vietQrPayload(o), { type: "svg", margin: 1, errorCorrectionLevel: "M", color: { dark: "#000000", light: "#ffffff" } });
}

export type PaySettings = { bank_bin: string; bank_name: string; account_no: string; account_name: string };
