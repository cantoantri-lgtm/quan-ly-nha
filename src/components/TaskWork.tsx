import { useEffect, useState, type FormEvent } from "react";
import { friendlyError, supabase } from "../lib/supabase";
import { useSession } from "../lib/session";
import { STATUS_LABEL, STATUS_ORDER, type Task, type TaskStatus } from "../lib/labels";
import { addDaysISO, daysBetween, ddmmyyyy, todayVN } from "../lib/dates";
import { kpiLine, paceInfo, sendFeedback, setStepPeople } from "../lib/tasks";
import { Combo, Sheet } from "./ui";
import "../taskwork.css";

export type TeamMember = { id: string; name: string; sub?: string };

/* ---------- Người chính + người phụ ---------- */
export function PeoplePick({ idPrefix, team, main, others, onMain, onOthers }: {
  idPrefix: string; team: TeamMember[]; main: string; others: string[];
  onMain: (v: string) => void; onOthers: (v: string[]) => void;
}) {
  const rest = team.filter((m) => m.id !== main);
  return (
    <>
      <label className="field"><span>Người chính *</span>
        <Combo id={`${idPrefix}-main`} value={main} placeholder="— Chọn người chịu trách nhiệm —"
          options={team.map((m) => [m.id, m.sub ? `${m.name} · ${m.sub}` : m.name] as const)}
          onChange={(v) => { onMain(v); onOthers(others.filter((x) => x !== v)); }} />
      </label>
      {rest.length ? (
        <fieldset className="field tw-fs">
          <legend><span>Người phụ <small className="muted">(hỗ trợ, không bắt buộc)</small></span></legend>
          <div className="checks tw-checks">
            {rest.map((m) => (
              <label key={m.id}>
                <input type="checkbox" checked={others.includes(m.id)}
                  onChange={(e) => onOthers(e.target.checked ? [...others, m.id] : others.filter((x) => x !== m.id))} />
                <span className="pick-who"><b>{m.name}</b>{m.sub ? <small>{m.sub}</small> : null}</span>
              </label>
            ))}
          </div>
        </fieldset>
      ) : null}
    </>
  );
}

/* ---------- KPI: kết quả cần đạt (SQL 111: bỏ chỉ tiêu số, đơn vị) ---------- */
export type KpiValue = { kpi: string };
export const kpiFrom = (t?: Pick<Task, "kpi"> | null): KpiValue => ({ kpi: t?.kpi ?? "" });
export function kpiRow(k: KpiValue) {
  return { kpi: k.kpi.trim() || null, kpi_target: null, kpi_unit: null };
}
export function kpiError(k: KpiValue, required: boolean): string | null {
  if (required && !k.kpi.trim()) return "Ghi KPI: kết quả cần đạt khi xong việc.";
  return null;
}
export function KpiFields({ idPrefix, value, onChange, required, hint }: {
  idPrefix: string; value: KpiValue; onChange: (v: KpiValue) => void; required?: boolean; hint?: string;
}) {
  return (
    <label className="field"><span>KPI – kết quả cần đạt{required ? " *" : ""}</span>
      <input id={`${idPrefix}-kpi`} className="input" maxLength={500} value={value.kpi}
        onChange={(e) => onChange({ kpi: e.target.value })}
        placeholder={hint ?? "VD: Kiểm tra xong 30 phòng, có biên bản ký"} /></label>
  );
}

/* ---------- Thanh tiến độ so với KPI ---------- */
export function ProgressLine({ t, compact }: { t: Task; compact?: boolean }) {
  const p = t.progress ?? 0;
  const pace = paceInfo(t);
  return (
    <div className={`tw-prog${compact ? " compact" : ""}`}>
      <div className="tw-prog-head">
        <b className="num">{p}%</b>
        {pace && !compact ? <span className={`tw-pace ${pace.tone}`}>{pace.text}</span> : null}
      </div>
      <div className={`progress tw-bar ${pace?.tone ?? ""}`} role="progressbar" aria-valuenow={p} aria-valuemin={0} aria-valuemax={100}
        aria-label="Tiến độ"><span style={{ width: `${p}%` }} /></div>
    </div>
  );
}

