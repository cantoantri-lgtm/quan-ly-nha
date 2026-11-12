// Edge Function: đọc số trên ảnh đồng hồ điện bằng Gemini. Khoá đặt trong secret GEMINI_API_KEY (không xuống trình duyệt).
// Người dùng đang hoạt động nào cũng gọi được (khách tự chụp công tơ). Kết quả chỉ là gợi ý, người dùng xác nhận lại.
import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2.45.4";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...cors, "Content-Type": "application/json" } });

const MODELS = (Deno.env.get("GEMINI_MODEL") ?? "gemini-3.6-flash:minimal,gemini-3.5-flash-lite,gemini-3.8-flash:low")
  .split(",").map((s) => s.trim()).filter(Boolean)
  .map((s) => { const [model, level] = s.split(":"); return { model, level }; });
const MAX_B64 = 4_000_000; // ~3 MB ảnh

const SCHEMA = {
  type: "OBJECT",
  properties: {
    is_meter: { type: "BOOLEAN", description: "Ảnh có thấy đồng hồ điện (công tơ) với dãy số không" },
    reading: { type: "NUMBER", description: "Số kWh đọc được (phần nguyên các chữ số nền trắng/đen; bỏ chữ số đỏ sau dấu phẩy nếu có)" },
    confidence: { type: "STRING", enum: ["cao", "trung_binh", "thap"] },
  },
  required: ["is_meter", "confidence"],
};
const PROMPT = `Đây là ảnh đồng hồ điện (công tơ điện) ở Việt Nam. Hãy đọc chỉ số tiêu thụ hiện tại (kWh).
- Chỉ đọc dãy số chỉ số điện năng, KHÔNG đọc số seri, số hiệu, hằng số xung (imp/kWh), hay dòng điện/điện áp.
- Với công tơ cơ có chữ số cuối màu đỏ: bỏ chữ số đỏ, chỉ lấy phần nguyên.
- Với công tơ điện tử có nhiều màn hình, lấy chỉ số tổng (kWh) hiện tại.
- Nếu ảnh mờ, không thấy đồng hồ hoặc không chắc, đặt is_meter=false hoặc confidence="thap", không đoán.`;

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST") return json({ error: "Chỉ hỗ trợ POST" }, 405);
  const admin = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, { auth: { persistSession: false, autoRefreshToken: false } });
  const token = (req.headers.get("Authorization") ?? "").replace(/^Bearer\s+/i, "");
  const { data: who } = await admin.auth.getUser(token);
  if (!who?.user) return json({ error: "Phiên đăng nhập đã hết, vui lòng đăng nhập lại" }, 401);
  const { data: me } = await admin.from("profiles").select("is_active").eq("id", who.user.id).single();
  if (!me?.is_active) return json({ error: "Tài khoản không hoạt động" }, 403);

  let key = Deno.env.get("GEMINI_API_KEY");
  if (!key) {
    const { data: k } = await admin.rpc("app_secret", { p_name: "gemini_api_key" });
    key = (k as string | null) ?? undefined;
  }
  if (!key) return json({ error: "Chưa bật đọc số tự động. Bạn nhập số bằng tay.", code: "no_key" }, 503);

  let body: { image?: string; mime?: string };
  try { body = await req.json(); } catch { return json({ error: "Dữ liệu không hợp lệ" }, 400); }
  if (!body.image) return json({ error: "Thiếu ảnh" }, 400);
  if (body.image.length > MAX_B64) return json({ error: "Ảnh quá lớn" }, 413);
  const mime = ["image/jpeg", "image/png", "image/webp"].includes(String(body.mime)) ? String(body.mime) : "image/jpeg";

  let lastErr = "";
  for (const { model, level } of MODELS) {
    const generationConfig: Record<string, unknown> = { responseMimeType: "application/json", responseSchema: SCHEMA, temperature: 0, maxOutputTokens: 512 };
    if (level) generationConfig.thinkingConfig = { thinkingLevel: level };
    const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`, {
      method: "POST", headers: { "Content-Type": "application/json", "x-goog-api-key": key },
      body: JSON.stringify({ contents: [{ role: "user", parts: [{ inline_data: { mime_type: mime, data: body.image } }, { text: PROMPT }] }], generationConfig }),
    });
    const out = await res.json().catch(() => ({}));
    if (res.ok) {
      try {
        const text = out?.candidates?.[0]?.content?.parts?.map((p: { text?: string }) => p.text ?? "").join("") ?? "";
        const d = JSON.parse(text);
        const reading = d.is_meter && Number.isFinite(Number(d.reading)) && Number(d.reading) >= 0 ? Math.round(Number(d.reading) * 10) / 10 : null;
        return json({ reading, confidence: d.confidence ?? "thap", is_meter: !!d.is_meter });
      } catch { return json({ reading: null, confidence: "thap", is_meter: false }); }
    }
    lastErr = `${model}: ${res.status} ${out?.error?.message ?? ""}`;
    console.error("gemini lỗi", lastErr);
    if (![400, 403, 404].includes(res.status) || !/model|not found|not supported|permission|thinking|no longer available/i.test(lastErr)) break;
  }
  return json({ error: "Không đọc được số tự động. Bạn nhập số bằng tay.", detail: lastErr }, 502);
});
