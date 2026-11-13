import { useCallback, useEffect, useState, type FormEvent } from "react";
import { useParams } from "react-router-dom";
import { friendlyError, supabase } from "../lib/supabase";
import { useSession } from "../lib/session";
import { todayVN } from "../lib/dates";
import { Empty, Sheet, TopBar } from "../components/ui";
import { fileUrls, uploadMeterPhoto, type MeterPhoto, type StoredFile } from "../lib/files";
import "../feedback.css";

type Row = {
  id: string; building_id: string; kind: "dien" | "nuoc"; period: string; reading: number; photo_path: string;
  photo_store: "r2" | "supabase"; photo_thumb: boolean; lat: number; lng: number; taken_at: string | null; updated_at: string;
};
const num = (n: number) => new Intl.NumberFormat("vi-VN", { maximumFractionDigits: 1 }).format(n);
const monthLabel = (k: string) => `Tháng ${Number(k.slice(5, 7))}/${k.slice(0, 4)}`;
const KIND = { dien: { name: "Điện", unit: "kWh" }, nuoc: { name: "Nước", unit: "m³" } } as const;

/** Mỗi tháng Sale trở lên (Nhân viên, Giám sát, Quản lý của toà) phải ghi số điện và số nước tổng của toà */
export default function BuildingMeters() {
  const { id } = useParams();
  const { buildings } = useSession();
  const building = buildings.find((b) => b.id === id);
  const thisMonth = todayVN().slice(0, 7) + "-01";
  const [rows, setRows] = useState<Row[]>([]);
  const [urls, setUrls] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(true);
  const [sheet, setSheet] = useState<"dien" | "nuoc" | null>(null);

  const load = useCallback(async () => {
    const { data } = await supabase.from("building_meter_readings")
      .select("id,building_id,kind,period,reading,photo_path,photo_store,photo_thumb,lat,lng,taken_at,updated_at")
      .eq("building_id", id!).order("period", { ascending: false }).limit(48);
    const list = (data as Row[] | null) ?? [];
    setRows(list); setLoading(false);
    const u = await fileUrls(list.slice(0, 12).map((m) => ({ id: m.id, path: m.photo_path, store: m.photo_store, thumb: m.photo_thumb } as StoredFile)), "thumb");
    setUrls(u);
  }, [id]);
  useEffect(() => { load(); }, [load]);

  if (!building) return (<><TopBar title="Điện nước toà" back /><main className="main"><Empty title="Không tìm thấy toà này" /></main></>);
  const prevOf = (r: Row) => rows.find((x) => x.kind === r.kind && x.period < r.period);
  const cur = (k: "dien" | "nuoc") => rows.find((r) => r.kind === k && r.period === thisMonth);
  const periods = Array.from(new Set(rows.map((r) => r.period)));

  return (
    <>
      <TopBar title={`Điện nước toà · ${building.code}`} back={`/toa/${building.id}`} />
      <main className="main stack">
        <p className="muted small" style={{ margin: 0 }}>Mỗi tháng phải ghi số điện và số nước tổng của toà. Chụp rõ đồng hồ, bật định vị (GPS) cho trang web.</p>
        <section className="card stack" style={{ padding: 14 }}>
          <b>{monthLabel(thisMonth)}</b>
          {(["dien", "nuoc"] as const).map((k) => {
            const r = cur(k);
            return (
              <div key={k} className="row" style={{ justifyContent: "space-between", flexWrap: "nowrap", gap: 8 }}>
                <span>{KIND[k].name}: {r ? <b className="num">{num(r.reading)} {KIND[k].unit}</b> : <b style={{ color: "var(--danger)" }}>Chưa cập nhật</b>}</span>
                <button className={r ? "btn secondary sm" : "btn sm"} onClick={() => setSheet(k)}>{r ? "Ghi lại" : "Ghi số " + KIND[k].name.toLowerCase()}</button>
              </div>
            );
          })}
        </section>
        {loading ? <div className="loading">Đang tải…</div> : null}
        {!loading && !rows.length ? <Empty title="Chưa có số nào">Bấm "Ghi số điện" hoặc "Ghi số nước" ở trên.</Empty> : null}
        {periods.map((p) => (
          <section key={p} className="card" style={{ padding: 14 }}>
            <b>{monthLabel(p)}</b>
            {(["dien", "nuoc"] as const).map((k) => {
              const r = rows.find((x) => x.kind === k && x.period === p);
              if (!r) return <div key={k} className="small" style={{ marginTop: 6, color: "var(--danger)" }}>{KIND[k].name}: chưa ghi</div>;
              const pr = prevOf(r);
              return (
                <div key={k} style={{ marginTop: 8 }}>
                  <div className="row small" style={{ justifyContent: "space-between", flexWrap: "nowrap" }}>
                    <span>{KIND[k].name}: <b className="num">{num(r.reading)}</b> {KIND[k].unit}</span>
                    <span className="muted">{pr ? `Dùng ${num(r.reading - pr.reading)} ${KIND[k].unit}` : "Số đầu tiên"}</span>
                  </div>
                  {urls[r.id] ? <a href={urls[r.id]} target="_blank" rel="noreferrer"><img src={urls[r.id]} alt={`Ảnh đồng hồ ${KIND[k].name.toLowerCase()} ${monthLabel(p)}`} style={{ width: "100%", maxHeight: 110, objectFit: "cover", borderRadius: 8, marginTop: 4 }} /></a> : null}
                  <a className="small" href={`https://www.google.com/maps?q=${r.lat},${r.lng}`} target="_blank" rel="noreferrer">Xem vị trí chụp</a>
                </div>
              );
            })}
          </section>
        ))}
      </main>
      <MeterSheet open={!!sheet} kind={sheet ?? "dien"} buildingId={building.id} last={sheet ? rows.find((r) => r.kind === sheet && r.period < thisMonth)?.reading ?? null : null}
        onClose={() => setSheet(null)} onDone={() => { setSheet(null); load(); }} />
    </>
  );
}

