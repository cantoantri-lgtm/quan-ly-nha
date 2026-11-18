import { useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { supabase } from "../lib/supabase";
import { useSession } from "../lib/session";
import { ddmmyyyy, daysBetween } from "../lib/dates";
import { vnd, vndWords } from "../lib/money";
import { DUTY_LABEL, fmtDays, type Req, type ReqStep } from "../lib/office";
import { TRIP_TYPE, VISA_TYPE, loadTrip, type TripCost, type TripLeg } from "../lib/trip";
import { Empty, TopBar } from "../components/ui";
import "../office.css";
import "../print.css";

type Mau = "phieu" | "ke-hoach" | "di-duong" | "bang-ke";
const TITLE: Record<Mau, string> = {
  phieu: "PHIẾU YÊU CẦU ĐI CÔNG TÁC",
  "ke-hoach": "KẾ HOẠCH CÔNG TÁC",
  "di-duong": "GIẤY ĐI ĐƯỜNG",
  "bang-ke": "BẢNG KÊ CHỨNG TỪ THANH TOÁN CÔNG TÁC PHÍ",
};
const CODE: Record<Mau, string> = { phieu: "CT-01", "di-duong": "CT-02", "ke-hoach": "CT-03", "bang-ke": "CT-04" };
type Staff = { position: string | null; department: string | null };
const fmt = (n: number) => new Intl.NumberFormat("vi-VN").format(n);
const d = (iso: string | null | undefined) => (iso ? ddmmyyyy(iso) : "");
const n = (x: number) => String(x).replace(".", ",");

/** Bản in công tác theo biểu mẫu ADM-BMHC-09: phiếu yêu cầu, kế hoạch, giấy đi đường, bảng kê thanh toán */
export default function TripPrint() {
  const { id, mau: mauParam } = useParams();
  const mau = (["phieu", "ke-hoach", "di-duong", "bang-ke"].includes(mauParam ?? "") ? mauParam : "phieu") as Mau;
  const { people } = useSession();
  const [r, setR] = useState<Req | null>(null);
  const [missing, setMissing] = useState(false);
  const [trip, setTrip] = useState<{ planLegs: TripLeg[]; actLegs: TripLeg[]; planCosts: TripCost[]; actCosts: TripCost[] } | null>(null);
  const [steps, setSteps] = useState<ReqStep[]>([]);
  const [staff, setStaff] = useState<Record<string, Staff>>({});

  useEffect(() => {
    (async () => {
      const { data } = await supabase.from("requests").select("*").eq("id", id!).maybeSingle();
      const q = data as Req | null;
      if (!q || q.kind !== "cong_tac") { setMissing(true); return; }
      setR(q);
      const [t, s] = await Promise.all([loadTrip(q.id), supabase.from("request_steps").select("*").eq("request_id", q.id).order("step_no")]);
      setTrip(t); setSteps((s.data ?? []) as ReqStep[]);
      const ids = Array.from(new Set([q.requester_id, q.traveler_id, ...t.planLegs.map((l) => l.staff_id), ...t.actLegs.map((l) => l.staff_id)].filter(Boolean))) as string[];
      const { data: os } = await supabase.from("org_staff").select("profile_id, position, department_id").in("profile_id", ids);
      const deptIds = Array.from(new Set(((os ?? []) as { department_id: string | null }[]).map((x) => x.department_id).filter(Boolean))) as string[];
      const { data: deps } = deptIds.length ? await supabase.from("departments").select("id, name").in("id", deptIds) : { data: [] };
      const dn = new Map(((deps ?? []) as { id: string; name: string }[]).map((x) => [x.id, x.name]));
      const m: Record<string, Staff> = {};
      ((os ?? []) as { profile_id: string; position: string | null; department_id: string | null }[]).forEach((x) => {
        m[x.profile_id] = { position: x.position, department: x.department_id ? dn.get(x.department_id) ?? null : null };
      });
      setStaff(m);
    })();
  }, [id]);

  if (missing) return (<><TopBar title="Bản in công tác" back /><main className="main"><Empty title="Không tìm thấy phiếu công tác">Có thể bạn không có quyền xem phiếu này.</Empty></main></>);
  if (!r || !trip) return (<><TopBar title="Bản in công tác" back /><div className="loading">Đang tải…</div></>);

  const name = (uid: string | null | undefined) => people.find((p) => p.id === uid)?.full_name ?? "";
  const traveler = r.traveler_id ?? r.requester_id;
  const st = staff[traveler] ?? { position: null, department: null };
  const hasAct = r.status === "hoan_tat";
  const legs = mau === "di-duong" && trip.actLegs.length ? trip.actLegs : trip.planLegs;
  const costs = mau === "bang-ke" ? (trip.actCosts.length ? trip.actCosts : trip.planCosts) : trip.planCosts;
  const costSum = costs.reduce((s, c) => s + Number(c.amount ?? 0), 0);
  const firstApprover = steps.find((s) => s.status === "da_duyet");
  const lastApprover = [...steps].reverse().find((s) => s.status === "da_duyet");
  const actualDays = r.actual_start && r.actual_end ? daysBetween(r.actual_start, r.actual_end) + 1 : null;
  const sign = (title: string, who: string, note?: string) => (
    <div><b>{title}</b><small>(ký và ghi rõ họ tên)</small><span className="who">{who}</span>{note ? <span className="when">{note}</span> : null}</div>
  );
  const approvedLine = (s?: ReqStep) => (s?.decided_at ? `Đã duyệt ${new Date(s.decided_at).toLocaleDateString("vi-VN", { timeZone: "Asia/Ho_Chi_Minh" })}` : "");
  const tabs: [Mau, string][] = [["phieu", "Phiếu yêu cầu"], ["ke-hoach", "Kế hoạch"], ["di-duong", "Giấy đi đường"], ["bang-ke", "Bảng kê"]];

  return (
    <>
      <TopBar title="Bản in công tác" back={`/van-phong/${r.id}`} action={<button className="tb-action" onClick={() => window.print()}>In / lưu PDF</button>} />
      <main className="main main-wide">
        <nav className="pd-tabs" aria-label="Chọn mẫu in">
          {tabs.map(([k, l]) => <Link key={k} to={`/van-phong/${r.id}/in-cong-tac/${k}`} aria-current={mau === k ? "page" : undefined}>{l}</Link>)}
        </nav>
        <article className="print-doc">
          <header className="pd-head">
            <img className="pd-logo" src="/logo-next-vision.svg" alt="Next Vision" />
            <div className="pd-title">
              <div className="pd-brand">NEXT VISION</div>
              <h1>{TITLE[mau]}</h1>
              <div className="pd-no">Mẫu {CODE[mau]}{r.doc_no ? <> · Số: <b>{r.doc_no}</b></> : null}</div>
            </div>
          </header>

          {mau === "phieu" ? (
            <>
              <table className="pd-kv"><tbody>
                <tr><th>Người đi công tác</th><td><b>{name(traveler)}</b></td></tr>
                <tr><th>Chức vụ</th><td>{st.position ?? "—"}</td></tr>
                <tr><th>Phòng ban</th><td>{st.department ?? "—"}</td></tr>
                <tr><th>Loại công tác</th><td>{TRIP_TYPE[r.trip_type ?? "trong_nuoc"]}{r.trip_type === "nuoc_ngoai" && r.visa_type ? ` · ${VISA_TYPE[r.visa_type]}` : ""}</td></tr>
                <tr><th>Nơi công tác</th><td>{r.location}</td></tr>
                <tr><th>Mục đích</th><td>{r.reason}</td></tr>
              </tbody></table>
              <p className="pd-methods"><b>Lịch trình đề xuất</b></p>
              <div className="pd-scroll"><table className="pd-grid">
                <thead><tr><th>Stt</th><th>Từ ngày</th><th>Đến ngày</th><th>Địa điểm</th><th>Nội dung công việc</th><th>Phương tiện</th></tr></thead>
                <tbody>
                  {legs.length ? legs.map((l) => (
                    <tr key={l.id ?? l.line_no}><td>{l.line_no}</td><td>{d(l.start_date)}</td><td>{d(l.end_date)}</td>
                      <td>{[l.from_place, l.to_place].filter(Boolean).join(" → ")}</td><td>{l.content}</td><td>{l.transport}</td></tr>
                  )) : <tr><td>1</td><td>{d(r.start_date)}</td><td>{d(r.end_date)}</td><td>{r.location}</td><td>{r.reason}</td><td>{r.transport}</td></tr>}
                </tbody>
              </table></div>
              <p className="pd-words">Tổng thời gian dự kiến: <b>{fmtDays(r.days)}</b> ({d(r.start_date)} – {d(r.end_date)}){r.amount ? <> · Dự trù chi phí: <b>{vnd(r.amount)}</b></> : null}</p>
              <p className="pd-date">Ngày {d(r.created_at.slice(0, 10))}</p>
              <div className="pd-sign">
                {sign("Người lập", name(r.requester_id))}
                {sign(firstApprover ? DUTY_LABEL[firstApprover.duty] : "Trưởng phòng", firstApprover ? name(firstApprover.decided_by) : "", approvedLine(firstApprover))}
                {lastApprover && lastApprover.id !== firstApprover?.id ? sign(DUTY_LABEL[lastApprover.duty], name(lastApprover.decided_by), approvedLine(lastApprover)) : null}
              </div>
              <div className="pd-box">
                <b>Xác nhận thời gian công tác thực tế</b>
                <p>Đi từ ngày: <b>{d(r.actual_start) || "……/……/………"}</b> &nbsp; đến ngày: <b>{d(r.actual_end) || "……/……/………"}</b>{actualDays ? ` (${fmtDays(actualDays)})` : ""}</p>
                <p>{r.hr_confirmed_at ? <>Nhân sự xác nhận: <b>{name(r.hr_confirmed_by)}</b> ngày {new Date(r.hr_confirmed_at).toLocaleDateString("vi-VN", { timeZone: "Asia/Ho_Chi_Minh" })}{r.hr_note ? ` · ${r.hr_note}` : ""}</> : "Nhân sự xác nhận: ……………………………"}</p>
              </div>
            </>
          ) : null}

          {mau === "ke-hoach" ? (
            <>
              <table className="pd-kv"><tbody>
                <tr><th>Người đi công tác</th><td><b>{name(traveler)}</b> · {st.position ?? ""}{st.department ? ` · ${st.department}` : ""}</td></tr>
                <tr><th>Nơi công tác</th><td>{r.location}{r.trip_area ? ` · khu vực ${r.trip_area}` : ""}</td></tr>
                <tr><th>Thời gian</th><td>{d(r.start_date)} – {d(r.end_date)} ({fmtDays(r.days)})</td></tr>
                <tr><th>Mục đích công tác</th><td>{r.reason}</td></tr>
              </tbody></table>
              <p className="pd-methods"><b>I. Kế hoạch hành động</b></p>
              <div className="pd-scroll"><table className="pd-grid">
                <thead><tr><th>Stt</th><th>Nội dung công việc</th><th>Bắt đầu</th><th>Kết thúc</th><th>Nhân sự chính</th><th>Nơi đi → nơi đến</th><th>Phương tiện</th><th>Ghi chú</th></tr></thead>
                <tbody>
                  {legs.map((l) => (
                    <tr key={l.id ?? l.line_no}><td>{l.line_no}</td><td>{l.content}</td><td>{d(l.start_date)}</td><td>{d(l.end_date)}</td>
                      <td>{name(l.staff_id)}</td><td>{[l.from_place, l.to_place].filter(Boolean).join(" → ")}</td><td>{l.transport}</td><td>{l.note}</td></tr>
                  ))}
                  {!legs.length ? <tr><td colSpan={8}>Chưa nhập kế hoạch.</td></tr> : null}
                </tbody>
              </table></div>
              <p className="pd-methods"><b>II. Chi phí dự trù</b></p>
              <CostPrint costs={costs} sum={costSum} />
              <p className="pd-date">Ngày {d(r.created_at.slice(0, 10))}</p>
              <div className="pd-sign">
                {sign("Người lập kế hoạch", name(r.requester_id))}
                {sign(firstApprover ? DUTY_LABEL[firstApprover.duty] : "Trưởng phòng", firstApprover ? name(firstApprover.decided_by) : "", approvedLine(firstApprover))}
                {sign("Kế toán", "")}
              </div>
            </>
          ) : null}

          {mau === "di-duong" ? (
            <>
              <table className="pd-kv"><tbody>
                <tr><th>Cấp cho</th><td><b>{name(traveler)}</b></td></tr>
                <tr><th>Chức vụ</th><td>{st.position ?? "—"}</td></tr>
                <tr><th>Phòng ban</th><td>{st.department ?? "—"}</td></tr>
                <tr><th>Được cử đi công tác tại</th><td>{r.location}</td></tr>
                <tr><th>Theo kế hoạch</th><td>Từ ngày {d(r.start_date)} đến ngày {d(r.end_date)}</td></tr>
              </tbody></table>
              <div className="pd-scroll"><table className="pd-grid">
                <thead>
                  <tr><th colSpan={2}>Địa điểm</th><th rowSpan={2}>Ngày</th><th rowSpan={2}>Phương tiện</th><th rowSpan={2}>Số ngày công tác</th><th rowSpan={2}>Lý do lưu trú</th><th rowSpan={2}>Chứng nhận của nơi đến (ký, đóng dấu)</th></tr>
                  <tr><th>Nơi đi</th><th>Nơi đến</th></tr>
                </thead>
                <tbody>
                  {legs.map((l) => (
                    <tr key={l.id ?? l.line_no} className="pd-tall">
                      <td>{l.from_place}</td><td>{l.to_place}</td><td>{d(l.start_date)}{l.end_date && l.end_date !== l.start_date ? ` – ${d(l.end_date)}` : ""}</td>
                      <td>{l.transport}</td>
                      <td className="r">{l.start_date && l.end_date ? daysBetween(l.start_date, l.end_date) + 1 : ""}</td><td>{l.stay_reason}</td><td />
                    </tr>
                  ))}
                  {Array.from({ length: Math.max(0, 3 - legs.length) }).map((_, i) => <tr key={`b${i}`} className="pd-tall"><td /><td /><td /><td /><td /><td /><td /></tr>)}
                </tbody>
              </table></div>
              <p className="pd-words">Số ngày công tác thực tế: <b>{actualDays ? fmtDays(actualDays) : "……"}</b>{r.actual_start ? ` (${d(r.actual_start)} – ${d(r.actual_end)})` : ""}</p>
              <p className="pd-date">Ngày {d(r.created_at.slice(0, 10))}</p>
              <div className="pd-sign">
                {sign("Người đi công tác", name(traveler))}
                {sign("Người duyệt", lastApprover ? name(lastApprover.decided_by) : "", approvedLine(lastApprover))}
                {sign("Kế toán", "")}
              </div>
            </>
          ) : null}

          {mau === "bang-ke" ? (
            <>
              <table className="pd-kv"><tbody>
                <tr><th>Họ và tên</th><td><b>{name(traveler)}</b></td></tr>
                <tr><th>Bộ phận</th><td>{st.department ?? "—"}{st.position ? ` · ${st.position}` : ""}</td></tr>
                <tr><th>Nội dung</th><td>Thanh toán công tác phí {r.location} · {d(r.actual_start ?? r.start_date)} – {d(r.actual_end ?? r.end_date)}</td></tr>
                {r.doc_no ? <tr><th>Theo phiếu công tác số</th><td>{r.doc_no}</td></tr> : null}
              </tbody></table>
              {!hasAct || !trip.actCosts.length ? <p className="pd-warn">Chưa nhập bảng kê thực tế: bản in đang dùng chi phí dự trù.</p> : null}
              <CostPrint costs={costs} sum={costSum} />
              <p className="pd-words">Tổng cộng: <b>{vnd(costSum)}</b>, bằng chữ: <i>{vndWords(costSum)}</i></p>
              {r.amount && hasAct ? <p className="pd-words">Dự trù ban đầu: {vnd(r.amount)} · Chênh lệch: <b>{costSum >= r.amount ? "+" : "−"}{vnd(Math.abs(costSum - r.amount))}</b></p> : null}
              <p className="pd-date">Ngày …… tháng …… năm ………</p>
              <div className="pd-sign">
                {sign("Người đề nghị", name(traveler))}
                {sign("Kế toán", "")}
                {sign("Giám đốc", "")}
              </div>
            </>
          ) : null}
        </article>
      </main>
    </>
  );
}

function CostPrint({ costs, sum }: { costs: TripCost[]; sum: number }) {
  return (
    <div className="pd-scroll"><table className="pd-grid">
      <thead><tr><th>Stt</th><th>Hạng mục</th><th>Địa điểm</th><th>Số ngày</th><th>Số người</th><th>Đơn giá</th><th>Thành tiền</th><th>Ghi chú</th></tr></thead>
      <tbody>
        {costs.map((c) => (
          <tr key={c.id ?? c.line_no}><td>{c.line_no}</td><td>{c.category}</td><td>{c.location}</td><td className="r">{n(c.days)}</td><td className="r">{n(c.persons)}</td>
            <td className="r">{fmt(c.unit_price)}</td><td className="r">{fmt(Number(c.amount ?? 0))}</td><td>{c.note}</td></tr>
        ))}
        {!costs.length ? <tr><td colSpan={8}>Chưa có chi phí.</td></tr> : null}
        <tr className="pd-sum"><td colSpan={6}>TỔNG CỘNG</td><td className="r">{fmt(sum)}</td><td /></tr>
      </tbody>
    </table></div>
  );
}
