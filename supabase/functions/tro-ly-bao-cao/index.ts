// Edge Function: trợ lý báo cáo AI (chỉ Quản lý).
// AI không tự viết truy vấn. Hàm này gọi các hàm SQL ai_* bằng phiên của chính người hỏi
// (Postgres kiểm tra quyền), rồi gửi số liệu đã tổng hợp cho Gemini phân tích.
// Không gửi tên/điện thoại/CCCD khách thuê, không gửi lương.
// Body: { mode: "chat", question, chat_id?, context?: { building?, project?, label? } }
//       { mode: "weekly", force? }
import { createClient, type SupabaseClient } from "npm:@supabase/supabase-js@2.45.4";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...cors, "Content-Type": "application/json" } });

// Phân tích cần suy luận nên để mức "low". Đổi được qua secret GEMINI_MODEL_BAO_CAO.
const MODELS = (Deno.env.get("GEMINI_MODEL_BAO_CAO") ?? "gemini-3.6-flash:low,gemini-3.8-flash:low,gemini-3.5-flash-lite")
  .split(",").map((s) => s.trim()).filter(Boolean)
  .map((s) => { const [model, level] = s.split(":"); return { model, level }; });

const SOURCES = ["Phòng & lấp đầy", "Doanh thu & công nợ", "Chi phí & ngân sách", "Công việc & dự án"];
const PRIORITIES = ["thap", "binh_thuong", "cao", "gap"];
const HOURLY_LIMIT = 40;

const SCHEMA = {
  type: "OBJECT",
  properties: {
    title: { type: "STRING", description: "Tiêu đề ngắn của câu hỏi, tối đa 60 ký tự" },
    summary: { type: "STRING", description: "Kết luận chính 1–3 câu, có con số" },
    kpis: {
      type: "ARRAY", description: "2–4 chỉ số chính",
      items: {
        type: "OBJECT",
        properties: {
          label: { type: "STRING" },
          value: { type: "STRING", description: "Đã định dạng, VD '82,5%', '125,4 tr', '12 phòng'" },
          note: { type: "STRING", description: "So sánh ngắn, VD '−3,2 điểm so với T10' hoặc rỗng" },
          tone: { type: "STRING", enum: ["good", "bad", "neutral"] },
        },
        required: ["label", "value", "note", "tone"],
      },
    },
    chart: {
      type: "OBJECT",
      properties: {
        type: { type: "STRING", enum: ["bar", "line", "none"] },
        title: { type: "STRING" },
        unit: { type: "STRING", description: "Đơn vị trục, VD 'triệu đ', '%', 'phòng'" },
        labels: { type: "ARRAY", items: { type: "STRING" } },
        series: {
          type: "ARRAY",
          items: {
            type: "OBJECT",
            properties: { name: { type: "STRING" }, values: { type: "ARRAY", items: { type: "NUMBER" } } },
            required: ["name", "values"],
          },
        },
      },
      required: ["type", "title", "unit", "labels", "series"],
    },
    causes: { type: "ARRAY", items: { type: "STRING" }, description: "Nguyên nhân, mỗi ý 1 câu, dựa trên số liệu" },
    solutions: {
      type: "ARRAY",
      items: {
        type: "OBJECT",
        properties: {
          text: { type: "STRING", description: "Giải pháp cụ thể, có con số hoặc phòng/toà nếu có" },
          task_title: { type: "STRING", description: "Tên việc ngắn bắt đầu bằng động từ, để tạo việc; rỗng nếu không phù hợp" },
          building: { type: "STRING", description: "Mã toà liên quan hoặc rỗng" },
          priority: { type: "STRING", enum: PRIORITIES },
          due_in_days: { type: "INTEGER", description: "Số ngày nên hoàn thành, 1–30" },
        },
        required: ["text", "task_title", "building", "priority", "due_in_days"],
      },
    },
    sources: { type: "ARRAY", items: { type: "STRING", enum: SOURCES } },
    followups: { type: "ARRAY", items: { type: "STRING" }, description: "2–3 câu hỏi tiếp gợi ý, ngắn" },
  },
  required: ["title", "summary", "kpis", "chart", "causes", "solutions", "sources", "followups"],
};

