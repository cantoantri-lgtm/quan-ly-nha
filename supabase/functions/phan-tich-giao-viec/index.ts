// Edge Function: phân tích ghi âm hoặc tin nhắn giao việc → danh sách việc có cấu trúc
// Dùng Gemini (khoá đặt trong secret GEMINI_API_KEY). Model đổi được qua secret GEMINI_MODEL.
import { createClient } from "npm:@supabase/supabase-js@2.45.4";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...cors, "Content-Type": "application/json" } });

// Model + mức "suy nghĩ". Tắt suy nghĩ dài để trả kết quả nhanh (việc tách việc không cần suy luận sâu).
// Có thể đổi bằng secret GEMINI_MODEL, VD "gemini-3.6-flash:minimal,gemini-3.5-flash-lite"
const MODELS = (Deno.env.get("GEMINI_MODEL") ?? "gemini-3.6-flash:minimal,gemini-3.5-flash-lite,gemini-3.8-flash:low")
  .split(",").map((s) => s.trim()).filter(Boolean)
  .map((s) => { const [model, level] = s.split(":"); return { model, level }; });
const MAX_AUDIO_B64 = 14_000_000; // ~10 MB WAV ≈ 5 phút 16 kHz mono
const RANK: Record<string, number> = { quan_ly: 3, giam_sat: 2, nhan_vien: 1 };
const ROLE_VI: Record<string, string> = { quan_ly: "Quản lý", giam_sat: "Giám sát", nhan_vien: "Nhân viên" };
const DOW_VI = ["Chủ nhật", "Thứ 2", "Thứ 3", "Thứ 4", "Thứ 5", "Thứ 6", "Thứ 7"];
const PRIORITIES = ["thap", "binh_thuong", "cao", "gap"];

function vnDate(offsetDays = 0) {
  const d = new Date(Date.now() + 7 * 3600_000 + offsetDays * 86400_000);
  return { iso: d.toISOString().slice(0, 10), dow: d.getUTCDay() };
}

const SCHEMA = {
  type: "OBJECT",
  properties: {
    transcript: { type: "STRING", description: "Lời nói được chép lại nguyên văn (tiếng Việt có dấu). Rỗng nếu đầu vào là văn bản." },
    tasks: {
      type: "ARRAY",
      items: {
        type: "OBJECT",
        properties: {
          title: { type: "STRING" },
          description: { type: "STRING" },
          assignee_ref: { type: "STRING", description: "Mã người làm trong danh sách (P1, P2…) hoặc rỗng" },
          assignee_hint: { type: "STRING", description: "Tên người làm như được nhắc tới, kể cả khi không có trong danh sách" },
          building_ref: { type: "STRING", description: "Mã toà trong danh sách (B1, B2…) hoặc rỗng" },
          due_date: { type: "STRING", description: "YYYY-MM-DD hoặc rỗng" },
          priority: { type: "STRING", enum: PRIORITIES },
          steps: { type: "ARRAY", items: { type: "STRING" } },
        },
        required: ["title", "description", "assignee_ref", "assignee_hint", "building_ref", "due_date", "priority", "steps"],
      },
    },
  },
  required: ["transcript", "tasks"],
};

