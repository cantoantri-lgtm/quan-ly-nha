import { useEffect, useState, type FormEvent } from "react";
import { addDaysISO, daysBetween, ddmmyyyy, timeAgo, todayVN } from "../lib/dates";
import { DL_STATUS, cancelDeadline, decideDeadline, requestDeadline, type DlReq, type DlTarget } from "../lib/deadline";
import { useSession } from "../lib/session";
import { Sheet } from "./ui";
import "../deadline.css";

/** Form xin gia hạn: báo cáo vướng mắc, phương án xử lý, hạn mới */
export function ExtendSheet({ open, onClose, target, id, title, due, report0 = "", onDone }: {
  open: boolean; onClose: () => void; target: DlTarget; id: string; title: string; due: string | null; report0?: string; onDone: () => void;
}) {
  const { toast } = useSession();
  const today = todayVN();
  const min = due && due >= today ? addDaysISO(due, 1) : today;
  const [report, setReport] = useState(report0);
  const [plan, setPlan] = useState("");
  const [newDue, setNewDue] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  useEffect(() => { if (open) { setReport(report0); setPlan(""); setNewDue(""); setErr(null); } }, [open, report0]);

  async function submit(e: FormEvent) {
    e.preventDefault(); setErr(null);
    if (!report.trim()) { setErr("Báo cáo tình hình, đang vướng ở đâu."); return; }
    if (!plan.trim()) { setErr("Đề xuất phương án xử lý để người giao duyệt."); return; }
    if (!newDue || newDue < min) { setErr(`Chọn hạn mới từ ${ddmmyyyy(min)} trở đi.`); return; }
    setBusy(true);
    try {
      await requestDeadline(target, id, newDue, report.trim(), plan.trim());
      toast("Đã gửi đề xuất gia hạn. Chờ người giao duyệt.");
      onClose(); onDone();
    } catch (e2) { setErr((e2 as Error).message); }
    finally { setBusy(false); }
  }
  const late = due && due < today ? daysBetween(due, today) : 0;
  return (
    <Sheet open={open} onClose={onClose} title="Báo cáo và xin gia hạn">
      <form className="stack" onSubmit={submit}>
        <p className="muted small" style={{ margin: 0 }}>{title} · hạn hiện tại <b>{due ? ddmmyyyy(due) : "chưa đặt"}</b>{late ? <b className="dl-late"> · đã trễ {late} ngày</b> : null}</p>
        <label className="field"><span>Tình hình, vướng mắc *</span>
          <textarea id="dl-report" className="input" style={{ minHeight: 90 }} maxLength={2000} value={report} onChange={(e) => setReport(e.target.value)}
            placeholder="Đã làm được gì, đang vướng ở đâu, vì sao chưa xong" /></label>
        <label className="field"><span>Phương án xử lý đề xuất *</span>
          <textarea id="dl-plan" className="input" style={{ minHeight: 80 }} maxLength={2000} value={plan} onChange={(e) => setPlan(e.target.value)}
            placeholder="Sẽ làm gì tiếp, cần ai hỗ trợ, cần gì từ người giao" /></label>
        <label className="field"><span>Hạn hoàn thành mới *</span>
          <input id="dl-due" className="input" type="date" min={min} value={newDue} onChange={(e) => setNewDue(e.target.value)} />
          {newDue && due ? <small className="muted">Lùi {daysBetween(due, newDue)} ngày so với hạn hiện tại.</small> : null}</label>
        {err ? <div className="error-box" role="alert">{err}</div> : null}
        <button className="btn block" disabled={busy}>{busy ? "Đang gửi…" : "Gửi đề xuất gia hạn"}</button>
      </form>
    </Sheet>
  );
}

/** Danh sách đề xuất gia hạn: đang chờ (có nút duyệt / không duyệt / rút) và lịch sử */
export function DeadlineList({ list, onChanged, showItem, label = "Đề xuất gia hạn" }: {
  list: DlReq[]; onChanged: () => void; showItem?: boolean; label?: string;
}) {
  const pending = list.filter((r) => r.status === "cho_duyet");
  const done = list.filter((r) => r.status !== "cho_duyet");
  if (!list.length) return null;
  return (
    <section className="dl-box" aria-label={label}>
      {pending.map((r) => <DlCard key={r.id} r={r} onChanged={onChanged} showItem={showItem} />)}
      {done.length ? (
        <details className="dl-hist">
          <summary>Lịch sử gia hạn ({done.length})</summary>
          {done.map((r) => <DlCard key={r.id} r={r} onChanged={onChanged} showItem={showItem} />)}
        </details>
      ) : null}
    </section>
  );
}

