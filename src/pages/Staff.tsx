import { useCallback, useEffect, useMemo, useState, type FormEvent } from "react";
import { callAccountFn, friendlyError, normPhone, supabase } from "../lib/supabase";
import { useSession } from "../lib/session";
import { ROLE_LABEL, type Profile, type Role } from "../lib/labels";
import { Avatar, copyText, Empty, Sheet, TopBar, tempPassword } from "../components/ui";

type Member = { building_id: string; user_id: string };
const APP_URL = typeof window !== "undefined" ? window.location.origin : "";

function credText(name: string, phone: string, pw: string) {
  return `Chào ${name}, tài khoản Neo Nestly của bạn:\n• Vào: ${APP_URL}\n• Số điện thoại: ${phone}\n• Mật khẩu tạm: ${pw}\nLần đầu đăng nhập app sẽ yêu cầu đổi mật khẩu.`;
}

export default function Staff() {
  const { people, buildings, reloadBase, toast, profile } = useSession();
  const [members, setMembers] = useState<Member[]>([]);
  const [q, setQ] = useState("");
  const [roleF, setRoleF] = useState<"" | Role>("");
  const [creating, setCreating] = useState(false);
  const [editing, setEditing] = useState<Profile | null>(null);
  const [cred, setCred] = useState<string | null>(null);

  const loadMembers = useCallback(async () => {
    const { data } = await supabase.from("building_members").select("building_id,user_id");
    setMembers(data ?? []);
  }, []);
  useEffect(() => { loadMembers(); reloadBase(); }, [loadMembers]); // eslint-disable-line react-hooks/exhaustive-deps

  const bCode = useMemo(() => Object.fromEntries(buildings.map((b) => [b.id, b.code])), [buildings]);
  const shown = people.filter((p) =>
    (!roleF || p.role === roleF) &&
    (!q || p.full_name.toLowerCase().includes(q.toLowerCase()) || (p.phone ?? "").includes(q.replace(/\D/g, ""))));

  const afterChange = async () => { await Promise.all([reloadBase(), loadMembers()]); };

  return (
    <>
      <TopBar title="Nhân sự & tài khoản" back="/quan-tri"
        action={<button className="tb-action" onClick={() => setCreating(true)}>+ Thêm</button>} />
      <main className="main stack">
        <input id="staff-search" className="input" placeholder="Tìm theo tên hoặc số điện thoại" value={q} onChange={(e) => setQ(e.target.value)} />
        <div className="chips">
          {([["", "Tất cả"], ["quan_ly", "Quản lý"], ["giam_sat", "Giám sát"], ["nhan_vien", "Nhân viên"]] as ["" | Role, string][]).map(([k, l]) => (
            <button key={k} className="chip" aria-pressed={roleF === k} onClick={() => setRoleF(k)}>
              {l}<span className="n">{k ? people.filter((p) => p.role === k).length : people.length}</span>
            </button>
          ))}
        </div>
        {shown.length === 0 ? <Empty title="Không có ai khớp">Bấm "+ Thêm" để cấp tài khoản mới.</Empty> : (
          <section className="card">
            {shown.map((p) => {
              const bs = members.filter((m) => m.user_id === p.id).map((m) => bCode[m.building_id]).filter(Boolean);
              return (
                <div key={p.id} className={`list-row${p.is_active ? "" : " locked"}`} role="button" tabIndex={0}
                  onClick={() => setEditing(p)} onKeyDown={(e) => e.key === "Enter" && setEditing(p)}>
                  <Avatar name={p.full_name} />
                  <div className="grow">
                    <div className="name">{p.full_name}{p.id === profile?.id ? " (bạn)" : ""}</div>
                    <div className="sub">{p.phone} · {p.role === "quan_ly" ? "Tất cả toà" : bs.length ? bs.join(", ") : "Chưa gán toà"}{p.is_active ? "" : " · Đã khoá"}</div>
                    <div className="sub">{p.annual_leave_days == null ? "Chưa nhập phép năm" : `Phép năm ${String(Number(p.annual_leave_days)).replace(".", ",")} ngày`}</div>
                  </div>
                  <span className={`role-pill ${p.role}`}>{ROLE_LABEL[p.role]}</span>
                </div>
              );
            })}
          </section>
        )}
      </main>

      <CreateSheet open={creating} onClose={() => setCreating(false)}
        onDone={async (text) => { setCreating(false); setCred(text); await afterChange(); toast("Đã tạo tài khoản."); }} />
      {editing ? (
        <EditSheet person={editing} members={members} onClose={() => setEditing(null)}
          onChanged={afterChange} onCred={(t) => { setEditing(null); setCred(t); }} />
      ) : null}
      <Sheet open={!!cred} onClose={() => setCred(null)} title="Gửi thông tin đăng nhập">
        <p className="muted small" style={{ marginTop: 0 }}>Copy đoạn dưới và gửi qua Zalo cho nhân sự. Mật khẩu tạm chỉ hiện một lần này.</p>
        <div className="copybox" id="cred-text">{cred}</div>
        <div className="row" style={{ marginTop: 12 }}>
          <button className="btn" style={{ flex: 1 }} onClick={async () => {
            if (cred && (await copyText(cred))) toast("Đã copy.");
            else {
              const el = document.getElementById("cred-text");
              if (el) { const r = document.createRange(); r.selectNodeContents(el); const s = getSelection(); s?.removeAllRanges(); s?.addRange(r); }
              toast("Đã chọn sẵn nội dung, bấm giữ để copy.");
            }
          }}>Copy</button>
          <button className="btn secondary" style={{ flex: 1 }} onClick={() => setCred(null)}>Xong</button>
        </div>
      </Sheet>
    </>
  );
}

