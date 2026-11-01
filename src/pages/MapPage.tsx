import { useCallback, useEffect, useMemo, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import "../map.css";
import { friendlyError, supabase } from "../lib/supabase";
import { useSession } from "../lib/session";
import { KIND_LABEL } from "../lib/labels";
import { naturalCompare } from "../lib/money";
import { currentPosition, fmtLatLng, googleDirections, googlePlace, parseLatLng, type LatLng } from "../lib/geo";
import { Empty, TopBar } from "../components/ui";

type Spot = {
  id: string; code: string; name: string; address: string | null; kind: string;
  lat: number | null; lng: number | null; total_rooms: number; vacant_rooms: number; can_open: boolean;
};
type Located = Spot & { lat: number; lng: number };
type Placing = { spot: Spot; pos: LatLng | null };

const hasPos = (s: Spot): s is Located => s.lat != null && s.lng != null;

/** Bản đồ Google nhúng miễn phí (không cần khoá API): hiện 1 vị trí kèm ghim đỏ */
const embedUrl = (p: LatLng, zoom = 17) =>
  `https://maps.google.com/maps?q=${p.lat},${p.lng}&z=${zoom}&hl=vi&output=embed`;

export default function MapPage() {
  const { isManager, reloadBase, toast } = useSession();
  const nav = useNavigate();
  const [params] = useSearchParams();
  const focusId = params.get("toa");
  const [spots, setSpots] = useState<Spot[]>([]);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);
  const [onlyVacant, setOnlyVacant] = useState(false);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [placing, setPlacing] = useState<Placing | null>(null);
  const [paste, setPaste] = useState("");
  const [placeErr, setPlaceErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [locating, setLocating] = useState(false);

  const load = useCallback(async () => {
    const { data, error } = await supabase.rpc("building_map");
    if (error) setErr(friendlyError(error));
    else { setErr(null); setSpots((data as Spot[]) ?? []); }
    setLoading(false);
  }, []);
  useEffect(() => { load(); }, [load]);

  const list = useMemo(() => [...spots]
    .filter((s) => !onlyVacant || s.vacant_rooms > 0)
    .sort((a, b) => b.vacant_rooms - a.vacant_rooms || naturalCompare(a.code, b.code)), [spots, onlyVacant]);

  const startPlacing = useCallback((s: Spot) => {
    setPlaceErr(null); setPaste("");
    setPlacing({ spot: s, pos: hasPos(s) ? { lat: s.lat, lng: s.lng } : null });
    window.scrollTo({ top: 0, behavior: "smooth" });
  }, []);

  // Chọn toà mặc định: toà mở từ trang toà (?toa=), nếu không thì toà còn nhiều phòng trống nhất có vị trí
  useEffect(() => {
    if (loading || selectedId) return;
    const f = focusId ? spots.find((s) => s.id === focusId) : undefined;
    if (f && hasPos(f)) { setSelectedId(f.id); return; }
    if (f && isManager) startPlacing(f);
    const first = [...spots].sort((a, b) => b.vacant_rooms - a.vacant_rooms || naturalCompare(a.code, b.code)).find(hasPos);
    if (first) setSelectedId(first.id);
  }, [loading, spots, focusId, selectedId, isManager, startPlacing]);

  const selected = spots.find((s) => s.id === selectedId);
  const shown: Located | undefined = selected && hasPos(selected) ? selected : undefined;
  // Đang đặt vị trí: bản đồ hiện vị trí sắp lưu để Quản lý kiểm tra
  const framePos: LatLng | null = placing ? placing.pos : shown ? { lat: shown.lat, lng: shown.lng } : null;

  function choose(s: Spot) {
    if (hasPos(s)) { setSelectedId(s.id); window.scrollTo({ top: 0, behavior: "smooth" }); }
    else if (isManager) startPlacing(s);
    else if (s.can_open) nav(`/toa/${s.id}`);
  }

  function applyPasted() {
    const r = parseLatLng(paste);
    if (!r) return;
    if ("error" in r) { setPlaceErr(r.error); return; }
    setPlaceErr(null);
    setPlacing((cur) => (cur ? { ...cur, pos: r } : cur));
  }

  async function locateMe() {
    setPlaceErr(null); setLocating(true);
    try { const p = await currentPosition(); setPlacing((cur) => (cur ? { ...cur, pos: p } : cur)); }
    catch (e) { setPlaceErr((e as Error).message); }
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
    if (pos) setSelectedId(placing.spot.id);
    setPlacing(null);
    await load();
    reloadBase();
  }

  const totalVacant = spots.reduce((n, s) => n + s.vacant_rooms, 0);
  const missing = spots.filter((s) => !hasPos(s)).length;

  return (
    <>
      <TopBar title="Bản đồ toà nhà" />
      <main className="main stack">
        <div className="row">
          <span className="small"><b className="num">{spots.length}</b> toà · <b className="num">{totalVacant}</b> phòng trống</span>
          <span className="spacer" />
          <button className="chip" aria-pressed={onlyVacant} onClick={() => setOnlyVacant(!onlyVacant)}>Chỉ toà còn trống</button>
        </div>

        {placing ? (
          <section className="card map-info placing-info">
            <b>Đặt vị trí toà {placing.spot.code}</b>
            <span className="small muted">{placing.pos ? <>Bản đồ dưới đây đang hiện vị trí sẽ lưu: <span className="num">{fmtLatLng(placing.pos)}</span></> : "Dán toạ độ / link Google Maps hoặc bấm Vị trí của tôi ở thanh bên dưới."}</span>
          </section>
        ) : shown ? (
          <section className="card map-info">
            <div className="mi-head">
              <div className="grow">
                <b className="mi-name">{shown.name}</b>
                <span className="small muted">{shown.code} · {KIND_LABEL[shown.kind] ?? shown.kind}{shown.address ? ` · ${shown.address}` : ""}</span>
              </div>
              <div className="mi-vacant num">
                <b style={{ color: shown.vacant_rooms > 0 ? "var(--s-done)" : "var(--muted)" }}>{shown.vacant_rooms}</b>
                <span className="small muted">trống / {shown.total_rooms}</span>
              </div>
            </div>
            <div className="row">
              <a className="btn sm" href={googleDirections(shown)} target="_blank" rel="noopener">Chỉ đường</a>
              {shown.can_open ? <button className="btn secondary sm" onClick={() => nav(`/toa/${shown.id}`)}>Xem toà</button> : null}
              <a className="btn ghost sm" href={googlePlace(shown)} target="_blank" rel="noopener">Mở Google Maps</a>
              {isManager ? <button className="btn ghost sm" onClick={() => startPlacing(shown)}>Sửa vị trí</button> : null}
            </div>
          </section>
        ) : null}

        <div className={`map-frame${placing ? " placing" : ""}`}>
          {framePos ? (
            <iframe key={`${framePos.lat},${framePos.lng}`} title="Bản đồ Google" src={embedUrl(framePos)}
              loading="lazy" referrerPolicy="no-referrer-when-downgrade" allowFullScreen />
          ) : (
            <div className="map-msg">
              {loading ? <span className="muted">Đang tải…</span>
                : placing ? <span className="muted">Chưa có vị trí để hiện.</span>
                : spots.length ? <><b>Chưa toà nào có vị trí</b><span className="muted">{isManager ? "Bấm vào một toà bên dưới để đặt vị trí, hoặc nhập Lat/Long trong Quản trị → Toà nhà." : "Quản lý sẽ đặt vị trí cho các toà."}</span></>
                : null}
            </div>
          )}
        </div>

        {err ? <div className="error-box" role="alert">{err}</div> : null}

        {loading ? null : spots.length === 0 ? (
          <Empty title="Chưa có toà nhà nào" />
        ) : (
          <section className="card">
            {list.map((s) => (
              <div key={s.id} className={`list-row${s.id === selectedId && !placing ? " selected" : ""}`} role="button" tabIndex={0}
                aria-current={s.id === selectedId ? "true" : undefined}
                onClick={() => choose(s)} onKeyDown={(e) => e.key === "Enter" && choose(s)}>
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
        {isManager && missing > 0 ? <p className="muted small" style={{ margin: 0 }}>{missing} toà chưa có vị trí — bấm vào toà để đặt.</p> : null}
        <p className="muted small" style={{ margin: 0 }}>Bấm vào một toà để xem trên bản đồ. Số phòng trống tính theo trạng thái phòng "Trống".</p>
        {placing ? <div style={{ height: 190 }} aria-hidden="true" /> : null}
      </main>

      {placing ? (
        <div className="savebar">
          <div className="in place-bar">
            <div className="row" style={{ flexWrap: "nowrap" }}>
              <input id="map-paste" className="input" value={paste} onChange={(e) => setPaste(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && applyPasted()} placeholder="Dán toạ độ hoặc link Google Maps" />
              <button className="btn secondary sm" onClick={applyPasted} disabled={!paste.trim()}>Dùng</button>
            </div>
            <small className="muted">Mẹo: trên app Google Maps, chạm giữ vào toà, copy dãy toạ độ hiện ra rồi dán vào đây.</small>
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
