import { useCallback, useEffect, useMemo, useState, type FormEvent } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { friendlyError, supabase } from "../lib/supabase";
import { useSession } from "../lib/session";
import { KIND_LABEL, type Building } from "../lib/labels";
import { naturalCompare, parseMoney, vnd, vndShort } from "../lib/money";
import { todayVN } from "../lib/dates";
import { Empty, Sheet, TopBar } from "../components/ui";
import { googleDirections } from "../lib/geo";
import { BuildingSheet } from "./Buildings";
import FileGallery from "../components/FileGallery";
import "../rooms.css";

export type RoomStatus = "trong" | "dang_o" | "dang_sua" | "giu_cho";
export type Room = {
  id: string; building_id: string; code: string; floor: number | null; room_type: string | null;
  rent_mode: "thang" | "dem"; list_price: number | null; max_occupants: number | null; status: RoomStatus; note: string | null;
};
const ROOM_STATUS: Record<RoomStatus, string> = { trong: "Trống", dang_o: "Đang ở", dang_sua: "Đang sửa", giu_cho: "Giữ chỗ" };
const MODE: Record<string, string> = { thang: "Theo tháng", dem: "Theo đêm" };

/** Đoán tầng từ mã phòng: 305 → 3, 1204 → 12, A305 → 3 */
function guessFloor(code: string): number | null {
  const d = code.replace(/\D/g, "");
  if (d.length >= 3) return parseInt(d.slice(0, d.length - 2), 10);
  return null;
}

