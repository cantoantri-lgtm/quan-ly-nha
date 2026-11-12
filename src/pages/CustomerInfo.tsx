import { useCallback, useEffect, useMemo, useState, type FormEvent } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { supabase } from "../lib/supabase";
import { useSession } from "../lib/session";
import { todayVN } from "../lib/dates";
import { parseMoney, vnd } from "../lib/money";
import { Sheet, TopBar } from "../components/ui";
import { meterPhotoUrls, uploadMeterPhoto, type MeterPhoto, type MeterReading } from "../lib/files";
import "../feedback.css";

type Lease = {
  customer_id: string; start_date: string | null; end_date: string | null; rent: number; deposit: number;
  elec_price: number | null; water_price: number | null; water_mode: "m3" | "nguoi"; service_fee: number; max_occupants: number | null;
};
type Overview = {
  customer: { id: string; full_name: string; phone: string | null };
  place: { building_id: string | null; building_code: string | null; building_name: string | null; room_id: string | null; room_code: string | null } | null;
  lease: Lease | null; occupant_count: number; debt: number; overdue: number;
};
type Occupant = { id: string; full_name: string; cccd: string; relation: string | null };
type Cycle = { kind: "dien" | "nuoc"; open_id: string; close_id: string };
type Bill = { id: string; kind: string; period: string | null; amount: number; due_date: string | null; status: string };
type Preview = { lines: { label: string; amount: number; detail?: string }[]; total: number };

const dmy = (d: string | null) => (d ? `${d.slice(8, 10)}/${d.slice(5, 7)}/${d.slice(0, 4)}` : "—");
const num = (n: number) => new Intl.NumberFormat("vi-VN", { maximumFractionDigits: 1 }).format(n);
const KIND_LABEL: Record<string, string> = { tien_phong: "Tiền phòng", dien: "Tiền điện", nuoc: "Tiền nước", phi_dich_vu: "Phí dịch vụ", tien_coc: "Tiền cọc", phieu_thu: "Phiếu thu tháng" };