function buildPrompt(people: { ref: string; name: string; role: string; me: boolean }[],
  buildings: { ref: string; code: string; name: string }[], isAudio: boolean) {
  const today = vnDate();
  const week = Array.from({ length: 8 }, (_, i) => vnDate(i))
    .map((d, i) => `${i === 0 ? "Hôm nay" : i === 1 ? "Ngày mai" : DOW_VI[d.dow]} = ${d.iso}${i > 1 ? "" : ` (${DOW_VI[d.dow]})`}`)
    .join("; ");
  return `Bạn là trợ lý giao việc cho công ty quản lý toà nhà cho thuê và khách sạn ở Việt Nam.
${isAudio ? "Đầu vào là một đoạn ghi âm người quản lý đang giao việc. Hãy chép lại lời nói vào trường transcript, rồi tách thành các việc." : "Đầu vào là tin nhắn giao việc (thường copy từ Zalo). Trường transcript để rỗng."}

Lịch: ${week}. Ngày dạng "T2…T7", "thứ 2…thứ 7", "CN" là ngày gần nhất SẮP TỚI (tính cả hôm nay) có thứ đó. "Cuối tuần" = Thứ 7 sắp tới. Ngày dạng "15/11" là năm ${today.iso.slice(0, 4)}.

Người có thể nhận việc (chỉ chọn trong danh sách này):
${people.map((p) => `- ${p.ref}: ${p.name} (${ROLE_VI[p.role]})${p.me ? " — chính là người đang giao việc" : ""}`).join("\n")}

Toà nhà:
${buildings.length ? buildings.map((b) => `- ${b.ref}: ${b.code} — ${b.name}`).join("\n") : "(chưa có toà nào)"}

Quy tắc:
1. Mỗi đầu việc riêng biệt là một task. Danh sách đánh số 1, 2, 3… thì mỗi số là một task. Không gộp, không bỏ sót.
2. title: ngắn gọn, bắt đầu bằng động từ, tối đa ~70 ký tự, tiếng Việt có dấu, viết lại cho rõ (VD "Mua 2 bộ bàn ghế ngoài trời").
3. description: tối đa 1–2 câu ngắn, chỉ ghi chi tiết chưa có trong title (yêu cầu, lưu ý, người liên quan); không lặp lại title, không có gì thêm thì để rỗng. Viết rõ chữ viết tắt: "c" = chị, "a" = anh, "k"/"ko" = không, "dc" = được, "kd" = kinh doanh, "t7" = thứ 7.
4. assignee_ref: chỉ điền khi người được nhắc rõ ràng khớp một người trong danh sách (so tên gọi, VD "Đào" khớp "Nguyễn Thị Đào"). Người ngoài danh sách (thợ, chủ nhà, "a Hiếu"…) thì để rỗng và ghi tên vào assignee_hint + description. Không đoán.
5. building_ref: chỉ điền khi nhắc tới toà/địa chỉ khớp danh sách. Nếu cả tin nhắn nói về một toà (VD tiêu đề "89 cmt8") thì gán toà đó cho mọi task.
6. due_date: chỉ điền khi có mốc thời gian; nhiều mốc thì lấy mốc hoàn thành cuối cùng của task, các mốc trung gian đưa vào steps.
7. priority: "gap" nếu nói gấp/ngay/hôm nay; "cao" nếu hạn trong 2 ngày hoặc nhấn mạnh "phải"; mặc định "binh_thuong".
8. steps: chỉ khi việc có nhiều công đoạn rõ ràng (VD có "gửi chị duyệt trước khi mua" thì có bước duyệt); tối đa 4 bước, mỗi bước ngắn gọn. Việc đơn giản để mảng rỗng.
9. Không bịa thông tin không có trong đầu vào.`;
}

