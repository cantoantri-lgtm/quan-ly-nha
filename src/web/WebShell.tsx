import { Link } from "react-router-dom";
import { useSession } from "../lib/session";
import { CONTACT } from "./webApi";

export const WebIcon = {
  photo: (s = 40) => <svg aria-hidden="true" width={s} height={s} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="4" width="18" height="16" rx="2" /><path d="M3 15l5-5 4 4 3-3 6 6" /><circle cx="16" cy="8.5" r="1.5" /></svg>,
  chat: <svg aria-hidden="true" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M21 12a8 8 0 0 1-11.7 7.1L4 20l1-4.6A8 8 0 1 1 21 12z" /></svg>,
  check: <svg aria-hidden="true" width="36" height="36" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round"><path d="M5 12.5l4.5 4.5L19 7.5" /></svg>,
};

export const zaloHref = () => (CONTACT.zalo ? `https://zalo.me/${CONTACT.zalo.replace(/\D/g, "")}` : null);

export function WebLogo() {
  return (
    <Link to="/phong" aria-label="Next Living, trang chủ">
      <img className="web-logo on-light" src="/logo-next-living-ngang.svg" alt="Next Living" />
      <img className="web-logo on-dark" src="/logo-next-living-ngang-trang.svg" alt="" aria-hidden="true" />
    </Link>
  );
}

export function WebHeader() {
  const { session } = useSession();
  return (
    <header className="web-wrap web-head">
      <WebLogo />
      <nav className="web-nav" aria-label="Menu chính">
        <a href="/phong#phong">Phòng trống</a>
        <a href="/phong#toa">Toà nhà</a>
        <a href="/phong#thuong-hieu">Hệ thương hiệu</a>
        <a href="/phong#app">App người thuê</a>
      </nav>
      <div className="web-head-end">
        <a className="web-pill" href="/">{session ? "Vào app" : "Đăng nhập"}</a>
      </div>
    </header>
  );
}

export function WebFooter() {
  const zalo = zaloHref();
  return (
    <footer className="web-foot">
      <div className="web-wrap web-foot-cols">
        <div>
          <img className="web-logo" src="/logo-next-living-ngang-trang.svg" alt="Next Living" />
          <p style={{ marginTop: 12 }}>Phòng và căn hộ dịch vụ ở trung tâm TP.HCM.</p>
        </div>
        <div>
          <b>Thuê phòng</b>
          <p><a href="/phong#phong">Phòng trống</a></p>
          <p><a href="/phong#toa">Toà nhà</a></p>
          <p><a href="/">Cộng tác viên đăng nhập</a></p>
        </div>
        <div>
          <b>Chính sách</b>
          <p><Link to="/phong/chinh-sach-du-lieu">Dữ liệu cá nhân</Link></p>
        </div>
        {CONTACT.hotline || zalo || CONTACT.email ? (
          <div>
            <b>Liên hệ</b>
            {CONTACT.hotline ? <p><a href={`tel:${CONTACT.hotline.replace(/\s/g, "")}`}>Hotline {CONTACT.hotline}</a></p> : null}
            {zalo ? <p><a href={zalo} target="_blank" rel="noopener">Chat Zalo</a></p> : null}
            {CONTACT.email ? <p><a href={`mailto:${CONTACT.email}`}>{CONTACT.email}</a></p> : null}
          </div>
        ) : null}
      </div>
      <div className="web-wrap web-foot-end">Next Living là thương hiệu cho thuê phòng của Next Vision.</div>
    </footer>
  );
}

export function WebPolicy() {
  return (
    <div className="web">
      <div className="web-bar"><WebHeader /></div>
      <main className="web-wrap web-sec" style={{ maxWidth: 760 }}>
        <h1 style={{ fontSize: 32, fontWeight: 800, color: "var(--web-title)" }}>Chính sách dữ liệu cá nhân</h1>
        <p>Khi anh chị đặt lịch xem phòng trên trang này, Next Living (Công ty Next Vision) nhận họ tên, số điện thoại, ngày giờ muốn xem và ghi chú anh chị nhập.</p>
        <p>Chúng tôi chỉ dùng các thông tin đó để gọi điện, nhắn tin hẹn giờ xem phòng và tư vấn phòng phù hợp. Chỉ nhân viên phụ trách toà nhà và quản lý công ty xem được. Chúng tôi không bán hay chia sẻ thông tin này cho bên khác.</p>
        <p>Anh chị có thể yêu cầu xem, sửa hoặc xoá thông tin của mình bằng cách liên hệ nhân viên đã gọi cho anh chị.</p>
        <p className="web-muted" style={{ fontSize: 14 }}>Căn cứ Nghị định 13/2023/NĐ-CP về bảo vệ dữ liệu cá nhân.</p>
        <Link to="/phong">← Về trang phòng trống</Link>
      </main>
      <WebFooter />
    </div>
  );
}
