import { useCallback, useEffect, useState, type FormEvent } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { supabase } from "../lib/supabase";
import { useSession } from "../lib/session";
import { timeAgo } from "../lib/dates";
import { Empty, Sheet, TopBar } from "../components/ui";
import "../feedback.css";

export type Thread = {
  id: string; customer_id: string; subject: string; status: "cho_cong_ty" | "cho_khach" | "dong";
  closed_reason: "khach_ket_thuc" | "tu_dong" | null; last_company_reply_at: string | null;
  created_at: string; updated_at: string;
  building_id: string | null; building_code: string | null; building_name: string | null; room_code: string | null;
  customer?: { full_name: string; phone: string | null } | null;
};
type Msg = { id: string; sender: "khach" | "cong_ty" | "he_thong"; body: string; created_at: string; author?: { full_name: string } | null };

export const fbPlace = (t: Thread) => [t.building_code, t.room_code ? "P." + t.room_code : "Khu vực chung"].filter(Boolean).join(" · ");
export const FB_STATUS: Record<string, string> = { cho_cong_ty: "Chờ công ty", cho_khach: "Chờ khách", dong: "Đã kết thúc" };

const AUTO_MS = 3 * 24 * 3600 * 1000;
function autoCloseText(t: Thread): string | null {
  if (t.status !== "cho_khach" || !t.last_company_reply_at) return null;
  const at = new Date(new Date(t.last_company_reply_at).getTime() + AUTO_MS);
  return at.toLocaleString("vi-VN", { timeZone: "Asia/Ho_Chi_Minh", hour: "2-digit", minute: "2-digit", day: "2-digit", month: "2-digit" });
}

/** Danh sách phản ánh của khách + gửi phản ánh mới */
export default function Feedback() {
  const { toast } = useSession();
  const nav = useNavigate();
  const [items, setItems] = useState<Thread[] | null>(null);
  const [creating, setCreating] = useState(false);

  const load = useCallback(async () => {
    const { data } = await supabase.from("feedback_threads").select("*").order("updated_at", { ascending: false });
    setItems((data as Thread[]) ?? []);
  }, []);
  useEffect(() => { load(); }, [load]);
  useEffect(() => {
    const h = () => load();
    window.addEventListener("neo:notification", h);
    return () => window.removeEventListener("neo:notification", h);
  }, [load]);

  return (
    <>
      <TopBar title="Phản ánh" action={<button className="btn sm" onClick={() => setCreating(true)}>+ Gửi phản ánh</button>} />
      <main className="main stack">
        <p className="fb-note">Gửi góp ý hoặc sự cố cho Neo Nestly. Công ty sẽ trả lời tại đây. Khi đã ổn, bạn bấm "Kết thúc"; nếu công ty đã trả lời mà sau 3 ngày bạn chưa phản hồi thì phản ánh tự kết thúc.</p>
        {items === null ? <div className="loading">Đang tải…</div> : items.length === 0 ? (
          <Empty title="Chưa có phản ánh nào">Bấm "Gửi phản ánh" để liên hệ công ty.</Empty>
        ) : (
          <section className="card">
            {items.map((t) => (
              <div key={t.id} className="list-row fb-row" onClick={() => nav(`/phan-anh/${t.id}`)}>
                <div className="grow">
                  <div className="name">{t.subject}</div>
                  <div className="sub"><span className={"fb-st " + t.status}>{FB_STATUS[t.status]}</span> {fbPlace(t)} · {timeAgo(t.updated_at)}</div>
                </div>›
              </div>
            ))}
          </section>
        )}
      </main>
      <NewSheet open={creating} onClose={() => setCreating(false)} onDone={(id) => { setCreating(false); toast("Đã gửi phản ánh."); nav(`/phan-anh/${id}`); }} />
    </>
  );
}

type Place = { building_id: string | null; building_code: string | null; building_name: string | null; room_id: string | null; room_code: string | null };

