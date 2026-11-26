import { supabase } from "./supabase";
import { addDaysISO, rangeLabel, type DateRange } from "./dates";
import { saveWorkbook } from "./xlsx";
import { EXP_COLS, EXPENSE_ROWS, INCOME_CATS, SETTLE_LABEL, type Expense } from "./expense";
import { INC_COLS, type OtherIncome } from "./income";

/** Xuất Excel sổ thu chi của một toà trong một khoảng ngày (trang "Thu & chi toà nhà", mặc định trọn tháng).
 *  Thu: hoá đơn của các tháng trong khoảng + hoá đơn tháng khác nhưng thu trong khoảng; khoản thu khách và khoản chi theo ngày.
 *  Lấy theo quyền của người xuất (RLS): nhân viên chỉ thấy khoản chi mình ứng, Quản lý / Giám sát / Kế toán thấy cả toà.
 *  Sheet: TỔNG HỢP (thu theo khoản, chi theo khoản, chênh lệch) · THU (hoá đơn tiền phòng tháng) · THU KHÁC (khoản thu khách) · CHI. */
type Line = { k?: string; label?: string; amount?: number };
type Inv = {
  period: string; amount: number; due_date: string; status: string; collected_at: string | null; paid_via: string | null;
  txn_ref: string | null; transfer_note: string | null; lines: Line[] | null;
  contracts: { rooms: { code: string } | null; tenants: { full_name: string } | null } | null;
};
type Bill = { kind: string; amount: number; status: string; confirmed_at: string | null; pay_code: string; txn_ref: string | null; note: string | null;
  lines: { label: string; amount: number }[] | null };

const K2CAT: Record<string, string> = { phong: "Tiền phòng", dien: "Điện", nuoc: "Nước", dich_vu: "Dịch vụ", xe: "Xe" };
const BILL_CAT: Record<string, string> = { tien_phong: "Tiền phòng", dien: "Điện", nuoc: "Nước", phi_dich_vu: "Dịch vụ", tien_coc: "Tiền cọc", phieu_thu: "Khác" };
const dmy = (d: string | null) => (d ? d.slice(0, 10).split("-").reverse().join("/") : "");
const billCat = (label: string) => label.startsWith("Tiền phòng") ? "Tiền phòng" : label === "Tiền điện" ? "Điện" : label === "Tiền nước" ? "Nước" : label === "Phí dịch vụ" ? "Dịch vụ" : "Khác";

