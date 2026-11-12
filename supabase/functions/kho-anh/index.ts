// Edge Function: kho ảnh trên Cloudflare R2.
// Trình duyệt tải lên / xem THẲNG với R2 bằng link tạm do hàm này ký; khoá R2 không bao giờ xuống trình duyệt.
// Quyền do Postgres quyết định (hàm storage_paths_ok); hàm này chỉ hỏi lại rồi ký.
// Hành động: config | put | get | delete
import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2.45.4";
import { encodeKey, presign } from "./sigv4.ts";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...cors, "Content-Type": "application/json" } });

const env = (k: string) => Deno.env.get(k) ?? "";
const R2 = {
  account: env("R2_ACCOUNT_ID"), key: env("R2_ACCESS_KEY_ID"), secret: env("R2_SECRET_ACCESS_KEY"),
  pub: env("R2_BUCKET_PUBLIC"), priv: env("R2_BUCKET_PRIVATE"), base: env("R2_PUBLIC_BASE_URL").replace(/\/+$/, ""),
};
const enabled = !!(R2.account && R2.key && R2.secret && R2.pub && R2.priv && R2.base);
const host = `${R2.account}.r2.cloudflarestorage.com`;

const TYPES: Record<string, string> = { jpg: "image/jpeg", png: "image/png", webp: "image/webp", pdf: "application/pdf" };
const UUID = "[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}";
// <thư mục>/<mã chủ>/<uuid>[_t].<đuôi>  — _t là ảnh nhỏ (chỉ .jpg)
const PATH_RE = new RegExp(`^(cccd|hop-dong|anh-phong|anh-toa|de-nghi|phan-anh|dong-ho)/${UUID}/${UUID}(_t)?\\.(jpg|png|webp|pdf)$`);
const isPublic = (p: string) => p.startsWith("anh-phong/") || p.startsWith("anh-toa/");
const bucketOf = (p: string) => (isPublic(p) ? R2.pub : R2.priv);
const sign = (method: "GET" | "PUT" | "DELETE", path: string, expires: number, signedHeaders?: Record<string, string>) =>
  presign({
    method, host, path: `/${bucketOf(path)}/${encodeKey(path)}`, accessKeyId: R2.key, secretAccessKey: R2.secret,
    expires, signedHeaders,
  });

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST") return json({ error: "Chỉ hỗ trợ POST" }, 405);

  const userClient = createClient(env("SUPABASE_URL"), env("SUPABASE_ANON_KEY"), {
    global: { headers: { Authorization: req.headers.get("Authorization") ?? "" } },
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { data: who } = await userClient.auth.getUser();
  if (!who?.user) return json({ error: "Phiên đăng nhập đã hết, vui lòng đăng nhập lại" }, 401);

  let body: Record<string, unknown>;
  try { body = await req.json(); } catch { return json({ error: "Dữ liệu gửi lên không hợp lệ" }, 400); }

  if (body.action === "config") return json({ enabled, publicBase: enabled ? R2.base : null });
  if (!enabled) return json({ error: "Kho ảnh R2 chưa được cấu hình" }, 503);

  // Hỏi Postgres: những đường dẫn nào người này được phép (ghi / đọc)
  const allowed = async (paths: string[], write: boolean): Promise<Set<string>> => {
    const { data, error } = await userClient.rpc("storage_paths_ok", { p_paths: paths, p_write: write });
    if (error) throw new Error(error.message);
    return new Set((data as string[]) ?? []);
  };

  try {
    switch (body.action) {
      case "put": {
        const items = Array.isArray(body.items) ? (body.items as { path?: unknown; contentType?: unknown }[]) : [];
        if (!items.length || items.length > 4) return json({ error: "Số tệp mỗi lần không hợp lệ" }, 400);
        const paths = items.map((i) => String(i.path ?? ""));
        for (let n = 0; n < items.length; n++) {
          const m = PATH_RE.exec(paths[n]);
          if (!m) return json({ error: "Đường dẫn tệp không hợp lệ" }, 400);
          const ct = String(items[n].contentType ?? "");
          if (TYPES[m[3]] !== ct) return json({ error: "Loại tệp không khớp đuôi tệp" }, 400);
          if (m[2] && m[3] !== "jpg") return json({ error: "Ảnh nhỏ phải là JPG" }, 400);
        }
        const ok = await allowed(paths, true);
        if (paths.some((p) => !ok.has(p))) return json({ error: "Bạn không có quyền tải tệp này lên" }, 403);
        const urls: Record<string, { url: string; headers: Record<string, string> }> = {};
        for (let n = 0; n < items.length; n++) {
          const ct = String(items[n].contentType);
          urls[paths[n]] = { url: await sign("PUT", paths[n], 300, { "content-type": ct }), headers: { "Content-Type": ct } };
        }
        return json({ urls });
      }

      case "get": {
        const paths = Array.isArray(body.paths) ? body.paths.map(String) : [];
        if (!paths.length || paths.length > 100 || paths.some((p) => !PATH_RE.test(p))) return json({ error: "Danh sách đường dẫn không hợp lệ" }, 400);
        const ok = await allowed(paths, false);
        const urls: Record<string, string> = {};
        for (const p of paths) {
          if (!ok.has(p)) continue;
          urls[p] = isPublic(p) ? `${R2.base}/${encodeKey(p)}` : await sign("GET", p, 600);
        }
        return json({ urls });
      }

      case "delete": {
        // Chỉ xoá tệp khi dòng trong bảng files đã bị xoá (do RLS cho phép) và người này có quyền ghi vào đường dẫn đó
        const paths = Array.isArray(body.paths) ? body.paths.map(String) : [];
        if (!paths.length || paths.length > 4 || paths.some((p) => !PATH_RE.test(p))) return json({ error: "Danh sách đường dẫn không hợp lệ" }, 400);
        const ok = await allowed(paths, true);
        if (paths.some((p) => !ok.has(p))) return json({ error: "Bạn không có quyền xoá tệp này" }, 403);
        const admin = createClient(env("SUPABASE_URL"), env("SUPABASE_SERVICE_ROLE_KEY"), { auth: { persistSession: false, autoRefreshToken: false } });
        let deleted = 0;
        for (const p of paths) {
          const stem = p.replace(/(_t)?\.[a-z]+$/, "");
          const { data: still } = await admin.from("files").select("id").like("path", `${stem}.%`).limit(1);
          if (still && still.length) return json({ error: "Tệp vẫn còn trong danh sách, xoá dòng dữ liệu trước" }, 409);
          const res = await fetch(await sign("DELETE", p, 60), { method: "DELETE" });
          if (res.ok || res.status === 404) deleted++;
        }
        return json({ deleted });
      }

      default:
        return json({ error: "Hành động không hợp lệ" }, 400);
    }
  } catch (e) {
    return json({ error: e instanceof Error ? e.message : "Lỗi không xác định" }, 500);
  }
});
