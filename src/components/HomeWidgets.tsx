import { useEffect, useMemo, useState, type ReactNode } from "react";
import { Link } from "react-router-dom";
import { friendlyError, supabase } from "../lib/supabase";
import { addDaysISO, ddmmyyyy, mmyyyy, todayVN } from "../lib/dates";
import { vnd } from "../lib/money";
import { groupByBuilding, loadMonthCloseShared, type MCRow } from "../lib/monthClose";
import { useSession } from "../lib/session";
import { Icon } from "./ui";
import "../reports.css";

/** Khung chung cho các ô báo cáo ở màn hình chính */
export function WidgetCard({ title, sub, icon, link, linkText = "Xem báo cáo", children }:
  { title: string; sub?: string; icon: ReactNode; link?: string; linkText?: string; children: ReactNode }) {
  return (
    <section className="pg-card" aria-label={title}>
      <div className="pg-head">
        <span className="pg-ico">{icon}</span>
        <div className="grow"><h2>{title}</h2>{sub ? <p>{sub}</p> : null}</div>
        {link ? <Link to={link} className="btn ghost sm">{linkText}</Link> : null}
      </div>
      {children}
    </section>
  );
}

function useMC() {
  const [rows, setRows] = useState<MCRow[] | null>(null);
  const [err, setErr] = useState<string | null>(null);
  useEffect(() => { loadMonthCloseShared().then(({ rows, error }) => { if (error) setErr(friendlyError(error)); setRows(rows); }); }, []);
  return { rows, err };
}

function useRpcRows<T>(fn: string, args: Record<string, unknown>) {
  const [rows, setRows] = useState<T[] | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const key = JSON.stringify(args);
  useEffect(() => {
    supabase.rpc(fn, JSON.parse(key)).then(({ data, error }) => { if (error) setErr(friendlyError(error)); setRows((data ?? []) as T[]); });
  }, [fn, key]);
  return { rows, err };
}

function Body({ rows, err, empty, children }: { rows: unknown[] | null; err: string | null; empty: string; children: ReactNode }) {
  if (err) return <div className="error-box" style={{ margin: 12 }}>{err}</div>;
  if (rows === null) return <div className="dt-empty">Đang tải…</div>;
  if (!rows.length) return <div className="dt-empty">{empty}</div>;
  return <>{children}</>;
}

const pct = (a: number, b: number) => (b > 0 ? Math.round((a / b) * 1000) / 10 : 0);
const Bar = ({ v }: { v: number }) => <span className="rpt-pc"><span className="rpt-bar" aria-hidden="true"><i style={{ width: `${Math.min(100, v)}%` }} /></span><b className="num">{v}%</b></span>;

/** Tiền nhà tháng này: phải thu, đã thu, còn lại theo toà (theo hoá đơn tháng) */
export function RentWidget() {
  const { rows, err } = useMC();
  const g = useMemo(() => groupByBuilding(rows ?? []).map((b) => {
    const due = b.rows.reduce((t, r) => t + (r.invoice_id ? Number(r.invoice_amount ?? 0) : 0), 0);
    const got = b.rows.reduce((t, r) => t + (r.invoice_status === "da_thu" ? Number(r.invoice_amount ?? 0) : 0), 0);
    return { id: b.id, code: b.code, due, got, n: b.count.chua_thu };
  }), [rows]);
  const T = g.reduce((t, x) => ({ due: t.due + x.due, got: t.got + x.got }), { due: 0, got: 0 });
  const rp = rows?.[0]?.rent_period;
  return (
    <WidgetCard title="Tiền nhà tháng này" sub={`Hoá đơn tháng ${rp ? mmyyyy(rp) : ""}: đã thu ${vnd(T.got)} / ${vnd(T.due)}`} icon={Icon.money} link="/bao-cao?tab=chot_thang">
      <Body rows={rows} err={err} empty="Chưa có hoá đơn tháng này">
        <div className="dt-wrap"><table className="dt cards">
          <thead><tr><th>Toà</th><th>Phải thu</th><th>Đã thu</th><th>Còn lại</th><th>Tỉ lệ</th></tr></thead>
          <tbody>{g.map((x) => (
            <tr key={x.id}>
              <td data-label="Toà"><Link className="dt-link" to={`/toa/${x.id}/hoa-don`}>{x.code}</Link>{x.n ? <div className="t2">{x.n} phòng chưa thu</div> : null}</td>
              <td data-label="Phải thu" className="num">{vnd(x.due)}</td>
              <td data-label="Đã thu" className="num">{vnd(x.got)}</td>
              <td data-label="Còn lại" className="num"><b>{vnd(x.due - x.got)}</b></td>
              <td data-label="Tỉ lệ"><Bar v={pct(x.got, x.due)} /></td>
            </tr>
          ))}</tbody>
        </table></div>
      </Body>
    </WidgetCard>
  );
}

