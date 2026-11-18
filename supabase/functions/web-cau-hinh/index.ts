// Edge Function công khai (không cần đăng nhập) cho website phòng trống.
// Chỉ trả địa chỉ gốc công khai của kho ảnh R2 (địa chỉ này vốn hiện trong mọi thẻ <img>), không có khoá bí mật nào.
import "jsr:@supabase/functions-js/edge-runtime.d.ts";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
};

Deno.serve((req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  const base = (Deno.env.get("R2_PUBLIC_BASE_URL") ?? "").replace(/\/+$/, "");
  return new Response(JSON.stringify({ publicBase: base || null }), {
    headers: { ...cors, "Content-Type": "application/json", "Cache-Control": "public, max-age=3600" },
  });
});
