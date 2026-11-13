import { useCallback, useEffect, useMemo, useState, type FormEvent } from "react";
import { friendlyError, supabase } from "../lib/supabase";
import { useSession } from "../lib/session";
import { todayVN } from "../lib/dates";
import { parseMoney, vnd } from "../lib/money";
import { Empty, Sheet, TopBar } from "../components/ui";
import "../reports.css";

type Tab = "thu_chi" | "lap_day" | "phan_anh" | "loi_nhuan" | "chi_phi";
type Group = "toa" | "nhan_vien" | "lead";
const GROUPS: { k: Group; t: string }[] = [{ k: "toa", t: "Toà nhà" }, { k: "nhan_vien", t: "Nhân viên" }, { k: "lead", t: "Lead Sale" }];
const n0 = (x: number | string | null | undefined) => Number(x ?? 0);
const pct = (a: number, b: number) => (b > 0 ? Math.round((a / b) * 1000) / 10 : 0);
const dmy = (d: string) => `${d.slice(8, 10)}/${d.slice(5, 7)}/${d.slice(0, 4)}`;
const monthStart = (iso: string) => iso.slice(0, 7) + "-01";

type CF = { grp_key: string; grp_name: string; tien_phong: number; phieu_thu: number; doanh_thu_dem: number; tien_coc: number; chi: number; thu: number; rong: number };
type Occ = { building_id: string; building_name: string; rooms: number; dang_o: number; trong: number; dang_sua: number; giu_cho: number; room_days: number; occupied_days: number };
type FB = { grp_key: string; grp_name: string; total: number; cho_cong_ty: number; cho_khach: number; da_dong: number; chua_tra_loi: number; avg_reply_hours: number | null };
type PR = { building_id: string; building_name: string; thu: number; chi: number; thue_nha: number; loi_nhuan: number; tien_coc: number };

export default function Reports() {
  const { isManager } = useSession();
  const [tab, setTab] = useState<Tab>("thu_chi");
  const [from, setFrom] = useState(() => monthStart(todayVN()));
  const [to, setTo] = useState(() => todayVN());
  const [group, setGroup] = useState<Group>("toa");
  const tabs: { k: Tab; t: string }[] = [
    { k: "thu_chi", t: "Thu chi" }, { k: "lap_day", t: "Lấp đầy" }, { k: "phan_anh", t: "Phản ánh" },
    ...(isManager ? [{ k: "loi_nhuan" as Tab, t: "Lợi nhuận" }, { k: "chi_phi" as Tab, t: "Chi phí & thuê nhà" }] : []),
  ];
  const range = tab !== "chi_phi";
  return (
    <>
      <TopBar title="Báo cáo" />
      <main className="main stack">
        <div className="chips" role="tablist" aria-label="Loại báo cáo">
          {tabs.map((x) => <button key={x.k} role="tab" className="chip" aria-pressed={tab === x.k} aria-selected={tab === x.k} onClick={() => setTab(x.k)}>{x.t}</button>)}
        </div>
        {range ? (
          <div className="row" style={{ flexWrap: "nowrap", gap: 8 }}>
            <label className="field" style={{ flex: 1 }}><span>Từ ngày</span><input className="input" type="date" value={from} max={to} onChange={(e) => setFrom(e.target.value)} /></label>
            <label className="field" style={{ flex: 1 }}><span>Đến ngày</span><input className="input" type="date" value={to} min={from} onChange={(e) => setTo(e.target.value)} /></label>
          </div>
        ) : null}
        {(tab === "thu_chi" || tab === "phan_anh") ? (
          <div className="chips" role="group" aria-label="Nhóm theo">
            {GROUPS.map((g) => <button key={g.k} className="chip" aria-pressed={group === g.k} onClick={() => setGroup(g.k)}>Theo {g.t.toLowerCase()}</button>)}
          </div>
        ) : null}
        {tab === "thu_chi" ? <CashTab from={from} to={to} group={group} isManager={isManager} /> : null}
        {tab === "lap_day" ? <OccTab from={from} to={to} /> : null}
        {tab === "phan_anh" ? <FbTab from={from} to={to} group={group} /> : null}
        {tab === "loi_nhuan" && isManager ? <ProfitTab from={from} to={to} /> : null}
        {tab === "chi_phi" && isManager ? <CostTab /> : null}
      </main>
    </>
  );
}