/** Trang thông tin khách: khách tự xem (/thong-tin) hoặc nhân sự xem từng khách (/khach-hang/:id) */
export default function CustomerInfo() {
  const { id } = useParams();
  const nav = useNavigate();
  const { isCustomer, toast } = useSession();
  const cid = id ?? null;
  const [ov, setOv] = useState<Overview | null>(null);
  const [occ, setOcc] = useState<Occupant[]>([]);
  const [readings, setReadings] = useState<MeterReading[]>([]);
  const [cycle, setCycle] = useState<Cycle[]>([]);
  const [bills, setBills] = useState<Bill[]>([]);
  const [urls, setUrls] = useState<Record<string, string>>({});
  const [err, setErr] = useState("");
  const [sheet, setSheet] = useState<"" | "occ" | "meter" | "lease" | "stmt">("");
  const [meterKind, setMeterKind] = useState<"dien" | "nuoc">("dien");

  const load = useCallback(async () => {
    const { data, error } = await supabase.rpc("customer_overview", { p_customer: cid });
    if (error) { setErr(error.message); return; }
    const o = data as Overview; setOv(o); setErr("");
    const c = o.customer.id;
    const [a, b, d, e] = await Promise.all([
      supabase.rpc("occupants_list", { p_customer: c }),
      supabase.from("meter_readings").select("*").eq("customer_id", c).order("read_on", { ascending: false }).order("created_at", { ascending: false }).limit(30),
      supabase.rpc("meter_cycle", { p_customer: c }),
      supabase.from("customer_bills").select("id,kind,period,amount,due_date,status").eq("customer_id", c).in("status", ["chua_thanh_toan", "cho_xac_nhan"]).order("due_date", { nullsFirst: false }),
    ]);
    setOcc((a.data as Occupant[]) ?? []);
    const rs = (b.data as MeterReading[]) ?? [];
    setReadings(rs); setCycle((d.data as Cycle[]) ?? []); setBills((e.data as Bill[]) ?? []);
    meterPhotoUrls(rs, "thumb").then(setUrls).catch(() => undefined);
  }, [cid]);
  useEffect(() => { load(); }, [load]);

  const byId = useMemo(() => new Map(readings.map((r) => [r.id, r])), [readings]);
  if (err) return (<><TopBar title="Thông tin khách" back={!isCustomer} /><main className="main"><div className="error-box">{err}</div></main></>);
  if (!ov) return (<><TopBar title="Thông tin khách" back={!isCustomer} /><main className="main"><div className="loading">Đang tải…</div></main></>);

  const L = ov.lease; const staff = !isCustomer; const custId = ov.customer.id;
  const today = todayVN();
  const lastReading = (k: "dien" | "nuoc") => readings.find((r) => r.kind === k)?.reading ?? null;

  async function delReading(r: MeterReading) {
    const { error } = await supabase.rpc("meter_delete", { p_id: r.id });
    if (error) { toast(error.message); return; }
    toast("Đã xoá số này."); load();
  }
  async function delOcc(o: Occupant) {
    const { error } = await supabase.rpc("occupant_delete", { p_id: o.id });
    if (error) { toast(error.message); return; }
    toast("Đã xoá người ở."); load();
  }

  return (
    <>
      <TopBar title={staff ? ov.customer.full_name : "Thông tin"} back={staff ? "/khach-hang" : false} />
      <main className="main stack">
        <section className="card" style={{ padding: 14 }}>
          <h2 className="small muted" style={{ margin: "0 0 6px" }}>Phòng đang ở</h2>
          {ov.place?.room_code ? (
            <p style={{ margin: 0 }}><b>{ov.place.building_code} · P.{ov.place.room_code}</b>{ov.place.building_name ? ` · ${ov.place.building_name}` : ""}</p>
          ) : <p className="muted" style={{ margin: 0 }}>Chưa được gán phòng.</p>}
          {L ? (
            <dl className="kv" style={{ margin: "8px 0 0" }}>
              <div><dt className="muted small">Hợp đồng thuê</dt><dd style={{ margin: 0 }}>Từ {dmy(L.start_date)} đến {dmy(L.end_date)}</dd></div>
              <div><dt className="muted small">Tiền cọc công ty đang giữ</dt><dd style={{ margin: 0 }}><b className="num">{vnd(L.deposit)}</b></dd></div>
              <div><dt className="muted small">Tiền phòng mỗi tháng</dt><dd style={{ margin: 0 }} className="num">{vnd(L.rent)}</dd></div>
            </dl>
          ) : <p className="muted small" style={{ margin: "6px 0 0" }}>Chưa có thông tin hợp đồng{staff ? ". Bấm \"Cập nhật hợp đồng\"." : ". Công ty sẽ cập nhật."}</p>}
          {staff ? <button className="btn secondary sm" style={{ marginTop: 10 }} onClick={() => setSheet("lease")}>Cập nhật hợp đồng, cọc, đơn giá</button> : null}
        </section>

        <section className="card" style={{ padding: 14 }}>
          <h2 className="small muted" style={{ margin: "0 0 6px" }}>Công nợ</h2>
          <p style={{ margin: 0 }}>Còn nợ: <b className="num" style={{ color: ov.debt > 0 ? "var(--danger)" : undefined }}>{vnd(ov.debt)}</b>
            {ov.overdue > 0 ? <span className="muted small"> · quá hạn {vnd(ov.overdue)}</span> : null}</p>
          {bills.map((b) => (
            <div key={b.id} className="row small" style={{ justifyContent: "space-between", marginTop: 6 }}>
              <span>{KIND_LABEL[b.kind] ?? b.kind}{b.period ? ` ${b.period.slice(5, 7)}/${b.period.slice(0, 4)}` : ""}{b.due_date ? ` · hạn ${dmy(b.due_date).slice(0, 5)}` : ""}{b.due_date && b.due_date < today ? " · quá hạn" : ""}</span>
              <span className="num">{vnd(b.amount)}</span>
            </div>
          ))}
          <div className="row" style={{ marginTop: 10, gap: 8 }}>
            <button className="btn secondary sm" onClick={() => nav(staff ? "/thu-tien-khach" : "/thanh-toan-cua-toi")}>{staff ? "Xem sổ thu" : "Thanh toán / xem QR"}</button>
            {staff ? <button className="btn sm" onClick={() => setSheet("stmt")}>Tạo phiếu thu tháng</button> : null}
          </div>
        </section>

        <section className="card" style={{ padding: 14 }}>
          <div className="row" style={{ justifyContent: "space-between" }}>
            <h2 className="small muted" style={{ margin: 0 }}>Người ở ({ov.occupant_count}{L?.max_occupants ? `/${L.max_occupants}` : ""})</h2>
            <button className="btn secondary sm" onClick={() => setSheet("occ")}>+ Thêm người ở</button>
          </div>
          <p className="muted small" style={{ margin: "4px 0 8px" }}>Mọi người ở trong phòng đều phải đăng ký CCCD.</p>
          <div className="row small" style={{ justifyContent: "space-between" }}><span>{ov.customer.full_name} (chủ tài khoản)</span><span className="muted">Đã đăng ký CCCD</span></div>
          {occ.map((o) => (
            <div key={o.id} className="row small" style={{ justifyContent: "space-between", marginTop: 6, flexWrap: "nowrap" }}>
              <span>{o.full_name}{o.relation ? ` · ${o.relation}` : ""}</span>
              <span className="muted num">CCCD {o.cccd}{staff ? <> <button className="btn ghost sm" onClick={() => delOcc(o)}>Xoá</button></> : null}</span>
            </div>
          ))}
        </section>

        <section className="card" style={{ padding: 14 }}>
          <div className="row" style={{ justifyContent: "space-between" }}>
            <h2 className="small muted" style={{ margin: 0 }}>Số điện nước</h2>
            <button className="btn sm" disabled={!ov.place?.room_id} onClick={() => { setMeterKind("dien"); setSheet("meter"); }}>Chụp đồng hồ điện</button>
          </div>
          {cycle.length === 0 ? <p className="muted small" style={{ margin: "6px 0 0" }}>Chưa có số nào. Bấm "Chụp đồng hồ điện" để ghi số đầu tiên (số đầu kỳ).</p> : null}
          {cycle.map((c) => {
            const o = byId.get(c.open_id), e = byId.get(c.close_id);
            if (!o || !e) return null;
            return (
              <div key={c.kind} style={{ marginTop: 10 }}>
                <b>{c.kind === "dien" ? "Điện (kWh)" : "Nước (m³)"}</b>
                <div className="row" style={{ gap: 10, flexWrap: "nowrap", marginTop: 4 }}>
                  {[{ t: "Đầu kỳ", r: o }, { t: "Cuối kỳ", r: e }].map(({ t, r }) => (
                    <div key={t} style={{ flex: 1, minWidth: 0 }}>
                      <div className="muted small">{t} · {dmy(r.read_on).slice(0, 5)}</div>
                      <div><b className="num">{num(r.reading)}</b></div>
                      {urls[r.id] ? <a href={urls[r.id]} target="_blank" rel="noreferrer"><img src={urls[r.id]} alt={`Ảnh đồng hồ ${t}`} style={{ width: "100%", maxHeight: 110, objectFit: "cover", borderRadius: 8, marginTop: 4 }} /></a>
                        : <div className="muted small">{r.photo_path.startsWith("dong-ho/") ? "Đang tải ảnh…" : "Dữ liệu mẫu, chưa có ảnh"}</div>}
                      {r.lat != null && r.lng != null ? <a className="small" href={`https://www.google.com/maps?q=${r.lat},${r.lng}`} target="_blank" rel="noreferrer">Xem vị trí chụp</a> : null}
                    </div>
                  ))}
                </div>
                <div className="small" style={{ marginTop: 4 }}>Đã dùng: <b className="num">{num(Math.max(0, e.reading - o.reading))}</b> {c.kind === "dien" ? "kWh" : "m³"}</div>
              </div>
            );
          })}
          {staff ? <button className="btn secondary sm" style={{ marginTop: 10 }} onClick={() => { setMeterKind("nuoc"); setSheet("meter"); }} disabled={!ov.place?.room_id}>Ghi số nước</button> : null}
          {readings.filter((r) => !r.statement_bill_id && staff).slice(0, 1).map((r) => (
            <button key={r.id} className="btn ghost sm" onClick={() => delReading(r)}>Xoá số mới nhất ({num(r.reading)})</button>
          ))}
        </section>
      </main>

      <OccSheet open={sheet === "occ"} onClose={() => setSheet("")} customerId={custId} onDone={() => { setSheet(""); load(); }} />
      <MeterSheet open={sheet === "meter"} onClose={() => setSheet("")} customerId={custId} staff={staff} kind={meterKind} setKind={setMeterKind}
        last={lastReading(meterKind)} onDone={() => { setSheet(""); load(); }} />
      {staff ? <LeaseSheet open={sheet === "lease"} onClose={() => setSheet("")} customerId={custId} lease={L} onDone={() => { setSheet(""); load(); }} /> : null}
      {staff ? <StmtSheet open={sheet === "stmt"} onClose={() => setSheet("")} customerId={custId} onDone={() => { setSheet(""); load(); }} /> : null}
    </>
  );
}

