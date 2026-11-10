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
import { uploadFile } from "../lib/files";
import RoomTypeCard from "../components/RoomTypeCard";
import { PolicyPanel } from "../components/PolicyView";
import RoomTypesSheet from "../components/RoomTypesSheet";
import { groupColorKey, type RoomType } from "../lib/roomTypes";
import "../rooms.css";

export type RoomStatus = "trong" | "dang_o" | "dang_sua" | "giu_cho";
export type Room = {
  id: string; building_id: string; code: string; floor: number | null; room_type: string | null;
  rent_mode: "thang" | "dem"; list_price: number | null; max_occupants: number | null; status: RoomStatus; note: string | null;
  room_type_id: string | null; furniture?: string | null;
};
const ROOM_STATUS: Record<RoomStatus, string> = { trong: "Trống", dang_o: "Đang cho thuê", dang_sua: "Đang sửa", giu_cho: "Giữ chỗ" };
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
  const [types, setTypes] = useState<RoomType[]>([]);
  const [typesOpen, setTypesOpen] = useState(false);
  const [polOpen, setPolOpen] = useState(false);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState<"" | RoomStatus>("");
  const [groupFilter, setGroupFilter] = useState<string>("");   // mã nhóm phòng đang lọc ("" = tất cả)
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
    const [r, t] = await Promise.all([
      supabase.from("rooms").select("*").eq("building_id", id!),
      supabase.from("room_types").select("*").eq("building_id", id!).order("sort").order("name"),
    ]);
    setRooms(((r.data as Room[]) ?? []).sort((a, b) => (a.floor ?? 0) - (b.floor ?? 0) || naturalCompare(a.code, b.code)));
    setTypes((t.data as RoomType[]) ?? []);
    setLoading(false);
  }, [id]);
  const roomCounts = useMemo(() => {
    const m: Record<string, number> = {};
    rooms.forEach((r) => { if (r.room_type_id) m[r.room_type_id] = (m[r.room_type_id] ?? 0) + 1; });
    return m;
  }, [rooms]);
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
    const shown = rooms.filter((r) => (!filter || r.status === filter) && (!groupFilter || r.room_type_id === groupFilter));
    const m = new Map<string, Room[]>();
    shown.forEach((r) => {
      const k = r.floor == null ? "Khác" : r.floor === 0 ? "Trệt" : `Tầng ${r.floor}`;
      m.set(k, [...(m.get(k) ?? []), r]);
    });
    return [...m.entries()];
  }, [rooms, filter, groupFilter]);
  // Màu nhóm phòng: theo khoá lưu ở loại phòng; loại chưa chọn màu thì không tô
  const colorOf = useMemo(() => {
    const m: Record<string, string | null> = {};
    types.forEach((t) => { m[t.id] = groupColorKey(t); });
    return m;
  }, [types]);

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

        <FileGallery owner={{ kind: "anh_toa", buildingId: building.id }} title="Ảnh toà nhà" pdf={false} cover
          hint={'Ảnh có nhãn "Đại diện" hiện trên bản đồ cho cả nhân viên và cộng tác viên.'} canUpload={canManage} canDelete={canManage} />

        <section className="room-stats">
          <div className="stat"><b className="num">{rooms.length}</b><span>phòng</span></div>
          <div className="stat st-dang_o"><b className="num">{stats.c.dang_o}</b><span>cho thuê</span></div>
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
          <button type="button" className="btn secondary sm" aria-expanded={polOpen} onClick={() => setPolOpen(!polOpen)}>{polOpen ? "Ẩn dịch vụ & chính sách" : "Dịch vụ & chính sách"}</button>
        </div>
        {polOpen ? (
          <section className="card stack">
            <PolicyPanel buildingId={building.id} canEdit={isManager} />
          </section>
        ) : null}

        {canManage ? (
          <div className="row">
            <button className="btn secondary sm" onClick={() => setTypesOpen(true)}>Loại phòng{types.length ? ` (${types.length})` : ""}</button>
            <button className="btn secondary sm" onClick={() => setBulk(true)}>Tạo nhanh nhiều phòng</button>
            <button className="btn secondary sm" onClick={() => setPaste(true)}>Dán danh sách từ Excel</button>
            {rooms.length && !selecting ? <button className="btn ghost sm" style={{ color: "var(--danger)" }} onClick={() => setSelecting(true)}>Chọn phòng để xoá</button> : null}
          </div>
        ) : null}

        {rooms.length ? (
          <div className="chips" role="group" aria-label="Lọc phòng">
            {([["", "Tất cả", rooms.length], ["trong", "Trống", stats.c.trong], ["dang_o", "Đang cho thuê", stats.c.dang_o], ["dang_sua", "Đang sửa", stats.c.dang_sua], ["giu_cho", "Giữ chỗ", stats.c.giu_cho]] as ["" | RoomStatus, string, number][])
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
                <button key={r.id} className={`room st-${r.status}${r.room_type_id && colorOf[r.room_type_id] ? ` gc-${colorOf[r.room_type_id]}` : ""}${picked.has(r.id) ? " picked" : ""}`} aria-pressed={selecting ? picked.has(r.id) : undefined}
                  onClick={() => (selecting ? togglePick([r.id]) : setEditing(r))} aria-label={`Phòng ${r.code}, ${ROOM_STATUS[r.status]}`}>
                  <span className="rc">{r.code}</span>
                  <span className="rp num">{vndShort(r.list_price)}{r.rent_mode === "dem" ? "/đêm" : ""}</span>
                  <span className="rs">{r.room_type || "Chưa phân loại"}</span>
                  <span className="rst">{r.status === "dang_o" ? "Đang thuê" : ROOM_STATUS[r.status]}</span>
                </button>
              ))}
            </div>
          </section>
        ))}
        {types.length ? (
          <div className="group-legend" role="group" aria-label="Lọc theo nhóm phòng">
            <span className="small muted">Nhóm phòng (màu nền)</span>
            {types.map((t) => (
              <button key={t.id} type="button" className={`chip gl${colorOf[t.id] ? ` gc-${colorOf[t.id]}` : ""}`} aria-pressed={groupFilter === t.id}
                onClick={() => setGroupFilter(groupFilter === t.id ? "" : t.id)}>
                <i className="gsw" />{t.name}<span className="n">{roomCounts[t.id] ?? 0}</span>
              </button>
            ))}
          </div>
        ) : null}
        <div className="legend small">
          <span className="muted">Tình trạng (viền trái):</span>
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
        <RoomSheet room={editing} building={building} canManage={canManage} types={types}
          onClose={() => setEditing(null)} onSaved={(msg) => { setEditing(null); load(); toast(msg); }} />
      ) : null}
      <RoomTypesSheet open={typesOpen} building={building} types={types} roomCounts={roomCounts}
        onClose={() => setTypesOpen(false)} onChanged={(msg) => { load(); if (msg) toast(msg); }} />
      <BulkSheet open={bulk} building={building} existing={rooms} types={types} onClose={() => setBulk(false)}
        onSaved={(msg) => { setBulk(false); load(); toast(msg); }} />
      <PasteSheet open={paste} building={building} types={types} onClose={() => setPaste(false)}
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