export async function exportCashbook(b: { id: string; code: string; name: string }, r: DateRange, nameOf: (id: string | null) => string) {
  const start = r.from, next = addDaysISO(r.to, 1);
  const pFrom = r.from.slice(0, 8) + "01", pTo = r.to.slice(0, 8) + "01";
  const [iv, bl, ex, oi] = await Promise.all([
    supabase.from("invoices").select("period,amount,due_date,status,collected_at,paid_via,txn_ref,transfer_note,lines, contracts(rooms(code), tenants(full_name))")
      .eq("building_id", b.id).neq("status", "huy")
      .or(`and(period.gte.${pFrom},period.lte.${pTo}),and(collected_at.gte.${r.from},collected_at.lte.${r.to})`),
    supabase.from("customer_bills").select("kind,amount,status,confirmed_at,pay_code,txn_ref,note,lines")
      .eq("building_id", b.id).eq("status", "da_thanh_toan").gte("confirmed_at", `${start}T00:00:00+07:00`).lt("confirmed_at", `${next}T00:00:00+07:00`),
    supabase.from("building_expenses").select(EXP_COLS).eq("building_id", b.id).gte("spent_on", start).lt("spent_on", next).order("spent_on"),
    supabase.from("building_incomes").select(INC_COLS).eq("building_id", b.id).gte("received_on", start).lt("received_on", next).order("received_on"),
  ]);
  if (iv.error) throw new Error(iv.error.message);
  const invs = ((iv.data as unknown as Inv[]) ?? []).sort((a, c) => (a.contracts?.rooms?.code ?? "").localeCompare(c.contracts?.rooms?.code ?? "", "vi", { numeric: true }));
  const bills = (bl.data as Bill[]) ?? [];
  const exps = ((ex.data as Expense[]) ?? []).map((e) => ({ ...e, amount: Number(e.amount) }));
  const others = ((oi.data as OtherIncome[]) ?? []).map((x) => ({ ...x, amount: Number(x.amount) }));

  // Cộng thu theo khoản (chỉ hoá đơn đã thu và khoản thu khách đã thanh toán), chi theo khoản
  const thu = new Map<string, number>(), chi = new Map<string, number>();
  const add = (mp: Map<string, number>, k: string, v: number) => mp.set(k, (mp.get(k) ?? 0) + v);
  // Thu = tiền đã thu trong khoảng ngày (theo ngày thu)
  for (const i of invs.filter((x) => x.status === "da_thu" && x.collected_at && x.collected_at.slice(0, 10) >= r.from && x.collected_at.slice(0, 10) <= r.to)) {
    if (i.lines?.length) i.lines.forEach((l) => add(thu, K2CAT[l.k ?? ""] ?? "Khác", Number(l.amount ?? 0)));
    else add(thu, "Tiền phòng", Number(i.amount));
  }
  for (const c of bills) {
    if (c.lines?.length) c.lines.forEach((l) => add(thu, billCat(l.label), Number(l.amount)));
    else add(thu, BILL_CAT[c.kind] ?? "Khác", Number(c.amount));
  }
  others.forEach((x) => add(thu, x.category, x.amount));   // thu khác (SQL 099): mỗi khoản một dòng theo tên khoản
  exps.forEach((e) => add(chi, e.category, e.amount));

  const { Workbook } = await import("exceljs");
  const wb = new Workbook();
  const money = "#,##0";
  const title = `SỔ THU CHI ${b.code} · ${b.name} · ${rangeLabel(r).toUpperCase()}`;

  // TỔNG HỢP
  const s = wb.addWorksheet("TỔNG HỢP");
  s.addRow([title]).font = { bold: true, size: 13 };
  s.addRow([]);
  const sec = (code: string, name: string, v: number) => { const r = s.addRow([code, name, v]); r.font = { bold: true }; };
  const thuCats = [...INCOME_CATS, ...[...thu.keys()].filter((k) => k !== "Tiền cọc" && !(INCOME_CATS as readonly string[]).includes(k))];
  const chiCats = [...EXPENSE_ROWS, ...[...chi.keys()].filter((k) => !(EXPENSE_ROWS as readonly string[]).includes(k))];
  const totThu = thuCats.reduce((t, k) => t + (thu.get(k) ?? 0), 0);
  const totChi = chiCats.reduce((t, k) => t + (chi.get(k) ?? 0), 0);
  sec("A", "THU (đã thu trong khoảng ngày)", totThu);
  thuCats.forEach((k) => s.addRow(["", k, thu.get(k) ?? 0]));
  sec("B", "CHI", totChi);
  chiCats.forEach((k) => s.addRow(["", k, chi.get(k) ?? 0]));
  sec("C", "CHÊNH LỆCH (A − B)", totThu - totChi);
  if (thu.get("Tiền cọc")) s.addRow(["", "Tiền cọc đã thu (không tính chênh lệch)", thu.get("Tiền cọc")]);
  s.addRow([]);
  const phaiThu = invs.reduce((t, i) => t + Number(i.amount), 0);
  s.addRow(["", `Hoá đơn trong sổ: ${invs.length} hoá đơn · phải thu`, phaiThu]);
  s.addRow(["", "Còn phải thu", invs.filter((i) => i.status !== "da_thu").reduce((t, i) => t + Number(i.amount), 0)]);
  s.getColumn(1).width = 5; s.getColumn(2).width = 44; s.getColumn(3).width = 18; s.getColumn(3).numFmt = money;

  // THU: hoá đơn tiền phòng của tháng
  const t = wb.addWorksheet("THU");
  t.columns = [
    { header: "Tháng", width: 9 }, { header: "Phòng", width: 8 }, { header: "Khách đứng tên", width: 24 },
    { header: "Tiền phòng", width: 13, style: { numFmt: money } }, { header: "Điện", width: 11, style: { numFmt: money } },
    { header: "Nước", width: 11, style: { numFmt: money } }, { header: "Dịch vụ", width: 11, style: { numFmt: money } },
    { header: "Xe", width: 10, style: { numFmt: money } }, { header: "Khác", width: 10, style: { numFmt: money } },
    { header: "Tổng", width: 14, style: { numFmt: money } }, { header: "Hạn", width: 11 }, { header: "Trạng thái", width: 11 },
    { header: "Ngày thu", width: 11 }, { header: "Hình thức", width: 13 }, { header: "Mã GD / nội dung CK", width: 34, style: { numFmt: "@" } },
  ];
  t.getRow(1).font = { bold: true };
  for (const i of invs) {
    const by: Record<string, number> = {};
    if (i.lines?.length) i.lines.forEach((l) => { const c = K2CAT[l.k ?? ""] ?? "Khác"; by[c] = (by[c] ?? 0) + Number(l.amount ?? 0); });
    else by["Tiền phòng"] = Number(i.amount);
    t.addRow([`${i.period.slice(5, 7)}/${i.period.slice(0, 4)}`, i.contracts?.rooms?.code ?? "", i.contracts?.tenants?.full_name ?? "",
      by["Tiền phòng"] ?? null, by["Điện"] ?? null, by["Nước"] ?? null, by["Dịch vụ"] ?? null, by["Xe"] ?? null, by["Khác"] ?? null,
      Number(i.amount), dmy(i.due_date), i.status === "da_thu" ? "Đã thu" : "Chưa thu", dmy(i.collected_at),
      i.status === "da_thu" ? (i.paid_via === "chuyen_khoan" ? "Chuyển khoản" : "Thu tay") : "",
      i.txn_ref ?? (i.status === "da_thu" ? "" : i.transfer_note ?? "")]);
  }
  const tr = t.addRow(["", "", "Cộng", ...[4, 5, 6, 7, 8, 9, 10].map((c) => ({ formula: `SUM(${t.getColumn(c).letter}2:${t.getColumn(c).letter}${invs.length + 1})` }))]);
  tr.font = { bold: true };
  t.views = [{ state: "frozen", ySplit: 1 }];

  // THU KHÁC: khoản thu khách đã thanh toán (cọc, phí…) và thu khác của toà (gửi xe vãng lai, phế liệu…)
  if (bills.length || others.length) {
    const o = wb.addWorksheet("THU KHÁC");
    o.columns = [{ header: "Ngày", width: 11 }, { header: "Nguồn", width: 16 }, { header: "Khoản", width: 18 }, { header: "Nội dung", width: 36 },
      { header: "Số tiền", width: 14, style: { numFmt: money } }, { header: "Hình thức", width: 14 }, { header: "Người thu / mã", width: 22, style: { numFmt: "@" } },
      { header: "Nộp Kế toán", width: 14 }];
    o.getRow(1).font = { bold: true };
    bills.forEach((c) => o.addRow([dmy(c.confirmed_at), c.kind === "tien_coc" ? "Tiền cọc" : "Khoản thu khách", BILL_CAT[c.kind] ?? c.kind, c.note ?? "", Number(c.amount), "Chuyển khoản", c.txn_ref ?? c.pay_code, ""]));
    others.forEach((x) => o.addRow([dmy(x.received_on), "Thu khác toà", x.category, [x.note, x.payer_name ? `người nộp: ${x.payer_name}` : ""].filter(Boolean).join(" · "),
      x.amount, x.method === "chuyen_khoan" ? "Chuyển khoản" : "Tiền mặt", nameOf(x.received_by),
      x.method === "chuyen_khoan" ? "Vào TK công ty" : x.handover_status === "da_nop" ? "Đã nộp" : "Chưa nộp"]));
    const n = bills.length + others.length;
    const orow = o.addRow(["", "", "Cộng", "", { formula: `SUM(E2:E${n + 1})` }]);
    orow.font = { bold: true };
  }

  // CHI
  const c = wb.addWorksheet("CHI");
  c.columns = [
    { header: "Ngày", width: 11 }, { header: "Khoản chi", width: 20 }, { header: "Nội dung", width: 36 },
    { header: "Số tiền", width: 14, style: { numFmt: money } }, { header: "Hình thức", width: 20 }, { header: "Người ứng", width: 20 },
    { header: "Quyết toán", width: 16 }, { header: "Ghi chú quyết toán", width: 40 },
  ];
  c.getRow(1).font = { bold: true };
  exps.forEach((e) => c.addRow([dmy(e.spent_on), e.category, e.note ?? "", e.amount,
    e.pay_source === "cong_ty" ? "Công ty trả trực tiếp" : "Nhân viên tự ứng", e.pay_source === "cong_ty" ? "" : nameOf(e.paid_by),
    SETTLE_LABEL[e.settle_status], e.settle_note ?? ""]));
  const cr = c.addRow(["", "Cộng", "", { formula: `SUM(D2:D${exps.length + 1})` }]);
  cr.font = { bold: true };
  c.views = [{ state: "frozen", ySplit: 1 }];

  const fn = rangeLabel(r).startsWith("tháng") ? r.from.slice(0, 7) : `${r.from}_den_${r.to}`;
  await saveWorkbook(wb, `So-thu-chi_${b.code}_${fn}.xlsx`);
}
