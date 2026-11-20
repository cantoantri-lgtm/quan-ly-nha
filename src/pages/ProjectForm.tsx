import { useEffect, useId, useState, type FormEvent } from "react";
import { Navigate, useNavigate, useParams } from "react-router-dom";
import { friendlyError, supabase } from "../lib/supabase";
import { useSession } from "../lib/session";
import { addDaysISO, todayVN } from "../lib/dates";
import { parseMoney, vnd } from "../lib/money";
import { loaLeft, type LoaPick } from "../lib/office";
import { PROJECT_STATUS, loadProject, setMembers } from "../lib/project";
import { LoaPicker } from "../components/LoaPicker";
import { PeoplePick } from "../components/ProjectUI";
import { Icon, TopBar } from "../components/ui";
import "../office.css";
import "../projects.css";

/** Tạo / sửa dự án: tên, PIC, người hỗ trợ, thời gian, ngân sách tổng, LOA phê duyệt */
export default function ProjectForm() {
  const { id } = useParams();
  const editing = !!id;
  const nav = useNavigate();
  const { profile, people, buildings, isManager, isSupervisor, toast } = useSession();
  const staff = people.filter((p) => p.is_active);
  const [name, setName] = useState("");
  const [desc, setDesc] = useState("");
  const [pic, setPic] = useState(profile?.id ?? "");
  const [sup, setSup] = useState<string[]>([]);
  const [start, setStart] = useState(todayVN());
  const [end, setEnd] = useState(addDaysISO(todayVN(), 60));
  const [lockEnd, setLockEnd] = useState(false);   // PIC không phải người giao dự án: đổi hạn qua "Xin gia hạn"
  const [budget, setBudget] = useState("");
  const [loaId, setLoaId] = useState("");
  const [building, setBuilding] = useState("");
  const [status, setStatus] = useState("ke_hoach");
  const [picks, setPicks] = useState<LoaPick[] | null>(null);
  const [loaOpen, setLoaOpen] = useState(false);
  const [loaLabel, setLoaLabel] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [ready, setReady] = useState(!editing);
  const formId = "pj-form-" + useId().replace(/:/g, "");

  useEffect(() => {
    supabase.rpc("loa_pickable").then(({ data }) => setPicks((data ?? []) as LoaPick[]));
  }, []);
  useEffect(() => {
    if (!editing) return;
    (async () => {
      const d = await loadProject(id!);
      const p = d.project;
      if (!p) { setErr("Không tìm thấy dự án hoặc bạn không có quyền sửa."); setReady(true); return; }
      setName(p.name); setDesc(p.description ?? ""); setPic(p.pic_id); setSup(d.supporters); setStart(p.start_date); setEnd(p.end_date);
      setLockEnd(!isManager && p.created_by !== profile?.id);
      setBudget(p.budget ? new Intl.NumberFormat("vi-VN").format(p.budget) : ""); setLoaId(p.loa_id ?? ""); setBuilding(p.building_id ?? ""); setStatus(p.status);
      if (p.loa_id) {
        const { data } = await supabase.rpc("project_loa", { p_project: p.id });
        const l = ((data ?? []) as { doc_no: string | null; reason: string }[])[0];
        if (l) setLoaLabel(`${l.doc_no ?? ""} · ${l.reason}`);
      }
      setReady(true);
    })();
  }, [editing, id]);   // eslint-disable-line react-hooks/exhaustive-deps

  if (!editing && !(isManager || isSupervisor)) return <Navigate to="/du-an" replace />;
  const loa = picks?.find((x) => x.id === loaId);
  const amt = budget ? parseMoney(budget) : 0;

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (name.trim().length < 2) { setErr("Nhập tên dự án."); return; }
    if (!pic) { setErr("Chọn người phụ trách (PIC)."); return; }
    if (end < start) { setErr("Ngày kết thúc phải sau ngày bắt đầu."); return; }
    if (budget && amt == null) { setErr("Ngân sách chưa đúng định dạng."); return; }
    setBusy(true); setErr(null);
    const row = { name: name.trim(), description: desc.trim() || null, pic_id: pic, start_date: start, end_date: end, budget: amt ?? 0,
      loa_id: loaId || null, building_id: building || null, ...(editing ? { status } : { created_by: profile!.id }) };
    const res = editing
      ? await supabase.from("projects").update(row).eq("id", id!).select("id").single()
      : await supabase.from("projects").insert(row).select("id").single();
    if (res.error) { setBusy(false); setErr(friendlyError(res.error)); return; }
    const pid = res.data.id as string;
    const me = await setMembers("project_members", "project_id", pid, sup.filter((u) => u !== pic));
    setBusy(false);
    if (me) toast(`Đã lưu dự án, nhưng chưa lưu được người hỗ trợ: ${friendlyError({ message: me })}`);
    else toast(editing ? "Đã lưu dự án." : "Đã tạo dự án. Thêm hạng mục chính để lập Gantt.");
    nav(`/du-an/${pid}`, { replace: true });
  }

  return (
    <>
      <TopBar title={editing ? "Sửa dự án" : "Dự án mới"} back={editing ? `/du-an/${id}` : "/du-an"}
        action={<button className="tb-action" type="submit" form={formId} disabled={busy}>Lưu</button>} />
      <main className="main stack">
        {!ready ? <div className="loading">Đang tải…</div> : (
        <form id={formId} className="stack" onSubmit={submit}>
          <section className="card stack pj-sec">
            <label className="field"><span>Tên dự án <span className="req">*</span></span>
              <input id="pj-name" className="input" value={name} onChange={(e) => setName(e.target.value)} required maxLength={200} placeholder="VD: Cải tạo toà 89CMT8 thành căn hộ dịch vụ" /></label>
            <label className="field"><span>Mục tiêu, phạm vi</span>
              <textarea id="pj-desc" className="input" value={desc} onChange={(e) => setDesc(e.target.value)} maxLength={4000} placeholder="Kết quả cần đạt, phạm vi công việc, tiêu chí nghiệm thu…" /></label>
            <div className="row" style={{ alignItems: "flex-start" }}>
              <label className="field" style={{ flex: "1 1 150px" }}><span>Bắt đầu <span className="req">*</span></span>
                <input id="pj-start" type="date" className="input" value={start} required onChange={(e) => { setStart(e.target.value); if (end < e.target.value && !lockEnd) setEnd(e.target.value); }} /></label>
              <label className="field" style={{ flex: "1 1 150px" }}><span>Kết thúc <span className="req">*</span></span>
                <input id="pj-end" type="date" className="input" value={end} min={start} required disabled={lockEnd} onChange={(e) => setEnd(e.target.value)} />
                {lockEnd ? <small className="muted">Muốn lùi hạn: bấm "Xin gia hạn dự án" ở trang dự án để người giao duyệt.</small> : null}</label>
            </div>
            {editing ? (
              <label className="field"><span>Trạng thái</span>
                <select id="pj-status" className="input" value={status} onChange={(e) => setStatus(e.target.value)}>
                  {Object.entries(PROJECT_STATUS).map(([k, l]) => <option key={k} value={k}>{l}</option>)}
                </select></label>
            ) : null}
          </section>
          <section className="card stack pj-sec">
            <label className="field"><span>Người phụ trách (PIC) <span className="req">*</span></span>
              <select id="pj-pic" className="input" value={pic} onChange={(e) => { setPic(e.target.value); setSup(sup.filter((x) => x !== e.target.value)); }} required>
                <option value="">Chọn người…</option>
                {staff.map((p) => <option key={p.id} value={p.id}>{p.full_name}</option>)}
              </select>
              <small className="muted">PIC dự án sửa được kế hoạch, hạng mục và ngân sách hạng mục.</small></label>
            <PeoplePick id="pj-sup" label="Người hỗ trợ" people={staff} value={sup} onChange={setSup} exclude={pic ? [pic] : []} />
          </section>
          <section className="card stack pj-sec">
            <label className="field"><span>Ngân sách tổng dự án</span>
              <input id="pj-budget" className="input num" inputMode="decimal" value={budget} onChange={(e) => setBudget(e.target.value)} placeholder="VD: 850tr" />
              {budget ? <small className={amt != null ? "muted" : "err-text"}>{amt != null ? vnd(amt) : "Chưa đọc được số tiền"}</small> : null}</label>
            <div className="field">
              <span><label htmlFor="pj-loa">LOA phê duyệt dự án</label></span>
              <div className="dn-search">
                <button type="button" id="pj-loa" className="input dn-search-val" onClick={() => setLoaOpen(true)} aria-haspopup="dialog">
                  {loa ? `${loa.doc_no ?? "LOA"} · ${loa.subject}` : loaId ? (loaLabel ?? "Đã gắn LOA") : <span className="muted">Bấm kính lúp để tìm LOA đã duyệt</span>}
                </button>
                {loaId ? <button type="button" className="dn-search-btn clear" aria-label="Bỏ gắn LOA" title="Bỏ gắn LOA" onClick={() => setLoaId("")}>{Icon.x}</button> : null}
                <button type="button" className="dn-search-btn" aria-label="Tìm và chọn LOA" title="Tìm LOA" onClick={() => setLoaOpen(true)}>{Icon.search}</button>
              </div>
              {loa ? <small className="muted">LOA {vnd(loa.amount)} · còn {vnd(loaLeft(loa))}. {amt && amt > loa.amount ? <b className="err-text">Ngân sách dự án vượt LOA {vnd(amt - loa.amount)}.</b> : null}</small> : null}
            </div>
            <label className="field"><span>Toà nhà liên quan</span>
              <select id="pj-building" className="input" value={building} onChange={(e) => setBuilding(e.target.value)}>
                <option value="">Không gắn toà</option>
                {buildings.map((b) => <option key={b.id} value={b.id}>{b.code} · {b.name}</option>)}
              </select></label>
          </section>
          {err ? <div className="error-box" role="alert">{err}</div> : null}
          <button className="btn block" disabled={busy}>{busy ? "Đang lưu…" : editing ? "Lưu dự án" : "Tạo dự án"}</button>
        </form>
        )}
      </main>
      <LoaPicker open={loaOpen} onClose={() => setLoaOpen(false)} picks={picks} value={loaId} onPick={(v) => { setLoaId(v); setLoaOpen(false); }} />
    </>
  );
}