/** Khách ở phòng nào thì phản ánh đúng toà và phòng đó (do nhân sự gán vào tài khoản), khách không tự chọn */
function NewSheet({ open, onClose, onDone }: { open: boolean; onClose: () => void; onDone: (id: string) => void }) {
  const [place, setPlace] = useState<Place | null | undefined>(undefined);
  const [subject, setSubject] = useState("");
  const [body, setBody] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  useEffect(() => {
    if (!open) return;
    setSubject(""); setBody(""); setErr(null); setPlace(undefined);
    supabase.rpc("customer_my_place").then(({ data }) => setPlace(((data as Place[]) ?? [])[0] ?? null));
  }, [open]);
  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true); setErr(null);
    const { data, error } = await supabase.rpc("feedback_create", { p_subject: subject, p_body: body });
    setBusy(false);
    if (error) { setErr(error.message); return; }
    onDone(data as string);
  }
  const has = !!place?.building_id;
  return (
    <Sheet open={open} onClose={onClose} title="Gửi phản ánh">
      <form className="stack" onSubmit={submit}>
        {place === undefined ? <div className="loading">Đang tải…</div> : has ? (
          <p className="fb-note">Phản ánh cho: <b>{place!.building_code}{place!.room_code ? ` · Phòng ${place!.room_code}` : ""}</b>{place!.building_name ? ` — ${place!.building_name}` : ""}</p>
        ) : (
          <div className="error-box" role="alert">Tài khoản của bạn chưa được gán toà nhà và phòng. Vui lòng liên hệ nhân viên Neo Nestly để được cập nhật.</div>
        )}
        <label className="field"><span>Tiêu đề *</span>
          <input className="input" maxLength={120} value={subject} onChange={(e) => setSubject(e.target.value)} required disabled={!has} /></label>
        <label className="field"><span>Nội dung *</span>
          <textarea className="input" rows={5} maxLength={2000} value={body} onChange={(e) => setBody(e.target.value)} required disabled={!has} /></label>
        {err ? <div className="error-box" role="alert">{err}</div> : null}
        <button className="btn block" disabled={busy || !has}>{busy ? "Đang gửi…" : "Gửi"}</button>
      </form>
    </Sheet>
  );
}

/** Luồng tin nhắn một phản ánh: khách và nhân sự dùng chung */
export function FeedbackThread() {
  const { id } = useParams();
  const { isCustomer, toast } = useSession();
  const [t, setT] = useState<Thread | null | undefined>(undefined);
  const [msgs, setMsgs] = useState<Msg[]>([]);
  const [text, setText] = useState("");
  const [sales, setSales] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    const [a, b] = await Promise.all([
      supabase.from("feedback_threads").select("*, customer:profiles!customer_id(full_name,phone)").eq("id", id!).maybeSingle(),
      supabase.from("feedback_messages").select("id,sender,body,created_at").eq("thread_id", id!).order("created_at"),
    ]);
    setT((a.data as Thread | null) ?? null);
    supabase.rpc("feedback_sales", { p_thread: id }).then(({ data }) => setSales((data as string[]) ?? []));
    setMsgs((b.data as Msg[]) ?? []);
  }, [id]);
  useEffect(() => { load(); }, [load]);
  useEffect(() => {
    const h = () => load();
    window.addEventListener("neo:notification", h);
    window.addEventListener("focus", h);
    return () => { window.removeEventListener("neo:notification", h); window.removeEventListener("focus", h); };
  }, [load]);

  async function send(e: FormEvent) {
    e.preventDefault();
    if (!text.trim()) return;
    setBusy(true);
    const { error } = await supabase.rpc("feedback_reply", { p_thread: id, p_body: text });
    setBusy(false);
    if (error) { toast(error.message); return; }
    setText(""); load();
  }
  async function close() {
    if (!window.confirm("Kết thúc phản ánh này? Sau khi kết thúc sẽ không nhắn thêm được.")) return;
    setBusy(true);
    const { error } = await supabase.rpc("feedback_close", { p_thread: id });
    setBusy(false);
    if (error) { toast(error.message); return; }
    toast("Đã kết thúc phản ánh."); load();
  }

  if (t === undefined) return <><TopBar title="Phản ánh" back /><div className="loading">Đang tải…</div></>;
  if (t === null) return <><TopBar title="Phản ánh" back /><main className="main"><Empty title="Không tìm thấy phản ánh" /></main></>;
  const auto = autoCloseText(t);
  return (
    <>
      <TopBar title={t.subject} back="/phan-anh" />
      <main className="main stack">
        <div className="row" style={{ justifyContent: "space-between" }}>
          <span className={"fb-st " + t.status}>{FB_STATUS[t.status]}</span>
          {!isCustomer && t.customer ? <span className="muted small">{t.customer.full_name} · {t.customer.phone}</span> : null}
        </div>
        <p className="fb-note"><b>{fbPlace(t)}</b>{t.building_name ? ` — ${t.building_name}` : ""}<br />Sale phụ trách: {sales.length ? sales.join(", ") : "chưa có (Quản lý sẽ xử lý)"}</p>
        {auto && isCustomer ? <p className="fb-note">Nếu bạn không phản hồi, phản ánh sẽ tự kết thúc lúc {auto}.</p> : null}
        {auto && !isCustomer ? <p className="fb-note">Chờ khách phản hồi. Không có phản hồi thì tự kết thúc lúc {auto}. Công ty không đóng thay khách.</p> : null}
        <div className="fb-chat">
          {msgs.map((m) => (
            <div key={m.id} className={"fb-msg " + m.sender}>
              {m.body}
              <small>{m.sender === "khach" ? (isCustomer ? "Bạn" : "Khách") : m.sender === "cong_ty" ? "Neo Nestly" : ""} {timeAgo(m.created_at)}</small>
            </div>
          ))}
        </div>
        {t.status !== "dong" ? (
          <form className="fb-reply" onSubmit={send}>
            <textarea className="input" maxLength={2000} placeholder={isCustomer ? "Nhập tin nhắn…" : "Trả lời khách…"} value={text} onChange={(e) => setText(e.target.value)} />
            <div className="row">
              <button className="btn" style={{ flex: 1 }} disabled={busy || !text.trim()}>Gửi</button>
              {isCustomer ? <button type="button" className="btn secondary" disabled={busy} onClick={close}>Kết thúc phản ánh</button> : null}
            </div>
          </form>
        ) : (
          <p className="fb-note">{t.closed_reason === "tu_dong" ? "Phản ánh đã tự kết thúc sau 3 ngày không có phản hồi." : "Khách đã kết thúc phản ánh."}</p>
        )}
      </main>
    </>
  );
}

