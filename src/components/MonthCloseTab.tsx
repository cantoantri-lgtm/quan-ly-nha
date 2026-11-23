import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { friendlyError } from "../lib/supabase";
import { ddmmyyyy, mmyyyy, todayVN } from "../lib/dates";
import { vnd } from "../lib/money";
import { saveWorkbook } from "../lib/xlsx";
import { groupByBuilding, loadMonthClose, mcIs, MC_KEYS, MC_LABEL, notClosedWhy, type MCKey, type MCRow } from "../lib/monthClose";
import { mcLink } from "./MonthCloseCard";
import { Empty } from "./ui";

const prevMonth = (m: string) => { const [y, mo] = m.split("-").map(Number); return new Date(Date.UTC(y, mo - 2, 1)).toISOString().slice(0, 10); };
const n0 = (x: number | null | undefined) => Number(x ?? 0);

/** Báo cáo chốt tháng: hợp đồng, CCCD, ghi điện, chốt tiền nhà, thu tiền theo toà và theo phòng. */
export default function MonthCloseTab() {
  const thisMonth = todayVN().slice(0, 7);
  const [month, setMonth] = useState(thisMonth);
  const [rows, setRows] = useState<MCRow[] | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [f, setF] = useState<MCKey | "">("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    setRows(null); setErr(null);
    const rent = `${month}-01`;
    // Tháng hiện tại: kỳ điện đang cần làm (từ ngày 28 là tháng này). Tháng khác: số điện tháng trước, dùng cho hoá đơn tháng đó.
    loadMonthClose(rent, month === thisMonth ? undefined : prevMonth(rent)).then(({ rows, error }) => {
      if (error) setErr(friendlyError(error));
      setRows(rows);
    });
  }, [month, thisMonth]);

  const groups = useMemo(() => groupByBuilding(rows ?? []), [rows]);
  const all = rows ?? [];
  const total = (k: MCKey) => all.filter((r) => mcIs(r, k)).length;
  const due = all.reduce((t, r) => t + (r.invoice_status && r.invoice_status !== "huy" ? n0(r.invoice_amount) : 0), 0);
  const got = all.reduce((t, r) => t + (r.invoice_status === "da_thu" ? n0(r.invoice_amount) : 0), 0);
  const shown = f ? all.filter((r) => mcIs(r, f)) : all.filter((r) => MC_KEYS.some((k) => k !== "da_thu" && mcIs(r, k)));
  const meterP = all[0]?.meter_period;

  async function exportXlsx() {
    setBusy(true);
    try {
      const { Workbook } = await import("exceljs");
      const wb = new Workbook();
      const a = wb.addWorksheet("Theo toà");
      a.addRow([`Chốt tháng ${mmyyyy(month)} · số điện tháng ${meterP ? mmyyyy(meterP) : ""}`]).font = { bold: true, size: 13 };
      a.addRow([]);
      const ha = a.addRow(["Toà", "Phòng thuê tháng", ...MC_KEYS.map((k) => MC_LABEL[k]), "Tiền chưa thu"]); ha.font = { bold: true };
      for (const g of groups) {
        a.addRow([g.code, g.rooms, ...MC_KEYS.map((k) => g.count[k]),
          g.rows.reduce((t, r) => t + (r.invoice_status === "chua_thu" ? n0(r.invoice_amount) : 0), 0)]);
      }
      a.getColumn(1).width = 16; for (let i = 2; i <= MC_KEYS.length + 3; i++) a.getColumn(i).width = 16;
      a.getColumn(MC_KEYS.length + 3).numFmt = "#,##0";
      const b = wb.addWorksheet("Theo phòng");
      const hb = b.addRow(["Toà", "Phòng", "Khách đứng tên", "Số HĐ", "Hết hạn HĐ", "Người ở", "Thiếu CCCD", "Đã ghi điện", "Hoá đơn", "Số tiền", "Ngày thu", "Cần xử lý"]); hb.font = { bold: true };
      for (const r of all) {
        b.addRow([r.building_code, r.room_code, r.tenant_name ?? "", r.contract_code ?? "", r.contract_end ? ddmmyyyy(r.contract_end) : "",
          r.occupants, r.cccd_missing, !r.meter_needed ? "Không cần" : r.meter_done ? "Rồi" : "Chưa",
          invLabel(r), r.invoice_amount ?? "", r.collected_at ? ddmmyyyy(r.collected_at) : "", issues(r).join("; ")]);
      }
      [10, 9, 24, 14, 12, 9, 11, 12, 18, 14, 12, 40].forEach((w, i) => { b.getColumn(i + 1).width = w; });
      b.getColumn(10).numFmt = "#,##0";
      await saveWorkbook(wb, `chot-thang-${month}.xlsx`);
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Không tạo được file Excel");
    } finally { setBusy(false); }
  }

  return (
    <div className="stack">
      <div className="row" style={{ gap: 8, alignItems: "flex-end", flexWrap: "wrap" }}>
        <label className="field" style={{ flex: "1 1 160px" }}><span>Tháng tiền nhà</span>
          <input className="input" type="month" value={month} max={thisMonth} onChange={(e) => e.target.value && setMonth(e.target.value)} /></label>
        <button className="btn ghost" disabled={busy || !all.length} onClick={exportXlsx}>{busy ? "Đang tạo…" : "Tải Excel"}</button>
      </div>
      <p className="muted small" style={{ margin: 0 }}>
        Ghi đồng hồ điện từ ngày 28 đến cuối tháng. Ngày 1 lập hoá đơn (tiền phòng tháng mới và tiền điện tháng trước), thu tiền từ ngày 1 đến ngày 3.
        Chưa chốt tiền nhà là phòng có hợp đồng mà chưa có hoá đơn tháng này, hoặc hoá đơn chưa có tiền điện vì chưa ghi số.
        Số điện đang xem: tháng {meterP ? mmyyyy(meterP) : "…"}.
      </p>
      {err ? <div className="error-box" role="alert">{err}</div> : null}
      {rows === null ? <div className="loading">Đang tải…</div> : all.length === 0 ? (
        <Empty title="Không có phòng thuê tháng">Các toà bạn phụ trách chưa có phòng đang ở hoặc hợp đồng hiệu lực.</Empty>
      ) : (<>
        <div className="rpt-kpis">
          <div className="rpt-kpi"><b className="num">{all.length}</b><span>Phòng đang thuê tháng</span></div>
          <div className="rpt-kpi"><b className="num">{total("chua_hd")} / {total("thieu_cccd")}</b><span>Chưa có hợp đồng / thiếu CCCD</span></div>
          <div className="rpt-kpi"><b className="num">{total("chua_dien")}</b><span>Chưa ghi điện</span></div>
          <div className="rpt-kpi"><b className="num">{total("chua_chot")}</b><span>Chưa chốt tiền nhà</span></div>
          <div className="rpt-kpi"><b className="num">{total("chua_thu")}</b><span>Chưa thu tiền · còn {vnd(due - got)}</span></div>
          <div className="rpt-kpi"><b className="num">{total("da_thu")}</b><span>Đã thu · {vnd(got)}</span></div>
        </div>

        <div className="rpt-wrap"><table className="rpt">
          <thead><tr><th>Toà</th><th>Phòng</th><th>Chưa HĐ</th><th>Thiếu CCCD</th><th>Chưa ghi điện</th><th>Chưa chốt</th><th>Chưa thu</th><th>Đã thu</th><th>Tiền chưa thu</th></tr></thead>
          <tbody>{groups.map((g) => (
            <tr key={g.id}>
              <td><b>{g.code}</b></td><td className="num">{g.rooms}</td>
              <td className="num">{g.count.chua_hd || ""}</td><td className="num">{g.count.thieu_cccd || ""}</td>
              <td className="num">{g.count.chua_dien || ""}</td><td className="num">{g.count.chua_chot || ""}</td>
              <td className="num">{g.count.chua_thu || ""}</td><td className="num">{g.count.da_thu || ""}</td>
              <td className="num">{vnd(g.rows.reduce((t, r) => t + (r.invoice_status === "chua_thu" ? n0(r.invoice_amount) : 0), 0))}</td>
            </tr>
          ))}</tbody>
          <tfoot><tr><td>Cộng</td><td className="num">{all.length}</td>
            <td className="num">{total("chua_hd")}</td><td className="num">{total("thieu_cccd")}</td><td className="num">{total("chua_dien")}</td>
            <td className="num">{total("chua_chot")}</td><td className="num">{total("chua_thu")}</td><td className="num">{total("da_thu")}</td>
            <td className="num">{vnd(due - got)}</td></tr></tfoot>
        </table></div>

        <div className="chips" role="group" aria-label="Lọc phòng">
          <button className="chip" aria-pressed={!f} onClick={() => setF("")}>Cần xử lý</button>
          {MC_KEYS.map((k) => <button key={k} className="chip" aria-pressed={f === k} onClick={() => setF(f === k ? "" : k)}>{MC_LABEL[k]} ({total(k)})</button>)}
        </div>
        {shown.length === 0 ? <p className="muted" style={{ margin: 0 }}>Không có phòng nào ở mục này.</p> : (
          <div className="pg-card"><div className="dt-wrap"><table className="dt cards">
            <thead><tr><th>Phòng</th><th>Khách</th><th>Hoá đơn</th><th>Cần xử lý</th></tr></thead>
            <tbody>{shown.map((r) => {
              const is = issues(r);
              const first = MC_KEYS.find((k) => k !== "da_thu" && mcIs(r, k));
              return (
                <tr key={r.room_id}>
                  <td data-label="Phòng"><div className="t1">{r.building_code} · {r.room_code}</div>{r.contract_code ? <div className="t2">HĐ {r.contract_code}{r.contract_end ? ` · hết hạn ${ddmmyyyy(r.contract_end)}` : ""}</div> : null}</td>
                  <td data-label="Khách"><div className="t1">{r.tenant_name ?? <span className="muted">Chưa có hợp đồng</span>}</div>{r.contract_id ? <div className="t2">{r.occupants} người ở</div> : null}</td>
                  <td data-label="Hoá đơn"><div className="t1">{invLabel(r) || "—"}</div>{r.invoice_amount != null ? <div className="t2 num">{vnd(r.invoice_amount)}</div> : null}</td>
                  <td data-label="Cần xử lý"><div className="t1">{is.length ? is.join(", ") : <span className="muted">Xong</span>}</div>
                    {first ? <Link className="dt-link small" to={mcLink(r.building_id, first, r)}>Xử lý</Link> : null}</td>
                </tr>
              );
            })}</tbody>
          </table></div></div>
        )}
      </>)}
    </div>
  );
}

function invLabel(r: MCRow): string {
  if (!r.contract_id) return "";
  if (!r.invoice_id) return "Chưa có";
  if (r.invoice_status === "da_thu") return `Đã thu${r.collected_at ? ` ${ddmmyyyy(r.collected_at).slice(0, 5)}` : ""}`;
  return "Chưa thu";
}

function issues(r: MCRow): string[] {
  const out: string[] = [];
  if (mcIs(r, "chua_hd")) out.push("chưa có hợp đồng");
  if (mcIs(r, "thieu_cccd")) out.push(`thiếu CCCD ${r.cccd_missing}/${r.occupants} người`);
  if (mcIs(r, "chua_dien")) out.push(`chưa ghi điện tháng ${mmyyyy(r.meter_period)}`);
  if (mcIs(r, "chua_chot")) out.push(`chưa chốt: ${notClosedWhy(r)}`);
  if (mcIs(r, "chua_thu")) out.push("chưa thu tiền");
  return out;
}
