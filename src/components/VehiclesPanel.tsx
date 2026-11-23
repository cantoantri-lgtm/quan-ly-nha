import { useCallback, useEffect, useState, type FormEvent } from "react";
import { friendlyError, supabase } from "../lib/supabase";
import { useSession } from "../lib/session";
import { ddmmyyyy, todayVN } from "../lib/dates";
import { VEHICLE_KIND, type Vehicle, type VehicleKind } from "../lib/vehicles";
import { Combo } from "./ui";

/* ---------- Xe đăng ký: loại xe, dòng xe, biển số. Thêm / thôi gửi thì số xe tính phí tự cập nhật (SQL 090) ---------- */
export default function VehiclesPanel({ contractId, active, canEdit, onChanged, title = true, startAdding = false }: { contractId: string; active: boolean; canEdit: boolean; onChanged: () => void; title?: boolean; startAdding?: boolean }) {
  const { toast } = useSession();
  const [list, setList] = useState<Vehicle[]>([]);
  const [adding, setAdding] = useState(startAdding && canEdit && active);
  const [kind, setKind] = useState<VehicleKind>("xe_may");
  const [model, setModel] = useState("");
  const [plate, setPlate] = useState("");
  const [busy, setBusy] = useState(false);
  const load = useCallback(async () => {
    const { data } = await supabase.from("contract_vehicles").select("id,kind,model,plate,registered_on").eq("contract_id", contractId).is("removed_on", null).order("created_at");
    setList((data as Vehicle[]) ?? []);
  }, [contractId]);
  useEffect(() => { load(); }, [load]);

  async function add(e: FormEvent) {
    e.preventDefault();
    if (kind !== "xe_dap" && !plate.trim()) { toast("Nhập biển số xe."); return; }
    setBusy(true);
    const { error } = await supabase.from("contract_vehicles").insert({ contract_id: contractId, kind, model: model.trim() || null, plate: plate.trim() || null });
    setBusy(false);
    if (error) { toast(friendlyError(error)); return; }
    toast("Đã đăng ký xe."); setAdding(false); setModel(""); setPlate(""); setKind("xe_may"); load(); onChanged();
  }
  async function remove(v: Vehicle) {
    setBusy(true);
    const { error } = await supabase.from("contract_vehicles").update({ removed_on: todayVN() }).eq("id", v.id);
    setBusy(false);
    if (error) { toast(friendlyError(error)); return; }
    toast(`Đã ghi thôi gửi xe ${v.plate ?? VEHICLE_KIND[v.kind]}.`); load(); onChanged();
  }
  return (
    <section className="stack" style={{ gap: 6 }}>
      <div className="row" style={{ justifyContent: "space-between" }}>
        {title ? <b>Xe đăng ký ({list.length})</b> : <span className="small muted">{list.length} xe đăng ký</span>}
        {canEdit && active && !adding ? <button type="button" className="btn secondary sm" onClick={() => setAdding(true)}>+ Đăng ký xe</button> : null}
      </div>
      {list.length === 0 && !adding ? <small className="muted">Chưa có xe nào. Phí gửi xe trên hoá đơn tính theo số xe đăng ký (trừ xe đạp).</small> : null}
      {list.map((v) => (
        <div key={v.id} className="row" style={{ justifyContent: "space-between", flexWrap: "nowrap", borderTop: "1px solid var(--line)", paddingTop: 6 }}>
          <span style={{ minWidth: 0 }}><b className="num">{v.plate ?? "Không biển"}</b> · {VEHICLE_KIND[v.kind]}{v.model ? ` · ${v.model}` : ""}
            <br /><small className="muted">đăng ký {ddmmyyyy(v.registered_on)}</small></span>
          {canEdit ? <button type="button" className="btn ghost sm" style={{ whiteSpace: "nowrap" }} disabled={busy} onClick={() => remove(v)}>Thôi gửi</button> : null}
        </div>
      ))}
      {adding ? (
        <form className="stack card" style={{ padding: 10, gap: 8 }} onSubmit={add}>
          <label className="field"><span>Loại xe</span>
            <Combo id="veh-kind" value={kind} options={VEHICLE_KIND} onChange={setKind} label="Loại xe" /></label>
          <label className="field"><span>Hãng, dòng xe</span>
            <input id="veh-model" className="input" maxLength={60} value={model} onChange={(e) => setModel(e.target.value)} placeholder="VD: Honda Vision, Airblade" /></label>
          <label className="field"><span>Biển số{kind === "xe_dap" ? "" : " *"}</span>
            <input id="veh-plate" className="input" maxLength={20} autoCapitalize="characters" value={plate} onChange={(e) => setPlate(e.target.value.toUpperCase())} placeholder="VD: 59H1-123.45" /></label>
          <div className="row">
            <button className="btn sm" disabled={busy}>{busy ? "Đang lưu…" : "Lưu xe"}</button>
            <button type="button" className="btn ghost sm" onClick={() => setAdding(false)}>Huỷ</button>
          </div>
        </form>
      ) : null}
    </section>
  );
}

