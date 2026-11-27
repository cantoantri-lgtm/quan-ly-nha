import { useEffect, useState, type FormEvent } from "react";
import { friendlyError, supabase } from "../lib/supabase";
import { useSession } from "../lib/session";
import { STATUS_LABEL, STATUS_ORDER, type Task, type TaskStatus } from "../lib/labels";
import { addDaysISO, daysBetween, ddmmyyyy, todayVN } from "../lib/dates";
import { kpiLine, num, paceInfo, sendFeedback, setStepPeople } from "../lib/tasks";
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

/* ---------- KPI: kết quả cần đạt + chỉ tiêu số ---------- */
export type KpiValue = { kpi: string; target: string; unit: string };
export const kpiFrom = (t?: Pick<Task, "kpi" | "kpi_target" | "kpi_unit"> | null): KpiValue =>
  ({ kpi: t?.kpi ?? "", target: t?.kpi_target != null ? String(t.kpi_target) : "", unit: t?.kpi_unit ?? "" });
export function kpiRow(k: KpiValue) {
  const n = Number(k.target.replace(",", "."));
  return {
    kpi: k.kpi.trim() || null,
    kpi_target: k.target.trim() && n > 0 ? n : null,
    kpi_unit: k.target.trim() && k.unit.trim() ? k.unit.trim() : null,
  };
}
export function kpiError(k: KpiValue, required: boolean): string | null {
  if (required && !k.kpi.trim()) return "Ghi KPI: kết quả cần đạt khi xong việc.";
  if (k.target.trim() && !(Number(k.target.replace(",", ".")) > 0)) return "Chỉ tiêu số phải lớn hơn 0.";
  return null;
}
export function KpiFields({ idPrefix, value, onChange, required, hint }: {
  idPrefix: string; value: KpiValue; onChange: (v: KpiValue) => void; required?: boolean; hint?: string;
}) {
  return (
    <div className="field tw-kpi">
      <label className="field"><span>KPI – kết quả cần đạt{required ? " *" : ""}</span>
        <input id={`${idPrefix}-kpi`} className="input" maxLength={500} value={value.kpi}
          onChange={(e) => onChange({ ...value, kpi: e.target.value })}
          placeholder={hint ?? "VD: Kiểm tra xong 30 phòng, có biên bản ký"} /></label>
      <div className="tw-kpi-num">
        <label className="field"><span>Chỉ tiêu số</span>
          <input id={`${idPrefix}-target`} className="input num" inputMode="decimal" value={value.target}
            onChange={(e) => onChange({ ...value, target: e.target.value })} placeholder="VD: 30" /></label>
        <label className="field"><span>Đơn vị</span>
          <input id={`${idPrefix}-unit`} className="input" maxLength={30} value={value.unit}
            onChange={(e) => onChange({ ...value, unit: e.target.value })} placeholder="phòng, hợp đồng…" /></label>
      </div>
      <small className="muted">Có chỉ tiêu số thì người làm báo "đã đạt bao nhiêu", app tự tính % tiến độ.</small>
    </div>
  );
}

