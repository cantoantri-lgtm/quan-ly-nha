import { useEffect, useState } from "react";
import { matchPath, useLocation } from "react-router-dom";
import { supabase } from "./supabase";
import { useSession } from "./session";
import { addDaysISO, todayVN } from "./dates";

/* Trợ lý báo cáo AI (chỉ Quản lý). Số liệu do SQL ai_* tính; Edge Function tro-ly-bao-cao gửi cho Gemini phân tích. */

export type AiKpi = { label: string; value: string; note: string; tone: "good" | "bad" | "neutral" };
export type AiChart = { type: "bar" | "line" | "none"; title: string; unit: string; labels: string[]; series: { name: string; values: number[] }[] };
export type AiSolution = { text: string; task_title: string; building: string; priority: string; due_in_days: number };
export type AiAnswer = {
  title: string; summary: string; kpis: AiKpi[]; chart: AiChart; causes: string[]; solutions: AiSolution[];
  sources: string[]; followups: string[]; as_of: string; model?: string;
};
export type AiContext = { building?: string; project?: string; label?: string };
export type AiMsg = { role: "user" | "assistant"; text?: string; answer?: AiAnswer; at?: string };
export type AiChatRow = { id: string; title: string; context: AiContext | null; updated_at: string };

async function call<T>(body: Record<string, unknown>): Promise<T> {
  const { data, error } = await supabase.functions.invoke("tro-ly-bao-cao", { body });
  if (error) {
    let msg = "Không kết nối được trợ lý AI. Thử lại sau ít phút.";
    try {
      const ctx = (error as { context?: Response }).context;
      const j = ctx && typeof ctx.json === "function" ? await ctx.json() : null;
      if (j?.error) msg = j.error;
    } catch { /* giữ thông báo mặc định */ }
    throw new Error(msg);
  }
  return data as T;
}

export const askAi = (question: string, chatId: string | null, context: AiContext) =>
  call<{ chat_id: string; answer: AiAnswer }>({ mode: "chat", question, chat_id: chatId, context });

export const weeklyAi = (force = false) =>
  call<{ week_start: string; created_at: string; answer: AiAnswer; cached: boolean }>({ mode: "weekly", force });

export async function loadChats(): Promise<AiChatRow[]> {
  const { data } = await supabase.from("ai_chats").select("id,title,context,updated_at").order("updated_at", { ascending: false }).limit(30);
  return (data ?? []) as AiChatRow[];
}

export async function loadMessages(chatId: string): Promise<AiMsg[]> {
  const { data } = await supabase.from("ai_messages").select("role,content,created_at").eq("chat_id", chatId).order("created_at");
  return ((data ?? []) as { role: "user" | "assistant"; content: Record<string, unknown>; created_at: string }[]).map((m) =>
    m.role === "user" ? { role: "user", text: String(m.content?.text ?? ""), at: m.created_at }
      : { role: "assistant", answer: m.content as unknown as AiAnswer, at: m.created_at });
}

export const deleteChat = (id: string) => supabase.from("ai_chats").delete().eq("id", id);

/** Ngữ cảnh theo màn hình đang mở: toà đang xem, dự án đang xem */
export function useAiContext(): AiContext {
  const loc = useLocation();
  const { buildings } = useSession();
  const [project, setProject] = useState<{ id: string; code: string; name: string } | null>(null);
  const bm = matchPath("/toa/:id/*", loc.pathname) ?? matchPath("/toa/:id", loc.pathname);
  const pm = matchPath("/du-an/:id", loc.pathname) ?? matchPath("/du-an/:id/*", loc.pathname);
  const pid = pm && pm.params.id !== "moi" ? pm.params.id : null;
  useEffect(() => {
    if (!pid) { setProject(null); return; }
    if (project?.id === pid) return;
    supabase.from("projects").select("id,code,name").eq("id", pid).maybeSingle()
      .then(({ data }) => setProject((data as { id: string; code: string; name: string } | null) ?? null));
  }, [pid]);   // eslint-disable-line react-hooks/exhaustive-deps
  if (bm?.params.id) {
    const b = buildings.find((x) => x.id === bm.params.id);
    if (b) return { building: b.code, label: `Toà ${b.code}${b.name && b.name !== b.code ? " · " + b.name : ""}` };
  }
  if (pid && project?.id === pid) return { project: project.code, label: `Dự án ${project.code} · ${project.name}` };
  return {};
}

/** Mở màn hình Giao việc đã điền sẵn từ một giải pháp AI. Người dùng xem lại rồi mới bấm lưu. */
export function taskLinkFrom(s: AiSolution, buildings: { id: string; code: string }[]) {
  const p = new URLSearchParams();
  p.set("tieu-de", (s.task_title || s.text).slice(0, 120));
  p.set("mo-ta", `Đề xuất từ Báo cáo AI (${todayVN().split("-").reverse().join("/")}): ${s.text}`);
  p.set("han", addDaysISO(todayVN(), s.due_in_days || 7));
  if (s.priority) p.set("uu-tien", s.priority);
  const b = s.building ? buildings.find((x) => x.code.toLowerCase() === s.building.toLowerCase()) : null;
  if (b) p.set("toa", b.id);
  return `/viec/moi?${p.toString()}`;
}

/** Sự kiện mở khung chat AI từ bất kỳ đâu (nút ✦, thẻ nhận định…) */
export const AI_OPEN_EVENT = "nl:ai-open";
export function openAiPanel(question?: string) {
  window.dispatchEvent(new CustomEvent(AI_OPEN_EVENT, { detail: { question } }));
}

export const AI_SUGGEST = [
  "Vì sao tỉ lệ lấp đầy tháng này thay đổi?",
  "Phòng nào trống lâu nhất và nên làm gì?",
  "Công nợ quá hạn đang dồn ở toà nào?",
  "Chi phí tháng này so với tháng trước thế nào?",
  "Dự án nào đang chậm tiến độ?",
];
