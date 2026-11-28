import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useParams } from "react-router-dom";
import { friendlyError, supabase } from "../lib/supabase";
import { useSession } from "../lib/session";
import { useCanEditBuilding } from "../lib/useCanEdit";
import { meterPeriodVN, todayVN } from "../lib/dates";
import { vnd } from "../lib/money";
import { Empty, TopBar } from "../components/ui";
import { fileUrls, uploadMeterPhoto, type MeterPhoto, type StoredFile } from "../lib/files";
import "../reports.css";

type Row = {
  room_id: string; room_code: string; floor: number | null; room_status: string; max_occupants: number | null;
  contract_id: string | null; tenant_name: string | null; occupants: number;
  reading_id: string | null; prev_end: number | null; start_reading: number | null; end_reading: number | null; kwh: number | null; note: string | null;
  elec_price: number | null; elec_amount: number | null; water_price: number | null; water_amount: number | null; updated_at: string | null;
};
type Draft = { start: string; end: string };
type Shot = { p: MeterPhoto; url: string; ocr: boolean };
type SavedPhoto = { thumb: string; full: string };
const num = (s: string) => { const t = s.trim().replace(/\s/g, "").replace(",", "."); return t === "" ? null : Number(t); };
const fmt = (n: number | null | undefined) => (n == null ? "" : new Intl.NumberFormat("vi-VN", { maximumFractionDigits: 1 }).format(Number(n)));
const monthStart = (iso: string) => iso.slice(0, 7) + "-01";

