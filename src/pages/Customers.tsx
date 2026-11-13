import { useCallback, useEffect, useState, type FormEvent } from "react";
import { useNavigate } from "react-router-dom";
import { callAccountFn, normPhone, supabase } from "../lib/supabase";
import { useSession } from "../lib/session";
import { timeAgo } from "../lib/dates";
import { copyText, Empty, Sheet, tempPassword, TopBar } from "../components/ui";
import { FB_STATUS, type Thread } from "./Feedback";
import "../feedback.css";

type Cust = { id: string; full_name: string; phone: string | null; cccd: string; is_active: boolean; created_at: string; created_by_name: string | null; open_threads: number; building_code: string | null; room_id: string | null; room_code: string | null };
const APP_URL = typeof window !== "undefined" ? window.location.origin : "";
const credText = (name: string, phone: string, pw: string) =>
  `Chào ${name}, tài khoản Next Living của bạn:\n• Vào: ${APP_URL}\n• Số điện thoại: ${phone}\n• Mật khẩu tạm: ${pw}\nLần đầu đăng nhập app sẽ yêu cầu đổi mật khẩu. Bạn xem được phòng trống, giá, phí, dịch vụ, nội thất và gửi phản ánh cho công ty.`;

/** Chọn toà + phòng khách đang ở (nhân sự gán; Sale chỉ thấy toà mình được gán). value = id phòng */
function RoomPicker({ value, onChange }: { value: string; onChange: (roomId: string) => void }) {
  const { buildings } = useSession();
  const [bld, setBld] = useState("");
  const [rooms, setRooms] = useState<{ id: string; code: string; floor: number | null }[]>([]);
  useEffect(() => {
    if (!bld) { setRooms([]); return; }
    supabase.from("rooms").select("id,code,floor").eq("building_id", bld).order("floor").order("code")
      .then(({ data }) => setRooms((data as typeof rooms) ?? []));
  }, [bld]);
  return (
    <>
      <label className="field"><span>Toà nhà khách đang ở</span>
        <select className="input" value={bld} onChange={(e) => { setBld(e.target.value); onChange(""); }}>
          <option value="">— Chưa gán —</option>
          {buildings.map((b) => <option key={b.id} value={b.id}>{b.code} · {b.name}</option>)}
        </select></label>
      <label className="field"><span>Phòng</span>
        <select className="input" value={value} onChange={(e) => onChange(e.target.value)} disabled={!bld}>
          <option value="">— Chọn phòng —</option>
          {rooms.map((r) => <option key={r.id} value={r.id}>{r.floor != null ? `Tầng ${r.floor} · ` : ""}{r.code}</option>)}
        </select></label>
    </>
  );
}

/** Nhân sự: tài khoản khách hàng + hộp phản ánh */
export default function Customers() {
  const { toast, isManager } = useSession();
  const nav = useNavigate();
  const tab = "khach" as "khach" | "phan_anh";
  const [custs, setCusts] = useState<Cust[] | null>(null);
  const [threads, setThreads] = useState<Thread[] | null>(null);
  const [q, setQ] = useState("");
  const [creating, setCreating] = useState(false);
  const [cred, setCred] = useState<string | null>(null);
  const [pwFor, setPwFor] = useState<Cust | null>(null);
  const [room, setRoom] = useState("");

  const load = useCallback(async () => {
    const [a, b] = await Promise.all([
      supabase.rpc("customers_list"),
      supabase.from("feedback_threads").select("*, customer:profiles!customer_id(full_name,phone)").order("updated_at", { ascending: false }).limit(200),
    ]);
    setCusts((a.data as Cust[]) ?? []);
    setThreads((b.data as Thread[]) ?? []);
  }, []);
  useEffect(() => { load(); }, [load]);
  useEffect(() => {
    const h = () => load();
    window.addEventListener("neo:notification", h);
    return () => window.removeEventListener("neo:notification", h);
  }, [load]);

  const openCount = (threads ?? []).filter((t) => t.status === "cho_cong_ty").length;
  const ql = q.trim().toLowerCase();
  const shown = (custs ?? []).filter((c) => !ql || c.full_name.toLowerCase().includes(ql) || (c.phone ?? "").includes(ql));

  async function assign(c: Cust) {
    const { error } = await supabase.rpc("customer_assign_room", { p_customer: c.id, p_room: room });
    if (error) { toast(error.message); return; }
    toast("Đã gán phòng cho khách."); setPwFor(null); load();
  }

  async function resetPw(c: Cust) {
    const pw = tempPassword();
    try {
      await callAccountFn({ action: "reset_customer_password", user_id: c.id, password: pw });
      setPwFor(null); setCred(credText(c.full_name, c.phone ?? "", pw));
    } catch (ex) { toast((ex as Error).message); }
  }

  return (
    <>
      <TopBar title="Khách hàng" action={<button className="btn sm" onClick={() => setCreating(true)}>+ Tạo tài khoản</button>} />
      <main className="main stack">
        <button className="btn secondary block" onClick={() => nav("/phan-anh")}>Xem phản ánh của khách{openCount ? ` (${openCount} chờ công ty)` : ""}</button>
        {tab === "khach" ? (
          <>
            <input className="input" placeholder="Tìm tên hoặc số điện thoại" value={q} onChange={(e) => setQ(e.target.value)} />
            {custs === null ? <div className="loading">Đang tải…</div> : shown.length === 0 ? (
              <Empty title="Chưa có tài khoản khách hàng">Bấm "Tạo tài khoản". Mỗi CCCD chỉ đăng ký một tài khoản.</Empty>
            ) : (
              <section className="card">
                {shown.map((c) => (
                  <div key={c.id} className="list-row" onClick={() => { setRoom(""); setPwFor(c); }}>
                    <div className="grow">
                      <div className="name">{c.full_name}{c.is_active ? "" : " · Đã khoá"}</div>
                      <div className="sub">{c.phone} · CCCD {c.cccd} · {c.building_code ? `${c.building_code}${c.room_code ? " · P." + c.room_code : ""}` : "Chưa gán phòng"}{c.created_by_name ? ` · Tạo bởi ${c.created_by_name}` : ""}{c.open_threads ? ` · ${c.open_threads} phản ánh đang mở` : ""}</div>
                    </div>›
                  </div>
                ))}
              </section>
            )}
          </>
        ) : threads === null ? <div className="loading">Đang tải…</div> : threads.length === 0 ? (
          <Empty title="Chưa có phản ánh" />
        ) : (
          <section className="card">
            {threads.map((t) => (
              <div key={t.id} className="list-row fb-row" onClick={() => nav(`/phan-anh/${t.id}`)}>
                <div className="grow">
                  <div className="name">{t.subject}</div>
                  <div className="sub"><span className={"fb-st " + t.status}>{FB_STATUS[t.status]}</span> {t.customer?.full_name} · {timeAgo(t.updated_at)}</div>
                </div>›
              </div>
            ))}
          </section>
        )}
      </main>

      <CreateSheet open={creating} onClose={() => setCreating(false)} onDone={(t) => { setCreating(false); setCred(t); load(); }} />
      <Sheet open={!!pwFor} onClose={() => setPwFor(null)} title={pwFor?.full_name ?? ""}>
        {pwFor ? (
          <div className="stack">
            <p className="muted small" style={{ margin: 0 }}>{pwFor.phone} · CCCD {pwFor.cccd}{isManager ? "" : " (chỉ Quản lý xem đủ số)"}</p>
            <button className="btn block" onClick={() => nav(`/khach-hang/${pwFor.id}`)}>Xem thông tin, số điện nước, phiếu thu</button>
            <RoomPicker value={room} onChange={setRoom} />
            <button className="btn block" disabled={!room} onClick={() => assign(pwFor)}>Lưu phòng của khách</button>
            <button className="btn secondary block" onClick={() => resetPw(pwFor)}>Cấp lại mật khẩu tạm</button>
          </div>
        ) : null}
      </Sheet>
      <Sheet open={!!cred} onClose={() => setCred(null)} title="Gửi thông tin đăng nhập">
        <p className="muted small" style={{ marginTop: 0 }}>Copy đoạn dưới và gửi qua Zalo cho khách. Mật khẩu tạm chỉ hiện một lần này.</p>
        <div className="copybox" id="cred-text">{cred}</div>
        <div className="row" style={{ marginTop: 12 }}>
          <button className="btn" style={{ flex: 1 }} onClick={async () => { if (cred && (await copyText(cred))) toast("Đã copy."); }}>Copy</button>
          <button className="btn secondary" style={{ flex: 1 }} onClick={() => setCred(null)}>Xong</button>
        </div>
      </Sheet>
    </>
  );
}

