/** Khoản thu / chi của toà theo sổ thu chi (file SỔ ĐẦU TƯ LTR). SQL 090: building_ledger trả category theo đúng tên này. */
export const INCOME_CATS = ["Tiền phòng", "Điện", "Nước", "Dịch vụ", "Xe", "Thuê đêm", "Khác"] as const;
/** Khoản chi nhập tay hoặc chọn trên đề nghị thanh toán / tạm ứng gắn toà. Tiền thuê nhà nhập riêng ở "Chi phí & thuê nhà". */
export const EXPENSE_CATS = ["Điện", "Nước", "Wifi", "Rác", "Bảo trì", "Hoa hồng môi giới", "Thưởng nóng", "Hoàn cọc",
  "Quản lý", "Dọn vệ sinh", "Lương bảo vệ", "Quảng cáo", "Khác"] as const;
/** Thứ tự dòng chi trên báo cáo tổng: tiền thuê nhà đứng đầu */
export const EXPENSE_ROWS = ["Tiền thuê nhà", ...EXPENSE_CATS] as const;
export const expenseOptions = EXPENSE_CATS.map((c) => [c, c] as const);
