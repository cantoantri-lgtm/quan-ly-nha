import { useEffect, useMemo, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { supabase } from "../lib/supabase";
import { r2Config } from "../lib/files";
import { furnitureList } from "../lib/roomTypes";
import { naturalCompare, vnd } from "../lib/money";
import { TopBar } from "../components/ui";
import "../roomtype.css";

type Vacant = {
  room_id: string; building_id: string; building_code: string; building_name: string;
  code: string; floor: number | null; type_id: string | null; type_name: string | null;
  area_m2: number | null; furniture: string | null; description: string | null;
  rent_mode: string | null; list_price: number | null; max_occupants: number | null;
  cover_path: string | null; cover_store: string | null; cover_thumb: boolean | null;
};
type Group = { key: string; name: string; rooms: Vacant[] };
type Bld = { id: string; code: string; name: string; groups: Group[]; count: number };

/** Phòng trống theo toà → loại phòng. Cộng tác viên cũng xem được trang này. */
export default function VacantRooms() {
  const [sp, setSp] = useSearchParams();
  const only = sp.get("toa");
  const [rows, setRows] = useState<Vacant[] | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [base, setBase] = useState<string | null>(null);

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
      if (!b) { b = { id: r.building_id, code: r.building_code, name: r.building_name, groups: [], count: 0 }; m.set(r.building_id, b); }
      b.count++;
      const key = r.type_id ?? "none";
      let g = b.groups.find((x) => x.key === key);
      if (!g) { g = { key, name: r.type_name ?? "Chưa phân loại", rooms: [] }; b.groups.push(g); }
      g.rooms.push(r);
    }
    const list = [...m.values()].sort((a, b) => naturalCompare(a.code, b.code));
    list.forEach((b) => { b.groups.sort((a, c) => naturalCompare(a.name, c.name)); b.groups.forEach((g) => g.rooms.sort((a, c) => naturalCompare(a.code, c.code))); });
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
              <section key={b.id} className="vr-bld">
                <h2 className="vr-bh">{b.code} · {b.name} <span className="vr-cnt num">{b.count} phòng trống</span></h2>
                {b.groups.map((g) => {
                  const r0 = g.rooms[0];
                  const img = photo(r0);
                  const items = furnitureList(r0.furniture);
                  return (
                    <article key={g.key} className="rtc vr-type">
                      {img ? <img className="rtc-hero" src={img} alt={`Ảnh loại phòng ${g.name}`} loading="lazy" decoding="async" onError={(e) => { e.currentTarget.style.display = "none"; }} /> : null}
                      <div className="rtc-body">
                        <div className="rtc-head">
                          <b>{g.name} <span className="muted num">· {g.rooms.length} phòng</span></b>
                          <span className="rtc-price num">{r0.list_price != null ? vnd(r0.list_price) : "Liên hệ"}{r0.list_price != null ? (r0.rent_mode === "dem" ? "/đêm" : "/tháng") : ""}</span>
                        </div>
                        <div className="rtc-specs small">
                          {r0.area_m2 != null ? <span>{String(r0.area_m2).replace(".", ",")} m²</span> : null}
                          {r0.max_occupants ? <span>Tối đa {r0.max_occupants} người</span> : null}
                        </div>
                        {items.length ? <ul className="rtc-chips">{items.map((f) => <li key={f}>{f}</li>)}</ul> : null}
                        <div className="vr-rooms">
                          {g.rooms.map((r) => <span key={r.room_id} className="vr-room num">{r.code}{r.floor != null ? <small>T{r.floor}</small> : null}</span>)}
                        </div>
                      </div>
                    </article>
                  );
                })}
              </section>
            ))}
          </>
        ) : null}
      </main>
    </>
  );
}
