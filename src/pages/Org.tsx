import { useCallback, useEffect, useMemo, useState, type FormEvent } from "react";
import { friendlyError, supabase } from "../lib/supabase";
import { useSession } from "../lib/session";
import { parseMoney, vnd } from "../lib/money";
import { FLOW_TEXT } from "../lib/office";
import { DUTY_NAME, LEVEL_LABEL, LEVEL_SHORT, STATUS_LABEL, type Dept, type Pay, type Scale, type Staff } from "../lib/org";
import { Empty, Sheet, TopBar } from "../components/ui";
import "../office.css";
import "../org.css";

type Draft = {
  id: string | null; person_name: string; position: string; department_id: string; team: string; level: string; rank: string;
  status: string; hire_note: string; profile_id: string; duty: string; is_leader: boolean; salary: string; legacy: string;
};
const blank = (dept: string): Draft => ({
  id: null, person_name: "", position: "", department_id: dept, team: "", level: "1", rank: "1", status: "co", hire_note: "",
  profile_id: "", duty: "", is_leader: false, salary: "", legacy: "",
});
const isTemp = (id: string) => id.startsWith("new-");
const rowOf = (s: Staff) => ({
  person_name: s.person_name, position: s.position, department_id: s.department_id, team: s.team, level: s.level, rank: s.rank,
  status: s.status, hire_note: s.hire_note, profile_id: s.profile_id, duty: s.duty, is_leader: s.is_leader,
});