/* ---------- Thêm / sửa hạng mục ---------- */
export type StepRow = Task & { members: string[] };
export function StepSheet({ open, onClose, parent, team, step, canDelete, onDone, onDeleted }: {
  open: boolean; onClose: () => void; parent: Task; team: TeamMember[];
  step?: StepRow | null; canDelete?: boolean; onDone: () => void; onDeleted?: () => void;
}) {
  const { toast } = useSession();
  const [title, setTitle] = useState("");
  const [kpi, setKpi] = useState<KpiValue>(kpiFrom(null));
  const [due, setDue] = useState("");
  const [main, setMain] = useState("");
  const [others, setOthers] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [askDel, setAskDel] = useState(false);
  useEffect(() => {
    if (!open) return;
    setTitle(step?.title ?? ""); setKpi(kpiFrom(step)); setDue(step?.due_date ?? parent.due_date ?? "");
    setMain(step?.assignee_id ?? parent.assignee_id ?? team[0]?.id ?? ""); setOthers(step?.members ?? []);
    setErr(null); setAskDel(false);
  }, [open, step, parent, team]);

  async function save(e: FormEvent) {
    e.preventDefault(); setErr(null);
    if (!title.trim()) { setErr("Ghi nội dung hạng mục."); return; }
    if (!main) { setErr("Chọn người chính."); return; }
    const ke = kpiError(kpi, false); if (ke) { setErr(ke); return; }
    if (due && parent.due_date && due > parent.due_date) { setErr(`Hạn hạng mục không được sau hạn việc chính (${ddmmyyyy(parent.due_date)}).`); return; }
    setBusy(true);
    const row = { title: title.trim(), due_date: due || null, ...kpiRow(kpi) };
    let cur = step ?? null;
    if (cur) {
      const { error } = await supabase.from("tasks").update(row).eq("id", cur.id);
      if (error) { setBusy(false); setErr(friendlyError(error)); return; }
    } else {
      const { data, error } = await supabase.from("tasks").insert({ ...row, parent_id: parent.id, sort_order: Date.now() % 1e9 }).select("id,assignee_id").single();
      if (error || !data) { setBusy(false); setErr(friendlyError(error)); return; }
      cur = { ...(data as Task), members: [] } as StepRow;
    }
    const sameOthers = [...others].sort().join() === [...cur.members].sort().join();
    if (main !== cur.assignee_id || !sameOthers) {
      try { await setStepPeople(cur.id, main, others); }
      catch (e2) { setBusy(false); setErr("Đã lưu hạng mục nhưng chưa đổi được người làm: " + (e2 as Error).message); onDone(); return; }
    }
    setBusy(false);
    toast(step ? "Đã lưu hạng mục." : "Đã giao hạng mục.");
    onClose(); onDone();
  }

  async function remove() {
    if (!step) return;
    setBusy(true);
    const { error } = await supabase.from("tasks").delete().eq("id", step.id);
    setBusy(false);
    if (error) { setErr(friendlyError(error)); return; }
    toast("Đã xoá hạng mục."); onClose(); (onDeleted ?? onDone)();
  }

  return (
    <Sheet open={open} onClose={onClose} title={step ? "Sửa hạng mục" : "Giao hạng mục"}>
      <form className="stack" onSubmit={save}>
        <p className="muted small" style={{ margin: 0 }}>Thuộc việc: <b>{parent.title}</b>{parent.due_date ? ` · hạn ${ddmmyyyy(parent.due_date)}` : ""}</p>
        <label className="field"><span>Nội dung hạng mục *</span>
          <input id="st-title" className="input" maxLength={200} value={title} onChange={(e) => setTitle(e.target.value)} placeholder="VD: Kiểm tra tầng 1" /></label>
        <PeoplePick idPrefix="st" team={team} main={main} others={others} onMain={setMain} onOthers={setOthers} />
        <KpiFields idPrefix="st" value={kpi} onChange={setKpi} hint="VD: 10 phòng tầng 1 có biên bản" />
        <label className="field"><span>Hạn hoàn thành</span>
          <input id="st-due" className="input" type="date" max={parent.due_date ?? undefined} value={due} onChange={(e) => setDue(e.target.value)} /></label>
        {err ? <div className="error-box" role="alert">{err}</div> : null}
        <button className="btn block" disabled={busy}>{busy ? "Đang lưu…" : step ? "Lưu hạng mục" : "Giao hạng mục"}</button>
        {step && canDelete ? (askDel ? (
          <div className="row">
            <button type="button" className="btn secondary" style={{ flex: 1 }} onClick={() => setAskDel(false)}>Giữ lại</button>
            <button type="button" className="btn danger" style={{ flex: 1 }} disabled={busy} onClick={remove}>Xoá hẳn</button>
          </div>
        ) : <button type="button" className="btn ghost sm" onClick={() => setAskDel(true)}>Xoá hạng mục này</button>) : null}
      </form>
    </Sheet>
  );
}