function vnToday() {
  const d = new Date(Date.now() + 7 * 3600_000);
  return d.toISOString().slice(0, 10);
}
function vnMonday() {
  const d = new Date(Date.now() + 7 * 3600_000);
  const dow = (d.getUTCDay() + 6) % 7; // Thứ 2 = 0
  return new Date(d.getTime() - dow * 86400_000).toISOString().slice(0, 10);
}
function monthsAgo(n: number) {
  const d = new Date(Date.now() + 7 * 3600_000);
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() - n, 1)).toISOString().slice(0, 10);
}

const RULES = `Quy tắc:
1. Chỉ dùng số liệu trong DỮ LIỆU. Không bịa số, không bịa phòng, không bịa người. Thiếu dữ liệu thì nói rõ "chưa có dữ liệu …" và đề xuất cách ghi nhận.
2. Tiền VNĐ: viết "125,4 tr" (triệu) hoặc "1,2 tỷ"; phần trăm dùng dấu phẩy thập phân. Ngày dạng dd/mm.
3. summary: kết luận trước, có con số. Tối đa 3 câu.
4. causes: nguyên nhân có căn cứ từ số liệu (VD phòng trống lâu, giá niêm yết cao hơn phòng cùng toà, hợp đồng sắp hết, công nợ dồn ở một toà). Không đoán nguyên nhân bên ngoài nếu không có số liệu; nếu nêu giả thuyết thì ghi "có thể".
5. solutions: 2–4 việc cụ thể làm được trong 30 ngày, nêu rõ toà/phòng/số tiền khi có. task_title ngắn, bắt đầu bằng động từ.
6. chart: chọn 1 biểu đồ giúp hiểu nhất. Tiền tính theo triệu đồng (làm tròn 1 chữ số). labels tối đa 12. Không có số liệu phù hợp thì type "none" và mảng rỗng.
7. sources: chỉ các nhóm dữ liệu thực sự dùng.
8. Câu ngắn, tiếng Việt có dấu, giọng báo cáo cho chủ doanh nghiệp. Không dùng gạch ngang dài.
9. Công ty nghỉ Chủ nhật. Toà khách sạn cho thuê theo đêm nên không có hợp đồng tháng.
10. Câu hỏi ngoài phạm vi số liệu kinh doanh (VD chuyện riêng, lương, thông tin cá nhân khách) thì từ chối lịch sự trong summary, các mảng để rỗng.`;

// Model bận (503, 500, 502, 504), hết lượt riêng của model (429) hoặc chờ quá lâu: chuyển sang model kế tiếp
const BUSY = [429, 500, 502, 503, 504];
const PER_MODEL_MS = 40_000;

