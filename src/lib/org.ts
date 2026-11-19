// Cơ cấu tổ chức theo Kế hoạch tái cấu trúc 2026–2027
export type Dept = { id: string; code: string; name: string; sort: number; head_staff_id: string | null };
export type Staff = {
  id: string; department_id: string | null; team: string | null; position: string; level: number | null; rank: number | null;
  person_name: string | null; profile_id: string | null; status: "co" | "tap_su" | "thu_viec" | "tuyen" | "thue_ngoai"; hire_note: string | null;
  /** Ngày kết thúc tập sự / thử việc (migration 071) */
  trial_end?: string | null;
  duty: "nhan_su" | "ke_toan" | "giam_doc" | null; is_leader: boolean; sort: number;
};
export type Pay = { staff_id: string; base_salary: number | null; note: string | null };
export type Scale = { level: number; rank: number; base_salary: number };

export const LEVEL_LABEL: Record<number, string> = { 1: "L1 · Nhân viên / Chuyên viên", 2: "L2 · Leader", 3: "L3 · Trưởng phòng", 4: "L4 · Phó Giám đốc" };
export const LEVEL_SHORT: Record<number, string> = { 1: "Nhân viên", 2: "Leader", 3: "Trưởng phòng", 4: "Phó Giám đốc" };
export const STATUS_LABEL: Record<string, string> = { co: "Chính thức", tap_su: "Tập sự", thu_viec: "Thử việc", tuyen: "Đang tuyển", thue_ngoai: "Thuê ngoài" };
/** Vị trí đã có người làm (chính thức, tập sự, thử việc) */
export const STAFFED = new Set(["co", "tap_su", "thu_viec"]);
/** Nhắc theo Bộ luật Lao động 2019 */
export const TRIAL_HINT: Record<string, string> = {
  tap_su: "Tập nghề (Điều 61 BLLĐ 2019): tối đa 3 tháng, ký hợp đồng đào tạo, không thu học phí. Có tham gia làm việc thì phải trả lương theo thoả thuận. Hết hạn đạt yêu cầu thì ký hợp đồng lao động.",
  thu_viec: "Thử việc (Điều 24–27): mỗi công việc chỉ thử 1 lần. Tối đa 6 ngày làm việc (công việc giản đơn), 30 ngày (trung cấp, công nhân kỹ thuật, nghiệp vụ), 60 ngày (cao đẳng trở lên), 180 ngày (quản lý doanh nghiệp). Lương ít nhất 85% lương chính thức. Hết hạn phải báo kết quả.",
};
export const DUTY_NAME: Record<string, string> = { giam_doc: "Giám đốc (duyệt cuối)", ke_toan: "Kế toán (duyệt chi)", nhan_su: "Nhân sự (xác nhận nghỉ phép)" };