function CreateSheet({ open, onClose, onDone }: { open: boolean; onClose: () => void; onDone: (cred: string) => void }) {
  const { toast } = useSession();
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [cccd, setCccd] = useState("");
  const [room, setRoom] = useState("");
  const [pw, setPw] = useState(tempPassword());
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  useEffect(() => { if (open) { setName(""); setPhone(""); setCccd(""); setRoom(""); setPw(tempPassword()); setErr(null); } }, [open]);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setErr(null);
    const p = normPhone(phone);
    const c = cccd.replace(/\D/g, "");
    if (!/^0\d{9}$/.test(p)) { setErr("Số điện thoại phải có 10 số, bắt đầu bằng 0."); return; }
    if (c.length !== 12) { setErr("CCCD phải đủ 12 số."); return; }
    setBusy(true);
    try {
      const r = await callAccountFn<{ id: string }>({ action: "create_customer", full_name: name.trim(), phone: p, cccd: c, password: pw });
      if (room) {
        const { error } = await supabase.rpc("customer_assign_room", { p_customer: r.id, p_room: room });
        if (error) toast("Đã tạo tài khoản nhưng chưa gán được phòng: " + error.message);
      }
      onDone(credText(name.trim(), p, pw));
    } catch (ex) { setErr((ex as Error).message); }
    setBusy(false);
  }
  return (
    <Sheet open={open} onClose={onClose} title="Tạo tài khoản khách hàng">
      <form className="stack" onSubmit={submit}>
        <label className="field"><span>Họ tên *</span><input className="input" value={name} onChange={(e) => setName(e.target.value)} required /></label>
        <label className="field"><span>Số điện thoại (ID đăng nhập) *</span><input className="input" inputMode="tel" value={phone} onChange={(e) => setPhone(e.target.value)} required /></label>
        <label className="field"><span>Số CCCD (12 số, mỗi CCCD chỉ đăng ký một lần) *</span><input className="input" inputMode="numeric" maxLength={14} value={cccd} onChange={(e) => setCccd(e.target.value)} required /></label>
        <RoomPicker value={room} onChange={setRoom} />
        <label className="field"><span>Mật khẩu tạm</span>
          <div className="row" style={{ flexWrap: "nowrap" }}>
            <input className="input mono" value={pw} onChange={(e) => setPw(e.target.value)} required minLength={6} />
            <button type="button" className="btn secondary sm" onClick={() => setPw(tempPassword())}>Tạo mới</button>
          </div></label>
        {err ? <div className="error-box" role="alert">{err}</div> : null}
        <button className="btn block" disabled={busy}>{busy ? "Đang tạo…" : "Tạo tài khoản"}</button>
      </form>
    </Sheet>
  );
}
