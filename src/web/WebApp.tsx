import { Route, Routes } from "react-router-dom";
import { Toast } from "../components/ui";
import WebHome from "./WebHome";
import WebRoom from "./WebRoom";
import { WebPolicy } from "./WebShell";
import { useEffect } from "react";
import { useWebConfig, webText } from "./webApi";
import { useLang } from "./i18n";
import "./web.css";

/** Website phòng trống công khai: không cần đăng nhập. Nhân sự đã đăng nhập thấy thêm link giới thiệu. Nút Liên hệ + nhắn tin: public/lien-he.js (dùng chung với website công ty). */
export default function WebApp() {
  const cfg = useWebConfig();
  const lang = useLang();
  // Tiêu đề tab, mô tả khi chia sẻ link, ngôn ngữ trang và link bản ngôn ngữ kia (hreflang)
  useEffect(() => {
    document.documentElement.lang = lang;
    document.title = webText("seo_title", lang);
    let m = document.querySelector<HTMLMetaElement>('meta[name="description"]');
    if (!m) { m = document.createElement("meta"); m.name = "description"; document.head.appendChild(m); }
    m.content = webText("seo_desc", lang);
    document.querySelectorAll('link[data-nl-hreflang]').forEach((x) => x.remove());
    const base = location.origin + location.pathname.replace(/^\/en(?=\/)/, "");
    for (const [hl, href] of [["vi", base], ["en", base.replace(location.origin, location.origin + "/en")]]) {
      const l = document.createElement("link"); l.rel = "alternate"; l.hreflang = hl; l.href = href; l.dataset.nlHreflang = "1"; document.head.appendChild(l);
    }
    return () => { document.documentElement.lang = "vi"; };
  }, [cfg, lang]);
  useEffect(() => {
    if (document.querySelector('script[data-nl-lien-he]')) return;
    const s = document.createElement("script");
    s.src = "/lien-he.js"; s.charset = "utf-8"; s.defer = true; s.dataset.nlLienHe = "1";
    document.body.appendChild(s);
  }, []);
  return (
    <>
      <Routes>
        <Route path="/phong" element={<WebHome />} />
        <Route path="/phong/chinh-sach-du-lieu" element={<WebPolicy />} />
        <Route path="/phong/:id" element={<WebRoom />} />
        <Route path="/en/phong" element={<WebHome />} />
        <Route path="/en/phong/chinh-sach-du-lieu" element={<WebPolicy />} />
        <Route path="/en/phong/:id" element={<WebRoom />} />
      </Routes>
      <Toast />
    </>
  );
}
