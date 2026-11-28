import { useEffect, useRef, useState } from "react";
import { supabase } from "../lib/supabase";
import { fileUrls, uploadMeterPhoto, type MeterPhoto, type StoredFile } from "../lib/files";

/** Số điện lúc khách nhận phòng: chụp ảnh đồng hồ (giờ, GPS, tự đọc số) và nhập số. Bắt buộc khi lập hợp đồng thuê tháng. */
export type ElecStart = { reading: string; photo: MeterPhoto | null };
export const emptyElecStart: ElecStart = { reading: "", photo: null };

const toNum = (s: string) => { const t = s.trim().replace(/\s/g, "").replace(",", "."); return t === "" ? null : Number(t); };

/** Lỗi cần báo trước khi lưu, hoặc null nếu đủ */
export function elecStartError(v: ElecStart): string | null {
  if (!v.photo) return "Chụp ảnh đồng hồ điện lúc khách nhận phòng.";
  const n = toNum(v.reading);
  if (n == null || Number.isNaN(n) || n < 0) return "Nhập số điện đầu kỳ (số trên đồng hồ lúc khách nhận phòng).";
  return null;
}

/** Các cột gửi kèm khi lập hợp đồng */
export function elecStartColumns(v: ElecStart) {
  const p = v.photo!;
  return {
    elec_start: toNum(v.reading), elec_start_photo_path: p.path, elec_start_photo_store: p.store, elec_start_photo_thumb: p.thumb,
    elec_start_lat: p.geo?.lat ?? null, elec_start_lng: p.geo?.lng ?? null, elec_start_accuracy: p.geo?.accuracy ?? null,
    elec_start_taken_at: p.takenAt,
  };
}

export default function ElecStartField({ buildingId, value, onChange, idPrefix = "es", disabled }: {
  buildingId: string; value: ElecStart; onChange: (v: ElecStart) => void; idPrefix?: string; disabled?: boolean;
}) {
  const fileRef = useRef<HTMLInputElement>(null);
  const [url, setUrl] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState("");
  useEffect(() => () => { if (url) URL.revokeObjectURL(url); }, [url]);

  async function pick(f: File | undefined) {
    if (fileRef.current) fileRef.current.value = "";
    if (!f) return;
    setBusy(true); setMsg("Đang lấy vị trí và tải ảnh lên…");
    try {
      const p = await uploadMeterPhoto(buildingId, f);
      setUrl(URL.createObjectURL(f));
      setMsg("Đang đọc số trên đồng hồ…");
      const { data, error } = await supabase.functions.invoke("doc-dong-ho", { body: { image: p.base64, mime: p.mime } });
      const r = (data as { reading?: number | null } | null)?.reading;
      const ok = !error && typeof r === "number";
      onChange({ photo: p, reading: ok ? String(r) : value.reading });
      setMsg(ok ? "Đã đọc số tự động. Hãy so với ảnh rồi sửa nếu sai." : "Chưa đọc được số tự động. Hãy nhập số bằng tay.");
    } catch (e) { setMsg((e as Error).message); }
    setBusy(false);
  }

  return (
    <div className="field stack" style={{ gap: 6 }}>
      <span>Số điện lúc nhận phòng *</span>
      <input ref={fileRef} type="file" accept="image/*" capture="environment" hidden onChange={(ev) => pick(ev.target.files?.[0])} />
      <div className="row" style={{ alignItems: "center", flexWrap: "nowrap", gap: 8 }}>
        {url ? <a className="re-photo" href={url} target="_blank" rel="noreferrer"><img src={url} alt="Ảnh đồng hồ điện lúc nhận phòng" /></a> : null}
        <button type="button" className={`btn sm${value.photo ? " secondary" : ""}`} disabled={busy || disabled} onClick={() => fileRef.current?.click()}>
          {busy ? "Đang xử lý…" : value.photo ? "Chụp lại ảnh đồng hồ" : "Chụp ảnh đồng hồ điện"}</button>
      </div>
      <input id={`${idPrefix}-elec`} className="input num" inputMode="decimal" aria-label="Số điện đầu kỳ lúc nhận phòng" placeholder="Số trên đồng hồ (kWh)"
        value={value.reading} onChange={(e) => onChange({ ...value, reading: e.target.value })} disabled={disabled} />
      {msg ? <small role="status">{msg}</small> : null}
      <small className="muted">Bắt buộc khi khách nhận phòng. Số này là số đầu kỳ của kỳ ghi điện đầu tiên của khách.</small>
    </div>
  );
}

/** Hiện số điện lúc nhận phòng trong chi tiết hợp đồng (kèm ảnh nếu có) */
export function ElecStartView({ c }: { c: { id: string; elec_start: number | null; elec_start_photo_path: string | null; elec_start_photo_store: "r2" | "supabase" | null; elec_start_photo_thumb: boolean; elec_start_taken_at: string | null } }) {
  const [img, setImg] = useState<{ thumb: string; full: string } | null>(null);
  useEffect(() => {
    if (!c.elec_start_photo_path || !c.elec_start_photo_store) return;
    const f = { id: c.id, path: c.elec_start_photo_path, store: c.elec_start_photo_store, thumb: c.elec_start_photo_thumb } as unknown as StoredFile;
    Promise.all([fileUrls([f], "thumb"), fileUrls([f], "full")]).then(([t, full]) => { if (t[c.id]) setImg({ thumb: t[c.id], full: full[c.id] ?? t[c.id] }); }).catch(() => undefined);
  }, [c.id, c.elec_start_photo_path, c.elec_start_photo_store, c.elec_start_photo_thumb]);
  if (c.elec_start == null) return null;
  const at = c.elec_start_taken_at ? new Date(c.elec_start_taken_at).toLocaleString("vi-VN", { timeZone: "Asia/Ho_Chi_Minh", day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit" }) : "";
  return (
    <div className="row" style={{ alignItems: "center", gap: 10, flexWrap: "nowrap" }}>
      {img ? <a className="re-photo" href={img.full} target="_blank" rel="noreferrer"><img src={img.thumb} alt="Ảnh đồng hồ điện lúc nhận phòng" /></a> : null}
      <span className="small">Số điện lúc nhận phòng: <b className="num">{new Intl.NumberFormat("vi-VN", { maximumFractionDigits: 1 }).format(Number(c.elec_start))} kWh</b>{at ? <span className="muted"> · chụp {at}</span> : null}</span>
    </div>
  );
}
