import { useMemo, useState, type FormEvent } from "react";
import { Link } from "react-router-dom";
import { floorText, groupLabel, perText, shortAddr, typeGroup, usePhotoUrls, useWebRooms, webCfg, webNotice, webShow, webText, type WebRoomRow } from "./webApi";
import { dataText, millions, money, useLang, useT, webPath } from "./i18n";
import { WebFooter, WebHeader, WebIcon, zaloHref } from "./WebShell";
import { HeroSlides } from "./HeroSlides";

type Filter = { building: string; group: string; price: string; mode: string };
const PRICES: [string, "price_any" | "price_lt7" | "price_7_10" | "price_gt10", (n: number) => boolean][] = [
  ["", "price_any", () => true],
  ["duoi7", "price_lt7", (n) => n < 7_000_000],
  ["7-10", "price_7_10", (n) => n >= 7_000_000 && n <= 10_000_000],
  ["tren10", "price_gt10", (n) => n > 10_000_000],
];

/** Trang chủ website phòng trống: ảnh lớn, ô tìm phòng nổi, toà nổi bật, danh sách phòng trống (phong cách 6) */
export default function WebHome() {
  const { rooms, err } = useWebRooms();
  const lang = useLang(), t = useT();
  const trieu = (n: number) => millions(lang, n);
  const dt = (x: string) => dataText(lang, x);
  const [draft, setDraft] = useState<Filter>({ building: "", group: "", price: "", mode: "" });
  const [f, setF] = useState<Filter>(draft);
  const [sort, setSort] = useState<"gia" | "toa">("gia");

  const buildings = useMemo(() => {
    const m = new Map<string, { id: string; name: string; address: string | null; n: number; min: number; photo: WebRoomRow["photo"] }>();
    for (const r of rooms ?? []) {
      const b = m.get(r.building_id) ?? { id: r.building_id, name: r.building_name, address: r.address, n: 0, min: Infinity, photo: r.building_photo ?? r.photo };
      b.n += 1; b.min = Math.min(b.min, r.list_price); m.set(r.building_id, b);
    }
    return [...m.values()].sort((a, b) => b.n - a.n);
  }, [rooms]);
  const groups = useMemo(() => [...new Set((rooms ?? []).map((r) => typeGroup(r.type_name)))].sort(), [rooms]);
  const hasNight = (rooms ?? []).some((r) => r.rent_mode === "dem");

  const list = useMemo(() => {
    const p = PRICES.find((x) => x[0] === f.price)![2];
    const out = (rooms ?? []).filter((r) => (!f.building || r.building_id === f.building) && (!f.group || typeGroup(r.type_name) === f.group)
      && (!f.mode || r.rent_mode === f.mode) && p(r.list_price));
    return sort === "gia" ? [...out].sort((a, b) => a.list_price - b.list_price) : out;
  }, [rooms, f, sort]);

  // Khám phá mới: tự lấy từ dữ liệu thật
  const features = useMemo(() => {
    if (!rooms?.length) return [];
    const cheapest = [...rooms].sort((a, b) => a.list_price - b.list_price)[0];
    const most = buildings[0];
    const view = rooms.find((r) => /ban công|cửa sổ/i.test(r.type_name) && r.room_id !== cheapest.room_id);
    const out: { tag: string; t: string; s: string; photo: WebRoomRow["photo"]; go: () => void }[] = [
      { tag: t("feat_cheap"), t: `${dt(cheapest.type_name)} ${t("from")} ${trieu(cheapest.list_price)}`, s: shortAddr(cheapest.address) || cheapest.building_name, photo: cheapest.photo, go: () => apply({ ...EMPTY, group: typeGroup(cheapest.type_name) }) },
    ];
    if (most) out.push({ tag: t("feat_many"), t: most.name, s: t("rooms_vacant", { n: most.n }), photo: most.photo, go: () => apply({ ...EMPTY, building: most.id }) });
    if (view) out.push({ tag: /ban công/i.test(view.type_name) ? t("feat_balcony") : t("feat_window"), t: `${dt(view.type_name)} · ${view.building_name}`, s: `${t("from")} ${trieu(view.list_price)}`, photo: view.photo, go: () => apply({ ...EMPTY, building: view.building_id }) });
    return out;
  }, [rooms, buildings, lang]); // eslint-disable-line react-hooks/exhaustive-deps

  const cfg = webCfg();
  const heroPhoto = (cfg.hero_building ? buildings.find((b) => b.id === cfg.hero_building && b.photo)?.photo : null)
    ?? buildings.find((b) => b.photo)?.photo ?? null;
  const [heroUrl] = usePhotoUrls(heroPhoto ? [heroPhoto] : null, "full");
  const featureUrls = usePhotoUrls(features.map((x) => x.photo), "full");
  const buildingUrls = usePhotoUrls(buildings.map((b) => b.photo), "thumb");
  const roomUrls = usePhotoUrls(list.map((r) => r.photo), "thumb");

  function apply(next: Filter) {
    setDraft(next); setF(next);
    document.getElementById("phong")?.scrollIntoView({ behavior: "smooth", block: "start" });
  }
  function submit(e: FormEvent) { e.preventDefault(); apply(draft); }
  const set = (k: keyof Filter) => (e: { target: { value: string } }) => setDraft({ ...draft, [k]: e.target.value });
  const zalo = zaloHref();

  return (
    <div className="web">
      {webNotice(lang) ? <div className="web-notice" role="note">{webNotice(lang)}</div> : null}
      <section className="web-hero">
        {cfg.hero_media?.length ? <HeroSlides items={cfg.hero_media} seconds={cfg.hero_interval ?? 5} />
          : heroUrl ? <img className="web-hero-img" src={heroUrl} alt="" /> : (
          <svg className="web-skyline" aria-hidden="true" viewBox="0 0 1440 640" preserveAspectRatio="xMidYMax slice">
            <path d="M0 640 V390 H120 V330 H220 V430 H300 V270 H420 V380 H520 V230 H640 V350 H720 V300 H860 V420 H940 V250 H1080 V370 H1160 V310 H1300 V410 H1440 V640 Z" fill="var(--web-hero-2)" />
            <path d="M0 640 V500 H180 V450 H340 V530 H500 V470 H700 V550 H900 V490 H1100 V540 H1280 V480 H1440 V640 Z" fill="var(--web-hero-3)" />
          </svg>
        )}
        <div className="web-hero-shade" aria-hidden="true" />
        <div style={{ position: "relative" }}><WebHeader /></div>
        <div className="web-wrap web-hero-text">
          <span className="web-eyebrow">{webText("eyebrow", lang)}</span>
          <h1>{webText("title1", lang)}<br /><em>{webText("title2", lang)}</em></h1>
          <p>{webText("subtitle", lang)}</p>
        </div>
      </section>

      <section className="web-wrap web-search" aria-label={t("search_aria")}>
        <form onSubmit={submit}>
          <label>{t("where")}
            <select value={draft.building} onChange={set("building")}>
              <option value="">{t("all_buildings")}</option>
              {buildings.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
            </select>
          </label>
          <label>{t("room_type")}
            <select value={draft.group} onChange={set("group")}>
              <option value="">{t("all")}</option>
              {groups.map((g) => <option key={g} value={g}>{groupLabel(g, lang)}</option>)}
            </select>
          </label>
          <label>{t("budget")}
            <select value={draft.price} onChange={set("price")}>
              {PRICES.map(([k, l]) => <option key={k} value={k}>{t(l)}</option>)}
            </select>
          </label>
          {hasNight ? (
            <label>{t("rent_by")}
              <select value={draft.mode} onChange={set("mode")}>
                <option value="">{t("month_or_night")}</option><option value="thang">{t("by_month")}</option><option value="dem">{t("by_night")}</option>
              </select>
            </label>
          ) : null}
          <button type="submit">{t("find")}</button>
        </form>
      </section>

      {err ? <div className="web-wrap web-sec"><div className="web-err" role="alert">{t("load_err")}</div></div> : null}

      {webShow("show_features") && features.length ? (
        <section className="web-wrap web-sec" aria-labelledby="kham-pha">
          <div style={{ display: "flex", flexDirection: "column", gap: 8 }}><span className="web-eyebrow">{t("feat_eyebrow")}</span><h2 id="kham-pha">{t("feat_title")}</h2></div>
          <div className="web-grid">
            {features.map((x, i) => (
              <button key={x.tag} type="button" className="web-feature" style={{ background: `var(--web-card-${i + 1})` }} onClick={x.go}>
                {featureUrls[i] ? <img src={featureUrls[i]!} alt="" /> : null}
                <span className="tag">{x.tag}</span>
                <span className="t">{x.t}</span>
                <span className="s">{x.s}</span>
              </button>
            ))}
          </div>
        </section>
      ) : null}

      {webShow("show_buildings") ? (
      <section id="toa" className="web-wrap web-sec" aria-labelledby="toa-h">
        <div className="web-sec-head">
          <div><span className="web-eyebrow">{t("bld_eyebrow")}</span><h2 id="toa-h">{t("bld_title")}</h2></div>
          {f.building ? <button type="button" className="web-pill" onClick={() => apply({ ...f, building: "" })}>{t("bld_all")}</button> : null}
        </div>
        <div className="web-grid sm">
          {buildings.map((b, i) => (
            <button key={b.id} type="button" className="web-bcard" aria-pressed={f.building === b.id} onClick={() => apply({ ...f, building: b.id })}>
              <div className="web-ph">{buildingUrls[i] ? <img src={buildingUrls[i]!} alt="" /> : WebIcon.photo(36)}</div>
              <h3>{b.name}</h3>
              <span className="web-muted" style={{ fontSize: 14 }}>{shortAddr(b.address)}</span>
              <span style={{ fontSize: 15 }}><span style={{ color: "var(--web-green)", fontWeight: 500 }}>{t("from")} {trieu(b.min)}</span> · {t("rooms_vacant", { n: b.n })}</span>
            </button>
          ))}
        </div>
      </section>
      ) : null}

      <section id="phong" className="web-wrap web-sec" aria-labelledby="phong-h" style={{ scrollMarginTop: 12 }}>
        <div className="web-sec-head">
          <div>
            <span className="web-eyebrow">{t("vac_eyebrow")}</span>
            <h2 id="phong-h">{t("vac_title")}</h2>
            <p className="web-muted" style={{ margin: "4px 0 0" }}>{rooms ? `${t("vac_count", { n: list.length })}${list.length !== rooms.length ? t("vac_of", { t: rooms.length }) : ""}` : t("loading")}{t("vac_live")}</p>
          </div>
          <label className="web-muted" style={{ fontSize: 14, display: "flex", gap: 8, alignItems: "center" }}>{t("sort")}
            <select className="web-chip" value={sort} onChange={(e) => setSort(e.target.value as "gia" | "toa")}><option value="gia">{t("sort_price")}</option><option value="toa">{t("sort_building")}</option></select>
          </label>
        </div>
        <div className="web-chips" role="group" aria-label={t("filter_type")}>
          <button type="button" className="web-chip" aria-pressed={!f.group} onClick={() => apply({ ...f, group: "" })}>{t("all")}</button>
          {groups.map((g) => <button key={g} type="button" className="web-chip" aria-pressed={f.group === g} onClick={() => apply({ ...f, group: g })}>{groupLabel(g, lang)}</button>)}
        </div>
        {rooms && !list.length ? <div className="web-empty">{t("empty_filter")}{zalo ? t("empty_zalo") : ""}.</div> : null}
        <div className="web-grid">
          {list.map((r, i) => (
            <Link key={r.room_id} className="web-room" to={`${webPath(lang, `/phong/${r.room_id}`)}${window.location.search}`}>
              <div className="web-ph">{roomUrls[i] ? <img src={roomUrls[i]!} alt="" loading="lazy" /> : WebIcon.photo(40)}<span className="badge">{t("vacant_now")}</span></div>
              <div className="body">
                <h3>{dt(r.type_name)}</h3>
                <span className="web-muted" style={{ fontSize: 15 }}>{r.building_name}{r.floor != null ? ` · ${floorText(r.floor, lang)}` : ""}</span>
                <span className="web-price" style={{ marginTop: 6 }}>{money(lang, r.list_price)}<small>{perText(r.rent_mode, lang)}</small></span>
              </div>
            </Link>
          ))}
        </div>
      </section>

      {webShow("show_app") ? (
      <section id="app" className="web-wrap web-sec">
        <div className="web-app">
          <div style={{ flex: "1 1 420px", display: "flex", flexDirection: "column", gap: 12 }}>
            <span className="web-eyebrow">{t("app_eyebrow")}</span>
            <h2>{t("app_title")}</h2>
            <ul>
              <li>{t("app_1")}</li>
              <li>{t("app_2")}</li>
              <li>{t("app_3")}</li>
            </ul>
            <a className="web-pill solid" href="/" style={{ alignSelf: "flex-start" }}>{t("app_login")}</a>
          </div>
        </div>
      </section>
      ) : null}

      {webShow("show_brands") ? (
      <section id="thuong-hieu" className="web-wrap web-sec" aria-labelledby="th-h">
        <div style={{ display: "flex", flexDirection: "column", gap: 8 }}><span className="web-eyebrow">Next Vision</span><h2 id="th-h">{t("brand_title")}</h2></div>
        <div className="web-grid">
          <div className="web-brand"><b style={{ color: "var(--web-green)" }}>Next Living</b><span className="web-muted">{t("brand_living")}</span></div>
          <div className="web-brand"><b style={{ color: "var(--web-title)" }}>Next Hub</b><span className="web-muted">{t("brand_hub")}</span></div>
          <div className="web-brand"><b style={{ color: "var(--web-title)" }}>Next Stay</b><span className="web-muted">{t("brand_stay")}</span></div>
        </div>
      </section>
      ) : null}

      <WebFooter />
    </div>
  );
}
const EMPTY: Filter = { building: "", group: "", price: "", mode: "" };
