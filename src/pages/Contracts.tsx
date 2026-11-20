import { useCallback, useEffect, useMemo, useState, type FormEvent } from "react";
import { Link, useParams, useSearchParams } from "react-router-dom";
import { friendlyError, supabase } from "../lib/supabase";
import { useSession } from "../lib/session";
import { useCanEditBuilding } from "../lib/useCanEdit";
import { ddmmyyyy, todayVN } from "../lib/dates";
import { naturalCompare, parseMoney, vnd } from "../lib/money";
import { Empty, Sheet, TopBar, Combo } from "../components/ui";
import FileGallery from "../components/FileGallery";
import ContractQR from "../components/ContractQR";
import { ContractTerm } from "../components/ContractTerm";
import { uploadFile } from "../lib/files";
import type { Room } from "./BuildingDetail";
import { ID_NAME, ID_PHOTOS, ID_TYPES, idError, normId, type IdType } from "../lib/idDoc";
import "../files.css";

type Contract = {
  id: string; code: string | null; room_id: string; building_id: string; tenant_id: string; start_date: string; end_date: string | null;
  rent_amount: number; deposit_amount: number; deposit_status: "chua_thu" | "da_thu" | "da_hoan"; billing_day: number;
  status: "hieu_luc" | "da_ket_thuc" | "da_huy"; sign_method: "giay" | "dien_tu" | null; signed_on: string | null; note: string | null;
  vehicles: number;
  rooms: { code: string } | null; tenants: { full_name: string } | null;
};
const ST: Record<Contract["status"], string> = { hieu_luc: "Hiệu lực", da_ket_thuc: "Đã kết thúc", da_huy: "Đã huỷ" };
const DEP: Record<Contract["deposit_status"], string> = { chua_thu: "Chưa thu cọc", da_thu: "Đã thu cọc", da_hoan: "Đã hoàn cọc" };
const SIGN = { giay: "Ký giấy", dien_tu: "Ký điện tử" } as const;
const SELECT = "*, rooms(code), tenants(full_name)";

