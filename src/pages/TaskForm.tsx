import { useEffect, useMemo, useState, type FormEvent } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { friendlyError, supabase } from "../lib/supabase";
import { useSession } from "../lib/session";
import { PRIORITY_LABEL, ROLE_LABEL, ROLE_RANK, type Priority, type Task } from "../lib/labels";
import { TopBar } from "../components/ui";

export default function TaskForm() {
  const { id } = useParams();
  const editing = !!id;
  const { profile, people, buildings, isManager, isSupervisor, toast } = useSession();
  const canAssign = isManager || isSupervisor;
  const nav = useNavigate();

  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [buildingId, setBuildingId] = useState(buildings.length === 1 ? buildings[0].id : "");
  const [assigneeId, setAssigneeId] = useState(canAssign ? "" : profile?.id ?? "");
  const [due, setDue] = useState("");
  const [priority, setPriority] = useState<Priority>("binh_thuong");
  const [steps, setSteps] = useState<string[]>([""]);
  const [members, setMembers] = useState<{ building_id: string; user_id: string }[]>([]);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

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
      setAssigneeId(t.assignee_id ?? ""); setDue(t.due_date ?? ""); setPriority(t.priority);
    });
  }, [id]);

  // Người được giao: cấp dưới (hoặc chính mình). Giám sát chỉ thấy nhân viên cùng toà.
  const assignable = useMemo(() => {
    if (!profile) return [];
    const myRank = ROLE_RANK[profile.role];
    return people.filter((p) => {
      if (!p.is_active) return false;
      if (p.id === profile.id) return true;
      if (ROLE_RANK[p.role] >= myRank) return false;
      if (buildingId && members.length) return members.some((m) => m.building_id === buildingId && m.user_id === p.id);
      if (!isManager) return members.some((m) => m.user_id === p.id);
      return true;
    }).sort((a, b) => (a.id === profile.id ? -1 : b.id === profile.id ? 1 : a.full_name.localeCompare(b.full_name, "vi")));
  }, [people, profile, buildingId, members, isManager]);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setErr(null);
    if (!title.trim()) { setErr("Nhập tên việc."); return; }
    if (!assigneeId) { setErr("Chọn người làm."); return; }
    setBusy(true);
    const row = {
      title: title.trim(), description: description.trim() || null, building_id: buildingId || null,
      assignee_id: assigneeId, due_date: due || null, priority,
    };
    if (editing) {
      const { error } = await supabase.from("tasks").update(row).eq("id", id!);
      setBusy(false);
      if (error) { setErr(friendlyError(error)); return; }
      toast("Đã lưu thay đổi.");
      nav(`/viec/${id}`, { replace: true });
      return;
    }
    const { data, error } = await supabase.from("tasks").insert(row).select("id").single();
    if (error || !data) { setBusy(false); setErr(friendlyError(error)); return; }
    const stepRows = steps.map((s) => s.trim()).filter(Boolean)
      .map((s, i) => ({ parent_id: data.id, title: s, sort_order: i + 1 }));
    if (stepRows.length) {
      const r = await supabase.from("tasks").insert(stepRows);
      if (r.error) { setBusy(false); setErr("Đã tạo việc nhưng chưa thêm được các bước: " + friendlyError(r.error)); return; }
    }
    setBusy(false);
    toast(assigneeId === profile?.id ? "Đã thêm việc." : "Đã giao việc. Người làm sẽ nhận thông báo.");
    nav(`/viec/${data.id}`, { replace: true });
  }

  return (
    <>
      <TopBar title={editing ? "Sửa việc" : canAssign ? "Giao việc" : "Thêm việc"} back />
      <main className="main">
        <form className="stack" onSubmit={submit}>
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
            <label className="field">
              <span>Người làm *</span>
              <select id="t-assignee" className="input" value={assigneeId} onChange={(e) => setAssigneeId(e.target.value)} required>
                <option value="">Chọn người</option>
                {assignable.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.id === profile?.id ? `Tôi (${p.full_name})` : `${p.full_name} · ${ROLE_LABEL[p.role]}`}
                  </option>
                ))}
              </select>
              {buildingId && assignable.length <= 1 ? (
                <small className="muted">Toà này chưa có nhân sự. Vào Quản trị → Nhân sự để gán người vào toà.</small>
              ) : null}
            </label>
          ) : null}
          <div className="row" style={{ alignItems: "flex-start" }}>
            <label className="field" style={{ flex: "1 1 160px" }}>
              <span>Hạn hoàn thành</span>
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
              <span>Các bước thực hiện (không bắt buộc)</span>
              <div className="stack" style={{ gap: 8 }}>
                {steps.map((s, i) => (
                  <div key={i} className="row" style={{ flexWrap: "nowrap" }}>
                    <span className="muted num" style={{ width: 20, textAlign: "right" }}>{i + 1}.</span>
                    <input id={`t-step-${i}`} className="input" value={s} placeholder="Tên bước"
                      onChange={(e) => setSteps(steps.map((x, j) => (j === i ? e.target.value : x)))} />
                    {steps.length > 1 ? (
                      <button type="button" className="btn ghost sm" aria-label={`Xoá bước ${i + 1}`}
                        onClick={() => setSteps(steps.filter((_, j) => j !== i))}>Xoá</button>
                    ) : null}
                  </div>
                ))}
                <button type="button" className="btn secondary sm" style={{ justifySelf: "start" }} onClick={() => setSteps([...steps, ""])}>
                  + Thêm bước
                </button>
              </div>
            </div>
          ) : null}

          {err ? <div className="error-box" role="alert">{err}</div> : null}
          <button className="btn block" disabled={busy}>
            {busy ? "Đang lưu…" : editing ? "Lưu thay đổi" : canAssign && assigneeId && assigneeId !== profile?.id ? "Giao việc" : "Thêm việc"}
          </button>
        </form>
      </main>
    </>
  );
}
