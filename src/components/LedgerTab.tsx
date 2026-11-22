import { useEffect, useMemo, useState } from "react";
import { friendlyError, supabase } from "../lib/supabase";
import { useSession } from "../lib/session";
import { vnd } from "../lib/money";
import { Combo, Empty } from "./ui";
import { EXPENSE_ROWS, INCOME_CATS } from "../lib/expense";
import { saveWorkbook } from "../lib/xlsx";

/** Sổ thu chi toà (theo file SỔ ĐẦU TƯ LTR): báo cáo tổng theo tháng (Thu / Chi theo khoản, Lợi nhuận) + sổ chi tiết.
 *  Số liệu từ SQL 090 building_ledger: hoá đơn đã thu tách theo khoản, khoản thu khách, thuê đêm,
 *  chi nhập tay, ĐNTT / tạm ứng đã duyệt gắn toà, tiền thuê nhà. Chỉ Quản lý, Kế toán. */
type L = { d: string; side: "thu" | "chi"; category: string; content: string; amount: number; source: string; ref: string | null;
  building_id: string; building_code: string; room_code: string | null };

const n0 = (x: number | string | null | undefined) => Number(x ?? 0);
const dm = (d: string) => `${d.slice(8, 10)}/${d.slice(5, 7)}`;
function monthsOf(from: string, to: string) {
  const out: string[] = [];
  let y = Number(from.slice(0, 4)), m = Number(from.slice(5, 7));
  const ey = Number(to.slice(0, 4)), em = Number(to.slice(5, 7));
  while (y < ey || (y === ey && m <= em)) { out.push(`${y}-${String(m).padStart(2, "0")}`); m++; if (m > 12) { m = 1; y++; } }
  return out;
}
const mLabel = (ym: string) => `T${ym.slice(5, 7)}/${ym.slice(2, 4)}`;
/** Ô 0 đ hiện "–" cho dễ đọc */
const cell = (v: number) => (v ? vnd(v) : "–");