export default function Contracts() {
  const { id } = useParams();
  const [sp, setSp] = useSearchParams();
  const { buildings, isManager, isSupervisor, myBuildingIds } = useSession();
  const building = buildings.find((b) => b.id === id);
  const canManage = isManager || (isSupervisor && !!id && myBuildingIds.includes(id));   // hoàn cọc
  const canEdit = useCanEditBuilding(id);                                                 // lập, sửa hợp đồng, tải file: thêm sale phụ trách toà
  const [list, setList] = useState<Contract[]>([]);
  const [all, setAll] = useState(false);
  const [adding, setAdding] = useState(false);
  const [loading, setLoading] = useState(true);
  const openId = sp.get("mo");

  const load = useCallback(async () => {
    const { data } = await supabase.from("contracts").select(SELECT).eq("building_id", id!).order("start_date", { ascending: false });
    setList((data as unknown as Contract[]) ?? []);
    setLoading(false);
  }, [id]);
  useEffect(() => { load(); }, [load]);

  const [noEnd, setNoEnd] = useState(false);
  const missing = useMemo(() => list.filter((c) => c.status === "hieu_luc" && !c.end_date), [list]);
  const shown = useMemo(() => (noEnd ? missing : list.filter((c) => all || c.status === "hieu_luc")), [list, all, noEnd, missing]);
  const opened = list.find((c) => c.id === openId) ?? null;

  if (!building) return (<><TopBar title="Hợp đồng" back /><main className="main"><Empty title="Không tìm thấy toà này" /></main></>);
  return (
    <>
      <TopBar title={`Hợp đồng · ${building.code}`} back={`/toa/${building.id}`}
        action={canEdit ? <button className="tb-action" onClick={() => setAdding(true)}>+ Hợp đồng</button> : null} />
      <main className="main stack">
        <div className="chips" role="group" aria-label="Lọc hợp đồng">
          <button className="chip" aria-pressed={!all && !noEnd} onClick={() => { setAll(false); setNoEnd(false); }}>Đang hiệu lực<span className="n">{list.filter((c) => c.status === "hieu_luc").length}</span></button>
          <button className="chip" aria-pressed={all && !noEnd} onClick={() => { setAll(true); setNoEnd(false); }}>Tất cả<span className="n">{list.length}</span></button>
          {missing.length ? <button className="chip" aria-pressed={noEnd} onClick={() => setNoEnd(true)}>Thiếu ngày kết thúc<span className="n">{missing.length}</span></button> : null}
        </div>
        {missing.length && !noEnd ? (
          <div className="sheet-nudge" role="status" style={{ margin: 0 }}>
            {missing.length} hợp đồng đang hiệu lực chưa có ngày kết thúc nên app không nhắc được hợp đồng sắp hết hạn.{" "}
            <button type="button" className="btn ghost sm" style={{ minHeight: 28, padding: "2px 6px", color: "inherit", textDecoration: "underline" }} onClick={() => setNoEnd(true)}>Xem và bổ sung</button>
          </div>
        ) : null}
        {loading ? <div className="loading">Đang tải…</div> : shown.length === 0 ? (
          <Empty title="Chưa có hợp đồng">{canEdit ? "Bấm \"+ Hợp đồng\" để lập hợp đồng cho phòng. Cần có khách thuê trước (mục Khách thuê)." : undefined}</Empty>
        ) : (
          <section className="card">
            {shown.map((c) => (
              <div key={c.id} className="list-row" role="button" tabIndex={0} onClick={() => setSp({ mo: c.id })} onKeyDown={(e) => e.key === "Enter" && setSp({ mo: c.id })}>
                <div className="grow">
                  <div className="name">Phòng {c.rooms?.code} · {c.tenants?.full_name}</div>
                  <div className="sub">{ddmmyyyy(c.start_date)} → {c.end_date ? ddmmyyyy(c.end_date) : <b style={{ color: "var(--late)" }}>chưa có ngày kết thúc</b>} · {vnd(c.rent_amount)}/tháng</div>
                </div>
                <span className={`tag ${c.status === "hieu_luc" ? "st-ok" : ""}`}>{ST[c.status]}</span>
              </div>
            ))}
          </section>
        )}
      </main>
      {adding ? <NewContract buildingId={building.id} onClose={() => setAdding(false)} onSaved={(cid) => { setAdding(false); load(); setSp({ mo: cid }); }} /> : null}
      {opened ? <ContractView c={opened} canManage={canManage} canEdit={canEdit} onClose={() => setSp({})} onChanged={load} /> : null}
    </>
  );
}

