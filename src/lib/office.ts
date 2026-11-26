// Module Văn phòng: nghỉ phép, làm việc bên ngoài, công tác, tờ trình (LOA), thanh toán, tạm ứng
import { ddmm, ddmmyyyy } from "./dates";
import { vnd } from "./money";
import { supabase } from "./supabase";
import { listFiles, removeFile } from "./files";
import { useCallback, useEffect, useState } from "react";

export type ReqKind = "nghi_phep" | "ra_ngoai" | "cong_tac" | "loa" | "mua_hang" | "thanh_toan" | "tam_ung";
/** Khoá luồng duyệt (không phải loại phiếu): mua_hang_gia = bước Duyệt NCC & giá của đề nghị mua hàng (SQL 108) */
export type FlowKind = ReqKind | "mua_hang_gia";
/** Giai đoạn đề nghị mua hàng (SQL 108). null = phiếu cũ trước khi có bước báo giá */
export type BuyStage = "nhu_cau" | "bao_gia" | "duyet_gia" | "da_chot";
export type ReqStatus = "nhap" | "cho_duyet" | "da_duyet" | "tu_choi" | "da_huy" | "hoan_tat" | "tra_lai";

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
  doc_no: string | null;
  doc_date: string | null;
  currency: string;
  loa_no: string | null;
  /** Tờ trình (LOA) đã duyệt mà đề nghị thanh toán / tạm ứng này dùng ngân sách */
  loa_id: string | null;
  pay_method: string | null;
  pay_type: string | null;
  vendor_code: string | null;
  contact_code: string | null;
  contact_name: string | null;
  handover_to: string | null;
  contact_phone: string | null;
  transport: string | null;
  settle_due: string | null;
  /** Công tác (migration 067) */
  trip_type?: string | null;
  trip_area?: string | null;
  visa_type?: string | null;
  traveler_id?: string | null;
  hr_confirmed_at?: string | null;
  hr_confirmed_by?: string | null;
  hr_note?: string | null;
  /** Đề nghị tạm ứng / thanh toán lập từ chuyến công tác */
  trip_id?: string | null;
  /** Dự án / hạng mục chính (migration 069) */
  project_id?: string | null;
  project_item_id?: string | null;
  purchase_id?: string | null;   // đề nghị thanh toán tham chiếu đề nghị mua hàng
  expense_category?: string | null;   // khoản chi của toà (SQL 090) trên ĐNTT / tạm ứng gắn toà
  buy_stage?: BuyStage | null;
  buy_estimate?: number | null;       // tổng dự kiến lúc duyệt nhu cầu (amount đổi thành giá NCC khi trình duyệt giá)
  buy_vendor_id?: string | null;
  buy_quote_id?: string | null;
  buy_reason?: string | null;         // lý do chọn NCC / thiếu báo giá
  buy_round?: number;
};

export type ReqLine = {
  id?: string; request_id?: string; line_no: number;
  invoice_serial: string | null; invoice_no: string | null; invoice_date: string | null;
  seller_name: string | null; seller_tax: string | null;
  amount_pre_vat: number; quantity: number | null; vat_pct: number; vat_amount: number; total: number;
  description: string | null; cost_center: string; object_ref: string | null;
};
export type ReqAdvance = { id?: string; request_id?: string; amount: number; description: string | null };
export type ReqLink = { id: string; request_id: string; url: string; title: string | null; created_at: string };

export const PAY_METHOD: Record<string, string> = { chuyen_khoan: "Chuyển khoản", tien_mat: "Tiền mặt", bu_tru: "Bù trừ", khac: "Khác" };

