import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { friendlyError, supabase } from "../lib/supabase";
import { useSession } from "../lib/session";
import { useCanEditBuilding } from "../lib/useCanEdit";
import { meterPeriodVN, todayVN } from "../lib/dates";
import { vnd } from "../lib/money";
import { Combo } from "./ui";
import { fileUrls, uploadMeterPhoto, type MeterPhoto, type StoredFile } from "../lib/files";

type Row = {
  room_id: string; contract_id: string | null; occupants: number;
  prev_end: number | null; start_reading: number | null; end_reading: number | null; note: string | null;
  elec_price: number | null; water_amount: number | null;
};
const num = (s: string) => { const t = s.trim().replace(/\s/g, "").replace(",", "."); return t === "" ? null : Number(t); };
const fmt = (n: number | null | undefined) => (n == null ? "" : new Intl.NumberFormat("vi-VN", { maximumFractionDigits: 1 }).format(Number(n)));
type Saved = { id: string; photo_path: string | null; photo_store: "r2" | "supabase" | null; photo_thumb: boolean; taken_at: string | null };
const label = (m: string) => `Tháng ${Number(m.slice(5, 7))}/${m.slice(0, 4)}`;

/** Ghi số điện một phòng, hiện trong khung chi tiết phòng. Dùng chung hàm room_elec_save với bảng ghi điện cả toà. */
export default function RoomElec({ buildingId, roomId, roomCode }: { buildingId: string; roomId: string; roomCode: string }) {
  const { toast, isManager, isSupervisor } = useSession();
  const canEdit = useCanEditBuilding(buildingId);
  const [month, setMonth] = useState(() => meterPeriodVN());
  const [row, setRow] = useState<Row | null | undefined>(undefined);
  const [start, setStart] = useState("");
  const [end, setEnd] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  // Ảnh đồng hồ: ảnh mới chụp (chưa lưu) hoặc ảnh đã lưu của kỳ này
  const [photo, setPhoto] = useState<MeterPhoto | null>(null);
  const [photoUrl, setPhotoUrl] = useState<string | null>(null);
  const [savedUrl, setSavedUrl] = useState<{ thumb: string; full: string; at: string | null } | null>(null);
  const [msg, setMsg] = useState("");
  const [ocr, setOcr] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  const months = useMemo(() => {
    const out: [string, string][] = []; const [y, m] = todayVN().split("-").map(Number);
    for (let i = 0; i < 12; i++) { const d = new Date(Date.UTC(y, m - 1 - i, 1)).toISOString().slice(0, 10); out.push([d, label(d)]); }
    return out;
  }, []);

  const load = useCallback(async () => {
    setRow(undefined); setErr(null); setPhoto(null); setPhotoUrl(null); setSavedUrl(null); setMsg(""); setOcr(false);
    const { data, error } = await supabase.rpc("room_utility_month", { p_building: buildingId, p_period: month });
    if (error) { setErr(friendlyError(error)); setRow(null); return; }
    const r = ((data ?? []) as Row[]).find((x) => x.room_id === roomId) ?? null;
    setRow(r);
    setStart(r?.start_reading != null ? String(r.start_reading) : r?.prev_end != null ? String(r.prev_end) : "");
    setEnd(r?.end_reading != null ? String(r.end_reading) : "");
    // Ảnh đã lưu của kỳ này
    const { data: sv } = await supabase.from("room_elec_readings").select("id,photo_path,photo_store,photo_thumb,taken_at")
      .eq("room_id", roomId).eq("period", month).maybeSingle();
    const x = sv as Saved | null;
    if (x?.photo_path && x.photo_store) {
      const f = { id: x.id, path: x.photo_path, store: x.photo_store, thumb: x.photo_thumb } as unknown as StoredFile;
      const [t, full] = await Promise.all([fileUrls([f], "thumb"), fileUrls([f], "full")]).catch(() => [{}, {}] as Record<string, string>[]);
      if (t[x.id]) setSavedUrl({ thumb: t[x.id], full: full[x.id] ?? t[x.id], at: x.taken_at });
    }
  }, [buildingId, roomId, month]);
  useEffect(() => () => { if (photoUrl) URL.revokeObjectURL(photoUrl); }, [photoUrl]);

  async function pick(f: File | undefined) {
    if (fileRef.current) fileRef.current.value = "";
    if (!f) return;
    setErr(null); setBusy(true); setMsg("Đang lấy vị trí và tải ảnh lên…");
    try {
      const p = await uploadMeterPhoto(buildingId, f);
      setPhoto(p); setPhotoUrl(URL.createObjectURL(f));
      setMsg("Đang đọc số trên đồng hồ…");
      const { data, error } = await supabase.functions.invoke("doc-dong-ho", { body: { image: p.base64, mime: p.mime } });
      const r = (data as { reading?: number | null } | null)?.reading;
      if (!error && typeof r === "number") { setEnd(String(r)); setOcr(true); setMsg("Đã đọc số tự động vào ô Số cuối kỳ. Hãy so với ảnh rồi sửa nếu sai."); }
      else setMsg("Chưa đọc được số tự động. Hãy nhập số cuối kỳ bằng tay.");
    } catch (e) { setPhoto(null); setPhotoUrl(null); setMsg(""); setErr((e as Error).message); }
    setBusy(false);
  }
  useEffect(() => { load(); }, [load]);

  const s = num(start), e = num(end);
  const price = row?.elec_price ?? null;
  const ok = s != null && e != null && !Number.isNaN(s) && !Number.isNaN(e) && e >= s;
  const kwh = ok ? e! - s! : null;
  const changed = !!photo || s !== (row?.start_reading ?? null) || e !== (row?.end_reading ?? null);
  const startEditable = canEdit && (row?.prev_end == null || isManager || isSupervisor);

  async function save() {
    setErr(null);
    if (s == null || Number.isNaN(s) || s < 0) { setErr("Nhập số đầu kỳ."); return; }
    if (e == null || Number.isNaN(e)) { setErr("Nhập số cuối kỳ trên đồng hồ."); return; }
    if (e < s) { setErr(`Số cuối kỳ (${fmt(e)}) nhỏ hơn số đầu kỳ (${fmt(s)}).`); return; }
    setBusy(true);
    const { error } = await supabase.rpc("room_elec_save", {
      p_room: roomId, p_period: month, p_start: s, p_end: e,
      p_note: photo && ocr ? "Đọc tự động từ ảnh, đã kiểm tra" : row?.note ?? null,
      ...(photo ? { p_path: photo.path, p_store: photo.store, p_thumb: photo.thumb, p_lat: photo.geo?.lat ?? null, p_lng: photo.geo?.lng ?? null,
        p_accuracy: photo.geo?.accuracy ?? null, p_taken_at: photo.takenAt } : {}),
    });
    setBusy(false);
    if (error) { setErr(friendlyError(error)); return; }
    toast(`Đã lưu số điện phòng ${roomCode}, ${label(month).toLowerCase()}.`);
    load();
  }

  return (
    <section className="card stack" style={{ padding: 12 }} aria-label={`Số điện phòng ${roomCode}`}>
      <div className="row" style={{ justifyContent: "space-between", alignItems: "center" }}>
        <b>Số điện phòng</b>
        {row && row.contract_id && row.end_reading == null ? <span className="meter-flag">chưa ghi</span> : null}
      </div>
      <label className="field"><span>Kỳ ghi điện</span>
        <Combo id="re-month" value={month} options={months} onChange={setMonth} label="Kỳ ghi điện" /></label>
      {row === undefined ? <div className="loading">Đang tải…</div> : row === null && !err ? (
        <p className="muted small" style={{ margin: 0 }}>Chưa có dữ liệu ghi điện của phòng này. Phòng thuê theo tháng mới ghi số điện.</p>
      ) : row ? (
        <>
          {canEdit ? (
            <div className="field">
              <span>Ảnh đồng hồ điện</span>
              <input ref={fileRef} type="file" accept="image/*" capture="environment" hidden onChange={(ev) => pick(ev.target.files?.[0])} />
              <button type="button" className="btn secondary" disabled={busy} onClick={() => fileRef.current?.click()}>
                {photo || savedUrl ? "Chụp lại ảnh đồng hồ" : "Chụp ảnh đồng hồ"}</button>
              <small className="muted">Chụp rõ dãy số. App ghi giờ, vị trí lên ảnh và tự đọc số vào ô Số cuối kỳ.</small>
            </div>
          ) : null}
          {msg ? <p className="small" role="status" style={{ margin: 0 }}>{msg}</p> : null}
          {photoUrl || savedUrl ? (
            <a className="re-photo" href={photoUrl ?? savedUrl!.full} target="_blank" rel="noreferrer">
              <img src={photoUrl ?? savedUrl!.thumb} alt={`Ảnh đồng hồ điện phòng ${roomCode}`} />
              <span className="small muted">{photoUrl ? "Ảnh mới, chưa lưu" : `Ảnh đã lưu${savedUrl!.at ? ` · ${new Date(savedUrl!.at).toLocaleString("vi-VN", { timeZone: "Asia/Ho_Chi_Minh", day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" })}` : ""}`}</span>
            </a>
          ) : null}
          <div className="row" style={{ alignItems: "flex-start" }}>
            <label className="field" style={{ flex: "1 1 120px" }}><span>Số đầu kỳ{row.prev_end == null && canEdit ? " (cần nhập)" : ""}</span>
              {startEditable ? <input id="re-start" className="input num" inputMode="decimal" value={start} onChange={(ev) => setStart(ev.target.value)} placeholder="Số lúc đầu kỳ" />
                : <div className="input num" aria-readonly="true">{fmt(s) || "—"}</div>}</label>
            <label className="field" style={{ flex: "1 1 120px" }}><span>Số cuối kỳ</span>
              {canEdit ? <input id="re-end" className="input num" inputMode="decimal" value={end} onChange={(ev) => setEnd(ev.target.value)} placeholder="Số trên đồng hồ" />
                : <div className="input num" aria-readonly="true">{fmt(row.end_reading) || "—"}</div>}</label>
          </div>
          <p className="small" style={{ margin: 0 }}>
            {kwh != null ? <>Dùng <b className="num">{fmt(kwh)} kWh</b>{price != null ? <> · tiền điện <b className="num">{vnd(Math.round(kwh * price))}</b> ({vnd(price)}/kWh)</> : " · toà chưa có giá điện (nhập ở Dịch vụ & chính sách)"}</> : <span className="muted">Nhập số cuối kỳ để xem số kWh và tiền điện.</span>}
            {row.water_amount != null ? <> · nước {vnd(row.water_amount)} ({row.occupants} người)</> : null}
          </p>
          {canEdit ? (
            <button type="button" className="btn" disabled={busy || !changed || e == null} onClick={save}>{busy ? "Đang lưu…" : e == null ? "Nhập số cuối kỳ để lưu" : changed ? "Lưu số điện" : "Đã lưu"}</button>
          ) : <p className="muted small" style={{ margin: 0 }}>Bạn chỉ xem. Sale phụ trách toà, Giám sát hoặc Quản lý mới ghi số.</p>}
        </>
      ) : null}
      {err ? <div className="error-box" role="alert">{err}</div> : null}
      <p className="muted small" style={{ margin: 0 }}>Ghi đồng hồ từ ngày 28 đến cuối tháng; số tính vào hoá đơn ngày 1 tháng sau. Số đầu kỳ tự lấy từ số cuối kỳ tháng trước.</p>
    </section>
  );
}
