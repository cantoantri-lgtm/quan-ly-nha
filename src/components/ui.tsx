import { useEffect, useState, type ReactNode } from "react";
import { Link, NavLink, useLocation, useNavigate } from "react-router-dom";
import { useSession } from "../lib/session";
import "../nav.css";

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
  map: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M12 21s-7-6.2-7-11.5a7 7 0 0 1 14 0C19 14.8 12 21 12 21Z" /><circle cx="12" cy="9.5" r="2.5" />
    </svg>
  ),
  user: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <circle cx="12" cy="8" r="4" /><path d="M4 21c1.5-4 4.5-6 8-6s6.5 2 8 6" />
    </svg>
  ),
  grid: (
    <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
      <circle cx="5" cy="5" r="2" /><circle cx="12" cy="5" r="2" /><circle cx="19" cy="5" r="2" />
      <circle cx="5" cy="12" r="2" /><circle cx="12" cy="12" r="2" /><circle cx="19" cy="12" r="2" />
      <circle cx="5" cy="19" r="2" /><circle cx="12" cy="19" r="2" /><circle cx="19" cy="19" r="2" />
    </svg>
  ),
  home: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="m3 11 9-8 9 8" /><path d="M5 10v10h14V10" /><path d="M10 20v-6h4v6" />
    </svg>
  ),
  moon: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M21 13.2A8.5 8.5 0 1 1 10.8 3a6.8 6.8 0 0 0 10.2 10.2Z" />
    </svg>
  ),
  sun: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <circle cx="12" cy="12" r="4" /><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4" />
    </svg>
  ),
  eye: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M2 12s3.6-7 10-7 10 7 10 7-3.6 7-10 7S2 12 2 12Z" /><circle cx="12" cy="12" r="3" />
    </svg>
  ),
  check: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="m4 12.5 5 5L20 6.5" /></svg>
  ),
  x: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" aria-hidden="true"><path d="m6 6 12 12M18 6 6 18" /></svg>
  ),
  undo: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M9 14 4 9l5-5" /><path d="M4 9h10a6 6 0 0 1 0 12h-3" />
    </svg>
  ),
  edit: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M4 20h4L19 9a2.8 2.8 0 0 0-4-4L4 16v4Z" /><path d="m13.5 6.5 4 4" />
    </svg>
  ),
  trash: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M4 7h16M10 11v6M14 11v6M6 7l1 13h10l1-13M9 7V4h6v3" />
    </svg>
  ),
  print: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M7 9V3h10v6M7 17H4v-7h16v7h-3" /><rect x="7" y="14" width="10" height="7" rx="1" />
    </svg>
  ),
  download: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M12 3v12M7 10l5 5 5-5M4 20h16" />
    </svg>
  ),
  help: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <circle cx="12" cy="12" r="9" /><path d="M9.5 9.5a2.5 2.5 0 1 1 3.6 2.2c-.7.4-1.1 1-1.1 1.8M12 17h.01" />
    </svg>
  ),
  chart: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M12 3v9h9a9 9 0 1 1-9-9Z" /><path d="M15 3.5A9 9 0 0 1 20.5 9H15V3.5Z" />
    </svg>
  ),
  org: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <rect x="9" y="3" width="6" height="5" rx="1" /><rect x="3" y="16" width="6" height="5" rx="1" /><rect x="15" y="16" width="6" height="5" rx="1" /><path d="M12 8v4M6 16v-4h12v4" />
    </svg>
  ),
  money: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <rect x="2" y="6" width="20" height="12" rx="2" /><circle cx="12" cy="12" r="2.5" /><path d="M6 12h.01M18 12h.01" />
    </svg>
  ),
  gear: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <circle cx="12" cy="12" r="3" /><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1Z" />
    </svg>
  ),
  building: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <rect x="5" y="3" width="14" height="18" rx="1" /><path d="M9 7h2M13 7h2M9 11h2M13 11h2M9 15h2M13 15h2M10 21v-3h4v3" />
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


const initials = (name: string) => {
  const p = name.trim().split(/\s+/);
  return ((p[p.length - 2]?.[0] ?? "") + (p[p.length - 1]?.[0] ?? "")).toUpperCase() || "?";
};

