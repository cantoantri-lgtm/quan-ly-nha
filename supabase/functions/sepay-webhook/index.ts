// Nhận thông báo "tiền vào tài khoản" từ SePay (https://sepay.vn) và tự đánh dấu hoá đơn đã thu.
// SePay gọi POST kèm header  Authorization: Apikey <SEPAY_WEBHOOK_KEY>.
// Việc ghi sổ nằm trong hàm SQL apply_bank_transfer (chỉ service role gọi được).
import { createClient } from "npm:@supabase/supabase-js@2";

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

Deno.serve(async (req) => {
  if (req.method !== "POST") return json({ success: false, error: "method" }, 405);

  const key = Deno.env.get("SEPAY_WEBHOOK_KEY");
  const auth = req.headers.get("authorization") ?? "";
  if (!key || auth !== `Apikey ${key}`) return json({ success: false, error: "unauthorized" }, 401);

  let p: Record<string, unknown>;
  try { p = await req.json(); } catch { return json({ success: false, error: "bad json" }, 400); }

  // Chỉ xử lý tiền vào
  if (p.transferType !== "in") return json({ success: true, ignored: "not incoming" });
  const amount = Number(p.transferAmount);
  const txnId = String(p.id ?? p.referenceCode ?? "");
  if (!txnId || !Number.isFinite(amount) || amount <= 0) return json({ success: false, error: "bad payload" }, 400);

  const db = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, { auth: { persistSession: false } });

  // Chỉ nhận giao dịch vào đúng tài khoản công ty đã cài trong app
  const { data: s } = await db.from("payment_settings").select("account_no").eq("id", 1).maybeSingle();
  const acct = String(p.accountNumber ?? "");
  if (s && acct && s.account_no.replace(/\s/g, "") !== acct.replace(/\s/g, "")) return json({ success: true, ignored: "other account" });

  const { data, error } = await db.rpc("apply_bank_transfer", {
    p_provider: "sepay", p_provider_id: txnId, p_account: acct || null, p_amount: amount,
    p_content: String(p.content ?? p.description ?? ""), p_time: p.transactionDate ? new Date(String(p.transactionDate).replace(" ", "T") + "+07:00").toISOString() : null,
    p_raw: p,
  });
  if (error) { console.error("apply_bank_transfer", error.message); return json({ success: false, error: "db" }, 500); }
  return json({ success: true, result: data });
});
