import { useMemo, useState, type FormEvent } from "react";
import { Link } from "react-router-dom";
import { vnd } from "../lib/money";
import { floorText, perText, shortAddr, typeGroup, usePhotoUrls, useWebRooms, type WebRoomRow } from "./webApi";
import { WebFooter, WebHeader, WebIcon, zaloHref } from "./WebShell";

type Filter = { building: string; group: string; price: string; mode: string };
const PRICES: [string, string, (n: number) => boolean][] = [
  ["", "Mọi mức giá", () => true],
  ["duoi7", "Dưới 7 triệu", (n) => n < 7_000_000],
  ["7-10", "7 – 10 triệu", (n) => n >= 7_000_000 && n <= 10_000_000],
  ["tren10", "Trên 10 triệu", (n) => n > 10_000_000],
];
const trieu = (n: number) => (n / 1_000_000).toLocaleString("vi-VN", { maximumFractionDigits: 1 }) + " triệu";

/** Trang chủ website phòng trống: ảnh lớn, ô tìm phòng nổi, toà nổi bật, danh sách phòng trống (phong cách 6) */
export default function WebHome() {
  const { rooms, err } = useWebRooms();
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
      { tag: "Giá tốt", t: `${cheapest.type_name} từ ${trieu(cheapest.list_price)}`, s: shortAddr(cheapest.address) || cheapest.building_name, photo: cheapest.photo, go: () => apply({ ...EMPTY, group: typeGroup(cheapest.type_name) }) },
    ];
    if (most) out.push({ tag: "Nhiều lựa chọn", t: most.name, s: `${most.n} phòng đang trống`, photo: most.photo, go: () => apply({ ...EMPTY, building: most.id }) });
    if (view) out.push({ tag: /ban công/i.test(view.type_name) ? "Có ban công" : "Có cửa sổ", t: `${view.type_name} · ${view.building_name}`, s: `từ ${trieu(view.list_price)}`, photo: view.photo, go: () => apply({ ...EMPTY, building: view.building_id }) });
    return out;
  }, [rooms, buildings]); // eslint-disable-line react-hooks/exhaustive-deps

  const heroPhoto = buildings.find((b) => b.photo)?.photo ?? null;
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
      <section className="web-hero">
        {heroUrl ? <img className="web-hero-img" src={heroUrl} alt="" /> : (
          <svg className="web-skyline" aria-hidden="true" viewBox="0 0 1440 640" preserveAspectRatio="xMidYMax slice">
            <path d="M0 640 V390 H120 V330 H220 V430 H300 V270 H420 V380 H520 V230 H640 V350 H720 V300 H860 V420 H940 V250 H1080 V370 H1160 V310 H1300 V410 H1440 V640 Z" fill="var(--web-hero-2)" />
            <path d="M0 640 V500 H180 V450 H340 V530 H500 V470 H700 V550 H900 V490 H1100 V540 H1280 V480 H1440 V640 Z" fill="var(--web-hero-3)" />
          </svg>
        )}
        <div className="web-hero-shade" aria-hidden="true" />
        <div style={{ position: "relative" }}><WebHeader /></div>
        <div className="web-wrap web-hero-text">
          <h1>Sống tiện.<br />Dọn vào là ở.</h1>
          <p>Phòng và căn hộ dịch vụ ở trung tâm TP.HCM. Trống thật, cập nhật theo giờ.</p>
        </div>
      </section>

      <section className="web-wrap web-search" aria-label="Tìm phòng">
        <form onSubmit={submit}>
          <label>Bạn muốn ở đâu?
            <select value={draft.building} onChange={set("building")}>
              <option value="">Tất cả toà nhà</option>
              {buildings.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
            </select>
          </label>
          <label>Loại phòng
            <select value={draft.group} onChange={set("group")}>
              <option value="">Tất cả</option>
              {groups.map((g) => <option key={g}>{g}</option>)}
            </select>
          </label>
          <label>Ngân sách / tháng
            <select value={draft.price} onChange={set("price")}>
              {PRICES.map(([k, l]) => <option key={k} value={k}>{l}</option>)}
            </select>
          </label>
          {hasNight ? (
            <label>Thuê theo
              <select value={draft.mode} onChange={set("mode")}>
                <option value="">Tháng hoặc đêm</option><option value="thang">Theo tháng</option><option value="dem">Theo đêm</option>
              </select>
            </label>
          ) : null}
          <button type="submit">Tìm phòng</button>
        </form>
      </section>

      {err ? <div className="web-wrap web-sec"><div className="web-err" role="alert">{err}</div></div> : null}

      {features.length ? (
        <section className="web-wrap web-sec" aria-labelledby="kham-pha">
          <h2 id="kham-pha">Khám phá mới</h2>
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

      <section id="toa" className="web-wrap web-sec" aria-labelledby="toa-h">
        <div className="web-sec-head">
          <h2 id="toa-h">Toà nhà đang có phòng trống</h2>
          {f.building ? <button type="button" className="web-pill" onClick={() => apply({ ...f, building: "" })}>Xem tất cả toà</button> : null}
        </div>
        <div className="web-grid sm">
          {buildings.map((b, i) => (
            <button key={b.id} type="button" className="web-bcard" aria-pressed={f.building === b.id} onClick={() => apply({ ...f, building: b.id })}>
              <div className="web-ph">{buildingUrls[i] ? <img src={buildingUrls[i]!} alt="" /> : WebIcon.photo(36)}</div>
              <h3>{b.name}</h3>
              <span className="web-muted" style={{ fontSize: 14 }}>{shortAddr(b.address)}</span>
              <span style={{ fontSize: 15 }}><b style={{ color: "var(--web-green)" }}>từ {trieu(b.min)}</b> · {b.n} phòng trống</span>
            </button>
          ))}
        </div>
      </section>

      <section id="phong" className="web-wrap web-sec" aria-labelledby="phong-h" style={{ scrollMarginTop: 12 }}>
        <div className="web-sec-head">
          <div>
            <h2 id="phong-h">Phòng đang trống</h2>
            <p className="web-muted" style={{ margin: "4px 0 0" }}>{rooms ? `${list.length} phòng${list.length !== rooms.length ? ` (trong ${rooms.length})` : ""}` : "Đang tải…"} · sale đổi trạng thái trong app là trang này đổi theo.</p>
          </div>
          <label className="web-muted" style={{ fontSize: 14, display: "flex", gap: 8, alignItems: "center" }}>Sắp xếp
            <select className="web-chip" value={sort} onChange={(e) => setSort(e.target.value as "gia" | "toa")}><option value="gia">Giá thấp đến cao</option><option value="toa">Theo toà</option></select>
          </label>
        </div>
        <div className="web-chips" role="group" aria-label="Lọc loại phòng">
          <button type="button" className="web-chip" aria-pressed={!f.group} onClick={() => apply({ ...f, group: "" })}>Tất cả</button>
          {groups.map((g) => <button key={g} type="button" className="web-chip" aria-pressed={f.group === g} onClick={() => apply({ ...f, group: g })}>{g}</button>)}
        </div>
        {rooms && !list.length ? <div className="web-empty">Chưa có phòng hợp bộ lọc này. Thử bỏ bớt điều kiện{zalo ? ", hoặc nhắn Zalo để sale tìm giúp" : ""}.</div> : null}
        <div className="web-grid">
          {list.map((r, i) => (
            <Link key={r.room_id} className="web-room" to={`/phong/${r.room_id}${window.location.search}`}>
              <div className="web-ph">{roomUrls[i] ? <img src={roomUrls[i]!} alt="" loading="lazy" /> : WebIcon.photo(40)}<span className="badge">Trống ngay</span></div>
              <div className="body">
                <h3>{r.type_name}</h3>
                <span className="web-muted" style={{ fontSize: 15 }}>{r.building_name}{r.floor != null ? ` · ${floorText(r.floor)}` : ""}</span>
                <span className="web-price" style={{ marginTop: 6 }}>{vnd(r.list_price)}<small>{perText(r.rent_mode)}</small></span>
              </div>
            </Link>
          ))}
        </div>
      </section>

      <section id="app" className="web-wrap web-sec">
        <div className="web-app">
          <div style={{ flex: "1 1 420px", display: "flex", flexDirection: "column", gap: 12 }}>
            <span style={{ fontSize: 13, fontWeight: 800, letterSpacing: 1.5, textTransform: "uppercase", color: "var(--web-green)" }}>App người thuê Next Living</span>
            <h2>Thuê xong là có tài khoản app.</h2>
            <ul>
              <li>Xem hoá đơn, số điện, tiền nước từng tháng</li>
              <li>Đăng ký người ở cùng</li>
              <li>Gửi phản ánh, sự cố cho quản lý toà</li>
            </ul>
            <a className="web-pill solid" href="/" style={{ alignSelf: "flex-start" }}>Đăng nhập app</a>
          </div>
        </div>
      </section>

      <section id="thuong-hieu" className="web-wrap web-sec" aria-labelledby="th-h">
        <h2 id="th-h">Hệ thương hiệu Next Vision</h2>
        <div className="web-grid">
          <div className="web-brand"><b style={{ color: "var(--web-green)" }}>Next Living</b><span className="web-muted">Phòng ở, căn hộ dịch vụ thuê theo tháng.</span></div>
          <div className="web-brand"><b style={{ color: "var(--soon)" }}>Next Hub</b><span className="web-muted">Văn phòng cho thuê, phòng livestream.</span></div>
          <div className="web-brand"><b style={{ color: "var(--web-title)" }}>Next Stay</b><span className="web-muted">Khách sạn, lưu trú ngắn ngày.</span></div>
        </div>
      </section>

      <WebFooter />
      {zalo ? <a className="web-fab" href={zalo} target="_blank" rel="noopener" aria-label="Chat Zalo với Next Living">{WebIcon.chat}</a> : null}
    </div>
  );
}
const EMPTY: Filter = { building: "", group: "", price: "", mode: "" };
