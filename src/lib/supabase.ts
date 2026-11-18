import { createClient } from "@supabase/supabase-js";

// Khoá công khai (publishable) — an toàn khi để trong code trình duyệt; dữ liệu được bảo vệ bằng RLS.
const URL = import.meta.env.VITE_SUPABASE_URL ?? "https://nbxnupvceeyqqwrabjfc.supabase.co";
const KEY = import.meta.env.VITE_SUPABASE_KEY ?? "sb_publishable_hETTG4G-xty-xj1rm2B3NQ_fILjnDux";

// Khung xem trước website trong trang Cài đặt website (/phong?xem=thu trong iframe): không dùng chung phiên đăng nhập,
// để iframe không ghi vào kho đăng nhập của tab chính (gây tab chính tải lại liên tục).
const isPreviewFrame = typeof window !== "undefined" && window.parent !== window
  && window.location.pathname.startsWith("/phong") && new URLSearchParams(window.location.search).get("xem") === "thu";

export const supabase = createClient(URL, KEY, {
  auth: isPreviewFrame
    ? { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false, storageKey: "neo-nestly-preview" }
    : { persistSession: true, autoRefreshToken: true, storageKey: "neo-nestly-auth" },
});

export const EMAIL_DOMAIN = "neonestly.app";

export function normPhone(p: string) {
  let s = (p ?? "").replace(/[^\d+]/g, "");
  if (s.startsWith("+84")) s = "0" + s.slice(3);
  else if (s.startsWith("84") && s.length === 11) s = "0" + s.slice(2);
  return s;
}
export const phoneToEmail = (p: string) => `${normPhone(p)}@${EMAIL_DOMAIN}`;

/** Gọi Edge Function quản lý tài khoản; trả lỗi tiếng Việt từ server nếu có. */
export async function callAccountFn<T = unknown>(body: Record<string, unknown>): Promise<T> {
  const { data, error } = await supabase.functions.invoke("quan-ly-tai-khoan", { body });
  if (error) {
    let msg = "Không kết nối được máy chủ. Thử lại sau ít phút.";
    try {
      const ctx = (error as { context?: Response }).context;
      if (ctx && typeof ctx.json === "function") {
        const j = await ctx.json();
        if (j?.error) msg = j.error;
      }
    } catch { /* giữ thông báo mặc định */ }
    throw new Error(msg);
  }
  return data as T;
}

/** Chuyển lỗi Supabase/Postgres thành câu tiếng Việt dễ hiểu. */
export function friendlyError(e: unknown): string {
  const m = (e as { message?: string })?.message ?? String(e);
  if (/row-level security/i.test(m)) return "Bạn không có quyền thực hiện thao tác này.";
  if (/duplicate key/i.test(m)) return "Dữ liệu bị trùng (mã hoặc số điện thoại đã tồn tại).";
  if (/Failed to fetch|NetworkError/i.test(m)) return "Mất kết nối mạng. Kiểm tra mạng rồi thử lại.";
  return m;
}
