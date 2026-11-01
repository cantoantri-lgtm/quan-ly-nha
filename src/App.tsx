import { Navigate, Outlet, Route, Routes } from "react-router-dom";
import { useSession } from "./lib/session";
import { supabase } from "./lib/supabase";
import { BottomNav, Toast } from "./components/ui";
import Login from "./pages/Login";
import ChangePassword from "./pages/ChangePassword";
import Tasks from "./pages/Tasks";
import TaskDetail from "./pages/TaskDetail";
import TaskForm from "./pages/TaskForm";
import Notifications from "./pages/Notifications";
import Account from "./pages/Account";
import AdminHome from "./pages/AdminHome";
import Staff from "./pages/Staff";
import Buildings from "./pages/Buildings";
import VoiceTask from "./pages/VoiceTask";
import BuildingDetail from "./pages/BuildingDetail";
import Office from "./pages/Office";
import RequestForm from "./pages/RequestForm";
import RequestDetail from "./pages/RequestDetail";

function Shell() {
  return (
    <div className="app">
      <Outlet />
      <BottomNav />
      <Toast />
    </div>
  );
}

// Chỉ Quản lý / Giám sát được tạo, giao, sửa việc
function AssignerOnly() {
  const { isManager, isSupervisor } = useSession();
  return isManager || isSupervisor ? <Outlet /> : <Navigate to="/" replace />;
}

function ManagerOnly() {
  const { isManager } = useSession();
  return isManager ? <Outlet /> : <Navigate to="/" replace />;
}

export default function App() {
  const { session, profile, loading } = useSession();

  if (loading) return <div className="loading">Đang mở Neo Nestly…</div>;
  if (!session) return <Login />;
  if (!profile || !profile.is_active) {
    return (
      <div className="auth-wrap">
        <div className="auth-card">
          <h2 style={{ fontSize: 20 }}>Tài khoản chưa được kích hoạt</h2>
          <p className="muted" style={{ margin: 0 }}>Tài khoản này đã bị khoá hoặc chưa được quản lý cấp quyền. Liên hệ quản lý để được hỗ trợ.</p>
          <button className="btn" onClick={() => supabase.auth.signOut()}>Đăng xuất</button>
        </div>
      </div>
    );
  }
  if (session.user.user_metadata?.must_change_password) return <><ChangePassword forced /><Toast /></>;

  return (
    <Routes>
      <Route element={<Shell />}>
        <Route index element={<Tasks />} />
        <Route element={<AssignerOnly />}>
          <Route path="viec/moi" element={<TaskForm />} />
          <Route path="viec/giong-noi" element={<VoiceTask />} />
          <Route path="viec/:id/sua" element={<TaskForm />} />
        </Route>
        <Route path="viec/:id" element={<TaskDetail />} />
        <Route path="toa/:id" element={<BuildingDetail />} />
        <Route path="van-phong" element={<Office />} />
        <Route path="van-phong/moi/:kind" element={<RequestForm />} />
        <Route path="van-phong/:id" element={<RequestDetail />} />
        <Route path="van-phong/:id/sua" element={<RequestForm />} />
        <Route path="thong-bao" element={<Notifications />} />
        <Route path="tai-khoan" element={<Account />} />
        <Route path="quan-tri" element={<ManagerOnly />}>
          <Route index element={<AdminHome />} />
          <Route path="nhan-su" element={<Staff />} />
          <Route path="toa-nha" element={<Buildings />} />
        </Route>
        <Route path="*" element={<Navigate to="/" replace />} />
      </Route>
    </Routes>
  );
}