/** Một bước trong luồng duyệt */
export type ReqStep = {
  id: string; request_id: string; step_no: number; duty: string; approver_id: string | null;
  status: "cho" | "da_duyet" | "tu_choi" | "bo_qua" | "tra_lai"; skip_reason: string | null;
  decided_by: string | null; decided_at: string | null; note: string | null;
};
export const DUTY_LABEL: Record<string, string> = {
  leader: "Leader", truong_phong: "Trưởng phòng", nhan_su: "Nhân sự", ke_toan: "Kế toán", giam_doc: "Giám đốc", mua_hang: "Mua hàng", khac: "Người duyệt",
};
/** Luồng duyệt theo loại đề nghị (mô tả cho người dùng) */
export const FLOW_TEXT: Record<ReqKind, string> = {
  nghi_phep: "Người đề nghị → Leader → Trưởng phòng → Nhân sự",
  ra_ngoai: "Người đề nghị → Leader → Trưởng phòng → Nhân sự",
  cong_tac: "Người đề nghị → Leader → Trưởng phòng → Nhân sự",
  loa: "Người lập → Leader → Trưởng phòng → Kế toán → Giám đốc",
  thanh_toan: "Người đề nghị → Leader → Trưởng phòng → Kế toán → Giám đốc",
  tam_ung: "Người đề nghị → Leader → Trưởng phòng → Kế toán → Giám đốc",
  mua_hang: "Duyệt nhu cầu: Leader → Trưởng phòng · Mua hàng lấy báo giá, chọn NCC · Duyệt NCC & giá: Kế toán → Giám đốc",
};
export const PAY_TYPE: Record<string, string> = {
  nha_cung_cap: "Thanh toán nhà cung cấp", hoan_ung: "Hoàn ứng", chi_phi_van_hanh: "Chi phí vận hành",
  sua_chua: "Sửa chữa, bảo trì", luong_thuong: "Lương, thưởng", khac: "Khác",
};
export const VAT_RATES = [0, 5, 8, 10];

export const KINDS: { kind: ReqKind; label: string; hint: string }[] = [
  { kind: "nghi_phep", label: "Xin nghỉ phép", hint: "Nửa ngày, cả ngày" },
  { kind: "ra_ngoai", label: "Làm việc bên ngoài", hint: "Ra ngoài trong giờ làm" },
  { kind: "cong_tac", label: "Đi công tác", hint: "Duyệt trước, báo cáo sau" },
  { kind: "loa", label: "Tờ trình (LOA)", hint: "Xin duyệt chính sách, ngân sách" },
  { kind: "mua_hang", label: "Đề nghị mua hàng", hint: "Xin duyệt trước khi mua" },
  { kind: "thanh_toan", label: "Đề nghị thanh toán", hint: "Chi tiền đã mua / cần trả" },
  { kind: "tam_ung", label: "Đề nghị tạm ứng", hint: "Ứng tiền trước để làm việc" },
];

export const LEAVE_TYPE: Record<string, string> = { phep_nam: "Phép năm", khong_luong: "Không lương" };
export const LEAVE_SPAN: Record<string, string> = {
  ca_ngay: "Cả ngày", sang: "Nửa ngày sáng", chieu: "Nửa ngày chiều", dau_gio: "2 giờ đầu buổi sáng", cuoi_gio: "2 giờ cuối buổi chiều",
};
/** Số ngày phép trừ theo thời gian nghỉ trong 1 ngày (khớp tg_requests_guard) */
export const LEAVE_SPAN_DAYS: Record<string, number> = { sang: 0.5, chieu: 0.5, dau_gio: 0.25, cuoi_gio: 0.25 };
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
    case "loa": return "Tờ trình (LOA)";
    case "thanh_toan": return "Đề nghị thanh toán";
    case "tam_ung": return "Đề nghị tạm ứng";
    case "mua_hang": return "Đề nghị mua hàng";
  }
}

export const BUY_STAGE_LABEL: Record<BuyStage, string> = {
  nhu_cau: "Duyệt nhu cầu", bao_gia: "Lấy báo giá", duyet_gia: "Duyệt NCC & giá", da_chot: "Đã chốt NCC & giá",
};

export function statusLabel(r: Pick<Req, "kind" | "status"> & { buy_stage?: BuyStage | null }): string {
  if (r.kind === "mua_hang" && r.buy_stage) {
    if (r.status === "cho_duyet") return r.buy_stage === "duyet_gia" ? "Chờ duyệt NCC & giá" : "Chờ duyệt nhu cầu";
    if (r.status === "da_duyet") return r.buy_stage === "bao_gia" ? "Chờ báo giá" : r.buy_stage === "da_chot" ? "Đã chốt NCC & giá" : "Đã duyệt";
  }
  switch (r.status) {
    case "nhap": return "Nháp";
    case "cho_duyet": return "Chờ duyệt";
    case "tu_choi": return "Từ chối";
    case "tra_lai": return "Trả lại";
    case "da_huy": return "Đã rút";
    case "da_duyet":
      return r.kind === "cong_tac" ? "Đã duyệt · chờ báo cáo" : (r.kind === "thanh_toan" || r.kind === "tam_ung") ? "Đã duyệt · chờ chi" : "Đã duyệt";
    case "hoan_tat": return r.kind === "cong_tac" ? "Đã báo cáo" : "Đã chi";
  }
}

