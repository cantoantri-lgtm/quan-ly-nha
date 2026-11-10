import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { LngLatBounds, Map as MLMap, Marker, NavigationControl, Popup, setWorkerUrl } from "maplibre-gl";
import workerUrl from "maplibre-gl/dist/maplibre-gl-worker.mjs?url";
import "maplibre-gl/dist/maplibre-gl.css";
import "../map.css";
import { friendlyError, supabase } from "../lib/supabase";
import { useSession } from "../lib/session";
import { KIND_LABEL } from "../lib/labels";
import { naturalCompare } from "../lib/money";
import { DEFAULT_CENTER, currentPosition, fmtLatLng, googleDirections, googlePlace, parseLatLng, round6, type LatLng } from "../lib/geo";
import { Empty, TopBar } from "../components/ui";
import { r2Config, signedUrls } from "../lib/files";

setWorkerUrl(workerUrl);

// Bản đồ nền miễn phí OpenFreeMap (không cần khoá, được dùng cho doanh nghiệp). tile.openstreetmap.org bị mạng công ty chặn.
const darkMode = () => window.matchMedia?.("(prefers-color-scheme: dark)").matches;
const STYLE_URL = () => `https://tiles.openfreemap.org/styles/${darkMode() ? "dark" : "liberty"}`;

type Spot = {
  id: string; code: string; name: string; address: string | null; kind: string;
  lat: number | null; lng: number | null; total_rooms: number; vacant_rooms: number; can_open: boolean;
  /** Ảnh đại diện toà (có thể rỗng) */
  photo_path: string | null; photo_store: "supabase" | "r2" | null; photo_thumb: boolean | null;
};
type Located = Spot & { lat: number; lng: number };
type Placing = { spot: Spot; pos: LatLng | null };

const hasPos = (s: Spot): s is Located => s.lat != null && s.lng != null;
const ll = (p: LatLng): [number, number] => [p.lng, p.lat];
const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);

function pinEl(html: string, label: string) {
  const el = document.createElement("div");
  el.className = "pin-wrap";
  el.innerHTML = html;
  el.title = label;
  el.setAttribute("aria-label", label);
  return el;
}

/** Nhãn đường/địa danh: ưu tiên tên tiếng Việt */
function vietnameseLabels(map: MLMap) {
  for (const layer of map.getStyle()?.layers ?? []) {
    if (layer.type !== "symbol") continue;
    const tf = map.getLayoutProperty(layer.id, "text-field");
    if (tf && JSON.stringify(tf).includes('"name')) {
      map.setLayoutProperty(layer.id, "text-field", ["coalesce", ["get", "name:vi"], ["get", "name"], ["get", "name:latin"]]);
    }
  }
}

