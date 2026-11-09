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

  useEffect(() => {
    setRows(null); setErr(null);
    supabase.rpc("vat_daily_report", { p_date: day }).then(({ data, error }) => {
      if (error) setErr(friendlyError(error)); else setRows((data as Row[]) ?? []);
    });
  }, [day]);

  const total = useMemo(() => (rows ?? []).reduce((n, r) => n + Number(r.amount), 0), [rows]);
  const missing = useMemo(() => (rows ?? []).filter((r) => !r.id_number || !r.id_address).length, [rows]);

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
      const buf = await wb.xlsx.writeBuffer();
      const url = URL.createObjectURL(new Blob([buf], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" }));
      const a = document.createElement("a");
      a.href = url; a.download = `hoa-don-gtgt-${day}.xlsx`; a.click();
      window.setTimeout(() => URL.revokeObjectURL(url), 2000);
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
          <button className="btn" disabled={!rows?.length || busy} onClick={download}>{busy ? "Đang tạo file…" : "Tải Excel"}</button>
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
