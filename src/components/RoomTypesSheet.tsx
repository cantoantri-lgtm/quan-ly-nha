import { useMemo, useState, type FormEvent } from "react";
import { friendlyError, supabase } from "../lib/supabase";
import { parseMoney, vnd } from "../lib/money";
import { listFiles, removeFile } from "../lib/files";
import { furnitureList, type RoomType } from "../lib/roomTypes";
import type { Building } from "../lib/labels";
import FileGallery from "./FileGallery";
import { Sheet } from "./ui";
import "../roomtype.css";

type Draft = {
  id: string | null; name: string; area: string; mode: "thang" | "dem"; price: string; max: string; furniture: string; description: string; apply: boolean;
};
const fmtMoney = (n: number | null) => (n != null ? new Intl.NumberFormat("vi-VN").format(n) : "");
const toDraft = (t: RoomType | null, building: Building): Draft => t
  ? { id: t.id, name: t.name, area: t.area_m2 != null ? String(t.area_m2).replace(".", ",") : "", mode: t.rent_mode, price: fmtMoney(t.list_price),
      max: t.max_occupants?.toString() ?? "", furniture: t.furniture ?? "", description: t.description ?? "", apply: true }
  : { id: null, name: "", area: "", mode: building.kind === "khach_san" ? "dem" : "thang", price: "", max: "", furniture: "", description: "", apply: true };