export const fmtDays = (d: number | null | undefined) =>
  d == null ? "" : Number(d) === 0.5 ? "nửa ngày" : Number(d) === 0.25 ? "2 giờ (0,25 ngày)"
    : `${Number(d).toLocaleString("vi-VN", { maximumFractionDigits: 2 })} ngày`;

const hhmm = (t: string | null) => (t ? t.slice(0, 5) : "");

/** Số tiền kèm loại tiền (LOA có thể lập bằng USD) */
export const moneyCur = (n: number | null | undefined, currency = "VND") =>
  currency === "VND" ? vnd(n) : `${Number(n ?? 0).toLocaleString("vi-VN")} ${currency}`;

/** Một dòng tóm tắt: thời gian / số tiền */
export function summary(r: Req): string {
  const range = (a: string, b: string | null) => (b && b !== a ? `${ddmm(a)} – ${ddmm(b)}` : ddmm(a));
  switch (r.kind) {
    case "nghi_phep":
      return r.span === "ca_ngay" ? `${range(r.start_date, r.end_date)} · ${fmtDays(r.days)}`
        : `${LEAVE_SPAN[r.span ?? ""]} ${ddmm(r.start_date)}${r.span === "dau_gio" || r.span === "cuoi_gio" ? " · 0,25 ngày" : ""}`;
    case "ra_ngoai": {
      const t = r.start_time || r.end_time ? ` · ${hhmm(r.start_time)}${r.end_time ? "–" + hhmm(r.end_time) : ""}` : "";
      return `${range(r.start_date, r.end_date)}${t}${r.location ? " · " + r.location : ""}`;
    }
    case "cong_tac":
      return `${r.location} · ${range(r.start_date, r.end_date)} (${fmtDays(r.days)})`;
    case "loa":
      return r.amount ? moneyCur(r.amount, r.currency) : "Không phát sinh tiền";
    default:
      return vnd(r.amount);
  }
}

export function fullDate(iso: string | null) { return iso ? ddmmyyyy(iso) : "—"; }
export { hhmm };

/** Chỉ sửa / xoá được khi đề nghị KHÔNG đang trong quá trình duyệt (khớp request_editable ở cơ sở dữ liệu) */
export const EDITABLE_STATUS: ReqStatus[] = ["nhap", "tra_lai", "tu_choi", "da_huy"];
export const isEditableStatus = (s: ReqStatus) => EDITABLE_STATUS.includes(s);
/** Đã xong hẳn: nghỉ phép / ra ngoài / tờ trình chỉ cần duyệt; còn lại đợi chi tiền hoặc báo cáo thực tế */
export const isFinished = (r: Pick<Req, "kind" | "status"> & { buy_stage?: BuyStage | null }) =>
  r.status === "hoan_tat" || (r.status === "da_duyet" && (r.kind === "nghi_phep" || r.kind === "ra_ngoai" || r.kind === "loa"
    || (r.kind === "mua_hang" && (!r.buy_stage || r.buy_stage === "da_chot"))));
export const EDIT_LOCK_TIP = "Đang trong quá trình phê duyệt hoặc đã duyệt xong nên không sửa / xoá được. Chỉ sửa được khi bị trả lại, bị từ chối hoặc đã rút.";

/** Ngày theo giờ Việt Nam (yyyy-mm-dd) của một thời điểm ISO */
export const vnDate = (iso: string) => new Date(iso).toLocaleDateString("sv-SE", { timeZone: "Asia/Ho_Chi_Minh" });

/** Xoá đề nghị: gỡ tệp đính kèm (kho ảnh) trước, rồi xoá dòng. Cơ sở dữ liệu từ chối nếu đang trong quá trình duyệt. */
export async function deleteRequest(id: string): Promise<void> {
  const { data: cur } = await supabase.from("requests").select("status").eq("id", id).maybeSingle();
  if (!cur) throw new Error("Không tìm thấy đề nghị.");
  if (!isEditableStatus((cur as { status: ReqStatus }).status)) throw new Error(EDIT_LOCK_TIP);
  const files = await listFiles("dinh_kem_de_nghi", "request_id", id);
  for (const f of files) await removeFile(f);
  const { data, error } = await supabase.from("requests").delete().eq("id", id).select("id");
  if (error) throw new Error(error.message);
  if (!data?.length) throw new Error("Bạn không có quyền xoá đề nghị này.");
}