/** Hợp đồng & CCCD: chưa có hợp đồng, thiếu CCCD, hợp đồng hết hạn hoặc sắp hết hạn trong 30 ngày */
export function ContractWidget() {
  const { rows, err } = useMC();
  const today = todayVN(), soon = addDaysISO(today, 30);
  const g = useMemo(() => groupByBuilding(rows ?? []).map((b) => ({
    id: b.id, code: b.code,
    noHd: b.rows.filter((r) => !r.contract_id),
    cccd: b.rows.filter((r) => r.cccd_missing > 0),
    late: b.rows.filter((r) => r.contract_end && r.contract_end < today),
    soon: b.rows.filter((r) => r.contract_end && r.contract_end >= today && r.contract_end <= soon),
  })).filter((x) => x.noHd.length || x.cccd.length || x.late.length || x.soon.length), [rows, today, soon]);
  const codes = (rs: MCRow[], end?: boolean) => rs.map((r) => (
    <span key={r.room_id} className="mc-room"><b className="num">{r.room_code}</b>{end && r.contract_end ? <small> {ddmmyyyy(r.contract_end).slice(0, 5)}</small> : null}</span>));
  return (
    <WidgetCard title="Hợp đồng & CCCD" sub="Phòng chưa có hợp đồng, người ở thiếu CCCD, hợp đồng hết hạn trong 30 ngày" icon={Icon.user} link="/bao-cao?tab=chot_thang">
      <Body rows={rows === null ? null : g} err={err} empty="Đủ hợp đồng và CCCD, không có hợp đồng sắp hết hạn">
        <div className="dt-wrap"><table className="dt cards">
          <thead><tr><th>Toà</th><th>Chưa có HĐ</th><th>Thiếu CCCD</th><th>Đã hết hạn</th><th>Hết hạn ≤ 30 ngày</th></tr></thead>
          <tbody>{g.map((x) => (
            <tr key={x.id}>
              <td data-label="Toà"><Link className="dt-link" to={`/toa/${x.id}/hop-dong`}>{x.code}</Link></td>
              <td data-label="Chưa có HĐ"><div className="mc-rooms">{codes(x.noHd)}</div></td>
              <td data-label="Thiếu CCCD"><div className="mc-rooms">{codes(x.cccd)}</div></td>
              <td data-label="Đã hết hạn"><div className="mc-rooms">{codes(x.late, true)}</div></td>
              <td data-label="Hết hạn ≤ 30 ngày"><div className="mc-rooms">{codes(x.soon, true)}</div></td>
            </tr>
          ))}</tbody>
        </table></div>
      </Body>
    </WidgetCard>
  );
}

type Occ = { building_id: string; building_name: string; status: string };
/** Lấp đầy hôm nay theo toà (phòng thuê tháng) */
export function OccupancyWidget() {
  const t = todayVN();
  const { rows, err } = useRpcRows<Occ>("report_occupancy_rooms", { p_from: t, p_to: t });
  const g = useMemo(() => {
    const m = new Map<string, { id: string; name: string; n: number; o: number; tr: number }>();
    (rows ?? []).forEach((r) => {
      const x = m.get(r.building_id) ?? { id: r.building_id, name: r.building_name, n: 0, o: 0, tr: 0 };
      x.n++; if (r.status === "dang_o") x.o++; if (r.status === "trong") x.tr++;
      m.set(r.building_id, x);
    });
    return [...m.values()];
  }, [rows]);
  const T = g.reduce((s, x) => ({ n: s.n + x.n, o: s.o + x.o }), { n: 0, o: 0 });
  return (
    <WidgetCard title="Lấp đầy hôm nay" sub={`${T.o}/${T.n} phòng đang ở · ${pct(T.o, T.n)}%`} icon={Icon.building} link="/bao-cao">
      <Body rows={rows} err={err} empty="Chưa có phòng thuê tháng">
        <div className="dt-wrap"><table className="dt cards">
          <thead><tr><th>Toà</th><th>Đang ở</th><th>Trống</th><th>Lấp đầy</th></tr></thead>
          <tbody>{g.map((x) => (
            <tr key={x.id}>
              <td data-label="Toà"><Link className="dt-link" to={`/toa/${x.id}`}>{x.name}</Link></td>
              <td data-label="Đang ở" className="num">{x.o}/{x.n}</td>
              <td data-label="Trống" className="num">{x.tr}</td>
              <td data-label="Lấp đầy"><Bar v={pct(x.o, x.n)} /></td>
            </tr>
          ))}</tbody>
        </table></div>
      </Body>
    </WidgetCard>
  );
}