/* ---------- Thanh tiến độ so với KPI ---------- */
export function ProgressLine({ t, compact }: { t: Task; compact?: boolean }) {
  const p = t.progress ?? 0;
  const pace = paceInfo(t);
  const actual = t.kpi_target != null && t.kpi_actual != null
    ? `${num(t.kpi_actual)}/${num(t.kpi_target)}${t.kpi_unit ? ` ${t.kpi_unit}` : ""}` : null;
  return (
    <div className={`tw-prog${compact ? " compact" : ""}`}>
      <div className="tw-prog-head">
        <b className="num">{p}%</b>
        {actual ? <span className="num">{actual}</span> : null}
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
  const minDue = t.due_date && t.due_date >= today ? addDaysISO(t.due_date, 1) : today;
  const hasTarget = t.kpi_target != null;
  const [prog, setProg] = useState("");
  const [actual, setActual] = useState("");
  const [note, setNote] = useState("");
  const [hasIssue, setHasIssue] = useState(false);
  const [issue, setIssue] = useState("");
  const [cause, setCause] = useState("");
  const [solution, setSolution] = useState("");
  const [extend, setExtend] = useState(false);
  const [newDue, setNewDue] = useState("");
  const [status, setStatus] = useState<"" | TaskStatus>("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  // Bấm "Xin gia hạn" ở trên: mở sẵn phần vướng mắc + gia hạn
  useEffect(() => {
    if (!extendNow || !canExtend) return;
    setHasIssue(true); setExtend(true); onExtendShown?.();
  }, [extendNow]);   // eslint-disable-line react-hooks/exhaustive-deps

  const actualN = actual.trim() ? Number(actual.replace(",", ".")) : null;
  const progN = prog.trim() ? Number(prog) : null;
  const calc = hasTarget && actualN != null && actualN >= 0 ? Math.min(100, Math.round((actualN / t.kpi_target!) * 100)) : null;

  async function submit(e: FormEvent) {
    e.preventDefault(); setErr(null);
    if (hasTarget && actual.trim() && !(actualN! >= 0)) { setErr("Kết quả đạt phải là số."); return; }
    if (progN != null && !(progN >= 0 && progN <= 100)) { setErr("Tiến độ từ 0 đến 100%."); return; }
    if (!note.trim()) { setErr("Ghi kết quả đã làm được."); return; }
    if (hasIssue && (!issue.trim() || !cause.trim() || !solution.trim())) { setErr("Báo vướng cần ghi đủ vấn đề, nguyên nhân và giải pháp."); return; }
    if (extend && (!newDue || newDue < minDue)) { setErr(`Chọn hạn mới từ ${ddmmyyyy(minDue)} trở đi.`); return; }
    setBusy(true);
    try {
      const r = await sendFeedback(t.id, {
        note: note.trim(), progress: hasTarget ? (progN ?? null) : progN, actual: hasTarget ? actualN : null,
        issue: hasIssue ? issue.trim() : "", cause: hasIssue ? cause.trim() : "", solution: hasIssue ? solution.trim() : "",
        status: status || null, newDue: extend ? newDue : null,
      });
      toast(r.request_id ? `Đã gửi phản hồi và xin gia hạn. Chờ ${giver} duyệt.` : "Đã gửi phản hồi.");
      setProg(""); setActual(""); setNote(""); setHasIssue(false); setIssue(""); setCause(""); setSolution("");
      setExtend(false); setNewDue(""); setStatus("");
      onDone();
    } catch (e2) { setErr((e2 as Error).message); }
    finally { setBusy(false); }
  }

  const late = t.due_date && t.due_date < today ? daysBetween(t.due_date, today) : 0;
  return (
    <form id="feedback" className="card stack tw-fb" onSubmit={submit}>
      <div className="tw-fb-kpi">
        <span className="muted small">KPI</span>
        <b>{kpiLine(t) || "Chưa đặt KPI"}</b>
        <span className="muted small">Hiện đạt {t.progress ?? 0}%{t.kpi_actual != null && hasTarget ? ` · ${num(t.kpi_actual)}/${num(t.kpi_target!)} ${t.kpi_unit ?? ""}` : ""}</span>
      </div>
      <div className="tw-kpi-num">
        {hasTarget ? (
          <label className="field"><span>Đã đạt ({t.kpi_unit || "số"})</span>
            <input id="fb-actual" className="input num" inputMode="decimal" value={actual} onChange={(e) => setActual(e.target.value)}
              placeholder={t.kpi_actual != null ? num(t.kpi_actual) : "0"} />
            {calc != null ? <small className="muted">= {calc}% chỉ tiêu</small> : null}</label>
        ) : null}
        <label className="field"><span>Tiến độ (%)</span>
          <input id="fb-prog" className="input num" inputMode="numeric" value={prog} onChange={(e) => setProg(e.target.value.replace(/\D/g, "").slice(0, 3))}
            placeholder={hasTarget ? "tự tính" : String(t.progress ?? 0)} /></label>
      </div>
      <label className="field"><span>Kết quả đã làm *</span>
        <textarea id="fb-note" className="input" maxLength={2000} value={note} onChange={(e) => setNote(e.target.value)}
          placeholder="Hôm nay làm được gì, đạt bao nhiêu so với KPI" /></label>

      <label className="tw-toggle"><input type="checkbox" checked={hasIssue}
        onChange={(e) => { setHasIssue(e.target.checked); if (!e.target.checked) setExtend(false); if (e.target.checked && !status) setStatus("vuong"); }} />
        <span>Có vấn đề, vướng mắc</span></label>
      {hasIssue ? (
        <div className="stack tw-issue">
          <label className="field"><span>Vấn đề *</span>
            <textarea id="fb-issue" className="input" maxLength={2000} value={issue} onChange={(e) => setIssue(e.target.value)} placeholder="Đang vướng ở đâu, ảnh hưởng thế nào đến KPI" /></label>
          <label className="field"><span>Nguyên nhân *</span>
            <textarea id="fb-cause" className="input" maxLength={2000} value={cause} onChange={(e) => setCause(e.target.value)} placeholder="Vì sao bị vướng" /></label>
          <label className="field"><span>Giải pháp *</span>
            <textarea id="fb-solution" className="input" maxLength={2000} value={solution} onChange={(e) => setSolution(e.target.value)} placeholder="Sẽ xử lý thế nào, cần ai hỗ trợ" /></label>
          {canExtend ? (
            <>
              <label className="tw-toggle"><input type="checkbox" checked={extend} onChange={(e) => setExtend(e.target.checked)} />
                <span>Xin gia hạn <small className="muted">(hạn hiện tại {t.due_date ? ddmmyyyy(t.due_date) : "chưa đặt"}{late ? `, đã trễ ${late} ngày` : ""})</small></span></label>
              {extend ? (
                <label className="field"><span>Hạn mới đề xuất *</span>
                  <input id="fb-due" className="input" type="date" min={minDue} value={newDue} onChange={(e) => setNewDue(e.target.value)} />
                  <small className="muted">{newDue && t.due_date ? `Lùi ${daysBetween(t.due_date, newDue)} ngày. ` : ""}{giver} duyệt thì hạn tự cập nhật.</small></label>
              ) : null}
            </>
          ) : null}
        </div>
      ) : null}

      <div className="row">
        <label className="field" style={{ flex: "1 1 180px" }}><span>Trạng thái</span>
          <Combo id="fb-status" value={status} placeholder={`Giữ: ${STATUS_LABEL[t.status]}`}
            options={STATUS_ORDER.filter((s) => s !== t.status).map((s) => [s, `Chuyển sang: ${STATUS_LABEL[s]}`] as const)}
            onChange={(v) => setStatus(v)} /></label>
      </div>
      {err ? <div className="error-box" role="alert">{err}</div> : null}
      <button className="btn block" disabled={busy}>{busy ? "Đang gửi…" : extend ? "Gửi phản hồi và xin gia hạn" : "Gửi phản hồi"}</button>
    </form>
  );
}

/* ---------- Một dòng phản hồi trong lịch sử ---------- */
export type UpdateRow = {
  id: string; note: string; status_after: TaskStatus | null; created_at: string; author: { full_name: string } | null;
  progress: number | null; kpi_actual: number | null; issue: string | null; cause: string | null; solution: string | null;
  deadline_request_id: string | null;
};
export function UpdateBody({ u, unit }: { u: UpdateRow; unit?: string | null }) {
  return (
    <>
      {u.progress != null || u.kpi_actual != null ? (
        <div className="tw-up-prog num">Tiến độ {u.progress ?? "—"}%{u.kpi_actual != null ? ` · đạt ${num(u.kpi_actual)}${unit ? ` ${unit}` : ""}` : ""}</div>
      ) : null}
      <div className="note">{u.note}</div>
      {u.issue ? (
        <dl className="tw-up-issue">
          <dt>Vấn đề</dt><dd>{u.issue}</dd>
          <dt>Nguyên nhân</dt><dd>{u.cause}</dd>
          <dt>Giải pháp</dt><dd>{u.solution}</dd>
        </dl>
      ) : null}
      {u.deadline_request_id ? <span className="dl-tag">kèm xin gia hạn</span> : null}
    </>
  );
}
