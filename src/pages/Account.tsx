import { Link } from "react-router-dom";
import { supabase } from "../lib/supabase";
import { useSession } from "../lib/session";
import { ROLE_LABEL } from "../lib/labels";
import { Avatar, TopBar } from "../components/ui";
import ChangePassword from "./ChangePassword";

export default function Account() {
  const { profile, buildings, isManager, isCollaborator, isCustomer } = useSession();
  if (!profile) return null;
  return (
    <>
      <TopBar title="Tài khoản" />
      <main className="main stack">
        <section className="card list-row" style={{ cursor: "default" }}>
          <Avatar name={profile.full_name} />
          <div className="grow">
            <div className="name">{profile.full_name}</div>
            <div className="sub">{profile.phone} · {ROLE_LABEL[profile.role]}</div>
          </div>
        </section>
        {isCollaborator || isCustomer ? null : <div className="section-title">Toà nhà phụ trách</div>}
        {isCollaborator || isCustomer ? null : <section className="card" style={{ padding: "12px 16px" }}>
          {isManager ? <span>Quản lý xem được tất cả toà nhà.</span>
            : buildings.length ? buildings.map((b) => <Link key={b.id} to={`/toa/${b.id}`} style={{ display: "block", padding: "4px 0" }}>{b.code} · {b.name} ›</Link>)
            : <span className="muted">Chưa được gán toà nào. Liên hệ quản lý.</span>}
        </section>}
        {isManager ? (
          <>
            <div className="section-title">Quản trị</div>
            <section className="card">
              <Link className="list-row" to="/quan-tri/nhan-su" style={{ color: "inherit" }}><div className="grow name">Nhân sự & tài khoản</div>›</Link>
              <Link className="list-row" to="/quan-tri/toa-nha" style={{ color: "inherit" }}><div className="grow name">Toà nhà</div>›</Link>
            </section>
          </>
        ) : null}
        {isCollaborator ? (
          <p className="muted small" style={{ margin: 0 }}>Tài khoản Cộng tác viên do quản lý cấp, không tự đổi mật khẩu. Cần đổi mật khẩu thì liên hệ quản lý.</p>
        ) : (
          <>
            <div className="section-title">Đổi mật khẩu</div>
            <ChangePassword />
          </>
        )}
        <button className="btn secondary block" style={{ marginTop: 16 }} onClick={() => supabase.auth.signOut()}>Đăng xuất</button>
        <p className="muted small" style={{ textAlign: "center" }}>Next Living · thuộc Next Vision · phiên bản 0.1</p>
      </main>
    </>
  );
}
