/// <reference types="google.maps" />
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import "../map.css";
import { friendlyError, supabase } from "../lib/supabase";
import { useSession } from "../lib/session";
import { KIND_LABEL } from "../lib/labels";
import { naturalCompare } from "../lib/money";
import { DEFAULT_CENTER, currentPosition, fmtLatLng, googleDirections, parseLatLng, round6, type LatLng } from "../lib/geo";
import { GOOGLE_MAPS_KEY, loadGoogleMaps, onMapsAuthFailure } from "../lib/gmaps";
import { Empty, TopBar } from "../components/ui";

type Spot = {
  id: string; code: string; name: string; address: string | null; kind: string;
  lat: number | null; lng: number | null; total_rooms: number; vacant_rooms: number; can_open: boolean;
};
type Located = Spot & { lat: number; lng: number };
type Placing = { spot: Spot; pos: LatLng | null };

/** Ghim HTML vẽ trên Google Maps (giữ kiểu ghim có số phòng trống của app) */
type HtmlPin = google.maps.OverlayView & { setPos(p: LatLng): void; el: HTMLDivElement };
type PinCtor = new (pos: LatLng, html: string, label: string, onClick: (() => void) | null) => HtmlPin;

function makePinClass(g: typeof google.maps): PinCtor {
  return class Pin extends g.OverlayView {
    el: HTMLDivElement;
    pos: LatLng;
    constructor(pos: LatLng, html: string, label: string, onClick: (() => void) | null) {
      super();
      this.pos = pos;
      this.el = document.createElement("div");
      this.el.className = "pin-wrap";
      this.el.innerHTML = html;
      this.el.setAttribute("aria-label", label);
      this.el.title = label;
      if (onClick) {
        this.el.setAttribute("role", "button");
        this.el.tabIndex = 0;
        this.el.addEventListener("click", onClick);
        this.el.addEventListener("keydown", (e) => { if (e.key === "Enter") onClick(); });
      }
    }
    onAdd() {
      g.OverlayView.preventMapHitsAndGesturesFrom(this.el); // bấm ghim không tính là bấm bản đồ
      this.getPanes()?.overlayMouseTarget.appendChild(this.el);
    }
    draw() {
      const p = this.getProjection()?.fromLatLngToDivPixel(new g.LatLng(this.pos.lat, this.pos.lng));
      if (p) { this.el.style.left = `${p.x}px`; this.el.style.top = `${p.y}px`; }
    }
    onRemove() { this.el.remove(); }
    setPos(p: LatLng) { this.pos = p; this.draw(); }
  };
}

const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);
const hasPos = (s: Spot): s is Located => s.lat != null && s.lng != null;
const pinHtml = (s: Spot) =>
  `<div class="pin ${s.vacant_rooms > 0 ? "ok" : "zero"}"><b>${s.vacant_rooms}</b></div><span class="pin-code">${esc(s.code)}</span>`;
const DRAFT_HTML = `<div class="pin draft"><b>+</b></div>`;

