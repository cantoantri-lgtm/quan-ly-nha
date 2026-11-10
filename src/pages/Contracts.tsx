import { useCallback, useEffect, useMemo, useState, type FormEvent } from "react";
import { Link, useParams, useSearchParams } from "react-router-dom";
import { friendlyError, supabase } from "../lib/supabase";
import { useSession } from "../lib/session";
import { ddmmyyyy, todayVN } from "../lib/dates";
import { naturalCompare, parseMoney, vnd } from "../lib/money";
import { Empty, Sheet, TopBar } from "../components/ui";
import FileGallery from "../components/FileGallery";
import ContractQR from "../components/ContractQR";
import type { Room } from "./BuildingDetail";
import "../files.css";

type Contract = {
  id: string; code: string | null; room_id: string; building_id: string; tenant_id: string; start_date: string; end_date: string | null;
  rent_amount: number; deposit_amount: number; deposit_status: "chua_thu" | "da_thu" | "da_hoan"; billing_day: number;
  status: "hieu_luc" | "da_ket_thuc" | "da_huy"; sign_method: "giay" | "dien_tu" | null; signed_on: string | null; note: string | null;
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
  const canManage = isManager || (isSupervisor && !!id && myBuildingIds.includes(id));
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

  const shown = useMemo(() => list.filter((c) => all || c.status === "hieu_luc"), [list, all]);
  const opened = list.find((c) => c.id === openId) ?? null;

  if (!building) return (<><TopBar title="Hợp đồng" back /><main className="main"><Empty title="Không tìm thấy toà này" /></main></>);
  return (
    <>
      <TopBar title={`Hợp đồng · ${building.code}`} back={`/toa/${building.id}`}
        action={canManage ? <button className="tb-action" onClick={() => setAdding(true)}>+ Hợp đồng</button> : null} />
      <main className="main stack">
        <div className="chips" role="group" aria-label="Lọc hợp đồng">
          <button className="chip" aria-pressed={!all} onClick={() => setAll(false)}>Đang hiệu lực<span className="n">{list.filter((c) => c.status === "hieu_luc").length}</span></button>
          <button className="chip" aria-pressed={all} onClick={() => setAll(true)}>Tất cả<span className="n">{list.length}</span></button>
        </div>
        {loading ? <div className="loading">Đang tải…</div> : shown.length === 0 ? (
          <Empty title="Chưa có hợp đồng">{canManage ? "Bấm \"+ Hợp đồng\" để lập hợp đồng cho phòng. Cần có khách thuê trước (mục Khách thuê)." : undefined}</Empty>
        ) : (
          <section className="card">
            {shown.map((c) => (
              <div key={c.id} className="list-row" role="button" tabIndex={0} onClick={() => setSp({ mo: c.id })} onKeyDown={(e) => e.key === "Enter" && setSp({ mo: c.id })}>
                <div className="grow">
                  <div className="name">Phòng {c.rooms?.code} · {c.tenants?.full_name}</div>
                  <div className="sub">{ddmmyyyy(c.start_date)} → {c.end_date ? ddmmyyyy(c.end_date) : "không thời hạn"} · {vnd(c.rent_amount)}/tháng</div>
                </div>
                <span className={`tag ${c.status === "hieu_luc" ? "st-ok" : ""}`}>{ST[c.status]}</span>
              </div>
            ))}
          </section>
        )}
      </main>
      {adding ? <NewContract buildingId={building.id} onClose={() => setAdding(false)} onSaved={(cid) => { setAdding(false); load(); setSp({ mo: cid }); }} /> : null}
      {opened ? <ContractView c={opened} canManage={canManage} onClose={() => setSp({})} onChanged={load} /> : null}
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
    if (end && end < start) { setErr("Ngày kết thúc phải sau ngày bắt đầu."); return; }
    setBusy(true);
    const { data, error } = await supabase.from("contracts").insert({
      room_id: roomId, tenant_id: tenantId, code: code.trim() || null, start_date: start, end_date: end || null,
      rent_amount: rentN, deposit_amount: depN, billing_day: Number(billing) || 5,
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
        <div className="row" style={{ alignItems: "flex-start" }}>
          <label className="field" style={{ flex: "1 1 150px" }}><span>Bắt đầu *</span><input id="c-start" className="input" type="date" value={start} onChange={(e) => setStart(e.target.value)} required /></label>
          <label className="field" style={{ flex: "1 1 150px" }}><span>Kết thúc</span><input id="c-end" className="input" type="date" value={end} onChange={(e) => setEnd(e.target.value)} /></label>
        </div>
        <div className="row" style={{ alignItems: "flex-start" }}>
          <label className="field" style={{ flex: "1 1 150px" }}><span>Giá thuê / tháng *</span><input id="c-rent" className="input num" inputMode="decimal" value={rent} onChange={(e) => setRent(e.target.value)} /></label>
          <label className="field" style={{ flex: "1 1 150px" }}><span>Tiền cọc</span><input id="c-dep" className="input num" inputMode="decimal" value={deposit} onChange={(e) => setDeposit(e.target.value)} /></label>
        </div>
        <label className="field"><span>Hạn đóng tiền hằng tháng (ngày 1–28)</span>
          <input id="c-bill" className="input num" inputMode="numeric" value={billing} onChange={(e) => setBilling(e.target.value.replace(/\D/g, ""))} /></label>
        <div className="field"><span>Cách ký</span>
          <div className="seg" style={{ gridTemplateColumns: "repeat(3, 1fr)" }} role="group">
            {([["", "Chưa ký"], ["giay", "Ký giấy"], ["dien_tu", "Ký điện tử"]] as ["" | "giay" | "dien_tu", string][]).map(([k, l]) => (
              <button type="button" key={k} aria-pressed={sign === k} onClick={() => setSign(k)}>{l}</button>
            ))}
          </div>
        </div>
        {err ? <div className="error-box" role="alert">{err}</div> : null}
        <button className="btn block" disabled={busy}>{busy ? "Đang lưu…" : "Lập hợp đồng"}</button>
      </form>
    </Sheet>
  );
}

function ContractView({ c, canManage, onClose, onChanged }: { c: Contract; canManage: boolean; onClose: () => void; onChanged: () => void }) {
  const { toast } = useSession();
  const [busy, setBusy] = useState(false);
  const [confirmEnd, setConfirmEnd] = useState(false);

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
          <dt>Thời hạn</dt><dd>{ddmmyyyy(c.start_date)} → {c.end_date ? ddmmyyyy(c.end_date) : "không thời hạn"}</dd>
          <dt>Giá thuê</dt><dd className="num">{vnd(c.rent_amount)}/tháng · hạn ngày {c.billing_day}</dd>
          <dt>Tiền cọc</dt><dd className="num">{vnd(c.deposit_amount)} · {DEP[c.deposit_status]}</dd>
          <dt>Cách ký</dt><dd>{c.sign_method ? `${SIGN[c.sign_method]}${c.signed_on ? ` ngày ${ddmmyyyy(c.signed_on)}` : ""}` : "Chưa ký"}</dd>
        </dl>
        <Link className="small" to={`/khach/${c.tenant_id}`}>Xem hồ sơ khách</Link>

        <div className="row">
          {c.deposit_status === "chua_thu" && c.deposit_amount > 0 && c.status === "hieu_luc" ? <button className="btn secondary sm" disabled={busy} onClick={() => patch({ deposit_status: "da_thu" }, "Đã đánh dấu thu cọc.")}>Đánh dấu đã thu cọc</button> : null}
          {canManage && c.deposit_status === "da_thu" ? <button className="btn ghost sm" disabled={busy} onClick={() => patch({ deposit_status: "da_hoan" }, "Đã đánh dấu hoàn cọc.")}>Đã hoàn cọc</button> : null}
          {canManage && !c.sign_method ? <button className="btn ghost sm" disabled={busy} onClick={() => patch({ sign_method: "giay", signed_on: todayVN() }, "Đã ghi nhận ký giấy.")}>Ghi nhận đã ký giấy</button> : null}
          {canManage && !c.sign_method ? <button className="btn ghost sm" disabled={busy} onClick={() => patch({ sign_method: "dien_tu", signed_on: todayVN() }, "Đã ghi nhận ký điện tử.")}>Ghi nhận đã ký điện tử</button> : null}
        </div>

        {c.status === "hieu_luc" ? <ContractQR buildingId={c.building_id} tenantName={c.tenants?.full_name ?? ""} roomCode={c.rooms?.code ?? ""} rent={c.rent_amount} deposit={c.deposit_amount} /> : null}

        <FileGallery owner={{ kind: "hop_dong", buildingId: c.building_id, contractId: c.id }} title="File hợp đồng (ảnh chụp, PDF đã ký)"
          canUpload={canManage} canDelete={canManage}
          hint="Hợp đồng ký điện tử: tải file PDF đã ký (kèm chứng thư số / biên bản xác nhận) lên đây." />

        {canManage && c.status === "hieu_luc" ? (
          confirmEnd ? (
            <div className="row">
              <span className="small" style={{ flex: 1 }}>Kết thúc hợp đồng hôm nay? Phòng sẽ chuyển về Trống.</span>
              <button className="btn secondary sm" onClick={() => setConfirmEnd(false)}>Giữ lại</button>
              <button className="btn danger sm" disabled={busy} onClick={() => patch({ status: "da_ket_thuc", end_date: todayVN() }, "Đã kết thúc hợp đồng.")}>Kết thúc</button>
            </div>
          ) : <button className="btn ghost" style={{ color: "var(--danger)" }} onClick={() => setConfirmEnd(true)}>Kết thúc hợp đồng</button>
        ) : null}
      </div>
    </Sheet>
  );
}
