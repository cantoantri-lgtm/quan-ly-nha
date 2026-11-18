import { Route, Routes } from "react-router-dom";
import { Toast } from "../components/ui";
import WebHome from "./WebHome";
import WebRoom from "./WebRoom";
import { WebPolicy } from "./WebShell";
import { useEffect } from "react";
import { useWebConfig, webText } from "./webApi";
import "./web.css";

/** Website phòng trống công khai: không cần đăng nhập. CTV / nhân sự đã đăng nhập thấy thêm link giới thiệu. */
export default function WebApp() {
  const cfg = useWebConfig();
  // Tiêu đề tab và mô tả khi chia sẻ link (Quản lý sửa trong Cài đặt website)
  useEffect(() => {
    document.title = webText("seo_title");
    let m = document.querySelector<HTMLMetaElement>('meta[name="description"]');
    if (!m) { m = document.createElement("meta"); m.name = "description"; document.head.appendChild(m); }
    m.content = webText("seo_desc");
  }, [cfg]);
  return (
    <>
      <Routes>
        <Route path="/phong" element={<WebHome />} />
        <Route path="/phong/chinh-sach-du-lieu" element={<WebPolicy />} />
        <Route path="/phong/:id" element={<WebRoom />} />
      </Routes>
      <Toast />
    </>
  );
}
