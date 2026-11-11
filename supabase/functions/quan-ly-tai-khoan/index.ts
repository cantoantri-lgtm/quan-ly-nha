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
const ROLES = ["quan_ly", "giam_sat", "nhan_vien", "cong_tac_vien"]; // khach_hang chỉ tạo qua create_customer
const normCccd = (c: string) => String(c ?? "").replace(/\D/g, "");

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
  if (!me || !me.is_active) return json({ error: "Tài khoản không hoạt động" }, 403);

  let body: Record<string, unknown>;
  try { body = await req.json(); } catch { return json({ error: "Dữ liệu gửi lên không hợp lệ" }, 400); }

  // Tài khoản khách hàng: Quản lý, Giám sát và Sale (nhân viên) được tạo; các hành động khác chỉ Quản lý
  const STAFF = ["quan_ly", "giam_sat", "nhan_vien"];
  if (body.action === "create_customer" || body.action === "reset_customer_password") {
    if (!STAFF.includes(me.role)) return json({ error: "Không có quyền tạo tài khoản khách hàng" }, 403);
  } else if (me.role !== "quan_ly") return json({ error: "Chỉ quản lý được quản lý tài khoản" }, 403);

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
          user_metadata: { full_name, phone, must_change_password: role !== "cong_tac_vien" },
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

      case "create_customer": {
        const phone = normPhone(String(body.phone));
        const full_name = String(body.full_name ?? "").trim();
        const cccd = normCccd(String(body.cccd));
        const password = String(body.password ?? "");
        if (!/^0\d{9}$/.test(phone)) return json({ error: "Số điện thoại phải có 10 số, bắt đầu bằng 0" }, 400);
        if (!full_name) return json({ error: "Thiếu họ tên khách" }, 400);
        if (!/^\d{12}$/.test(cccd)) return json({ error: "CCCD phải đủ 12 số" }, 400);
        if (password.length < 6) return json({ error: "Mật khẩu tạm cần ít nhất 6 ký tự" }, 400);

        const { data: dupC } = await admin.from("customer_profiles").select("id").eq("cccd", cccd).maybeSingle();
        if (dupC) return json({ error: "CCCD này đã đăng ký tài khoản khách hàng. Mỗi CCCD chỉ đăng ký một lần" }, 409);
        const { data: dupP } = await admin.from("profiles").select("id").eq("phone", phone).maybeSingle();
        if (dupP) return json({ error: "Số điện thoại này đã có tài khoản" }, 409);

        const { data, error } = await admin.auth.admin.createUser({
          email: `${phone}@${EMAIL_DOMAIN}`, password, email_confirm: true,
          user_metadata: { full_name, phone, must_change_password: true },
          app_metadata: { role: "khach_hang", provisioned: true },
        });
        if (error) throw error;
        const { error: e1 } = await admin.from("profiles")
          .upsert({ id: data.user.id, full_name, phone, role: "khach_hang", is_active: true });
        const { error: e2 } = e1 ? { error: e1 } : await admin.from("customer_profiles")
          .insert({ id: data.user.id, cccd, created_by: who.user.id });
        if (e2) {
          await admin.auth.admin.deleteUser(data.user.id); // hoàn tác, không để lại tài khoản dở dang
          if ((e2 as { code?: string }).code === "23505") return json({ error: "CCCD này đã đăng ký tài khoản khách hàng. Mỗi CCCD chỉ đăng ký một lần" }, 409);
          throw e2;
        }
        return json({ id: data.user.id });
      }

      case "reset_customer_password": {
        const id = String(body.user_id);
        const password = String(body.password ?? "");
        if (password.length < 6) return json({ error: "Mật khẩu tạm cần ít nhất 6 ký tự" }, 400);
        const { data: c } = await admin.from("customer_profiles").select("created_by").eq("id", id).maybeSingle();
        if (!c) return json({ error: "Không phải tài khoản khách hàng" }, 400);
        if (me.role === "nhan_vien" && c.created_by !== who.user.id) return json({ error: "Chỉ người tạo tài khoản hoặc quản lý được cấp lại mật khẩu" }, 403);
        const { data: u, error: e0 } = await admin.auth.admin.getUserById(id);
        if (e0) throw e0;
        const { error } = await admin.auth.admin.updateUserById(id, {
          password, user_metadata: { ...(u.user.user_metadata ?? {}), must_change_password: true },
        });
        if (error) throw error;
        return json({ ok: true });
      }

      case "reset_password": {
        const id = String(body.user_id);
        const password = String(body.password ?? "");
        if (password.length < 6) return json({ error: "Mật khẩu tạm cần ít nhất 6 ký tự" }, 400);
        const { data: u, error: e0 } = await admin.auth.admin.getUserById(id);
        if (e0) throw e0;
        // Cộng tác viên không tự đổi mật khẩu (trigger ctv_pw_guard): quản lý đặt lại thì mở khoá 60 giây
        const { data: target } = await admin.from("profiles").select("role").eq("id", id).maybeSingle();
        const isCtv = target?.role === "cong_tac_vien";
        if (isCtv) {
          const { error: eu } = await admin.from("profiles")
            .update({ pw_unlock_until: new Date(Date.now() + 60_000).toISOString() }).eq("id", id);
          if (eu) throw eu;
        }
        const { error } = await admin.auth.admin.updateUserById(id, {
          password,
          user_metadata: { ...(u.user.user_metadata ?? {}), must_change_password: !isCtv },
        });
        if (isCtv) await admin.from("profiles").update({ pw_unlock_until: null }).eq("id", id);
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