function NewContract({ buildingId, onClose, onSaved }: { buildingId: string; onClose: () => void; onSaved: (id: string) => void }) {
  const { toast } = useSession();
  const [rooms, setRooms] = useState<Room[]>([]);
  const [tenants, setTenants] = useState<{ id: string; full_name: string; phone: string | null }[]>([]);
  const [roomId, setRoomId] = useState("");
  const [tenantId, setTenantId] = useState("");
  const [code, setCode] = useState("");
  const [start, setStart] = useState(todayVN());
  const [end, setEnd] = useState("");
  const [rent, setRent] = useState("");
  const [deposit, setDeposit] = useState("");
  const [billing, setBilling] = useState("5");
  const [vehicles, setVehicles] = useState("0");
  const [sign, setSign] = useState<"" | "giay" | "dien_tu">("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    Promise.all([
      supabase.from("rooms").select("*").eq("building_id", buildingId).eq("rent_mode", "thang").neq("status", "dang_o"),
      supabase.from("tenants").select("id,full_name,phone").eq("building_id", buildingId).order("full_name"),
    ]).then(([r, t]) => {
      setRooms(((r.data as Room[]) ?? []).sort((a, b) => naturalCompare(a.code, b.code)));
      setTenants((t.data as typeof tenants) ?? []);
    });
  }, [buildingId]);

  function pickRoom(v: string) {
    setRoomId(v);
    const r = rooms.find((x) => x.id === v);
    if (r?.list_price && !rent) setRent(new Intl.NumberFormat("vi-VN").format(r.list_price));
  }

  async function submit(e: FormEvent) {
    e.preventDefault(); setErr(null);
    const rentN = parseMoney(rent), depN = deposit.trim() ? parseMoney(deposit) : 0;
    if (!roomId || !tenantId) { setErr("Chọn phòng và khách thuê."); return; }
    if (rentN == null) { setErr("Nhập giá thuê tháng, VD 4.500.000 hoặc 4,5tr."); return; }
    if (depN == null) { setErr("Tiền cọc chưa đúng."); return; }
    if (!start || !end) { setErr("Nhập ngày hiệu lực hợp đồng: từ ngày và đến ngày."); return; }
    if (end < start) { setErr("Ngày kết thúc phải sau ngày bắt đầu."); return; }
    setBusy(true);
    const { data, error } = await supabase.from("contracts").insert({
      room_id: roomId, tenant_id: tenantId, code: code.trim() || null, start_date: start, end_date: end || null,
      rent_amount: rentN, deposit_amount: depN, billing_day: Number(billing) || 5, vehicles: Number(vehicles) || 0,
      sign_method: sign || null, signed_on: sign ? start : null,
    }).select("id").single();
    setBusy(false);
    if (error) { setErr(/contracts_one_active/.test(error.message) ? "Phòng này đang có hợp đồng hiệu lực." : friendlyError(error)); return; }
    toast("Đã lập hợp đồng. Phòng chuyển sang \"Đang cho thuê\".");
    onSaved(data.id);
  }

  return (
    <Sheet open onClose={onClose} title="Lập hợp đồng thuê">
      <form className="stack" onSubmit={submit}>
        <label className="field"><span>Phòng *</span>
          <select id="c-room" className="input" value={roomId} onChange={(e) => pickRoom(e.target.value)} required>
            <option value="">— Chọn phòng chưa có khách —</option>
            {rooms.map((r) => <option key={r.id} value={r.id}>{r.code}{r.room_type ? ` · ${r.room_type}` : ""}{r.list_price ? ` · ${vnd(r.list_price)}` : ""}</option>)}
          </select></label>
        <label className="field"><span>Khách đứng tên *</span>
          <select id="c-tenant" className="input" value={tenantId} onChange={(e) => setTenantId(e.target.value)} required>
            <option value="">— Chọn khách —</option>
            {tenants.map((t) => <option key={t.id} value={t.id}>{t.full_name}{t.phone ? ` · ${t.phone}` : ""}</option>)}
          </select>
          <small className="muted">Chưa có khách? Thêm ở mục <Link to={`/toa/${buildingId}/khach`}>Khách thuê</Link> trước.</small></label>
        <label className="field"><span>Số hợp đồng</span><input id="c-code" className="input" value={code} onChange={(e) => setCode(e.target.value)} placeholder="VD: HD-339-0012" /></label>
        <ContractTerm start={start} end={end} onStart={setStart} onEnd={setEnd} />
        <div className="row" style={{ alignItems: "flex-start" }}>
          <label className="field" style={{ flex: "1 1 150px" }}><span>Giá thuê / tháng *</span><input id="c-rent" className="input num" inputMode="decimal" value={rent} onChange={(e) => setRent(e.target.value)} /></label>
          <label className="field" style={{ flex: "1 1 150px" }}><span>Tiền cọc</span><input id="c-dep" className="input num" inputMode="decimal" value={deposit} onChange={(e) => setDeposit(e.target.value)} /></label>
        </div>
        <div className="row" style={{ alignItems: "flex-start" }}>
          <label className="field" style={{ flex: "1 1 150px" }}><span>Hạn đóng tiền hằng tháng (ngày 1–28)</span>
            <input id="c-bill" className="input num" inputMode="numeric" value={billing} onChange={(e) => setBilling(e.target.value.replace(/\D/g, ""))} /></label>
          <label className="field" style={{ flex: "1 1 120px" }}><span>Số xe gửi</span>
            <input id="c-veh" className="input num" inputMode="numeric" value={vehicles} onChange={(e) => setVehicles(e.target.value.replace(/\D/g, "").slice(0, 2))} /></label>
        </div>
        <label className="field"><span>Cách ký</span>
          <select id="c-sign" className="input" value={sign} onChange={(e) => setSign(e.target.value as "" | "giay" | "dien_tu")}>
            <option value="">Chưa ký</option><option value="giay">Ký giấy</option><option value="dien_tu">Ký điện tử</option>
          </select></label>
        {err ? <div className="error-box" role="alert">{err}</div> : null}
        <button className="btn block" disabled={busy}>{busy ? "Đang lưu…" : "Lập hợp đồng"}</button>
      </form>
    </Sheet>
  );
}

