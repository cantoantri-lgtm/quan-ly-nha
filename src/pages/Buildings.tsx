import { useEffect, useState, type FormEvent } from "react";
import { useNavigate } from "react-router-dom";
import { friendlyError, supabase } from "../lib/supabase";
import { useSession } from "../lib/session";
import { KIND_LABEL, type Building } from "../lib/labels";
import { Empty, Sheet, TopBar } from "../components/ui";

export default function Buildings() {
  const { buildings, reloadBase, toast } = useSession();
  const [editing, setEditing] = useState<Partial<Building> | null>(null);
  const [counts, setCounts] = useState<Record<string, number>>({});
  const [roomCounts, setRoomCounts] = useState<Record<string, number>>({});
  const nav = useNavigate();

  useEffect(() => {
    supabase.from("building_members").select("building_id").then(({ data }) => {
      const m: Record<string, number> = {};
      (data ?? []).forEach((r: { building_id: string }) => { m[r.building_id] = (m[r.building_id] ?? 0) + 1; });
      setCounts(m);
    });
    supabase.from("rooms").select("building_id").then(({ data }) => {
      const m: Record<string, number> = {};
      (data ?? []).forEach((r: { building_id: string }) => { m[r.building_id] = (m[r.building_id] ?? 0) + 1; });
      setRoomCounts(m);
    });
  }, [buildings]);

  return (
    <>
      <TopBar title="Toà nhà" back="/quan-tri" action={<button className="tb-action" onClick={() => setEditing({ kind: "hon_hop" })}>+ Thêm</button>} />
      <main className="main stack">
        {buildings.length === 0 ? (
          <Empty title="Chưa có toà nhà nào">Thêm toà để gán nhân sự và gắn công việc theo toà.</Empty>
        ) : (
          <section className="card">
            {buildings.map((b) => (
              <div key={b.id} className="list-row" role="button" tabIndex={0} onClick={() => nav(`/toa/${b.id}`)} onKeyDown={(e) => e.key === "Enter" && nav(`/toa/${b.id}`)}>
                <span className="tag" style={{ fontSize: 13 }}>{b.code}</span>
                <div className="grow">
                  <div className="name">{b.name}</div>
                  <div className="sub">{KIND_LABEL[b.kind]}{b.address ? ` · ${b.address}` : ""}</div>
                </div>
                <span className="muted small num" style={{ textAlign: "right" }}>{roomCounts[b.id] ?? 0} phòng<br />{counts[b.id] ?? 0} người</span>
              </div>
            ))}
          </section>
        )}
        <p className="muted small">Bấm vào toà để xem và thêm phòng, giá thuê. Khách thuê và hợp đồng sẽ có ở module Cho thuê.</p>
      </main>
      {editing ? (
        <BuildingSheet value={editing} onClose={() => setEditing(null)}
          onSaved={async (msg) => { setEditing(null); await reloadBase(); toast(msg); }} />
      ) : null}
    </>
  );
}

export function BuildingSheet({ value, onClose, onSaved, onDeleted, roomCount }: {
  value: Partial<Building>; onClose: () => void; onSaved: (msg: string) => void; onDeleted?: (msg: string) => void; roomCount?: number;
}) {
  const [code, setCode] = useState(value.code ?? "");
  const [name, setName] = useState(value.name ?? "");
  const [address, setAddress] = useState(value.address ?? "");
  const [kind, setKind] = useState(value.kind ?? "hon_hop");
  const [floors, setFloors] = useState(value.total_floors?.toString() ?? "");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [delOpen, setDelOpen] = useState(false);
  const [confirmCode, setConfirmCode] = useState("");

  async function removeBuilding() {
    setErr(null); setBusy(true);
    const { data, error } = await supabase.rpc("delete_building", { p_id: value.id });
    setBusy(false);
    if (error) { setErr(error.message); return; }
    const r = data as { code: string; rooms: number; tasks_unlinked: number };
    onDeleted?.(`Đã xoá toà ${r.code} và ${r.rooms} phòng.${r.tasks_unlinked ? ` ${r.tasks_unlinked} việc đã giao được giữ lại, bỏ gắn toà.` : ""}`);
  }

  async function submit(e: FormEvent) {
    e.preventDefault();
    setErr(null); setBusy(true);
    const row = { code: code.trim().toUpperCase(), name: name.trim(), address: address.trim() || null, kind, total_floors: floors ? Number(floors) : null };
    const { error } = value.id
      ? await supabase.from("buildings").update(row).eq("id", value.id)
      : await supabase.from("buildings").insert(row);
    setBusy(false);
    if (error) { setErr(friendlyError(error)); return; }
    onSaved(value.id ? "Đã lưu toà nhà." : "Đã thêm toà nhà.");
  }

  return (
    <Sheet open onClose={onClose} title={value.id ? `Sửa ${value.code}` : "Thêm toà nhà"}>
      <form className="stack" onSubmit={submit}>
        <div className="row" style={{ alignItems: "flex-start" }}>
          <label className="field" style={{ flex: "1 1 120px" }}><span>Mã toà *</span>
            <input id="b-code" className="input" value={code} onChange={(e) => setCode(e.target.value)} placeholder="89CMT8" required /></label>
          <label className="field" style={{ flex: "1 1 120px" }}><span>Số tầng</span>
            <input id="b-floors" className="input" inputMode="numeric" value={floors} onChange={(e) => setFloors(e.target.value.replace(/\D/g, ""))} /></label>
        </div>
        <label className="field"><span>Tên toà *</span>
          <input id="b-name" className="input" value={name} onChange={(e) => setName(e.target.value)} placeholder="Toà 89 Cách Mạng Tháng 8" required /></label>
        <label className="field"><span>Địa chỉ</span>
          <input id="b-addr" className="input" value={address} onChange={(e) => setAddress(e.target.value)} /></label>
        <label className="field"><span>Loại hình</span>
          <select id="b-kind" className="input" value={kind} onChange={(e) => setKind(e.target.value)}>
            {Object.entries(KIND_LABEL).map(([k, l]) => <option key={k} value={k}>{l}</option>)}
          </select></label>
        {err ? <div className="error-box" role="alert">{err}</div> : null}
        <button className="btn block" disabled={busy}>{busy ? "Đang lưu…" : "Lưu"}</button>
        {value.id && onDeleted ? (
          delOpen ? (
            <div className="danger-zone">
              <p>Xoá toà <b>{value.code}</b> sẽ xoá luôn {roomCount != null ? <b>{roomCount} phòng</b> : "các phòng"} và danh sách nhân sự của toà. Việc đã giao vẫn giữ nhưng bỏ gắn toà. Không khôi phục được.</p>
              <label className="field"><span>Gõ <b>{value.code}</b> để xác nhận</span>
                <input id="b-del-confirm" className="input" value={confirmCode} onChange={(e) => setConfirmCode(e.target.value)} autoComplete="off" /></label>
              <div className="row">
                <button type="button" className="btn secondary" style={{ flex: 1 }} onClick={() => { setDelOpen(false); setConfirmCode(""); }}>Giữ lại</button>
                <button type="button" className="btn danger" style={{ flex: 1 }} disabled={busy || confirmCode.trim().toUpperCase() !== (value.code ?? "").toUpperCase()} onClick={removeBuilding}>Xoá toà</button>
              </div>
            </div>
          ) : <button type="button" className="btn ghost" style={{ color: "var(--danger)" }} onClick={() => setDelOpen(true)}>Xoá toà nhà</button>
        ) : null}
      </form>
    </Sheet>
  );
}
