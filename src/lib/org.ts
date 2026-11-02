// Cơ cấu tổ chức theo Kế hoạch tái cấu trúc 2026–2027
export type Dept = { id: string; code: string; name: string; sort: number; head_staff_id: string | null };
export type Staff = {
  id: string; department_id: string | null; team: string | null; position: string; level: number | null; rank: number | null;
  person_name: string | null; profile_id: string | null; status: "co" | "tuyen" | "thue_ngoai"; hire_note: string | null;
  duty: "nhan_su" | "ke_toan" | "giam_doc" | null; is_leader: boolean; sort: number;
};
export type Pay = { staff_id: string; base_salary: number | null; note: string | null };
export type Scale = { level: number; rank: number; base_salary: number };

export const LEVEL_LABEL: Record<number, string> = { 1: "L1 · Nhân viên / Chuyên viên", 2: "L2 · Leader", 3: "L3 · Trưởng phòng", 4: "L4 · Phó Giám đốc" };
export const LEVEL_SHORT: Record<number, string> = { 1: "Nhân viên", 2: "Leader", 3: "Trưởng phòng", 4: "Phó Giám đốc" };
export const STATUS_LABEL: Record<string, string> = { co: "Đang có", tuyen: "Đang tuyển", thue_ngoai: "Thuê ngoài" };
export const DUTY_NAME: Record<string, string> = { giam_doc: "Giám đốc (duyệt cuối)", ke_toan: "Kế toán (duyệt chi)", nhan_su: "Nhân sự (xác nhận nghỉ phép)" };