function ContractView({ c, canManage, canEdit, onClose, onChanged }: { c: Contract; canManage: boolean; canEdit: boolean; onClose: () => void; onChanged: () => void }) {
  const { toast } = useSession();
  const [busy, setBusy] = useState(false);
  const [confirmEnd, setConfirmEnd] = useState(false);
  const [editing, setEditing] = useState(false);

  async function patch(p: Partial<Contract>, msg: string) {
    setBusy(true);
    const { error } = await supabase.from("contracts").update(p).eq("id", c.id);
    setBusy(false);
    if (error) { toast(friendlyError(error)); return; }
    toast(msg); setConfirmEnd(false); onChanged();
  }

  return (
    <Sheet open onClose={onClose} title={`Phòng ${c.rooms?.code} · ${c.tenants?.full_name ?? ""}`}>
      <div className="stack">
        <dl className="kv">
          {c.code ? <><dt>Số HĐ</dt><dd>{c.code}</dd></> : null}
          <dt>Trạng thái</dt><dd>{ST[c.status]}</dd>
          <dt>Hiệu lực</dt><dd>{ddmmyyyy(c.start_date)} → {c.end_date ? ddmmyyyy(c.end_date) : <b style={{ color: "var(--late)" }}>chưa có ngày kết thúc</b>}</dd>
          <dt>Giá thuê</dt><dd className="num">{vnd(c.rent_amount)}/tháng · hạn ngày {c.billing_day}</dd>
          <dt>Tiền cọc</dt><dd className="num">{vnd(c.deposit_amount)} · {DEP[c.deposit_status]}</dd>
          <dt>Số xe gửi</dt><dd className="num">{c.vehicles ?? 0} xe</dd>
          <dt>Cách ký</dt><dd>{c.sign_method ? `${SIGN[c.sign_method]}${c.signed_on ? ` ngày ${ddmmyyyy(c.signed_on)}` : ""}` : "Chưa ký"}</dd>
        </dl>
        <div className="row">
          <Link className="small" to={`/khach/${c.tenant_id}`}>Xem hồ sơ khách</Link>
          {canEdit ? <button type="button" className="btn ghost sm" onClick={() => setEditing(true)}>Sửa hợp đồng</button> : null}
        </div>

        <OccupantsPanel c={c} canEdit={canEdit} />

        <div className="row">
          {c.deposit_status === "chua_thu" && c.deposit_amount > 0 && c.status === "hieu_luc" ? <button className="btn secondary sm" disabled={busy} onClick={() => patch({ deposit_status: "da_thu" }, "Đã đánh dấu thu cọc.")}>Đánh dấu đã thu cọc</button> : null}
          {canManage && c.deposit_status === "da_thu" ? <button className="btn ghost sm" disabled={busy} onClick={() => patch({ deposit_status: "da_hoan" }, "Đã đánh dấu hoàn cọc.")}>Đã hoàn cọc</button> : null}
          {canEdit && !c.sign_method ? <button className="btn ghost sm" disabled={busy} onClick={() => patch({ sign_method: "giay", signed_on: todayVN() }, "Đã ghi nhận ký giấy.")}>Ghi nhận đã ký giấy</button> : null}
          {canEdit && !c.sign_method ? <button className="btn ghost sm" disabled={busy} onClick={() => patch({ sign_method: "dien_tu", signed_on: todayVN() }, "Đã ghi nhận ký điện tử.")}>Ghi nhận đã ký điện tử</button> : null}
        </div>

        {c.status === "hieu_luc" ? <ContractQR buildingId={c.building_id} tenantName={c.tenants?.full_name ?? ""} roomCode={c.rooms?.code ?? ""} rent={c.rent_amount} deposit={c.deposit_amount} /> : null}

        <FileGallery owner={{ kind: "hop_dong", buildingId: c.building_id, contractId: c.id }} title="File hợp đồng (ảnh chụp, PDF đã ký)"
          canUpload={canEdit} canDelete={canEdit}
          hint="Hợp đồng ký điện tử: tải file PDF đã ký (kèm chứng thư số / biên bản xác nhận) lên đây." />

        {canEdit && c.status === "hieu_luc" ? (
          confirmEnd ? (
            <div className="row">
              <span className="small" style={{ flex: 1 }}>Kết thúc hợp đồng hôm nay? Phòng sẽ chuyển về Trống.</span>
              <button className="btn secondary sm" onClick={() => setConfirmEnd(false)}>Giữ lại</button>
              <button className="btn danger sm" disabled={busy} onClick={() => patch({ status: "da_ket_thuc", end_date: todayVN() }, "Đã kết thúc hợp đồng.")}>Kết thúc</button>
            </div>
          ) : <button className="btn ghost" style={{ color: "var(--danger)" }} onClick={() => setConfirmEnd(true)}>Kết thúc hợp đồng</button>
        ) : null}
      </div>
      {editing ? <EditContract c={c} onClose={() => setEditing(false)} onSaved={() => { setEditing(false); onChanged(); }} /> : null}
    </Sheet>
  );
}

