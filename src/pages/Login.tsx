import { useState, type FormEvent } from "react";
import { normPhone, phoneToEmail, supabase } from "../lib/supabase";

export default function Login() {
  const [phone, setPhone] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setErr(null);
    const p = normPhone(phone);
    if (!/^0\d{9}$/.test(p)) { setErr("Số điện thoại phải có 10 số, bắt đầu bằng 0."); return; }
    setBusy(true);
    const { error } = await supabase.auth.signInWithPassword({ email: phoneToEmail(p), password });
    setBusy(false);
    if (error) {
      if (/invalid login/i.test(error.message)) setErr("Sai số điện thoại hoặc mật khẩu.");
      else if (/banned/i.test(error.message)) setErr("Tài khoản đã bị khoá. Liên hệ quản lý.");
      else setErr("Không đăng nhập được: " + error.message);
    }
  }

  return (
    <div className="auth-wrap">
      <form className="auth-card" onSubmit={submit}>
        <div className="brand-logo">
          <img src="/logo-neo-nestly.svg" alt="Neo Nestly · Serviced Apartment & Residence" />
          <div className="bs">Giao việc & quản lý nhà cho thuê</div>
        </div>
        <label className="field">
          <span>Số điện thoại</span>
          <input id="login-phone" className="input" inputMode="tel" autoComplete="username" placeholder="0909 123 456"
            value={phone} onChange={(e) => setPhone(e.target.value)} required />
        </label>
        <label className="field">
          <span>Mật khẩu</span>
          <input id="login-password" className="input" type="password" autoComplete="current-password"
            value={password} onChange={(e) => setPassword(e.target.value)} required />
        </label>
        {err ? <div className="error-box" role="alert">{err}</div> : null}
        <button className="btn block" disabled={busy}>{busy ? "Đang đăng nhập…" : "Đăng nhập"}</button>
        <p className="muted small" style={{ margin: 0 }}>Chưa có tài khoản hoặc quên mật khẩu? Liên hệ quản lý để được cấp.</p>
      </form>
    </div>
  );
}
