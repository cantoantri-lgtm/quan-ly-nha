import { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { friendlyError, supabase } from "../lib/supabase";
import { useSession } from "../lib/session";
import { PRIORITY_LABEL, ROLE_LABEL, ROLE_RANK, type Priority } from "../lib/labels";
import { dow, ddmm } from "../lib/dates";
import { micSupported, startRecording, toWav16kBase64, type Recording } from "../lib/recorder";
import { TopBar } from "../components/ui";
import "../voice.css";

type Draft = {
  key: string; include: boolean; title: string; description: string; assignee_id: string; assignee_hint: string;
  building_id: string; due_date: string; priority: Priority; steps: string[]; open: boolean;
};
type AiTask = {
  title: string; description: string | null; assignee_id: string | null; assignee_hint: string | null;
  building_id: string | null; due_date: string | null; priority: Priority | null; steps: string[] | null;
};
type Phase = "idle" | "recording" | "processing" | "review" | "saving";
const MAX_SECONDS = 300;

async function analyze(body: Record<string, unknown>) {
  const { data, error } = await supabase.functions.invoke("phan-tich-giao-viec", { body });
  if (error) {
    let msg = "Không kết nối được máy chủ phân tích. Thử lại sau ít phút.";
    try {
      const ctx = (error as { context?: Response }).context;
      const j = ctx && typeof ctx.json === "function" ? await ctx.json() : null;
      if (j?.error) msg = j.error;
    } catch { /* giữ thông báo mặc định */ }
    throw new Error(msg);
  }
  return data as { transcript: string; tasks: AiTask[] };
}

const fmt = (s: number) => `${String(Math.floor(s / 60)).padStart(2, "0")}:${String(Math.floor(s % 60)).padStart(2, "0")}`;

export default function VoiceTask() {
  const { profile, people, buildings, isManager, isSupervisor, toast } = useSession();
  const canAssign = isManager || isSupervisor;
  const nav = useNavigate();
  const [mode, setMode] = useState<"voice" | "text">(micSupported() ? "voice" : "text");
  const [phase, setPhase] = useState<Phase>("idle");
  const [seconds, setSeconds] = useState(0);
  const [levels, setLevels] = useState<number[]>(Array(28).fill(0));
  const [text, setText] = useState("");
  const [transcript, setTranscript] = useState("");
  const [drafts, setDrafts] = useState<Draft[]>([]);
  const [err, setErr] = useState<string | null>(null);
  const [members, setMembers] = useState<{ building_id: string; user_id: string }[]>([]);
  const rec = useRef<Recording | null>(null);
  const timer = useRef<number>();
  const raf = useRef<number>();

  useEffect(() => {
    if (canAssign) supabase.from("building_members").select("building_id,user_id").then(({ data }) => setMembers(data ?? []));
    return () => { rec.current?.cancel(); window.clearInterval(timer.current); cancelAnimationFrame(raf.current!); };
  }, [canAssign]);

  const assignable = useMemo(() => {
    if (!profile) return [];
    return people.filter((p) => {
      if (!p.is_active) return false;
      if (p.id === profile.id) return true;
      if (ROLE_RANK[p.role] >= ROLE_RANK[profile.role]) return false;
      return isManager || members.some((m) => m.user_id === p.id);
    }).sort((a, b) => (a.id === profile.id ? -1 : b.id === profile.id ? 1 : a.full_name.localeCompare(b.full_name, "vi")));
  }, [people, profile, members, isManager]);

  async function begin() {
    setErr(null);
    try {
      rec.current = await startRecording();
    } catch (e) {
      const name = (e as DOMException)?.name;
      setErr(name === "NotAllowedError"
        ? "Chưa được phép dùng micro. Bấm biểu tượng ổ khoá trên thanh địa chỉ, cho phép Micro, rồi thử lại."
        : "Không mở được micro trên máy này. Bạn có thể dùng mục Dán tin nhắn.");
      return;
    }
    setSeconds(0);
    setPhase("recording");
    const t0 = Date.now();
    timer.current = window.setInterval(() => {
      const s = (Date.now() - t0) / 1000;
      setSeconds(s);
      if (s >= MAX_SECONDS) finish();
    }, 250);
    const tick = () => {
      if (!rec.current) return;
      const l = rec.current.level();
      setLevels((prev) => [...prev.slice(1), l]);
      raf.current = requestAnimationFrame(tick);
    };
    tick();
  }

  function cancel() {
    rec.current?.cancel(); rec.current = null;
    window.clearInterval(timer.current); cancelAnimationFrame(raf.current!);
    setPhase("idle"); setLevels(Array(28).fill(0));
  }

  async function finish() {
    const r = rec.current;
    if (!r) return;
    rec.current = null;
    window.clearInterval(timer.current); cancelAnimationFrame(raf.current!);
    setPhase("processing");
    try {
      const blob = await r.stop();
      const { base64, seconds: dur } = await toWav16kBase64(blob);
      if (dur < 1.5) throw new Error("Ghi âm quá ngắn. Bấm micro và nói rõ từng việc.");
      await run({ audio: base64, mime: "audio/wav" });
    } catch (e) { setErr((e as Error).message); setPhase("idle"); }
  }

  async function runText() {
    if (!text.trim()) return;
    setErr(null); setPhase("processing");
    try { await run({ text }); } catch (e) { setErr((e as Error).message); setPhase("idle"); }
  }

  async function run(body: Record<string, unknown>) {
    const res = await analyze(body);
    setTranscript(res.transcript || "");
    const list: Draft[] = (res.tasks ?? []).map((t, i) => ({
      key: `d${Date.now()}-${i}`, include: true, open: false,
      title: t.title, description: t.description ?? "",
      assignee_id: t.assignee_id ?? (canAssign ? "" : profile?.id ?? ""),
      assignee_hint: t.assignee_hint ?? "",
      building_id: t.building_id ?? (buildings.length === 1 ? buildings[0].id : ""),
      due_date: t.due_date ?? "", priority: t.priority ?? "binh_thuong", steps: t.steps ?? [],
    }));
    if (!list.length) throw new Error("Không tìm thấy việc nào trong nội dung. Thử nói rõ hơn: việc gì, ai làm, hạn khi nào.");
    setDrafts(list);
    setPhase("review");
  }

  const upd = (key: string, patch: Partial<Draft>) => setDrafts((ds) => ds.map((d) => (d.key === key ? { ...d, ...patch } : d)));
  const chosen = drafts.filter((d) => d.include);
  const missing = chosen.filter((d) => !d.title.trim() || !d.assignee_id).length;

  async function saveAll() {
    if (!chosen.length) return;
    if (missing) { setErr(`Còn ${missing} việc chưa chọn người làm. Chọn người hoặc bỏ tick việc đó.`); return; }
    setErr(null); setPhase("saving");
    let ok = 0;
    for (const d of chosen) {
      const { data, error } = await supabase.from("tasks").insert({
        title: d.title.trim(), description: d.description.trim() || null, building_id: d.building_id || null,
        assignee_id: d.assignee_id, due_date: d.due_date || null, priority: d.priority,
      }).select("id").single();
      if (error || !data) { setErr(`Đã giao ${ok}/${chosen.length} việc. Lỗi ở "${d.title}": ${friendlyError(error)}`); setPhase("review"); return; }
      const steps = d.steps.map((s) => s.trim()).filter(Boolean).map((s, i) => ({ parent_id: data.id, title: s, sort_order: i + 1 }));
      if (steps.length) await supabase.from("tasks").insert(steps);
      ok++;
      setDrafts((ds) => ds.filter((x) => x.key !== d.key));
    }
    toast(`Đã giao ${ok} việc. Người làm sẽ nhận thông báo.`);
    nav(canAssign ? "/?tab=given" : "/", { replace: true });
  }

  return (
    <>
      <TopBar title="Giao việc bằng giọng nói" back="/" />
      <main className="main stack">
        {phase === "idle" || phase === "recording" || phase === "processing" ? (
          <>
            <div className="tabs" role="tablist">
              <button role="tab" aria-selected={mode === "voice"} disabled={phase !== "idle"} onClick={() => setMode("voice")}>Ghi âm</button>
              <button role="tab" aria-selected={mode === "text"} disabled={phase !== "idle"} onClick={() => setMode("text")}>Dán tin nhắn</button>
            </div>

            {mode === "voice" ? (
              <section className="card voice-panel">
                {phase === "processing" ? (
                  <div className="voice-wait"><span className="spinner" aria-hidden="true" /><b>Đang nghe và tách việc…</b><span className="muted small">Thường mất 5–20 giây.</span></div>
                ) : (
                  <>
                    <button className={`mic${phase === "recording" ? " on" : ""}`} onClick={phase === "recording" ? finish : begin}
                      aria-label={phase === "recording" ? "Dừng và phân tích" : "Bắt đầu ghi âm"}>
                      {phase === "recording" ? <span className="stop-sq" /> : (
                        <svg width="34" height="34" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true">
                          <rect x="9" y="3" width="6" height="11" rx="3" /><path d="M5 11a7 7 0 0 0 14 0M12 18v3" />
                        </svg>
                      )}
                    </button>
                    {phase === "recording" ? (
                      <>
                        <div className="wave" aria-hidden="true">{levels.map((l, i) => <span key={i} style={{ height: `${8 + l * 40}px` }} />)}</div>
                        <div className="num rec-time">{fmt(seconds)} <span className="muted">/ {fmt(MAX_SECONDS)}</span></div>
                        <div className="row" style={{ justifyContent: "center" }}>
                          <button className="btn" onClick={finish}>Dừng & phân tích</button>
                          <button className="btn ghost" onClick={cancel}>Huỷ</button>
                        </div>
                      </>
                    ) : (
                      <div className="voice-help">
                        <b>Bấm micro rồi nói lần lượt từng việc</b>
                        <span>Mỗi việc nói rõ: làm gì, ai làm, ở toà nào, hạn khi nào.</span>
                        <span className="muted small">VD: "Toà 89 CMT8. Một, Đào mua nội thất theo list, thứ 7 phải về tới toà. Hai, Thi hẹn anh Hiếu qua chụp hình, thứ 2 chụp."</span>
                      </div>
                    )}
                  </>
                )}
              </section>
            ) : (
              <section className="card stack" style={{ padding: 14 }}>
                <textarea id="voice-text" className="input" style={{ minHeight: 220 }} value={text} onChange={(e) => setText(e.target.value)}
                  placeholder={"Dán tin nhắn giao việc (VD copy từ Zalo):\n89 cmt8:\n1. Làm bảng hộp đèn gắn trước cửa\n2. Defect các lỗi đã báo. T7 xong\n…"} disabled={phase === "processing"} />
                <button className="btn" onClick={runText} disabled={phase === "processing" || !text.trim()}>
                  {phase === "processing" ? "Đang tách việc…" : "Phân tích thành việc"}
                </button>
              </section>
            )}
          </>
        ) : null}

        {err ? <div className="error-box" role="alert">{err}</div> : null}

        {phase === "review" || phase === "saving" ? (
          <>
            {transcript ? (
              <details className="card transcript">
                <summary>Nội dung đã nghe</summary>
                <p>{transcript}</p>
              </details>
            ) : null}
            <div className="row">
              <b>Tách được {drafts.length} việc</b><span className="spacer" />
              <button className="btn ghost sm" onClick={() => { setPhase("idle"); setDrafts([]); setTranscript(""); }}>Làm lại</button>
            </div>
            <p className="muted small" style={{ margin: 0 }}>Kiểm tra lại người làm và hạn trước khi giao. Bỏ tick việc không muốn giao.</p>

            {drafts.map((d, idx) => (
              <section key={d.key} className={`card draft${d.include ? "" : " off"}`}>
                <div className="draft-head">
                  <input type="checkbox" id={`inc-${d.key}`} checked={d.include} onChange={(e) => upd(d.key, { include: e.target.checked })} aria-label={`Giao việc ${idx + 1}`} />
                  <textarea id={`title-${d.key}`} rows={2} className="input draft-title" value={d.title} onChange={(e) => upd(d.key, { title: e.target.value })} aria-label="Tên việc" />
                </div>
                <div className="draft-grid">
                  {canAssign ? (
                    <label className="field wide"><span>Người làm{d.assignee_hint ? ` · đã nhắc: ${d.assignee_hint}` : ""}</span>
                      <select id={`as-${d.key}`} className={`input${d.include && !d.assignee_id ? " need" : ""}`} value={d.assignee_id} onChange={(e) => upd(d.key, { assignee_id: e.target.value })}>
                        <option value="">Chọn người làm</option>
                        {assignable.map((p) => <option key={p.id} value={p.id}>{p.id === profile?.id ? `Tôi (${p.full_name})` : `${p.full_name} · ${ROLE_LABEL[p.role]}`}</option>)}
                      </select></label>
                  ) : null}
                  {buildings.length ? (
                    <label className="field"><span>Toà</span>
                      <select id={`b-${d.key}`} className="input" value={d.building_id} onChange={(e) => upd(d.key, { building_id: e.target.value })}>
                        <option value="">Không gắn toà</option>
                        {buildings.map((b) => <option key={b.id} value={b.id}>{b.code}</option>)}
                      </select></label>
                  ) : null}
                  <label className="field"><span>Hạn{d.due_date ? ` · ${dow(d.due_date)} ${ddmm(d.due_date)}` : ""}</span>
                    <input id={`due-${d.key}`} className="input" type="date" value={d.due_date} onChange={(e) => upd(d.key, { due_date: e.target.value })} /></label>
                  <label className="field"><span>Mức độ</span>
                    <select id={`pr-${d.key}`} className="input" value={d.priority} onChange={(e) => upd(d.key, { priority: e.target.value as Priority })}>
                      {(Object.keys(PRIORITY_LABEL) as Priority[]).map((k) => <option key={k} value={k}>{PRIORITY_LABEL[k]}</option>)}
                    </select></label>
                </div>
                <button className="draft-more" onClick={() => upd(d.key, { open: !d.open })} aria-expanded={d.open}>
                  {d.open ? "Ẩn mô tả & các bước" : `Mô tả${d.steps.length ? ` & ${d.steps.length} bước` : ""}`}
                </button>
                {d.open ? (
                  <div className="stack" style={{ padding: "0 14px 14px" }}>
                    <textarea id={`desc-${d.key}`} className="input" value={d.description} onChange={(e) => upd(d.key, { description: e.target.value })} placeholder="Mô tả" />
                    {d.steps.map((s, i) => (
                      <div key={i} className="row" style={{ flexWrap: "nowrap" }}>
                        <span className="muted num" style={{ width: 18, textAlign: "right" }}>{i + 1}.</span>
                        <input id={`st-${d.key}-${i}`} className="input" value={s} onChange={(e) => upd(d.key, { steps: d.steps.map((x, j) => (j === i ? e.target.value : x)) })} />
                        <button className="btn ghost sm" onClick={() => upd(d.key, { steps: d.steps.filter((_, j) => j !== i) })} aria-label={`Xoá bước ${i + 1}`}>Xoá</button>
                      </div>
                    ))}
                    <button className="btn secondary sm" style={{ justifySelf: "start" }} onClick={() => upd(d.key, { steps: [...d.steps, ""] })}>+ Thêm bước</button>
                  </div>
                ) : null}
              </section>
            ))}
            <div style={{ height: 76 }} aria-hidden="true" />
          </>
        ) : null}
      </main>

      {phase === "review" || phase === "saving" ? (
        <div className="savebar">
          <div className="in">
            <span className="small">{chosen.length} việc được chọn{missing ? <b style={{ color: "var(--today)" }}> · {missing} chưa có người làm</b> : null}</span>
            <button className="btn" disabled={!chosen.length || phase === "saving"} onClick={saveAll}>
              {phase === "saving" ? "Đang giao…" : `Giao ${chosen.length} việc`}
            </button>
          </div>
        </div>
      ) : null}
    </>
  );
}
