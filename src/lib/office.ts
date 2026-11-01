// Module Văn phòng: nghỉ phép, làm việc bên ngoài, công tác, thanh toán, tạm ứng
import { ddmm, ddmmyyyy } from "./dates";
import { vnd } from "./money";

export type ReqKind = "nghi_phep" | "ra_ngoai" | "cong_tac" | "thanh_toan" | "tam_ung";
export type ReqStatus = "cho_duyet" | "da_duyet" | "tu_choi" | "da_huy" | "hoan_tat";

export type Req = {
  id: string;
  kind: ReqKind;
  requester_id: string;
  status: ReqStatus;
  sub_type: string | null;
  span: string | null;
  start_date: string;
  end_date: string | null;
  start_time: string | null;
  end_time: string | null;
  days: number | null;
  location: string | null;
  reason: string;
  amount: number | null;
  payee: string | null;
  bank_info: string | null;
  building_id: string | null;
  actual_start: string | null;
  actual_end: string | null;
  actual_cost: number | null;
  actual_note: string | null;
  reported_at: string | null;
  approver_id: string | null;
  decided_at: string | null;
  decision_note: string | null;
  paid_at: string | null;
  paid_by: string | null;
  created_at: string;
  updated_at: string;
};

export const KINDS: { kind: ReqKind; label: string; hint: string }[] = [
  { kind: "nghi_phep", label: "Xin nghỉ phép", hint: "Nửa ngày, cả ngày" },
  { kind: "ra_ngoai", label: "Làm việc bên ngoài", hint: "Ra ngoài trong giờ làm" },
  { kind: "cong_tac", label: "Đi công tác", hint: "Duyệt trước, báo cáo sau" },
  { kind: "thanh_toan", label: "Đề nghị thanh toán", hint: "Chi tiền đã mua / cần trả" },
  { kind: "tam_ung", label: "Đề nghị tạm ứng", hint: "Ứng tiền trước để làm việc" },
];

export const LEAVE_TYPE: Record<string, string> = { phep_nam: "Phép năm", khong_luong: "Không lương" };
export const LEAVE_SPAN: Record<string, string> = { ca_ngay: "Cả ngày", sang: "Nửa ngày sáng", chieu: "Nửa ngày chiều" };
export const OUT_TYPE: Record<string, string> = {
  khong_den_cty: "Không tới công ty",
  co_quay_lai: "Có quay lại công ty",
  khong_quay_lai: "Không quay lại công ty",
};

export function kindLabel(r: Pick<Req, "kind" | "sub_type">): string {
  switch (r.kind) {
    case "nghi_phep": return r.sub_type === "khong_luong" ? "Nghỉ không lương" : "Nghỉ phép năm";
    case "ra_ngoai": return "Làm việc bên ngoài";
    case "cong_tac": return "Đi công tác";
    case "thanh_toan": return "Đề nghị thanh toán";
    case "tam_ung": return "Đề nghị tạm ứng";
  }
}

export function statusLabel(r: Pick<Req, "kind" | "status">): string {
  switch (r.status) {
    case "cho_duyet": return "Chờ duyệt";
    case "tu_choi": return "Từ chối";
    case "da_huy": return "Đã rút";
    case "da_duyet":
      return r.kind === "cong_tac" ? "Đã duyệt · chờ báo cáo" : (r.kind === "thanh_toan" || r.kind === "tam_ung") ? "Đã duyệt · chờ chi" : "Đã duyệt";
    case "hoan_tat": return r.kind === "cong_tac" ? "Đã báo cáo" : "Đã chi";
  }
}

export const fmtDays = (d: number | null | undefined) =>
  d == null ? "" : d === 0.5 ? "nửa ngày" : `${String(d).replace(/\.0$/, "").replace(".", ",")} ngày`;

const hhmm = (t: string | null) => (t ? t.slice(0, 5) : "");

/** Một dòng tóm tắt: thời gian / số tiền */
export function summary(r: Req): string {
  const range = (a: string, b: string | null) => (b && b !== a ? `${ddmm(a)} – ${ddmm(b)}` : ddmm(a));
  switch (r.kind) {
    case "nghi_phep":
      return r.span === "ca_ngay" ? `${range(r.start_date, r.end_date)} · ${fmtDays(r.days)}` : `${LEAVE_SPAN[r.span ?? ""]} ${ddmm(r.start_date)}`;
    case "ra_ngoai": {
      const t = r.start_time || r.end_time ? ` · ${hhmm(r.start_time)}${r.end_time ? "–" + hhmm(r.end_time) : ""}` : "";
      return `${range(r.start_date, r.end_date)}${t}${r.location ? " · " + r.location : ""}`;
    }
    case "cong_tac":
      return `${r.location} · ${range(r.start_date, r.end_date)} (${fmtDays(r.days)})`;
    default:
      return vnd(r.amount);
  }
}

export function fullDate(iso: string | null) { return iso ? ddmmyyyy(iso) : "—"; }
export { hhmm };
