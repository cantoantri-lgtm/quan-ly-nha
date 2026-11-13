import { lazy, Suspense } from "react";
import { Navigate, Outlet, Route, Routes } from "react-router-dom";
import { useSession } from "./lib/session";
import { supabase } from "./lib/supabase";
import { AppHeader, BottomNav, Toast } from "./components/ui";
import Login from "./pages/Login";
import ChangePassword from "./pages/ChangePassword";
import Home from "./pages/Home";
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
import BuildingMeters from "./pages/BuildingMeters";
import Reports from "./pages/Reports";
import Office from "./pages/Office";
import RequestForm from "./pages/RequestForm";
import RequestDetail from "./pages/RequestDetail";
import RequestPrint from "./pages/RequestPrint";
import RequestList from "./pages/RequestList";
import Org from "./pages/Org";
import Tenants, { TenantDetail } from "./pages/Tenants";
import Contracts from "./pages/Contracts";
import Invoices from "./pages/Invoices";
import PayPage from "./pages/PayPage";
import PaymentSettingsPage from "./pages/PaymentSettingsPage";
import VacantRooms from "./pages/VacantRooms";
import VatDaily from "./pages/VatDaily";
import CustomerInfo from "./pages/CustomerInfo";
import { MyPayments, StaffPayments } from "./pages/CustomerPayments";
import Feedback, { FeedbackInbox, FeedbackThread } from "./pages/Feedback";
import Customers from "./pages/Customers";

// Bản đồ tải riêng khi mở (thư viện bản đồ khá nặng)
const MapPage = lazy(() => import("./pages/MapPage"));

function Shell() {
  return (
    <div className="app">
      <AppHeader />
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

function MoneyOnly() {
  const { isManager, isAccountant } = useSession();
  return isManager || isAccountant ? <Outlet /> : <Navigate to="/" replace />;
}

function LeadOnly() {
  const { isLeadUp } = useSession();
  return isLeadUp ? <Outlet /> : <Navigate to="/" replace />;
}

function ManagerOnly() {
  const { isManager } = useSession();
  return isManager ? <Outlet /> : <Navigate to="/" replace />;
}

export default function App() {
  const { session, profile, loading, isCollaborator, isCustomer } = useSession();

  // Trang thanh toán cho khách thuê: công khai, không cần đăng nhập
  if (window.location.pathname.startsWith("/thanh-toan/")) return <Routes><Route path="/thanh-toan/:code" element={<PayPage />} /></Routes>;
  if (loading) return <div className="loading">Đang mở Next Living…</div>;
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
  if (!isCollaborator && session.user.user_metadata?.must_change_password) return <><ChangePassword forced /><Toast /></>;

  // Khách hàng: phòng trống, bản đồ, phản ánh, thông báo, tài khoản
  if (isCustomer) {
    return (
      <Routes>
        <Route element={<Shell />}>
          <Route path="phong-trong" element={<VacantRooms />} />
          <Route path="ban-do" element={<Suspense fallback={<div className="loading">Đang tải bản đồ…</div>}><MapPage /></Suspense>} />
          <Route path="thong-tin" element={<CustomerInfo />} />
          <Route path="thanh-toan-cua-toi" element={<MyPayments />} />
          <Route path="phan-anh" element={<Feedback />} />
          <Route path="phan-anh/:id" element={<FeedbackThread />} />
          <Route path="thong-bao" element={<Notifications />} />
          <Route path="tai-khoan" element={<Account />} />
          <Route path="*" element={<Navigate to="/thong-tin" replace />} />
        </Route>
      </Routes>
    );
  }

  // Cộng tác viên: chỉ bản đồ, phòng trống, tài khoản
  if (isCollaborator) {
    return (
      <Routes>
        <Route element={<Shell />}>
          <Route path="ban-do" element={<Suspense fallback={<div className="loading">Đang tải bản đồ…</div>}><MapPage /></Suspense>} />
          <Route path="phong-trong" element={<VacantRooms />} />
          <Route path="phan-anh" element={<Feedback />} />
          <Route path="phan-anh/:id" element={<FeedbackThread />} />
          <Route path="thong-bao" element={<Notifications />} />
          <Route path="tai-khoan" element={<Account />} />
          <Route path="*" element={<Navigate to="/ban-do" replace />} />
        </Route>
      </Routes>
    );
  }

  return (
    <Routes>
      <Route element={<Shell />}>
        <Route index element={<Home />} />
        <Route path="phong-trong" element={<VacantRooms />} />
        <Route path="viec" element={<Tasks />} />
        <Route element={<AssignerOnly />}>
          <Route path="viec/moi" element={<TaskForm />} />
          <Route path="viec/giong-noi" element={<VoiceTask />} />
          <Route path="viec/:id/sua" element={<TaskForm />} />
        </Route>
        <Route path="viec/:id" element={<TaskDetail />} />
        <Route path="toa/:id" element={<BuildingDetail />} />
        <Route path="toa/:id/khach" element={<Tenants />} />
        <Route path="toa/:id/hop-dong" element={<Contracts />} />
        <Route path="toa/:id/hoa-don" element={<Invoices />} />
        <Route path="toa/:id/dien-nuoc" element={<BuildingMeters />} />
        <Route path="khach/:id" element={<TenantDetail />} />
        <Route path="ban-do" element={<Suspense fallback={<div className="loading">Đang tải bản đồ…</div>}><MapPage /></Suspense>} />
        <Route path="van-phong" element={<Office />} />
        <Route path="van-phong/ds/:kind" element={<RequestList />} />
        <Route path="van-phong/moi/:kind" element={<RequestForm />} />
        <Route path="van-phong/:id" element={<RequestDetail />} />
        <Route path="van-phong/:id/sua" element={<RequestForm />} />
        <Route path="van-phong/:id/in" element={<RequestPrint />} />
        <Route path="to-chuc" element={<Org />} />
        <Route element={<LeadOnly />}>
          <Route path="bao-cao" element={<Reports />} />
        </Route>
        <Route element={<MoneyOnly />}>
          <Route path="hoa-don-gtgt" element={<VatDaily />} />
        </Route>
        <Route path="khach-hang" element={<Customers />} />
        <Route path="khach-hang/:id" element={<CustomerInfo />} />
        <Route path="thu-tien-khach" element={<StaffPayments />} />
        <Route path="phan-anh" element={<FeedbackInbox />} />
        <Route path="phan-anh/:id" element={<FeedbackThread />} />
        <Route path="thong-bao" element={<Notifications />} />
        <Route path="tai-khoan" element={<Account />} />
        <Route path="quan-tri" element={<ManagerOnly />}>
          <Route index element={<AdminHome />} />
          <Route path="nhan-su" element={<Staff />} />
          <Route path="toa-nha" element={<Buildings />} />
          <Route path="thu-tien" element={<PaymentSettingsPage />} />
        </Route>
        <Route path="*" element={<Navigate to="/" replace />} />
      </Route>
    </Routes>
  );
}