function MeterSheet({ open, onClose, buildingId, kind, last, onDone }: { open: boolean; onClose: () => void; buildingId: string; kind: "dien" | "nuoc"; last: number | null; onDone: () => void }) {
  const { toast } = useSession();
  const [photo, setPhoto] = useState<MeterPhoto | null>(null);
  const [reading, setReading] = useState(""); const [ocr, setOcr] = useState(false);
  const [msg, setMsg] = useState(""); const [busy, setBusy] = useState(false);
  useEffect(() => { if (!open) { setPhoto(null); setReading(""); setOcr(false); setMsg(""); } }, [open, kind]);

  async function pick(f: File | undefined) {
    if (!f) return;
    setBusy(true); setMsg("Đang lấy vị trí và tải ảnh lên…");
    try {
      const p = await uploadMeterPhoto(buildingId, f);
      setPhoto(p);
      if (kind === "dien") {
        setMsg("Đang đọc số trên đồng hồ…");
        const { data, error } = await supabase.functions.invoke("doc-dong-ho", { body: { image: p.base64, mime: p.mime } });
        const r = (data as { reading?: number | null } | null)?.reading;
        if (!error && typeof r === "number") { setReading(String(r)); setOcr(true); setMsg("Đã đọc tự động. Hãy kiểm tra số với ảnh rồi sửa nếu sai."); }
        else setMsg("Chưa đọc được số tự động. Hãy nhập số bằng tay.");
      } else setMsg("Đã tải ảnh. Nhập số nước.");
    } catch (e) { setPhoto(null); setMsg((e as Error).message); }
    setBusy(false);
  }
  async function save(e: FormEvent) {
    e.preventDefault();
    const v = parseFloat(reading.replace(",", "."));
    if (!photo) { toast("Cần chụp ảnh đồng hồ."); return; }
    if (!Number.isFinite(v)) { toast("Nhập số đồng hồ."); return; }
    setBusy(true);
    const { error } = await supabase.rpc("building_meter_save", {
      p_building: buildingId, p_kind: kind, p_reading: v, p_path: photo.path, p_store: photo.store, p_thumb: photo.thumb,
      p_lat: photo.geo?.lat ?? null, p_lng: photo.geo?.lng ?? null, p_accuracy: photo.geo?.accuracy ?? null, p_taken_at: photo.takenAt,
      p_note: ocr ? "Đọc tự động, đã kiểm tra" : null,
    });
    setBusy(false);
    if (error) { toast(friendlyError(error)); return; }
    toast("Đã ghi số " + (kind === "dien" ? "điện" : "nước") + " của toà."); onDone();
  }
  return (
    <Sheet open={open} onClose={onClose} title={kind === "dien" ? "Số điện của toà" : "Số nước của toà"}>
      <form className="stack" onSubmit={save}>
        <label className="field"><span>Ảnh đồng hồ (chụp rõ dãy số) *</span>
          <input className="input" type="file" accept="image/*" capture="environment" disabled={busy} onChange={(e) => pick(e.target.files?.[0])} /></label>
        {msg ? <p className="small" role="status" style={{ margin: 0 }}>{msg}</p> : null}
        <label className="field"><span>Số trên đồng hồ ({kind === "dien" ? "kWh" : "m³"}){last != null ? ` (số tháng trước: ${num(last)})` : ""} *</span>
          <input className="input" inputMode="decimal" value={reading} onChange={(e) => setReading(e.target.value)} required /></label>
        <button className="btn block" disabled={busy || !photo}>{busy ? "Đang xử lý…" : "Lưu số"}</button>
      </form>
    </Sheet>
  );
}