export default function MapPage() {
  const { isManager, reloadBase, toast } = useSession();
  const nav = useNavigate();
  const [params] = useSearchParams();
  const focusId = params.get("toa");
  const [spots, setSpots] = useState<Spot[]>([]);
  const [photos, setPhotos] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);
  const [mapErr, setMapErr] = useState<string | null>(null);
  const [mapReady, setMapReady] = useState(false);
  const [onlyVacant, setOnlyVacant] = useState(false);
  const [placing, setPlacing] = useState<Placing | null>(null);
  const [paste, setPaste] = useState("");
  const [placeErr, setPlaceErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [locating, setLocating] = useState(false);

  const box = useRef<HTMLDivElement>(null);
  const map = useRef<MLMap | null>(null);
  const markers = useRef<Record<string, Marker>>({});
  const draft = useRef<Marker | null>(null);
  const fitted = useRef(false);
  const placingRef = useRef<Placing | null>(null);
  placingRef.current = placing;

  const load = useCallback(async () => {
    const { data, error } = await supabase.rpc("building_map");
    if (error) setErr(friendlyError(error));
    else {
      const list = (data as Spot[]) ?? [];
      setErr(null); setSpots(list); setLoading(false);
      // Ảnh toà: R2 là địa chỉ công khai (Cộng tác viên cũng xem được); ảnh ở kho Supabase chỉ nhân viên xem được
      const withPhoto = list.filter((x) => x.photo_path);
      const urls: Record<string, string> = {};
      const r2 = withPhoto.filter((x) => x.photo_store === "r2");
      if (r2.length) {
        const cfg = await r2Config();
        if (cfg.publicBase) r2.forEach((x) => { urls[x.id] = `${cfg.publicBase}/${x.photo_thumb ? x.photo_path!.replace(/\.[a-z]+$/, "_t.jpg") : x.photo_path}`; });
      }
      const old = withPhoto.filter((x) => x.photo_store !== "r2");
      if (old.length) {
        const m = await signedUrls(old.map((x) => x.photo_path!));
        old.forEach((x) => { if (m[x.photo_path!]) urls[x.id] = m[x.photo_path!]; });
      }
      setPhotos(urls);
      return;
    }
    setLoading(false);
  }, []);
  useEffect(() => { load(); }, [load]);

  // Tạo bản đồ một lần
  useEffect(() => {
    const el = box.current;
    if (!el || map.current) return;
    let m: MLMap;
    try {
      m = new MLMap({
        container: el, style: STYLE_URL(), center: ll(DEFAULT_CENTER), zoom: 12,
        attributionControl: { compact: true }, dragRotate: false, pitchWithRotate: false, touchPitch: false,
      });
    } catch {
      setMapErr("Máy này không vẽ được bản đồ (trình duyệt không hỗ trợ WebGL).");
      return;
    }
    m.touchZoomRotate.disableRotation();
    m.addControl(new NavigationControl({ showCompass: false }), "bottom-right");
    m.on("style.load", () => { vietnameseLabels(m); });
    m.on("load", () => setMapReady(true));
    m.on("error", (e) => { if (!m.isStyleLoaded()) setMapErr("Không tải được bản đồ nền. Kiểm tra mạng rồi mở lại trang."); console.warn("[map]", e.error); });
    m.on("click", (e) => {
      const cur = placingRef.current;
      if (cur) setPlacing({ ...cur, pos: { lat: round6(e.lngLat.lat), lng: round6(e.lngLat.lng) } });
    });
    map.current = m;
    return () => { m.remove(); map.current = null; draft.current = null; markers.current = {}; };
  }, []);

  const located = useMemo(() => spots.filter(hasPos), [spots]);

  const startPlacing = useCallback((s: Spot) => {
    setPlaceErr(null); setPaste("");
    setPlacing({ spot: s, pos: hasPos(s) ? { lat: s.lat, lng: s.lng } : null });
    Object.values(markers.current).forEach((mk) => mk.getPopup()?.remove());
    if (hasPos(s)) map.current?.jumpTo({ center: ll(s), zoom: 17 });
    window.scrollTo({ top: 0, behavior: "smooth" });
  }, []);

  const popupEl = useCallback((s: Located) => {
    const el = document.createElement("div");
    el.className = "map-pop";
    el.innerHTML =
      (photos[s.id] ? `<img class="mp-photo" src="${esc(photos[s.id])}" alt="Ảnh toà ${esc(s.name)}" loading="lazy" decoding="async">` : "") +
      `<b class="mp-name">${esc(s.name)}</b>` +
      `<span class="mp-sub">${esc(s.code)} · ${esc(KIND_LABEL[s.kind] ?? s.kind)}${s.address ? ` · ${esc(s.address)}` : ""}</span>` +
      `<span class="mp-vacant ${s.vacant_rooms > 0 ? "ok" : "zero"}"><b class="num">${s.vacant_rooms}</b> phòng trống <span class="mp-of">/ ${s.total_rooms} phòng</span></span>`;
    const act = document.createElement("div");
    act.className = "mp-actions";
    const link = (cls: string, href: string, text: string) => {
      const a = document.createElement("a");
      a.className = cls; a.href = href; a.target = "_blank"; a.rel = "noopener"; a.textContent = text;
      act.append(a);
    };
    const btn = (cls: string, text: string, fn: () => void) => {
      const b = document.createElement("button");
      b.type = "button"; b.className = cls; b.textContent = text; b.onclick = fn;
      act.append(b);
    };
    link("btn sm", googleDirections(s), "Chỉ đường");
    if (s.can_open) btn("btn secondary sm", "Xem toà", () => nav(`/toa/${s.id}`));
    if (!s.can_open) btn("btn secondary sm", "Xem phòng trống", () => nav(`/phong-trong?toa=${s.id}`));
    link("btn ghost sm", googlePlace(s), "Google Maps");
    if (isManager) btn("btn ghost sm", "Sửa vị trí", () => startPlacing(s));
    el.append(act);
    return el;
  }, [isManager, nav, startPlacing, photos]);

  // Vẽ ghim tất cả toà (số trên ghim = số phòng trống)
  useEffect(() => {
    const m = map.current;
    if (!m || !mapReady) return;
    Object.values(markers.current).forEach((mk) => mk.remove());
    markers.current = {};
    located.filter((s) => !onlyVacant || s.vacant_rooms > 0).forEach((s) => {
      const el = pinEl(
        `<div class="pin ${s.vacant_rooms > 0 ? "ok" : "zero"}"><b>${s.vacant_rooms}</b></div><span class="pin-code">${esc(s.code)}</span>`,
        `${s.name}: ${s.vacant_rooms} phòng trống`);
      const popup = new Popup({ offset: 42, maxWidth: "290px", focusAfterOpen: false, anchor: "bottom" }).setDOMContent(popupEl(s));
      // Mở khung thông tin: dời bản đồ để ghim nằm dưới giữa, khung hiện trọn phía trên
      popup.on("open", () => m.easeTo({ center: ll(s), offset: [0, Math.min(140, m.getContainer().clientHeight / 2 - 40)], duration: 250 }));
      markers.current[s.id] = new Marker({ element: el, anchor: "bottom" }).setLngLat(ll(s)).setPopup(popup).addTo(m);
    });
    if (!fitted.current && !loading) {
      fitted.current = true;
      const f = focusId ? located.find((s) => s.id === focusId) : undefined;
      if (f) { m.jumpTo({ center: ll(f), zoom: 16 }); markers.current[f.id]?.togglePopup(); }
      else if (located.length === 1) m.jumpTo({ center: ll(located[0]), zoom: 15 });
      else if (located.length > 1) {
        const b = new LngLatBounds();
        located.forEach((s) => b.extend(ll(s)));
        m.fitBounds(b, { padding: 60, maxZoom: 16, duration: 0 });
      }
      // Mở từ trang toà chưa có vị trí → Quản lý đặt vị trí luôn
      const unplaced = focusId && !f ? spots.find((s) => s.id === focusId) : undefined;
      if (unplaced && isManager) startPlacing(unplaced);
    }
  }, [mapReady, located, onlyVacant, popupEl, loading, focusId, spots, isManager, startPlacing]);

  // Ghim đỏ tạm khi Quản lý đang đặt vị trí (kéo được)
  useEffect(() => {
    const m = map.current;
    if (!m || !mapReady) return;
    const pos = placing?.pos;
    if (!pos) { draft.current?.remove(); draft.current = null; return; }
    if (!draft.current) {
      const d = new Marker({ element: pinEl(`<div class="pin draft"><b>+</b></div>`, "Vị trí đang chọn"), anchor: "bottom", draggable: true })
        .setLngLat(ll(pos)).addTo(m);
      d.on("dragend", () => {
        const p = d.getLngLat();
        setPlacing((cur) => (cur ? { ...cur, pos: { lat: round6(p.lat), lng: round6(p.lng) } } : cur));
      });
      draft.current = d;
    } else draft.current.setLngLat(ll(pos));
  }, [mapReady, placing?.pos]);

  function setPosAndShow(p: LatLng) {
    setPlacing((cur) => (cur ? { ...cur, pos: p } : cur));
    map.current?.jumpTo({ center: ll(p), zoom: 17 });
  }

  function applyPasted() {
    const r = parseLatLng(paste);
    if (!r) return;
    if ("error" in r) { setPlaceErr(r.error); return; }
    setPlaceErr(null);
    setPosAndShow(r);
  }

  async function locateMe() {
    setPlaceErr(null); setLocating(true);
    try { setPosAndShow(await currentPosition()); } catch (e) { setPlaceErr((e as Error).message); }
    setLocating(false);
  }

  async function savePos(pos: LatLng | null) {
    if (!placing) return;
    setBusy(true);
    const { data, error } = await supabase.from("buildings")
      .update({ lat: pos?.lat ?? null, lng: pos?.lng ?? null }).eq("id", placing.spot.id).select("id");
    setBusy(false);
    if (error || !data?.length) { setPlaceErr(error ? friendlyError(error) : "Bạn không có quyền sửa vị trí toà này."); return; }
    toast(pos ? `Đã lưu vị trí ${placing.spot.code}.` : `Đã xoá vị trí ${placing.spot.code}.`);
    setPlacing(null);
    await load();
    reloadBase();
  }

  function focus(s: Spot) {
    const m = map.current;
    if (hasPos(s) && m && !mapErr) {
      if (onlyVacant && s.vacant_rooms === 0) setOnlyVacant(false);
      m.jumpTo({ center: ll(s), zoom: 16 });
      window.scrollTo({ top: 0, behavior: "smooth" });
      setTimeout(() => { const mk = markers.current[s.id]; if (mk && !mk.getPopup()?.isOpen()) mk.togglePopup(); }, 60);
    } else if (hasPos(s)) window.open(googlePlace(s), "_blank", "noopener");
    else if (isManager) startPlacing(s);
    else if (s.can_open) nav(`/toa/${s.id}`);
    else nav(`/phong-trong?toa=${s.id}`);
  }

  const totalVacant = spots.reduce((n, s) => n + s.vacant_rooms, 0);
  const missing = spots.length - located.length;
  const list = useMemo(() => [...spots]
    .filter((s) => !onlyVacant || s.vacant_rooms > 0)
    .sort((a, b) => b.vacant_rooms - a.vacant_rooms || naturalCompare(a.code, b.code)), [spots, onlyVacant]);

  return (
    <>
      <TopBar title="Bản đồ toà nhà" />
      <main className="main stack">
        <div className="row">
          <span className="small"><b className="num">{spots.length}</b> toà · <b className="num">{totalVacant}</b> phòng trống</span>
          <span className="spacer" />
          <button className="chip" aria-pressed={onlyVacant} onClick={() => setOnlyVacant(!onlyVacant)}>Chỉ toà còn trống</button>
        </div>

        <div className={`map-box${placing ? " placing" : ""}${mapErr ? " failed" : ""}`}>
          <div ref={box} className="map-canvas" role="region" aria-label="Bản đồ các toà nhà" />
          {mapErr ? (
            <div className="map-msg" role="alert"><b>Không hiện được bản đồ</b><span>{mapErr}</span>
              <span className="muted">Bấm vào toà bên dưới để mở trên Google Maps.</span></div>
          ) : !mapReady ? <div className="map-msg"><span className="muted">Đang tải bản đồ…</span></div> : null}
        </div>

        {err ? <div className="error-box" role="alert">{err}</div> : null}
        {!loading && spots.length > 0 && located.length === 0 ? (
          <p className="muted small" style={{ margin: 0 }}>
            Chưa toà nào có vị trí. {isManager ? "Bấm vào từng toà bên dưới để đặt vị trí, hoặc nhập Lat/Long trong Quản trị → Toà nhà." : "Quản lý sẽ đặt vị trí cho các toà."}
          </p>
        ) : null}

        {loading ? <div className="loading">Đang tải…</div> : spots.length === 0 ? (
          <Empty title="Chưa có toà nhà nào" />
        ) : (
          <section className="card">
            {list.map((s) => (
              <div key={s.id} className="list-row" role="button" tabIndex={0} onClick={() => focus(s)} onKeyDown={(e) => e.key === "Enter" && focus(s)}>
                {photos[s.id] ? <img className="list-photo" src={photos[s.id]} alt="" loading="lazy" decoding="async" /> : null}
                <span className="tag" style={{ fontSize: 13 }}>{s.code}</span>
                <div className="grow">
                  <div className="name">{s.name}</div>
                  <div className="sub">
                    {hasPos(s) ? (s.address || KIND_LABEL[s.kind]) : <span style={{ color: "var(--today)" }}>Chưa có vị trí{isManager ? " · bấm để đặt" : ""}</span>}
                  </div>
                </div>
                <span className="small num" style={{ textAlign: "right", whiteSpace: "nowrap" }}>
                  <b style={{ color: s.vacant_rooms > 0 ? "var(--s-done)" : "var(--muted)", fontSize: 16 }}>{s.vacant_rooms}</b> trống
                  <br /><span className="muted">/ {s.total_rooms} phòng</span>
                </span>
              </div>
            ))}
          </section>
        )}
        {isManager && missing > 0 && located.length > 0 ? (
          <p className="muted small" style={{ margin: 0 }}>{missing} toà chưa có vị trí — bấm vào toà để đặt.</p>
        ) : null}
        <p className="muted small" style={{ margin: 0 }}>Số trên ghim là số phòng trống. Bấm ghim để xem tên toà và chỉ đường bằng Google Maps.</p>
        {placing ? <div style={{ height: 190 }} aria-hidden="true" /> : null}
      </main>

      {placing ? (
        <div className="savebar">
          <div className="in place-bar">
            <div>
              <b>Vị trí toà {placing.spot.code}</b>
              <div className="small muted">
                {placing.pos ? <>Ghim đỏ: <span className="num">{fmtLatLng(placing.pos)}</span> · kéo ghim hoặc chạm chỗ khác để chỉnh</> : "Chạm vào bản đồ đúng chỗ toà nhà, hoặc dán toạ độ bên dưới."}
              </div>
            </div>
            <div className="row" style={{ flexWrap: "nowrap" }}>
              <input id="map-paste" className="input" value={paste} onChange={(e) => setPaste(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && applyPasted()} placeholder="Dán toạ độ hoặc link Google Maps" />
              <button className="btn secondary sm" onClick={applyPasted} disabled={!paste.trim()}>Dùng</button>
            </div>
            {placeErr ? <div className="error-box" role="alert">{placeErr}</div> : null}
            <div className="row">
              <button className="btn ghost sm" onClick={locateMe} disabled={locating}>{locating ? "Đang lấy vị trí…" : "Vị trí của tôi"}</button>
              {hasPos(placing.spot) ? <button className="btn ghost sm" style={{ color: "var(--danger)" }} disabled={busy} onClick={() => savePos(null)}>Xoá vị trí</button> : null}
              <span className="spacer" />
              <button className="btn ghost sm" onClick={() => setPlacing(null)}>Huỷ</button>
              <button className="btn sm" disabled={!placing.pos || busy} onClick={() => savePos(placing.pos)}>{busy ? "Đang lưu…" : "Lưu vị trí"}</button>
            </div>
          </div>
        </div>
      ) : null}
    </>
  );
}
