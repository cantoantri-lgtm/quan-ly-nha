import { useCallback, useEffect, useMemo, useState } from "react";
import { friendlyError, supabase } from "../lib/supabase";
import { useSession } from "../lib/session";
import { ROLE_LABEL, type Role } from "../lib/labels";
import { Avatar, Combo, Empty, Sheet, TopBar } from "../components/ui";

/** Trang Phân quyền (105): anh Trí và nhóm Admin. CSDL kiểm tra thật trong perm_matrix_save / perm_user_set. */
type Group = { code: string; name: string; note: string | null; sort: number };
type Feature = { code: string; name: string; note: string | null; max_level: number; sort: number };
type Cell = { group_code: string; feature: string; level: number };
type Person = {
  user_id: string; full_name: string; role: Role; is_active: boolean; job_title: string | null; department: string | null;
  auto_group: string | null; manual_group: string | null; group_code: string | null; is_super: boolean;
};

const LEVEL = ["Không", "Xem", "Sửa"] as const;
const LEVEL_OPTS = (max: number) => LEVEL.slice(0, max + 1).map((l, i) => [String(i), l] as const);
// Admin không chỉnh được (CSDL chặn giống vậy)
const LOCKED_GROUPS = new Set(["pho_giam_doc", "admin"]);
const LOCKED_FEATURES = new Set(["so_do", "luong"]);