function BuildingChecks({ value, onChange }: { value: string[]; onChange: (v: string[]) => void }) {
  const { buildings } = useSession();
  if (!buildings.length) return <p className="muted small">Chưa có toà nhà. Vào Quản trị → Toà nhà để thêm.</p>;
  return (
    <div className="checks">
      {buildings.map((b) => (
        <label key={b.id}>
          <input type="checkbox" checked={value.includes(b.id)}
            onChange={(e) => onChange(e.target.checked ? [...value, b.id] : value.filter((x) => x !== b.id))} />
          <span>{b.code} · {b.name}</span>
        </label>
      ))}
    </div>
  );
}

function CreateSheet({ open, onClose, onDone }: { open: boolean; onClose: () => void; onDone: (cred: string) => void }) {
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [role, setRole] = useState<Role>("nhan_vien");
  const [bIds, setBIds] = useState<string[]>([]);
  const [pw, setPw] = useState(tempPassword());
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => { if (open) { setName(""); setPhone(""); setRole("nhan_vien"); setBIds([]); setPw(tempPassword()); setErr(null); } }, [open]);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setErr(null);
    const p = normPhone(phone);
    if (!/^0\d{9}$/.test(p)) { setErr("Số điện thoại phải có 10 số, bắt đầu bằng 0."); return; }
    setBusy(true);
    try {
      await callAccountFn({ action: "create", full_name: name.trim(), phone: p, role, password: pw, building_ids: role === "quan_ly" ? [] : bIds });
      onDone(credText(name.trim(), p, pw));
    } catch (ex) { setErr((ex as Error).message); }
    setBusy(false);
  }

  return (
    <Sheet open={open} onClose={onClose} title="Cấp tài khoản mới">
      <form className="stack" onSubmit={submit}>
        <label className="field"><span>Họ tên *</span>
          <input id="c-name" className="input" value={name} onChange={(e) => setName(e.target.value)} required /></label>
        <label className="field"><span>Số điện thoại (dùng để đăng nhập) *</span>
          <input id="c-phone" className="input" inputMode="tel" value={phone} onChange={(e) => setPhone(e.target.value)} required /></label>
        <label className="field"><span>Vai trò</span>
          <select id="c-role" className="input" value={role} onChange={(e) => setRole(e.target.value as Role)}>
            <option value="nhan_vien">Nhân viên — làm việc được giao, đánh dấu đã thu tiền</option>
            <option value="giam_sat">Giám sát — giao việc cho nhân viên, quản lý toà được gán</option>
            <option value="quan_ly">Quản lý — toàn quyền, xem tất cả toà</option>
          </select></label>
        {role !== "quan_ly" ? (<div className="field"><span>Làm ở toà nào</span><BuildingChecks value={bIds} onChange={setBIds} /></div>) : null}
        <label className="field"><span>Mật khẩu tạm</span>
          <div className="row" style={{ flexWrap: "nowrap" }}>
            <input id="c-pw" className="input mono" value={pw} onChange={(e) => setPw(e.target.value)} required minLength={6} />
            <button type="button" className="btn secondary sm" onClick={() => setPw(tempPassword())}>Tạo mới</button>
          </div></label>
        {err ? <div className="error-box" role="alert">{err}</div> : null}
        <button className="btn block" disabled={busy}>{busy ? "Đang tạo…" : "Tạo tài khoản"}</button>
      </form>
    </Sheet>
  );
}

