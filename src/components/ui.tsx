import { useEffect, type ReactNode } from "react";
import { NavLink, useNavigate } from "react-router-dom";
import { useSession } from "../lib/session";

export const Icon = {
  tasks: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M9 6h11M9 12h11M9 18h11" /><path d="m3.5 6 1.5 1.5L7.5 5M3.5 12l1.5 1.5L7.5 11M3.5 18l1.5 1.5L7.5 17" />
    </svg>
  ),
  bell: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M6 8a6 6 0 1 1 12 0c0 7 3 9 3 9H3s3-2 3-9" /><path d="M10.3 21a1.94 1.94 0 0 0 3.4 0" />
    </svg>
  ),
  admin: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M3 21V9l9-6 9 6v12" /><path d="M9 21v-6h6v6" />
    </svg>
  ),
  office: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <rect x="3" y="7" width="18" height="13" rx="2" /><path d="M8 7V5a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2M3 13h18M11 13v2h2v-2" />
    </svg>
  ),
  user: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <circle cx="12" cy="8" r="4" /><path d="M4 21c1.5-4 4.5-6 8-6s6.5 2 8 6" />
    </svg>
  ),
  back: (
    <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="m15 18-6-6 6-6" />
    </svg>
  ),
  plus: (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" aria-hidden="true">
      <path d="M12 5v14M5 12h14" />
    </svg>
  ),
};

export function TopBar({ title, back, action }: { title: string; back?: boolean | string; action?: ReactNode }) {
  const nav = useNavigate();
  return (
    <header className="topbar">
      {back ? (
        <button className="back" aria-label="Quay lại"
          onClick={() => (typeof back === "string" ? nav(back) : window.history.length > 1 ? nav(-1) : nav("/"))}>
          {Icon.back}
        </button>
      ) : null}
      <h1>{title}</h1>
      {action}
    </header>
  );
}

export function BottomNav() {
  const { unread, isManager, pendingApprovals } = useSession();
  return (
    <nav className="bottomnav" aria-label="Điều hướng chính">
      <div className="inner">
        <NavLink to="/" end>{Icon.tasks}<span>Công việc</span></NavLink>
        <NavLink to="/van-phong">
          {Icon.office}<span>Văn phòng</span>
          {isManager && pendingApprovals > 0 ? <span className="badge num">{pendingApprovals > 99 ? "99+" : pendingApprovals}</span> : null}
        </NavLink>
        <NavLink to="/thong-bao">
          {Icon.bell}<span>Thông báo</span>
          {unread > 0 ? <span className="badge num">{unread > 99 ? "99+" : unread}</span> : null}
        </NavLink>
        {isManager ? <NavLink to="/quan-tri">{Icon.admin}<span>Quản trị</span></NavLink> : null}
        <NavLink to="/tai-khoan">{Icon.user}<span>Tài khoản</span></NavLink>
      </div>
    </nav>
  );
}

export function Toast() {
  const { toastMsg } = useSession();
  return toastMsg ? <div className="toast" role="status">{toastMsg}</div> : null;
}

export function Sheet({ open, onClose, title, children }: { open: boolean; onClose: () => void; title: string; children: ReactNode }) {
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    document.addEventListener("keydown", onKey);
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => { document.removeEventListener("keydown", onKey); document.body.style.overflow = prev; };
  }, [open, onClose]);
  if (!open) return null;
  return (
    <div className="sheet-backdrop" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="sheet" role="dialog" aria-modal="true" aria-label={title}>
        <div className="grip" />
        <h3>{title}</h3>
        {children}
      </div>
    </div>
  );
}

export function Avatar({ name }: { name: string }) {
  const parts = name.trim().split(/\s+/);
  const init = ((parts[parts.length - 2]?.[0] ?? "") + (parts[parts.length - 1]?.[0] ?? "")).toUpperCase() || "?";
  return <span className="avatar" aria-hidden="true">{init}</span>;
}

export function Empty({ title, children }: { title: string; children?: ReactNode }) {
  return <div className="empty"><b>{title}</b>{children}</div>;
}

export async function copyText(text: string): Promise<boolean> {
  try { await navigator.clipboard.writeText(text); return true; } catch { return false; }
}

/** Mật khẩu tạm dễ đọc qua điện thoại: Neo + 4 số + 3 chữ */
export function tempPassword() {
  const letters = "abcdefghjkmnpqrstuvwxyz";
  const r = (n: number) => crypto.getRandomValues(new Uint32Array(1))[0] % n;
  let s = "Neo";
  for (let i = 0; i < 4; i++) s += String(2 + r(8));
  for (let i = 0; i < 3; i++) s += letters[r(letters.length)];
  return s;
}
