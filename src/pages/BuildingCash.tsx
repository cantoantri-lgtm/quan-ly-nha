import { useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { monthRange, rangeLabel, type DateRange } from "../lib/dates";
import { exportCashbook } from "../lib/cashbook";
import { useSession } from "../lib/session";
import { Combo, Empty, TopBar } from "../components/ui";
import Invoices from "./Invoices";
import BuildingExpenses from "./BuildingExpenses";
import BuildingIncomes from "./BuildingIncomes";

/** Thu & chi toà nhà: chọn toà, tab Thu (hoá đơn tiền phòng theo tháng) và tab Chi (chi phí toà, nhân viên ứng / công ty trả).
 *  Tiền cọc thu trong hợp đồng (DepositPanel, SQL 101); sổ thu chi tổng hợp ở Báo cáo. */
type Tab = "thu" | "thu_khac" | "chi";

export default function BuildingCash() {
  const { buildings, people, isManager, isAccountant, toast } = useSession();
  const [range, setRange] = useState<DateRange>(() => monthRange());   // mặc định trọn tháng này
  const [draft, setDraft] = useState<DateRange>(range);
  const bad = !draft.from || !draft.to || draft.to < draft.from;
  const apply = (r: DateRange) => { setDraft(r); if (r.from && r.to && r.to >= r.from) setRange(r); };
  const shiftMonth = (n: number) => { const [y, m] = range.from.split("-").map(Number); const d = new Date(Date.UTC(y, m - 1 + n, 1)); apply(monthRange(d.toISOString().slice(0, 10))); };
  const [busy, setBusy] = useState(false);
  const [qs, setQs] = useSearchParams();
  const bid = qs.get("toa") && buildings.some((b: { id: string }) => b.id === qs.get("toa")) ? qs.get("toa")! : buildings[0]?.id ?? "";
  const q = qs.get("tab");
  const tab: Tab = q === "chi" || q === "thu_khac" ? q : "thu";
  const set = (k: "toa" | "tab", v: string) => { const n = new URLSearchParams(qs); n.set(k, v); setQs(n, { replace: true }); };
  const fin = isManager || isAccountant;

  if (!buildings.length) return (<><TopBar title="Thu & chi toà nhà" /><main className="main"><Empty title="Bạn chưa được gán toà nào." /></main></>);
  async function exportXlsx() {
    const b = buildings.find((x: { id: string }) => x.id === bid);
    if (!b) return;
    setBusy(true);
    try {
      await exportCashbook(b, range, (u) => (u ? people.find((p: { id: string }) => p.id === u)?.full_name ?? "" : ""));
      toast("Đã tải file Excel sổ thu chi.");
    } catch (e) { toast(`Chưa xuất được: ${(e as Error).message}`); }
    setBusy(false);
  }
  const opts = buildings.map((b: { id: string; code: string; name: string }) => [b.id, `${b.code} · ${b.name}`] as const);
  return (
    <>
      <TopBar title="Thu & chi toà nhà" />
      <main className="main stack">
        <label className="field"><span>Toà nhà</span>
          <Combo id="tc-toa" value={bid} options={opts} onChange={(v) => set("toa", v)} label="Toà nhà" /></label>
        <div className="card stack" style={{ padding: 10, gap: 8 }}>
          <div className="row" style={{ gap: 8, alignItems: "flex-end" }}>
            <label className="field" style={{ flex: "1 1 140px", margin: 0 }}><span>Từ ngày</span>
              <input id="tc-from" className="input" type="date" value={draft.from} onChange={(e) => apply({ ...draft, from: e.target.value })} /></label>
            <label className="field" style={{ flex: "1 1 140px", margin: 0 }}><span>Đến ngày</span>
              <input id="tc-to" className="input" type="date" value={draft.to} min={draft.from || undefined} onChange={(e) => apply({ ...draft, to: e.target.value })} /></label>
            <button className="btn secondary" disabled={busy || bad} onClick={exportXlsx}>{busy ? "Đang tạo…" : "Tải Excel"}</button>
          </div>
          {bad ? <small style={{ color: "var(--danger)" }}>Ngày kết thúc phải sau hoặc bằng ngày bắt đầu.</small> : null}
          <div className="row" style={{ justifyContent: "space-between", flexWrap: "nowrap", gap: 6 }}>
            <button type="button" className="btn ghost sm" onClick={() => shiftMonth(-1)}>‹ Tháng trước</button>
            <b className="small" style={{ textAlign: "center" }}>Đang xem {rangeLabel(range)}</b>
            <button type="button" className="btn ghost sm" onClick={() => shiftMonth(1)}>Tháng sau ›</button>
          </div>
          {range.from !== monthRange().from || range.to !== monthRange().to ? (
            <button type="button" className="btn ghost sm" style={{ alignSelf: "center" }} onClick={() => apply(monthRange())}>Về tháng này</button>
          ) : null}
        </div>
        <div className="chips" role="tablist" aria-label="Thu hoặc chi">
          <button role="tab" className="chip" aria-selected={tab === "thu"} aria-pressed={tab === "thu"} onClick={() => set("tab", "thu")}>Thu tiền phòng</button>
          <button role="tab" className="chip" aria-selected={tab === "thu_khac"} aria-pressed={tab === "thu_khac"} onClick={() => set("tab", "thu_khac")}>Thu khác</button>
          <button role="tab" className="chip" aria-selected={tab === "chi"} aria-pressed={tab === "chi"} onClick={() => set("tab", "chi")}>Chi phí toà</button>
        </div>
        {tab === "thu" ? (
          <>
            <Invoices key={`thu-${bid}`} buildingId={bid} embedded range={range} />
            <p className="muted small" style={{ margin: 0 }}>Danh sách gồm hoá đơn của các tháng trong khoảng ngày, cộng hoá đơn tháng khác nhưng thu trong khoảng ngày.</p>
            <p className="muted small" style={{ margin: 0 }}>
              Tiền cọc: mở hợp đồng, bấm "Thu tiền cọc". Khoản phát sinh ngoài tiền phòng: tab Thu khác.
            </p>
          </>
        ) : tab === "thu_khac" ? (
          <BuildingIncomes key={`thukhac-${bid}`} buildingId={bid} embedded range={range} />
        ) : (
          <BuildingExpenses key={`chi-${bid}`} buildingId={bid} embedded range={range} />
        )}
        {fin ? <p className="muted small" style={{ margin: 0 }}>Tổng hợp thu, chi, lợi nhuận theo tháng: <Link to="/bao-cao?tab=so_thu_chi">Báo cáo → Sổ thu chi toà</Link>.</p> : null}
      </main>
    </>
  );
}