type Cash = { building_id: string; building_name: string; thu: number; chi: number; tien_coc: number };
/** Thu chi từ đầu tháng tới hôm nay theo toà */
export function CashWidget() {
  const { isManager, isAccountant } = useSession();
  const fin = isManager || isAccountant;
  const t = todayVN();
  const { rows, err } = useRpcRows<Cash>("report_cashflow_detail", { p_from: t.slice(0, 8) + "01", p_to: t });
  const g = useMemo(() => {
    const m = new Map<string, { id: string; name: string; thu: number; chi: number; coc: number }>();
    (rows ?? []).forEach((r) => {
      const x = m.get(r.building_id) ?? { id: r.building_id, name: r.building_name, thu: 0, chi: 0, coc: 0 };
      x.thu += Number(r.thu ?? 0); x.chi += Number(r.chi ?? 0); x.coc += Number(r.tien_coc ?? 0);
      m.set(r.building_id, x);
    });
    return [...m.values()].sort((a, b) => b.thu - a.thu);
  }, [rows]);
  const T = g.reduce((s, x) => ({ thu: s.thu + x.thu, chi: s.chi + x.chi }), { thu: 0, chi: 0 });
  return (
    <WidgetCard title="Thu chi tháng này" sub={`Từ 01/${t.slice(5, 7)}: thu ${vnd(T.thu)}${fin ? ` · chi ${vnd(T.chi)}` : ""}`} icon={Icon.chart} link="/bao-cao">
      <Body rows={rows} err={err} empty="Chưa có khoản thu chi nào trong tháng">
        <div className="dt-wrap"><table className="dt cards">
          <thead><tr><th>Toà</th><th>Thu</th>{fin ? <><th>Chi</th><th>Thu − chi</th></> : null}<th>Cọc (riêng)</th></tr></thead>
          <tbody>{g.map((x) => (
            <tr key={x.id}>
              <td data-label="Toà">{x.name}</td>
              <td data-label="Thu" className="num"><b>{vnd(x.thu)}</b></td>
              {fin ? <><td data-label="Chi" className="num">{vnd(x.chi)}</td><td data-label="Thu − chi" className="num">{vnd(x.thu - x.chi)}</td></> : null}
              <td data-label="Cọc (riêng)" className="num">{vnd(x.coc)}</td>
            </tr>
          ))}</tbody>
        </table></div>
      </Body>
    </WidgetCard>
  );
}

type FB = { grp_key: string; grp_name: string; total: number; cho_cong_ty: number; chua_tra_loi: number; da_dong: number };
/** Phản ánh của khách từ đầu tháng theo toà */
export function FeedbackWidget() {
  const t = todayVN();
  const { rows, err } = useRpcRows<FB>("report_feedback", { p_from: t.slice(0, 8) + "01", p_to: t, p_group: "toa" });
  const T = (rows ?? []).reduce((s, x) => ({ n: s.n + x.total, wait: s.wait + x.chua_tra_loi }), { n: 0, wait: 0 });
  return (
    <WidgetCard title="Phản ánh tháng này" sub={`${T.n} phản ánh, ${T.wait} chưa trả lời`} icon={Icon.help} link="/phan-anh" linkText="Mở phản ánh">
      <Body rows={rows} err={err} empty="Chưa có phản ánh nào trong tháng">
        <div className="dt-wrap"><table className="dt cards">
          <thead><tr><th>Toà</th><th>Tổng</th><th>Chưa trả lời</th><th>Chờ công ty</th><th>Đã đóng</th></tr></thead>
          <tbody>{(rows ?? []).map((x) => (
            <tr key={x.grp_key}>
              <td data-label="Toà">{x.grp_name}</td>
              <td data-label="Tổng" className="num">{x.total}</td>
              <td data-label="Chưa trả lời" className="num">{x.chua_tra_loi ? <b style={{ color: "var(--late)" }}>{x.chua_tra_loi}</b> : 0}</td>
              <td data-label="Chờ công ty" className="num">{x.cho_cong_ty}</td>
              <td data-label="Đã đóng" className="num">{x.da_dong}</td>
            </tr>
          ))}</tbody>
        </table></div>
      </Body>
    </WidgetCard>
  );
}