function DlCard({ r, onChanged, showItem }: { r: DlReq; onChanged: () => void; showItem?: boolean }) {
  const { toast } = useSession();
  const [mode, setMode] = useState<null | "ok" | "no">(null);
  const [due, setDue] = useState(r.new_due);
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const what = r.target === "project" ? "dự án" : r.target === "item" ? "hạng mục" : "việc";
  const shift = r.old_due ? daysBetween(r.old_due, r.new_due) : null;

  async function decide(e: FormEvent) {
    e.preventDefault(); setErr(null);
    if (mode === "no" && !note.trim()) { setErr("Ghi lý do không duyệt."); return; }
    setBusy(true);
    try {
      await decideDeadline(r.id, mode === "ok", mode === "ok" ? due : null, note.trim());
      toast(mode === "ok" ? `Đã duyệt hạn mới ${ddmmyyyy(due)}.` : "Đã báo không duyệt gia hạn.");
      setMode(null); onChanged();
    } catch (e2) { setErr((e2 as Error).message); }
    finally { setBusy(false); }
  }
  async function cancel() {
    setBusy(true);
    try { await cancelDeadline(r.id); toast("Đã rút đề xuất gia hạn."); onChanged(); }
    catch (e2) { toast((e2 as Error).message); }
    finally { setBusy(false); }
  }

  return (
    <article className={`dl-card ${r.status}`}>
      <header>
        <b>Xin gia hạn {what}{showItem && r.item_name ? `: ${r.item_name}` : ""}</b>
        <span className={`dl-chip ${r.status}`}>{DL_STATUS[r.status]}</span>
      </header>
      <p className="dl-dates num">
        {r.old_due ? <><s>{ddmmyyyy(r.old_due)}</s> → </> : null}<b>{ddmmyyyy(r.new_due)}</b>
        {shift != null ? <span className="muted"> · lùi {shift} ngày</span> : null}
        <span className="muted"> · {r.requester ?? "?"}, {timeAgo(r.created_at)}</span>
      </p>
      <dl className="dl-kv">
        <dt>Vướng mắc</dt><dd>{r.report}</dd>
        <dt>Phương án</dt><dd>{r.plan}</dd>
        {r.status !== "cho_duyet" && r.status !== "da_huy" ? (<>
          <dt>{r.status === "da_duyet" ? "Đã duyệt" : "Không duyệt"}</dt>
          <dd>{r.decider ?? ""}{r.approved_due && r.approved_due !== r.new_due ? ` · hạn duyệt ${ddmmyyyy(r.approved_due)}` : ""}{r.decision_note ? ` · ${r.decision_note}` : ""}</dd>
        </>) : null}
      </dl>
      {r.can_decide && !mode ? (
        <div className="row">
          <button type="button" className="btn sm" onClick={() => setMode("ok")}>Duyệt hạn mới</button>
          <button type="button" className="btn ghost sm" onClick={() => setMode("no")}>Không duyệt</button>
        </div>
      ) : null}
      {mode ? (
        <form className="stack dl-decide" onSubmit={decide}>
          {mode === "ok" ? (
            <label className="field"><span>Hạn duyệt (sửa được)</span>
              <input className="input" type="date" min={todayVN()} value={due} onChange={(e) => setDue(e.target.value)} required /></label>
          ) : null}
          <label className="field"><span>{mode === "ok" ? "Chỉ đạo thêm (không bắt buộc)" : "Lý do không duyệt *"}</span>
            <textarea className="input" style={{ minHeight: 60 }} maxLength={1000} value={note} onChange={(e) => setNote(e.target.value)}
              placeholder={mode === "ok" ? "VD: gửi giấy tờ trước 25/11" : "VD: hạn này không lùi được, cần thêm người hỗ trợ"} /></label>
          {err ? <div className="error-box" role="alert">{err}</div> : null}
          <div className="row">
            <button className={`btn sm${mode === "no" ? " danger" : ""}`} disabled={busy}>{busy ? "Đang lưu…" : mode === "ok" ? "Xác nhận duyệt" : "Xác nhận không duyệt"}</button>
            <button type="button" className="btn ghost sm" onClick={() => { setMode(null); setErr(null); }}>Huỷ</button>
          </div>
        </form>
      ) : null}
      {r.can_cancel ? <button type="button" className="btn ghost sm dl-cancel" disabled={busy} onClick={cancel}>Rút đề xuất</button> : null}
    </article>
  );
}