/* ---------- Sửa hợp đồng (sale phụ trách toà, Giám sát, Quản lý) ---------- */
function EditContract({ c, onClose, onSaved }: { c: Contract; onClose: () => void; onSaved: () => void }) {
  const { toast } = useSession();
  const fmt = (n: number) => new Intl.NumberFormat("vi-VN").format(n);
  const [code, setCode] = useState(c.code ?? "");
  const [start, setStart] = useState(c.start_date);
  const [end, setEnd] = useState(c.end_date ?? "");
  const [rent, setRent] = useState(fmt(c.rent_amount));
  const [deposit, setDeposit] = useState(fmt(c.deposit_amount));
  const [billing, setBilling] = useState(String(c.billing_day));
  const [vehicles, setVehicles] = useState(String(c.vehicles ?? 0));
  const [note, setNote] = useState(c.note ?? "");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  async function submit(e: FormEvent) {
    e.preventDefault(); setErr(null);
    const r = parseMoney(rent), d = deposit.trim() ? parseMoney(deposit) : 0, b = Number(billing);
    if (r == null) { setErr("Giá thuê chưa đúng, VD 4.500.000 hoặc 4,5tr."); return; }
    if (d == null) { setErr("Tiền cọc chưa đúng."); return; }
    if (!Number.isInteger(b) || b < 1 || b > 28) { setErr("Hạn đóng tiền là ngày từ 1 đến 28."); return; }
    if (!start || !end) { setErr("Nhập ngày hiệu lực hợp đồng: từ ngày và đến ngày."); return; }
    if (end < start) { setErr("Ngày kết thúc phải sau ngày bắt đầu."); return; }
    setBusy(true);
    const { error } = await supabase.from("contracts").update({
      code: code.trim() || null, start_date: start, end_date: end || null, rent_amount: r, deposit_amount: d, billing_day: b, vehicles: Number(vehicles) || 0, note: note.trim() || null,
    }).eq("id", c.id);
    setBusy(false);
    if (error) { setErr(friendlyError(error)); return; }
    toast("Đã lưu hợp đồng."); onSaved();
  }
  return (
    <Sheet open onClose={onClose} title={`Sửa hợp đồng phòng ${c.rooms?.code ?? ""}`}>
      <form className="stack" onSubmit={submit}>
        <label className="field"><span>Số hợp đồng</span><input className="input" value={code} onChange={(e) => setCode(e.target.value)} /></label>
        {!c.end_date ? <p className="sheet-nudge" style={{ margin: 0 }}>Hợp đồng này chưa có ngày kết thúc. Xem trên bản hợp đồng đã ký rồi nhập đúng ngày hiệu lực.</p> : null}
        <ContractTerm idPrefix="e" start={start} end={end} onStart={setStart} onEnd={setEnd} />
        <div className="row" style={{ alignItems: "flex-start" }}>
          <label className="field" style={{ flex: "1 1 150px" }}><span>Giá thuê / tháng *</span><input className="input num" inputMode="decimal" value={rent} onChange={(e) => setRent(e.target.value)} /></label>
          <label className="field" style={{ flex: "1 1 150px" }}><span>Tiền cọc</span><input className="input num" inputMode="decimal" value={deposit} onChange={(e) => setDeposit(e.target.value)} /></label>
        </div>
        <div className="row" style={{ alignItems: "flex-start" }}>
          <label className="field" style={{ flex: "1 1 150px" }}><span>Hạn đóng tiền hằng tháng (ngày 1–28)</span>
            <input className="input num" inputMode="numeric" value={billing} onChange={(e) => setBilling(e.target.value.replace(/\D/g, ""))} /></label>
          <label className="field" style={{ flex: "1 1 120px" }}><span>Số xe gửi</span>
            <input className="input num" inputMode="numeric" value={vehicles} onChange={(e) => setVehicles(e.target.value.replace(/\D/g, "").slice(0, 2))} /></label>
        </div>
        <label className="field"><span>Ghi chú</span><textarea className="input" style={{ minHeight: 60 }} value={note} onChange={(e) => setNote(e.target.value)} /></label>
        {err ? <div className="error-box" role="alert">{err}</div> : null}
        <button className="btn block" disabled={busy}>{busy ? "Đang lưu…" : "Lưu hợp đồng"}</button>
      </form>
    </Sheet>
  );
}

