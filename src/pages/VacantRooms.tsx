import { useEffect, useMemo, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { supabase } from "../lib/supabase";
import { r2Config } from "../lib/files";
import { furnitureList } from "../lib/roomTypes";
import { naturalCompare, vnd, vndShort } from "../lib/money";
import { Sheet, TopBar } from "../components/ui";
import { PolicyPanel } from "../components/PolicyView";
import "../roomtype.css";

type Vacant = {
  room_id: string; building_id: string; building_code: string; building_name: string; building_note: string | null;
  code: string; floor: number | null; type_id: string | null; type_name: string | null;
  area_m2: number | null; furniture: string | null; description: string | null;
  rent_mode: string | null; list_price: number | null; max_occupants: number | null;
  cover_path: string | null; cover_store: string | null; cover_thumb: boolean | null;
};
type Bld = { id: string; code: string; name: string; note: string | null; rooms: Vacant[]; count: number };

/** Phòng trống theo toà → loại phòng. Cộng tác viên cũng xem được trang này. */
export default function VacantRooms() {
  const [sp, setSp] = useSearchParams();
  const only = sp.get("toa");
  const [rows, setRows] = useState<Vacant[] | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [base, setBase] = useState<string | null>(null);
  const [pol, setPol] = useState<Bld | null>(null);   // toà đang xem trong cửa sổ nhỏ
  const [room, setRoom] = useState<Vacant | null>(null);   // phòng đang xem chi tiết

  useEffect(() => {
    supabase.rpc("vacant_rooms").then(({ data, error }) => {
      if (error) setErr("Không tải được danh sách phòng trống. Thử lại sau."); else setRows((data as Vacant[]) ?? []);
    });
    r2Config().then((c) => setBase(c.publicBase));
  }, []);

  const blds = useMemo<Bld[]>(() => {
    const m = new Map<string, Bld>();
    for (const r of rows ?? []) {
      let b = m.get(r.building_id);
      if (!b) { b = { id: r.building_id, code: r.building_code, name: r.building_name, note: r.building_note, rooms: [], count: 0 }; m.set(r.building_id, b); }
      b.count++; b.rooms.push(r);
    }
    const list = [...m.values()].sort((a, b) => naturalCompare(a.code, b.code));
    list.forEach((b) => b.rooms.sort((a, c) => naturalCompare(a.code, c.code)));
    return list;
  }, [rows]);

  const shown = only ? blds.filter((b) => b.id === only) : blds;
  const total = blds.reduce((n, b) => n + b.count, 0);
  const photo = (r: Vacant) => {
    if (!r.cover_path || !base || !r.cover_path.startsWith("anh-phong/")) return null;
    const p = r.cover_thumb ? r.cover_path.replace(/\.[a-z]+$/, "_t.jpg") : r.cover_path;
    return `${base}/${p}`;
  };

  return (
    <>
      <TopBar title="Phòng trống" />
      <main className="main stack">
        {err ? <div className="error-box" role="alert">{err}</div> : null}
        {!rows && !err ? <div className="loading">Đang tải…</div> : null}
        {rows ? (
          <>
            <div className="vr-sum card">
              <div><b className="num vr-big">{only ? (shown[0]?.count ?? 0) : total}</b> phòng trống{only ? "" : ` · ${blds.length} toà`}</div>
              <div className="vr-chips">
                <button type="button" className={`chip${!only ? " on" : ""}`} onClick={() => setSp({})}>Tất cả toà<span className="n">{total}</span></button>
                {blds.map((b) => (
                  <button key={b.id} type="button" className={`chip${only === b.id ? " on" : ""}`} onClick={() => setSp({ toa: b.id })}>{b.code}<span className="n">{b.count}</span></button>
                ))}
              </div>
            </div>
            {only && !shown.length ? <p className="muted">Toà này hiện không còn phòng trống.</p> : null}
            {!rows.length ? <p className="muted">Hiện chưa có phòng trống.</p> : null}
            {shown.map((b) => (
              <section key={b.id} className="card vr-card vr-click" role="button" tabIndex={0} aria-label={`Xem dịch vụ và chính sách toà ${b.code}`}
                onClick={() => setPol(b)} onKeyDown={(e) => { if (e.target === e.currentTarget && (e.key === "Enter" || e.key === " ")) { e.preventDefault(); setPol(b); } }}>
                <h2 className="vr-bh">{b.code} · {b.name}</h2>
                <p className="vr-l1"><b className="num">{b.count} phòng trống</b>{b.note ? <> – <span>{b.note}</span></> : null}</p>
                <div className="vr-l2">
                  <span className="muted small">Phòng trống (loại phòng – giá tiền):</span>
                  <div className="vr-rooms">
                    {b.rooms.map((r) => (
                      <button key={r.room_id} type="button" className="vr-room" onClick={(e) => { e.stopPropagation(); setRoom(r); }}>
                        <b className="num">{r.code}</b> <span>({r.type_name ?? "Chưa phân loại"} – {r.list_price != null ? vndShort(r.list_price) : "liên hệ"})</span>
                      </button>
                    ))}
                  </div>
                </div>
                <span className="vr-hint small">Bấm vào toà để xem dịch vụ, nội thất, chính sách. Bấm vào phòng để xem chi tiết.</span>
              </section>
            ))}
          </>
        ) : null}
      </main>
      <Sheet open={!!pol} onClose={() => setPol(null)} title={pol ? `${pol.code} · ${pol.name}` : "Toà"}>
        {pol ? (
          <div className="stack">
            {pol.note ? <p className="vr-note">{pol.note}</p> : null}
            <PolicyPanel buildingId={pol.id} />
          </div>
        ) : null}
      </Sheet>
      <Sheet open={!!room} onClose={() => setRoom(null)} title={room ? `Phòng ${room.code}` : "Phòng"}>
        {room ? <RoomDetail r={room} img={photo(room)} /> : null}
      </Sheet>
    </>
  );
}

/** Chi tiết một phòng trống: nội thất của riêng phòng này (đè nội thất của nhóm) */
function RoomDetail({ r, img }: { r: Vacant; img: string | null }) {
  const items = furnitureList(r.furniture);
  return (
    <div className="stack">
      {img ? <img className="rtc-hero" src={img} alt={`Ảnh phòng ${r.code}`} decoding="async" onError={(e) => { e.currentTarget.style.display = "none"; }} /> : null}
      <div className="rtc-head">
        <b>{r.type_name ?? "Chưa phân loại"}</b>
        <span className="rtc-price num">{r.list_price != null ? vnd(r.list_price) : "Liên hệ"}{r.list_price != null ? (r.rent_mode === "dem" ? "/đêm" : "/tháng") : ""}</span>
      </div>
      <div className="rtc-specs small">
        <span>{r.building_code}</span>
        <span>{r.floor == null ? "" : r.floor === 0 ? "Tầng trệt" : `Tầng ${r.floor}`}</span>
        {r.area_m2 != null ? <span>{String(r.area_m2).replace(".", ",")} m²</span> : null}
        {r.max_occupants ? <span>Tối đa {r.max_occupants} người</span> : null}
      </div>
      {items.length ? <ul className="rtc-chips" aria-label="Nội thất của phòng">{items.map((f) => <li key={f}>{f}</li>)}</ul> : <p className="muted small" style={{ margin: 0 }}>Chưa ghi nội thất.</p>}
      {r.description ? <p className="small" style={{ margin: 0 }}>{r.description}</p> : null}
    </div>
  );
}
