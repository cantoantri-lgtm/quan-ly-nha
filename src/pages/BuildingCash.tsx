import { Link, useSearchParams } from "react-router-dom";
import { useSession } from "../lib/session";
import { Combo, Empty, TopBar } from "../components/ui";
import Invoices from "./Invoices";
import BuildingExpenses from "./BuildingExpenses";

/** Thu & chi toà nhà: chọn toà, tab Thu (hoá đơn tiền phòng theo tháng) và tab Chi (chi phí toà, nhân viên ứng / công ty trả).
 *  Khoản thu khác (cọc, phí phát sinh trên tài khoản khách) ở trang Thu tiền khách; sổ thu chi tổng hợp ở Báo cáo. */
type Tab = "thu" | "chi";

export default function BuildingCash() {
  const { buildings, isManager, isAccountant } = useSession();
  const [qs, setQs] = useSearchParams();
  const bid = qs.get("toa") && buildings.some((b: { id: string }) => b.id === qs.get("toa")) ? qs.get("toa")! : buildings[0]?.id ?? "";
  const tab: Tab = qs.get("tab") === "chi" ? "chi" : "thu";
  const set = (k: "toa" | "tab", v: string) => { const n = new URLSearchParams(qs); n.set(k, v); setQs(n, { replace: true }); };
  const fin = isManager || isAccountant;

  if (!buildings.length) return (<><TopBar title="Thu & chi toà nhà" /><main className="main"><Empty title="Bạn chưa được gán toà nào." /></main></>);
  const opts = buildings.map((b: { id: string; code: string; name: string }) => [b.id, `${b.code} · ${b.name}`] as const);
  return (
    <>
      <TopBar title="Thu & chi toà nhà" />
      <main className="main stack">
        <label className="field"><span>Toà nhà</span>
          <Combo id="tc-toa" value={bid} options={opts} onChange={(v) => set("toa", v)} label="Toà nhà" /></label>
        <div className="chips" role="tablist" aria-label="Thu hoặc chi">
          <button role="tab" className="chip" aria-selected={tab === "thu"} aria-pressed={tab === "thu"} onClick={() => set("tab", "thu")}>Thu tiền phòng</button>
          <button role="tab" className="chip" aria-selected={tab === "chi"} aria-pressed={tab === "chi"} onClick={() => set("tab", "chi")}>Chi phí toà</button>
        </div>
        {tab === "thu" ? (
          <>
            <Invoices key={`thu-${bid}`} buildingId={bid} embedded />
            <p className="muted small" style={{ margin: 0 }}>
              Tiền cọc và các khoản thu khác trên tài khoản khách: <Link to="/thu-tien-khach">Thu tiền khách</Link>.
            </p>
          </>
        ) : (
          <BuildingExpenses key={`chi-${bid}`} buildingId={bid} embedded />
        )}
        {fin ? <p className="muted small" style={{ margin: 0 }}>Tổng hợp thu, chi, lợi nhuận theo tháng: <Link to="/bao-cao?tab=so_thu_chi">Báo cáo → Sổ thu chi toà</Link>.</p> : null}
      </main>
    </>
  );
}
