// Edge Function: quản lý tài khoản nhân sự (chỉ Quản lý được gọi)
// Hành động: create | reset_password | set_active | change_phone
import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2.45.4";

const EMAIL_DOMAIN = "neonestly.app";
const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...cors, "Content-Type": "application/json" } });

const normPhone = (p: string) => {
  let s = String(p ?? "").replace(/[^\d+]/g, "");
  if (s.startsWith("+84")) s = "0" + s.slice(3);
  else if (s.startsWith("84") && s.length === 11) s = "0" + s.slice(2);
  return s;
};
const ROLES = ["quan_ly", "giam_sat", "nhan_vien", "cong_tac_vien"];

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST") return json({ error: "Chỉ hỗ trợ POST" }, 405);

  const admin = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const token = (req.headers.get("Authorization") ?? "").replace(/^Bearer\s+/i, "");
  const { data: who } = await admin.auth.getUser(token);
  if (!who?.user) return json({ error: "Phiên đăng nhập đã hết, vui lòng đăng nhập lại" }, 401);
  const { data: me } = await admin.from("profiles").select("role,is_active").eq("id", who.user.id).single();
  if (!me || me.role !== "quan_ly" || !me.is_active) return json({ error: "Chỉ quản lý được quản lý tài khoản" }, 403);

  let body: Record<string, unknown>;
  try { body = await req.json(); } catch { return json({ error: "Dữ liệu gửi lên không hợp lệ" }, 400); }

  try {
    switch (body.action) {
      case "create": {
        const phone = normPhone(String(body.phone));
        const full_name = String(body.full_name ?? "").trim();
        const role = String(body.role ?? "nhan_vien");
        const password = String(body.password ?? "");
        // Cộng tác viên không gán toà: họ chỉ xem bản đồ và phòng trống chung
        const buildings = role !== "cong_tac_vien" && Array.isArray(body.building_ids) ? body.building_ids.map(String) : [];
        if (!/^0\d{9}$/.test(phone)) return json({ error: "Số điện thoại phải có 10 số, bắt đầu bằng 0" }, 400);
        if (!full_name) return json({ error: "Thiếu họ tên" }, 400);
        if (!ROLES.includes(role)) return json({ error: "Vai trò không hợp lệ" }, 400);
        if (password.length < 6) return json({ error: "Mật khẩu tạm cần ít nhất 6 ký tự" }, 400);

        const { data: exists } = await admin.from("profiles").select("id").eq("phone", phone).maybeSingle();
        if (exists) return json({ error: "Số điện thoại này đã có tài khoản" }, 409);

        const { data, error } = await admin.auth.admin.createUser({
          email: `${phone}@${EMAIL_DOMAIN}`,
          password,
          email_confirm: true,
          user_metadata: { full_name, phone, must_change_password: true },
          app_metadata: { role, provisioned: true },
        });
        if (error) throw error;
        // Ghi rõ vai trò + kích hoạt (không phụ thuộc thứ tự trigger của Supabase Auth)
        const { error: e1 } = await admin.from("profiles")
          .upsert({ id: data.user.id, full_name, phone, role, is_active: true });
        if (e1) throw e1;
        if (buildings.length) {
          const { error: e2 } = await admin.from("building_members")
            .insert(buildings.map((b) => ({ building_id: b, user_id: data.user.id })));
          if (e2) throw e2;
        }
        return json({ id: data.user.id });
      }

      case "reset_password": {
        const id = String(body.user_id);
        const password = String(body.password ?? "");
        if (password.length < 6) return json({ error: "Mật khẩu tạm cần ít nhất 6 ký tự" }, 400);
        const { data: u, error: e0 } = await admin.auth.admin.getUserById(id);
        if (e0) throw e0;
        const { error } = await admin.auth.admin.updateUserById(id, {
          password,
          user_metadata: { ...(u.user.user_metadata ?? {}), must_change_password: true },
        });
        if (error) throw error;
        return json({ ok: true });
      }

      case "set_active": {
        const id = String(body.user_id);
        const active = Boolean(body.active);
        if (id === who.user.id && !active) return json({ error: "Không thể tự khoá tài khoản của mình" }, 400);
        const { error } = await admin.auth.admin.updateUserById(id, { ban_duration: active ? "none" : "876000h" });
        if (error) throw error;
        const { error: e2 } = await admin.from("profiles").update({ is_active: active }).eq("id", id);
        if (e2) throw e2;
        return json({ ok: true });
      }

      case "change_phone": {
        const id = String(body.user_id);
        const phone = normPhone(String(body.phone));
        if (!/^0\d{9}$/.test(phone)) return json({ error: "Số điện thoại phải có 10 số, bắt đầu bằng 0" }, 400);
        const { data: exists } = await admin.from("profiles").select("id").eq("phone", phone).neq("id", id).maybeSingle();
        if (exists) return json({ error: "Số điện thoại này đã có tài khoản" }, 409);
        const { data: u, error: e0 } = await admin.auth.admin.getUserById(id);
        if (e0) throw e0;
        const { error } = await admin.auth.admin.updateUserById(id, {
          email: `${phone}@${EMAIL_DOMAIN}`,
          email_confirm: true,
          user_metadata: { ...(u.user.user_metadata ?? {}), phone },
        });
        if (error) throw error;
        const { error: e2 } = await admin.from("profiles").update({ phone }).eq("id", id);
        if (e2) throw e2;
        return json({ ok: true });
      }

      default:
        return json({ error: "Hành động không hợp lệ" }, 400);
    }
  } catch (e) {
    const msg = (e as { message?: string })?.message ?? String(e);
    console.error("quan-ly-tai-khoan", body.action, msg);
    return json({ error: "Không thực hiện được: " + msg }, 500);
  }
});