function OccSheet({ open, onClose, customerId, onDone }: { open: boolean; onClose: () => void; customerId: string; onDone: () => void }) {
  const { toast } = useSession();
  const [name, setName] = useState(""); const [cccd, setCccd] = useState(""); const [rel, setRel] = useState("");
  const [busy, setBusy] = useState(false);
  async function submit(e: FormEvent) {
    e.preventDefault(); setBusy(true);
    const { error } = await supabase.rpc("occupant_add", { p_customer: customerId, p_name: name, p_cccd: cccd, p_relation: rel });
    setBusy(false);
    if (error) { toast(error.message); return; }
    toast("Đã đăng ký người ở."); setName(""); setCccd(""); setRel(""); onDone();
  }
  return (
    <Sheet open={open} onClose={onClose} title="Đăng ký người ở">
      <form className="stack" onSubmit={submit}>
        <label className="field"><span>Họ tên *</span><input className="input" value={name} onChange={(e) => setName(e.target.value)} required /></label>
        <label className="field"><span>Số CCCD (12 số) *</span><input className="input" inputMode="numeric" maxLength={14} value={cccd} onChange={(e) => setCccd(e.target.value)} required /></label>
        <label className="field"><span>Quan hệ (vợ, chồng, con, bạn…)</span><input className="input" value={rel} onChange={(e) => setRel(e.target.value)} /></label>
        <button className="btn block" disabled={busy}>{busy ? "Đang lưu…" : "Đăng ký"}</button>
      </form>
    </Sheet>
  );
}