async function callGemini(key: string, parts: unknown[]) {
  let lastErr = "";
  for (const { model, level } of MODELS) {
    const t0 = performance.now();
    const generationConfig: Record<string, unknown> = {
      responseMimeType: "application/json", responseSchema: SCHEMA, temperature: 0.2, maxOutputTokens: 4096,
    };
    if (level) generationConfig.thinkingConfig = { thinkingLevel: level };
    const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-goog-api-key": key },
      body: JSON.stringify({ contents: [{ role: "user", parts }], generationConfig }),
    });
    const body = await res.json().catch(() => ({}));
    const ms = Math.round(performance.now() - t0);
    if (res.ok) {
      const u = body?.usageMetadata ?? {};
      console.log(`gemini ${model}${level ? ":" + level : ""} ${ms}ms in=${u.promptTokenCount} out=${u.candidatesTokenCount} think=${u.thoughtsTokenCount ?? 0}`);
      const text = body?.candidates?.[0]?.content?.parts?.map((p: { text?: string }) => p.text ?? "").join("") ?? "";
      return { model, data: JSON.parse(text) };
    }
    lastErr = `${model}: ${res.status} ${body?.error?.message ?? ""}`;
    console.error(`gemini lỗi ${ms}ms`, lastErr);
    // Model / mức suy nghĩ không hỗ trợ → thử cấu hình kế tiếp; lỗi khác (khoá, hạn mức) thì dừng
    if (![400, 403, 404].includes(res.status) || !/model|not found|not supported|permission|thinking|no longer available/i.test(lastErr)) break;
  }
  throw new Error(lastErr || "Gemini không trả kết quả");
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST") return json({ error: "Chỉ hỗ trợ POST" }, 405);

  const admin = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const token = (req.headers.get("Authorization") ?? "").replace(/^Bearer\s+/i, "");
  const { data: who } = await admin.auth.getUser(token);
  if (!who?.user) return json({ error: "Phiên đăng nhập đã hết, vui lòng đăng nhập lại" }, 401);
  const { data: me } = await admin.from("profiles").select("id,full_name,role,is_active").eq("id", who.user.id).single();
  if (!me?.is_active) return json({ error: "Tài khoản chưa được kích hoạt" }, 403);
  if (me.role === "nhan_vien") return json({ error: "Chỉ Quản lý và Giám sát được giao việc" }, 403);

  // Khoá lấy từ secret GEMINI_API_KEY, nếu không có thì từ Supabase Vault (tên gemini_api_key)
  let key = Deno.env.get("GEMINI_API_KEY");
  if (!key) {
    const { data: k } = await admin.rpc("app_secret", { p_name: "gemini_api_key" });
    key = (k as string | null) ?? undefined;
  }
  if (!key) return json({ error: "Tính năng chưa bật: quản lý cần cài khoá Gemini (GEMINI_API_KEY) trên Supabase.", code: "no_key" }, 503);

  let body: { audio?: string; mime?: string; text?: string };
  try { body = await req.json(); } catch { return json({ error: "Dữ liệu gửi lên không hợp lệ" }, 400); }
  const isAudio = !!body.audio;
  if (!isAudio && !(body.text ?? "").trim()) return json({ error: "Chưa có nội dung ghi âm hoặc tin nhắn" }, 400);
  if (isAudio && body.audio!.length > MAX_AUDIO_B64) return json({ error: "Ghi âm quá dài, tối đa khoảng 5 phút" }, 413);
  if (!isAudio && body.text!.length > 20000) return json({ error: "Tin nhắn quá dài" }, 413);

  // Ngữ cảnh: những người được phép giao + toà nhà theo quyền của người gọi
  const [{ data: allPeople }, { data: members }, { data: allBuildings }] = await Promise.all([
    admin.from("profiles").select("id,full_name,role,is_active").eq("is_active", true).order("full_name"),
    admin.from("building_members").select("building_id,user_id"),
    admin.from("buildings").select("id,code,name").order("code"),
  ]);
  const myBuildings = me.role === "quan_ly"
    ? (allBuildings ?? [])
    : (allBuildings ?? []).filter((b) => (members ?? []).some((m) => m.user_id === me.id && m.building_id === b.id));
  const myBIds = new Set(myBuildings.map((b) => b.id));
  const assignable = (allPeople ?? []).filter((p) => {
    if (p.id === me.id) return true;
    if (RANK[p.role] >= RANK[me.role]) return false;
    if (me.role === "quan_ly") return true;
    return (members ?? []).some((m) => m.user_id === p.id && myBIds.has(m.building_id));
  });
  const people = assignable.map((p, i) => ({ ref: `P${i + 1}`, id: p.id, name: p.full_name, role: p.role, me: p.id === me.id }));
  const buildings = myBuildings.map((b, i) => ({ ref: `B${i + 1}`, id: b.id, code: b.code, name: b.name }));

  const prompt = buildPrompt(people, buildings, isAudio);
  const parts = isAudio
    ? [{ inline_data: { mime_type: body.mime || "audio/wav", data: body.audio } }, { text: prompt }]
    : [{ text: prompt + "\n\nTIN NHẮN:\n" + body.text }];

  try {
    const { model, data } = await callGemini(key, parts);
    const pById = new Map(people.map((p) => [p.ref, p]));
    const bById = new Map(buildings.map((b) => [b.ref, b]));
    const tasks = (Array.isArray(data?.tasks) ? data.tasks : []).slice(0, 30).map((t: Record<string, unknown>) => {
      const p = pById.get(String(t.assignee_ref ?? "").trim());
      const b = bById.get(String(t.building_ref ?? "").trim());
      const due = String(t.due_date ?? "");
      return {
        title: String(t.title ?? "").slice(0, 200),
        description: String(t.description ?? ""),
        assignee_id: me.role === "nhan_vien" ? me.id : (p?.id ?? null),
        assignee_hint: String(t.assignee_hint ?? ""),
        building_id: b?.id ?? null,
        due_date: /^\d{4}-\d{2}-\d{2}$/.test(due) ? due : null,
        priority: PRIORITIES.includes(String(t.priority)) ? t.priority : "binh_thuong",
        steps: (Array.isArray(t.steps) ? t.steps : []).map(String).filter(Boolean).slice(0, 10),
      };
    }).filter((t: { title: string }) => t.title);
    return json({ transcript: isAudio ? String(data?.transcript ?? "") : "", tasks, model });
  } catch (e) {
    const msg = (e as Error).message;
    console.error("phan-tich-giao-viec", msg);
    if (/API key|API_KEY_INVALID|PERMISSION_DENIED/i.test(msg)) return json({ error: "Khoá Gemini không hợp lệ hoặc hết hạn.", code: "bad_key" }, 502);
    if (/quota|RESOURCE_EXHAUSTED|429/i.test(msg)) return json({ error: "Đã dùng hết hạn mức AI tạm thời. Thử lại sau ít phút." }, 429);
    return json({ error: "Không phân tích được: " + msg.slice(0, 300) }, 502);
  }
});
