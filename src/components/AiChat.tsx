import { useEffect, useRef, useState, type FormEvent } from "react";
import { AI_SUGGEST, askAi, type AiContext, type AiMsg } from "../lib/ai";
import { AiAnswerView, Spark } from "./AiAnswer";

/** Hỏi đáp với trợ lý báo cáo. Dùng chung cho trang Báo cáo AI (Hỏi tiếp) và khung chat bên phải. */
export function AiChat({ context, chatId: startId = null, initial = [], ask, onAsked, onChat, placeholder, suggest = AI_SUGGEST }: {
  context: AiContext;
  chatId?: string | null;
  initial?: AiMsg[];
  ask?: string | null;            // câu hỏi gửi từ ngoài vào (nút gợi ý, thẻ nhận định)
  onAsked?: () => void;
  onChat?: (id: string) => void;
  placeholder?: string;
  suggest?: string[];
}) {
  const [chatId, setChatId] = useState<string | null>(startId);
  const [msgs, setMsgs] = useState<AiMsg[]>(initial);
  const [q, setQ] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const endRef = useRef<HTMLDivElement>(null);
  const boxRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => { endRef.current?.scrollIntoView({ block: "end", behavior: "smooth" }); }, [msgs.length, busy]);

  async function send(text: string) {
    const question = text.trim();
    if (!question || busy) return;
    setErr(null); setBusy(true); setQ("");
    setMsgs((m) => [...m, { role: "user", text: question }]);
    try {
      const r = await askAi(question, chatId, context);
      setChatId(r.chat_id); onChat?.(r.chat_id);
      setMsgs((m) => [...m, { role: "assistant", answer: r.answer }]);
    } catch (e) {
      setErr((e as Error).message);
      setMsgs((m) => m.slice(0, -1)); setQ(question);
    } finally { setBusy(false); }
  }

  useEffect(() => {
    if (ask) { onAsked?.(); void send(ask); }
  }, [ask]);   // eslint-disable-line react-hooks/exhaustive-deps

  function submit(e: FormEvent) { e.preventDefault(); void send(q); }

  return (
    <div className="ai-chat">
      <div className="ai-msgs">
        {msgs.length === 0 && !busy ? (
          <div className="ai-hello">
            <span className="ai-av"><Spark size={18} /></span>
            <p>Anh hỏi về phòng trống, doanh thu, công nợ, chi phí, dự án hay công việc. Em đọc số liệu trong app rồi phân tích nguyên nhân và đề xuất việc nên làm.</p>
            <div className="ai-chips">{suggest.map((s) => <button key={s} type="button" onClick={() => send(s)}>{s}</button>)}</div>
          </div>
        ) : null}
        {msgs.map((m, i) => m.role === "user" ? (
          <div key={i} className="ai-q">{m.text}</div>
        ) : m.answer ? (
          <div key={i} className="ai-a"><span className="ai-av"><Spark size={15} /></span><AiAnswerView a={m.answer} onFollow={send} compact /></div>
        ) : null)}
        {busy ? <div className="ai-a"><span className="ai-av"><Spark size={15} /></span><div className="ai-wait" role="status"><i /><i /><i /> Đang đọc số liệu và phân tích…</div></div> : null}
        {err ? <div className="error-box" role="alert">{err}</div> : null}
        <div ref={endRef} />
      </div>
      <form className="ai-input" onSubmit={submit}>
        <textarea ref={boxRef} rows={1} value={q} maxLength={1500} aria-label="Câu hỏi cho trợ lý báo cáo"
          placeholder={placeholder ?? "Hỏi về số liệu… VD: Vì sao tháng này doanh thu giảm?"}
          onChange={(e) => setQ(e.target.value)}
          onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) { e.preventDefault(); void send(q); } }} />
        <button type="submit" className="ai-send" disabled={busy || !q.trim()} aria-label="Gửi câu hỏi">
          <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M5 12h14M13 6l6 6-6 6" /></svg>
        </button>
      </form>
    </div>
  );
}