/** Hộp phản ánh của nhân sự (Quản lý, Giám sát: tất cả; Sale: toà mình và khách mình tạo) */
export function FeedbackInbox() {
  const nav = useNavigate();
  const [items, setItems] = useState<Thread[] | null>(null);
  const [st, setSt] = useState<"" | Thread["status"]>("cho_cong_ty");
  const [bld, setBld] = useState("");
  const load = useCallback(async () => {
    const { data } = await supabase.from("feedback_threads").select("*, customer:profiles!customer_id(full_name,phone)").order("updated_at", { ascending: false }).limit(300);
    setItems((data as Thread[]) ?? []);
  }, []);
  useEffect(() => { load(); }, [load]);
  useEffect(() => {
    const h = () => load();
    window.addEventListener("neo:notification", h);
    return () => window.removeEventListener("neo:notification", h);
  }, [load]);
  const blds = Array.from(new Set((items ?? []).map((t) => t.building_code).filter(Boolean))) as string[];
  const shown = (items ?? []).filter((t) => (!st || t.status === st) && (!bld || t.building_code === bld));
  const cnt = (s: Thread["status"]) => (items ?? []).filter((t) => t.status === s).length;
  return (
    <>
      <TopBar title="Phản ánh khách hàng" />
      <main className="main stack">
        <div className="chips">
          {(["cho_cong_ty", "cho_khach", "dong"] as const).map((k) => (
            <button key={k} className="chip" aria-pressed={st === k} onClick={() => setSt(k)}>{FB_STATUS[k]}<span className="n">{cnt(k)}</span></button>
          ))}
          <button className="chip" aria-pressed={st === ""} onClick={() => setSt("")}>Tất cả</button>
        </div>
        {blds.length > 1 ? (
          <select className="input" value={bld} onChange={(e) => setBld(e.target.value)}>
            <option value="">Tất cả toà</option>
            {blds.map((b) => <option key={b} value={b}>{b}</option>)}
          </select>
        ) : null}
        {items === null ? <div className="loading">Đang tải…</div> : shown.length === 0 ? <Empty title="Không có phản ánh" /> : (
          <section className="card">
            {shown.map((t) => (
              <div key={t.id} className="list-row fb-row" onClick={() => nav(`/phan-anh/${t.id}`)}>
                <div className="grow">
                  <div className="name">{t.subject}</div>
                  <div className="sub"><span className={"fb-st " + t.status}>{FB_STATUS[t.status]}</span> {fbPlace(t)} · {t.customer?.full_name} · {timeAgo(t.updated_at)}</div>
                </div>›
              </div>
            ))}
          </section>
        )}
      </main>
    </>
  );
}
