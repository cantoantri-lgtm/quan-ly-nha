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
  status: string; hire_note: string; profile_id: string; duty: string; is_leader: boolean; salary: string;
};
const blank = (dept: string): Draft => ({
  id: null, person_name: "", position: "", department_id: dept, team: "", level: "1", rank: "1", status: "co", hire_note: "",
  profile_id: "", duty: "", is_leader: false, salary: "",
});

export default function Org() {
  const { myStaff, people, toast } = useSession();
  const level = myStaff?.level ?? 0;
  const canSee = level >= 3;
  const canEdit = level >= 4;
  const [depts, setDepts] = useState<Dept[]>([]);
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
    setDepts((d.data ?? []) as Dept[]); setStaff((s.data ?? []) as Staff[]);
    setPay((p.data ?? []) as Pay[]); setScale((sc.data ?? []) as Scale[]);
    setLoading(false);
  }, []);
  useEffect(() => { load(); }, [load]);

  const payOf = (id: string) => pay.find((x) => x.staff_id === id)?.base_salary ?? null;
  const counts = useMemo(() => ({
    co: staff.filter((s) => s.status === "co" && s.person_name !== "Chủ doanh nghiệp").length,
    tuyen: staff.filter((s) => s.status === "tuyen").length,
    ngoai: staff.filter((s) => s.status === "thue_ngoai").length,
  }), [staff]);
  const deputies = staff.filter((s) => s.level === 4);
  const owner = staff.find((s) => s.person_name === "Chủ doanh nghiệp");
  const accountName = (id: string | null) => people.find((p) => p.id === id)?.full_name;

  function open(s: Staff | null, dept?: string) {
    setErr(null);
    if (!s) { setEdit(blank(dept ?? depts[0]?.id ?? "")); return; }
    setEdit({
      id: s.id, person_name: s.person_name ?? "", position: s.position, department_id: s.department_id ?? "", team: s.team ?? "",
      level: s.level ? String(s.level) : "", rank: s.rank ? String(s.rank) : "", status: s.status, hire_note: s.hire_note ?? "",
      profile_id: s.profile_id ?? "", duty: s.duty ?? "", is_leader: s.is_leader, salary: payOf(s.id) != null ? String(payOf(s.id)) : "",
    });
  }

  async function save(e: FormEvent) {
    e.preventDefault();
    if (!edit) return;
    if (!edit.position.trim()) { setErr("Nhập tên vị trí."); return; }
    const sal = edit.salary ? parseMoney(edit.salary) : null;
    if (edit.salary && sal == null) { setErr("Lương chưa đúng định dạng."); return; }
    const row = {
      person_name: edit.person_name.trim() || null, position: edit.position.trim(), department_id: edit.department_id || null,
      team: edit.team.trim() || null, level: edit.level ? Number(edit.level) : null, rank: edit.rank ? Number(edit.rank) : null,
      status: edit.status, hire_note: edit.hire_note.trim() || null, profile_id: edit.profile_id || null,
      duty: edit.duty || null, is_leader: edit.is_leader,
    };
    setBusy(true); setErr(null);
    const res = edit.id
      ? await supabase.from("org_staff").update(row).eq("id", edit.id).select("id").single()
      : await supabase.from("org_staff").insert(row).select("id").single();
    if (res.error) { setBusy(false); setErr(friendlyError(res.error)); return; }
    if (level >= 4 && (edit.salary || payOf(res.data.id) != null)) {
      const r2 = await supabase.from("org_staff_pay").upsert({ staff_id: res.data.id, base_salary: sal, updated_at: new Date().toISOString() });
      if (r2.error) { setBusy(false); setErr(friendlyError(r2.error)); return; }
    }
    setBusy(false); setEdit(null); toast("Đã lưu."); load();
  }

  async function setHead(dept: Dept, staffId: string) {
    const { error } = await supabase.from("departments").update({ head_staff_id: staffId || null }).eq("id", dept.id);
    if (error) toast(friendlyError(error)); else { toast("Đã đổi Trưởng phòng."); load(); }
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
      {canEdit ? <button className="btn ghost" onClick={() => open(s)}>Sửa</button> : null}
    </li>
  );

  const unplaced = staff.filter((s) => !s.department_id);

  return (
    <>
      <TopBar title="Sơ đồ công ty" back action={canEdit ? <button className="tb-action" onClick={() => open(null)}>+ Vị trí</button> : null} />
      <main className="main main-wide stack">
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

        <div className="org-tree">
          <div className="org-node org-owner"><b>{owner?.person_name ?? "Chủ doanh nghiệp"}</b><span>Giám đốc / Chủ doanh nghiệp</span></div>
          <div className="org-cols">
            {deputies.map((dep) => {
              const mine = depts.filter((d) => d.head_staff_id === dep.id);
              return (
                <div key={dep.id} className="org-col">
                  <div className="org-node org-deputy">
                    <b>{dep.person_name}</b><span>Phó Giám đốc{dep.rank ? ` · L4-${dep.rank}` : ""}</span>
                    {dep.duty ? <span className="badge duty">{DUTY_NAME[dep.duty]}</span> : null}
                    {canEdit ? <button className="btn ghost" onClick={() => open(dep)}>Sửa</button> : null}
                  </div>
                  {mine.map((d) => {
                    const members = staff.filter((s) => s.department_id === d.id).sort((a, b) => (a.team ?? "").localeCompare(b.team ?? "", "vi") || a.sort - b.sort);
                    const teams = Array.from(new Set(members.map((m) => m.team ?? "")));
                    return (
                      <section key={d.id} className="card org-dept">
                        <header>
                          <h3>{d.name}</h3>
                          {canEdit ? (
                            <label className="org-head"><span>Trưởng phòng</span>
                              <select className="input" value={d.head_staff_id ?? ""} onChange={(e) => setHead(d, e.target.value)}>
                                <option value="">—</option>
                                {staff.filter((s) => (s.level ?? 0) >= 3).map((s) => <option key={s.id} value={s.id}>{s.person_name ?? s.position}</option>)}
                              </select></label>
                          ) : <small>Trưởng phòng: {staff.find((s) => s.id === d.head_staff_id)?.person_name ?? "—"}</small>}
                        </header>
                        {teams.map((t) => (
                          <div key={t}>
                            {t ? <div className="org-team">{t}</div> : null}
                            <ul className="org-list">{members.filter((m) => (m.team ?? "") === t).map((m) => <PersonCard key={m.id} s={m} />)}</ul>
                          </div>
                        ))}
                        {canEdit ? <button className="btn ghost" onClick={() => open(null, d.id)}>+ Thêm vị trí vào phòng</button> : null}
                      </section>
                    );
                  })}
                </div>
              );
            })}
          </div>
          {unplaced.filter((s) => s.level !== 4 && s.person_name !== "Chủ doanh nghiệp").length ? (
            <section className="card org-dept"><header><h3>Chưa xếp phòng</h3></header>
              <ul className="org-list">{unplaced.filter((s) => s.level !== 4 && s.person_name !== "Chủ doanh nghiệp").map((m) => <PersonCard key={m.id} s={m} />)}</ul></section>
          ) : null}
        </div>

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
          <form className="stack" onSubmit={save}>
            <div className="dn-fields">
              <label className="field"><span>Họ tên (để trống nếu đang tuyển)</span>
                <input className="input" value={edit.person_name} onChange={(e) => setEdit({ ...edit, person_name: e.target.value })} /></label>
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
              <label className="field"><span>Tài khoản đăng nhập</span>
                <select className="input" value={edit.profile_id} onChange={(e) => setEdit({ ...edit, profile_id: e.target.value })}>
                  <option value="">Chưa gán</option>
                  {people.filter((p) => p.is_active && (!staff.some((s) => s.profile_id === p.id && s.id !== edit.id))).map((p) => <option key={p.id} value={p.id}>{p.full_name}</option>)}</select></label>
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
            <button className="btn block" disabled={busy}>{busy ? "Đang lưu…" : "Lưu"}</button>
          </form>
        ) : null}
      </Sheet>
    </>
  );
}