async function callGemini(key: string, contents: unknown[], system: string) {
  let lastErr = "";
  let busy = false;
  for (const { model, level } of MODELS) {
    const t0 = performance.now();
    const generationConfig: Record<string, unknown> = {
      responseMimeType: "application/json", responseSchema: SCHEMA, temperature: 0.3, maxOutputTokens: 8192,
    };
    if (level) generationConfig.thinkingConfig = { thinkingLevel: level };
    let res: Response;
    try {
      res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`, {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-goog-api-key": key },
        body: JSON.stringify({ systemInstruction: { parts: [{ text: system }] }, contents, generationConfig }),
        signal: AbortSignal.timeout(PER_MODEL_MS),
      });
    } catch (e) {
      lastErr = `${model}: ${(e as Error).name === "TimeoutError" ? "quá " + PER_MODEL_MS / 1000 + " giây" : (e as Error).message}`;
      console.error("gemini lỗi", lastErr);
      busy = true;
      continue;
    }
    const body = await res.json().catch(() => ({}));
    const ms = Math.round(performance.now() - t0);
    if (res.ok) {
      const u = body?.usageMetadata ?? {};
      console.log(`gemini ${model}${level ? ":" + level : ""} ${ms}ms in=${u.promptTokenCount} out=${u.candidatesTokenCount} think=${u.thoughtsTokenCount ?? 0}`);
      const text = body?.candidates?.[0]?.content?.parts?.filter((p: { thought?: boolean }) => !p.thought)
        .map((p: { text?: string }) => p.text ?? "").join("") ?? "";
      try { return { model, data: JSON.parse(text) }; } catch {
        lastErr = `${model}: trả kết quả không đọc được`; console.error(lastErr, text.slice(0, 300)); continue;
      }
    }
    lastErr = `${model}: ${res.status} ${body?.error?.message ?? ""}`;
    console.error(`gemini lỗi ${ms}ms`, lastErr);
    if (BUSY.includes(res.status)) { busy = true; continue; }
    if (![400, 403, 404].includes(res.status) || !/model|not found|not supported|permission|thinking|no longer available/i.test(lastErr)) break;
  }
  if (busy) throw new Error("busy:" + lastErr);
  throw new Error(lastErr || "Gemini không trả kết quả");
}

// Làm sạch kết quả AI trước khi lưu/trả về
function clean(d: Record<string, unknown>) {
  const s = (v: unknown, n = 600) => String(v ?? "").slice(0, n);
  const arr = (v: unknown) => (Array.isArray(v) ? v : []);
  const chart = (d.chart ?? {}) as Record<string, unknown>;
  const labels = arr(chart.labels).map((x) => s(x, 40)).slice(0, 12);
  const series = arr(chart.series).slice(0, 4).map((x: Record<string, unknown>) => ({
    name: s(x?.name, 60),
    values: arr(x?.values).slice(0, labels.length).map((v) => (Number.isFinite(Number(v)) ? Number(v) : 0)),
  })).filter((x) => x.values.length);
  return {
    title: s(d.title, 80) || "Báo cáo",
    summary: s(d.summary, 900),
    kpis: arr(d.kpis).slice(0, 4).map((k: Record<string, unknown>) => ({
      label: s(k?.label, 50), value: s(k?.value, 30), note: s(k?.note, 80),
      tone: ["good", "bad", "neutral"].includes(String(k?.tone)) ? k.tone : "neutral",
    })),
    chart: { type: series.length && labels.length && ["bar", "line"].includes(String(chart.type)) ? chart.type : "none",
      title: s(chart.title, 80), unit: s(chart.unit, 20), labels, series },
    causes: arr(d.causes).slice(0, 6).map((x) => s(x, 400)).filter(Boolean),
    solutions: arr(d.solutions).slice(0, 5).map((x: Record<string, unknown>) => ({
      text: s(x?.text, 400), task_title: s(x?.task_title, 120), building: s(x?.building, 20),
      priority: PRIORITIES.includes(String(x?.priority)) ? x.priority : "binh_thuong",
      due_in_days: Math.min(30, Math.max(1, Math.round(Number(x?.due_in_days) || 7))),
    })).filter((x) => x.text),
    sources: [...new Set(arr(d.sources).map(String).filter((x) => SOURCES.includes(x)))],
    followups: arr(d.followups).slice(0, 3).map((x) => s(x, 120)).filter(Boolean),
  };
}

async function loadData(db: SupabaseClient) {
  const from = monthsAgo(11);
  const calls = await Promise.all([
    db.rpc("ai_buildings"),
    db.rpc("ai_occupancy", { p_building: null, p_months: 12 }),
    db.rpc("ai_revenue", { p_from: from, p_to: null, p_building: null }),
    db.rpc("ai_costs", { p_from: from, p_to: null, p_building: null }),
    db.rpc("ai_work"),
  ]);
  const err = calls.find((c) => c.error)?.error;
  if (err) throw new Error("db:" + err.message);
  const [b, occ, rev, cost, work] = calls.map((c) => c.data);
  return { "Danh sách toà": b, "Phòng & lấp đầy": occ, "Doanh thu & công nợ": rev, "Chi phí & ngân sách": cost, "Công việc & dự án": work };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST") return json({ error: "Chỉ hỗ trợ POST" }, 405);

  const url = Deno.env.get("SUPABASE_URL")!;
  const admin = createClient(url, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const token = (req.headers.get("Authorization") ?? "").replace(/^Bearer\s+/i, "");
  const { data: who } = await admin.auth.getUser(token);
  if (!who?.user) return json({ error: "Phiên đăng nhập đã hết, vui lòng đăng nhập lại" }, 401);
  const { data: me } = await admin.from("profiles").select("id,full_name,role,is_active").eq("id", who.user.id).single();
  if (!me?.is_active) return json({ error: "Tài khoản chưa được kích hoạt" }, 403);
  if (me.role !== "quan_ly") return json({ error: "Chỉ Quản lý dùng được trợ lý báo cáo AI" }, 403);

  // Mọi truy vấn số liệu và lưu lịch sử chạy bằng phiên của người hỏi (RLS + ai_guard)
  const db = createClient(url, Deno.env.get("SUPABASE_ANON_KEY")!, {
    auth: { persistSession: false, autoRefreshToken: false },
    global: { headers: { Authorization: `Bearer ${token}` } },
  });

  let key = Deno.env.get("GEMINI_API_KEY");
  if (!key) {
    const { data: k } = await admin.rpc("app_secret", { p_name: "gemini_api_key" });
    key = (k as string | null) ?? undefined;
  }
  if (!key) return json({ error: "Tính năng chưa bật: cần cài khoá Gemini (GEMINI_API_KEY) trên Supabase.", code: "no_key" }, 503);

  let body: { mode?: string; question?: string; chat_id?: string; force?: boolean;
    context?: { building?: string; project?: string; label?: string } };
  try { body = await req.json(); } catch { return json({ error: "Dữ liệu gửi lên không hợp lệ" }, 400); }
  const mode = body.mode === "weekly" ? "weekly" : "chat";
  const today = vnToday();

  try {
    // ---------- Nhận định tuần ----------
    if (mode === "weekly") {
      const week = vnMonday();
      if (!body.force) {
        const { data: old } = await db.from("ai_reports").select("week_start,content,created_at").eq("week_start", week).maybeSingle();
        if (old) return json({ week_start: old.week_start, created_at: old.created_at, answer: old.content, cached: true });
      }
      const data = await loadData(db);
      const system = `Bạn là chuyên viên phân tích kinh doanh của Next Living, công ty cho thuê căn hộ dịch vụ và khách sạn tại TP.HCM. Hôm nay ${today}, tuần bắt đầu ${week}.
Nhiệm vụ: lập NHẬN ĐỊNH TUẦN cho chủ doanh nghiệp. Chọn 3 điểm quan trọng nhất trong toàn bộ số liệu (ưu tiên: lấp đầy giảm, phòng trống lâu, công nợ quá hạn, chi phí tăng bất thường, dự án chậm, việc trễ hạn). summary nêu 3 điểm đó gọn trong 3 câu. kpis là 4 chỉ số: lấp đầy, doanh thu tháng, công nợ quá hạn, dự án/việc trễ.
${RULES}`;
      const contents = [{ role: "user", parts: [{ text: `DỮ LIỆU (JSON):\n${JSON.stringify(data)}\n\nLập nhận định tuần.` }] }];
      const { model, data: out } = await callGemini(key, contents, system);
      const answer = { ...clean(out), as_of: today, model };
      const { data: saved, error } = await db.from("ai_reports")
        .upsert({ week_start: week, content: answer, created_by: me.id, created_at: new Date().toISOString() }, { onConflict: "week_start" })
        .select("week_start,created_at").single();
      if (error) console.error("luu ai_reports", error.message);
      return json({ week_start: week, created_at: saved?.created_at ?? new Date().toISOString(), answer, cached: false });
    }

    // ---------- Hỏi đáp ----------
    const question = String(body.question ?? "").trim();
    if (!question) return json({ error: "Chưa có câu hỏi" }, 400);
    if (question.length > 1500) return json({ error: "Câu hỏi quá dài, tối đa 1.500 ký tự" }, 413);

    const { count } = await admin.from("ai_messages").select("id, ai_chats!inner(user_id)", { count: "exact", head: true })
      .eq("role", "user").eq("ai_chats.user_id", me.id).gte("created_at", new Date(Date.now() - 3600_000).toISOString());
    if ((count ?? 0) >= HOURLY_LIMIT) return json({ error: `Đã hỏi ${HOURLY_LIMIT} câu trong 1 giờ. Thử lại sau ít phút.` }, 429);

    const ctx = body.context ?? {};
    let chatId = body.chat_id ?? null;
    let history: { role: string; content: Record<string, unknown> }[] = [];
    if (chatId) {
      const { data: h, error } = await db.from("ai_messages").select("role,content").eq("chat_id", chatId)
        .order("created_at", { ascending: false }).limit(8);
      if (error) return json({ error: "Không mở được cuộc hỏi cũ" }, 404);
      history = (h ?? []).reverse();
    }

    const data = await loadData(db);
    const where = ctx.label || ctx.building || ctx.project
      ? `Người hỏi đang xem: ${[ctx.label, ctx.building && "toà " + ctx.building, ctx.project && "dự án " + ctx.project].filter(Boolean).join(", ")}. Nếu câu hỏi không nói rõ toà/dự án khác thì tập trung vào đây.`
      : "Người hỏi đang ở trang tổng quan, phân tích toàn công ty trừ khi câu hỏi nêu toà/dự án cụ thể.";
    const system = `Bạn là chuyên viên phân tích kinh doanh của Next Living, công ty cho thuê căn hộ dịch vụ và khách sạn tại TP.HCM. Hôm nay ${today}.
Trả lời câu hỏi của chủ doanh nghiệp: thống kê, đánh giá, tìm nguyên nhân, đề xuất giải pháp. ${where}
${RULES}`;
    const contents = [
      ...history.map((m) => ({
        role: m.role === "user" ? "user" : "model",
        parts: [{ text: m.role === "user" ? String(m.content?.text ?? "")
          : JSON.stringify({ summary: m.content?.summary, causes: m.content?.causes, solutions: (m.content?.solutions as { text: string }[] | undefined)?.map((x) => x.text) }) }],
      })),
      { role: "user", parts: [{ text: `DỮ LIỆU (JSON, cập nhật ${today}):\n${JSON.stringify(data)}\n\nCÂU HỎI: ${question}` }] },
    ];
    const { model, data: out } = await callGemini(key, contents, system);
    const answer = { ...clean(out), as_of: today, model };

    if (!chatId) {
      const { data: c, error } = await db.from("ai_chats")
        .insert({ title: answer.title || question.slice(0, 60), context: Object.keys(ctx).length ? ctx : null })
        .select("id").single();
      if (error) throw new Error("db:" + error.message);
      chatId = c.id;
    } else {
      await db.from("ai_chats").update({ updated_at: new Date().toISOString() }).eq("id", chatId);
    }
    await db.from("ai_messages").insert([
      { chat_id: chatId, role: "user", content: { text: question, context: ctx } },
      { chat_id: chatId, role: "assistant", content: answer },
    ]);
    return json({ chat_id: chatId, answer });
  } catch (e) {
    const msg = (e as Error).message;
    console.error("tro-ly-bao-cao", msg);
    if (msg.startsWith("db:")) return json({ error: "Không lấy được số liệu: " + msg.slice(3, 200) }, 403);
    if (msg.startsWith("busy:")) return json({ error: "Máy chủ AI của Google đang quá tải, cả 3 model đều bận. Anh thử lại sau 1–2 phút.", code: "busy" }, 503);
    if (/API key|API_KEY_INVALID|PERMISSION_DENIED/i.test(msg)) return json({ error: "Khoá Gemini không hợp lệ hoặc hết hạn.", code: "bad_key" }, 502);
    if (/quota|RESOURCE_EXHAUSTED|429/i.test(msg)) return json({ error: "Đã dùng hết hạn mức AI tạm thời. Thử lại sau ít phút." }, 429);
    return json({ error: "AI chưa trả lời được: " + msg.slice(0, 300) }, 502);
  }
});
