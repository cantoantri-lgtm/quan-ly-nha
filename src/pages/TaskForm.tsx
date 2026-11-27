import { useEffect, useMemo, useState, type FormEvent } from "react";
import { useNavigate, useParams, useSearchParams } from "react-router-dom";
import { friendlyError, supabase } from "../lib/supabase";
import { useSession } from "../lib/session";
import { PRIORITY_LABEL, ROLE_LABEL, type Priority, type Task } from "../lib/labels";
import { TopBar } from "../components/ui";
import { LinkFromNote, useLinkFrom } from "../components/RelatedPanel";
import { addLink } from "../lib/links";
import { ddmmyyyy } from "../lib/dates";
import { dirLine, useDirectory } from "../lib/directory";
import { assignableFor } from "../lib/reassign";
import { setStepPeople } from "../lib/tasks";
import { Combo } from "../components/ui";
import { KpiFields, kpiError, kpiFrom, kpiRow, type KpiValue } from "../components/TaskWork";

type StepDraft = { title: string; due: string; kpi: string; main: string; others: string[] };
const emptyStep = (due = ""): StepDraft => ({ title: "", due, kpi: "", main: "", others: [] });

export default function TaskForm() {
  const { id } = useParams();
  const editing = !!id;
  const { profile, people, buildings, isManager, isSupervisor, toast } = useSession();
  const canAssign = isManager || isSupervisor;
  const nav = useNavigate();
  // Điền sẵn khi mở từ đề xuất của Báo cáo AI: /viec/moi?tieu-de=&mo-ta=&han=&uu-tien=&toa=
  const [sp] = useSearchParams();
  const pre = (k: string) => (id ? "" : sp.get(k) ?? "");

  const [title, setTitle] = useState(() => pre("tieu-de").slice(0, 200));
  const [description, setDescription] = useState(() => pre("mo-ta").slice(0, 2000));
  const [buildingId, setBuildingId] = useState(() => {
    const b = pre("toa");
    if (b && buildings.some((x) => x.id === b)) return b;
    return buildings.length === 1 ? buildings[0].id : "";
  });
  const [assigneeId, setAssigneeId] = useState(canAssign ? "" : profile?.id ?? "");   // người phụ trách chính
  const [picked, setPicked] = useState<string[]>([]);                                   // tất cả người làm (gồm người chính)
  const [due, setDue] = useState(() => (/^\d{4}-\d{2}-\d{2}$/.test(pre("han")) ? pre("han") : ""));
  const [priority, setPriority] = useState<Priority>(() => {
    const p = pre("uu-tien");
    return p in PRIORITY_LABEL ? (p as Priority) : "binh_thuong";
  });
  // Trang Giao việc đang mở sẵn (tab PC) mà bấm "Tạo việc" từ AI lần nữa: điền lại theo đề xuất mới
  const preKey = id ? "" : sp.toString();
  useEffect(() => {
    if (!preKey || !sp.get("tieu-de")) return;
    setTitle(pre("tieu-de").slice(0, 200)); setDescription(pre("mo-ta").slice(0, 2000));
    if (/^\d{4}-\d{2}-\d{2}$/.test(pre("han"))) setDue(pre("han"));
    if (pre("uu-tien") in PRIORITY_LABEL) setPriority(pre("uu-tien") as Priority);
    if (buildings.some((x) => x.id === pre("toa"))) setBuildingId(pre("toa"));
  }, [preKey]);   // eslint-disable-line react-hooks/exhaustive-deps
  const [kpi, setKpi] = useState<KpiValue>(kpiFrom(null));
  const [steps, setSteps] = useState<StepDraft[]>([emptyStep()]);
  const patchStep = (i: number, v: Partial<StepDraft>) => setSteps((list) => list.map((x, j) => (j === i ? { ...x, ...v } : x)));
  const [members, setMembers] = useState<{ building_id: string; user_id: string }[]>([]);
  const [busy, setBusy] = useState(false);
  const dir = useDirectory();
  const [err, setErr] = useState<string | null>(null);
  const link = useLinkFrom(!id);   // tạo việc từ phản ánh / phòng / đề nghị…: gắn liên kết sau khi lưu
  useEffect(() => { if (link.info?.parent && !buildingId && buildings.some((b) => b.id === link.info!.parent)) setBuildingId(link.info.parent); }, [link.info]);   // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (!canAssign) return;
    supabase.from("building_members").select("building_id,user_id").then(({ data }) => setMembers(data ?? []));
  }, [canAssign]);

  useEffect(() => {
    if (!id) return;
    supabase.from("tasks").select("*").eq("id", id).single().then(({ data, error }) => {
      if (error || !data) { setErr("Không tìm thấy việc này."); return; }
      const t = data as Task;
      setTitle(t.title); setDescription(t.description ?? ""); setBuildingId(t.building_id ?? "");
      setAssigneeId(t.assignee_id ?? ""); setDue(t.due_date ?? ""); setPriority(t.priority); setKpi(kpiFrom(t));
      supabase.from("task_assignees").select("user_id").eq("task_id", id).then(({ data: m }) => {
        setPicked([...(t.assignee_id ? [t.assignee_id] : []), ...((m ?? []) as { user_id: string }[]).map((x) => x.user_id)]);
      });
    });
  }, [id]);

  // Người được giao: cấp dưới (hoặc chính mình). Giám sát chỉ thấy nhân viên cùng toà.
  const assignable = useMemo(
    () => (profile ? assignableFor({ me: profile, people, members, buildingId, isManager, dir }) : []),
    [people, profile, buildingId, members, isManager, dir]);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setErr(null);
    if (!title.trim()) { setErr("Nhập tên việc."); return; }
    const main = canAssign ? (picked.includes(assigneeId) ? assigneeId : picked[0] ?? "") : assigneeId;
    if (!main) { setErr("Chọn người làm."); return; }
    const others = canAssign ? picked.filter((x) => x !== main) : [];
    const forOthers = main !== profile?.id || others.length > 0;
    const ke = kpiError(kpi, !editing && forOthers); if (ke) { setErr(ke); return; }
    if (!editing && forOthers && !due) { setErr("Đặt hạn hoàn thành cho việc giao."); return; }
    const drafts = editing ? [] : steps.filter((s) => s.title.trim());
    if (due && drafts.some((s) => s.due && s.due > due)) { setErr(`Có hạng mục hạn sau hạn của việc (${ddmmyyyy(due)}).`); return; }
    setBusy(true);
    const row = {
      title: title.trim(), description: description.trim() || null, building_id: buildingId || null,
      assignee_id: main, due_date: due || null, priority, ...kpiRow(kpi),
    };
    if (editing) {
      const { error } = await supabase.from("tasks").update(row).eq("id", id!);
      if (error) { setBusy(false); setErr(friendlyError(error)); return; }
      if (canAssign) {
        const m = await supabase.rpc("task_set_members", { p_task: id!, p_users: others });
        if (m.error) { setBusy(false); setErr("Đã lưu việc nhưng chưa cập nhật được người cùng làm: " + friendlyError(m.error)); return; }
      }
      setBusy(false);
      toast("Đã lưu thay đổi.");
      nav(`/viec/${id}`, { replace: true });
      return;
    }
    const { data, error } = await supabase.from("tasks").insert(row).select("id").single();
    if (error || !data) { setBusy(false); setErr(friendlyError(error)); return; }
    if (others.length) {
      const m = await supabase.rpc("task_set_members", { p_task: data.id, p_users: others });
      if (m.error) { setBusy(false); setErr("Đã giao việc cho người chính nhưng chưa thêm được người cùng làm: " + friendlyError(m.error)); nav(`/viec/${data.id}/sua`, { replace: true }); return; }
    }
    const team = [main, ...others];
    const stepRows = drafts.map((s, i) => ({
      parent_id: data.id, title: s.title.trim(), due_date: s.due || null, sort_order: i + 1,
      kpi: s.kpi.trim() || null, assignee_id: team.includes(s.main) ? s.main : main,
    }));
    if (stepRows.length) {
      const r = await supabase.from("tasks").insert(stepRows).select("id,sort_order");
      if (r.error) { setBusy(false); setErr("Đã tạo việc nhưng chưa thêm được hạng mục: " + friendlyError(r.error)); nav(`/viec/${data.id}`, { replace: true }); return; }
      for (const [i, s] of drafts.entries()) {
        const sub = s.others.filter((x) => team.includes(x) && x !== stepRows[i].assignee_id);
        const sid = (r.data ?? []).find((x) => x.sort_order === i + 1)?.id;
        if (!sub.length || !sid) continue;
        try { await setStepPeople(sid, stepRows[i].assignee_id, sub); }
        catch (e2) { toast("Chưa thêm được người phụ cho hạng mục " + s.title + ": " + (e2 as Error).message); }
      }
    }
    if (link.from) {
      const le = await addLink("task", data.id, link.from.type, link.from.id);
      if (le) { setBusy(false); toast("Đã tạo việc nhưng chưa gắn được liên kết: " + friendlyError({ message: le })); nav(`/viec/${data.id}`, { replace: true }); return; }
    }
    setBusy(false);
    toast(main === profile?.id && !others.length ? "Đã thêm việc." : others.length ? `Đã giao việc cho ${others.length + 1} người. Mọi người sẽ nhận thông báo.` : "Đã giao việc. Người làm sẽ nhận thông báo.");
    nav(`/viec/${data.id}`, { replace: true });
  }

  const mainId = canAssign ? (picked.includes(assigneeId) ? assigneeId : picked[0] ?? "") : assigneeId;
  const teamIds = canAssign ? [mainId, ...picked.filter((x) => x !== mainId)].filter(Boolean) : [assigneeId].filter(Boolean);
  const nameOf = (pid: string) => (pid === profile?.id ? "Tôi" : people.find((p) => p.id === pid)?.full_name ?? "?");

  return (
    <>
      <TopBar title={editing ? "Sửa việc" : canAssign ? "Giao việc" : "Thêm việc"} back />
      <main className="main">
        <form className="stack" onSubmit={submit}>
          <LinkFromNote from={link.from} info={link.info} />
          <label className="field">
            <span>Tên việc *</span>
            <input id="t-title" className="input" value={title} onChange={(e) => setTitle(e.target.value)}
              placeholder="VD: Dán bảng số tầng" required />
          </label>
          <label className="field">
            <span>Mô tả, yêu cầu</span>
            <textarea id="t-desc" className="input" value={description} onChange={(e) => setDescription(e.target.value)}
              placeholder="Yêu cầu cụ thể, người liên hệ, lưu ý…" />
          </label>
          <KpiFields idPrefix="t" value={kpi} onChange={setKpi} required={!editing && (canAssign ? picked.some((x) => x !== profile?.id) : false)} />
          {buildings.length ? (
            <label className="field">
              <span>Toà nhà</span>
              <select id="t-building" className="input" value={buildingId} onChange={(e) => setBuildingId(e.target.value)}>
                <option value="">Không gắn toà</option>
                {buildings.map((b) => <option key={b.id} value={b.id}>{b.code} · {b.name}</option>)}
              </select>
            </label>
          ) : null}
          {canAssign ? (
            <>
            <fieldset className="field" style={{ border: 0, padding: 0, margin: 0 }}>
              <legend style={{ padding: 0 }}><span>Người làm * <small className="muted">(chọn một hoặc nhiều người, sau đó chọn người chính)</small></span></legend>
              <div className="checks" style={{ maxHeight: 280, overflowY: "auto" }}>
                {[...assignable, ...people.filter((p) => picked.includes(p.id) && !assignable.some((a) => a.id === p.id))].map((p) => (
                  <label key={p.id}>
                    <input type="checkbox" checked={picked.includes(p.id)}
                      onChange={(e) => setPicked(e.target.checked ? [...picked, p.id] : picked.filter((x) => x !== p.id))} />
                    <span className="pick-who">
                      <b>{p.id === profile?.id ? `Tôi (${p.full_name})` : p.full_name}</b>
                      <small>{dirLine(dir.get(p.id)) || `${ROLE_LABEL[p.role]} · chưa xếp vị trí trên sơ đồ`}</small>
                    </span>
                    {picked.length > 1 ? (assigneeId === p.id || (!picked.includes(assigneeId) && picked[0] === p.id) ? <span className="tag">Người chính</span> : picked.includes(p.id) ? <span className="tag muted">Người phụ</span> : null) : null}
                  </label>
                ))}
              </div>
              {buildingId && assignable.length <= 1 ? (
                <small className="muted">Toà này chưa có nhân sự. Vào Quản trị → Nhân sự để gán người vào toà.</small>
              ) : null}
            </fieldset>
            {picked.length > 1 ? (
              <label className="field">
                <span>Người chính</span>
                <select id="t-main" className="input" value={picked.includes(assigneeId) ? assigneeId : picked[0]} onChange={(e) => setAssigneeId(e.target.value)}>
                  {picked.map((pid) => { const d = dir.get(pid); return <option key={pid} value={pid}>{people.find((p) => p.id === pid)?.full_name ?? "?"}{d ? ` · ${d.job_title}` : ""}</option>; })}
                </select>
                <small className="muted">Người chính chịu trách nhiệm KPI. Người phụ hỗ trợ, cùng gửi phản hồi tiến độ.</small>
              </label>
            ) : null}
            </>
          ) : null}
          <div className="row" style={{ alignItems: "flex-start" }}>
            <label className="field" style={{ flex: "1 1 160px" }}>
              <span>Hạn hoàn thành{!editing && canAssign && picked.some((x) => x !== profile?.id) ? " *" : ""}</span>
              <input id="t-due" className="input" type="date" value={due} onChange={(e) => setDue(e.target.value)} />
            </label>
            <label className="field" style={{ flex: "1 1 160px" }}>
              <span>Mức độ</span>
              <select id="t-prio" className="input" value={priority} onChange={(e) => setPriority(e.target.value as Priority)}>
                {(Object.keys(PRIORITY_LABEL) as Priority[]).map((k) => <option key={k} value={k}>{PRIORITY_LABEL[k]}</option>)}
              </select>
            </label>
          </div>

          {!editing ? (
            <div className="field">
              <span>Hạng mục <small className="muted">(không bắt buộc – chia việc lớn thành phần nhỏ)</small></span>
              <div className="stack" style={{ gap: 10 }}>
                {steps.map((s, i) => {
                  const stepMain = teamIds.includes(s.main) ? s.main : mainId;
                  return (
                    <div key={i} className="tw-form-step">
                      <div className="tw-form-step-head">
                        <b className="num">Hạng mục {i + 1}</b>
                        {steps.length > 1 ? (
                          <button type="button" className="btn ghost sm" aria-label={`Xoá hạng mục ${i + 1}`}
                            onClick={() => setSteps(steps.filter((_, j) => j !== i))}>Xoá</button>
                        ) : null}
                      </div>
                      <input id={`t-step-${i}`} className="input" value={s.title} placeholder="Nội dung hạng mục" aria-label={`Nội dung hạng mục ${i + 1}`}
                        onChange={(e) => patchStep(i, { title: e.target.value })} />
                      {s.title.trim() ? (
                        <>
                          <input id={`t-step-kpi-${i}`} className="input" maxLength={500} value={s.kpi} placeholder="KPI hạng mục, VD: 10 phòng tầng 1"
                            aria-label={`KPI hạng mục ${i + 1}`} onChange={(e) => patchStep(i, { kpi: e.target.value })} />
                          <div className="tw-kpi-num">
                            {teamIds.length > 1 ? (
                              <Combo id={`t-step-main-${i}`} label={`Người chính hạng mục ${i + 1}`} value={stepMain}
                                options={teamIds.map((pid) => [pid, `Chính: ${nameOf(pid)}`] as const)}
                                onChange={(v) => patchStep(i, { main: v, others: s.others.filter((x) => x !== v) })} />
                            ) : null}
                            <input id={`t-step-due-${i}`} className="input" type="date" value={s.due} aria-label={`Hạn hạng mục ${i + 1}`} title="Hạn hạng mục (để trống = theo hạn việc)"
                              max={due || undefined} onChange={(e) => patchStep(i, { due: e.target.value })} />
                          </div>
                          {teamIds.length > 1 ? (
                            <div className="checks tw-checks" aria-label={`Người phụ hạng mục ${i + 1}`}>
                              {teamIds.filter((pid) => pid !== stepMain).map((pid) => (
                                <label key={pid}>
                                  <input type="checkbox" checked={s.others.includes(pid)}
                                    onChange={(e) => patchStep(i, { others: e.target.checked ? [...s.others, pid] : s.others.filter((x) => x !== pid) })} />
                                  <span className="pick-who"><b>Phụ: {nameOf(pid)}</b></span>
                                </label>
                              ))}
                            </div>
                          ) : null}
                        </>
                      ) : null}
                    </div>
                  );
                })}
                {due && steps.some((s) => s.due && s.due > due) ? <small className="err-text">Có hạng mục hạn sau hạn của việc ({ddmmyyyy(due)}). Kiểm tra lại ngày.</small> : null}
                <button type="button" className="btn secondary sm" style={{ justifySelf: "start" }}
                  onClick={() => setSteps([...steps, emptyStep(steps[steps.length - 1]?.due ?? "")])}>
                  + Thêm hạng mục
                </button>
                <small className="muted">Mỗi hạng mục có người chính, người phụ, KPI và hạn riêng. Để trống hạn thì lấy theo hạn của việc. Người làm hạng mục chọn trong nhóm người làm ở trên.</small>
              </div>
            </div>
          ) : null}

          {err ? <div className="error-box" role="alert">{err}</div> : null}
          <button className="btn block" disabled={busy}>
            {busy ? "Đang lưu…" : editing ? "Lưu thay đổi" : canAssign && picked.some((x) => x !== profile?.id) ? (picked.length > 1 ? `Giao việc cho ${picked.length} người` : "Giao việc") : "Thêm việc"}
          </button>
        </form>
      </main>
    </>
  );
}
