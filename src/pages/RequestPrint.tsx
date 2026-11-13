import { useEffect, useState } from "react";
import { useParams } from "react-router-dom";
import { supabase } from "../lib/supabase";
import { useSession } from "../lib/session";
import { ddmmyyyy } from "../lib/dates";
import { vnd, vndWords } from "../lib/money";
import { DUTY_LABEL, LEAVE_SPAN, LEAVE_TYPE, OUT_TYPE, PAY_METHOD, PAY_TYPE, fmtDays, fullDate, hhmm, kindLabel, statusLabel,
  type Req, type ReqAdvance, type ReqLine, type ReqStep } from "../lib/office";
import { Empty, TopBar } from "../components/ui";
import "../office.css";
import "../print.css";

/** Bản in / lưu PDF theo mẫu Đề nghị thanh toán: thông tin chứng từ, bảng chi tiết, trừ tạm ứng, chữ ký các cấp duyệt */
export default function RequestPrint() {
  const { id } = useParams();
  const { people, buildings } = useSession();
  const [r, setR] = useState<Req | null>(null);
  const [lines, setLines] = useState<ReqLine[]>([]);
  const [advs, setAdvs] = useState<ReqAdvance[]>([]);
  const [steps, setSteps] = useState<ReqStep[]>([]);
  const [dept, setDept] = useState<string | null>(null);
  const [missing, setMissing] = useState(false);

  useEffect(() => {
    (async () => {
      const { data } = await supabase.from("requests").select("*").eq("id", id!).maybeSingle();
      if (!data) { setMissing(true); return; }
      const q = data as Req;
      setR(q);
      const [l, a, s, o] = await Promise.all([
        supabase.from("request_lines").select("*").eq("request_id", q.id).order("line_no"),
        supabase.from("request_advances").select("*").eq("request_id", q.id).order("created_at"),
        supabase.from("request_steps").select("*").eq("request_id", q.id).order("step_no"),
        supabase.from("org_staff").select("department_id").eq("profile_id", q.requester_id).maybeSingle(),
      ]);
      setLines((l.data ?? []) as ReqLine[]); setAdvs((a.data ?? []) as ReqAdvance[]); setSteps((s.data ?? []) as ReqStep[]);
      const did = (o.data as { department_id: string | null } | null)?.department_id;
      if (did) {
        const d = await supabase.from("departments").select("name").eq("id", did).maybeSingle();
        setDept((d.data as { name: string } | null)?.name ?? null);
      }
    })();
  }, [id]);

  if (missing) return (<><TopBar title="Bản in" back /><main className="main"><Empty title="Không tìm thấy đề nghị">Có thể bạn không có quyền xem đề nghị này.</Empty></main></>);
  if (!r) return (<><TopBar title="Bản in" back /><div className="loading">Đang tải…</div></>);

  const name = (uid: string | null) => people.find((p) => p.id === uid)?.full_name ?? "—";
  const isMoney = r.kind === "thanh_toan" || r.kind === "tam_ung";
  const gross = lines.reduce((t, l) => t + Number(l.total), 0);
  const adv = advs.reduce((t, a) => t + Number(a.amount), 0);
  const building = buildings.find((b) => b.id === r.building_id);
  // Chữ ký: hiện đủ các cấp trong luồng. Bước bị bỏ vì "đã duyệt ở bước trước" (cùng một người kiêm nhiệm) vẫn có ô ký,
  // trạng thái theo bước của người đó. Chỉ ẩn bước chưa có người giữ hoặc chính người đề nghị.
  const sameApprover = (s: ReqStep) => steps.find((x) => x.id !== s.id && x.approver_id && x.approver_id === s.approver_id && x.status !== "bo_qua");
  const signers = steps.filter((s) => s.status !== "bo_qua" || (s.skip_reason === "Đã duyệt ở bước trước" && !!sameApprover(s)));
  const outcome = (s: ReqStep) => (s.status === "bo_qua" ? sameApprover(s) ?? s : s);
  const dt = (iso: string | null) => (iso ? new Date(iso).toLocaleString("vi-VN", { timeZone: "Asia/Ho_Chi_Minh", day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit" }) : "");

  return (
    <>
      <TopBar title="Bản in" back action={<button className="tb-action" onClick={() => window.print()}>In / lưu PDF</button>} />
      <main className="main main-wide">
        <article className="print-doc">
          <header className="pd-head">
            <img className="pd-logo" src="/logo-next-vision.svg" alt="Next Vision" />
            <div className="pd-title">
              <div className="pd-brand">NEXT VISION</div>
              <h1>{kindLabel(r).toUpperCase()}</h1>
              {r.doc_no ? <div className="pd-no">Số chứng từ: <b>{r.doc_no}</b>{r.doc_date ? ` · ${ddmmyyyy(r.doc_date)}` : ""}</div> : null}
              <div className="pd-status">{statusLabel(r)}</div>
            </div>
          </header>

          <table className="pd-kv"><tbody>
            <tr><th>Họ và tên người đề nghị</th><td>{name(r.requester_id)}</td></tr>
            {dept ? <tr><th>Phòng ban</th><td>{dept}</td></tr> : null}
            {isMoney ? (<>
              <tr><th>Kính gửi</th><td>Giám đốc và phòng Kế toán</td></tr>
              <tr><th>{r.kind === "thanh_toan" ? "Hạn thanh toán" : "Ngày cần tiền"}</th><td>{fullDate(r.start_date)}</td></tr>
              {r.kind === "tam_ung" && r.settle_due ? <tr><th>Hạn hoàn ứng</th><td>{fullDate(r.settle_due)}</td></tr> : null}
              {r.loa_no ? <tr><th>LOA No.</th><td>{r.loa_no}</td></tr> : null}
              {r.pay_type ? <tr><th>Loại thanh toán</th><td>{PAY_TYPE[r.pay_type] ?? r.pay_type}</td></tr> : null}
              {r.payee ? <tr><th>Tên đơn vị</th><td>{r.payee}{r.vendor_code ? ` (${r.vendor_code})` : ""}</td></tr> : null}
              {r.contact_name || r.contact_code ? <tr><th>Người liên hệ</th><td>{[r.contact_name, r.contact_code].filter(Boolean).join(" · ")}</td></tr> : null}
              <tr><th>Thông tin chuyển khoản</th><td>{r.bank_info ?? "—"}</td></tr>
            </>) : (<>
              {r.kind === "nghi_phep" ? (<>
                <tr><th>Loại nghỉ</th><td>{LEAVE_TYPE[r.sub_type ?? ""]} · {LEAVE_SPAN[r.span ?? ""]}</td></tr>
                <tr><th>Thời gian</th><td>{fullDate(r.start_date)}{r.end_date && r.end_date !== r.start_date ? ` – ${fullDate(r.end_date)}` : ""} ({fmtDays(r.days)})</td></tr>
              </>) : null}
              {r.kind === "ra_ngoai" ? (<>
                <tr><th>Hình thức</th><td>{OUT_TYPE[r.sub_type ?? ""]}</td></tr>
                <tr><th>Thời gian</th><td>{fullDate(r.start_date)}{r.end_date && r.end_date !== r.start_date ? ` – ${fullDate(r.end_date)}` : ""}{r.start_time ? ` · ${hhmm(r.start_time)}${r.end_time ? `–${hhmm(r.end_time)}` : ""}` : ""}</td></tr>
                {r.location ? <tr><th>Đi đâu</th><td>{r.location}</td></tr> : null}
              </>) : null}
              {r.kind === "cong_tac" ? (<>
                <tr><th>Nơi công tác</th><td>{r.location}{r.transport ? ` · ${r.transport}` : ""}</td></tr>
                <tr><th>Thời gian</th><td>{fullDate(r.start_date)} – {fullDate(r.end_date)} ({fmtDays(r.days)})</td></tr>
                {r.amount ? <tr><th>Dự trù chi phí</th><td>{vnd(r.amount)}</td></tr> : null}
              </>) : null}
              {r.handover_to ? <tr><th>Bàn giao cho</th><td>{name(r.handover_to)}</td></tr> : null}
              {r.contact_phone ? <tr><th>SĐT liên hệ</th><td>{r.contact_phone}</td></tr> : null}
            </>)}
            <tr><th>{isMoney ? "Nội dung" : "Lý do / công việc"}</th><td>{r.reason}</td></tr>
            {building ? <tr><th>Toà nhà</th><td>{building.code} · {building.name}</td></tr> : null}
          </tbody></table>

          {r.kind === "thanh_toan" ? (
            <>
              <p className="pd-methods">Phương thức thanh toán:{" "}
                {Object.entries(PAY_METHOD).map(([k, l]) => <span key={k} className="pd-check">{r.pay_method === k ? "☑" : "☐"} {l}</span>)}
                {" "}· Loại tiền: {r.currency}</p>
              {lines.length ? (
                <div className="pd-scroll"><table className="pd-grid">
                  <thead><tr><th>Stt</th><th>Số hoá đơn</th><th>Ngày</th><th>Người bán</th><th>MST</th><th>Nội dung</th><th>Tiền trước VAT</th><th>SL</th><th>Thuế suất</th><th>Tiền thuế</th><th>Tổng</th><th>Cost center</th></tr></thead>
                  <tbody>
                    {lines.map((l) => (
                      <tr key={l.id ?? l.line_no}>
                        <td>{l.line_no}</td><td>{[l.invoice_serial, l.invoice_no].filter(Boolean).join(" ")}</td><td>{l.invoice_date ? ddmmyyyy(l.invoice_date) : ""}</td>
                        <td>{l.seller_name}</td><td>{l.seller_tax}</td><td>{l.description}</td>
                        <td className="r">{vnd(l.amount_pre_vat)}</td><td className="r">{l.quantity ?? ""}</td><td className="r">{l.vat_pct}%</td>
                        <td className="r">{vnd(l.vat_amount)}</td><td className="r">{vnd(l.total)}</td><td>{l.cost_center}{l.object_ref ? ` / ${l.object_ref}` : ""}</td>
                      </tr>
                    ))}
                    <tr className="pd-sum"><td colSpan={10}>Tổng tiền</td><td className="r">{vnd(gross)}</td><td /></tr>
                    {advs.map((a, i) => (<tr key={a.id}><td colSpan={5}>Trừ tạm ứng lần {i + 1}</td><td>{a.description}</td><td colSpan={4} /><td className="r">− {vnd(a.amount)}</td><td /></tr>))}
                    <tr className="pd-sum"><td colSpan={10}>TỔNG CÒN PHẢI THANH TOÁN</td><td className="r">{vnd(gross - adv)}</td><td /></tr>
                  </tbody>
                </table></div>
              ) : null}
            </>
          ) : null}
          {isMoney ? (
            <p className="pd-words">Tổng tiền: <b>{vnd(r.amount)}</b> — bằng chữ: <i>{vndWords(r.amount)}</i></p>
          ) : null}

          <p className="pd-date">Ngày {new Date(r.created_at).toLocaleDateString("vi-VN", { timeZone: "Asia/Ho_Chi_Minh", day: "2-digit", month: "2-digit", year: "numeric" })}</p>
          <div className="pd-sign">
            <div><b>Đề nghị bởi</b><small>(ký và ghi rõ họ tên)</small><span className="who">{name(r.requester_id)}</span><span className="when">{dt(r.created_at)}</span></div>
            {signers.map((s) => {
              const o = outcome(s);
              return (
                <div key={s.id}>
                  <b>{DUTY_LABEL[s.duty]}</b><small>(ký và ghi rõ họ tên)</small>
                  <span className="who">{o.status === "tu_choi" || o.status === "da_duyet" || o.status === "tra_lai" ? name(o.decided_by) : s.approver_id ? name(s.approver_id) : "Quản lý"}</span>
                  {o.status === "da_duyet" ? <span className="pd-ok">Đã phê duyệt</span> : o.status === "tu_choi" ? <span className="pd-no-ok">Đã từ chối</span> : o.status === "tra_lai" ? <span className="pd-no-ok">Đã trả lại</span> : <span className="when">Chờ duyệt</span>}
                  {o.decided_at ? <span className="when">{dt(o.decided_at)}</span> : null}
                </div>
              );
            })}
          </div>
          {r.status === "hoan_tat" && r.paid_at && isMoney ? <p className="pd-paid">Đã chi tiền ngày {dt(r.paid_at)} — {name(r.paid_by)}</p> : null}
        </article>
      </main>
    </>
  );
}