export default function PermSettings() {
  const { isPermSuper, profile, toast } = useSession();
  const [tab, setTab] = useState<"nhom" | "nguoi" | "bang">("nhom");
  const [groups, setGroups] = useState<Group[]>([]);
  const [features, setFeatures] = useState<Feature[]>([]);
  const [cells, setCells] = useState<Cell[]>([]);
  const [people, setPeople] = useState<Person[] | null>(null);
  const [err, setErr] = useState("");
  const [g, setG] = useState("");
  const [busyKey, setBusyKey] = useState("");
  const [editing, setEditing] = useState<Person | null>(null);
  const [q, setQ] = useState("");

  const load = useCallback(async () => {
    const [gr, fe, ce, pp] = await Promise.all([
      supabase.from("perm_groups").select("*").order("sort"),
      supabase.from("perm_features").select("*").order("sort"),
      supabase.from("perm_matrix").select("group_code,feature,level"),
      supabase.rpc("perm_people"),
    ]);
    const e = gr.error ?? fe.error ?? ce.error ?? pp.error;
    if (e) setErr(friendlyError(e));
    setGroups((gr.data ?? []) as Group[]);
    setFeatures((fe.data ?? []) as Feature[]);
    setCells((ce.data ?? []) as Cell[]);
    setPeople((pp.data ?? []) as Person[]);
  }, []);
  useEffect(() => { load(); }, [load]);
  useEffect(() => { if (!g && groups.length) setG(groups[0].code); }, [groups, g]);

  const lv = (grp: string, f: string) => cells.find((c) => c.group_code === grp && c.feature === f)?.level ?? 0;
  const gName = (code: string | null) => groups.find((x) => x.code === code)?.name ?? code ?? "";
  const active = (people ?? []).filter((p) => p.is_active);
  const countOf = (code: string) => active.filter((p) => p.group_code === code).length;
  const cellLocked = (grp: string, f: string) => !isPermSuper && (LOCKED_GROUPS.has(grp) || LOCKED_FEATURES.has(f));

  const saveCell = async (grp: string, f: string, level: number) => {
    const key = `${grp}:${f}`;
    setBusyKey(key);
    const { error } = await supabase.rpc("perm_matrix_save", { p_group: grp, p_feature: f, p_level: level });
    setBusyKey("");
    if (error) { toast(friendlyError(error)); return; }
    setCells((cs) => [...cs.filter((c) => !(c.group_code === grp && c.feature === f)), { group_code: grp, feature: f, level }]);
    toast(`Đã lưu: ${gName(grp)} · ${features.find((x) => x.code === f)?.name} · ${LEVEL[level]}`);
  };

  const group = groups.find((x) => x.code === g);
  const shownPeople = useMemo(() => {
    const k = q.trim().toLowerCase();
    return active.filter((p) => !k || p.full_name.toLowerCase().includes(k) || (p.job_title ?? "").toLowerCase().includes(k));
  }, [active, q]);

  return (
    <>
      <TopBar title="Phân quyền" back />
      <main className="main stack">
        <p className="muted" style={{ margin: 0, fontSize: 13.5 }}>
          Mỗi nhân sự thuộc 1 nhóm. App tự xếp nhóm theo Sơ đồ công ty, chỉnh tay được từng người. Việc ở toà (phòng, hợp đồng, hoá đơn, ghi điện, thu chi toà) vẫn theo vai trò app và toà được gán.
          {!isPermSuper ? " Nhóm Phó Giám đốc, nhóm Admin, Sơ đồ công ty và Bảng lương chỉ anh Trí chỉnh." : ""}
        </p>
        <div className="tabs" role="tablist">
          <button role="tab" aria-selected={tab === "nhom"} onClick={() => setTab("nhom")}>Theo nhóm</button>
          <button role="tab" aria-selected={tab === "nguoi"} onClick={() => setTab("nguoi")}>Theo người</button>
          <button role="tab" aria-selected={tab === "bang"} onClick={() => setTab("bang")}>Bảng tổng</button>
        </div>
        {err ? <div className="card" style={{ padding: 12, color: "var(--danger)" }}>{err}</div> : null}

        {tab === "nhom" && group ? (
          <>
            <label className="field"><span>Nhóm quyền</span>
              <Combo id="perm-group" value={g} label="Nhóm quyền" onChange={setG}
                options={groups.map((x) => [x.code, `${x.name} · ${countOf(x.code)} người`] as const)} /></label>
            {group.note ? <p className="muted small" style={{ margin: 0 }}>{group.note}</p> : null}
            <div className="card">
              {features.map((f) => {
                const locked = cellLocked(g, f.code);
                return (
                  <div key={f.code} className="list-row perm-row">
                    <div className="grow">
                      <div className="name">{f.name}</div>
                      <div className="sub">{f.note}</div>
                      {locked ? <div className="sub" style={{ color: "var(--late)" }}>Chỉ anh Trí chỉnh</div> : null}
                    </div>
                    <div className="perm-pick">
                      <Combo value={String(lv(g, f.code)) as "0" | "1" | "2"} label={`${f.name} cho nhóm ${group.name}`}
                        options={LEVEL_OPTS(f.max_level)} disabled={locked || busyKey === `${g}:${f.code}`}
                        onChange={(v) => saveCell(g, f.code, Number(v))} />
                    </div>
                  </div>
                );
              })}
            </div>
            <p className="muted small" style={{ margin: 0 }}>Đổi xong có hiệu lực ngay ở CSDL. Người trong nhóm mở lại app để thấy menu mới.</p>
          </>
        ) : null}

        {tab === "nguoi" ? (
          people === null ? <p className="muted">Đang tải…</p> : (
            <>
              <input className="input" placeholder="Tìm theo tên hoặc vị trí" value={q} onChange={(e) => setQ(e.target.value)} />
              {groups.map((gr) => {
                const list = shownPeople.filter((p) => p.group_code === gr.code);
                if (!list.length) return null;
                return (
                  <section key={gr.code}>
                    <div className="section-title">{gr.name} · {list.length}</div>
                    <div className="card">
                      {list.map((p) => (
                        <div key={p.user_id} className="list-row" role="button" tabIndex={0}
                          onClick={() => setEditing(p)} onKeyDown={(e) => e.key === "Enter" && setEditing(p)}>
                          <Avatar name={p.full_name} />
                          <div className="grow">
                            <div className="name">{p.full_name}{p.user_id === profile?.id ? " (bạn)" : ""}</div>
                            <div className="sub">{[p.job_title ?? "Chưa có trong Sơ đồ", ROLE_LABEL[p.role]].join(" · ")}</div>
                          </div>
                          <span className="tag">{p.is_super ? "Toàn quyền" : p.manual_group ? "Xếp tay" : "Tự xếp"}</span>
                        </div>
                      ))}
                    </div>
                  </section>
                );
              })}
              {!shownPeople.length ? <Empty title="Không có ai khớp">Thử từ khoá khác.</Empty> : null}
            </>
          )
        ) : null}

        {tab === "bang" ? (
          <div className="card dn-grid perm-table">
            <table>
              <thead><tr><th>Chức năng</th>{groups.map((x) => <th key={x.code} className="c">{x.name}</th>)}</tr></thead>
              <tbody>
                {features.map((f) => (
                  <tr key={f.code}><td>{f.name}</td>
                    {groups.map((x) => { const v = lv(x.code, f.code); return <td key={x.code} className={`c perm-l${v}`}>{LEVEL[v]}</td>; })}</tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : null}
      </main>

      <PersonSheet p={editing} groups={groups} features={features} lv={lv} gName={gName}
        locked={!!editing && !isPermSuper && (editing.user_id === profile?.id || LOCKED_GROUPS.has(editing.group_code ?? ""))}
        onClose={() => setEditing(null)}
        onSaved={async (msg) => { setEditing(null); toast(msg); await load(); }} />
    </>
  );
}

function PersonSheet({ p, groups, features, lv, gName, locked, onClose, onSaved }: {
  p: Person | null; groups: Group[]; features: Feature[]; lv: (g: string, f: string) => number; gName: (c: string | null) => string;
  locked: boolean; onClose: () => void; onSaved: (msg: string) => void;
}) {
  const { isPermSuper, profile } = useSession();
  const [sel, setSel] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  useEffect(() => { setSel(p?.manual_group ?? "auto"); setErr(""); }, [p]);
  if (!p) return <Sheet open={false} onClose={onClose} title="">{null}</Sheet>;

  const effective = sel === "auto" ? p.auto_group : sel;
  const opts = [
    ["auto", `Tự xếp theo Sơ đồ: ${gName(p.auto_group)}`] as const,
    ...groups.filter((x) => isPermSuper || !LOCKED_GROUPS.has(x.code)).map((x) => [x.code, x.name] as const),
  ];
  const save = async () => {
    setBusy(true); setErr("");
    const { error } = await supabase.rpc("perm_user_set", { p_user: p.user_id, p_group: sel === "auto" ? null : sel });
    setBusy(false);
    if (error) { setErr(friendlyError(error)); return; }
    onSaved(`${p.full_name}: nhóm ${gName(effective)}`);
  };

  return (
    <Sheet open onClose={onClose} title={p.full_name}>
      <div className="stack">
        <div className="muted" style={{ fontSize: 13.5 }}>{[p.job_title ?? "Chưa có trong Sơ đồ công ty", p.department, ROLE_LABEL[p.role]].filter(Boolean).join(" · ")}</div>
        {p.is_super ? <p className="muted" style={{ margin: 0 }}>Tài khoản toàn quyền: luôn có mọi chức năng ở mức cao nhất, không phụ thuộc nhóm.</p> : null}
        {locked ? <p className="muted" style={{ margin: 0 }}>{p.user_id === profile?.id ? "Không tự đổi nhóm quyền của mình. Nhờ anh Trí." : "Người trong nhóm Phó Giám đốc, Admin chỉ anh Trí đổi nhóm."}</p> : null}
        <label className="field"><span>Nhóm quyền</span>
          <Combo id="perm-person" value={sel} label="Nhóm quyền" options={opts} disabled={locked || busy} onChange={setSel} /></label>
        <div className="card">
          {features.map((f) => {
            const v = p.is_super ? f.max_level : lv(effective ?? "", f.code);
            return (
              <div key={f.code} className="list-row" style={{ minHeight: 0, paddingTop: 8, paddingBottom: 8 }}>
                <div className="grow">{f.name}</div><span className={`tag perm-l${v}`}>{LEVEL[v]}</span>
              </div>
            );
          })}
        </div>
        {err ? <div style={{ color: "var(--danger)", fontSize: 14 }}>{err}</div> : null}
        <button className="btn block" disabled={locked || busy || sel === (p.manual_group ?? "auto")} onClick={save}>{busy ? "Đang lưu…" : "Lưu"}</button>
      </div>
    </Sheet>
  );
}