/** Chế độ sáng / tối: nhớ lựa chọn của người dùng, chưa chọn thì theo thiết bị */
export function applyTheme(t: "light" | "dark" | null) {
  if (t) document.documentElement.dataset.theme = t; else delete document.documentElement.dataset.theme;
}
export function savedTheme(): "light" | "dark" | null {
  try { const v = localStorage.getItem("neo-theme"); return v === "light" || v === "dark" ? v : null; } catch { return null; }
}
const isDark = () => (document.documentElement.dataset.theme ?? (matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light")) === "dark";

/** Thanh trên toàn app: logo (bấm về trang chủ), tên công ty, nút Apps, thông báo, chế độ tối, tài khoản */
export function AppHeader() {
  const { profile, unread, pendingApprovals, isManager, isApprover, isCollaborator } = useSession();
  const [open, setOpen] = useState(false);
  const [dark, setDark] = useState(isDark());
  const loc = useLocation();
  useEffect(() => setOpen(false), [loc.pathname]);
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open]);

  const apps: { to: string; label: string; icon: JSX.Element; n?: number }[] = isCollaborator ? [
    { to: "/ban-do", label: "Bản đồ toà nhà", icon: Icon.map },
    { to: "/phong-trong", label: "Phòng trống", icon: Icon.building },
    { to: "/tai-khoan", label: "Tài khoản", icon: Icon.user },
  ] : [
    { to: "/viec", label: "Công việc", icon: Icon.tasks },
    { to: "/van-phong", label: "Văn phòng số", icon: Icon.office, n: pendingApprovals },
    { to: "/ban-do", label: "Bản đồ toà nhà", icon: Icon.map },
    { to: "/phong-trong", label: "Phòng trống", icon: Icon.building },
    ...(isManager ? [
      { to: "/quan-tri/toa-nha", label: "Toà nhà & phòng", icon: Icon.building },
      { to: "/quan-tri/nhan-su", label: "Nhân sự", icon: Icon.user },
    ] : []),
    ...(isManager || isApprover ? [{ to: "/to-chuc", label: "Sơ đồ công ty", icon: Icon.org }] : []),
    ...(isManager ? [
      { to: "/quan-tri/thu-tien", label: "Thu tiền", icon: Icon.money },
      { to: "/quan-tri", label: "Hệ thống", icon: Icon.gear },
    ] : []),
    { to: "/thong-bao", label: "Thông báo", icon: Icon.bell, n: unread },
    { to: "/tai-khoan", label: "Tài khoản", icon: Icon.user },
  ];

  function toggleTheme() {
    const next = dark ? "light" : "dark";
    applyTheme(next); setDark(!dark);
    try { localStorage.setItem("neo-theme", next); } catch { /* bỏ qua */ }
  }

  return (
    <header className="apphead">
      <Link to={isCollaborator ? "/ban-do" : "/"} className="ah-logo" aria-label="Về trang chủ Neo Nestly"><img src="/logo-neo-nestly.svg" alt="Neo Nestly" /></Link>
      <div className="ah-co"><b>NEO NESTLY</b><small>Serviced Apartment &amp; Residence</small></div>
      <div className="ah-tools">
        <button type="button" className="ah-btn apps" aria-expanded={open} aria-haspopup="true" aria-label="Chức năng" onClick={() => setOpen((o) => !o)}>
          {Icon.grid}<span className="ah-tip">Apps</span>
        </button>
        {isCollaborator ? null : <Link to="/" className="ah-btn" aria-label="Trang chủ">{Icon.home}<span className="ah-tip">Trang chủ</span></Link>}
        {isCollaborator ? null : <Link to="/thong-bao" className="ah-btn" aria-label="Thông báo">
          {Icon.bell}{unread > 0 ? <span className="ah-badge num">{unread > 99 ? "99+" : unread}</span> : null}<span className="ah-tip">Thông báo</span>
        </Link>}
        <button type="button" className="ah-btn" aria-label={dark ? "Chế độ sáng" : "Chế độ tối"} onClick={toggleTheme}>
          {dark ? Icon.sun : Icon.moon}<span className="ah-tip">{dark ? "Chế độ sáng" : "Chế độ tối"}</span>
        </button>
        {profile ? <Link to="/tai-khoan" className="ah-me" aria-label="Tài khoản" title={profile.full_name}>{initials(profile.full_name)}</Link> : null}
      </div>
      {open ? (
        <>
          <div className="apps-back" onClick={() => setOpen(false)} />
          <nav className="apps-pop" aria-label="Chức năng">
            {apps.map((a) => (
              <NavLink key={a.to} to={a.to} end={a.to === "/quan-tri"} className={({ isActive }) => (isActive ? "active" : "")}>
                <span className="ai">{a.icon}</span>{a.label}
                {a.n ? <span className="n num">{a.n > 99 ? "99+" : a.n}</span> : null}
              </NavLink>
            ))}
          </nav>
        </>
      ) : null}
    </header>
  );
}

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
  const { unread, isManager, pendingApprovals, isCollaborator } = useSession();
  if (isCollaborator) {
    return (
      <nav className="bottomnav" aria-label="Điều hướng chính">
        <div className="inner">
          <NavLink to="/ban-do">{Icon.map}<span>Bản đồ</span></NavLink>
          <NavLink to="/phong-trong">{Icon.building}<span>Phòng trống</span></NavLink>
          <NavLink to="/tai-khoan">{Icon.user}<span>Tài khoản</span></NavLink>
        </div>
      </nav>
    );
  }
  return (
    <nav className="bottomnav" aria-label="Điều hướng chính">
      <div className="inner">
        <NavLink to="/" end>{Icon.home}<span>Trang chủ</span></NavLink>
        <NavLink to="/viec">{Icon.tasks}<span>Công việc</span></NavLink>
        <NavLink to="/van-phong">
          {Icon.office}<span>Văn phòng</span>
          {pendingApprovals > 0 ? <span className="badge num">{pendingApprovals > 99 ? "99+" : pendingApprovals}</span> : null}
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
