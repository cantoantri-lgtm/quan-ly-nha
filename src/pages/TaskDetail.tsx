import { useCallback, useEffect, useState, type FormEvent } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { friendlyError, supabase } from "../lib/supabase";
import { useSession } from "../lib/session";
import { PRIORITY_LABEL, STATUS_LABEL, STATUS_ORDER, type Task, type TaskStatus } from "../lib/labels";
import { clock, ddmmyyyy, dueInfo } from "../lib/dates";
import { Empty, Sheet, TopBar } from "../components/ui";

type Detail = Task & {
  assignee: { full_name: string; phone: string | null } | null;
  creator: { full_name: string } | null;
  building: { code: string; name: string } | null;
};
type Update = { id: string; note: string; status_after: TaskStatus | null; created_at: string; author: { full_name: string } | null };

export default function TaskDetail() {
  const { id } = useParams();
  const { profile, isManager, isSupervisor, myBuildingIds, toast } = useSession();
  const nav = useNavigate();
  const [t, setT] = useState<Detail | null>(null);
  const [steps, setSteps] = useState<Task[]>([]);
  const [updates, setUpdates] = useState<Update[]>([]);
  const [notFound, setNotFound] = useState(false);
  const [note, setNote] = useState("");
  const [noteStatus, setNoteStatus] = useState<"" | TaskStatus>("");
  const [newStep, setNewStep] = useState("");
  const [busy, setBusy] = useState(false);
  const [confirmDel, setConfirmDel] = useState(false);

  const load = useCallback(async () => {
    const [a, b, c] = await Promise.all([
      supabase.from("tasks").select("*, assignee:profiles!tasks_assignee_id_fkey(full_name,phone), creator:profiles!tasks_created_by_fkey(full_name), building:buildings(code,name)").eq("id", id!).maybeSingle(),
      supabase.from("tasks").select("*").eq("parent_id", id!).order("sort_order").order("created_at"),
      supabase.from("task_updates").select("id,note,status_after,created_at, author:profiles!task_updates_author_id_fkey(full_name)").eq("task_id", id!).order("created_at", { ascending: false }),
    ]);
    if (!a.data) { setNotFound(true); return; }
    setT(a.data as Detail);
    setSteps((b.data as Task[]) ?? []);
    setUpdates((c.data as unknown as Update[]) ?? []);
  }, [id]);

  useEffect(() => { load(); }, [load]);
  useEffect(() => {
    const h = () => load();
    window.addEventListener("neo:notification", h);
    return () => window.removeEventListener("neo:notification", h);
  }, [load]);

  // Đánh dấu đã đọc các thông báo về việc này
  useEffect(() => {
    if (!id || !profile) return;
    supabase.from("notifications").update({ read_at: new Date().toISOString() })
      .eq("entity_id", id).is("read_at", null).then(() => window.dispatchEvent(new Event("focus")));
  }, [id, profile]);

  if (notFound) return (<><TopBar title="Công việc" back="/" /><main className="main"><Empty title="Không tìm thấy việc này">Có thể việc đã bị xoá hoặc bạn không có quyền xem.</Empty></main></>);
  if (!t || !profile) return (<><TopBar title="Công việc" back="/" /><div className="loading">Đang tải…</div></>);

  const isOwner = isManager || (isSupervisor && t.created_by === profile.id) || (isSupervisor && !!t.building_id && myBuildingIds.includes(t.building_id));
  const isAssignee = t.assignee_id === profile.id;
  const canUpdate = isOwner || isAssignee;
  const d = dueInfo(t.due_date, t.status === "xong");
  const doneSteps = steps.filter((s) => s.status === "xong").length;

  async function setStatus(s: TaskStatus) {
    if (!t || s === t.status) return;
    const prev = t.status;
    setT({ ...t, status: s });
    const { error } = await supabase.from("tasks").update({ status: s }).eq("id", t.id);
    if (error) { setT({ ...t, status: prev }); toast(friendlyError(error)); return; }
    toast(`Đã chuyển sang "${STATUS_LABEL[s]}".`);
    load();
  }

  async function toggleStep(s: Task) {
    const next: TaskStatus = s.status === "xong" ? "chua_lam" : "xong";
    setSteps(steps.map((x) => (x.id === s.id ? { ...x, status: next } : x)));
    const { error } = await supabase.from("tasks").update({ status: next }).eq("id", s.id);
    if (error) { toast(friendlyError(error)); load(); return; }
    // Tự chuyển việc chính sang "Đang làm" khi bắt đầu tick bước
    if (next === "xong" && t!.status === "chua_lam") await setStatus("dang_lam");
  }

  async function addStep(e: FormEvent) {
    e.preventDefault();
    if (!newStep.trim()) return;
    const { error } = await supabase.from("tasks").insert({ parent_id: t!.id, title: newStep.trim(), sort_order: steps.length + 1 });
    if (error) { toast(friendlyError(error)); return; }
    setNewStep("");
    load();
  }

  async function sendUpdate(e: FormEvent) {
    e.preventDefault();
    if (!note.trim()) return;
    setBusy(true);
    const { error } = await supabase.from("task_updates").insert({ task_id: t!.id, note: note.trim(), status_after: noteStatus || null });
    setBusy(false);
    if (error) { toast(friendlyError(error)); return; }
    setNote(""); setNoteStatus("");
    toast(isAssignee && t!.created_by !== profile!.id ? "Đã gửi cập nhật cho người giao việc." : "Đã gửi cập nhật.");
    load();
  }

  async function remove() {
    const { error } = await supabase.from("tasks").delete().eq("id", t!.id);
    if (error) { toast(friendlyError(error)); return; }
    toast("Đã xoá việc.");
    nav("/", { replace: true });
  }

  return (
    <>
      <TopBar title="Chi tiết việc" back="/"
        action={isOwner ? <Link className="tb-action" to={`/viec/${t.id}/sua`} style={{ color: "inherit" }}>Sửa</Link> : null} />
      <main className="main stack">
        <section className="card detail-head">
          <div className="row">
            {t.building ? <span className="tag">{t.building.code}</span> : null}
            {d ? <span className={`due ${d.tone}`}>{d.text}</span> : null}
            {t.priority !== "binh_thuong" ? <span className={t.priority === "thap" ? "muted small" : "prio"}>{PRIORITY_LABEL[t.priority]}</span> : null}
          </div>
          <h2>{t.title}</h2>
          <div className="seg" role="group" aria-label="Trạng thái">
            {STATUS_ORDER.map((s) => (
              <button key={s} className={s} aria-pressed={t.status === s} disabled={!canUpdate} onClick={() => setStatus(s)}>
                {STATUS_LABEL[s]}
              </button>
            ))}
          </div>
        </section>

        <dl className="card kv">
          <dt>Người làm</dt>
          <dd>{t.assignee?.full_name ?? "—"}{t.assignee?.phone && !isAssignee ? <> · <a href={`tel:${t.assignee.phone}`}>{t.assignee.phone}</a></> : null}</dd>
          <dt>Người giao</dt><dd>{t.creator?.full_name ?? "—"}</dd>
          {t.building ? (<><dt>Toà nhà</dt><dd>{t.building.code} · {t.building.name}</dd></>) : null}
          <dt>Hạn</dt><dd>{t.due_date ? ddmmyyyy(t.due_date) : "Không đặt hạn"}</dd>
          {t.completed_at ? (<><dt>Hoàn thành</dt><dd>{clock(t.completed_at)}</dd></>) : null}
          {t.description ? (<><dt>Mô tả</dt><dd className="desc">{t.description}</dd></>) : null}
        </dl>

        <div className="section-title">Các bước {steps.length ? <span className="num">({doneSteps}/{steps.length})</span> : null}</div>
        <section className="card">
          {steps.length ? (
            <ul className="steps">
              {steps.map((s) => (
                <li key={s.id} className={s.status === "xong" ? "done" : ""}>
                  <input id={`step-${s.id}`} type="checkbox" checked={s.status === "xong"} disabled={!canUpdate}
                    onChange={() => toggleStep(s)} aria-label={s.title} />
                  <label className="st" htmlFor={`step-${s.id}`}>{s.title}</label>
                </li>
              ))}
            </ul>
          ) : <p className="muted small" style={{ padding: "12px 16px", margin: 0 }}>Chưa chia bước.</p>}
          {canUpdate ? (
            <form className="add-step" onSubmit={addStep}>
              <input id="new-step" className="input" placeholder="Thêm bước…" value={newStep} onChange={(e) => setNewStep(e.target.value)} />
              <button className="btn secondary" disabled={!newStep.trim()}>Thêm</button>
            </form>
          ) : null}
        </section>

        <div className="section-title">Cập nhật tiến độ</div>
        {canUpdate ? (
          <form className="card stack" style={{ padding: 14 }} onSubmit={sendUpdate}>
            <textarea id="update-note" className="input" placeholder="Hôm nay làm được gì, đang vướng gì…" value={note} onChange={(e) => setNote(e.target.value)} />
            <div className="row">
              <select id="update-status" className="input" style={{ flex: "1 1 180px", width: "auto" }} value={noteStatus}
                onChange={(e) => setNoteStatus(e.target.value as TaskStatus | "")} aria-label="Đổi trạng thái kèm cập nhật">
                <option value="">Giữ trạng thái: {STATUS_LABEL[t.status]}</option>
                {STATUS_ORDER.filter((s) => s !== t.status).map((s) => <option key={s} value={s}>Chuyển sang: {STATUS_LABEL[s]}</option>)}
              </select>
              <button className="btn" disabled={busy || !note.trim()}>{busy ? "Đang gửi…" : "Gửi cập nhật"}</button>
            </div>
          </form>
        ) : null}
        <section className="card">
          {updates.length ? (
            <ul className="timeline">
              {updates.map((u) => (
                <li key={u.id}>
                  <div className="row"><span className="who">{u.author?.full_name ?? "?"}</span><span className="when">{clock(u.created_at)}</span>
                    {u.status_after ? <span className={`pill ${u.status_after}`}>{STATUS_LABEL[u.status_after]}</span> : null}</div>
                  <div className="note">{u.note}</div>
                </li>
              ))}
            </ul>
          ) : <p className="muted small" style={{ padding: "12px 16px", margin: 0 }}>Chưa có cập nhật nào.</p>}
        </section>

        {isOwner ? (
          <button className="btn danger" style={{ marginTop: 12 }} onClick={() => setConfirmDel(true)}>Xoá việc này</button>
        ) : null}
      </main>

      <Sheet open={confirmDel} onClose={() => setConfirmDel(false)} title="Xoá việc này?">
        <p className="muted" style={{ marginTop: 0 }}>Việc "{t.title}" cùng các bước và cập nhật sẽ bị xoá hẳn, không khôi phục được.</p>
        <div className="row">
          <button className="btn secondary" style={{ flex: 1 }} onClick={() => setConfirmDel(false)}>Giữ lại</button>
          <button className="btn danger" style={{ flex: 1 }} onClick={remove}>Xoá</button>
        </div>
      </Sheet>
    </>
  );
}