/* ---------- Người ở trong phòng: mỗi người phải đủ giấy tờ (CCCD: số + ảnh 2 mặt; hộ chiếu: số + ảnh trang thông tin) ---------- */
type Occ = { id: string; tenant_id: string; move_in: string; move_out: string | null; tenants: { full_name: string; phone: string | null } | null };

function OccupantsPanel({ c, canEdit }: { c: Contract; canEdit: boolean }) {
  const { toast } = useSession();
  const [list, setList] = useState<Occ[]>([]);
  const [ok, setOk] = useState<Record<string, boolean>>({});
  const [max, setMax] = useState<number | null>(null);
  const [adding, setAdding] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const load = useCallback(async () => {
    const [o, r] = await Promise.all([
      supabase.from("contract_occupants").select("id,tenant_id,move_in,move_out,tenants(full_name,phone)").eq("contract_id", c.id).is("move_out", null).order("move_in"),
      supabase.from("rooms").select("max_occupants").eq("id", c.room_id).maybeSingle(),
    ]);
    const rows = (o.data ?? []) as unknown as Occ[];
    setList(rows); setMax((r.data as { max_occupants: number | null } | null)?.max_occupants ?? null);
    const checks = await Promise.all(rows.map((x) => supabase.rpc("tenant_has_cccd", { p_tenant: x.tenant_id })));
    setOk(Object.fromEntries(rows.map((x, i) => [x.tenant_id, !!checks[i].data])));
  }, [c.id, c.room_id]);
  useEffect(() => { load(); }, [load]);

  async function moveOut(o: Occ) {
    setBusy(o.id);
    const { error } = await supabase.from("contract_occupants").update({ move_out: todayVN() }).eq("id", o.id);
    setBusy(null);
    if (error) { toast(friendlyError(error)); return; }
    toast(`Đã ghi ${o.tenants?.full_name ?? "khách"} chuyển đi.`); load();
  }

  const full = max != null && list.length >= max;
  return (
    <section className="stack" style={{ gap: 6 }}>
      <div className="row" style={{ justifyContent: "space-between" }}>
        <b>Người ở ({list.length}{max ? `/${max}` : ""} người)</b>
        {canEdit && c.status === "hieu_luc" && !full ? <button type="button" className="btn secondary sm" onClick={() => setAdding(true)}>+ Người ở cùng</button> : null}
      </div>
      <p className="muted small" style={{ margin: 0 }}>Mỗi người ở phải đủ giấy tờ: CCCD (số + ảnh 2 mặt) hoặc hộ chiếu với khách nước ngoài (số + ảnh trang thông tin), kèm xác nhận đồng ý lưu. Tiền nước khoán tính theo số người ở.</p>
      {list.map((o) => (
        <div key={o.id} className="row" style={{ justifyContent: "space-between", flexWrap: "nowrap", borderTop: "1px solid var(--line)", paddingTop: 6 }}>
          <span style={{ minWidth: 0 }}>
            <Link to={`/khach/${o.tenant_id}`}>{o.tenants?.full_name ?? "—"}</Link>
            {o.tenant_id === c.tenant_id ? <small className="muted"> · đứng tên</small> : null}
            <br /><small className={ok[o.tenant_id] ? "muted" : ""} style={ok[o.tenant_id] ? undefined : { color: "var(--danger)" }}>
              {ok[o.tenant_id] ? "Đủ giấy tờ" : "Thiếu CCCD / hộ chiếu: mở hồ sơ để bổ sung"} · vào ở {ddmmyyyy(o.move_in)}</small>
          </span>
          {canEdit && o.tenant_id !== c.tenant_id ? <button type="button" className="btn ghost sm" disabled={busy === o.id} onClick={() => moveOut(o)}>Chuyển đi</button> : null}
        </div>
      ))}
      {full && canEdit ? <small className="muted">Phòng đã đủ số người tối đa ({max}). Sửa "Số người tối đa" ở phòng nếu cần.</small> : null}
      {adding ? <AddOccupant c={c} taken={list.map((x) => x.tenant_id)} onClose={() => setAdding(false)} onSaved={() => { setAdding(false); load(); }} /> : null}
    </section>
  );
}