function EditSheet({ person, members, onClose, onChanged, onCred }: {
  person: Profile; members: Member[]; onClose: () => void; onChanged: () => Promise<void>; onCred: (t: string) => void;
}) {
  const { toast, profile } = useSession();
  const isSelf = person.id === profile?.id;
  const [name, setName] = useState(person.full_name);
  const [role, setRole] = useState<Role>(person.role);
  const [bIds, setBIds] = useState<string[]>(members.filter((m) => m.user_id === person.id).map((m) => m.building_id));
  const [phone, setPhone] = useState(person.phone ?? "");
  const [leave, setLeave] = useState(person.annual_leave_days == null ? "" : String(Number(person.annual_leave_days)).replace(".", ","));
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function save(e: FormEvent) {
    e.preventDefault();
    setErr(null); setBusy(true);
    try {
      const leaveNum = leave.trim() === "" ? null : Number(leave.trim().replace(",", "."));
      if (leaveNum != null && (!(leaveNum >= 0 && leaveNum <= 60) || (leaveNum * 2) % 1 !== 0)) throw new Error("Số ngày phép năm phải từ 0 đến 60, bước nửa ngày.");
      const oldLeave = person.annual_leave_days == null ? null : Number(person.annual_leave_days);
      if (name.trim() !== person.full_name || role !== person.role || leaveNum !== oldLeave) {
        const { error } = await supabase.from("profiles").update({ full_name: name.trim(), role, annual_leave_days: leaveNum }).eq("id", person.id);
        if (error) throw new Error(friendlyError(error));
      }
      const before = members.filter((m) => m.user_id === person.id).map((m) => m.building_id);
      const want = role === "quan_ly" ? [] : bIds;
      const add = want.filter((b) => !before.includes(b));
      const del = before.filter((b) => !want.includes(b));
      if (add.length) {
        const { error } = await supabase.from("building_members").insert(add.map((b) => ({ building_id: b, user_id: person.id })));
        if (error) throw new Error(friendlyError(error));
      }
      if (del.length) {
        const { error } = await supabase.from("building_members").delete().eq("user_id", person.id).in("building_id", del);
        if (error) throw new Error(friendlyError(error));
      }
      const p = normPhone(phone);
      if (p !== (person.phone ?? "")) {
        if (!/^0\d{9}$/.test(p)) throw new Error("Số điện thoại phải có 10 số, bắt đầu bằng 0.");
        await callAccountFn({ action: "change_phone", user_id: person.id, phone: p });
      }
      await onChanged();
      toast("Đã lưu.");
      onClose();
    } catch (ex) { setErr((ex as Error).message); }
    setBusy(false);
  }

  async function resetPw() {
    const pw = tempPassword();
    setBusy(true);
    try {
      await callAccountFn({ action: "reset_password", user_id: person.id, password: pw });
      onCred(credText(person.full_name, person.phone ?? "", pw));
    } catch (ex) { setErr((ex as Error).message); }
    setBusy(false);
  }

  async function toggleActive() {
    setBusy(true);
    try {
      await callAccountFn({ action: "set_active", user_id: person.id, active: !person.is_active });
      await onChanged();
      toast(person.is_active ? "Đã khoá tài khoản." : "Đã mở khoá tài khoản.");
      onClose();
    } catch (ex) { setErr((ex as Error).message); }
    setBusy(false);
  }

  return (
    <Sheet open onClose={onClose} title={person.full_name}>
      <form className="stack" onSubmit={save}>
        <label className="field"><span>Họ tên</span>
          <input id="e-name" className="input" value={name} onChange={(e) => setName(e.target.value)} required /></label>
        <label className="field"><span>Số điện thoại đăng nhập</span>
          <input id="e-phone" className="input" inputMode="tel" value={phone} onChange={(e) => setPhone(e.target.value)} /></label>
        <label className="field"><span>Vai trò</span>
          <select id="e-role" className="input" value={role} disabled={isSelf} onChange={(e) => setRole(e.target.value as Role)}>
            <option value="nhan_vien">Nhân viên</option>
            <option value="giam_sat">Giám sát</option>
            <option value="quan_ly">Quản lý</option>
          </select></label>
        <label className="field"><span>Số ngày phép năm {new Date().getFullYear()}</span>
          <div className="row" style={{ flexWrap: "nowrap" }}>
            <input id="e-leave" className="input num" inputMode="decimal" value={leave} onChange={(e) => setLeave(e.target.value)} placeholder="VD: 12" style={{ maxWidth: 120 }} />
            <span className="muted small">ngày · để trống nếu chưa có</span>
          </div></label>
        {role !== "quan_ly" ? (<div className="field"><span>Làm ở toà nào</span><BuildingChecks value={bIds} onChange={setBIds} /></div>) : null}
        {err ? <div className="error-box" role="alert">{err}</div> : null}
        <button className="btn block" disabled={busy}>{busy ? "Đang lưu…" : "Lưu"}</button>
        <div className="row">
          <button type="button" className="btn secondary" style={{ flex: 1 }} disabled={busy} onClick={resetPw}>Cấp lại mật khẩu</button>
          {!isSelf ? (
            <button type="button" className={`btn ${person.is_active ? "danger" : "secondary"}`} style={{ flex: 1 }} disabled={busy} onClick={toggleActive}>
              {person.is_active ? "Khoá tài khoản" : "Mở khoá"}
            </button>
          ) : null}
        </div>
      </form>
    </Sheet>
  );
}