function MeterSheet({ open, onClose, customerId, staff, kind, setKind, last, onDone }:
  { open: boolean; onClose: () => void; customerId: string; staff: boolean; kind: "dien" | "nuoc"; setKind: (k: "dien" | "nuoc") => void; last: number | null; onDone: () => void }) {
  const { toast } = useSession();
  const [photo, setPhoto] = useState<MeterPhoto | null>(null);
  const [reading, setReading] = useState(""); const [ocr, setOcr] = useState<number | null>(null);
  const [msg, setMsg] = useState(""); const [busy, setBusy] = useState(false);
  useEffect(() => { if (!open) { setPhoto(null); setReading(""); setOcr(null); setMsg(""); } }, [open]);

  async function pick(f: File | undefined) {
    if (!f) return;
    setBusy(true); setMsg("Đang lấy vị trí và tải ảnh lên…"); setOcr(null);
    try {
      const p = await uploadMeterPhoto(customerId, f);
      setPhoto(p);
      if (kind === "dien") {
        setMsg("Đang đọc số trên đồng hồ…");
        const { data, error } = await supabase.functions.invoke("doc-dong-ho", { body: { image: p.base64, mime: p.mime } });
        const r = (data as { reading?: number | null } | null)?.reading;
        if (!error && typeof r === "number") { setReading(String(r)); setOcr(r); setMsg("Đã đọc tự động. Hãy kiểm tra số với ảnh rồi sửa nếu sai."); }
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
    const { error } = await supabase.rpc("meter_add", {
      p_customer: customerId, p_kind: kind, p_reading: v, p_path: photo.path, p_store: photo.store, p_thumb: photo.thumb, p_ocr: ocr, p_note: null,
      p_lat: photo.geo?.lat ?? null, p_lng: photo.geo?.lng ?? null, p_accuracy: photo.geo?.accuracy ?? null, p_taken_at: photo.takenAt,
    });
    setBusy(false);
    if (error) { toast(error.message); return; }
    toast("Đã ghi số " + (kind === "dien" ? "điện" : "nước") + "."); onDone();
  }
  return (
    <Sheet open={open} onClose={onClose} title={kind === "dien" ? "Chụp đồng hồ điện" : "Ghi số nước"}>
      <form className="stack" onSubmit={save}>
        {staff ? (
          <label className="field"><span>Loại</span>
            <select className="input" value={kind} onChange={(e) => { setKind(e.target.value as "dien" | "nuoc"); setPhoto(null); setReading(""); setOcr(null); setMsg(""); }}>
              <option value="dien">Điện (kWh)</option><option value="nuoc">Nước (m³)</option>
            </select></label>
        ) : null}
        <label className="field"><span>Ảnh đồng hồ (chụp rõ dãy số) *</span>
          <input className="input" type="file" accept="image/*" capture="environment" disabled={busy} onChange={(e) => pick(e.target.files?.[0])} /></label>
        {msg ? <p className="small" role="status" style={{ margin: 0 }}>{msg}</p> : null}
        <label className="field"><span>Số trên đồng hồ{last != null ? ` (số trước: ${num(last)})` : ""} *</span>
          <input className="input" inputMode="decimal" value={reading} onChange={(e) => setReading(e.target.value)} required /></label>
        <button className="btn block" disabled={busy || !photo}>{busy ? "Đang xử lý…" : "Lưu số"}</button>
      </form>
    </Sheet>
  );
}

function LeaseSheet({ open, onClose, customerId, lease, onDone }: { open: boolean; onClose: () => void; customerId: string; lease: Lease | null; onDone: () => void }) {
  const { toast } = useSession();
  const [f, setF] = useState({ start: "", end: "", rent: "", deposit: "", elec: "", water: "", mode: "m3", service: "", max: "" });
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    if (!open) return;
    setF({
      start: lease?.start_date ?? "", end: lease?.end_date ?? "", rent: lease ? String(lease.rent) : "", deposit: lease ? String(lease.deposit) : "",
      elec: lease?.elec_price != null ? String(lease.elec_price) : "", water: lease?.water_price != null ? String(lease.water_price) : "",
      mode: lease?.water_mode ?? "m3", service: lease ? String(lease.service_fee) : "", max: lease?.max_occupants ? String(lease.max_occupants) : "",
    });
  }, [open, lease]);
  const set = (k: keyof typeof f) => (e: { target: { value: string } }) => setF((p) => ({ ...p, [k]: e.target.value }));
  async function submit(e: FormEvent) {
    e.preventDefault(); setBusy(true);
    const { error } = await supabase.rpc("lease_save", {
      p_customer: customerId, p_start: f.start || null, p_end: f.end || null, p_rent: parseMoney(f.rent) ?? 0, p_deposit: parseMoney(f.deposit) ?? 0,
      p_elec: parseMoney(f.elec), p_water: parseMoney(f.water), p_water_mode: f.mode, p_service: parseMoney(f.service) ?? 0,
      p_max: f.max ? parseInt(f.max, 10) : null,
    });
    setBusy(false);
    if (error) { toast(error.message); return; }
    toast("Đã lưu hợp đồng."); onDone();
  }
  return (
    <Sheet open={open} onClose={onClose} title="Hợp đồng, cọc, đơn giá">
      <form className="stack" onSubmit={submit}>
        <div className="row" style={{ flexWrap: "nowrap", gap: 8 }}>
          <label className="field" style={{ flex: 1 }}><span>Từ ngày</span><input className="input" type="date" value={f.start} onChange={set("start")} /></label>
          <label className="field" style={{ flex: 1 }}><span>Đến ngày</span><input className="input" type="date" value={f.end} onChange={set("end")} /></label>
        </div>
        <label className="field"><span>Tiền phòng mỗi tháng</span><input className="input" inputMode="decimal" value={f.rent} onChange={set("rent")} /></label>
        <label className="field"><span>Tiền cọc công ty đang giữ</span><input className="input" inputMode="decimal" value={f.deposit} onChange={set("deposit")} /></label>
        <label className="field"><span>Đơn giá điện (đ/kWh)</span><input className="input" inputMode="decimal" value={f.elec} onChange={set("elec")} /></label>
        <label className="field"><span>Cách tính nước</span>
          <select className="input" value={f.mode} onChange={set("mode")}><option value="m3">Theo số m³</option><option value="nguoi">Theo đầu người</option></select></label>
        <label className="field"><span>{f.mode === "m3" ? "Đơn giá nước (đ/m³)" : "Tiền nước mỗi người/tháng"}</span><input className="input" inputMode="decimal" value={f.water} onChange={set("water")} /></label>
        <label className="field"><span>Phí dịch vụ mỗi tháng</span><input className="input" inputMode="decimal" value={f.service} onChange={set("service")} /></label>
        <label className="field"><span>Số người ở tối đa</span><input className="input" inputMode="numeric" value={f.max} onChange={set("max")} /></label>
        <button className="btn block" disabled={busy}>{busy ? "Đang lưu…" : "Lưu"}</button>
      </form>
    </Sheet>
  );
}

