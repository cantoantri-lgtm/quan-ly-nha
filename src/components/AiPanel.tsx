import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { AI_OPEN_EVENT, deleteChat, loadChats, loadMessages, useAiContext, type AiChatRow, type AiContext, type AiMsg } from "../lib/ai";
import { ddmm } from "../lib/dates";
import { useSession } from "../lib/session";
import { AiChat } from "./AiChat";
import { Spark } from "./AiAnswer";
import { Icon } from "./ui";

/* Khung chat AI bên phải (PC) / bảng trượt từ dưới (điện thoại). Mở bằng nút ✦ trên thanh trên cùng.
   Ngữ cảnh theo màn hình đang xem: đang ở trang toà thì hỏi mặc định về toà đó. */

type Conv = { key: number; id: string | null; msgs: AiMsg[]; context: AiContext | null };

export function AiPanel() {
  const { isManager } = useSession();
  const live = useAiContext();
  const [open, setOpen] = useState(false);
  const [ask, setAsk] = useState<string | null>(null);
  const [conv, setConv] = useState<Conv>({ key: 1, id: null, msgs: [], context: null });
  const [list, setList] = useState<AiChatRow[] | null>(null);

  useEffect(() => {
    const on = (e: Event) => {
      const q = (e as CustomEvent<{ question?: string }>).detail?.question;
      setOpen(true); setList(null);
      if (q) setAsk(q);
    };
    window.addEventListener(AI_OPEN_EVENT, on);
    return () => window.removeEventListener(AI_OPEN_EVENT, on);
  }, []);
  useEffect(() => {
    if (!open) return;
    const k = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    document.addEventListener("keydown", k);
    return () => document.removeEventListener("keydown", k);
  }, [open]);
  useEffect(() => { document.body.classList.toggle("ai-open", open); }, [open]);

  if (!isManager) return null;
  // Cuộc hỏi đang dở giữ ngữ cảnh lúc bắt đầu; cuộc mới theo màn hình đang xem
  const ctx = conv.id || conv.msgs.length ? (conv.context ?? {}) : live;
  const fresh = () => { setConv((c) => ({ key: c.key + 1, id: null, msgs: [], context: null })); setList(null); };

  async function showList() { setList([]); setList(await loadChats()); }
  async function openChat(c: AiChatRow) {
    const msgs = await loadMessages(c.id);
    setConv((o) => ({ key: o.key + 1, id: c.id, msgs, context: c.context ?? {} }));
    setList(null);
  }
  async function remove(c: AiChatRow) {
    await deleteChat(c.id);
    setList((l) => (l ?? []).filter((x) => x.id !== c.id));
    if (conv.id === c.id) fresh();
  }

  return (
    <>
      {open ? <div className="ai-back" onClick={() => setOpen(false)} /> : null}
      <aside className={`ai-panel${open ? " open" : ""}`} aria-label="Trợ lý báo cáo AI" aria-hidden={!open} ref={(el) => { if (el) el.toggleAttribute("inert", !open); }}>
        <div className="grip" />
        <header className="ai-ph">
          <span className="ai-av"><Spark size={16} /></span>
          <div className="ai-pt"><b>Trợ lý báo cáo</b><small>{ctx.label ?? "Toàn công ty"}</small></div>
          <button type="button" className="ai-ib" onClick={() => (list ? setList(null) : showList())} aria-pressed={!!list} title="Các cuộc hỏi trước">
            <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M3 12a9 9 0 1 0 3-6.7L3 8" /><path d="M3 3v5h5M12 7v5l3 2" /></svg>
            <span className="sr-only">Lịch sử</span>
          </button>
          <button type="button" className="ai-ib" onClick={fresh} title="Cuộc hỏi mới">
            <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true"><path d="M12 5v14M5 12h14" /></svg>
            <span className="sr-only">Cuộc hỏi mới</span>
          </button>
          <button type="button" className="ai-ib" onClick={() => setOpen(false)} title="Đóng (Esc)">{Icon.x}<span className="sr-only">Đóng</span></button>
        </header>
        {list ? (
          <div className="ai-hist">
            <Link to="/bao-cao-ai" className="ai-hist-top" onClick={() => setOpen(false)}>Mở trang Báo cáo AI (nhận định tuần, 4 chỉ số) →</Link>
            {list.length === 0 ? <p className="muted">Chưa có cuộc hỏi nào.</p> : list.map((c) => (
              <div key={c.id} className="ai-hrow">
                <button type="button" onClick={() => openChat(c)}>
                  <b>{c.title}</b><small>{ddmm(c.updated_at)}{c.context?.label ? " · " + c.context.label : ""}</small>
                </button>
                <button type="button" className="ai-ib" title="Xoá cuộc hỏi" onClick={() => remove(c)}>{Icon.x}<span className="sr-only">Xoá</span></button>
              </div>
            ))}
          </div>
        ) : (
          <AiChat key={conv.key} context={ctx} chatId={conv.id} initial={conv.msgs} ask={ask} onAsked={() => setAsk(null)}
            onChat={(id) => setConv((c) => (c.id ? c : { ...c, id, context: ctx }))}
            placeholder={ctx.building ? `Hỏi về toà ${ctx.building}…` : ctx.project ? `Hỏi về dự án ${ctx.project}…` : undefined}
            suggest={ctx.building ? [`Tình hình ${ctx.label} tháng này thế nào?`, `Phòng nào ở toà ${ctx.building} trống lâu và vì sao?`, `Công nợ toà ${ctx.building} ra sao?`]
              : ctx.project ? [`Dự án ${ctx.project} có đang chậm không, vì sao?`, `Ngân sách dự án ${ctx.project} đã dùng bao nhiêu?`] : undefined} />
        )}
      </aside>
    </>
  );
}
