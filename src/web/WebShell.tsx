import { Link, useLocation } from "react-router-dom";
import { useSession } from "../lib/session";
import { webCfg, webShow, webText } from "./webApi";
import { otherLangPath, useLang, useT, webPath } from "./i18n";

export const WebIcon = {
  photo: (s = 40) => <svg aria-hidden="true" width={s} height={s} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="4" width="18" height="16" rx="2" /><path d="M3 15l5-5 4 4 3-3 6 6" /><circle cx="16" cy="8.5" r="1.5" /></svg>,
  chat: <svg aria-hidden="true" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M21 12a8 8 0 0 1-11.7 7.1L4 20l1-4.6A8 8 0 1 1 21 12z" /></svg>,
  check: <svg aria-hidden="true" width="36" height="36" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round"><path d="M5 12.5l4.5 4.5L19 7.5" /></svg>,
};

export const zaloHref = () => { const z = webCfg().zalo; return z ? `https://zalo.me/${z.replace(/\D/g, "")}` : null; };
export const telHref = () => { const h = webCfg().hotline; return h ? `tel:${h.replace(/[\s.]/g, "")}` : null; };

export function WebLogo() {
  const lang = useLang(), t = useT();
  return (
    <Link to={webPath(lang, "/phong")} aria-label={t("home_aria")}>
      <img className="web-logo on-light" src="/logo-next-living-ngang.svg" alt="Next Living" />
      <img className="web-logo on-dark" src="/logo-next-living-ngang-trang.svg" alt="" aria-hidden="true" />
    </Link>
  );
}

/** Nút chuyển VI / EN: mở cùng trang ở ngôn ngữ kia. Tải lại trang để nút Liên hệ (lien-he.js) đổi ngôn ngữ theo. */
export function LangSwitch() {
  const loc = useLocation(), t = useT(), lang = useLang();
  return (
    <a className="web-pill" href={otherLangPath(loc.pathname, loc.search, loc.hash)} hrefLang={lang === "en" ? "vi" : "en"} lang={lang === "en" ? "vi" : "en"} aria-label={t("switch_lang_aria")}>
      {lang === "en" ? "VI" : "EN"}<span className="web-hide-sm">&nbsp;· {t("switch_lang")}</span>
    </a>
  );
}

export function WebHeader() {
  const { session } = useSession();
  const lang = useLang(), t = useT();
  const home = webPath(lang, "/phong");
  return (
    <header className="web-wrap web-head">
      <WebLogo />
      <nav className="web-nav" aria-label={t("nav_menu")}>
        <a href={`${home}#phong`}>{t("nav_rooms")}</a>
        {webShow("show_buildings") ? <a href={`${home}#toa`}>{t("nav_buildings")}</a> : null}
        {webShow("show_brands") ? <a href={`${home}#thuong-hieu`}>{t("nav_brands")}</a> : null}
        {webShow("show_app") ? <a href={`${home}#app`}>{t("nav_app")}</a> : null}
      </nav>
      <div className="web-head-end">
        <LangSwitch />
        {telHref() ? <a className="web-pill" href={telHref()!}>{t("call")}<span className="web-hide-sm"> {webCfg().hotline}</span></a> : null}
        <a className="web-pill" href="/">{session ? t("enter_app") : t("login")}</a>
      </div>
    </header>
  );
}

export function WebFooter() {
  const zalo = zaloHref();
  const c = webCfg();
  const lang = useLang(), t = useT();
  const home = webPath(lang, "/phong");
  return (
    <footer className="web-foot">
      <div className="web-wrap web-foot-cols">
        <div>
          <img className="web-logo" src="/logo-next-living-ngang-trang.svg" alt="Next Living" />
          <p style={{ marginTop: 12 }}>{webText("footer_note", lang)}</p>
          {c.address ? <p>{c.address}</p> : null}
          {c.hours && lang === "vi" ? <p>{c.hours}</p> : null}
        </div>
        <div>
          <b>{t("foot_rent")}</b>
          <p><a href={`${home}#phong`}>{t("nav_rooms")}</a></p>
          {webShow("show_buildings") ? <p><a href={`${home}#toa`}>{t("nav_buildings")}</a></p> : null}
        </div>
        <div>
          <b>{t("foot_policy")}</b>
          <p><Link to={webPath(lang, "/phong/chinh-sach-du-lieu")}>{t("foot_privacy")}</Link></p>
        </div>
        {c.hotline || zalo || c.email ? (
          <div>
            <b>{t("foot_contact")}</b>
            {c.hotline ? <p><a href={telHref()!}>Hotline {c.hotline}</a></p> : null}
            {zalo ? <p><a href={zalo} target="_blank" rel="noopener">{t("foot_zalo")}</a></p> : null}
            {c.email ? <p><a href={`mailto:${c.email}`}>{c.email}</a></p> : null}
          </div>
        ) : null}
      </div>
      <div className="web-wrap web-foot-end">{t("foot_brand")}</div>
    </footer>
  );
}

export function WebPolicy() {
  const lang = useLang(), t = useT();
  return (
    <div className="web">
      <div className="web-bar"><WebHeader /></div>
      <main className="web-wrap web-sec" style={{ maxWidth: 760 }}>
        <h1 style={{ fontSize: 44, color: "var(--web-title)" }}>{t("pol_title")}</h1>
        <p>{t("pol_1")}</p>
        <p>{t("pol_2")}</p>
        <p>{t("pol_3")}</p>
        <p className="web-muted" style={{ fontSize: 14 }}>{t("pol_4")}</p>
        <Link to={webPath(lang, "/phong")}>{t("pol_back")}</Link>
      </main>
      <WebFooter />
    </div>
  );
}