function StmtSheet({ open, onClose, customerId, onDone }: { open: boolean; onClose: () => void; customerId: string; onDone: () => void }) {
  const { toast } = useSession();
  const [month, setMonth] = useState(todayVN().slice(0, 7));
  const [due, setDue] = useState("");
  const [extra, setExtra] = useState(""); const [note, setNote] = useState("");
  const [pv, setPv] = useState<Preview | null>(null); const [perr, setPerr] = useState("");
  const [busy, setBusy] = useState(false);
  useEffect(() => { if (open && !due) { const d = new Date(Date.now() + 7 * 3600_000 + 5 * 86400_000); setDue(d.toISOString().slice(0, 10)); } }, [open, due]);
  useEffect(() => {
    if (!open) return;
    const t = setTimeout(async () => {
      const { data, error } = await supabase.rpc("statement_preview", { p_customer: customerId, p_month: month + "-01", p_extra: parseMoney(extra) ?? 0, p_extra_note: note });
      if (error) { setPv(null); setPerr(error.message); } else { setPv(data as Preview); setPerr(""); }
    }, 300);
    return () => clearTimeout(t);
  }, [open, customerId, month, extra, note]);
  async function create() {
    setBusy(true);
    const { error } = await supabase.rpc("statement_create", { p_customer: customerId, p_month: month + "-01", p_due: due || null, p_extra: parseMoney(extra) ?? 0, p_extra_note: note });
    setBusy(false);
    if (error) { toast(error.message); return; }
    toast("Đã tạo phiếu thu. Khách xem và quét QR trong mục Thanh toán."); onDone();
  }
  return (
    <Sheet open={open} onClose={onClose} title="Tạo phiếu thu tháng">
      <div className="stack">
        <div className="row" style={{ flexWrap: "nowrap", gap: 8 }}>
          <label className="field" style={{ flex: 1 }}><span>Tháng</span><input className="input" type="month" value={month} onChange={(e) => setMonth(e.target.value)} /></label>
          <label className="field" style={{ flex: 1 }}><span>Hạn thanh toán</span><input className="input" type="date" value={due} onChange={(e) => setDue(e.target.value)} /></label>
        </div>
        <label className="field"><span>Khoản khác (không bắt buộc, số âm là giảm trừ)</span><input className="input" inputMode="decimal" value={extra} onChange={(e) => setExtra(e.target.value)} /></label>
        {extra ? <label className="field"><span>Nội dung khoản khác</span><input className="input" value={note} onChange={(e) => setNote(e.target.value)} /></label> : null}
        {perr ? <div className="error-box" role="alert">{perr}</div> : null}
        {pv ? (
          <div className="card" style={{ padding: 12 }}>
            {pv.lines.map((l, i) => (
              <div key={i} style={{ marginBottom: 6 }}>
                <div className="row" style={{ justifyContent: "space-between", flexWrap: "nowrap" }}><span>{l.label}</span><b className="num">{vnd(l.amount)}</b></div>
                {l.detail ? <div className="muted small">{l.detail}</div> : null}
              </div>
            ))}
            <div className="row" style={{ justifyContent: "space-between", borderTop: "1px solid var(--line)", paddingTop: 8 }}><b>Tổng</b><b className="num">{vnd(pv.total)}</b></div>
          </div>
        ) : null}
        <p className="muted small" style={{ margin: 0 }}>Khi tạo, số điện nước mới nhất được chốt làm số đầu kỳ của lần sau.</p>
        <button className="btn block" disabled={busy || !pv || pv.total <= 0} onClick={create}>{busy ? "Đang tạo…" : "Tạo phiếu thu và QR"}</button>
      </div>
    </Sheet>
  );
}