/** Điện nước từng phòng: mỗi tháng ghi số điện cuối kỳ từng phòng; nước khoán theo số người ở (không ghi số nước). */
export default function RoomUtilities({ buildingId, embedded }: { buildingId?: string; embedded?: boolean } = {}) {
  const params = useParams();
  const id = buildingId ?? params.id;
  const { buildings, toast, isManager, isSupervisor } = useSession();
  const building = buildings.find((b) => b.id === id);
  const canEdit = useCanEditBuilding(id);
  const thisMonth = monthStart(todayVN());
  const [month, setMonth] = useState(() => meterPeriodVN());
  const canFixStart = isManager || isSupervisor;
  const Wrap = embedded ? "div" : "main";   // sale chỉ nhập số cuối kỳ khi đã có số tháng trước
  const [rows, setRows] = useState<Row[] | null>(null);
  const [drafts, setDrafts] = useState<Record<string, Draft>>({});
  const [onlyRented, setOnlyRented] = useState(true);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  // Ảnh đồng hồ: ảnh mới chụp theo phòng (bắt buộc khi lưu) và ảnh đã lưu của kỳ
  const [shots, setShots] = useState<Record<string, Shot>>({});
  const [saved, setSaved] = useState<Record<string, SavedPhoto>>({});
  const [shooting, setShooting] = useState<string | null>(null);
  const [rowMsg, setRowMsg] = useState<Record<string, string>>({});
  const fileRef = useRef<HTMLInputElement>(null);
  const target = useRef<string | null>(null);

  const load = useCallback(async () => {
    if (!id) return;
    setRows(null); setShots({}); setSaved({}); setRowMsg({});
    const { data, error } = await supabase.rpc("room_utility_month", { p_building: id, p_period: month });
    if (error) { setErr(friendlyError(error)); setRows([]); return; }
    const list = (data ?? []) as Row[];
    setRows(list);
    setDrafts(Object.fromEntries(list.map((r) => [r.room_id, {
      start: r.start_reading != null ? String(r.start_reading) : r.prev_end != null ? String(r.prev_end) : "",
      end: r.end_reading != null ? String(r.end_reading) : "",
    }])));
    const { data: ph } = await supabase.from("room_elec_readings").select("id,room_id,photo_path,photo_store,photo_thumb")
      .eq("building_id", id).eq("period", month).not("photo_path", "is", null);
    const files = ((ph ?? []) as { id: string; room_id: string; photo_path: string; photo_store: "r2" | "supabase"; photo_thumb: boolean }[])
      .map((x) => ({ room: x.room_id, f: { id: x.id, path: x.photo_path, store: x.photo_store, thumb: x.photo_thumb } as unknown as StoredFile }));
    if (files.length) {
      const [t, full] = await Promise.all([fileUrls(files.map((x) => x.f), "thumb"), fileUrls(files.map((x) => x.f), "full")]).catch(() => [{}, {}] as Record<string, string>[]);
      setSaved(Object.fromEntries(files.filter((x) => t[x.f.id]).map((x) => [x.room, { thumb: t[x.f.id], full: full[x.f.id] ?? t[x.f.id] }])));
    }
  }, [id, month]);

  function shoot(roomId: string) { target.current = roomId; fileRef.current?.click(); }
  async function pick(f: File | undefined) {
    const rid = target.current;
    if (fileRef.current) fileRef.current.value = "";
    if (!f || !id || !rid) return;
    setShooting(rid); setRowMsg((m) => ({ ...m, [rid]: "Đang tải ảnh…" }));
    try {
      const p = await uploadMeterPhoto(id, f);
      setRowMsg((m) => ({ ...m, [rid]: "Đang đọc số…" }));
      const { data, error } = await supabase.functions.invoke("doc-dong-ho", { body: { image: p.base64, mime: p.mime } });
      const v = (data as { reading?: number | null } | null)?.reading;
      const ocr = !error && typeof v === "number";
      if (ocr) setDrafts((cur) => ({ ...cur, [rid]: { ...(cur[rid] ?? { start: "", end: "" }), end: String(v) } }));
      setShots((cur) => { if (cur[rid]) URL.revokeObjectURL(cur[rid].url); return { ...cur, [rid]: { p, url: URL.createObjectURL(f), ocr } }; });
      setRowMsg((m) => ({ ...m, [rid]: ocr ? "Đã đọc số, kiểm tra lại" : "Chưa đọc được, nhập tay" }));
    } catch (e) {
      setRowMsg((m) => ({ ...m, [rid]: (e as Error).message }));
    }
    setShooting(null);
  }
  useEffect(() => { load(); }, [load]);

  const shown = useMemo(() => (rows ?? []).filter((r) => !onlyRented || r.contract_id || r.reading_id), [rows, onlyRented]);
  const priceE = rows?.[0]?.elec_price ?? null, priceW = rows?.[0]?.water_price ?? null;

  // Dòng đã sửa và đủ số thì lưu
  const changed = shown.filter((r) => {
    const d = drafts[r.room_id]; if (!d) return false;
    const s = num(d.start), e = num(d.end);
    if (s == null || e == null) return false;
    if (shots[r.room_id]) return true;
    return s !== (r.start_reading == null ? null : Number(r.start_reading)) || e !== (r.end_reading == null ? null : Number(r.end_reading));
  });
  const missing = changed.filter((r) => !shots[r.room_id]).length;
  const preview = (r: Row) => {
    const d = drafts[r.room_id]; const s = d ? num(d.start) : null, e = d ? num(d.end) : null;
    if (s == null || e == null || Number.isNaN(s) || Number.isNaN(e) || e < s) return null;
    return { kwh: e - s, money: priceE != null ? Math.round((e - s) * priceE) : null };
  };
  const total = shown.reduce((t, r) => {
    const p = preview(r);
    return { kwh: t.kwh + (p?.kwh ?? 0), dien: t.dien + (p?.money ?? 0), nuoc: t.nuoc + Number(r.water_amount ?? 0) };
  }, { kwh: 0, dien: 0, nuoc: 0 });

  async function saveAll() {
    setErr(null);
    for (const r of changed) {
      const d = drafts[r.room_id]; const s = num(d.start)!, e = num(d.end)!;
      if (Number.isNaN(s) || Number.isNaN(e) || s < 0) { setErr(`Phòng ${r.room_code}: số chưa đúng.`); return; }
      if (e < s) { setErr(`Phòng ${r.room_code}: số cuối kỳ (${fmt(e)}) nhỏ hơn số đầu kỳ (${fmt(s)}).`); return; }
    }
    const noPhoto = changed.filter((r) => !shots[r.room_id]);
    if (noPhoto.length) { setErr(`Chụp ảnh đồng hồ phòng ${noPhoto.map((r) => r.room_code).join(", ")} rồi mới lưu được.`); return; }
    setBusy(true);
    for (const r of changed) {
      const d = drafts[r.room_id]; const sh = shots[r.room_id].p;
      const { error } = await supabase.rpc("room_elec_save", {
        p_room: r.room_id, p_period: month, p_start: num(d.start), p_end: num(d.end),
        p_note: shots[r.room_id].ocr ? "Đọc tự động từ ảnh, đã kiểm tra" : r.note,
        p_path: sh.path, p_store: sh.store, p_thumb: sh.thumb, p_lat: sh.geo?.lat ?? null, p_lng: sh.geo?.lng ?? null,
        p_accuracy: sh.geo?.accuracy ?? null, p_taken_at: sh.takenAt,
      });
      if (error) { setBusy(false); setErr(`Phòng ${r.room_code}: ${friendlyError(error)}`); load(); return; }
    }
    setBusy(false);
    toast(`Đã lưu số điện ${changed.length} phòng.`);
    load();
  }

  const months = useMemo(() => {
    const out: string[] = []; const [y, m] = thisMonth.split("-").map(Number);
    for (let i = 0; i < 12; i++) { const d = new Date(Date.UTC(y, m - 1 - i, 1)); out.push(d.toISOString().slice(0, 10)); }
    return out;
  }, [thisMonth]);

  return (
    <>
      {embedded ? null : <TopBar title={`Điện nước phòng${building ? ` · ${building.code}` : ""}`} back={id ? `/toa/${id}` : true} />}
      <Wrap className={embedded ? "stack" : "main stack"}>
        <div className="row" style={{ flexWrap: "wrap", gap: 8, alignItems: "flex-end" }}>
          <label className="field" style={{ flex: "1 1 160px" }}><span>Kỳ ghi điện</span>
            <select className="input" value={month} onChange={(e) => setMonth(e.target.value)}>
              {months.map((m) => <option key={m} value={m}>Tháng {Number(m.slice(5, 7))}/{m.slice(0, 4)}</option>)}
            </select></label>
          <label className="row small" style={{ flex: "1 1 200px", gap: 6, flexWrap: "nowrap" }}>
            <input type="checkbox" checked={onlyRented} onChange={(e) => setOnlyRented(e.target.checked)} />Chỉ phòng đang cho thuê
          </label>
        </div>
        <div className="rpt-kpis">
          <div className="rpt-kpi"><b>{priceE != null ? `${vnd(priceE)}/kWh` : "Chưa có giá"}</b><span>Giá điện{priceE == null ? ": nhập ở Dịch vụ & chính sách (Điện, đơn vị kWh)" : ""}</span></div>
          <div className="rpt-kpi"><b>{priceW != null ? `${vnd(priceW)}/người` : "Chưa có giá"}</b><span>Nước khoán theo người{priceW == null ? ": nhập ở Dịch vụ & chính sách (Nước, đơn vị người)" : ""}</span></div>
        </div>
        {err ? <div className="error-box" role="alert">{err}</div> : null}
        {rows === null ? <div className="loading">Đang tải…</div> : shown.length === 0 ? (
          <Empty title="Không có phòng nào">{onlyRented ? "Toà chưa có phòng nào đang có hợp đồng. Bỏ tích “Chỉ phòng đang cho thuê” để xem tất cả." : "Toà chưa có phòng thuê tháng."}</Empty>
        ) : (
          <div className="pg-card"><div className="dt-wrap"><table className="dt cards meter-cards">
            <thead><tr><th>Phòng</th><th>Ảnh đồng hồ</th><th>Số đầu kỳ</th><th>Số cuối kỳ</th><th>kWh · tiền điện</th><th>Tiền nước</th></tr></thead>
            <tbody>{shown.map((r) => {
              const d = drafts[r.room_id] ?? { start: "", end: "" }; const p = preview(r);
              const set = (k: keyof Draft, v: string) => setDrafts((cur) => ({ ...cur, [r.room_id]: { ...d, [k]: v } }));
              const startEditable = canEdit && (r.prev_end == null || canFixStart);
              return (
                <tr key={r.room_id} className={r.contract_id && r.end_reading == null ? "meter-todo" : undefined}>
                  <td data-label="Phòng"><div className="t1">{r.room_code}{r.end_reading == null && r.contract_id ? <span className="meter-flag"> chưa ghi</span> : null}</div>
                    <div className="t2">{r.tenant_name ?? (r.room_status === "trong" ? "Trống" : "Chưa có hợp đồng")}{r.contract_id ? ` · ${r.occupants}${r.max_occupants ? `/${r.max_occupants}` : ""} người` : ""}</div></td>
                  <td data-label="Ảnh đồng hồ">
                    <div className="meter-shot">
                      {shots[r.room_id] || saved[r.room_id] ? (
                        <a href={shots[r.room_id]?.url ?? saved[r.room_id].full} target="_blank" rel="noreferrer" title={shots[r.room_id] ? "Ảnh mới, chưa lưu" : "Ảnh đã lưu"}>
                          <img src={shots[r.room_id]?.url ?? saved[r.room_id].thumb} alt={`Ảnh đồng hồ phòng ${r.room_code}`} /></a>
                      ) : null}
                      {canEdit ? <button type="button" className={`btn sm${shots[r.room_id] ? " secondary" : ""}`} disabled={!!shooting} onClick={() => shoot(r.room_id)}>
                        {shooting === r.room_id ? "Đang xử lý…" : shots[r.room_id] ? "Chụp lại" : "Chụp"}</button> : null}
                    </div>
                    {rowMsg[r.room_id] ? <div className="t2">{rowMsg[r.room_id]}</div> : null}
                  </td>
                  <td data-label={r.prev_end == null && canEdit ? "Số đầu kỳ (cần nhập)" : "Số đầu kỳ"}>
                    {startEditable ? <input className="input num meter-in" inputMode="decimal" aria-label={`Số đầu kỳ phòng ${r.room_code}`} value={d.start} onChange={(e) => set("start", e.target.value)} placeholder="Số đầu" />
                      : <span className="num">{canEdit ? d.start : fmt(r.start_reading)}</span>}</td>
                  <td data-label="Số cuối kỳ">
                    {canEdit ? <input className="input num meter-in" inputMode="decimal" aria-label={`Số cuối kỳ phòng ${r.room_code}`} value={d.end} onChange={(e) => set("end", e.target.value)} placeholder="Số trên đồng hồ" />
                      : <span className="num">{fmt(r.end_reading)}</span>}</td>
                  <td data-label="kWh · tiền điện"><span className="num">{p ? `${fmt(p.kwh)} kWh${p.money != null ? ` · ${vnd(p.money)}` : ""}` : "—"}</span></td>
                  <td data-label="Tiền nước"><span className="num">{r.water_amount != null ? vnd(r.water_amount) : "—"}</span></td>
                </tr>
              );
            })}</tbody>
          </table></div>
          <div className="row meter-total"><span>Cộng</span><span className="num">{fmt(total.kwh)} kWh · điện {vnd(total.dien)} · nước {vnd(total.nuoc)}</span></div></div>
        )}
        {canEdit && shown.length ? (
          <button className="btn block meter-save" disabled={busy || !changed.length || missing > 0} onClick={saveAll}>{busy ? "Đang lưu…" : missing ? `Còn ${missing} phòng chưa chụp ảnh đồng hồ` : changed.length ? `Lưu số điện ${changed.length} phòng` : "Chưa có số nào thay đổi"}</button>
        ) : null}
        {canEdit ? <input ref={fileRef} type="file" accept="image/*" capture="environment" hidden onChange={(ev) => pick(ev.target.files?.[0])} /> : null}
        <p className="muted small" style={{ margin: 0 }}>
          Mỗi phòng phải chụp ảnh đồng hồ mới lưu được số; app ghi giờ, vị trí lên ảnh và tự đọc số vào ô Số cuối kỳ.
          Ghi đồng hồ từ ngày 28 đến cuối tháng; số này tính vào hoá đơn ngày 1 tháng sau. Số đầu kỳ tự lấy từ số cuối kỳ tháng trước. Phòng chưa có số tháng trước (phòng mới, khách mới vào) thì nhập cả số đầu kỳ (số lúc khách vào ở) và số cuối kỳ. Thay đồng hồ thì báo Giám sát hoặc Quản lý sửa số đầu kỳ. Hoá đơn tháng sau đã lập mà chưa thu sẽ tự tính lại tiền điện. Tiền điện = (số cuối kỳ − số đầu kỳ) × giá điện.
          Tiền nước = số người đang ở × giá nước/người (không ghi số nước). Số người lấy theo mục “Người ở” trong hợp đồng.
          {canEdit ? "" : " Bạn chỉ xem: sale phòng Kinh doanh phụ trách toà, Giám sát hoặc Quản lý mới ghi số."}
        </p>
      </Wrap>
    </>
  );
}
