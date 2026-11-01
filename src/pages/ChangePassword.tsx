import { useState, type FormEvent } from "react";
import { useNavigate } from "react-router-dom";
import { supabase } from "../lib/supabase";
import { useSession } from "../lib/session";

export default function ChangePassword({ forced = false }: { forced?: boolean }) {
  const { toast } = useSession();
  const nav = useNavigate();
  const [pw, setPw] = useState("");
  const [pw2, setPw2] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setErr(null);
    if (pw.length < 6) { setErr("Mật khẩu cần ít nhất 6 ký tự."); return; }
    if (pw !== pw2) { setErr("Hai lần nhập mật khẩu chưa khớp."); return; }
    setBusy(true);
    const { error } = await supabase.auth.updateUser({ password: pw, data: { must_change_password: false } });
    setBusy(false);
    if (error) {
      setErr(/different from the old/i.test(error.message) ? "Mật khẩu mới phải khác mật khẩu tạm." : error.message);
      return;
    }
    toast("Đã đổi mật khẩu.");
    nav("/", { replace: true });
  }

  const form = (
    <form className={forced ? "auth-card" : "card stack"} style={forced ? undefined : { padding: 16 }} onSubmit={submit}>
      {forced ? (
        <div>
          <h2 style={{ fontSize: 20 }}>Đặt mật khẩu mới</h2>
          <p className="muted small" style={{ margin: "6px 0 0" }}>
            Bạn đang dùng mật khẩu tạm do quản lý cấp. Đặt mật khẩu riêng để tiếp tục.
          </p>
        </div>
      ) : null}
      <label className="field">
        <span>Mật khẩu mới</span>
        <input id="new-pw" className="input" type="password" autoComplete="new-password" value={pw} onChange={(e) => setPw(e.target.value)} required />
      </label>
      <label className="field">
        <span>Nhập lại mật khẩu mới</span>
        <input id="new-pw2" className="input" type="password" autoComplete="new-password" value={pw2} onChange={(e) => setPw2(e.target.value)} required />
      </label>
      {err ? <div className="error-box" role="alert">{err}</div> : null}
      <button className="btn block" disabled={busy}>{busy ? "Đang lưu…" : "Lưu mật khẩu"}</button>
      {forced ? (
        <button type="button" className="btn ghost" onClick={() => supabase.auth.signOut()}>Đăng xuất</button>
      ) : null}
    </form>
  );
  return forced ? <div className="auth-wrap">{form}</div> : form;
}
