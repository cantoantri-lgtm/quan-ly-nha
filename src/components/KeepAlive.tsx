import { createContext, useContext, useEffect, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { UNSAFE_LocationContext, useLocation, useNavigationType, useOutlet, type Location } from "react-router-dom";

/* Giữ các màn hình đang mở ở thanh tab PC còn sống khi chuyển tab: không dựng lại trang,
   không mất dữ liệu đang nhập hay popup đang mở. Trang không phải tab đang xem thì ẩn (display none).
   Điện thoại (dưới 900px) không có thanh tab nên giữ cách cũ. */

const PageActive = createContext(true);
/** false khi trang đang bị ẩn sau một tab khác: phím tắt, khoá cuộn… phải bỏ qua */
export const usePageActive = () => useContext(PageActive);

const TAB_STORE = "nl_tabs";
export const TABS_EVENT = "nl:tabs";
function openTabKeys(): Set<string> {
  try {
    const v = JSON.parse(sessionStorage.getItem(TAB_STORE) ?? "[]");
    return new Set(Array.isArray(v) ? v.map((t: { key?: unknown }) => String(t?.key ?? "")) : []);
  } catch { return new Set(); }
}
function useWide(min = 900) {
  const [w, setW] = useState(() => typeof window !== "undefined" && window.matchMedia(`(min-width: ${min}px)`).matches);
  useEffect(() => {
    const mq = window.matchMedia(`(min-width: ${min}px)`);
    const h = () => setW(mq.matches);
    mq.addEventListener("change", h);
    return () => mq.removeEventListener("change", h);
  }, [min]);
  return w;
}

export function KeepAliveOutlet() {
  const outlet = useOutlet();
  const loc = useLocation();
  const navType = useNavigationType();
  const wide = useWide();
  const cache = useRef(new Map<string, { el: ReactNode; loc: Location }>());
  const scrolls = useRef(new Map<string, number>());
  const [, bump] = useState(0);
  const key = loc.pathname;

  // Thanh tab đóng một tab: bỏ trang đó khỏi bộ nhớ
  useEffect(() => {
    const h = () => bump((x) => x + 1);
    window.addEventListener(TABS_EVENT, h);
    return () => window.removeEventListener(TABS_EVENT, h);
  }, []);
  // Nhớ vị trí cuộn của từng trang, trả lại khi quay về tab
  useEffect(() => {
    if (!wide) return;
    const h = () => scrolls.current.set(key, window.scrollY);
    window.addEventListener("scroll", h, { passive: true });
    return () => window.removeEventListener("scroll", h);
  }, [key, wide]);
  useLayoutEffect(() => {
    if (wide) window.scrollTo(0, scrolls.current.get(key) ?? 0);
  }, [key, wide]);

  if (!wide) {
    if (cache.current.size) cache.current.clear();
    return <>{outlet}</>;
  }
  cache.current.set(key, { el: outlet, loc });
  const keep = openTabKeys();
  keep.add(key);
  for (const k of [...cache.current.keys()]) if (!keep.has(k)) { cache.current.delete(k); scrolls.current.delete(k); }

  return (
    <>
      {[...cache.current].map(([k, v]) => {
        const on = k === key;
        return (
          <div key={k} className="ka-page" data-active={on ? "true" : "false"} hidden={!on} style={on ? { display: "contents" } : undefined}>
            <PageActive.Provider value={on}>
              <UNSAFE_LocationContext.Provider value={{ location: v.loc, navigationType: navType }}>{v.el}</UNSAFE_LocationContext.Provider>
            </PageActive.Provider>
          </div>
        );
      })}
    </>
  );
}