export default function Org() {
  const { myStaff, people, toast } = useSession();
  const level = myStaff?.level ?? 0;
  const canSee = level >= 3;
  const canEdit = level >= 4;
  const [base, setBase] = useState<{ depts: Dept[]; staff: Staff[]; pay: Pay[] }>({ depts: [], staff: [], pay: [] });
  const [depts, setDepts] = useState<Dept[]>([]);   // bản đang sửa (chưa lưu)
  const [staff, setStaff] = useState<Staff[]>([]);
  const [pay, setPay] = useState<Pay[]>([]);
  const [scale, setScale] = useState<Scale[]>([]);
  const [loading, setLoading] = useState(true);
  const [edit, setEdit] = useState<Draft | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const load = useCallback(async () => {
    const [d, s, p, sc] = await Promise.all([
      supabase.from("departments").select("*").order("sort"),
      supabase.from("org_staff").select("*").order("sort"),
      supabase.from("org_staff_pay").select("*"),
      supabase.from("salary_scale").select("*").order("level").order("rank"),
    ]);
    const b = { depts: (d.data ?? []) as Dept[], staff: (s.data ?? []) as Staff[], pay: (p.data ?? []) as Pay[] };
    setBase(b); setDepts(b.depts); setStaff(b.staff); setPay(b.pay); setScale((sc.data ?? []) as Scale[]);
    setLoading(false);
  }, []);
  useEffect(() => { load(); }, [load]);

  const dirty = useMemo(() => JSON.stringify({ depts, staff, pay }) !== JSON.stringify(base), [depts, staff, pay, base]);
  useEffect(() => {
    if (!dirty) return;
    const warn = (e: BeforeUnloadEvent) => { e.preventDefault(); e.returnValue = ""; };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [dirty]);
  const unassigned = useMemo(
    () => people.filter((p) => p.is_active && !staff.some((s) => s.profile_id === p.id)),
    [people, staff],
  );

  const payOf = (id: string) => pay.find((x) => x.staff_id === id)?.base_salary ?? null;
  const counts = useMemo(() => ({
    co: staff.filter((s) => s.status === "co" && s.person_name !== "Chủ doanh nghiệp").length,
    tuyen: staff.filter((s) => s.status === "tuyen").length,
    ngoai: staff.filter((s) => s.status === "thue_ngoai").length,
  }), [staff]);
  const deputies = staff.filter((s) => s.level === 4);
  const owner = staff.find((s) => s.person_name === "Chủ doanh nghiệp");
  const accountName = (id: string | null) => people.find((p) => p.id === id)?.full_name;

  function open(s: Staff | null, dept?: string, profileId?: string) {
    setErr(null);
    if (!s) {
      const b = blank(dept ?? depts[0]?.id ?? "");
      const p = profileId ? people.find((x) => x.id === profileId) : null;
      setEdit(p ? { ...b, profile_id: p.id, person_name: p.full_name } : { ...b, status: "tuyen" });
      return;
    }
    setEdit({
      id: s.id, person_name: s.person_name ?? "", position: s.position, department_id: s.department_id ?? "", team: s.team ?? "",
      level: s.level ? String(s.level) : "", rank: s.rank ? String(s.rank) : "", status: s.status, hire_note: s.hire_note ?? "",
      profile_id: s.profile_id ?? "", duty: s.duty ?? "", is_leader: s.is_leader, salary: payOf(s.id) != null ? String(payOf(s.id)) : "",
      legacy: s.profile_id ? "" : (s.person_name ?? ""),
    });
  }

  function pickPerson(pid: string) {
    if (!edit) return;
    const p = people.find((x) => x.id === pid);
    if (p) setEdit({ ...edit, profile_id: p.id, person_name: p.full_name, status: edit.status === "tuyen" ? "co" : edit.status });
    else setEdit({ ...edit, profile_id: "", person_name: edit.legacy, status: edit.legacy ? edit.status : (edit.status === "co" ? "tuyen" : edit.status) });
  }

  // Bấm "Áp dụng" trong biểu mẫu chỉ ghi vào bản nháp; chỉ khi bấm "Lưu" ở sơ đồ mới ghi vào hệ thống.
  function stage(e: FormEvent) {
    e.preventDefault();
    if (!edit) return;
    if (!edit.position.trim()) { setErr("Nhập tên vị trí."); return; }
    const sal = edit.salary ? parseMoney(edit.salary) : null;
    if (edit.salary && sal == null) { setErr("Lương chưa đúng định dạng."); return; }
    if (edit.profile_id && staff.some((s) => s.profile_id === edit.profile_id && s.id !== edit.id)) { setErr("Nhân viên này đã có vị trí khác."); return; }
    if (edit.duty) {
      const other = staff.find((s) => s.duty === edit.duty && s.id !== edit.id);
      if (other) { setErr(`Nhiệm vụ này đang do ${other.person_name ?? other.position} giữ.`); return; }
    }
    const id = edit.id ?? `new-${Date.now()}`;
    const old = staff.find((s) => s.id === id);
    const row: Staff = {
      id, person_name: edit.person_name.trim() || null, position: edit.position.trim(), department_id: edit.department_id || null,
      team: edit.team.trim() || null, level: edit.level ? Number(edit.level) : null, rank: edit.rank ? Number(edit.rank) : null,
      status: edit.status as Staff["status"], hire_note: edit.hire_note.trim() || null, profile_id: edit.profile_id || null,
      duty: (edit.duty || null) as Staff["duty"], is_leader: edit.is_leader,
      sort: old?.sort ?? (Math.max(0, ...staff.map((x) => x.sort)) + 1),
    };
    setStaff(old ? staff.map((s) => (s.id === id ? row : s)) : [...staff, row]);
    if (level >= 4) {
      const others = pay.filter((x) => x.staff_id !== id);
      setPay(sal != null ? [...others, { staff_id: id, base_salary: sal, note: pay.find((x) => x.staff_id === id)?.note ?? null }] : others);
    }
    setEdit(null);
  }

  function setHead(dept: Dept, staffId: string) {
    setDepts(depts.map((d) => (d.id === dept.id ? { ...d, head_staff_id: staffId || null } : d)));
  }

  function revert() {
    setDepts(base.depts); setStaff(base.staff); setPay(base.pay); setEdit(null); setErr(null);
    toast("Đã trở về trạng thái đã lưu.");
  }

  async function saveAll() {
    setBusy(true);
    const real = new Map<string, string>();
    const fail = (e: { message?: string } | null) => { setBusy(false); toast(friendlyError(e as never)); load(); };
    for (const s of staff.filter((x) => isTemp(x.id))) {
      const r = await supabase.from("org_staff").insert({ ...rowOf(s), sort: s.sort }).select("id").single();
      if (r.error) return fail(r.error);
      real.set(s.id, r.data.id);
    }
    for (const s of staff.filter((x) => !isTemp(x.id))) {
      const o = base.staff.find((x) => x.id === s.id);
      if (o && JSON.stringify(rowOf(o)) !== JSON.stringify(rowOf(s))) {
        const r = await supabase.from("org_staff").update(rowOf(s)).eq("id", s.id);
        if (r.error) return fail(r.error);
      }
    }
    if (level >= 4) {
      for (const p of pay) {
        const o = base.pay.find((x) => x.staff_id === p.staff_id);
        if (o && o.base_salary === p.base_salary) continue;
        const r = await supabase.from("org_staff_pay").upsert({ staff_id: real.get(p.staff_id) ?? p.staff_id, base_salary: p.base_salary, updated_at: new Date().toISOString() });
        if (r.error) return fail(r.error);
      }
    }
    for (const d of depts) {
      const o = base.depts.find((x) => x.id === d.id);
      if (o && o.head_staff_id !== d.head_staff_id) {
        const r = await supabase.from("departments").update({ head_staff_id: d.head_staff_id ? (real.get(d.head_staff_id) ?? d.head_staff_id) : null }).eq("id", d.id);
        if (r.error) return fail(r.error);
      }
    }
    setBusy(false); toast("Đã lưu sơ đồ công ty."); load();
  }

  if (loading) return (<><TopBar title="Sơ đồ công ty" back /><div className="loading">Đang tải…</div></>);

  // Nhân viên thường: chỉ thấy vị trí và lương của chính mình
  if (!canSee) {
    return (
      <>
        <TopBar title="Sơ đồ công ty" back />
        <main className="main stack">
          <Empty title="Chỉ cấp Trưởng phòng trở lên xem được sơ đồ công ty">Bạn vẫn xem được vị trí và mức lương cơ bản của chính mình ở dưới.</Empty>
          {myStaff ? (
            <dl className="card kv">
              <dt>Vị trí</dt><dd>{myStaff.position}</dd>
              {myStaff.level ? (<><dt>Cấp bậc</dt><dd>{LEVEL_SHORT[myStaff.level]}{myStaff.rank ? ` · rank ${myStaff.rank}` : ""}</dd></>) : null}
              <dt>Lương cơ bản</dt><dd className="num">{payOf(myStaff.id) != null ? vnd(payOf(myStaff.id)) : "Chưa có"}</dd>
            </dl>
          ) : <p className="muted">Tài khoản của bạn chưa được gán vào sơ đồ công ty. Hãy báo Phó Giám đốc.</p>}
        </main>
      </>
    );
  }

  const PersonCard = ({ s }: { s: Staff }) => (
    <li className={`org-person st-${s.status}`}>
      <div className="op-main">
        <b>{s.person_name ?? (s.status === "tuyen" ? "Tuyển mới" : "Chưa ghi tên")}</b>
        <span>{s.position}</span>
        <div className="op-badges">
          {s.level ? <span className="badge">L{s.level}{s.rank ? `-${s.rank}` : ""}</span> : null}
          {s.status !== "co" ? <span className={`badge ${s.status}`}>{STATUS_LABEL[s.status]}</span> : null}
          {s.is_leader ? <span className="badge lead">Leader</span> : null}
          {s.duty ? <span className="badge duty">{DUTY_NAME[s.duty]}</span> : null}
          {s.profile_id ? <span className="badge acc" title={accountName(s.profile_id) ?? ""}>Có tài khoản</span> : s.status === "co" && s.person_name ? <span className="badge noacc">Chưa có tài khoản</span> : null}
        </div>
        {s.hire_note ? <small>{s.hire_note}</small> : null}
      </div>
      {canEdit ? <button className="btn ghost sm" onClick={() => open(s)}>Sửa</button> : null}
    </li>
  );

  const TreePerson = ({ s }: { s: Staff }) => (
    <li className={`ot-person st-${s.status}`}>
      <b>{s.person_name ?? "Tuyển mới"}</b>
      <span>{s.position}</span>
      {s.is_leader || s.duty ? <em>{[s.is_leader ? "Leader" : "", s.duty ? DUTY_NAME[s.duty].split(" (")[0] : ""].filter(Boolean).join(" · ")}</em> : null}
      {s.hire_note ? <small>{s.hire_note}</small> : null}
      {canEdit ? <button className="ot-edit" aria-label={`Sửa ${s.person_name ?? s.position}`} onClick={() => open(s)}>Sửa</button> : null}
    </li>
  );

  const unplaced = staff.filter((x) => !x.department_id && x.level !== 4 && x.person_name !== "Chủ doanh nghiệp");
  const deputyIds = new Set(deputies.map((d) => d.id));
  const branches: { key: string; dep: Staff | null; depts: Dept[] }[] = [
    ...deputies.map((dep) => ({ key: dep.id, dep, depts: depts.filter((d) => d.head_staff_id === dep.id) })),
    ...(depts.some((d) => !d.head_staff_id || !deputyIds.has(d.head_staff_id))
      ? [{ key: "none", dep: null, depts: depts.filter((d) => !d.head_staff_id || !deputyIds.has(d.head_staff_id)) }] : []),
  ];

  return (
    <>
      <TopBar title="Sơ đồ công ty" back action={canEdit ? <button className="tb-action" onClick={() => open(null)}>+ Vị trí</button> : null} />
      <main className="main main-full stack">
        <section className="card org-stats" aria-label="Tổng quan nhân sự">
          <div><b className="num">{counts.co}</b><span>đang có</span></div>
          <div><b className="num">{counts.tuyen}</b><span>đang tuyển</span></div>
          <div><b className="num">{counts.ngoai}</b><span>thuê ngoài</span></div>
        </section>

        <section className="card dn-sec">
          <h2 className="dn-h">Luồng duyệt đề nghị</h2>
          <p style={{ margin: 0 }}><b>Nghỉ phép, làm việc bên ngoài, công tác:</b> {FLOW_TEXT.nghi_phep}</p>
          <p style={{ margin: 0 }}><b>Thanh toán, tạm ứng:</b> {FLOW_TEXT.thanh_toan}</p>
          <p className="muted small" style={{ margin: 0 }}>Bước chưa có người giữ tự bỏ qua; một người đứng nhiều bước chỉ duyệt một lần. Người giữ nhiệm vụ Nhân sự, Kế toán, Giám đốc đặt ở từng vị trí (nút Sửa).</p>
        </section>

        {canEdit ? (
          <section className="card org-bar" aria-label="Lưu hoặc hoàn lại thay đổi">
            <span className={dirty ? "ob-state dirty" : "ob-state"}>{dirty ? "Có thay đổi chưa lưu" : "Đang hiển thị bản đã lưu"}</span>
            <div className="ob-btns">
              <button className="btn secondary" disabled={!dirty || busy} onClick={revert}>Trở về</button>
              <button className="btn" disabled={!dirty || busy} onClick={saveAll}>{busy ? "Đang lưu…" : "Lưu"}</button>
            </div>
          </section>
        ) : null}

        {canEdit ? (
          <section className="card org-free">
            <h2 className="dn-h">Nhân viên chưa có vị trí <span className="badge">{unassigned.length}</span></h2>
            {unassigned.length ? (
              <ul className="org-chips">
                {unassigned.map((p) => (
                  <li key={p.id}><span>{p.full_name}</span><button className="btn ghost" onClick={() => open(null, undefined, p.id)}>Gán vị trí</button></li>
                ))}
              </ul>
            ) : <p className="muted small" style={{ margin: 0 }}>Mọi nhân viên đang hoạt động đều đã có vị trí.</p>}
          </section>
        ) : null}

        <div className="otree-wrap">
          <ul className="ot">
            <li>
              <div className="ot-node ot-owner"><b>{owner?.person_name ?? "Chủ doanh nghiệp"}</b><span>Giám đốc / Chủ doanh nghiệp</span></div>
              <ul>
                {branches.map((br) => (
                  <li key={br.key}>
                    {br.dep ? (
                      <div className="ot-node ot-deputy">
                        <b>{br.dep.person_name ?? br.dep.position}</b>
                        <span>Phó Giám đốc{br.dep.rank ? ` · L4-${br.dep.rank}` : ""}</span>
                        {br.dep.duty ? <span className="badge duty">{DUTY_NAME[br.dep.duty]}</span> : null}
                        {br.dep.hire_note ? <span className="badge tuyen">{br.dep.hire_note}</span> : null}
                        {canEdit ? <button className="btn ghost sm" onClick={() => open(br.dep!)}>Sửa</button> : null}
                      </div>
                    ) : <div className="ot-node ot-deputy"><b>Chưa gắn Phó Giám đốc</b></div>}
                    <ul>
                      {br.depts.map((d) => {
                        const hue = Math.max(0, depts.findIndex((x) => x.id === d.id)) % 5;
                        const members = staff.filter((m) => m.department_id === d.id).sort((x, y) => x.sort - y.sort);
                        const teams = Array.from(new Set(members.map((m) => m.team ?? "")));
                        const headName = staff.find((x) => x.id === d.head_staff_id)?.person_name;
                        return (
                          <li key={d.id} className={`hue-${hue}`}>
                            <div className="ot-node ot-dept">
                              <b>{d.name}</b>
                              {canEdit ? (
                                <label className="org-head"><span>Trưởng phòng</span>
                                  <select className="input" value={d.head_staff_id ?? ""} onChange={(e) => setHead(d, e.target.value)}>
                                    <option value="">—</option>
                                    {staff.filter((x) => (x.level ?? 0) >= 3 && x.person_name).map((x) => <option key={x.id} value={x.id}>{x.person_name}</option>)}
                                  </select></label>
                              ) : <span>Trưởng phòng: {headName ?? "—"}</span>}
                              {canEdit ? <button className="btn ghost sm" onClick={() => open(null, d.id)}>+ Vị trí</button> : null}
                            </div>
                            <ul>
                              {teams.map((t) => (
                                <li key={t}>
                                  {t ? <div className="ot-node ot-team">{t}</div> : null}
                                  <ul className="ot-members">{members.filter((m) => (m.team ?? "") === t).map((m) => <TreePerson key={m.id} s={m} />)}</ul>
                                </li>
                              ))}
                            </ul>
                          </li>
                        );
                      })}
                    </ul>
                  </li>
                ))}
              </ul>
            </li>
          </ul>
        </div>
        {unplaced.length ? (
          <section className="card org-dept"><header><h3>Chưa xếp phòng</h3></header>
            <ul className="org-list">{unplaced.map((m) => <PersonCard key={m.id} s={m} />)}</ul></section>
        ) : null}

        {pay.length ? (
          <>
            <h2 className="dn-h dn-h-out">Lương cơ bản hiện tại</h2>
            <div className="card dn-grid">
              <table>
                <thead><tr><th>Họ tên</th><th>Vị trí</th><th>Cấp</th><th className="r">Lương cơ bản</th></tr></thead>
                <tbody>
                  {staff.filter((s) => payOf(s.id) != null).map((s) => (
                    <tr key={s.id}><td>{s.person_name}</td><td>{s.position}</td><td>L{s.level}{s.rank ? `-${s.rank}` : ""}</td><td className="r num">{vnd(payOf(s.id))}</td></tr>
                  ))}
                  <tr><td colSpan={3}><b>Tổng</b></td><td className="r num"><b>{vnd(pay.reduce((t, p) => t + Number(p.base_salary ?? 0), 0))}</b></td></tr>
                </tbody>
              </table>
            </div>
            <p className="muted small" style={{ margin: 0 }}>Chỉ Phó Giám đốc xem được bảng này. Lương Phó Giám đốc theo thỏa thuận riêng, không đưa vào.</p>
          </>
        ) : null}

        {scale.length ? (
          <>
            <h2 className="dn-h dn-h-out">Thang lương cơ bản theo cấp bậc</h2>
            <div className="card dn-grid">
              <table>
                <thead><tr><th>Cấp</th><th className="r">Rank 1</th><th className="r">Rank 2</th><th className="r">Rank 3</th></tr></thead>
                <tbody>
                  {[1, 2, 3, 4].map((lv) => (
                    <tr key={lv}><td>{LEVEL_LABEL[lv]}</td>
                      {[1, 2, 3].map((rk) => <td key={rk} className="r num">{vnd(scale.find((x) => x.level === lv && x.rank === rk)?.base_salary)}</td>)}</tr>
                  ))}
                </tbody>
              </table>
            </div>
          </>
        ) : null}
      </main>

      <Sheet open={!!edit} onClose={() => setEdit(null)} title={edit?.id ? "Sửa vị trí" : "Thêm vị trí"}>
        {edit ? (
          <form className="stack" onSubmit={stage}>
            <div className="dn-fields">
              <label className="field"><span>Nhân viên (chỉ người chưa có vị trí)</span>
                <select className="input" value={edit.profile_id} onChange={(e) => pickPerson(e.target.value)}>
                  <option value="">{edit.legacy ? `${edit.legacy} (chưa có tài khoản)` : "Chưa có người (đang tuyển)"}</option>
                  {people.filter((p) => p.is_active && (p.id === edit.profile_id || !staff.some((x) => x.profile_id === p.id))).map((p) => <option key={p.id} value={p.id}>{p.full_name}</option>)}
                </select></label>
              <label className="field"><span>Vị trí *</span>
                <input className="input" value={edit.position} onChange={(e) => setEdit({ ...edit, position: e.target.value })} required /></label>
              <label className="field"><span>Phòng</span>
                <select className="input" value={edit.department_id} onChange={(e) => setEdit({ ...edit, department_id: e.target.value })}>
                  <option value="">Chưa xếp</option>{depts.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}</select></label>
              <label className="field"><span>Bộ phận / nhóm</span>
                <input className="input" value={edit.team} onChange={(e) => setEdit({ ...edit, team: e.target.value })} placeholder="VD: KD tòa nhà" /></label>
              <label className="field"><span>Cấp (Level)</span>
                <select className="input" value={edit.level} onChange={(e) => setEdit({ ...edit, level: e.target.value })}>
                  <option value="">Ngoài thang</option>{[1, 2, 3, 4].map((l) => <option key={l} value={l}>{LEVEL_LABEL[l]}</option>)}</select></label>
              <label className="field"><span>Rank</span>
                <select className="input" value={edit.rank} onChange={(e) => setEdit({ ...edit, rank: e.target.value })}>
                  <option value="">—</option>{[1, 2, 3].map((r) => <option key={r} value={r}>Rank {r}</option>)}</select></label>
              <label className="field"><span>Tình trạng</span>
                <select className="input" value={edit.status} onChange={(e) => setEdit({ ...edit, status: e.target.value })}>
                  {Object.entries(STATUS_LABEL).map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select></label>
              <label className="field"><span>Nhiệm vụ duyệt cấp công ty</span>
                <select className="input" value={edit.duty} onChange={(e) => setEdit({ ...edit, duty: e.target.value })}>
                  <option value="">Không</option>{Object.entries(DUTY_NAME).map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select></label>
              {level >= 4 ? (
                <label className="field"><span>Lương cơ bản</span>
                  <input className="input num" inputMode="decimal" value={edit.salary} onChange={(e) => setEdit({ ...edit, salary: e.target.value })} placeholder="VD: 8.500.000 hoặc 8tr5" /></label>
              ) : null}
              <label className="field dn-span2"><span>Ghi chú tuyển dụng</span>
                <input className="input" value={edit.hire_note} onChange={(e) => setEdit({ ...edit, hire_note: e.target.value })} placeholder="VD: Cần có người T3/2027" /></label>
            </div>
            <label className="check-row"><input type="checkbox" checked={edit.is_leader} onChange={(e) => setEdit({ ...edit, is_leader: e.target.checked })} /> Là Leader của nhóm (duyệt bước đầu cho người cùng nhóm)</label>
            {err ? <div className="error-box" role="alert">{err}</div> : null}
            <button className="btn block">Áp dụng</button>
            <p className="muted small" style={{ margin: 0 }}>“Áp dụng” chỉ ghi vào bản nháp. Bấm “Lưu” ở trang sơ đồ để ghi vào hệ thống, hoặc “Trở về” để bỏ thay đổi.</p>
          </form>
        ) : null}
      </Sheet>
    </>
  );
}