/** Danh sách và biểu mẫu loại phòng của một toà (dành cho Quản lý / Giám sát toà) */
export default function RoomTypesSheet({ open, building, types, roomCounts, onClose, onChanged }: {
  open: boolean; building: Building; types: RoomType[]; roomCounts: Record<string, number>; onClose: () => void; onChanged: (msg?: string) => void;
}) {
  const [draft, setDraft] = useState<Draft | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [confirmDel, setConfirmDel] = useState(false);
  const n = draft?.id ? roomCounts[draft.id] ?? 0 : 0;
  const cur = useMemo(() => types.find((t) => t.id === draft?.id) ?? null, [types, draft?.id]);

  function close() { setDraft(null); setErr(null); setConfirmDel(false); onClose(); }

  async function save(e: FormEvent) {
    e.preventDefault();
    if (!draft) return;
    setErr(null);
    const name = draft.name.trim();
    if (!name) { setErr("Nhập tên loại phòng."); return; }
    const price = draft.price.trim() ? parseMoney(draft.price) : null;
    if (draft.price.trim() && price == null) { setErr("Giá chưa đúng. Nhập dạng 4500000, 4.500.000 hoặc 4,5tr."); return; }
    const area = draft.area.trim() ? Number(draft.area.replace(",", ".")) : null;
    if (area != null && (!Number.isFinite(area) || area <= 0)) { setErr("Diện tích chưa đúng."); return; }
    const row = {
      building_id: building.id, name, area_m2: area, rent_mode: draft.mode, list_price: price,
      max_occupants: draft.max ? Number(draft.max) : null, furniture: draft.furniture.trim() || null, description: draft.description.trim() || null,
    };
    setBusy(true);
    if (!draft.id) {
      const r = await supabase.from("room_types").insert(row).select("id").single();
      setBusy(false);
      if (r.error) { setErr(/duplicate/i.test(r.error.message) ? `Toà này đã có loại "${name}".` : friendlyError(r.error)); return; }
      onChanged(`Đã tạo loại ${name}. Thêm ảnh ở bên dưới.`);
      setDraft({ ...draft, id: r.data.id });
      return;
    }
    const r = await supabase.from("room_types").update(row).eq("id", draft.id);
    if (r.error) { setBusy(false); setErr(/duplicate/i.test(r.error.message) ? `Toà này đã có loại "${name}".` : friendlyError(r.error)); return; }
    let msg = `Đã lưu loại ${name}.`;
    if (draft.apply && n > 0) {
      // Chỉ áp những giá trị có nhập; phòng nào cần khác thì sửa riêng ở phòng đó
      const patch: Record<string, unknown> = { rent_mode: draft.mode };
      if (price != null) patch.list_price = price;
      if (row.max_occupants != null) patch.max_occupants = row.max_occupants;
      const u = await supabase.from("rooms").update(patch).eq("room_type_id", draft.id);
      if (u.error) { setBusy(false); setErr(`Đã lưu loại nhưng chưa áp được cho các phòng: ${friendlyError(u.error)}`); return; }
      msg = `Đã lưu loại ${name} và áp giá cho ${n} phòng.`;
    }
    setBusy(false);
    onChanged(msg);
    setDraft(null);
  }

  async function remove() {
    if (!draft?.id) return;
    setBusy(true);
    try {
      // Xoá ảnh trong kho trước (dòng dữ liệu ảnh sẽ tự xoá theo loại)
      for (const f of await listFiles("anh_loai_phong", "room_type_id", draft.id)) await removeFile(f);
    } catch { /* ảnh còn sót không chặn việc xoá loại */ }
    const r = await supabase.from("room_types").delete().eq("id", draft.id);
    setBusy(false);
    if (r.error) { setErr(friendlyError(r.error)); setConfirmDel(false); return; }
    onChanged(`Đã xoá loại ${draft.name}. ${n} phòng giữ nguyên giá, chỉ bỏ phân loại.`);
    setDraft(null); setConfirmDel(false);
  }

  return (
    <Sheet open={open} onClose={close} title={draft ? (draft.id ? `Loại phòng · ${draft.name || "…"}` : "Thêm loại phòng") : `Loại phòng · ${building.code}`}>
      {draft ? (
        <form className="stack" onSubmit={save}>
          <label className="field"><span>Tên loại *</span>
            <input id="rt-name" className="input" value={draft.name} onChange={(e) => setDraft({ ...draft, name: e.target.value })} placeholder="VD: Studio, 1PN, Deluxe" required /></label>
          <div className="row" style={{ alignItems: "flex-start" }}>
            <label className="field" style={{ flex: "1 1 120px" }}><span>Diện tích (m²)</span>
              <input id="rt-area" className="input num" inputMode="decimal" value={draft.area} onChange={(e) => setDraft({ ...draft, area: e.target.value.replace(/[^\d,.]/g, "") })} placeholder="VD: 28" /></label>
            <label className="field" style={{ flex: "1 1 120px" }}><span>Số người tối đa</span>
              <input id="rt-max" className="input" inputMode="numeric" value={draft.max} onChange={(e) => setDraft({ ...draft, max: e.target.value.replace(/\D/g, "") })} /></label>
          </div>
          <div className="row" style={{ alignItems: "flex-start" }}>
            <label className="field" style={{ flex: "1 1 130px" }}><span>Cho thuê</span>
              <select id="rt-mode" className="input" value={draft.mode} onChange={(e) => setDraft({ ...draft, mode: e.target.value as "thang" | "dem" })}>
                <option value="thang">Theo tháng</option><option value="dem">Theo đêm</option></select></label>
            <label className="field" style={{ flex: "1 1 160px" }}><span>Giá {draft.mode === "dem" ? "1 đêm" : "1 tháng"}</span>
              <input id="rt-price" className="input num" inputMode="decimal" value={draft.price} onChange={(e) => setDraft({ ...draft, price: e.target.value })} placeholder="VD: 4.500.000 hoặc 4,5tr" />
              {draft.price && parseMoney(draft.price) != null ? <small className="muted">{vnd(parseMoney(draft.price))}</small> : null}</label>
          </div>
          <label className="field"><span>Nội thất (mỗi dòng một món)</span>
            <textarea id="rt-furn" className="input" style={{ minHeight: 90 }} value={draft.furniture} onChange={(e) => setDraft({ ...draft, furniture: e.target.value })} placeholder={"Giường 1m6\nTủ quần áo\nMáy lạnh\nBếp từ"} />
            {furnitureList(draft.furniture).length ? <small className="muted">{furnitureList(draft.furniture).length} món</small> : null}</label>
          <label className="field"><span>Mô tả</span>
            <textarea id="rt-desc" className="input" style={{ minHeight: 60 }} value={draft.description} onChange={(e) => setDraft({ ...draft, description: e.target.value })} placeholder="VD: Cửa sổ lớn, ban công" /></label>
          {draft.id ? (
            <FileGallery owner={{ kind: "anh_loai_phong", buildingId: building.id, roomTypeId: draft.id }} title="Ảnh loại phòng" pdf={false} cover canUpload canDelete
              hint={'Ảnh có nhãn "Đại diện" hiện đầu tiên khi mở phòng thuộc loại này.'} />
          ) : <p className="muted small" style={{ margin: 0 }}>Bấm Tạo loại, sau đó thêm ảnh.</p>}
          {draft.id && n > 0 ? (
            <label className="check-row"><input type="checkbox" checked={draft.apply} onChange={(e) => setDraft({ ...draft, apply: e.target.checked })} />
              Áp giá, số người, hình thức thuê này cho {n} phòng thuộc loại</label>
          ) : null}
          {err ? <div className="error-box" role="alert">{err}</div> : null}
          <button className="btn block" disabled={busy}>{busy ? "Đang lưu…" : draft.id ? "Lưu" : "Tạo loại"}</button>
          <button type="button" className="btn ghost" onClick={() => { setDraft(null); setErr(null); setConfirmDel(false); }}>Về danh sách</button>
          {draft.id && cur ? (
            confirmDel ? (
              <div className="row">
                <span className="small" style={{ flex: 1 }}>Xoá loại {cur.name}? {n} phòng chỉ bị bỏ phân loại.</span>
                <button type="button" className="btn secondary sm" onClick={() => setConfirmDel(false)}>Giữ lại</button>
                <button type="button" className="btn danger sm" disabled={busy} onClick={remove}>Xoá</button>
              </div>
            ) : <button type="button" className="btn ghost" style={{ color: "var(--danger)" }} onClick={() => setConfirmDel(true)}>Xoá loại phòng</button>
          ) : null}
        </form>
      ) : (
        <div className="stack">
          <p className="muted small" style={{ margin: 0 }}>Mỗi loại có chung ảnh, diện tích, nội thất, giá. Khi thêm hoặc sửa phòng chỉ cần chọn loại.</p>
          {types.length ? (
            <ul className="rt-list">
              {types.map((t) => (
                <li key={t.id}>
                  <button type="button" className="rt-item" onClick={() => { setErr(null); setDraft(toDraft(t, building)); }}>
                    <span><b>{t.name}</b>
                      <span>{[t.area_m2 != null ? `${String(t.area_m2).replace(".", ",")} m²` : "", t.list_price != null ? `${vnd(t.list_price)}${t.rent_mode === "dem" ? "/đêm" : "/tháng"}` : "Chưa có giá"].filter(Boolean).join(" · ")}</span></span>
                    <span className="rt-count">{roomCounts[t.id] ?? 0} phòng</span>
                  </button>
                </li>
              ))}
            </ul>
          ) : <p className="muted" style={{ margin: 0 }}>Toà này chưa có loại phòng nào.</p>}
          <button className="btn block" onClick={() => { setErr(null); setDraft(toDraft(null, building)); }}>+ Thêm loại phòng</button>
        </div>
      )}
    </Sheet>
  );
}