// ---------- Tờ trình phê duyệt (LOA) ----------
export const LOA_CATEGORY: Record<string, string> = {
  van_hanh: "Vận hành toà nhà & Bảo trì", marketing: "Marketing", kinh_doanh: "Kinh doanh",
  dau_tu_mua_sam: "Đầu tư, Xây dựng & Mua sắm", he_thong: "Hệ thống thông tin", nhan_su: "Nhân sự",
  ke_toan: "Kế toán – Tài chính", phap_ly: "Pháp lý", chung: "Chung / Khác",
};
/** Mảng kinh doanh (SBU) */
export const LOA_SBU: Record<string, string> = {
  tat_ca: "Tất cả", cho_thue: "Cho thuê căn hộ – phòng", khach_san: "Khách sạn", phap_ly_pccc: "Pháp lý – PCCC",
  xay_dung: "Xây dựng", khong_ap_dung: "Không áp dụng",
};
export const LOA_PAY: Record<string, string> = { chi: "Chi", thu: "Thu" };
export const LOA_TAX: Record<string, string> = { chua_gom: "Chưa gồm thuế", da_gom: "Đã gồm thuế" };
export const LOA_BUDGET: Record<string, string> = { trong: "Trong ngân sách", ngoai: "Ngoài ngân sách" };
/** Loại tài liệu đính kèm tờ trình (nhãn của tệp) */
export const LOA_DOC_TYPE: Record<string, string> = {
  du_toan: "Dự toán ngân sách", bao_gia: "Báo giá", hop_dong: "Hợp đồng / thoả thuận", chinh_sach: "Quy trình / chính sách", khac: "Tài liệu khác",
};

export type LoaDetails = {
  request_id: string; subject: string; category: string | null; propose_dept: string | null; sbu: string[];
  background: string | null; seek_approval: string | null; pay_receive: "chi" | "thu"; tax: "chua_gom" | "da_gom";
  budget_status: "trong" | "ngoai"; budget_item_no: string | null; details: string | null; autosum: boolean;
  ref_loa_id: string | null; report_due: string | null; submitted_at: string | null; updated_by: string | null; updated_at: string;
};
export type LoaLine = { id: string; request_id: string; line_no: number; description: string; unit: string | null; quantity: number; unit_price: number; amount: number; note: string | null };
export type LoaMember = { request_id: string; user_id: string; role: "soan" | "xem" };
export type LoaDept = { id: string; code: string; name: string; mine: boolean };
/** LOA chi tiền đã duyệt, dùng được cho đề nghị thanh toán / tạm ứng */
export type LoaPick = { id: string; doc_no: string | null; subject: string; amount: number; used: number; pending: number; start_date: string; requester_name: string | null };
export type LoaBrief = { id: string; doc_no: string | null; subject: string; amount: number | null; currency: string; status: ReqStatus; pay_receive: "chi" | "thu"; used: number; pending: number; requester_name: string | null };
export type LoaLinked = { id: string; kind: ReqKind; doc_no: string | null; requester_name: string | null; amount: number | null; status: ReqStatus; created_at: string; can_open: boolean };
/** Ngân sách LOA còn lại sau các đề nghị đã duyệt và đang chờ duyệt */
export const loaLeft = (l: { amount: number | null; used: number; pending: number }) => Number(l.amount ?? 0) - Number(l.used) - Number(l.pending);

// ---------- Tạm ngưng loại đề nghị với nhân viên (khớp request_kind_settings / tg_requests_pause) ----------
/** Các loại đề nghị đang tạm ngưng với nhân viên. Quản lý vẫn lập được. */
export function usePausedKinds() {
  const [paused, setPaused] = useState<Set<ReqKind>>(new Set());
  const [loaded, setLoaded] = useState(false);
  const reload = useCallback(async () => {
    const { data } = await supabase.from("request_kind_settings").select("kind,staff_enabled");
    setPaused(new Set(((data ?? []) as { kind: ReqKind; staff_enabled: boolean }[]).filter((x) => !x.staff_enabled).map((x) => x.kind)));
    setLoaded(true);
  }, []);
  useEffect(() => { reload(); }, [reload]);
  return { paused, loaded, reload };
}
export const PAUSED_TIP = "Chức năng này đang tạm ngưng với nhân viên. Liên hệ Quản lý.";