function RoomSheet({ room, building, canManage, types, onClose, onSaved }: {
  room: Partial<Room>; building: Building; canManage: boolean; types: RoomType[]; onClose: () => void; onSaved: (msg: string) => void;
}) {
  const isNew = !room.id;
  const [code, setCode] = useState(room.code ?? "");
  const [floor, setFloor] = useState(room.floor?.toString() ?? "");
  const [typeId, setTypeId] = useState(room.room_type_id ?? "");
  const curType = types.find((t) => t.id === typeId) ?? null;
  const fmt = (n: number) => new Intl.NumberFormat("vi-VN").format(n);
  // Chọn loại → lấy giá, hình thức thuê, số người từ loại (phòng nào khác thì sửa riêng ngay bên dưới)
  function pickType(id: string) {
    setTypeId(id);
    const t = types.find((x) => x.id === id);
    if (!t) return;
    setMode(t.rent_mode);
    if (t.list_price != null) setPrice(fmt(t.list_price));
    if (t.max_occupants != null) setMaxOcc(String(t.max_occupants));
  }
  const [mode, setMode] = useState(room.rent_mode ?? "thang");
  const [price, setPrice] = useState(room.list_price != null ? new Intl.NumberFormat("vi-VN").format(room.list_price) : "");
  const [maxOcc, setMaxOcc] = useState(room.max_occupants?.toString() ?? "");
  const [status, setStatus] = useState<RoomStatus>(room.status ?? "trong");
  const [note, setNote] = useState(room.note ?? "");
  const [furn, setFurn] = useState(room.furniture ?? "");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [confirmDel, setConfirmDel] = useState(false);
  const nav = useNavigate();

  // Phòng đã có hợp đồng hiệu lực chưa? (null = đang kiểm tra)
  const [hasContract, setHasContract] = useState<boolean | null>(isNew ? false : null);
  useEffect(() => {
    if (isNew) return;
    supabase.from("contracts").select("id").eq("room_id", room.id!).eq("status", "hieu_luc").limit(1)
      .then(({ data }) => setHasContract(!!data?.length));
  }, [isNew, room.id]);

  // Chọn "Đang cho thuê" cho phòng thuê tháng chưa có hợp đồng → phải nhập khách, CCCD, hợp đồng
  // Phòng công ty cho nhân viên ở: ghi chú bắt đầu bằng HOME thì không cần khách và hợp đồng
  const isHome = /^home\b/i.test(note.trim());
  const needTenant = status === "dang_o" && mode === "thang" && hasContract === false && canManage && !isNew && !isHome;
  const [tName, setTName] = useState("");
  const [tPhone, setTPhone] = useState("");
  const [tIdNo, setTIdNo] = useState("");
  const [tConsent, setTConsent] = useState(false);
  const [cStart, setCStart] = useState(todayVN());
  const [cRent, setCRent] = useState(room.list_price != null ? new Intl.NumberFormat("vi-VN").format(room.list_price) : "");
  const [cDep, setCDep] = useState("");
  const [fFront, setFFront] = useState<File | null>(null);
  const [fBack, setFBack] = useState<File | null>(null);
  const [fContract, setFContract] = useState<File[]>([]);

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
      if (!fFront || !fBack) { setErr("Cần chụp hoặc chọn ảnh CCCD cả mặt trước và mặt sau."); return; }
      if (!fContract.length) { setErr("Cần tải lên ít nhất một ảnh hoặc file PDF hợp đồng."); return; }
      rentN = r; depN = d;
    }
    setBusy(true);
    // Khi cần lập hợp đồng: lưu phòng trước với trạng thái cũ, hợp đồng sẽ tự chuyển phòng sang "Đang cho thuê"
    const saveStatus = needTenant ? (room.status === "dang_o" ? "dang_o" : (room.status ?? "trong")) : status;
    const row = canManage
      ? { building_id: building.id, code: code.trim().toUpperCase(), floor: floor ? Number(floor) : guessFloor(code),
          room_type_id: typeId || null, room_type: curType?.name ?? (room.room_type_id ? null : room.room_type ?? null),
          rent_mode: mode, list_price: p, max_occupants: maxOcc ? Number(maxOcc) : null, status: saveStatus, note: note.trim() || null,
          furniture: furn.trim() || null }
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
      if (c.error) { setBusy(false); }
      if (c.error) { setErr(`Đã thêm khách nhưng chưa lập được hợp đồng: ${/contracts_one_active/.test(c.error.message) ? "phòng đang có hợp đồng hiệu lực." : friendlyError(c.error)}`); return; }
      // Tải ảnh CCCD và file hợp đồng (cần mã khách / mã hợp đồng nên làm sau khi đã tạo)
      const bid = building.id, failed: string[] = [];
      for (const [f, label] of [[fFront!, "truoc"], [fBack!, "sau"]] as [File, string][]) {
        try { await uploadFile({ kind: "cccd", buildingId: bid, tenantId: t.data.id }, f, { label }); } catch (e) { failed.push(`CCCD: ${friendlyError(e)}`); }
      }
      for (const f of fContract) {
        try { await uploadFile({ kind: "hop_dong", buildingId: bid, contractId: c.data.id }, f); } catch (e) { failed.push(`Hợp đồng: ${friendlyError(e)}`); }
      }
      onSaved(failed.length ? `Đã lưu khách và hợp đồng phòng ${room.code} nhưng chưa tải được: ${failed.join("; ")}. Hãy tải lại ở hồ sơ khách.` : `Đã lưu khách, ảnh CCCD và hợp đồng phòng ${room.code}.`);
      setBusy(false);
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
              <select id="r-type" className="input" value={typeId} onChange={(e) => pickType(e.target.value)}>
                <option value="">{types.length ? "Chưa phân loại" : "Toà chưa có loại — tạo ở nút Loại phòng"}</option>
                {types.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
              </select>
              {curType ? <small className="muted">Giá, số người lấy theo loại. Phòng này khác thì sửa riêng ở dưới.</small> : null}</label>
            {curType ? <RoomTypeCard type={curType} furniture={furn} /> : null}
            <div className="field room-furn">
              <span>Nội thất của phòng này</span>
              {furn.trim() ? (
                <>
                  <textarea id="r-furn" className="input" style={{ minHeight: 110 }} value={furn} onChange={(e) => setFurn(e.target.value)} aria-label="Nội thất riêng của phòng, mỗi dòng một món" />
                  <small className="muted">Mỗi dòng một món. Chỉ phòng này có danh sách riêng, các phòng khác vẫn theo nhóm.</small>
                  <button type="button" className="btn ghost sm" onClick={() => setFurn("")}>Dùng lại nội thất của nhóm</button>
                </>
              ) : (
                <>
                  <small className="muted">{curType?.furniture ? "Đang dùng nội thất của nhóm phòng (hiện ở trên)." : "Chưa có nội thất. Nhóm phòng cũng chưa ghi nội thất."}</small>
                  <button type="button" className="btn secondary sm" onClick={() => setFurn(curType?.furniture?.trim() || "Giường & nệm\nTủ quần áo")}>Nhập nội thất riêng cho phòng này</button>
                </>
              )}
            </div>
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
          <>
            {curType ? <RoomTypeCard type={curType} furniture={room.furniture} /> : null}
            <p className="muted small" style={{ margin: 0 }}>{room.room_type ? `${room.room_type} · ` : ""}{MODE[room.rent_mode ?? "thang"]} · {vnd(room.list_price)}</p>
          </>
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
          {!canManage && status === "dang_o" && room.status !== "dang_o" ? <small style={{ color: "var(--danger)" }}>Chỉ Quản lý hoặc Giám sát toà lập hợp đồng để chuyển phòng sang "Đang cho thuê".</small> : null}
        </div>
        {needTenant ? (
          <section className="fg" aria-label="Khách đang ở">
            <b>Khách đang ở và hợp đồng</b>
            <p className="muted small" style={{ margin: 0 }}>Phòng "Đang cho thuê" cần có khách đứng tên, số CCCD và hợp đồng. Ảnh CCCD hai mặt và file hợp đồng là bắt buộc.</p>
            <label className="field"><span>Họ tên khách *</span><input id="r-tname" className="input" value={tName} onChange={(e) => setTName(e.target.value)} /></label>
            <div className="row" style={{ alignItems: "flex-start" }}>
              <label className="field" style={{ flex: "1 1 150px" }}><span>Số điện thoại</span><input id="r-tphone" className="input" inputMode="tel" value={tPhone} onChange={(e) => setTPhone(e.target.value)} /></label>
              <label className="field" style={{ flex: "1 1 150px" }}><span>Số CCCD *</span><input id="r-tid" className="input num" inputMode="numeric" value={tIdNo} onChange={(e) => setTIdNo(e.target.value.replace(/[^\d\s]/g, ""))} placeholder="12 chữ số" /></label>
            </div>
            <div className="row" style={{ alignItems: "flex-start" }}>
              <label className="field" style={{ flex: "1 1 150px" }}><span>Ảnh CCCD mặt trước *</span>
                <input id="r-cccd-front" className="input" type="file" accept="image/*" onChange={(e) => setFFront(e.target.files?.[0] ?? null)} />
                {fFront ? <small className="muted">{fFront.name}</small> : null}</label>
              <label className="field" style={{ flex: "1 1 150px" }}><span>Ảnh CCCD mặt sau *</span>
                <input id="r-cccd-back" className="input" type="file" accept="image/*" onChange={(e) => setFBack(e.target.files?.[0] ?? null)} />
                {fBack ? <small className="muted">{fBack.name}</small> : null}</label>
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
            <label className="field"><span>File hợp đồng * (ảnh chụp hoặc PDF)</span>
              <input id="r-cfile" className="input" type="file" multiple accept="image/*,application/pdf" onChange={(e) => setFContract([...(e.target.files ?? [])])} />
              {fContract.length ? <small className="muted">{fContract.map((f) => f.name).join(", ")}</small> : null}</label>
          </section>
        ) : null}
        <label className="field"><span>Ghi chú</span>
          <textarea id="r-note" className="input" style={{ minHeight: 60 }} value={note} onChange={(e) => setNote(e.target.value)} />
          {canManage ? <small className="muted">Phòng công ty cho nhân viên ở: ghi HOME ở đầu ghi chú để không phải nhập khách và hợp đồng.</small> : null}</label>
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

function BulkSheet({ open, building, existing, types, onClose, onSaved }: {
  open: boolean; building: Building; existing: Room[]; types: RoomType[]; onClose: () => void; onSaved: (msg: string) => void;
}) {
  const [from, setFrom] = useState("1");
  const [to, setTo] = useState(building.total_floors?.toString() ?? "5");
  const [per, setPer] = useState("6");
  const [start, setStart] = useState("1");
  const [prefix, setPrefix] = useState("");
  const [typeId, setTypeId] = useState("");
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
      building_id: building.id, code: c.code, floor: c.floor, room_type_id: typeId || null, rent_mode: mode, list_price: p,
      max_occupants: types.find((t) => t.id === typeId)?.max_occupants ?? null, status: "trong",
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
          <select id="bk-type" className="input" value={typeId} onChange={(e) => {
            setTypeId(e.target.value);
            const t = types.find((x) => x.id === e.target.value);
            if (t) { setMode(t.rent_mode); if (t.list_price != null) setPrice(new Intl.NumberFormat("vi-VN").format(t.list_price)); }
          }}>
            <option value="">{types.length ? "Chưa phân loại" : "Toà chưa có loại — tạo ở nút Loại phòng"}</option>
            {types.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
          </select></label>
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

function PasteSheet({ open, building, types, onClose, onSaved }: { open: boolean; building: Building; types: RoomType[]; onClose: () => void; onSaved: (msg: string) => void }) {
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const rows = useMemo(() => parseRows(text), [text]);
  const typeOf = (name: string | null) => (name ? types.find((t) => t.name.trim().toLowerCase() === name.trim().toLowerCase()) ?? null : null);

  async function submit() {
    setErr(null);
    if (!rows.length) return;
    setBusy(true);
    const { error } = await supabase.from("rooms").upsert(
      rows.map((r) => {
        const t = typeOf(r.room_type);
        return { building_id: building.id, code: r.code, floor: r.floor, room_type_id: t?.id ?? null, room_type: t?.name ?? r.room_type,
          list_price: r.list_price ?? t?.list_price ?? null, rent_mode: t && r.list_price == null ? t.rent_mode : r.rent_mode };
      }),
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
          Phòng đã có sẽ được cập nhật giá và loại. Tên loại trùng với loại đã tạo (có dấu ✓) sẽ lấy giá và thông tin của loại đó.
        </p>
        <textarea id="paste-rooms" className="input mono" style={{ minHeight: 160 }} value={text} onChange={(e) => setText(e.target.value)}
          placeholder={"101\t1\tStudio\t4.500.000\ttháng\n102\t1\t1PN\t5.200.000\ttháng\n201\t2\tDeluxe\t650.000\tđêm"} />
        {rows.length ? (
          <div className="paste-preview">
            <table>
              <thead><tr><th>Phòng</th><th>Tầng</th><th>Loại</th><th>Giá</th><th>Thuê</th></tr></thead>
              <tbody>
                {rows.slice(0, 50).map((r, i) => (
                  <tr key={i}><td>{r.code}</td><td className="num">{r.floor ?? ""}</td><td>{r.room_type ?? ""}{typeOf(r.room_type) ? " ✓" : ""}</td>
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