export default function LedgerTab({ from, to }: { from: string; to: string }) {
  const { buildings, toast } = useSession();
  const [bid, setBid] = useState("");
  const [rows, setRows] = useState<L[] | null>(null);
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);
  const [showAll, setShowAll] = useState(false);

  useEffect(() => {
    setRows(null); setErr("");
    supabase.rpc("building_ledger", { p_building: bid || null, p_from: from, p_to: to }).then(({ data, error }) => {
      if (error) setErr(friendlyError(error)); else setRows(((data as L[]) ?? []).map((r) => ({ ...r, amount: n0(r.amount) })));
    });
  }, [bid, from, to]);

  const months = useMemo(() => monthsOf(from, to), [from, to]);
  const sum = useMemo(() => {
    const m = new Map<string, number>();   // khoá "thu|Điện|2026-11"
    for (const r of rows ?? []) {
      const k = `${r.side}|${r.category}|${r.d.slice(0, 7)}`;
      m.set(k, (m.get(k) ?? 0) + r.amount);
    }
    const get = (side: string, cat: string, ym?: string) =>
      ym ? m.get(`${side}|${cat}|${ym}`) ?? 0 : months.reduce((t, x) => t + (m.get(`${side}|${cat}|${x}`) ?? 0), 0);
    const extraChi = [...new Set((rows ?? []).filter((r) => r.side === "chi" && !(EXPENSE_ROWS as readonly string[]).includes(r.category)).map((r) => r.category))];
    const extraThu = [...new Set((rows ?? []).filter((r) => r.side === "thu" && r.category !== "Tiền cọc" && !(INCOME_CATS as readonly string[]).includes(r.category)).map((r) => r.category))];
    const thuCats = [...INCOME_CATS, ...extraThu];
    const chiCats = [...EXPENSE_ROWS, ...extraChi];
    const col = (side: "thu" | "chi", cats: string[], ym?: string) => cats.reduce((t, c) => t + get(side, c, ym), 0);
    return { get, thuCats, chiCats, col };
  }, [rows, months]);

  const bname = bid ? buildings.find((b: { id: string }) => b.id === bid)?.code ?? "" : "Tất cả toà";
  const totThu = sum.col("thu", sum.thuCats), totChi = sum.col("chi", sum.chiCats), coc = sum.get("thu", "Tiền cọc");
  const ledger = rows ?? [];
  const shown = showAll ? ledger : ledger.slice(-60);

  async function download() {
    if (!rows) return;
    setBusy(true);
    try {
      const { Workbook } = await import("exceljs");
      const wb = new Workbook();
      const money = { numFmt: "#,##0" };
      // Sheet 1: Báo cáo tổng
      const a = wb.addWorksheet("BÁO CÁO TỔNG");
      a.addRow([`BÁO CÁO TỔNG HỢP ${bname}`]).font = { bold: true, size: 14 };
      a.addRow([`Từ ${from.split("-").reverse().join("/")} đến ${to.split("-").reverse().join("/")}`]);
      const head = a.addRow(["", "", ...months.map(mLabel), "TỔNG"]); head.font = { bold: true };
      const line = (code: string, name: string, vals: number[], bold = false) => {
        const r = a.addRow([code, name, ...vals, vals.reduce((t, v) => t + v, 0)]);
        if (bold) r.font = { bold: true };
      };
      line("A", "THU", months.map((m) => sum.col("thu", sum.thuCats, m)), true);
      sum.thuCats.forEach((c) => line("", c, months.map((m) => sum.get("thu", c, m))));
      line("B", "CHI", months.map((m) => sum.col("chi", sum.chiCats, m)), true);
      sum.chiCats.forEach((c) => line("", c, months.map((m) => sum.get("chi", c, m))));
      line("C", "LỢI NHUẬN", months.map((m) => sum.col("thu", sum.thuCats, m) - sum.col("chi", sum.chiCats, m)), true);
      if (coc) line("", "Tiền cọc đã thu (không tính lợi nhuận)", months.map((m) => sum.get("thu", "Tiền cọc", m)));
      for (let i = 1; i <= months.length + 3; i++) {
        const c = a.getColumn(i);
        c.width = i === 1 ? 5 : i === 2 ? 36 : 15;
        if (i >= 3) c.numFmt = money.numFmt;
      }
      // Sheet 2: Sổ thu chi chi tiết
      const b = wb.addWorksheet("SỔ THU CHI");
      b.columns = [
        { header: "Ngày", width: 12 }, { header: "Toà", width: 10 }, { header: "Phòng", width: 8 }, { header: "Khoản", width: 20 },
        { header: "Nội dung", width: 40 }, { header: "Thu", width: 14, style: money }, { header: "Chi", width: 14, style: money },
        { header: "Chứng từ / mã GD", width: 22, style: { numFmt: "@" } }, { header: "Nguồn", width: 22 },
      ];
      b.getRow(1).font = { bold: true };
      for (const r of rows) {
        b.addRow([r.d.split("-").reverse().join("/"), r.building_code, r.room_code ?? "", r.category, r.content,
          r.side === "thu" ? r.amount : null, r.side === "chi" ? r.amount : null, r.ref ?? "", r.source]);
      }
      const t = b.addRow(["", "", "", "", "Cộng", rows.filter((r) => r.side === "thu").reduce((s, r) => s + r.amount, 0),
        rows.filter((r) => r.side === "chi").reduce((s, r) => s + r.amount, 0), "", ""]);
      t.font = { bold: true };
      b.views = [{ state: "frozen", ySplit: 1 }];
      await saveWorkbook(wb, `So-thu-chi_${bid ? bname : "tat-ca"}_${from}_${to}.xlsx`);
    } catch (e) { toast((e as Error).message); }
    setBusy(false);
  }

  const bOpts = [["", "Tất cả toà"] as const, ...buildings.map((b: { id: string; code: string; name: string }) => [b.id, `${b.code} · ${b.name}`] as const)];
  return (
    <>
      <div className="row" style={{ flexWrap: "nowrap", gap: 8, alignItems: "flex-end" }}>
        <label className="field" style={{ flex: 1 }}><span>Toà nhà</span>
          <Combo id="ld-b" value={bid} options={bOpts} onChange={setBid} label="Toà nhà" /></label>
        <button className="btn secondary sm" style={{ marginBottom: 2 }} disabled={busy || !rows?.length} onClick={download}>{busy ? "Đang tạo…" : "Tải Excel"}</button>
      </div>
      {err ? <div className="error-box" role="alert">{err}</div> : null}
      {rows === null && !err ? <div className="loading">Đang tải…</div> : null}
      {rows && !rows.length ? <Empty title="Không có khoản thu chi nào trong khoảng ngày này" /> : null}
      {rows && rows.length ? (
        <>
          <div className="rpt-kpis">
            <div className="rpt-kpi"><b className={totThu - totChi < 0 ? "neg" : ""}>{vnd(totThu - totChi)}</b><span>Lợi nhuận · {bname}</span></div>
            <div className="rpt-kpi"><b>{vnd(totThu)}</b><span>Thu (chi {vnd(totChi)})</span></div>
          </div>
          <div className="rpt-wrap"><table className="rpt">
            <thead><tr><th>Khoản</th>{months.map((m) => <th key={m}>{mLabel(m)}</th>)}{months.length > 1 ? <th>Tổng</th> : null}</tr></thead>
            <tbody>
              <tr><td><b>A. THU</b></td>{months.map((m) => <td key={m}><b>{vnd(sum.col("thu", sum.thuCats, m))}</b></td>)}{months.length > 1 ? <td><b>{vnd(totThu)}</b></td> : null}</tr>
              {sum.thuCats.map((c) => (
                <tr key={`t-${c}`}><td style={{ paddingLeft: 18 }}>{c}</td>{months.map((m) => <td key={m}>{cell(sum.get("thu", c, m))}</td>)}{months.length > 1 ? <td>{cell(sum.get("thu", c))}</td> : null}</tr>
              ))}
              <tr><td><b>B. CHI</b></td>{months.map((m) => <td key={m}><b>{vnd(sum.col("chi", sum.chiCats, m))}</b></td>)}{months.length > 1 ? <td><b>{vnd(totChi)}</b></td> : null}</tr>
              {sum.chiCats.map((c) => (
                <tr key={`c-${c}`}><td style={{ paddingLeft: 18 }}>{c}</td>{months.map((m) => <td key={m}>{cell(sum.get("chi", c, m))}</td>)}{months.length > 1 ? <td>{cell(sum.get("chi", c))}</td> : null}</tr>
              ))}
            </tbody>
            <tfoot>
              <tr><td>C. LỢI NHUẬN</td>{months.map((m) => { const v = sum.col("thu", sum.thuCats, m) - sum.col("chi", sum.chiCats, m); return <td key={m} className={v < 0 ? "neg" : ""}>{vnd(v)}</td>; })}
                {months.length > 1 ? <td className={totThu - totChi < 0 ? "neg" : ""}>{vnd(totThu - totChi)}</td> : null}</tr>
            </tfoot>
          </table></div>
          {coc ? <p className="muted small" style={{ margin: 0 }}>Tiền cọc đã thu {vnd(coc)}: không tính vào lợi nhuận.</p> : null}

          <b style={{ marginTop: 6 }}>Sổ thu chi chi tiết ({ledger.length} dòng)</b>
          <div className="rpt-wrap"><table className="rpt">
            <thead><tr><th>Ngày · khoản</th><th>Thu</th><th>Chi</th><th>Chứng từ</th></tr></thead>
            <tbody>{shown.map((r, i) => (
              <tr key={i}>
                <td style={{ minWidth: 190 }}>
                  <span className="muted">{dm(r.d)}{bid ? "" : ` · ${r.building_code}`}{r.room_code ? ` · P.${r.room_code}` : ""}</span><br />
                  <b>{r.category}</b> · {r.content}<br /><small className="muted">{r.source}</small>
                </td>
                <td>{r.side === "thu" ? vnd(r.amount) : ""}</td>
                <td>{r.side === "chi" ? vnd(r.amount) : ""}</td>
                <td style={{ fontSize: 12 }}>{r.ref ?? ""}</td>
              </tr>
            ))}</tbody>
          </table></div>
          {ledger.length > shown.length ? <button className="btn ghost sm" onClick={() => setShowAll(true)}>Xem cả {ledger.length} dòng</button> : null}
          <p className="muted small" style={{ margin: 0 }}>
            Thu: hoá đơn tiền phòng đã thu (tách tiền phòng, điện, nước, dịch vụ, xe), khoản thu khách, thuê đêm. Chi: khoản nhập ở "Chi phí & thuê nhà",
            đề nghị thanh toán và tạm ứng đã duyệt có gắn toà (chọn "Khoản chi của toà" khi lập), tiền thuê nhà theo tháng.
          </p>
        </>
      ) : null}
    </>
  );
}
