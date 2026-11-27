import { useCallback, useEffect, useMemo, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { RelatedPanel } from "../components/RelatedPanel";
import { friendlyError, supabase } from "../lib/supabase";
import { useSession } from "../lib/session";
import { PRIORITY_LABEL, STATUS_LABEL, STATUS_ORDER, type Task, type TaskStatus } from "../lib/labels";
import { clock, ddmm, ddmmyyyy, dueInfo, todayVN } from "../lib/dates";
import { dirLine, useDirectory } from "../lib/directory";
import { Empty, Sheet, TopBar } from "../components/ui";
import { DeadlineList } from "../components/Deadline";
import { loadDeadlines, type DlReq } from "../lib/deadline";
import { ReassignSheet } from "../components/Reassign";
import { assignableFor, changeTaskMain } from "../lib/reassign";
import { kpiLine } from "../lib/tasks";
import { FeedbackForm, ProgressLine, StepSheet, UpdateBody, type StepRow, type TeamMember, type UpdateRow } from "../components/TaskWork";

type Detail = Task & {
  assignee: { full_name: string; phone: string | null } | null;
  creator: { full_name: string } | null;
  building: { code: string; name: string } | null;
};
type Parent = Task & { creator: { full_name: string } | null; members: { user_id: string }[] };
const UPD_SELECT = "id,note,status_after,created_at,progress,kpi_actual,issue,cause,solution,deadline_request_id, author:profiles!task_updates_author_id_fkey(full_name)";

export default function TaskDetail() {
  const { id } = useParams();
  const { profile, people, isManager, isSupervisor, myBuildingIds, toast } = useSession();
  const nav = useNavigate();
  const dir = useDirectory();
  const [t, setT] = useState<Detail | null>(null);
  const [parent, setParent] = useState<Parent | null>(null);
  const [steps, setSteps] = useState<StepRow[]>([]);
  const [updates, setUpdates] = useState<UpdateRow[]>([]);
  const [members, setMembers] = useState<string[]>([]);
  const [notFound, setNotFound] = useState(false);
  const [confirmDel, setConfirmDel] = useState(false);
  const [dls, setDls] = useState<DlReq[]>([]);
  const [extendNow, setExtendNow] = useState(0);
  const [reassign, setReassign] = useState(false);
  const [stepSheet, setStepSheet] = useState<{ step: StepRow | null } | null>(null);
  const [bMembers, setBMembers] = useState<{ building_id: string; user_id: string }[]>([]);
  useEffect(() => {
    if (!reassign) return;
    supabase.from("building_members").select("building_id,user_id").then(({ data }) => setBMembers(data ?? []));
  }, [reassign]);

  const load = useCallback(async () => {
    const [a, b, c, m, dl] = await Promise.all([
      supabase.from("tasks").select("*, assignee:profiles!tasks_assignee_id_fkey(full_name,phone), creator:profiles!tasks_created_by_fkey(full_name), building:buildings(code,name)").eq("id", id!).maybeSingle(),
      supabase.from("tasks").select("*, members:task_assignees(user_id)").eq("parent_id", id!).order("sort_order").order("created_at"),
      supabase.from("task_updates").select(UPD_SELECT).eq("task_id", id!).order("created_at", { ascending: false }),
      supabase.from("task_assignees").select("user_id").eq("task_id", id!).order("created_at"),
      loadDeadlines({ task: id! }),
    ]);
    if (!a.data) { setNotFound(true); return; }
    const d = a.data as Detail;
    if (d.parent_id) {
      const p = await supabase.from("tasks").select("*, creator:profiles!tasks_created_by_fkey(full_name), members:task_assignees(user_id)").eq("id", d.parent_id).maybeSingle();
      setParent((p.data as Parent) ?? null);
    } else setParent(null);
    setDls(dl);
    setMembers(((m.data ?? []) as { user_id: string }[]).map((x) => x.user_id));
    setT(d);
    setSteps(((b.data ?? []) as (Task & { members: { user_id: string }[] })[]).map((s) => ({ ...s, members: s.members.map((x) => x.user_id) })));
    setUpdates((c.data as unknown as UpdateRow[]) ?? []);
  }, [id]);

  useEffect(() => { setT(null); setNotFound(false); load(); }, [load]);
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

  const nameOf = useCallback((uid: string | null | undefined) => people.find((p) => p.id === uid)?.full_name ?? "—", [people]);
  const toMember = useCallback((uid: string): TeamMember => ({ id: uid, name: nameOf(uid), sub: dir.get(uid)?.job_title }), [nameOf, dir]);
  // Nhóm làm việc chính: người chính + người cùng làm. Người làm hạng mục chọn trong nhóm này.
  const team = useMemo<TeamMember[]>(() => {
    if (!t) return [];
    const ids = t.parent_id
      ? [parent?.assignee_id, ...(parent?.members ?? []).map((x) => x.user_id)]
      : [t.assignee_id, ...members];
    return [...new Set(ids.filter(Boolean) as string[])].map(toMember);
  }, [t, parent, members, toMember]);

  if (notFound) return (<><TopBar title="Công việc" back="/viec" /><main className="main"><Empty title="Không tìm thấy việc này">Có thể việc đã bị xoá hoặc bạn không có quyền xem.</Empty></main></>);
  if (!t || !profile) return (<><TopBar title="Công việc" back="/viec" /><div className="loading">Đang tải…</div></>);

  const me = profile.id;
  const isStep = !!t.parent_id;
  const supOfBuilding = isSupervisor && !!t.building_id && myBuildingIds.includes(t.building_id);
  // Người giao: việc chính → Quản lý / người giao / Giám sát toà; hạng mục → thêm người giao việc chính
  const isOwner = isStep
    ? isManager || t.created_by === me || parent?.created_by === me || supOfBuilding
    : isManager || (isSupervisor && t.created_by === me) || supOfBuilding;
  const isAssignee = t.assignee_id === me || members.includes(me);
  const inTeam = team.some((x) => x.id === me);
  const canUpdate = isOwner || isAssignee || (isStep && inTeam);
  const d = dueInfo(t.due_date, t.status === "xong");
  const doneSteps = steps.filter((s) => s.status === "xong").length;
  const pendingMine = dls.find((x) => x.status === "cho_duyet" && (isStep || !x.item_id));
  const canExtend = isAssignee && t.created_by !== me && t.status !== "xong" && !pendingMine;
  const canReassign = !isStep && isOwner && t.status !== "xong";
  const giver = t.creator?.full_name ?? "người giao";
  const canEditStep = (s: StepRow) => isManager || s.created_by === me || t.created_by === me || supOfBuilding;
  const pendingStep = (sid: string) => dls.find((x) => x.status === "cho_duyet" && x.item_id === sid);

  async function setStatus(s: TaskStatus) {
    if (!t || s === t.status) return;
    const prev = t.status;
    setT({ ...t, status: s });
    const { error } = await supabase.from("tasks").update({ status: s }).eq("id", t.id);
    if (error) { setT({ ...t, status: prev }); toast(friendlyError(error)); return; }
    toast(`Đã chuyển sang "${STATUS_LABEL[s]}".`);
    load();
  }

  async function toggleStep(s: StepRow) {
    const next: TaskStatus = s.status === "xong" ? "dang_lam" : "xong";
    setSteps(steps.map((x) => (x.id === s.id ? { ...x, status: next, progress: next === "xong" ? 100 : x.progress } : x)));
    const { error } = await supabase.from("tasks").update({ status: next }).eq("id", s.id);
    if (error) { toast(friendlyError(error)); load(); return; }
    if (next === "xong" && t!.status === "chua_lam") await setStatus("dang_lam");
    else load();
  }

  async function remove() {
    const { error } = await supabase.from("tasks").delete().eq("id", t!.id);
    if (error) { toast(friendlyError(error)); return; }
    toast("Đã xoá việc.");
    nav("/viec", { replace: true });
  }

  function askExtend() {
    setExtendNow((n) => n + 1);
    setTimeout(() => document.getElementById("feedback")?.scrollIntoView({ behavior: "smooth", block: "start" }), 50);
  }

  const people2 = (main: string | null, others: string[]) => (
    <>{main ? <b>{nameOf(main)}</b> : "—"}{others.length ? <> · phụ: {others.map(nameOf).join(", ")}</> : null}</>
  );

  return (
    <>
      <TopBar title={isStep ? "Hạng mục" : "Chi tiết việc"} back={isStep ? `/viec/${t.parent_id}` : "/viec"}
        action={isStep
          ? (isOwner && parent ? <button type="button" className="tb-action" onClick={() => setStepSheet({ step: { ...t, members } })}>Sửa</button> : null)
          : (isOwner ? <Link className="tb-action" to={`/viec/${t.id}/sua`} style={{ color: "inherit" }}>Sửa</Link> : null)} />
      <main className="main stack">
        <section className="card detail-head">
          {isStep && parent ? (
            <div className="tw-parent"><span className="muted">Thuộc việc</span><Link to={`/viec/${parent.id}`}>{parent.title}</Link>
              {parent.due_date ? <span className="muted">· hạn {ddmm(parent.due_date)}</span> : null}</div>
          ) : null}
          <div className="row">
            {t.building ? <span className="tag">{t.building.code}</span> : null}
            {d ? <span className={`due ${d.tone}`}>{d.text}</span> : null}
            {t.priority !== "binh_thuong" ? <span className={t.priority === "thap" ? "muted small" : "prio"}>{PRIORITY_LABEL[t.priority]}</span> : null}
          </div>
          <h2>{t.title}</h2>
          <ProgressLine t={t} />
          <div className="seg" role="group" aria-label="Trạng thái">
            {STATUS_ORDER.map((s) => (
              <button key={s} className={s} aria-pressed={t.status === s} disabled={!canUpdate} onClick={() => setStatus(s)}>
                {STATUS_LABEL[s]}
              </button>
            ))}
          </div>
        </section>

        <dl className="card kv">
          <dt>KPI</dt><dd>{kpiLine(t) || <span className="muted">Chưa đặt KPI{isOwner ? " — bấm Sửa để thêm" : ""}</span>}</dd>
          <dt>Người chính</dt>
          <dd>{t.assignee?.full_name ?? "—"}{t.assignee?.phone && t.assignee_id !== me ? <> · <a href={`tel:${t.assignee.phone}`}>{t.assignee.phone}</a></> : null}
            {t.assignee_id && dir.get(t.assignee_id) ? <small className="muted kv-sub">{dirLine(dir.get(t.assignee_id))}</small> : null}
            {canReassign ? <button type="button" className="btn ghost sm" style={{ marginTop: 4 }} onClick={() => setReassign(true)}>Đổi người chính</button> : null}</dd>
          {members.length ? (<><dt>Người phụ</dt><dd>{members.map((uid) => {
            const dd = dir.get(uid);
            return <span key={uid} className="kv-person">{nameOf(uid)}{dd ? <small className="muted"> · {dd.job_title}</small> : null}</span>;
          })}</dd></>) : null}
          <dt>Người giao</dt><dd>{giver}</dd>
          {t.building ? (<><dt>Toà nhà</dt><dd>{t.building.code} · {t.building.name}</dd></>) : null}
          <dt>Hạn</dt><dd>{t.due_date ? ddmmyyyy(t.due_date) : "Không đặt hạn"}{pendingMine && (isStep || !pendingMine.item_id) ? <> <span className="dl-tag">xin gia hạn → {ddmmyyyy(pendingMine.new_due)}</span></> : null}</dd>
          {t.completed_at ? (<><dt>Hoàn thành</dt><dd>{clock(t.completed_at)}</dd></>) : null}
          {t.description ? (<><dt>Nội dung</dt><dd className="desc">{t.description}</dd></>) : null}
        </dl>

        {!isStep ? (
          <>
            <div className="section-title">Hạng mục {steps.length ? <span className="num">({doneSteps}/{steps.length} xong)</span> : null}</div>
            <section className="card">
              {steps.length ? (
                <ul className="tw-steps">
                  {steps.map((s) => {
                    const sd = dueInfo(s.due_date, s.status === "xong");
                    const pend = pendingStep(s.id);
                    return (
                      <li key={s.id} className={s.status === "xong" ? "done" : ""}>
                        <input type="checkbox" checked={s.status === "xong"} disabled={!canUpdate}
                          onChange={() => toggleStep(s)} aria-label={`Xong: ${s.title}`} />
                        <Link className="tw-step" to={`/viec/${s.id}`}>
                          <span className="t">{s.title}</span>
                          <span className="meta">
                            <span>{people2(s.assignee_id, s.members)}</span>
                            {sd ? <span className={`due ${sd.tone}`}>{sd.text}</span> : <span>Chưa đặt hạn</span>}
                            {s.status === "vuong" ? <span className="pill vuong">{STATUS_LABEL.vuong}</span> : null}
                            {pend ? <span className="dl-tag">xin gia hạn → {ddmm(pend.new_due)}</span> : null}
                          </span>
                          {kpiLine(s) ? <span className="tw-step-kpi">KPI: {kpiLine(s)}</span> : null}
                          <ProgressLine t={s} compact />
                        </Link>
                        {canEditStep(s) ? (
                          <button type="button" className="btn ghost sm tw-step-edit" aria-label={`Sửa hạng mục ${s.title}`}
                            onClick={() => setStepSheet({ step: s })}>Sửa</button>
                        ) : null}
                      </li>
                    );
                  })}
                </ul>
              ) : <p className="muted small" style={{ padding: "12px 16px", margin: 0 }}>Chưa chia hạng mục. Việc lớn nên chia hạng mục, mỗi hạng mục có người chính, KPI và hạn riêng.</p>}
              {canUpdate ? (
                <div className="tw-add">
                  <button type="button" className="btn secondary sm" onClick={() => setStepSheet({ step: null })}>+ Giao hạng mục</button>
                </div>
              ) : null}
            </section>
          </>
        ) : null}

        <DeadlineList list={dls} onChanged={load} showItem={!isStep} />
        {canExtend ? (
          <div className="dl-ask">
            <span>{t.status === "vuong" || (t.due_date && t.due_date < todayVN()) ? "Đang vướng hoặc trễ hạn?" : "Không kịp hạn?"} Gửi phản hồi kèm vấn đề, nguyên nhân, giải pháp và hạn mới cho {giver} duyệt.</span>
            <button type="button" className="btn secondary sm" onClick={askExtend}>Xin gia hạn</button>
          </div>
        ) : null}

        <div className="section-title">Phản hồi tiến độ</div>
        {canUpdate ? <FeedbackForm t={t} giver={giver} canExtend={canExtend} extendNow={extendNow} onDone={load} /> : null}
        <section className="card">
          {updates.length ? (
            <ul className="timeline">
              {updates.map((u) => (
                <li key={u.id}>
                  <div className="row"><span className="who">{u.author?.full_name ?? "?"}</span><span className="when">{clock(u.created_at)}</span>
                    {u.status_after ? <span className={`pill ${u.status_after}`}>{STATUS_LABEL[u.status_after]}</span> : null}</div>
                  <UpdateBody u={u} unit={t.kpi_unit} />
                </li>
              ))}
            </ul>
          ) : <p className="muted small" style={{ padding: "12px 16px", margin: 0 }}>Chưa có phản hồi nào.</p>}
        </section>

        {!isStep && isOwner ? (
          <button className="btn danger" style={{ marginTop: 12 }} onClick={() => setConfirmDel(true)}>Xoá việc này</button>
        ) : null}
        <RelatedPanel type="task" id={t.id} />
      </main>

      {stepSheet && (isStep ? parent : t) ? (
        <StepSheet open onClose={() => setStepSheet(null)} parent={(isStep ? parent : t)!} team={team} step={stepSheet.step}
          canDelete={!!stepSheet.step && (isManager || stepSheet.step.created_by === me)}
          onDone={load} onDeleted={isStep ? () => nav(`/viec/${t.parent_id}`, { replace: true }) : load} />
      ) : null}
      {canReassign ? (
        <ReassignSheet open={reassign} onClose={() => setReassign(false)} title="Đổi người chính" what={t.title}
          current={t.assignee_id} currentName={t.assignee?.full_name ?? "chưa có"}
          candidates={assignableFor({ me: profile, people, members: bMembers, buildingId: t.building_id ?? "", isManager, dir })}
          keepLabel={`Giữ ${t.assignee?.full_name ?? "người cũ"} lại làm người phụ`}
          onSave={(u, keep, n) => changeTaskMain(t.id, u, keep, n)} onDone={load} />
      ) : null}
      <Sheet open={confirmDel} onClose={() => setConfirmDel(false)} title="Xoá việc này?">
        <p className="muted" style={{ marginTop: 0 }}>Việc "{t.title}" cùng các hạng mục và phản hồi sẽ bị xoá hẳn, không khôi phục được.</p>
        <div className="row">
          <button className="btn secondary" style={{ flex: 1 }} onClick={() => setConfirmDel(false)}>Giữ lại</button>
          <button className="btn danger" style={{ flex: 1 }} onClick={remove}>Xoá</button>
        </div>
      </Sheet>
    </>
  );
}
