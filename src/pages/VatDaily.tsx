import { useEffect, useMemo, useState } from "react";
import { supabase, friendlyError } from "../lib/supabase";
import { useSession } from "../lib/session";
import { ddmmyyyy, todayVN } from "../lib/dates";
import { vnd } from "../lib/money";
import { Empty, TopBar } from "../components/ui";
import "../table.css";

type Row = {
  invoice_id: string; collected_at: string; building_code: string; room_code: string; tenant_name: string; phone: string | null;
  id_number: string | null; id_address: string | null; amount: number; content: string; paid_via: string | null;
  collected_by_name: string | null; contract_code: string | null;
};

/** Danh sách khoản thu tiền thuê trong ngày để xuất hoá đơn GTGT (chỉ Quản lý / Kế toán) */
export default function VatDaily() {
  const { toast } = useSession();
  const [day, setDay] = useState(todayVN());
  const [rows, setRows] = useState<Row[] | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [rate, setRate] = useState("10%");
  const [inclusive, setInclusive] = useState(true);

  useEffect(() => {
    setRows(null); setErr(null);
    supabase.rpc("vat_daily_report", { p_date: day }).then(({ data, error }) => {
      if (error) setErr(friendlyError(error)); else setRows((data as Row[]) ?? []);
    });
  }, [day]);

  const total = useMemo(() => (rows ?? []).reduce((n, r) => n + Number(r.amount), 0), [rows]);
  const missing = useMemo(() => (rows ?? []).filter((r) => !r.id_number || !r.id_address).length, [rows]);

  async function save(wb: { xlsx: { writeBuffer: () => Promise<ArrayBuffer> } }, name: string) {
    const buf = await wb.xlsx.writeBuffer();
    const url = URL.createObjectURL(new Blob([buf], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" }));
    const a = document.createElement("a");
    a.href = url; a.download = name; a.click();
    window.setTimeout(() => URL.revokeObjectURL(url), 2000);
  }

  /** File nhập vào MISA meInvoice: mỗi khoản thu = một hoá đơn một dòng hàng. MISA cho ghép cột khi nhập nên tên cột không cần trùng tuyệt đối. */
  async function downloadMisa() {
    if (!rows?.length) return;
    setBusy(true);
    try {
      const { Workbook } = await import("exceljs");
      const wb = new Workbook();
      const ws = wb.addWorksheet("MISA");
      const pct = rate.endsWith("%") ? Number(rate.replace("%", "")) / 100 : 0;
      ws.columns = [
        { header: "Số thứ tự", width: 10 }, { header: "Ngày hóa đơn", width: 14, style: { numFmt: "dd/mm/yyyy" } },
        { header: "Họ tên người mua", width: 26 }, { header: "Số CCCD / Mã số thuế người mua", width: 24, style: { numFmt: "@" } },
        { header: "Địa chỉ người mua", width: 44 }, { header: "Số điện thoại", width: 15, style: { numFmt: "@" } },
        { header: "Hình thức thanh toán", width: 18 }, { header: "Tên hàng hóa, dịch vụ", width: 40 }, { header: "Đơn vị tính", width: 12 },
        { header: "Số lượng", width: 10 }, { header: "Đơn giá", width: 16, style: { numFmt: "#,##0" } },
        { header: "Thành tiền (chưa thuế)", width: 18, style: { numFmt: "#,##0" } }, { header: "Thuế suất", width: 10 },
        { header: "Tiền thuế", width: 14, style: { numFmt: "#,##0" } }, { header: "Tổng tiền thanh toán", width: 18, style: { numFmt: "#,##0" } },
      ];
      rows.forEach((r, i) => {
        const pay = Number(r.amount);
        const net = inclusive ? Math.round(pay / (1 + pct)) : pay;
        const tax = inclusive ? pay - net : Math.round(pay * pct);
        const [y, m, d] = r.collected_at.split("-").map(Number);
        ws.addRow([i + 1, new Date(Date.UTC(y, m - 1, d)), r.tenant_name, r.id_number ?? "", r.id_address ?? "", r.phone ?? "",
          r.paid_via === "chuyen_khoan" ? "CK" : "TM/CK", r.content, "Tháng", 1, net, net, rate, tax, net + tax]);
      });
      ws.getRow(1).font = { bold: true };
      ws.views = [{ state: "frozen", ySplit: 1 }];
      await save(wb, `misa-meinvoice-${day}.xlsx`);
    } catch { toast("Không tạo được file Excel. Thử lại sau."); }
    setBusy(false);
  }

  async function download() {
    if (!rows?.length) return;
    setBusy(true);
    try {
      const { Workbook } = await import("exceljs");
      const wb = new Workbook();
      const ws = wb.addWorksheet("Hoá đơn GTGT");
      ws.columns = [
        { header: "STT", width: 6 }, { header: "Họ tên khách", width: 26 }, { header: "Số CCCD", width: 16, style: { numFmt: "@" } },
        { header: "Địa chỉ trên CCCD", width: 44 }, { header: "Số điện thoại", width: 15, style: { numFmt: "@" } },
        { header: "Toà", width: 10 }, { header: "Phòng", width: 9 }, { header: "Nội dung", width: 40 },
        { header: "Số tiền (VNĐ)", width: 16, style: { numFmt: "#,##0" } }, { header: "Hình thức", width: 14 }, { header: "Người ghi nhận", width: 20 },
      ];
      rows.forEach((r, i) => ws.addRow([
        i + 1, r.tenant_name, r.id_number ?? "", r.id_address ?? "", r.phone ?? "", r.building_code, r.room_code, r.content,
        Number(r.amount), r.paid_via === "chuyen_khoan" ? "Chuyển khoản" : "Nhân viên ghi nhận", r.collected_by_name ?? "",
      ]));
      const t = ws.addRow(["", "TỔNG", "", "", "", "", "", "", total]); t.font = { bold: true };
      ws.getRow(1).font = { bold: true };
      ws.views = [{ state: "frozen", ySplit: 1 }];
      await save(wb, `hoa-don-gtgt-${day}.xlsx`);
    } catch { toast("Không tạo được file Excel. Thử lại sau."); }
    setBusy(false);
  }

  return (
    <>
      <TopBar title="Hoá đơn GTGT trong ngày" />
      <main className="main stack">
        <div className="card" style={{ padding: 14, display: "grid", gap: 10 }}>
          <label className="field"><span>Ngày thu tiền</span>
            <input id="vat-day" className="input" type="date" value={day} max={todayVN()} onChange={(e) => e.target.value && setDay(e.target.value)} /></label>
          {rows ? <div><b className="num" style={{ fontSize: 22 }}>{rows.length}</b> khoản · tổng <b className="num">{vnd(total)}</b></div> : null}
          {missing ? <p className="small" style={{ margin: 0, color: "var(--today)" }}>{missing} khách thiếu số CCCD hoặc địa chỉ CCCD — bổ sung ở hồ sơ khách trước khi xuất hoá đơn.</p> : null}
          <div className="row" style={{ alignItems: "flex-end" }}>
            <label className="field" style={{ flex: "1 1 120px" }}><span>Thuế suất GTGT (cho file MISA)</span>
              <select id="vat-rate" className="input" value={rate} onChange={(e) => setRate(e.target.value)}>
                {["10%", "8%", "5%", "0%", "KCT"].map((x) => <option key={x} value={x}>{x === "KCT" ? "KCT (không chịu thuế)" : x}</option>)}
              </select></label>
            <label className="field" style={{ flex: "1 1 160px", flexDirection: "row", alignItems: "center", gap: 8 }}>
              <input type="checkbox" checked={inclusive} onChange={(e) => setInclusive(e.target.checked)} /><span>Số tiền thu đã gồm VAT</span></label>
          </div>
          <button className="btn" disabled={!rows?.length || busy} onClick={downloadMisa}>{busy ? "Đang tạo file…" : "Tải file nhập MISA meInvoice"}</button>
          <button className="btn secondary" disabled={!rows?.length || busy} onClick={download}>Tải Excel đầy đủ thông tin</button>
        </div>
        {err ? <div className="error-box" role="alert">{err}</div> : null}
        {!rows && !err ? <div className="loading">Đang tải…</div> : null}
        {rows && !rows.length ? <Empty title={`Chưa có khoản thu nào ngày ${ddmmyyyy(day)}`}>Khoản thu hiện hiện ra khi nhân viên bấm "Đánh dấu đã thu" ở mục Hoá đơn của toà.</Empty> : null}
        {rows?.length ? (
          <section className="card dt-wrap">
            <table className="dt">
              <thead><tr><th>Khách</th><th>CCCD</th><th>Địa chỉ CCCD</th><th>SĐT</th><th>Phòng</th><th className="r">Số tiền</th><th>Nội dung</th></tr></thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.invoice_id}>
                    <td><b>{r.tenant_name}</b></td>
                    <td className="num">{r.id_number ?? <span className="muted">Thiếu</span>}</td>
                    <td>{r.id_address ?? <span className="muted">Thiếu</span>}</td>
                    <td className="num">{r.phone ?? ""}</td>
                    <td>{r.building_code} · {r.room_code}</td>
                    <td className="r num">{vnd(Number(r.amount))}</td>
                    <td>{r.content}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </section>
        ) : null}
      </main>
    </>
  );
}
