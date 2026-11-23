import { useEffect, useRef, useState } from "react";
import { heroMediaUrl, type HeroMedia } from "../lib/files";
import { useT } from "./i18n";

/**
 * Trình chiếu đầu trang: nhiều ảnh / clip chồng lên nhau, mờ dần sang cái tiếp theo sau mỗi `seconds` giây.
 * Clip tự phát, tắt tiếng, lặp. Có nút tạm dừng và chấm chọn ảnh (WCAG 2.2.2). Người bật "giảm chuyển động" thì không tự chuyển.
 */
export function HeroSlides({ items, seconds = 5 }: { items: HeroMedia[]; seconds?: number }) {
  const t = useT();
  const [i, setI] = useState(0);
  const [paused, setPaused] = useState(() => typeof matchMedia !== "undefined" && matchMedia("(prefers-reduced-motion: reduce)").matches);
  const vids = useRef<(HTMLVideoElement | null)[]>([]);
  const n = items.length;
  const key = items.map((x) => x.path).join("|");

  useEffect(() => { setI(0); }, [key]);
  useEffect(() => {
    if (paused || n < 2) return;
    const t = setTimeout(() => setI((x) => (x + 1) % n), Math.max(3, seconds) * 1000);
    return () => clearTimeout(t);
  }, [i, paused, n, seconds]);
  // Chỉ phát clip đang hiện; clip khác dừng để đỡ tốn mạng
  useEffect(() => {
    vids.current.forEach((v, k) => {
      if (!v) return;
      if (k === i && !paused) { v.currentTime = 0; v.play().catch(() => {}); } else v.pause();
    });
  }, [i, paused, key]);

  if (!n) return null;
  return (
    <>
      <div className="web-slides" aria-hidden="true">
        {items.map((m, k) => {
          const near = k === i || k === (i + 1) % n;   // tải trước ảnh kế tiếp
          return m.kind === "video" ? (
            <video key={m.path} ref={(el) => { vids.current[k] = el; }} className={`web-slide${k === i ? " on" : ""}`}
              src={near || k < i ? heroMediaUrl(m.path) : undefined} muted loop playsInline preload={k === i ? "auto" : "metadata"} />
          ) : (
            <img key={m.path} className={`web-slide${k === i ? " on" : ""}`} src={near || k < i ? heroMediaUrl(m.path) : undefined} alt="" />
          );
        })}
      </div>
      {n > 1 ? (
        <div className="web-slide-ctl">
          <button type="button" className="web-slide-pause" onClick={() => setPaused((p) => !p)} aria-label={paused ? t("slide_play") : t("slide_pause")}>
            {paused
              ? <svg width="14" height="14" viewBox="0 0 24 24" aria-hidden="true"><path d="M7 4l13 8-13 8z" fill="currentColor" /></svg>
              : <svg width="14" height="14" viewBox="0 0 24 24" aria-hidden="true"><path d="M7 4h4v16H7zM13 4h4v16h-4z" fill="currentColor" /></svg>}
          </button>
          {items.map((m, k) => (
            <button key={m.path} type="button" className={`web-dot${k === i ? " on" : ""}`} aria-label={t("slide_n", { n: k + 1, t: n })} aria-current={k === i} onClick={() => setI(k)}><span /></button>
          ))}
        </div>
      ) : null}
    </>
  );
}
