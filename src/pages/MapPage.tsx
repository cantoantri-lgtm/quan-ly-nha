import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import L from "leaflet";
import "leaflet/dist/leaflet.css";
import "../map.css";
import { friendlyError, supabase } from "../lib/supabase";
import { useSession } from "../lib/session";
import { KIND_LABEL } from "../lib/labels";
import { naturalCompare } from "../lib/money";
import { DEFAULT_CENTER, currentPosition, fmtLatLng, googleDirections, parseLatLng, round6, type LatLng } from "../lib/geo";
import { Empty, TopBar } from "../components/ui";

type Spot = {
  id: string; code: string; name: string; address: string | null; kind: string;
  lat: number | null; lng: number | null; total_rooms: number; vacant_rooms: number; can_open: boolean;
};
type Placing = { spot: Spot; pos: LatLng | null };

const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);
const hasPos = (s: Spot): s is Spot & { lat: number; lng: number } => s.lat != null && s.lng != null;

const pinIcon = (s: Spot) => L.divIcon({
  className: "pin-wrap",
  html: `<div class="pin ${s.vacant_rooms > 0 ? "ok" : "zero"}"><b>${s.vacant_rooms}</b></div><span class="pin-code">${esc(s.code)}</span>`,
  iconSize: [44, 44], iconAnchor: [22, 44], popupAnchor: [0, -40],
});
const draftIcon = L.divIcon({ className: "pin-wrap", html: `<div class="pin draft"><b>+</b></div>`, iconSize: [44, 44], iconAnchor: [22, 44] });

export default function MapPage() {
  const { isManager, reloadBase, toast } = useSession();
  const nav = useNavigate();
  const [params] = useSearchParams();
  const focusId = params.get("toa");
  const [spots, setSpots] = useState<Spot[]>([]);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);
  const [onlyVacant, setOnlyVacant] = useState(false);
  const [placing, setPlacing] = useState<Placing | null>(null);
  const [paste, setPaste] = useState("");
  const [placeErr, setPlaceErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const box = useRef<HTMLDivElement>(null);
  const map = useRef<L.Map | null>(null);
  const layer = useRef<L.LayerGroup | null>(null);
  const markers = useRef<Record<string, L.Marker>>({});
  const draft = useRef<L.Marker | null>(null);
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

  // Tạo bản đồ một lần
  useEffect(() => {
    const el = box.current;
    if (!el || map.current) return;
    const m = L.map(el, { center: [DEFAULT_CENTER.lat, DEFAULT_CENTER.lng], zoom: 12, zoomControl: false });
    L.control.zoom({ position: "bottomright", zoomInTitle: "Phóng to", zoomOutTitle: "Thu nhỏ" }).addTo(m);
    m.attributionControl.setPrefix(false);
    L.tileLayer("https://tile.openstreetmap.org/{z}/{x}/{y}.png", {
      maxZoom: 19,
      attribution: '© <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener">OpenStreetMap</a>',
    }).addTo(m);
    layer.current = L.layerGroup().addTo(m);
    m.on("click", (e: L.LeafletMouseEvent) => {
      const cur = placingRef.current;
      if (cur) setPlacing({ ...cur, pos: { lat: round6(e.latlng.lat), lng: round6(e.latlng.lng) } });
    });
    map.current = m;
    const ro = new ResizeObserver(() => m.invalidateSize());
    ro.observe(el);
    return () => { ro.disconnect(); m.remove(); map.current = null; layer.current = null; draft.current = null; };
  }, []);

  const located = useMemo(() => spots.filter(hasPos), [spots]);

  const startPlacing = useCallback((s: Spot) => {
    setPlaceErr(null); setPaste("");
    setPlacing({ spot: s, pos: hasPos(s) ? { lat: s.lat, lng: s.lng } : null });
    map.current?.closePopup();
    if (hasPos(s)) map.current?.setView([s.lat, s.lng], 17);
    window.scrollTo({ top: 0, behavior: "smooth" });
  }, []);

  const popupEl = useCallback((s: Spot & { lat: number; lng: number }) => {
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

  // Vẽ ghim các toà
  useEffect(() => {
    const m = map.current, g = layer.current;
    if (!m || !g) return;
    g.clearLayers();
    markers.current = {};
    located.filter((s) => !onlyVacant || s.vacant_rooms > 0).forEach((s) => {
      const mk = L.marker([s.lat, s.lng], { icon: pinIcon(s), title: `${s.name}: ${s.vacant_rooms} phòng trống`, riseOnHover: true });
      mk.bindPopup(() => popupEl(s), { autoPanPadding: [16, 16], maxWidth: 280 });
      mk.addTo(g);
      markers.current[s.id] = mk;
    });
    if (!fitted.current && !loading) {
      fitted.current = true;
      const f = focusId ? located.find((s) => s.id === focusId) : undefined;
      if (f) { m.setView([f.lat, f.lng], 16); markers.current[f.id]?.openPopup(); }
      else if (located.length === 1) m.setView([located[0].lat, located[0].lng], 15);
      else if (located.length > 1) m.fitBounds(L.latLngBounds(located.map((s) => [s.lat, s.lng] as [number, number])), { padding: [40, 40], maxZoom: 15 });
      // Mở từ trang toà chưa có vị trí → Quản lý đặt vị trí luôn
      const unplaced = focusId && !f ? spots.find((s) => s.id === focusId) : undefined;
      if (unplaced && isManager) startPlacing(unplaced);
    }
  }, [located, onlyVacant, popupEl, loading, focusId, spots, isManager, startPlacing]);

  // Ghim tạm khi Quản lý đang đặt vị trí
  useEffect(() => {
    const m = map.current;
    if (!m) return;
    const pos = placing?.pos;
    if (!pos) { draft.current?.remove(); draft.current = null; return; }
    if (!draft.current) {
      const d = L.marker([pos.lat, pos.lng], { icon: draftIcon, draggable: true, zIndexOffset: 1000 }).addTo(m);
      d.on("dragend", () => {
        const p = d.getLatLng();
        setPlacing((cur) => (cur ? { ...cur, pos: { lat: round6(p.lat), lng: round6(p.lng) } } : cur));
      });
      draft.current = d;
    } else draft.current.setLatLng([pos.lat, pos.lng]);
  }, [placing?.pos]);

  function setPosAndShow(p: LatLng) {
    setPlacing((cur) => (cur ? { ...cur, pos: p } : cur));
    map.current?.setView([p.lat, p.lng], 17);
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
      map.current.setView([s.lat, s.lng], 16);
      window.scrollTo({ top: 0, behavior: "smooth" });
      setTimeout(() => markers.current[s.id]?.openPopup(), 50);
    } else if (isManager) startPlacing(s);
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

        <div className={`map-box${placing ? " placing" : ""}`} ref={box} role="region" aria-label="Bản đồ các toà nhà" />

        {err ? <div className="error-box" role="alert">{err}</div> : null}
        {!loading && spots.length > 0 && located.length === 0 ? (
          <p className="muted small" style={{ margin: 0 }}>
            Chưa toà nào có vị trí. {isManager ? "Bấm vào từng toà bên dưới để đặt vị trí." : "Quản lý sẽ đặt vị trí cho các toà."}
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
                {placing.pos ? <>Ghim đỏ: <span className="num">{fmtLatLng(placing.pos)}</span> · kéo ghim để chỉnh</> : "Chạm vào bản đồ đúng chỗ toà nhà, hoặc dán toạ độ bên dưới."}
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