function AddOccupant({ c, taken, onClose, onSaved }: { c: Contract; taken: string[]; onClose: () => void; onSaved: () => void }) {
  const { toast } = useSession();
  const [mode, setMode] = useState<"moi" | "co_san">("moi");
  const [existing, setExisting] = useState<{ id: string; full_name: string; phone: string | null }[]>([]);
  const [pick, setPick] = useState("");
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [idType, setIdType] = useState<IdType>("cccd");
  const [nation, setNation] = useState("");
  const [idNo, setIdNo] = useState("");
  const [consent, setConsent] = useState(false);
  const [photos, setPhotos] = useState<Record<string, File | null>>({});
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  useEffect(() => {
    supabase.from("tenants").select("id,full_name,phone").eq("building_id", c.building_id).order("full_name")
      .then(({ data }) => setExisting(((data ?? []) as typeof existing).filter((t) => !taken.includes(t.id))));
  }, [c.building_id]); // eslint-disable-line react-hooks/exhaustive-deps

  async function link(tenantId: string) {
    const { error } = await supabase.from("contract_occupants").insert({ contract_id: c.id, tenant_id: tenantId, move_in: todayVN() });
    if (error) throw error;
  }
  async function submit(e: FormEvent) {
    e.preventDefault(); setErr(null);
    if (mode === "co_san") {
      if (!pick) { setErr("Chọn khách."); return; }
      setBusy(true);
      try { await link(pick); toast("Đã thêm người ở cùng."); onSaved(); }
      catch (ex) { setErr(`${friendlyError(ex)} Mở hồ sơ khách để bổ sung CCCD / hộ chiếu.`); }
      finally { setBusy(false); }
      return;
    }
    const digits = normId(idType, idNo);
    if (!name.trim()) { setErr("Nhập họ tên."); return; }
    const bad = idError(idType, digits);
    if (bad) { setErr(bad.charAt(0).toUpperCase() + bad.slice(1) + "."); return; }
    if (idType === "passport" && !nation.trim()) { setErr("Nhập quốc tịch."); return; }
    if (!consent) { setErr(`Cần tích xác nhận khách đồng ý cho lưu ${ID_NAME[idType]}.`); return; }
    const miss = ID_PHOTOS[idType].filter((p) => p.required && !photos[p.label]);
    if (miss.length) { setErr(`Cần ảnh ${ID_NAME[idType]}: ${miss.map((p) => p.text.toLowerCase()).join(", ")}.`); return; }
    setBusy(true);
    const t = await supabase.from("tenants").insert({
      building_id: c.building_id, full_name: name.trim(), phone: phone.trim() || null, id_number: digits,
      id_type: idType, nationality: idType === "passport" ? nation.trim() : null,
      cccd_consent_at: new Date().toISOString(), cccd_consent_note: "Khách đồng ý trực tiếp",
    }).select("id").single();
    if (t.error) { setBusy(false); setErr(friendlyError(t.error)); return; }
    try {
      for (const ph of ID_PHOTOS[idType]) {
        const f = photos[ph.label];
        if (f) await uploadFile({ kind: "cccd", buildingId: c.building_id, tenantId: t.data.id }, f, { label: ph.label });
      }
    } catch (ex) {
      setBusy(false); setErr(`Đã lưu khách nhưng chưa tải được ảnh ${ID_NAME[idType]}: ${friendlyError(ex)}. Mở hồ sơ khách tải lại, rồi thêm vào phòng.`); return;
    }
    try { await link(t.data.id); } catch (ex) { setBusy(false); setErr(friendlyError(ex)); return; }
    setBusy(false); toast(`Đã thêm ${name.trim()} vào phòng ${c.rooms?.code ?? ""}.`); onSaved();
  }
  return (
    <Sheet open onClose={onClose} title={`Thêm người ở · phòng ${c.rooms?.code ?? ""}`}>
      <form className="stack" onSubmit={submit}>
        <label className="field"><span>Người ở</span>
          <Combo value={mode} options={[["moi", "Người mới"], ["co_san", "Khách đã có trong toà"]] as const} onChange={setMode} /></label>
        {mode === "co_san" ? (
          <label className="field"><span>Khách *</span>
            <select className="input" value={pick} onChange={(e) => setPick(e.target.value)}>
              <option value="">— Chọn khách —</option>
              {existing.map((t) => <option key={t.id} value={t.id}>{t.full_name}{t.phone ? ` · ${t.phone}` : ""}</option>)}
            </select>
            <small className="muted">Khách phải đủ giấy tờ (CCCD hoặc hộ chiếu, đồng ý lưu, ảnh) mới thêm được.</small></label>
        ) : (<>
          <label className="field"><span>Họ tên *</span><input className="input" value={name} onChange={(e) => setName(e.target.value)} /></label>
          <label className="field"><span>Số điện thoại</span><input className="input" inputMode="tel" value={phone} onChange={(e) => setPhone(e.target.value)} /></label>
          <label className="field"><span>Giấy tờ</span>
            <Combo value={idType} options={ID_TYPES} onChange={(k) => { setIdType(k); setIdNo(""); setPhotos({}); }} /></label>
          {idType === "passport" ? <label className="field"><span>Quốc tịch *</span><input className="input" value={nation} onChange={(e) => setNation(e.target.value)} placeholder="VD: Hàn Quốc" /></label> : null}
          <label className="field"><span>Số {ID_NAME[idType]} *</span><input className="input num" inputMode={idType === "passport" ? "text" : "numeric"} autoCapitalize="characters" value={idNo}
            onChange={(e) => setIdNo(idType === "passport" ? e.target.value.toUpperCase() : e.target.value)} placeholder={idType === "passport" ? "VD: M12345678" : "12 chữ số"} /></label>
          {ID_PHOTOS[idType].map((ph) => (
            <label key={ph.label} className="field"><span>Ảnh {ph.text.toLowerCase()}{ph.required ? " *" : " (nếu có)"}</span>
              <input className="input" type="file" accept="image/*" onChange={(e) => setPhotos({ ...photos, [ph.label]: e.target.files?.[0] ?? null })} /></label>
          ))}
          <label className="row" style={{ flexWrap: "nowrap", alignItems: "flex-start", gap: 8 }}>
            <input type="checkbox" checked={consent} onChange={(e) => setConsent(e.target.checked)} />
            <span className="small">Khách đã đồng ý cho công ty lưu số và ảnh {ID_NAME[idType]} để đăng ký / khai báo tạm trú, quản lý hợp đồng.</span>
          </label>
        </>)}
        {err ? <div className="error-box" role="alert">{err}</div> : null}
        <button className="btn block" disabled={busy}>{busy ? "Đang lưu…" : "Thêm người ở"}</button>
      </form>
    </Sheet>
  );
}
