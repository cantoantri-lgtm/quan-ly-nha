import { useCallback, useEffect, useState, type FormEvent } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { friendlyError, supabase } from "../lib/supabase";
import { useSession } from "../lib/session";
import { clock, daysBetween, todayVN } from "../lib/dates";
import { parseMoney, vnd, vndWords } from "../lib/money";
import { DUTY_LABEL, LEAVE_SPAN, LEAVE_TYPE, OUT_TYPE, PAY_METHOD, PAY_TYPE, fmtDays, fullDate, hhmm, kindLabel, statusLabel, summary, type Req, type ReqStep } from "../lib/office";
import { Empty, Sheet, TopBar } from "../components/ui";
import FileGallery from "../components/FileGallery";
import DnttView from "../components/DnttView";
import { ApprovalSteps } from "../components/ApprovalChain";
import { KIND_ICON, LeaveBalance } from "./Office";
import "../office.css";

export default function RequestDetail() {
  const { id } = useParams();
  const { profile, people, buildings, isManager, isAccountant, toast, refreshUnread } = useSession();
  const nav = useNavigate();
  const [r, setR] = useState<Req | null>(null);
  const [steps, setSteps] = useState<ReqStep[]>([]);
  const [notFound, setNotFound] = useState(false);
  const [busy, setBusy] = useState(false);
  const [decide, setDecide] = useState<null | "da_duyet" | "tu_choi">(null);
  const [note, setNote] = useState("");
  const [confirm, setConfirm] = useState<null | "huy" | "chi">(null);
  const [report, setReport] = useState(false);
  const [aStart, setAStart] = useState("");
  const [aEnd, setAEnd] = useState("");
  const [aCost, setACost] = useState("");
  const [aNote, setANote] = useState("");
  const [err, setErr] = useState<string | null>(null);

  const load = useCallback(async () => {
    const [{ data }, st] = await Promise.all([
      supabase.from("requests").select("*").eq("id", id!).maybeSingle(),
      supabase.from("request_steps").select("*").eq("request_id", id!).order("step_no"),
    ]);
    if (!data) { setNotFound(true); return; }
    setR(data as Req);
    setSteps((st.data ?? []) as ReqStep[]);
  }, [id]);
  useEffect(() => { load(); }, [load]);
  useEffect(() => {
    const h = () => load();
    window.addEventListener("neo:notification", h);
    return () => window.removeEventListener("neo:notification", h);
  }, [load]);
  useEffect(() => {
    if (!id || !profile) return;
    supabase.from("notifications").update({ read_at: new Date().toISOString() }).eq("entity_id", id).is("read_at", null)
      .then(() => refreshUnread());
  }, [id, profile, refreshUnread]);

  if (notFound) return (<><TopBar title="Đề nghị" back="/van-phong" /><main className="main"><Empty title="Không tìm thấy đề nghị">Có thể bạn không có quyền xem đề nghị này.</Empty></main></>);
  if (!r || !profile) return (<><TopBar title="Đề nghị" back="/van-phong" /><div className="loading">Đang tải…</div></>);

  const name = (uid: string | null) => people.find((p) => p.id === uid)?.full_name ?? "—";
  const requester = people.find((p) => p.id === r.requester_id);
  const mine = r.requester_id === profile.id;
  const isMoney = r.kind === "thanh_toan" || r.kind === "tam_ung";
  const today = todayVN();
  const curStep = r.status === "cho_duyet" ? steps.find((x) => x.status === "cho") : undefined;
  const canDecide = !!curStep && !mine && (curStep.approver_id === profile.id || (curStep.approver_id === null && isManager));
  const canEdit = mine && r.status === "cho_duyet" && !steps.some((x) => x.status === "da_duyet");
  const canPay = isMoney && r.status === "da_duyet" && (isManager || isAccountant);
  const canCancel = mine && (r.status === "cho_duyet" || (r.status === "da_duyet" && !isMoney && r.start_date > today));
  const canReport = mine && r.kind === "cong_tac" && (r.status === "da_duyet" || r.status === "hoan_tat");
  const building = buildings.find((b) => b.id === r.building_id);

  async function update(patch: Partial<Req>, msg: string) {
    setBusy(true); setErr(null);
    const { data, error } = await supabase.from("requests").update(patch).eq("id", r!.id).select("*").single();
    setBusy(false);
    if (error) { setErr(friendlyError(error)); toast(friendlyError(error)); return false; }
    setR(data as Req);
    toast(msg);
    refreshUnread();
    return true;
  }

  async function submitDecision(e: FormEvent) {
    e.preventDefault();
    if (decide === "tu_choi" && !note.trim()) { setErr("Ghi lý do từ chối để người đề nghị biết."); return; }
    setBusy(true); setErr(null);
    const { error } = await supabase.rpc("decide_step", { p_request: r!.id, p_approve: decide === "da_duyet", p_note: note.trim() || null });
    setBusy(false);
    if (error) { setErr(friendlyError(error)); return; }
    toast(decide === "da_duyet" ? "Đã duyệt bước của bạn." : "Đã từ chối đề nghị.");
    setDecide(null); setNote(""); await load(); refreshUnread();
  }

  async function markPaid() {
    setBusy(true); setErr(null);
    const { error } = await supabase.rpc("mark_paid", { p_request: r!.id });
    setBusy(false);
    if (error) { setErr(friendlyError(error)); toast(friendlyError(error)); return false; }
    toast("Đã ghi nhận chi tiền."); await load(); refreshUnread();
    return true;
  }

  function openReport() {
    setAStart(r!.actual_start ?? r!.start_date);
    setAEnd(r!.actual_end ?? r!.end_date ?? r!.start_date);
    setACost(r!.actual_cost != null ? String(r!.actual_cost) : "");
    setANote(r!.actual_note ?? "");
    setErr(null); setReport(true);
  }

  async function submitReport(e: FormEvent) {
    e.preventDefault();
    if (aEnd < aStart) { setErr("Ngày về phải sau ngày đi."); return; }
    const cost = aCost ? parseMoney(aCost) : null;
    if (aCost && cost == null) { setErr("Chi phí chưa đúng định dạng."); return; }
    const ok = await update({ actual_start: aStart, actual_end: aEnd, actual_cost: cost, actual_note: aNote.trim() || null, status: "hoan_tat" },
      r!.status === "hoan_tat" ? "Đã lưu báo cáo công tác." : "Đã gửi báo cáo thực tế công tác.");
    if (ok) setReport(false);
  }

  const actualDays = r.actual_start && r.actual_end ? daysBetween(r.actual_start, r.actual_end) + 1 : null;

  return (
    <>
      <TopBar title={kindLabel(r)} back="/van-phong"
        action={canEdit ? <Link className="tb-action" to={`/van-phong/${r.id}/sua`} style={{ color: "inherit" }}>Sửa</Link> : null} />
      <main className={`main stack${isMoney ? " main-wide" : ""}`}>
        <section className={`card rq-head k-${r.kind}`}>
          <div className="row" style={{ justifyContent: "space-between" }}>
            <span className="rq-ico" aria-hidden="true">{KIND_ICON[r.kind]}</span>
            <span className={`rq-pill ${r.status}`}>{statusLabel(r)}</span>
          </div>
          <h2 className="num">{isMoney ? vnd(r.amount) : summary(r)}</h2>
          {isMoney && r.amount ? <p className="muted" style={{ margin: 0, fontSize: 13 }}>{vndWords(r.amount)}</p> : null}
          <p className="muted" style={{ margin: 0 }}>{requester?.full_name ?? "—"} · gửi {clock(r.created_at)}</p>
        </section>

        {r.status === "tu_choi" && r.decision_note ? (
          <div className="error-box"><b>Lý do từ chối:</b> {r.decision_note}</div>
        ) : null}

        <dl className="card kv">
          {r.kind === "nghi_phep" ? (<>
            <dt>Loại nghỉ</dt><dd>{LEAVE_TYPE[r.sub_type ?? ""]}</dd>
            <dt>Thời gian</dt><dd>{LEAVE_SPAN[r.span ?? ""]}</dd>
            <dt>{r.span === "ca_ngay" ? "Từ – đến" : "Ngày"}</dt>
            <dd className="num">{fullDate(r.start_date)}{r.span === "ca_ngay" && r.end_date !== r.start_date ? ` – ${fullDate(r.end_date)}` : ""}</dd>
            <dt>Số ngày</dt><dd className="num">{fmtDays(r.days)}</dd>
          </>) : null}
          {r.kind === "ra_ngoai" ? (<>
            <dt>Hình thức</dt><dd>{OUT_TYPE[r.sub_type ?? ""]}</dd>
            <dt>Ngày</dt><dd className="num">{fullDate(r.start_date)}{r.end_date && r.end_date !== r.start_date ? ` – ${fullDate(r.end_date)}` : ""}</dd>
            {r.start_time || r.end_time ? (<><dt>Giờ</dt><dd className="num">{hhmm(r.start_time) || "—"}{r.end_time ? ` → quay lại ${hhmm(r.end_time)}` : ""}</dd></>) : null}
            {r.location ? (<><dt>Đi đâu</dt><dd>{r.location}</dd></>) : null}
          </>) : null}
          {r.kind === "cong_tac" ? (<>
            <dt>Nơi công tác</dt><dd>{r.location}{r.transport ? ` · ${r.transport}` : ""}</dd>
            <dt>Kế hoạch</dt><dd className="num">{fullDate(r.start_date)} – {fullDate(r.end_date)} ({fmtDays(r.days)})</dd>
            {r.amount ? (<><dt>Dự trù</dt><dd className="num">{vnd(r.amount)}</dd></>) : null}
          </>) : null}
          {isMoney ? (<>
            {r.doc_no ? (<><dt>Số chứng từ</dt><dd className="num">{r.doc_no}{r.doc_date ? ` · ${fullDate(r.doc_date)}` : ""}</dd></>) : null}
            <dt>Số tiền</dt><dd className="num"><b>{vnd(r.amount)}</b></dd>
            <dt>{r.kind === "thanh_toan" ? "Ngày cần TT" : "Cần trước"}</dt><dd className="num">{fullDate(r.start_date)}</dd>
            {r.kind === "thanh_toan" && r.pay_type ? (<><dt>Loại thanh toán</dt><dd>{PAY_TYPE[r.pay_type] ?? r.pay_type}</dd></>) : null}
            {r.loa_no ? (<><dt>LOA No.</dt><dd>{r.loa_no}</dd></>) : null}
            {r.kind === "tam_ung" && r.settle_due ? (<><dt>Hạn hoàn ứng</dt><dd className="num">{fullDate(r.settle_due)}</dd></>) : null}
            {r.payee ? (<><dt>{r.kind === "thanh_toan" ? "Đơn vị nhận" : "Người nhận"}</dt><dd>{r.payee}{r.vendor_code ? ` (${r.vendor_code})` : ""}</dd></>) : null}
            {r.contact_name || r.contact_code ? (<><dt>Liên hệ</dt><dd>{[r.contact_name, r.contact_code].filter(Boolean).join(" · ")}</dd></>) : null}
            <dt>Hình thức</dt><dd>{r.pay_method ? PAY_METHOD[r.pay_method] : r.bank_info ? "Chuyển khoản" : "Tiền mặt"}{r.bank_info ? ` — ${r.bank_info}` : ""}</dd>
          </>) : null}
          <dt>{isMoney ? "Nội dung" : r.kind === "cong_tac" ? "Mục đích" : r.kind === "ra_ngoai" ? "Công việc" : "Lý do"}</dt><dd className="desc">{r.reason}</dd>
          {building ? (<><dt>Toà nhà</dt><dd>{building.code} · {building.name}</dd></>) : null}
          {r.handover_to ? (<><dt>Bàn giao cho</dt><dd>{name(r.handover_to)}</dd></>) : null}
          {r.contact_phone ? (<><dt>SĐT liên hệ</dt><dd className="num">{r.contact_phone}</dd></>) : null}
        </dl>

        {r.kind === "cong_tac" && r.status === "hoan_tat" ? (
          <>
            <div className="section-title">Thực tế công tác</div>
            <dl className="card kv">
              <dt>Thời gian</dt><dd className="num">{fullDate(r.actual_start)} – {fullDate(r.actual_end)}{actualDays ? ` (${fmtDays(actualDays)})` : ""}
                {actualDays && r.days && actualDays !== Number(r.days) ? <span className="diff"> {actualDays > Number(r.days) ? "+" : "−"}{fmtDays(Math.abs(actualDays - Number(r.days)))} so với kế hoạch</span> : null}</dd>
              <dt>Chi phí</dt><dd className="num">{r.actual_cost != null ? vnd(r.actual_cost) : "—"}
                {r.actual_cost != null && r.amount ? <span className={`diff${r.actual_cost > r.amount ? " over" : ""}`}> {r.actual_cost > r.amount ? "vượt" : "dưới"} dự trù {vnd(Math.abs(r.actual_cost - r.amount))}</span> : null}</dd>
              {r.actual_note ? (<><dt>Kết quả</dt><dd className="desc">{r.actual_note}</dd></>) : null}
            </dl>
          </>
        ) : null}

        {isManager && r.kind === "nghi_phep" && r.sub_type === "phep_nam" && requester ? (
          <LeaveBalance userId={requester.id} quota={requester.annual_leave_days == null ? null : Number(requester.annual_leave_days)} compact />
        ) : null}

        {r.kind === "thanh_toan" ? (
          <DnttView requestId={r.id} refreshKey={r.updated_at}
            canAddLink={isManager || (mine && (r.status === "cho_duyet" || r.status === "da_duyet"))}
            canDeleteLink={isManager || (mine && r.status === "cho_duyet")} />
        ) : null}

        {isMoney ? (
          <FileGallery owner={{ kind: "dinh_kem_de_nghi", requestId: r.id }} title="Chứng từ đính kèm"
            hint="Hoá đơn, báo giá, ảnh chuyển khoản… (ảnh hoặc PDF, tối đa 10 MB mỗi tệp)."
            canUpload={isManager || (mine && (r.status === "cho_duyet" || r.status === "da_duyet"))}
            canDelete={isManager || (mine && r.status === "cho_duyet")} />
        ) : null}

        {steps.length ? (
          <>
            <div className="section-title">Luồng duyệt</div>
            <ApprovalSteps steps={steps} people={people} requesterName={requester?.full_name ?? "—"} sentAt={r.created_at} />
          </>
        ) : null}

        <div className="section-title">Lịch sử</div>
        <ol className="card rq-log">
          <li><b>{requester?.full_name}</b> gửi đề nghị<span>{clock(r.created_at)}</span></li>
          {r.decided_at && !steps.length ? <li><b>{name(r.approver_id)}</b> {r.status === "tu_choi" ? "từ chối" : "duyệt"}{r.decision_note && r.status !== "tu_choi" ? ` — ${r.decision_note}` : ""}<span>{clock(r.decided_at)}</span></li> : null}
          {r.reported_at ? <li><b>{requester?.full_name}</b> nhập thực tế công tác<span>{clock(r.reported_at)}</span></li> : null}
          {r.paid_at ? <li><b>{name(r.paid_by)}</b> đã chi tiền<span>{clock(r.paid_at)}</span></li> : null}
          {r.status === "da_huy" ? <li><b>{requester?.full_name}</b> rút lại đề nghị<span>{clock(r.updated_at)}</span></li> : null}
        </ol>

        {err && !decide && !report ? <div className="error-box" role="alert">{err}</div> : null}

        <div className="stack rq-actions">
          {canDecide ? (
            <div className="row">
              <button className="btn danger" style={{ flex: 1 }} disabled={busy} onClick={() => { setErr(null); setNote(""); setDecide("tu_choi"); }}>Từ chối</button>
              <button className="btn" style={{ flex: 2 }} disabled={busy} onClick={() => { setErr(null); setNote(""); setDecide("da_duyet"); }}>Duyệt</button>
            </div>
          ) : null}
          {canPay ? (
            <button className="btn block" disabled={busy} onClick={() => setConfirm("chi")}>Đánh dấu đã chi {vnd(r.amount)}</button>
          ) : null}
          <Link className="btn secondary block" to={`/van-phong/${r.id}/in`}>In / lưu PDF</Link>
          {canReport ? (
            <button className={`btn block${r.status === "hoan_tat" ? " secondary" : ""}`} onClick={openReport}>
              {r.status === "hoan_tat" ? "Sửa báo cáo thực tế" : "Nhập thực tế công tác"}
            </button>
          ) : null}
          {canCancel ? <button className="btn ghost" style={{ color: "var(--danger)" }} onClick={() => setConfirm("huy")}>Rút lại đề nghị</button> : null}
        </div>
      </main>

      <Sheet open={!!decide} onClose={() => setDecide(null)} title={decide === "da_duyet" ? "Duyệt đề nghị" : "Từ chối đề nghị"}>
        <form className="stack" onSubmit={submitDecision}>
          <p className="muted" style={{ margin: 0 }}>{requester?.full_name} · {kindLabel(r)} · {summary(r)}{curStep ? ` · bước ${DUTY_LABEL[curStep.duty]}` : ""}</p>
          <label className="field"><span>{decide === "tu_choi" ? "Lý do từ chối *" : "Ghi chú (không bắt buộc)"}</span>
            <textarea id="rq-decision" className="input" value={note} onChange={(e) => setNote(e.target.value)} autoFocus /></label>
          {err ? <div className="error-box" role="alert">{err}</div> : null}
          <button className={`btn block${decide === "tu_choi" ? " danger" : ""}`} disabled={busy}>{decide === "da_duyet" ? "Duyệt" : "Từ chối"}</button>
        </form>
      </Sheet>

      <Sheet open={report} onClose={() => setReport(false)} title="Thực tế công tác">
        <form className="stack" onSubmit={submitReport}>
          <div className="row" style={{ alignItems: "flex-start" }}>
            <label className="field" style={{ flex: "1 1 130px" }}><span>Ngày đi *</span>
              <input id="ac-start" type="date" className="input" value={aStart} required onChange={(e) => setAStart(e.target.value)} /></label>
            <label className="field" style={{ flex: "1 1 130px" }}><span>Ngày về *</span>
              <input id="ac-end" type="date" className="input" value={aEnd} min={aStart} required onChange={(e) => setAEnd(e.target.value)} /></label>
          </div>
          <label className="field"><span>Chi phí thực tế</span>
            <input id="ac-cost" className="input num" inputMode="decimal" value={aCost} onChange={(e) => setACost(e.target.value)} placeholder={r.amount ? `Dự trù ${vnd(r.amount)}` : "VD: 4tr2"} />
            {aCost ? <small className={parseMoney(aCost) != null ? "muted" : "err-text"}>{parseMoney(aCost) != null ? vnd(parseMoney(aCost)) : "Chưa đọc được số tiền"}</small> : null}</label>
          <label className="field"><span>Kết quả công tác</span>
            <textarea id="ac-note" className="input" value={aNote} onChange={(e) => setANote(e.target.value)} placeholder="Đã làm được gì, việc cần theo dõi tiếp…" /></label>
          {err ? <div className="error-box" role="alert">{err}</div> : null}
          <button className="btn block" disabled={busy}>{busy ? "Đang lưu…" : "Gửi báo cáo"}</button>
        </form>
      </Sheet>

      <Sheet open={!!confirm} onClose={() => setConfirm(null)} title={confirm === "chi" ? "Xác nhận đã chi tiền?" : "Rút lại đề nghị?"}>
        <p className="muted" style={{ marginTop: 0 }}>
          {confirm === "chi"
            ? `${vnd(r.amount)} cho ${r.payee || requester?.full_name}${r.bank_info ? ` (${r.bank_info})` : ""}. Người đề nghị sẽ nhận thông báo.`
            : r.status === "da_duyet" ? "Đề nghị đã được duyệt. Rút lại sẽ báo cho quản lý biết." : "Đề nghị sẽ không còn chờ duyệt nữa."}
        </p>
        <div className="row">
          <button className="btn secondary" style={{ flex: 1 }} onClick={() => setConfirm(null)}>Thôi</button>
          <button className={`btn ${confirm === "huy" ? "danger" : ""}`} style={{ flex: 1 }} disabled={busy}
            onClick={async () => {
              const ok = confirm === "chi" ? await markPaid() : await update({ status: "da_huy" }, "Đã rút lại đề nghị.");
              if (ok) { setConfirm(null); if (confirm === "huy") nav("/van-phong?tab=cua_toi", { replace: true }); }
            }}>{confirm === "chi" ? "Đã chi" : "Rút lại"}</button>
        </div>
      </Sheet>
    </>
  );
}