export default function MapPage() {
  const { isManager, reloadBase, toast } = useSession();
  const nav = useNavigate();
  const [params] = useSearchParams();
  const focusId = params.get("toa");
  const [spots, setSpots] = useState<Spot[]>([]);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);
  const [mapErr, setMapErr] = useState<string | null>(GOOGLE_MAPS_KEY ? null : "Chưa cấu hình khoá Google Maps cho app.");
  const [mapReady, setMapReady] = useState(false);
  const [onlyVacant, setOnlyVacant] = useState(false);
  const [placing, setPlacing] = useState<Placing | null>(null);
  const [paste, setPaste] = useState("");
  const [placeErr, setPlaceErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const box = useRef<HTMLDivElement>(null);
  const gref = useRef<typeof google.maps | null>(null);
  const Pin = useRef<PinCtor | null>(null);
  const map = useRef<google.maps.Map | null>(null);
  const info = useRef<google.maps.InfoWindow | null>(null);
  const pins = useRef<Record<string, HtmlPin>>({});
  const draft = useRef<HtmlPin | null>(null);
  const fitted = useRef(false);
  const placingRef = useRef<Placing | null>(null);
  placingRef.current = placing;

  const load = useCallback(async () => {
    const { data, error } = await supabase.rpc("building_map");
    if (error) setErr(friendlyError(error));
    else { setErr(null); setSpots((data as Spot[]) ?? []); }
    setLoading(false);
  }, []);
  useEffect(() => { load(); }, [load]);

  // Tải Google Maps và tạo bản đồ một lần
  useEffect(() => {
    if (!GOOGLE_MAPS_KEY) return;
    let alive = true;
    const off = onMapsAuthFailure(() => alive && setMapErr(
      "Google Maps từ chối khoá: khoá sai, chưa bật Maps JavaScript API, chưa gắn thanh toán, hoặc địa chỉ trang này chưa được thêm vào danh sách Websites của khoá."));
    loadGoogleMaps().then((g) => {
      if (!alive || !box.current) return;
      gref.current = g;
      Pin.current = makePinClass(g);
      const m = new g.Map(box.current, {
        center: DEFAULT_CENTER, zoom: 12,
        mapTypeControl: false, streetViewControl: false, fullscreenControl: true,
        clickableIcons: false, gestureHandling: "greedy",
      });
      info.current = new g.InfoWindow({ pixelOffset: new g.Size(0, -44), maxWidth: 280 });
      m.addListener("click", (e: google.maps.MapMouseEvent) => {
        const cur = placingRef.current;
        if (cur && e.latLng) setPlacing({ ...cur, pos: { lat: round6(e.latLng.lat()), lng: round6(e.latLng.lng()) } });
      });
      map.current = m;
      setMapReady(true);
    }).catch((e: Error) => alive && setMapErr(e.message));
    return () => { alive = false; off(); };
  }, []);

  const located = useMemo(() => spots.filter(hasPos), [spots]);

  const startPlacing = useCallback((s: Spot) => {
    setPlaceErr(null); setPaste("");
    setPlacing({ spot: s, pos: hasPos(s) ? { lat: s.lat, lng: s.lng } : null });
    info.current?.close();
    if (hasPos(s) && map.current) { map.current.setCenter(s); map.current.setZoom(18); }
    window.scrollTo({ top: 0, behavior: "smooth" });
  }, []);

  const popupEl = useCallback((s: Located) => {
    const el = document.createElement("div");
    el.className = "map-pop";
    el.innerHTML =
      `<b class="mp-name">${esc(s.name)}</b>` +
      `<span class="mp-sub">${esc(s.code)} · ${esc(KIND_LABEL[s.kind] ?? s.kind)}${s.address ? ` · ${esc(s.address)}` : ""}</span>` +
      `<span class="mp-vacant ${s.vacant_rooms > 0 ? "ok" : "zero"}"><b class="num">${s.vacant_rooms}</b> phòng trống <span class="mp-of">/ ${s.total_rooms} phòng</span></span>`;
    const act = document.createElement("div");
    act.className = "mp-actions";
    const dir = document.createElement("a");
    dir.className = "btn sm"; dir.href = googleDirections(s); dir.target = "_blank"; dir.rel = "noopener"; dir.textContent = "Chỉ đường";
    act.append(dir);
    if (s.can_open) {
      const open = document.createElement("button");
      open.type = "button"; open.className = "btn secondary sm"; open.textContent = "Xem toà";
      open.onclick = () => nav(`/toa/${s.id}`);
      act.append(open);
    }
    if (isManager) {
      const mv = document.createElement("button");
      mv.type = "button"; mv.className = "btn ghost sm"; mv.textContent = "Sửa vị trí";
      mv.onclick = () => startPlacing(s);
      act.append(mv);
    }
    el.append(act);
    return el;
  }, [isManager, nav, startPlacing]);

  const openInfo = useCallback((s: Located) => {
    if (!map.current || !info.current) return;
    info.current.setContent(popupEl(s));
    info.current.setPosition(s);
    info.current.open({ map: map.current });
  }, [popupEl]);

  // Vẽ ghim các toà
  useEffect(() => {
    const m = map.current, P = Pin.current, g = gref.current;
    if (!mapReady || !m || !P || !g) return;
    Object.values(pins.current).forEach((p) => p.setMap(null));
    pins.current = {};
    located.filter((s) => !onlyVacant || s.vacant_rooms > 0).forEach((s) => {
      const p = new P(s, pinHtml(s), `${s.name}: ${s.vacant_rooms} phòng trống`, () => openInfo(s));
      p.setMap(m);
      pins.current[s.id] = p;
    });
    if (!fitted.current && !loading) {
      fitted.current = true;
      const f = focusId ? located.find((s) => s.id === focusId) : undefined;
      if (f) { m.setCenter(f); m.setZoom(16); openInfo(f); }
      else if (located.length === 1) { m.setCenter(located[0]); m.setZoom(15); }
      else if (located.length > 1) {
        const b = new g.LatLngBounds();
        located.forEach((s) => b.extend(s));
        m.fitBounds(b, 48);
        g.event.addListenerOnce(m, "idle", () => { if ((m.getZoom() ?? 0) > 16) m.setZoom(16); });
      }
      // Mở từ trang toà chưa có vị trí → Quản lý đặt vị trí luôn
      const unplaced = focusId && !f ? spots.find((s) => s.id === focusId) : undefined;
      if (unplaced && isManager) startPlacing(unplaced);
    }
  }, [mapReady, located, onlyVacant, openInfo, loading, focusId, spots, isManager, startPlacing]);

  // Ghim đỏ tạm khi Quản lý đang đặt vị trí
  useEffect(() => {
    const m = map.current, P = Pin.current;
    if (!mapReady || !m || !P) return;
    const pos = placing?.pos;
    if (!pos) { draft.current?.setMap(null); draft.current = null; return; }
    if (!draft.current) { draft.current = new P(pos, DRAFT_HTML, "Vị trí đang chọn", null); draft.current.setMap(m); }
    else draft.current.setPos(pos);
  }, [mapReady, placing?.pos]);

  function setPosAndShow(p: LatLng) {
    setPlacing((cur) => (cur ? { ...cur, pos: p } : cur));
    if (map.current) { map.current.setCenter(p); map.current.setZoom(18); }
  }

  function applyPasted() {
    const r = parseLatLng(paste);
    if (!r) return;
    if ("error" in r) { setPlaceErr(r.error); return; }
    setPlaceErr(null);
    setPosAndShow(r);
  }

  async function locateMe() {
    setPlaceErr(null);
    try { setPosAndShow(await currentPosition()); } catch (e) { setPlaceErr((e as Error).message); }
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
    if (hasPos(s) && map.current) {
      if (onlyVacant && s.vacant_rooms === 0) setOnlyVacant(false);
      map.current.setCenter(s);
      map.current.setZoom(16);
      window.scrollTo({ top: 0, behavior: "smooth" });
      openInfo(s);
    } else if (isManager && !mapErr) startPlacing(s);
    else if (s.can_open) nav(`/toa/${s.id}`);
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
            <div className="map-msg" role="alert">
              <b>Không mở được Google Maps</b>
              <span>{mapErr}</span>
              <span className="muted">Danh sách toà và nút Chỉ đường bên dưới vẫn dùng được.</span>
            </div>
          ) : !mapReady ? <div className="map-msg"><span className="muted">Đang tải Google Maps…</span></div> : null}
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
                <span className="tag" style={{ fontSize: 13 }}>{s.code}</span>
                <div className="grow">
                  <div className="name">{s.name}</div>
                  <div className="sub">
                    {hasPos(s) ? (s.address || KIND_LABEL[s.kind]) : <span style={{ color: "var(--today)" }}>Chưa có vị trí{isManager ? " · bấm để đặt" : ""}</span>}
                  </div>
                  {hasPos(s) && mapErr ? (
                    <a className="small" href={googleDirections(s)} target="_blank" rel="noopener" onClick={(e) => e.stopPropagation()}>Chỉ đường</a>
                  ) : null}
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
        <p className="muted small" style={{ margin: 0 }}>Số phòng trống tính theo trạng thái phòng "Trống" trong từng toà.</p>
        {placing ? <div style={{ height: 190 }} aria-hidden="true" /> : null}
      </main>

      {placing ? (
        <div className="savebar">
          <div className="in place-bar">
            <div>
              <b>Vị trí toà {placing.spot.code}</b>
              <div className="small muted">
                {placing.pos ? <>Ghim đỏ: <span className="num">{fmtLatLng(placing.pos)}</span> · chạm chỗ khác để chỉnh</> : "Chạm vào bản đồ đúng chỗ toà nhà, hoặc dán toạ độ bên dưới."}
              </div>
            </div>
            <div className="row" style={{ flexWrap: "nowrap" }}>
              <input id="map-paste" className="input" value={paste} onChange={(e) => setPaste(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && applyPasted()} placeholder="Dán toạ độ hoặc link Google Maps" />
              <button className="btn secondary sm" onClick={applyPasted} disabled={!paste.trim()}>Dùng</button>
            </div>
            {placeErr ? <div className="error-box" role="alert">{placeErr}</div> : null}
            <div className="row">
              <button className="btn ghost sm" onClick={locateMe}>Vị trí của tôi</button>
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