/* ---------- Phản hồi tiến độ ---------- */
export function FeedbackForm({ t, giver, canExtend, extendNow, onExtendShown, onDone }: {
  t: Task; giver: string; canExtend: boolean; extendNow: number; onExtendShown?: () => void; onDone: () => void;
}) {
  const { toast } = useSession();
  const today = todayVN();
  const defCommit = t.due_date && t.due_date >= today ? t.due_date : today;
  const [prog, setProg] = useState("");
  const [issue, setIssue] = useState("");
  const [cause, setCause] = useState("");
  const [action, setAction] = useState("");
  const [commit, setCommit] = useState(defCommit);
  const [status, setStatus] = useState<"" | TaskStatus>("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  useEffect(() => { setCommit(defCommit); }, [t.due_date]);   // eslint-disable-line react-hooks/exhaustive-deps

  // Bấm "Xin gia hạn" ở trên: gợi ý deadline cam kết sau hạn hiện tại
  useEffect(() => {
    if (!extendNow || !canExtend) return;
    setCommit(t.due_date && t.due_date >= today ? addDaysISO(t.due_date, 1) : today);
    onExtendShown?.();
    document.getElementById("fb-commit")?.focus();
  }, [extendNow]);   // eslint-disable-line react-hooks/exhaustive-deps

  const done = status === "xong";
  const progN = done ? 100 : prog.trim() ? Number(prog) : null;
  const later = !done && !!commit && (!t.due_date || commit > t.due_date);
  const late = t.due_date && t.due_date < today ? daysBetween(t.due_date, today) : 0;

  async function submit(e: FormEvent) {
    e.preventDefault(); setErr(null);
    if (progN == null || !(progN >= 0 && progN <= 100)) { setErr("Ghi tiến độ từ 0 đến 100%."); return; }
    if (!done) {
      if (!issue.trim() || !cause.trim() || !action.trim()) { setErr('Ghi đủ vấn đề, nguyên nhân, hành động. Không có vấn đề thì ghi "Không".'); return; }
      if (!commit || commit < today) { setErr("Chọn deadline cam kết từ hôm nay trở đi."); return; }
      if (later && !canExtend && t.due_date) { setErr(`Deadline cam kết sau hạn ${ddmmyyyy(t.due_date)}: đang có đề xuất chờ duyệt hoặc bạn không xin gia hạn được việc này.`); return; }
    }
    setBusy(true);
    try {
      const r = await sendFeedback(t.id, {
        progress: progN, issue: done ? "" : issue.trim(), cause: done ? "" : cause.trim(), action: done ? "" : action.trim(),
        commitDue: done ? null : commit, status: status || null,
      });
      toast(r.request_id ? `Đã gửi phản hồi. Deadline mới chờ ${giver} duyệt.` : r.pending ? "Đã gửi phản hồi. Đề xuất deadline trước vẫn đang chờ duyệt." : "Đã gửi phản hồi.");
      setProg(""); setIssue(""); setCause(""); setAction(""); setStatus("");
      onDone();
    } catch (e2) { setErr((e2 as Error).message); }
    finally { setBusy(false); }
  }

  return (
    <form id="feedback" className="card stack tw-fb" onSubmit={submit}>
      <div className="tw-fb-kpi">
        <span className="muted small">KPI</span>
        <b>{kpiLine(t) || "Chưa đặt KPI"}</b>
        <span className="muted small">Hiện đạt {t.progress ?? 0}% · deadline {t.due_date ? ddmmyyyy(t.due_date) : "chưa đặt"}{late ? `, đã trễ ${late} ngày` : ""}</span>
      </div>
      <div className="tw-kpi-num">
        <label className="field"><span>Tiến độ (%) *</span>
          <input id="fb-prog" className="input num" inputMode="numeric" value={done ? "100" : prog} disabled={done}
            onChange={(e) => setProg(e.target.value.replace(/\D/g, "").slice(0, 3))} placeholder={String(t.progress ?? 0)} /></label>
        <label className="field"><span>Trạng thái</span>
          <Combo id="fb-status" value={status} placeholder={`Giữ: ${STATUS_LABEL[t.status]}`}
            options={STATUS_ORDER.filter((x) => x !== t.status).map((x) => [x, `Chuyển: ${STATUS_LABEL[x]}`] as const)}
            onChange={(v) => setStatus(v)} /></label>
      </div>
      {done ? (
        <p className="muted small" style={{ margin: 0 }}>Báo hoàn thành: tiến độ 100%, không cần ghi vấn đề và deadline.</p>
      ) : (
        <>
          <label className="field"><span>Vấn đề *</span>
            <textarea id="fb-issue" className="input" rows={2} maxLength={2000} value={issue} onChange={(e) => setIssue(e.target.value)}
              placeholder='Đang vướng gì, ảnh hưởng KPI thế nào. Không có thì ghi "Không"' /></label>
          <label className="field"><span>Nguyên nhân *</span>
            <textarea id="fb-cause" className="input" rows={2} maxLength={2000} value={cause} onChange={(e) => setCause(e.target.value)}
              placeholder='Vì sao. Không có vấn đề thì ghi "Không"' /></label>
          <label className="field"><span>Hành động *</span>
            <textarea id="fb-action" className="input" rows={2} maxLength={2000} value={action} onChange={(e) => setAction(e.target.value)}
              placeholder="Sẽ làm gì tiếp, cần ai hỗ trợ" /></label>
          <label className="field"><span>Deadline cam kết hoàn thành *</span>
            <input id="fb-commit" className="input" type="date" min={today} value={commit} onChange={(e) => setCommit(e.target.value)} />
            {later ? (
              <small style={{ color: "var(--late)" }}>
                {t.due_date ? `Sau deadline hiện tại ${ddmmyyyy(t.due_date)} là ${daysBetween(t.due_date, commit)} ngày. ` : "Việc chưa có deadline. "}
                Gửi xong sẽ chờ {giver} duyệt deadline mới, rồi tiếp tục báo cáo.
              </small>
            ) : <small className="muted">Trong hạn hiện tại: chỉ ghi nhận cam kết.</small>}
          </label>
        </>
      )}
      {err ? <div className="error-box" role="alert">{err}</div> : null}
      <button className="btn block" disabled={busy}>{busy ? "Đang gửi…" : later ? "Gửi phản hồi và xin duyệt deadline mới" : "Gửi phản hồi"}</button>
    </form>
  );
}

/* ---------- Một dòng phản hồi trong lịch sử ---------- */
export type UpdateRow = {
  id: string; note: string; status_after: TaskStatus | null; created_at: string; author: { full_name: string } | null;
  progress: number | null; issue: string | null; cause: string | null; solution: string | null;
  commit_due: string | null; deadline_request_id: string | null;
};
export function UpdateBody({ u }: { u: UpdateRow }) {
  const auto = /^Báo cáo tiến độ \d+%( · cam kết xong \d{2}\/\d{2}\/\d{4})?$|^Báo hoàn thành$/.test(u.note);
  return (
    <>
      {u.progress != null || u.commit_due ? (
        <div className="tw-up-prog num">
          {u.progress != null ? `Tiến độ ${u.progress}%` : ""}{u.progress != null && u.commit_due ? " · " : ""}
          {u.commit_due ? `Cam kết xong ${ddmmyyyy(u.commit_due)}` : ""}
        </div>
      ) : null}
      {auto ? null : <div className="note">{u.note}</div>}
      {u.issue ? (
        <dl className="tw-up-issue">
          <dt>Vấn đề</dt><dd>{u.issue}</dd>
          <dt>Nguyên nhân</dt><dd>{u.cause}</dd>
          <dt>Hành động</dt><dd>{u.solution}</dd>
        </dl>
      ) : null}
      {u.deadline_request_id ? <span className="dl-tag">xin duyệt deadline mới</span> : null}
    </>
  );
}