function useRpc<T>(fn: string, args: Record<string, unknown>) {
  const [rows, setRows] = useState<T[] | null>(null);
  const [err, setErr] = useState("");
  const key = JSON.stringify(args);
  useEffect(() => {
    let stop = false;
    setRows(null); setErr("");
    supabase.rpc(fn, args).then(({ data, error }) => {
      if (stop) return;
      if (error) { setErr(friendlyError(error)); setRows([]); } else setRows((data as T[]) ?? []);
    });
    return () => { stop = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fn, key]);
  return { rows, err };
}

function Status({ rows, err }: { rows: unknown[] | null; err: string }) {
  if (rows === null) return <div className="loading">Đang tính…</div>;
  if (err) return <div className="error-box" role="alert">{err}</div>;
  if (!rows.length) return <Empty title="Không có số liệu trong khoảng ngày này" />;
  return null;
}

function Money({ v, neg }: { v: number; neg?: boolean }) {
  return <span className={neg && v < 0 ? "neg num" : "num"}>{vnd(v)}</span>;
}

function CashTab({ from, to, group, isManager }: { from: string; to: string; group: Group; isManager: boolean }) {
  const { rows, err } = useRpc<CF>("report_cashflow", { p_from: from, p_to: to, p_group: group });
  const sum = useMemo(() => {
    const s = { tp: 0, pt: 0, dem: 0, coc: 0, chi: 0, thu: 0, rong: 0 };
    (rows ?? []).forEach((r) => { s.tp += n0(r.tien_phong); s.pt += n0(r.phieu_thu); s.dem += n0(r.doanh_thu_dem); s.coc += n0(r.tien_coc); s.chi += n0(r.chi); s.thu += n0(r.thu); s.rong += n0(r.rong); });
    return s;
  }, [rows]);
  return (
    <>
      <div className="rpt-kpis">
        <div className="rpt-kpi"><b>{vnd(sum.thu)}</b><span>Tổng thu (không gồm cọc)</span></div>
        {isManager ? <div className="rpt-kpi"><b>{vnd(sum.chi)}</b><span>Tổng chi</span></div> : <div className="rpt-kpi"><b>{vnd(sum.coc)}</b><span>Tiền cọc đã thu</span></div>}
      </div>
      <Status rows={rows} err={err} />
      {rows && rows.length ? (
        <div className="rpt-wrap"><table className="rpt">
          <thead><tr><th>{GROUPS.find((g) => g.k === group)!.t}</th><th>Tiền phòng</th><th>Phiếu thu</th><th>Thuê đêm</th><th>Thu</th>{isManager ? <><th>Chi</th><th>Thu - chi</th></> : null}<th>Cọc (riêng)</th></tr></thead>
          <tbody>{rows.map((r) => (
            <tr key={r.grp_key}><td>{r.grp_name}</td><td><Money v={n0(r.tien_phong)} /></td><td><Money v={n0(r.phieu_thu)} /></td><td><Money v={n0(r.doanh_thu_dem)} /></td>
              <td><b><Money v={n0(r.thu)} /></b></td>{isManager ? <><td><Money v={n0(r.chi)} /></td><td><Money v={n0(r.rong)} neg /></td></> : null}<td><Money v={n0(r.tien_coc)} /></td></tr>
          ))}</tbody>
          <tfoot><tr><td>Cộng</td><td><Money v={sum.tp} /></td><td><Money v={sum.pt} /></td><td><Money v={sum.dem} /></td><td><Money v={sum.thu} /></td>{isManager ? <><td><Money v={sum.chi} /></td><td><Money v={sum.rong} neg /></td></> : null}<td><Money v={sum.coc} /></td></tr></tfoot>
        </table></div>
      ) : null}
      <p className="muted small" style={{ margin: 0 }}>
        Tính theo ngày thu: hoá đơn tiền phòng (ngày đánh dấu đã thu), phiếu thu khách (ngày xác nhận), doanh thu thuê đêm. Tiền cọc hiện riêng, không cộng vào Thu.
        {group === "toa" ? "" : " Người thu là người bấm xác nhận; tiền về tự động qua SePay xếp vào “chưa rõ người”."}
        {group === "lead" ? " Lead Sale = Trưởng nhóm cùng bộ phận trong Sơ đồ công ty." : ""}
        {isManager && group !== "toa" ? " Chi tính cho người nhập khoản chi." : ""}
      </p>
    </>
  );
}

function OccTab({ from, to }: { from: string; to: string }) {
  const { rows, err } = useRpc<Occ>("report_occupancy", { p_from: from, p_to: to });
  const t = useMemo(() => {
    const s = { rooms: 0, o: 0, rd: 0, od: 0 };
    (rows ?? []).forEach((r) => { s.rooms += r.rooms; s.o += r.dang_o; s.rd += r.room_days; s.od += r.occupied_days; });
    return s;
  }, [rows]);
  return (
    <>
      <div className="rpt-kpis">
        <div className="rpt-kpi"><b>{pct(t.o, t.rooms)}%</b><span>Lấp đầy hôm nay ({t.o}/{t.rooms} phòng)</span></div>
        <div className="rpt-kpi"><b>{pct(t.od, t.rd)}%</b><span>Lấp đầy trong kỳ ({dmy(from)} - {dmy(to)})</span></div>
      </div>
      <Status rows={rows} err={err} />
      {rows && rows.length ? (
        <div className="rpt-wrap"><table className="rpt">
          <thead><tr><th>Toà nhà</th><th>Phòng</th><th>Đang ở</th><th>Trống</th><th>Sửa / giữ</th><th>Hôm nay</th><th>Trong kỳ</th></tr></thead>
          <tbody>{rows.map((r) => {
            const now = pct(r.dang_o, r.rooms), per = pct(r.occupied_days, r.room_days);
            return (
              <tr key={r.building_id}><td>{r.building_name}</td><td className="num">{r.rooms}</td><td className="num">{r.dang_o}</td><td className="num">{r.trong}</td><td className="num">{r.dang_sua} / {r.giu_cho}</td>
                <td><b className="num">{now}%</b></td>
                <td><div className="rpt-bar" aria-hidden="true"><i style={{ width: `${Math.min(100, per)}%` }} /></div><b className="num">{per}%</b></td></tr>
            );
          })}</tbody>
          <tfoot><tr><td>Cộng</td><td className="num">{t.rooms}</td><td className="num">{t.o}</td><td /><td /><td className="num">{pct(t.o, t.rooms)}%</td><td className="num">{pct(t.od, t.rd)}%</td></tr></tfoot>
        </table></div>
      ) : null}
      <p className="muted small" style={{ margin: 0 }}>Chỉ tính phòng thuê theo tháng. “Hôm nay” theo trạng thái phòng (Đang ở). “Trong kỳ” = số ngày phòng có hợp đồng chia tổng số ngày phòng, tính theo ngày bắt đầu và kết thúc hợp đồng.</p>
    </>
  );
}

function FbTab({ from, to, group }: { from: string; to: string; group: Group }) {
  const { rows, err } = useRpc<FB>("report_feedback", { p_from: from, p_to: to, p_group: group });
  const t = useMemo(() => {
    const s = { total: 0, open: 0, wait: 0, closed: 0, none: 0 };
    (rows ?? []).forEach((r) => { s.total += r.total; s.open += r.cho_cong_ty; s.wait += r.cho_khach; s.closed += r.da_dong; s.none += r.chua_tra_loi; });
    return s;
  }, [rows]);
  return (
    <>
      <div className="rpt-kpis">
        <div className="rpt-kpi"><b>{t.total}</b><span>Phản ánh trong kỳ</span></div>
        <div className="rpt-kpi"><b className={t.none ? "neg" : ""}>{t.none}</b><span>Chưa ai trả lời</span></div>
      </div>
      <Status rows={rows} err={err} />
      {rows && rows.length ? (
        <div className="rpt-wrap"><table className="rpt">
          <thead><tr><th>{group === "toa" ? "Toà nhà" : group === "lead" ? "Lead Sale (người trả lời đầu)" : "Nhân viên (trả lời đầu)"}</th><th>Tổng</th><th>Chờ công ty</th><th>Chờ khách</th><th>Đã đóng</th><th>Chưa trả lời</th><th>Trả lời TB (giờ)</th></tr></thead>
          <tbody>{rows.map((r) => (
            <tr key={r.grp_key}><td>{r.grp_name}</td><td><b className="num">{r.total}</b></td><td className="num">{r.cho_cong_ty}</td><td className="num">{r.cho_khach}</td><td className="num">{r.da_dong}</td>
              <td className={r.chua_tra_loi ? "neg num" : "num"}>{r.chua_tra_loi}</td><td className="num">{r.avg_reply_hours ?? "—"}</td></tr>
          ))}</tbody>
          <tfoot><tr><td>Cộng</td><td className="num">{t.total}</td><td className="num">{t.open}</td><td className="num">{t.wait}</td><td className="num">{t.closed}</td><td className="num">{t.none}</td><td /></tr></tfoot>
        </table></div>
      ) : null}
      <p className="muted small" style={{ margin: 0 }}>Tính phản ánh tạo trong kỳ. Theo nhân viên / lead là người trả lời đầu tiên của phản ánh đó. Phản ánh của Cộng tác viên không gắn toà.</p>
    </>
  );
}

function ProfitTab({ from, to }: { from: string; to: string }) {
  const { rows, err } = useRpc<PR>("report_profit", { p_from: from, p_to: to });
  const t = useMemo(() => {
    const s = { thu: 0, chi: 0, thue: 0, ln: 0, coc: 0 };
    (rows ?? []).forEach((r) => { s.thu += n0(r.thu); s.chi += n0(r.chi); s.thue += n0(r.thue_nha); s.ln += n0(r.loi_nhuan); s.coc += n0(r.tien_coc); });
    return s;
  }, [rows]);
  return (
    <>
      <div className="rpt-kpis">
        <div className="rpt-kpi"><b className={t.ln < 0 ? "neg" : ""}>{vnd(t.ln)}</b><span>Lợi nhuận (đã trừ chi và tiền thuê nhà)</span></div>
        <div className="rpt-kpi"><b>{vnd(t.coc)}</b><span>Tiền cọc đã thu (không tính lợi nhuận)</span></div>
      </div>
      <Status rows={rows} err={err} />
      {rows && rows.length ? (
        <div className="rpt-wrap"><table className="rpt">
          <thead><tr><th>Toà nhà</th><th>Thu</th><th>Chi</th><th>Thuê nhà</th><th>Lợi nhuận</th></tr></thead>
          <tbody>{rows.map((r) => (
            <tr key={r.building_id}><td>{r.building_name}</td><td><Money v={n0(r.thu)} /></td><td><Money v={n0(r.chi)} /></td><td><Money v={n0(r.thue_nha)} /></td><td><b><Money v={n0(r.loi_nhuan)} neg /></b></td></tr>
          ))}</tbody>
          <tfoot><tr><td>Cộng</td><td><Money v={t.thu} /></td><td><Money v={t.chi} /></td><td><Money v={t.thue} /></td><td><Money v={t.ln} neg /></td></tr></tfoot>
        </table></div>
      ) : null}
      <p className="muted small" style={{ margin: 0 }}>Lợi nhuận = Thu (tiền phòng, phiếu thu, thuê đêm; không gồm tiền cọc) - Chi - Tiền thuê nhà. Tiền thuê nhà chia theo số ngày của kỳ trong từng tháng. Toà chưa nhập tiền thuê nhà được tính 0, hãy nhập ở mục “Chi phí & thuê nhà”.</p>
    </>
  );
}

type Exp = { id: string; building_id: string; spent_on: string; category: string; amount: number; note: string | null };
type Rent = { id: string; building_id: string; effective_from: string; monthly_rent: number; note: string | null };
const CATS = ["Điện", "Nước", "Internet", "Sửa chữa", "Vệ sinh", "Nhân sự", "Quảng cáo", "Khác"];

function CostTab() {
  const { buildings, toast } = useSession();
  const [exps, setExps] = useState<Exp[]>([]);
  const [rents, setRents] = useState<Rent[]>([]);
  const [month, setMonth] = useState(() => monthStart(todayVN()));
  const [sheet, setSheet] = useState<"exp" | "rent" | null>(null);
  const [editE, setEditE] = useState<Exp | null>(null);
  const [editR, setEditR] = useState<Rent | null>(null);
  const bname = (id: string) => buildings.find((b) => b.id === id)?.code ?? "?";

  const load = useCallback(async () => {
    const next = new Date(Number(month.slice(0, 4)), Number(month.slice(5, 7)), 1);
    const end = `${next.getFullYear()}-${String(next.getMonth() + 1).padStart(2, "0")}-01`;
    const [e, r] = await Promise.all([
      supabase.from("building_expenses").select("id,building_id,spent_on,category,amount,note").gte("spent_on", month).lt("spent_on", end).order("spent_on", { ascending: false }),
      supabase.from("building_rents").select("id,building_id,effective_from,monthly_rent,note").order("effective_from", { ascending: false }),
    ]);
    setExps((e.data as Exp[]) ?? []); setRents((r.data as Rent[]) ?? []);
  }, [month]);
  useEffect(() => { load(); }, [load]);

  const shift = (n: number) => { const d = new Date(Number(month.slice(0, 4)), Number(month.slice(5, 7)) - 1 + n, 1); setMonth(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-01`); };
  const curRent = (bid: string) => rents.find((r) => r.building_id === bid && r.effective_from <= todayVN());
  async function delExp(x: Exp) {
    if (!window.confirm(`Xoá khoản chi ${vnd(x.amount)} của toà ${bname(x.building_id)}?`)) return;
    const { error } = await supabase.rpc("expense_delete", { p_id: x.id });
    if (error) toast(friendlyError(error)); else { toast("Đã xoá."); load(); }
  }
  async function delRent(x: Rent) {
    if (!window.confirm(`Xoá mức thuê ${vnd(x.monthly_rent)} từ ${x.effective_from.slice(5, 7)}/${x.effective_from.slice(0, 4)}?`)) return;
    const { error } = await supabase.rpc("rent_delete", { p_id: x.id });
    if (error) toast(friendlyError(error)); else { toast("Đã xoá."); load(); }
  }
  const total = exps.reduce((s, x) => s + n0(x.amount), 0);

  return (
    <>
      <section className="card stack" style={{ padding: 14 }}>
        <div className="row" style={{ justifyContent: "space-between", flexWrap: "nowrap" }}>
          <b>Tiền thuê nhà mỗi tháng</b>
          <button className="btn sm" onClick={() => { setEditR(null); setSheet("rent"); }}>+ Nhập tiền thuê</button>
        </div>
        <p className="muted small" style={{ margin: 0 }}>Số tiền công ty trả chủ nhà mỗi tháng cho từng toà, áp dụng từ tháng được chọn đến khi nhập mức mới.</p>
        {buildings.map((b) => {
          const list = rents.filter((r) => r.building_id === b.id);
          const c = curRent(b.id);
          return (
            <div key={b.id} style={{ borderTop: "1px solid var(--line)", paddingTop: 8 }}>
              <div className="row small" style={{ justifyContent: "space-between", flexWrap: "nowrap" }}>
                <b>{b.code}</b>{c ? <span>Hiện tại <b className="num">{vnd(c.monthly_rent)}</b>/tháng</span> : <span className="neg" style={{ color: "var(--danger)" }}>Chưa nhập</span>}
              </div>
              {list.map((r) => (
                <div key={r.id} className="row small muted" style={{ justifyContent: "space-between", flexWrap: "nowrap", marginTop: 4 }}>
                  <span>Từ {r.effective_from.slice(5, 7)}/{r.effective_from.slice(0, 4)}: <span className="num">{vnd(r.monthly_rent)}</span>{r.note ? ` · ${r.note}` : ""}</span>
                  <span className="row" style={{ gap: 6, flexWrap: "nowrap" }}>
                    <button className="btn ghost sm" onClick={() => { setEditR(r); setSheet("rent"); }}>Sửa</button>
                    <button className="btn ghost sm" onClick={() => delRent(r)}>Xoá</button>
                  </span>
                </div>
              ))}
            </div>
          );
        })}
      </section>

      <section className="card stack" style={{ padding: 14 }}>
        <div className="row" style={{ justifyContent: "space-between", flexWrap: "nowrap" }}>
          <b>Chi phí theo toà</b>
          <button className="btn sm" onClick={() => { setEditE(null); setSheet("exp"); }}>+ Nhập khoản chi</button>
        </div>
        <div className="row" style={{ justifyContent: "space-between", flexWrap: "nowrap" }}>
          <button className="btn ghost sm" onClick={() => shift(-1)} aria-label="Tháng trước">‹ Trước</button>
          <b>Tháng {Number(month.slice(5, 7))}/{month.slice(0, 4)} · <span className="num">{vnd(total)}</span></b>
          <button className="btn ghost sm" onClick={() => shift(1)} aria-label="Tháng sau">Sau ›</button>
        </div>
        {!exps.length ? <p className="muted small" style={{ margin: 0 }}>Tháng này chưa có khoản chi.</p> : null}
        {exps.map((x) => (
          <div key={x.id} className="row small" style={{ justifyContent: "space-between", flexWrap: "nowrap", gap: 8, borderTop: "1px solid var(--line)", paddingTop: 8 }}>
            <span style={{ minWidth: 0 }}><b>{bname(x.building_id)}</b> · {x.category} · {dmy(x.spent_on).slice(0, 5)}{x.note ? <span className="muted"> · {x.note}</span> : null}</span>
            <span className="row" style={{ gap: 6, flexWrap: "nowrap" }}>
              <b className="num">{vnd(x.amount)}</b>
              <button className="btn ghost sm" onClick={() => { setEditE(x); setSheet("exp"); }}>Sửa</button>
              <button className="btn ghost sm" onClick={() => delExp(x)}>Xoá</button>
            </span>
          </div>
        ))}
      </section>
      <ExpSheet open={sheet === "exp"} item={editE} onClose={() => setSheet(null)} onDone={() => { setSheet(null); load(); }} />
      <RentSheet open={sheet === "rent"} item={editR} onClose={() => setSheet(null)} onDone={() => { setSheet(null); load(); }} />
    </>
  );
}

function ExpSheet({ open, item, onClose, onDone }: { open: boolean; item: Exp | null; onClose: () => void; onDone: () => void }) {
  const { buildings, toast } = useSession();
  const [f, setF] = useState({ b: "", d: todayVN(), c: "Điện", amt: "", note: "" });
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    if (!open) return;
    setF(item ? { b: item.building_id, d: item.spent_on, c: item.category, amt: String(item.amount), note: item.note ?? "" } : { b: buildings[0]?.id ?? "", d: todayVN(), c: "Điện", amt: "", note: "" });
  }, [open, item, buildings]);
  async function submit(e: FormEvent) {
    e.preventDefault();
    const a = parseMoney(f.amt);
    if (!f.b) { toast("Chọn toà nhà."); return; }
    if (!a || a <= 0) { toast("Nhập số tiền chi."); return; }
    setBusy(true);
    const { error } = await supabase.rpc("expense_save", { p_id: item?.id ?? null, p_building: f.b, p_date: f.d, p_category: f.c, p_amount: a, p_note: f.note });
    setBusy(false);
    if (error) { toast(friendlyError(error)); return; }
    toast("Đã lưu khoản chi."); onDone();
  }
  return (
    <Sheet open={open} onClose={onClose} title={item ? "Sửa khoản chi" : "Nhập khoản chi"}>
      <form className="stack" onSubmit={submit}>
        <label className="field"><span>Toà nhà *</span>
          <select className="input" value={f.b} onChange={(e) => setF({ ...f, b: e.target.value })}>{buildings.map((b) => <option key={b.id} value={b.id}>{b.code} · {b.name}</option>)}</select></label>
        <div className="row" style={{ flexWrap: "nowrap", gap: 8 }}>
          <label className="field" style={{ flex: 1 }}><span>Ngày chi</span><input className="input" type="date" value={f.d} onChange={(e) => setF({ ...f, d: e.target.value })} /></label>
          <label className="field" style={{ flex: 1 }}><span>Loại chi</span>
            <input className="input" list="cat-list" value={f.c} onChange={(e) => setF({ ...f, c: e.target.value })} maxLength={40} />
            <datalist id="cat-list">{CATS.map((c) => <option key={c} value={c} />)}</datalist></label>
        </div>
        <label className="field"><span>Số tiền (đ) *</span><input className="input" inputMode="decimal" value={f.amt} onChange={(e) => setF({ ...f, amt: e.target.value })} required /></label>
        <label className="field"><span>Ghi chú</span><input className="input" value={f.note} onChange={(e) => setF({ ...f, note: e.target.value })} maxLength={300} /></label>
        <button className="btn block" disabled={busy}>{busy ? "Đang lưu…" : "Lưu"}</button>
      </form>
    </Sheet>
  );
}

function RentSheet({ open, item, onClose, onDone }: { open: boolean; item: Rent | null; onClose: () => void; onDone: () => void }) {
  const { buildings, toast } = useSession();
  const [f, setF] = useState({ b: "", m: todayVN().slice(0, 7), amt: "", note: "" });
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    if (!open) return;
    setF(item ? { b: item.building_id, m: item.effective_from.slice(0, 7), amt: String(item.monthly_rent), note: item.note ?? "" } : { b: buildings[0]?.id ?? "", m: todayVN().slice(0, 7), amt: "", note: "" });
  }, [open, item, buildings]);
  async function submit(e: FormEvent) {
    e.preventDefault();
    const a = parseMoney(f.amt);
    if (!f.b || a == null || a < 0) { toast("Chọn toà và nhập số tiền thuê."); return; }
    setBusy(true);
    const { error } = await supabase.rpc("rent_save", { p_building: f.b, p_from: f.m + "-01", p_amount: a, p_note: f.note });
    setBusy(false);
    if (error) { toast(friendlyError(error)); return; }
    toast("Đã lưu tiền thuê nhà."); onDone();
  }
  return (
    <Sheet open={open} onClose={onClose} title={item ? "Sửa tiền thuê nhà" : "Nhập tiền thuê nhà"}>
      <form className="stack" onSubmit={submit}>
        <label className="field"><span>Toà nhà *</span>
          <select className="input" value={f.b} disabled={!!item} onChange={(e) => setF({ ...f, b: e.target.value })}>{buildings.map((b) => <option key={b.id} value={b.id}>{b.code} · {b.name}</option>)}</select></label>
        <label className="field"><span>Áp dụng từ tháng</span><input className="input" type="month" value={f.m} disabled={!!item} onChange={(e) => setF({ ...f, m: e.target.value })} /></label>
        <label className="field"><span>Tiền thuê nhà mỗi tháng (đ) *</span><input className="input" inputMode="decimal" value={f.amt} onChange={(e) => setF({ ...f, amt: e.target.value })} required /></label>
        <label className="field"><span>Ghi chú</span><input className="input" value={f.note} onChange={(e) => setF({ ...f, note: e.target.value })} maxLength={300} placeholder="VD: hợp đồng với chủ nhà đến 2028" /></label>
        <button className="btn block" disabled={busy}>{busy ? "Đang lưu…" : "Lưu"}</button>
      </form>
    </Sheet>
  );
}