export default function BuildingDetail() {
  const { id } = useParams();
  const { buildings, isManager, isSupervisor, myBuildingIds, reloadBase, toast } = useSession();
  const building = buildings.find((b) => b.id === id);
  const canManage = isManager || (isSupervisor && !!id && myBuildingIds.includes(id));
  const [rooms, setRooms] = useState<Room[]>([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState<"" | RoomStatus>("");
  const [editing, setEditing] = useState<Partial<Room> | null>(null);
  const [bulk, setBulk] = useState(false);
  const [paste, setPaste] = useState(false);
  const [editBuilding, setEditBuilding] = useState(false);
  const [selecting, setSelecting] = useState(false);
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [confirmDel, setConfirmDel] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const nav = useNavigate();

  const togglePick = (ids: string[], on?: boolean) => setPicked((prev) => {
    const next = new Set(prev);
    const turnOn = on ?? !ids.every((i) => next.has(i));
    ids.forEach((i) => (turnOn ? next.add(i) : next.delete(i)));
    return next;
  });
  const stopSelecting = () => { setSelecting(false); setPicked(new Set()); setConfirmDel(false); };

  async function deletePicked() {
    setDeleting(true);
    const { data, error } = await supabase.rpc("delete_rooms", { p_ids: [...picked] });
    setDeleting(false);
    if (error) { toast(friendlyError(error)); return; }
    const r = (Array.isArray(data) ? data[0] : data) as { deleted: number; skipped: number };
    toast(`Đã xoá ${r.deleted} phòng.${r.skipped ? ` Giữ lại ${r.skipped} phòng vì đã có hợp đồng hoặc doanh thu.` : ""}`);
    stopSelecting();
    load();
  }

  const load = useCallback(async () => {
    const { data } = await supabase.from("rooms").select("*").eq("building_id", id!);
    setRooms(((data as Room[]) ?? []).sort((a, b) => (a.floor ?? 0) - (b.floor ?? 0) || naturalCompare(a.code, b.code)));
    setLoading(false);
  }, [id]);
  useEffect(() => { load(); }, [load]);

  const stats = useMemo(() => {
    const c = { trong: 0, dang_o: 0, dang_sua: 0, giu_cho: 0 } as Record<RoomStatus, number>;
    let monthTotal = 0, monthCount = 0, nightCount = 0;
    rooms.forEach((r) => {
      c[r.status]++;
      if (r.rent_mode === "thang") { monthCount++; monthTotal += r.list_price ?? 0; } else nightCount++;
    });
    return { c, monthTotal, monthCount, nightCount };
  }, [rooms]);

  const floors = useMemo(() => {
    const shown = rooms.filter((r) => !filter || r.status === filter);
    const m = new Map<string, Room[]>();
    shown.forEach((r) => {
      const k = r.floor == null ? "Khác" : `Tầng ${r.floor}`;
      m.set(k, [...(m.get(k) ?? []), r]);
    });
    return [...m.entries()];
  }, [rooms, filter]);

  if (!building) return (<><TopBar title="Toà nhà" back /><main className="main"><Empty title="Không tìm thấy toà này">Có thể bạn chưa được gán vào toà này.</Empty></main></>);

  return (
    <>
      <TopBar title={building.code} back
        action={canManage ? <button className="tb-action" onClick={() => setEditing({ rent_mode: "thang", status: "trong" })}>+ Phòng</button> : null} />
      <main className="main stack">
        <section className="card building-head">
          <div>
            <h2>{building.name}</h2>
            <p className="muted small">{KIND_LABEL[building.kind]}{building.address ? ` · ${building.address}` : ""}{building.total_floors ? ` · ${building.total_floors} tầng` : ""}</p>
            {building.lat != null && building.lng != null ? (
              <p className="small" style={{ marginTop: 6 }}>
                <Link to={`/ban-do?toa=${building.id}`}>Xem trên bản đồ</Link>
                {" · "}<a href={googleDirections({ lat: building.lat, lng: building.lng })} target="_blank" rel="noopener">Chỉ đường</a>
              </p>
            ) : isManager ? (
              <p className="small" style={{ marginTop: 6 }}><Link to={`/ban-do?toa=${building.id}`}>Đặt vị trí trên bản đồ</Link></p>
            ) : null}
          </div>
          {isManager ? <button className="btn ghost sm" onClick={() => setEditBuilding(true)}>Sửa toà</button> : null}
        </section>

        <section className="room-stats">
          <div className="stat"><b className="num">{rooms.length}</b><span>phòng</span></div>
          <div className="stat st-dang_o"><b className="num">{stats.c.dang_o}</b><span>đang ở</span></div>
          <div className="stat st-trong"><b className="num">{stats.c.trong}</b><span>trống</span></div>
          <div className="stat st-dang_sua"><b className="num">{stats.c.dang_sua + stats.c.giu_cho}</b><span>đang sửa, giữ</span></div>
        </section>
        {stats.monthCount ? (
          <p className="muted small" style={{ margin: 0 }}>
            {stats.monthCount} phòng thuê tháng, tổng giá niêm yết <b className="num" style={{ color: "var(--ink)" }}>{vnd(stats.monthTotal)}</b>/tháng nếu kín phòng
            {stats.nightCount ? ` · ${stats.nightCount} phòng thuê theo đêm` : ""}.
          </p>
        ) : null}

        <div className="row">
          <Link className="btn secondary sm" to={`/toa/${building.id}/khach`}>Khách thuê</Link>
          <Link className="btn secondary sm" to={`/toa/${building.id}/hop-dong`}>Hợp đồng</Link>
          <Link className="btn secondary sm" to={`/toa/${building.id}/hoa-don`}>Thu tiền phòng</Link>
        </div>

        {canManage ? (
          <div className="row">
            <button className="btn secondary sm" onClick={() => setBulk(true)}>Tạo nhanh nhiều phòng</button>
            <button className="btn secondary sm" onClick={() => setPaste(true)}>Dán danh sách từ Excel</button>
            {rooms.length && !selecting ? <button className="btn ghost sm" style={{ color: "var(--danger)" }} onClick={() => setSelecting(true)}>Chọn phòng để xoá</button> : null}
          </div>
        ) : null}

        {rooms.length ? (
          <div className="chips" role="group" aria-label="Lọc phòng">
            {([["", "Tất cả", rooms.length], ["trong", "Trống", stats.c.trong], ["dang_o", "Đang ở", stats.c.dang_o], ["dang_sua", "Đang sửa", stats.c.dang_sua], ["giu_cho", "Giữ chỗ", stats.c.giu_cho]] as ["" | RoomStatus, string, number][])
              .map(([k, l, n]) => <button key={k} className="chip" aria-pressed={filter === k} onClick={() => setFilter(k)}>{l}<span className="n">{n}</span></button>)}
          </div>
        ) : null}

        {loading ? <div className="loading">Đang tải…</div> : rooms.length === 0 ? (
          <Empty title="Toà này chưa có phòng">{canManage ? "Bấm \"Tạo nhanh nhiều phòng\" để tạo cả toà trong một lần, hoặc \"+ Phòng\" để thêm từng phòng." : "Giám sát hoặc quản lý sẽ thêm phòng cho toà."}</Empty>
        ) : floors.map(([label, list]) => (
          <section key={label} className="floor">
            <div className="floor-label"><span>{label}</span>
              {selecting ? (
                <button className="btn ghost sm" onClick={() => togglePick(list.map((r) => r.id))}>
                  {list.every((r) => picked.has(r.id)) ? "Bỏ chọn tầng" : "Chọn cả tầng"}
                </button>
              ) : <span className="muted small num">{list.length} phòng</span>}
            </div>
            <div className="room-grid">
              {list.map((r) => (
                <button key={r.id} className={`room st-${r.status}${picked.has(r.id) ? " picked" : ""}`} aria-pressed={selecting ? picked.has(r.id) : undefined}
                  onClick={() => (selecting ? togglePick([r.id]) : setEditing(r))} aria-label={`Phòng ${r.code}, ${ROOM_STATUS[r.status]}`}>
                  <span className="rc">{r.code}</span>
                  <span className="rp num">{vndShort(r.list_price)}{r.rent_mode === "dem" ? "/đêm" : ""}</span>
                  <span className="rs">{r.room_type || ROOM_STATUS[r.status]}</span>
                </button>
              ))}
            </div>
          </section>
        ))}
        <div className="legend small">
          {(Object.keys(ROOM_STATUS) as RoomStatus[]).map((s) => <span key={s}><i className={`dot st-${s}`} />{ROOM_STATUS[s]}</span>)}
        </div>
        {selecting ? <div style={{ height: 76 }} aria-hidden="true" /> : null}
      </main>

      {selecting ? (
        <div className="savebar">
          <div className="in">
            {confirmDel ? (
              <>
                <span className="small"><b>Xoá hẳn {picked.size} phòng?</b> Không khôi phục được.</span>
                <div className="row" style={{ flexWrap: "nowrap" }}>
                  <button className="btn secondary sm" onClick={() => setConfirmDel(false)}>Giữ lại</button>
                  <button className="btn danger sm" disabled={deleting} onClick={deletePicked}>{deleting ? "Đang xoá…" : "Xoá"}</button>
                </div>
              </>
            ) : (
              <>
                <span className="small">{picked.size ? `Đã chọn ${picked.size} phòng` : "Bấm vào phòng để chọn"}</span>
                <div className="row" style={{ flexWrap: "nowrap" }}>
                  <button className="btn ghost sm" onClick={stopSelecting}>Huỷ</button>
                  <button className="btn danger sm" disabled={!picked.size} onClick={() => setConfirmDel(true)}>Xoá {picked.size || ""} phòng</button>
                </div>
              </>
            )}
          </div>
        </div>
      ) : null}

      {editing ? (
        <RoomSheet room={editing} building={building} canManage={canManage} existing={rooms}
          onClose={() => setEditing(null)} onSaved={(msg) => { setEditing(null); load(); toast(msg); }} />
      ) : null}
      <BulkSheet open={bulk} building={building} existing={rooms} onClose={() => setBulk(false)}
        onSaved={(msg) => { setBulk(false); load(); toast(msg); }} />
      <PasteSheet open={paste} building={building} onClose={() => setPaste(false)}
        onSaved={(msg) => { setPaste(false); load(); toast(msg); }} />
      {editBuilding ? (
        <BuildingSheet value={building} roomCount={rooms.length} onClose={() => setEditBuilding(false)}
          onSaved={async (msg) => { setEditBuilding(false); await reloadBase(); toast(msg); }}
          onDeleted={async (msg) => { setEditBuilding(false); await reloadBase(); toast(msg); nav("/quan-tri/toa-nha", { replace: true }); }} />
      ) : null}
    </>
  );
}

function MoneyInput({ id, value, onChange, placeholder }: { id: string; value: string; onChange: (v: string) => void; placeholder?: string }) {
  const n = parseMoney(value);
  return (
    <>
      <input id={id} className="input num" inputMode="decimal" value={value} onChange={(e) => onChange(e.target.value)} placeholder={placeholder ?? "VD: 4.500.000 hoặc 4,5tr"} />
      {value && n != null ? <small className="muted">{vnd(n)}</small> : value ? <small style={{ color: "var(--danger)" }}>Chưa đọc được số tiền</small> : null}
    </>
  );
}

function RoomSheet({ room, building, canManage, existing, onClose, onSaved }: {
  room: Partial<Room>; building: Building; canManage: boolean; existing: Room[]; onClose: () => void; onSaved: (msg: string) => void;
}) {
  const isNew = !room.id;
  const [code, setCode] = useState(room.code ?? "");
  const [floor, setFloor] = useState(room.floor?.toString() ?? "");
  const [type, setType] = useState(room.room_type ?? "");
  const [mode, setMode] = useState(room.rent_mode ?? "thang");
  const [price, setPrice] = useState(room.list_price != null ? new Intl.NumberFormat("vi-VN").format(room.list_price) : "");
  const [maxOcc, setMaxOcc] = useState(room.max_occupants?.toString() ?? "");
  const [status, setStatus] = useState<RoomStatus>(room.status ?? "trong");
  const [note, setNote] = useState(room.note ?? "");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [confirmDel, setConfirmDel] = useState(false);
  const types = useMemo(() => [...new Set(existing.map((r) => r.room_type).filter(Boolean) as string[])], [existing]);
  const nav = useNavigate();

  // Phòng đã có hợp đồng hiệu lực chưa? (null = đang kiểm tra)
  const [hasContract, setHasContract] = useState<boolean | null>(isNew ? false : null);
  useEffect(() => {
    if (isNew) return;
    supabase.from("contracts").select("id").eq("room_id", room.id!).eq("status", "hieu_luc").limit(1)
      .then(({ data }) => setHasContract(!!data?.length));
  }, [isNew, room.id]);

  // Chọn "Đang ở" cho phòng thuê tháng chưa có hợp đồng → phải nhập khách, CCCD, hợp đồng
  const needTenant = status === "dang_o" && mode === "thang" && hasContract === false && canManage && !isNew;
  const [tName, setTName] = useState("");
  const [tPhone, setTPhone] = useState("");
  const [tIdNo, setTIdNo] = useState("");
  const [tConsent, setTConsent] = useState(false);
  const [cStart, setCStart] = useState(todayVN());
  const [cRent, setCRent] = useState(room.list_price != null ? new Intl.NumberFormat("vi-VN").format(room.list_price) : "");
  const [cDep, setCDep] = useState("");

  async function submit(e: FormEvent) {
    e.preventDefault();
    setErr(null);
    const p = price.trim() ? parseMoney(price) : null;
    if (price.trim() && p == null) { setErr("Giá chưa đúng. Nhập dạng 4500000, 4.500.000 hoặc 4,5tr."); return; }
    let rentN = 0, depN = 0, idDigits = "";
    if (needTenant) {
      idDigits = tIdNo.replace(/\s/g, "");
      const r = parseMoney(cRent), d = cDep.trim() ? parseMoney(cDep) : 0;
      if (!tName.trim()) { setErr("Nhập họ tên khách đang ở."); return; }
      if (!/^(\d{9}|\d{12})$/.test(idDigits)) { setErr("Nhập số CCCD của khách (12 chữ số, CMND cũ 9 số)."); return; }
      if (!tConsent) { setErr("Cần tích xác nhận khách đồng ý cho lưu CCCD."); return; }
      if (r == null) { setErr("Nhập giá thuê tháng của hợp đồng."); return; }
      if (d == null) { setErr("Tiền cọc chưa đúng."); return; }
      rentN = r; depN = d;
    }
    setBusy(true);
    // Khi cần lập hợp đồng: lưu phòng trước với trạng thái cũ, hợp đồng sẽ tự chuyển phòng sang "Đang ở"
    const saveStatus = needTenant ? (room.status === "dang_o" ? "dang_o" : (room.status ?? "trong")) : status;
    const row = canManage
      ? { building_id: building.id, code: code.trim().toUpperCase(), floor: floor ? Number(floor) : guessFloor(code), room_type: type.trim() || null,
          rent_mode: mode, list_price: p, max_occupants: maxOcc ? Number(maxOcc) : null, status: saveStatus, note: note.trim() || null }
      : { status, note: note.trim() || null };
    const { error } = isNew ? await supabase.from("rooms").insert(row) : await supabase.from("rooms").update(row).eq("id", room.id!);
    if (error) { setBusy(false); setErr(/duplicate/i.test(error.message) ? `Phòng ${code} đã có trong toà này.` : friendlyError(error)); return; }
    if (needTenant) {
      const t = await supabase.from("tenants").insert({
        building_id: building.id, full_name: tName.trim(), phone: tPhone.trim() || null, id_number: idDigits,
        cccd_consent_at: new Date().toISOString(), cccd_consent_note: "Khách đồng ý trực tiếp",
      }).select("id").single();
      if (t.error) { setBusy(false); setErr(`Đã lưu phòng nhưng chưa thêm được khách: ${friendlyError(t.error)}`); return; }
      const c = await supabase.from("contracts").insert({
        room_id: room.id!, tenant_id: t.data.id, start_date: cStart, rent_amount: rentN, deposit_amount: depN, billing_day: 5,
      }).select("id").single();
      setBusy(false);
      if (c.error) { setErr(`Đã thêm khách nhưng chưa lập được hợp đồng: ${/contracts_one_active/.test(c.error.message) ? "phòng đang có hợp đồng hiệu lực." : friendlyError(c.error)}`); return; }
      onSaved(`Đã lưu khách và hợp đồng phòng ${room.code}. Tải ảnh CCCD và file hợp đồng ở trang này.`);
      nav(`/khach/${t.data.id}`);
      return;
    }
    setBusy(false);
    onSaved(isNew ? `Đã thêm phòng ${code.trim().toUpperCase()}.` : `Đã lưu phòng ${room.code}.`);
  }

  async function remove() {
    setBusy(true);
    const { error } = await supabase.from("rooms").delete().eq("id", room.id!);
    setBusy(false);
    if (error) { setErr(/foreign key|violates/i.test(error.message) ? "Phòng đã có hợp đồng hoặc doanh thu nên không xoá được. Đổi trạng thái thay vì xoá." : friendlyError(error)); setConfirmDel(false); return; }
    onSaved(`Đã xoá phòng ${room.code}.`);
  }

  return (
    <Sheet open onClose={onClose} title={isNew ? `Thêm phòng · ${building.code}` : `Phòng ${room.code}`}>
      <form className="stack" onSubmit={submit}>
        {canManage ? (
          <>
            <div className="row" style={{ alignItems: "flex-start" }}>
              <label className="field" style={{ flex: "1 1 110px" }}><span>Số phòng *</span>
                <input id="r-code" className="input" value={code} onChange={(e) => setCode(e.target.value)} placeholder="301" required /></label>
              <label className="field" style={{ flex: "1 1 80px" }}><span>Tầng</span>
                <input id="r-floor" className="input" inputMode="numeric" value={floor} onChange={(e) => setFloor(e.target.value.replace(/\D/g, ""))} placeholder={guessFloor(code)?.toString() ?? ""} /></label>
            </div>
            <label className="field"><span>Loại phòng</span>
              <input id="r-type" className="input" list="room-types" value={type} onChange={(e) => setType(e.target.value)} placeholder="VD: Studio, 1PN, Deluxe" />
              <datalist id="room-types">{types.map((t) => <option key={t} value={t} />)}</datalist></label>
            <div className="row" style={{ alignItems: "flex-start" }}>
              <label className="field" style={{ flex: "1 1 140px" }}><span>Cho thuê</span>
                <select id="r-mode" className="input" value={mode} onChange={(e) => setMode(e.target.value as "thang" | "dem")}>
                  <option value="thang">Theo tháng</option><option value="dem">Theo đêm</option>
                </select></label>
              <label className="field" style={{ flex: "1 1 160px" }}><span>Giá {mode === "dem" ? "1 đêm" : "1 tháng"}</span>
                <MoneyInput id="r-price" value={price} onChange={setPrice} /></label>
            </div>
            <label className="field"><span>Số người ở tối đa</span>
              <input id="r-max" className="input" inputMode="numeric" value={maxOcc} onChange={(e) => setMaxOcc(e.target.value.replace(/\D/g, ""))} /></label>
          </>
        ) : (
          <p className="muted small" style={{ margin: 0 }}>{room.room_type ? `${room.room_type} · ` : ""}{MODE[room.rent_mode ?? "thang"]} · {vnd(room.list_price)}</p>
        )}
        {!isNew ? (
          <FileGallery owner={{ kind: "anh_phong", buildingId: building.id, roomId: room.id! }} title="Ảnh phòng" pdf={false} cover
            hint={'Ảnh có nhãn "Đại diện" dùng làm ảnh chính của phòng.'} canUpload canDelete={canManage} />
        ) : null}
        <div className="field"><span>Trạng thái</span>
          <div className="seg seg-room" role="group">
            {(Object.keys(ROOM_STATUS) as RoomStatus[]).map((s) => (
              <button type="button" key={s} className={`st-${s}`} aria-pressed={status === s} onClick={() => setStatus(s)}>{ROOM_STATUS[s]}</button>
            ))}
          </div>
          {isNew && status === "dang_o" ? <small className="muted">Lưu phòng trước, rồi mở lại phòng để nhập khách đang ở, CCCD và hợp đồng.</small> : null}
          {!canManage && status === "dang_o" && room.status !== "dang_o" ? <small style={{ color: "var(--danger)" }}>Chỉ Quản lý hoặc Giám sát toà lập hợp đồng để chuyển phòng sang "Đang ở".</small> : null}
        </div>
        {needTenant ? (
          <section className="fg" aria-label="Khách đang ở">
            <b>Khách đang ở và hợp đồng</b>
            <p className="muted small" style={{ margin: 0 }}>Phòng "Đang ở" cần có khách đứng tên, số CCCD và hợp đồng. Sau khi lưu, bạn sẽ chụp ảnh CCCD và tải file hợp đồng.</p>
            <label className="field"><span>Họ tên khách *</span><input id="r-tname" className="input" value={tName} onChange={(e) => setTName(e.target.value)} /></label>
            <div className="row" style={{ alignItems: "flex-start" }}>
              <label className="field" style={{ flex: "1 1 150px" }}><span>Số điện thoại</span><input id="r-tphone" className="input" inputMode="tel" value={tPhone} onChange={(e) => setTPhone(e.target.value)} /></label>
              <label className="field" style={{ flex: "1 1 150px" }}><span>Số CCCD *</span><input id="r-tid" className="input num" inputMode="numeric" value={tIdNo} onChange={(e) => setTIdNo(e.target.value.replace(/[^\d\s]/g, ""))} placeholder="12 chữ số" /></label>
            </div>
            <label className="row" style={{ flexWrap: "nowrap", alignItems: "flex-start" }}>
              <input id="r-tconsent" type="checkbox" checked={tConsent} onChange={(e) => setTConsent(e.target.checked)} style={{ marginTop: 4 }} />
              <span className="small">Khách đã được thông báo và đồng ý để công ty lưu số CCCD và ảnh CCCD nhằm quản lý lưu trú, lập hợp đồng.</span>
            </label>
            <div className="row" style={{ alignItems: "flex-start" }}>
              <label className="field" style={{ flex: "1 1 150px" }}><span>Hợp đồng bắt đầu *</span><input id="r-cstart" className="input" type="date" value={cStart} onChange={(e) => setCStart(e.target.value)} /></label>
              <label className="field" style={{ flex: "1 1 150px" }}><span>Giá thuê / tháng *</span><input id="r-crent" className="input num" inputMode="decimal" value={cRent} onChange={(e) => setCRent(e.target.value)} /></label>
            </div>
            <label className="field"><span>Tiền cọc</span><input id="r-cdep" className="input num" inputMode="decimal" value={cDep} onChange={(e) => setCDep(e.target.value)} /></label>
          </section>
        ) : null}
        <label className="field"><span>Ghi chú</span>
          <textarea id="r-note" className="input" style={{ minHeight: 60 }} value={note} onChange={(e) => setNote(e.target.value)} /></label>
        {err ? <div className="error-box" role="alert">{err}</div> : null}
        <button className="btn block" disabled={busy}>{busy ? "Đang lưu…" : isNew ? "Thêm phòng" : "Lưu"}</button>
        {!isNew && canManage ? (
          confirmDel ? (
            <div className="row">
              <span className="small" style={{ flex: 1 }}>Xoá hẳn phòng {room.code}?</span>
              <button type="button" className="btn secondary sm" onClick={() => setConfirmDel(false)}>Giữ lại</button>
              <button type="button" className="btn danger sm" onClick={remove} disabled={busy}>Xoá</button>
            </div>
          ) : <button type="button" className="btn ghost" style={{ color: "var(--danger)" }} onClick={() => setConfirmDel(true)}>Xoá phòng</button>
        ) : null}
      </form>
    </Sheet>
  );
}

function BulkSheet({ open, building, existing, onClose, onSaved }: {
  open: boolean; building: Building; existing: Room[]; onClose: () => void; onSaved: (msg: string) => void;
}) {
  const [from, setFrom] = useState("1");
  const [to, setTo] = useState(building.total_floors?.toString() ?? "5");
  const [per, setPer] = useState("6");
  const [start, setStart] = useState("1");
  const [prefix, setPrefix] = useState("");
  const [type, setType] = useState("");
  const [mode, setMode] = useState<"thang" | "dem">(building.kind === "khach_san" ? "dem" : "thang");
  const [price, setPrice] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const codes = useMemo(() => {
    const a = parseInt(from, 10), b = parseInt(to, 10), n = parseInt(per, 10), s = parseInt(start, 10);
    if (![a, b, n, s].every(Number.isFinite) || a > b || n < 1 || n > 60 || b - a > 80) return [];
    const out: { code: string; floor: number }[] = [];
    for (let f = a; f <= b; f++) for (let i = 0; i < n; i++) out.push({ code: `${prefix.trim().toUpperCase()}${f}${String(s + i).padStart(2, "0")}`, floor: f });
    return out;
  }, [from, to, per, start, prefix]);
  const have = new Set(existing.map((r) => r.code));
  const fresh = codes.filter((c) => !have.has(c.code));

  async function submit(e: FormEvent) {
    e.preventDefault();
    setErr(null);
    const p = price.trim() ? parseMoney(price) : null;
    if (price.trim() && p == null) { setErr("Giá chưa đúng. Nhập dạng 4500000, 4.500.000 hoặc 4,5tr."); return; }
    if (!fresh.length) { setErr("Không có phòng mới nào để tạo."); return; }
    setBusy(true);
    const { error } = await supabase.from("rooms").insert(fresh.map((c) => ({
      building_id: building.id, code: c.code, floor: c.floor, room_type: type.trim() || null, rent_mode: mode, list_price: p, status: "trong",
    })));
    setBusy(false);
    if (error) { setErr(friendlyError(error)); return; }
    onSaved(`Đã tạo ${fresh.length} phòng.`);
  }

  return (
    <Sheet open={open} onClose={onClose} title={`Tạo nhanh phòng · ${building.code}`}>
      <form className="stack" onSubmit={submit}>
        <div className="bulk-grid">
          <label className="field"><span>Từ tầng</span><input id="bk-from" className="input" inputMode="numeric" value={from} onChange={(e) => setFrom(e.target.value.replace(/\D/g, ""))} /></label>
          <label className="field"><span>Đến tầng</span><input id="bk-to" className="input" inputMode="numeric" value={to} onChange={(e) => setTo(e.target.value.replace(/\D/g, ""))} /></label>
          <label className="field"><span>Số phòng mỗi tầng</span><input id="bk-per" className="input" inputMode="numeric" value={per} onChange={(e) => setPer(e.target.value.replace(/\D/g, ""))} /></label>
          <label className="field"><span>Số đầu tiên</span><input id="bk-start" className="input" inputMode="numeric" value={start} onChange={(e) => setStart(e.target.value.replace(/\D/g, ""))} /></label>
        </div>
        <label className="field"><span>Chữ đứng trước số phòng (nếu có)</span>
          <input id="bk-prefix" className="input" value={prefix} onChange={(e) => setPrefix(e.target.value)} placeholder="VD: A → A101, A102…" /></label>
        <div className="preview small">
          {codes.length ? (
            <>Sẽ tạo <b>{fresh.length}</b> phòng: <span className="mono">{codes.slice(0, 4).map((c) => c.code).join(", ")}{codes.length > 5 ? " … " : codes.length === 5 ? ", " : ""}{codes.length > 4 ? codes[codes.length - 1].code : ""}</span>
              {codes.length - fresh.length ? <span className="muted"> · bỏ qua {codes.length - fresh.length} phòng đã có</span> : null}</>
          ) : <span style={{ color: "var(--danger)" }}>Kiểm tra lại số tầng và số phòng.</span>}
        </div>
        <label className="field"><span>Loại phòng (áp cho tất cả, sửa riêng sau)</span>
          <input id="bk-type" className="input" value={type} onChange={(e) => setType(e.target.value)} placeholder="VD: Studio" /></label>
        <div className="row" style={{ alignItems: "flex-start" }}>
          <label className="field" style={{ flex: "1 1 140px" }}><span>Cho thuê</span>
            <select id="bk-mode" className="input" value={mode} onChange={(e) => setMode(e.target.value as "thang" | "dem")}>
              <option value="thang">Theo tháng</option><option value="dem">Theo đêm</option>
            </select></label>
          <label className="field" style={{ flex: "1 1 160px" }}><span>Giá chung</span><MoneyInput id="bk-price" value={price} onChange={setPrice} /></label>
        </div>
        {err ? <div className="error-box" role="alert">{err}</div> : null}
        <button className="btn block" disabled={busy || !fresh.length}>{busy ? "Đang tạo…" : `Tạo ${fresh.length} phòng`}</button>
      </form>
    </Sheet>
  );
}

type Parsed = { code: string; floor: number | null; room_type: string | null; list_price: number | null; rent_mode: "thang" | "dem"; bad?: string };

function parseRows(text: string): Parsed[] {
  return text.split(/\r?\n/).map((l) => l.trim()).filter(Boolean).map((line) => {
    const cols = line.includes("\t") ? line.split("\t") : line.split(/\s*[;|]\s*|\s{2,}/);
    const [c0, ...rest] = cols.map((c) => c.trim());
    const code = (c0 ?? "").toUpperCase();
    let floor: number | null = null, price: number | null = null, type: string | null = null, mode: "thang" | "dem" = "thang";
    for (const c of rest) {
      if (!c) continue;
      if (/đêm|dem|night/i.test(c) && c.length < 12) { mode = "dem"; continue; }
      if (/tháng|thang|month/i.test(c) && c.length < 12) { mode = "thang"; continue; }
      const m = parseMoney(c);
      if (m != null && m >= 10000) { price = m; continue; }
      if (/^\d{1,2}$/.test(c) && floor == null) { floor = parseInt(c, 10); continue; }
      if (!type) type = c;
    }
    if (floor == null) floor = guessFloor(code);
    return { code, floor, room_type: type, list_price: price, rent_mode: mode, bad: !code || /^(phòng|phong|room|số)/i.test(code) ? "skip" : undefined };
  }).filter((r) => !r.bad);
}

function PasteSheet({ open, building, onClose, onSaved }: { open: boolean; building: Building; onClose: () => void; onSaved: (msg: string) => void }) {
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const rows = useMemo(() => parseRows(text), [text]);

  async function submit() {
    setErr(null);
    if (!rows.length) return;
    setBusy(true);
    const { error } = await supabase.from("rooms").upsert(
      rows.map((r) => ({ building_id: building.id, code: r.code, floor: r.floor, room_type: r.room_type, list_price: r.list_price, rent_mode: r.rent_mode })),
      { onConflict: "building_id,code" });
    setBusy(false);
    if (error) { setErr(friendlyError(error)); return; }
    onSaved(`Đã cập nhật ${rows.length} phòng.`);
  }

  return (
    <Sheet open={open} onClose={onClose} title={`Dán danh sách phòng · ${building.code}`}>
      <div className="stack">
        <p className="muted small" style={{ margin: 0 }}>
          Trong Excel, chọn các cột <b>Số phòng · Tầng · Loại · Giá · Thuê theo (tháng/đêm)</b>, copy rồi dán vào đây. Chỉ cột số phòng là bắt buộc.
          Phòng đã có sẽ được cập nhật giá và loại.
        </p>
        <textarea id="paste-rooms" className="input mono" style={{ minHeight: 160 }} value={text} onChange={(e) => setText(e.target.value)}
          placeholder={"101\t1\tStudio\t4.500.000\ttháng\n102\t1\t1PN\t5.200.000\ttháng\n201\t2\tDeluxe\t650.000\tđêm"} />
        {rows.length ? (
          <div className="paste-preview">
            <table>
              <thead><tr><th>Phòng</th><th>Tầng</th><th>Loại</th><th>Giá</th><th>Thuê</th></tr></thead>
              <tbody>
                {rows.slice(0, 50).map((r, i) => (
                  <tr key={i}><td>{r.code}</td><td className="num">{r.floor ?? ""}</td><td>{r.room_type ?? ""}</td>
                    <td className="num">{r.list_price != null ? vnd(r.list_price) : <span className="muted">—</span>}</td><td>{r.rent_mode === "dem" ? "Đêm" : "Tháng"}</td></tr>
                ))}
              </tbody>
            </table>
            {rows.length > 50 ? <p className="muted small">… và {rows.length - 50} phòng nữa</p> : null}
          </div>
        ) : null}
        {err ? <div className="error-box" role="alert">{err}</div> : null}
        <button className="btn block" disabled={busy || !rows.length} onClick={submit}>{busy ? "Đang lưu…" : `Lưu ${rows.length} phòng`}</button>
      </div>
    </Sheet>
  );
}
