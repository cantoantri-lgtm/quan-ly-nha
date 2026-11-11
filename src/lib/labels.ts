export type Role = "quan_ly" | "giam_sat" | "nhan_vien" | "cong_tac_vien" | "khach_hang";
export type TaskStatus = "chua_lam" | "dang_lam" | "vuong" | "xong";
export type Priority = "thap" | "binh_thuong" | "cao" | "gap";

export const ROLE_LABEL: Record<Role, string> = {
  quan_ly: "Quản lý",
  giam_sat: "Giám sát",
  nhan_vien: "Nhân viên",
  cong_tac_vien: "Cộng tác viên",
  khach_hang: "Khách hàng",
};
export const ROLE_RANK: Record<Role, number> = { quan_ly: 3, giam_sat: 2, nhan_vien: 1, cong_tac_vien: 0, khach_hang: 0 };

export const STATUS_LABEL: Record<TaskStatus, string> = {
  chua_lam: "Chưa làm",
  dang_lam: "Đang làm",
  vuong: "Vướng",
  xong: "Xong",
};
export const STATUS_ORDER: TaskStatus[] = ["chua_lam", "dang_lam", "vuong", "xong"];

export const PRIORITY_LABEL: Record<Priority, string> = {
  thap: "Thấp",
  binh_thuong: "Bình thường",
  cao: "Cao",
  gap: "Gấp",
};

export const KIND_LABEL: Record<string, string> = {
  khach_san: "Khách sạn",
  can_ho: "Căn hộ cho thuê",
  hon_hop: "Hỗn hợp",
};

export type Profile = {
  id: string;
  full_name: string;
  phone: string | null;
  role: Role;
  is_active: boolean;
  annual_leave_days?: number | null;   // do Quản lý nhập, null = chưa nhập
};

export type Building = {
  id: string;
  code: string;
  name: string;
  address: string | null;
  kind: string;
  total_floors: number | null;
  note: string | null;
  public_note?: string | null;
  lat?: number | null;
  lng?: number | null;
};

export type Task = {
  id: string;
  parent_id: string | null;
  building_id: string | null;
  title: string;
  description: string | null;
  assignee_id: string | null;
  created_by: string | null;
  due_date: string | null;
  priority: Priority;
  status: TaskStatus;
  sort_order: number;
  completed_at: string | null;
  created_at: string;
  updated_at: string;
};
