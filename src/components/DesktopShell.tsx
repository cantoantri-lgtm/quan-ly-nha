import { useEffect, useMemo, useRef, useState } from "react";
import { Link, useLocation, useNavigate, useNavigationType } from "react-router-dom";
import { TABS_EVENT } from "./KeepAlive";
import { useSession } from "../lib/session";
import { ddmmyyyy, todayVN } from "../lib/dates";
import { KINDS } from "../lib/office";
import { ROLE_LABEL, type Role } from "../lib/labels";
import { Icon, useMenuGroups } from "./ui";

/* Giao diện PC kiểu cửa sổ ERP: thanh tab các màn hình đang mở + thanh trạng thái.
   Chỉ hiện từ 900px trở lên (CSS ẩn trên điện thoại). */

type OpenTab = { key: string; to: string; title: string };
const TAB_STORE = "nl_tabs";
const MAX_TABS = 10;

function loadTabs(): OpenTab[] {
  try {
    const v = JSON.parse(sessionStorage.getItem(TAB_STORE) ?? "[]");
    return Array.isArray(v) ? v.filter((t) => t && typeof t.key === "string" && typeof t.to === "string" && typeof t.title === "string") : [];
  } catch { return []; }
}

/** Tên tab theo đường dẫn. dom = true: lấy tên thật trên trang (tên toà, tên khách…) khi trang vẽ xong. */
const PATTERNS: [RegExp, string, boolean][] = [
  [/^\/van-phong\/moi\//, "Lập đề nghị", false],
  [/^\/van-phong\/loa\/moi$/, "Lập tờ trình", false],
  [/^\/van-phong\/loa\/[^/]+\/sua$/, "Sửa tờ trình", false],
  [/^\/van-phong\/[^/]+\/sua$/, "Sửa đề nghị", false],
  [/^\/van-phong\/[^/]+\/in$/, "In đề nghị", false],
  [/^\/van-phong\/[^/]+$/, "Chi tiết đề nghị", true],
  [/^\/van-phong\/[^/]+\/in-cong-tac\//, "In công tác", false],
  [/^\/du-an\/moi$/, "Dự án mới", false],
  [/^\/du-an\/[^/]+\/sua$/, "Sửa dự án", false],
  [/^\/du-an\/[^/]+$/, "Dự án", true],
  [/^\/viec\/moi$/, "Giao việc", false],
  [/^\/viec\/giong-noi$/, "Giao việc bằng giọng nói", false],
  [/^\/viec\/[^/]+\/sua$/, "Sửa việc", false],
  [/^\/viec\/[^/]+$/, "Chi tiết việc", true],
  [/^\/toa\/[^/]+\/khach$/, "Khách thuê", false],
  [/^\/toa\/[^/]+\/hop-dong$/, "Hợp đồng", false],
  [/^\/toa\/[^/]+\/hoa-don$/, "Thu tiền phòng", false],
  [/^\/toa\/[^/]+\/chi-phi$/, "Chi phí toà", false],
  [/^\/toa\/[^/]+\/thu-khac$/, "Thu khác toà", false],
  [/^\/toa\/[^/]+\/khach-o$/, "Khách ở & xe", false],
  [/^\/toa\/[^/]+\/dien-nuoc$/, "Điện nước toà", false],
  [/^\/toa\/[^/]+\/dien-phong$/, "Điện nước phòng", false],
  [/^\/toa\/[^/]+$/, "Toà nhà", true],
  [/^\/khach\/[^/]+$/, "Khách thuê", true],
  [/^\/khach-hang\/[^/]+$/, "Hồ sơ khách", true],
  [/^\/phan-anh\/[^/]+$/, "Phản ánh", true],
];

function guess(path: string, named: Map<string, string>): { title: string; dom: boolean } {
  if (path === "/") return { title: "Trang chủ", dom: false };
  const exact = named.get(path);
  if (exact) return { title: exact, dom: false };
  const k = path.match(/^\/van-phong\/ds\/([^/]+)$/);
  if (k) return { title: KINDS.find((x) => x.kind === k[1])?.label ?? "Văn phòng số", dom: false };
  for (const [re, t, dom] of PATTERNS) if (re.test(path)) return { title: t, dom };
  return { title: "Màn hình", dom: true };
}

export function OpenTabs() {
  const loc = useLocation();
  const nav = useNavigate();
  const groups = useMenuGroups();
  const pairs = groups.flatMap((g) => g.items.map((a) => [a.to, a.label] as [string, string]));
  const sig = pairs.map((p) => p.join("=")).join("|");
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const named = useMemo(() => new Map(pairs), [sig]);
  const [tabs, setTabs] = useState<OpenTab[]>(loadTabs);
  const navType = useNavigationType();
  const prevKey = useRef(loc.pathname);

  useEffect(() => {
    const key = loc.pathname;
    const to = loc.pathname + loc.search;
    const g = guess(key, named);
    const from = prevKey.current;
    prevKey.current = key;
    setTabs((before) => {
      let prev = before;
      // Chuyển trang kiểu thay thế (lưu form xong mở chi tiết, trang tự chuyển hướng): tab cũ nhường chỗ cho tab mới,
      // không giữ lại form đã gửi
      if (navType === "REPLACE" && from !== key) {
        const pi = prev.findIndex((t) => t.key === from);
        if (pi >= 0 && !prev.some((t) => t.key === key)) { const next = [...prev]; next[pi] = { key, to, title: g.title }; return next; }
        if (pi >= 0) prev = prev.filter((t) => t.key !== from);
      }
      const i = prev.findIndex((t) => t.key === key);
      if (i >= 0) {
        if (prev[i].to === to) return prev;
        const next = [...prev]; next[i] = { ...next[i], to }; return next;
      }
      const next = [...prev, { key, to, title: g.title }];
      while (next.length > MAX_TABS) next.splice(next.findIndex((t) => t.key !== key), 1);
      return next;
    });
    if (!g.dom) return;
    // Trang chi tiết: đọc tên thật trên trang (vd tên toà) khi dữ liệu đã tải
    const read = () => {
      const root = document.querySelector<HTMLElement>('.ka-page[data-active="true"]') ?? document;
      const el = root.querySelector<HTMLElement>(".topbar h1, .pg-head h2, main h1, main h2");
      const t = el?.textContent?.replace(/\s+/g, " ").trim();
      if (t) setTabs((prev) => prev.map((x) => (x.key === key && x.title !== t ? { ...x, title: t.length > 40 ? t.slice(0, 39) + "…" : t } : x)));
    };
    const t1 = setTimeout(read, 400), t2 = setTimeout(read, 1600);
    return () => { clearTimeout(t1); clearTimeout(t2); };
  }, [loc.pathname, loc.search, named]);   // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    try { sessionStorage.setItem(TAB_STORE, JSON.stringify(tabs)); } catch { /* bỏ qua */ }
    window.dispatchEvent(new Event(TABS_EVENT));
  }, [tabs]);

  function close(key: string) {
    const i = tabs.findIndex((t) => t.key === key);
    const next = tabs.filter((t) => t.key !== key);
    setTabs(next);
    if (key === loc.pathname) nav(next[Math.min(i, next.length - 1)]?.to ?? "/");
  }

  if (!tabs.length) return null;
  return (
    <div className="otabs" role="tablist" aria-label="Màn hình đang mở">
      {tabs.map((t) => {
        const on = t.key === loc.pathname;
        return (
          <div key={t.key} className={`otab${on ? " on" : ""}`} role="presentation">
            <Link to={t.to} role="tab" aria-selected={on} title={t.title}>{t.title}</Link>
            <button type="button" aria-label={`Đóng ${t.title}`} title="Đóng" onClick={() => close(t.key)}>{Icon.x}</button>
          </div>
        );
      })}
      {tabs.length > 1 ? (
        <button type="button" className="otab-clear" onClick={() => { const cur = tabs.find((t) => t.key === loc.pathname); setTabs(cur ? [cur] : []); }}>
          Đóng các tab khác
        </button>
      ) : null}
    </div>
  );
}

export function StatusBar() {
  const { profile } = useSession();
  if (!profile) return null;
  return (
    <footer className="statusbar">
      <span>{profile.full_name} · {ROLE_LABEL[profile.role as Role] ?? ""}</span>
      <span>Hôm nay {ddmmyyyy(todayVN())} · Next Living</span>
    </footer>
  );
}
