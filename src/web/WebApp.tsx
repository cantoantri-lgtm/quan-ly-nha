import { Route, Routes } from "react-router-dom";
import { Toast } from "../components/ui";
import WebHome from "./WebHome";
import WebRoom from "./WebRoom";
import { WebPolicy } from "./WebShell";
import "./web.css";

/** Website phòng trống công khai: không cần đăng nhập. CTV / nhân sự đã đăng nhập thấy thêm link giới thiệu. */
export default function WebApp() {
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
