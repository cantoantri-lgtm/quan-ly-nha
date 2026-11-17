import { useCallback, useEffect, useState, type FormEvent } from "react";
import { friendlyError, supabase } from "../lib/supabase";
import { useSession } from "../lib/session";
import { ddmmyyyy, todayVN } from "../lib/dates";
import { parseMoney, vnd } from "../lib/money";
import { Sheet } from "./ui";
import FileGallery from "./FileGallery";

type Lease = {
  building_id: string; lessor_name: string | null; lessor_phone: string | null; lease_start: string | null; lease_end: string | null;
  deposit: number | null; pay_terms: string | null; gpkd_no: string | null; gpkd_date: string | null; gpkd_place: string | null;
  gpkd_name: string | null; note: string | null; updated_at: string;
};
type Rent = { id: string; effective_from: string; monthly_rent: number; note: string | null };
const DOC_TYPES = { gpkd: "Giấy phép kinh doanh", hd_thue: "Hợp đồng thuê toà", khac: "Tài liệu khác" };
const monthText = (d: string) => `${d.slice(5, 7)}/${d.slice(0, 4)}`;

/** Hồ sơ thuê toà: bên cho thuê, thời hạn, cọc, tiền thuê hằng tháng, GPKD và tệp hợp đồng thuê toà.
 *  Xem: Quản lý, Lead Sale, Kế toán. Sửa: Quản lý, Lead Sale (khớp can_lease_view / can_lease_edit). */
export default function LeasePanel({ buildingId }: { buildingId: string }) {
  const { toast } = useSession();
  const [can, setCan] = useState<{ view: boolean; edit: boolean } | null>(null);
  const [lease, setLease] = useState<Lease | null>(null);
  const [rents, setRents] = useState<Rent[]>([]);
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState(false);
  const [addRent, setAddRent] = useState(false);

  useEffect(() => {
    Promise.all([supabase.rpc("can_lease_view"), supabase.rpc("can_lease_edit")])
      .then(([v, e]) => setCan({ view: !!v.data, edit: !!e.data }));
  }, []);
  const load = useCallback(async () => {
    const [l, r] = await Promise.all([
      supabase.from("building_leases").select("*").eq("building_id", buildingId).maybeSingle(),
      supabase.from("building_rents").select("id,effective_from,monthly_rent,note").eq("building_id", buildingId).order("effective_from", { ascending: false }),
    ]);
    setLease((l.data as Lease | null) ?? null); setRents((r.data as Rent[]) ?? []);
  }, [buildingId]);
  useEffect(() => { if (can?.view) load(); }, [can, load]);

  if (!can?.view) return null;
  const today = todayVN();
  const cur = rents.find((r) => r.effective_from <= today) ?? null;
  const daysLeft = lease?.lease_end ? Math.round((Date.parse(lease.lease_end) - Date.parse(today)) / 86400000) : null;

  async function delRent(r: Rent) {
    if (!window.confirm(`Xoá mức thuê ${vnd(r.monthly_rent)} từ tháng ${monthText(r.effective_from)}?`)) return;
    const { error } = await supabase.rpc("rent_delete", { p_id: r.id });
    if (error) toast(friendlyError(error)); else { toast("Đã xoá."); load(); }
  }

  return (
    <section className="card stack" style={{ padding: 14 }}>
      <button type="button" className="row" style={{ justifyContent: "space-between", border: 0, background: "none", padding: 0, cursor: "pointer", color: "inherit", width: "100%" }}
        aria-expanded={open} onClick={() => setOpen(!open)}>
        <span style={{ textAlign: "left" }}><b>Hồ sơ thuê toà nhà</b><br />
          <small className="muted">{cur ? `Thuê ${vnd(cur.monthly_rent)}/tháng` : "Chưa nhập tiền thuê toà"}
            {lease?.lease_end ? ` · hết hạn ${ddmmyyyy(lease.lease_end)}` : ""}{daysLeft != null && daysLeft <= 90 ? (daysLeft < 0 ? " · ĐÃ HẾT HẠN" : ` · còn ${daysLeft} ngày`) : ""}</small></span>
        <span aria-hidden="true">{open ? "▲" : "▼"}</span>
      </button>
      {open ? (
        <>
          <dl className="kv" style={{ margin: 0 }}>
            <dt>Bên cho thuê</dt><dd>{lease?.lessor_name ?? "—"}{lease?.lessor_phone ? ` · ${lease.lessor_phone}` : ""}</dd>
            <dt>Thời hạn</dt><dd className="num">{lease?.lease_start ? ddmmyyyy(lease.lease_start) : "—"} → {lease?.lease_end ? ddmmyyyy(lease.lease_end) : "—"}</dd>
            <dt>Tiền cọc toà</dt><dd className="num">{lease?.deposit != null ? vnd(lease.deposit) : "—"}</dd>
            <dt>Thanh toán</dt><dd>{lease?.pay_terms ?? "—"}</dd>
            <dt>GPKD</dt><dd>{lease?.gpkd_no ? `Số ${lease.gpkd_no}` : "—"}{lease?.gpkd_date ? ` · cấp ${ddmmyyyy(lease.gpkd_date)}` : ""}{lease?.gpkd_place ? ` · ${lease.gpkd_place}` : ""}
              {lease?.gpkd_name ? <><br /><small className="muted">{lease.gpkd_name}</small></> : null}</dd>
            {lease?.note ? <><dt>Ghi chú</dt><dd style={{ whiteSpace: "pre-wrap" }}>{lease.note}</dd></> : null}
          </dl>
          {can.edit ? <button type="button" className="btn secondary sm" onClick={() => setEditing(true)}>Sửa hồ sơ thuê toà</button> : null}

          <div className="row" style={{ justifyContent: "space-between" }}>
            <b>Tiền thuê toà hằng tháng</b>
            {can.edit ? <button type="button" className="btn secondary sm" onClick={() => setAddRent(true)}>+ Mức thuê</button> : null}
          </div>
          {rents.length ? (
            <ul className="dn-list" style={{ margin: 0 }}>
              {rents.map((r) => (
                <li key={r.id}><span>Từ tháng <b className="num">{monthText(r.effective_from)}</b>: <b className="num">{vnd(r.monthly_rent)}</b>/tháng{r.note ? <><br /><small className="muted">{r.note}</small></> : null}</span>
                  {can.edit ? <button type="button" className="btn ghost sm" onClick={() => delRent(r)}>Xoá</button> : null}</li>
              ))}
            </ul>
          ) : <p className="muted small" style={{ margin: 0 }}>Chưa có. Báo cáo lợi nhuận cần tiền thuê toà để trừ chi phí.</p>}

          <FileGallery owner={{ kind: "ho_so_toa", buildingId }} title="GPKD, hợp đồng thuê toà" docTypes={DOC_TYPES}
            hint="Ảnh hoặc PDF. Chỉ Quản lý, Lead Sale và Kế toán xem được." canUpload={can.edit} canDelete={can.edit} />
          {!can.edit ? <p className="muted small" style={{ margin: 0 }}>Bạn chỉ xem. Quản lý hoặc Lead Sale cập nhật hồ sơ thuê toà.</p> : null}
        </>
      ) : null}
      {editing ? <LeaseSheet buildingId={buildingId} lease={lease} onClose={() => setEditing(false)} onSaved={() => { setEditing(false); load(); toast("Đã lưu hồ sơ thuê toà."); }} /> : null}
      {addRent ? <RentSheet buildingId={buildingId} onClose={() => setAddRent(false)} onSaved={() => { setAddRent(false); load(); toast("Đã lưu tiền thuê toà."); }} /> : null}
    </section>
  );
}

function LeaseSheet({ buildingId, lease, onClose, onSaved }: { buildingId: string; lease: Lease | null; onClose: () => void; onSaved: () => void }) {
  const [f, setF] = useState({
    lessor_name: lease?.lessor_name ?? "", lessor_phone: lease?.lessor_phone ?? "", lease_start: lease?.lease_start ?? "", lease_end: lease?.lease_end ?? "",
    deposit: lease?.deposit != null ? new Intl.NumberFormat("vi-VN").format(lease.deposit) : "", pay_terms: lease?.pay_terms ?? "",
    gpkd_no: lease?.gpkd_no ?? "", gpkd_date: lease?.gpkd_date ?? "", gpkd_place: lease?.gpkd_place ?? "", gpkd_name: lease?.gpkd_name ?? "", note: lease?.note ?? "",
  });
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const set = (k: keyof typeof f) => (e: { target: { value: string } }) => setF({ ...f, [k]: e.target.value });
  async function submit(e: FormEvent) {
    e.preventDefault(); setErr(null);
    const dep = f.deposit.trim() ? parseMoney(f.deposit) : null;
    if (f.deposit.trim() && dep == null) { setErr("Tiền cọc chưa đúng, VD 300.000.000 hoặc 300tr."); return; }
    if (f.lease_start && f.lease_end && f.lease_end < f.lease_start) { setErr("Ngày hết hạn phải sau ngày bắt đầu."); return; }
    setBusy(true);
    const { error } = await supabase.rpc("building_lease_save", { p_building: buildingId, p: { ...f, deposit: dep == null ? "" : String(dep) } });
    setBusy(false);
    if (error) { setErr(friendlyError(error)); return; }
    onSaved();
  }
  return (
    <Sheet open onClose={onClose} title="Hồ sơ thuê toà nhà">
      <form className="stack" onSubmit={submit}>
        <b>Hợp đồng thuê toà</b>
        <label className="field"><span>Bên cho thuê (chủ nhà)</span><input className="input" value={f.lessor_name} onChange={set("lessor_name")} /></label>
        <label className="field"><span>SĐT chủ nhà</span><input className="input" inputMode="tel" value={f.lessor_phone} onChange={set("lessor_phone")} /></label>
        <div className="row" style={{ alignItems: "flex-start" }}>
          <label className="field" style={{ flex: "1 1 150px" }}><span>Bắt đầu thuê</span><input className="input" type="date" value={f.lease_start} onChange={set("lease_start")} /></label>
          <label className="field" style={{ flex: "1 1 150px" }}><span>Hết hạn</span><input className="input" type="date" value={f.lease_end} onChange={set("lease_end")} /></label>
        </div>
        <label className="field"><span>Tiền cọc toà</span><input className="input num" inputMode="decimal" value={f.deposit} onChange={set("deposit")} /></label>
        <label className="field"><span>Điều khoản thanh toán</span><input className="input" value={f.pay_terms} onChange={set("pay_terms")} placeholder="VD: trả 3 tháng/lần, trước ngày 5" /></label>
        <b>Giấy phép kinh doanh</b>
        <div className="row" style={{ alignItems: "flex-start" }}>
          <label className="field" style={{ flex: "1 1 150px" }}><span>Số GPKD</span><input className="input" value={f.gpkd_no} onChange={set("gpkd_no")} /></label>
          <label className="field" style={{ flex: "1 1 150px" }}><span>Ngày cấp</span><input className="input" type="date" value={f.gpkd_date} onChange={set("gpkd_date")} /></label>
        </div>
        <label className="field"><span>Nơi cấp</span><input className="input" value={f.gpkd_place} onChange={set("gpkd_place")} /></label>
        <label className="field"><span>Tên hộ / doanh nghiệp trên GPKD</span><input className="input" value={f.gpkd_name} onChange={set("gpkd_name")} /></label>
        <label className="field"><span>Ghi chú</span><textarea className="input" style={{ minHeight: 60 }} value={f.note} onChange={set("note")} /></label>
        {err ? <div className="error-box" role="alert">{err}</div> : null}
        <button className="btn block" disabled={busy}>{busy ? "Đang lưu…" : "Lưu"}</button>
      </form>
    </Sheet>
  );
}

function RentSheet({ buildingId, onClose, onSaved }: { buildingId: string; onClose: () => void; onSaved: () => void }) {
  const [from, setFrom] = useState(todayVN().slice(0, 7));
  const [amount, setAmount] = useState("");
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  async function submit(e: FormEvent) {
    e.preventDefault(); setErr(null);
    const a = parseMoney(amount);
    if (a == null) { setErr("Nhập tiền thuê, VD 45.000.000 hoặc 45tr."); return; }
    setBusy(true);
    const { error } = await supabase.rpc("rent_save", { p_building: buildingId, p_from: `${from}-01`, p_amount: a, p_note: note });
    setBusy(false);
    if (error) { setErr(friendlyError(error)); return; }
    onSaved();
  }
  return (
    <Sheet open onClose={onClose} title="Tiền thuê toà hằng tháng">
      <form className="stack" onSubmit={submit}>
        <label className="field"><span>Áp dụng từ tháng</span><input className="input" type="month" value={from} onChange={(e) => setFrom(e.target.value)} required /></label>
        <label className="field"><span>Tiền thuê / tháng *</span><input className="input num" inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} /></label>
        <label className="field"><span>Ghi chú</span><input className="input" value={note} onChange={(e) => setNote(e.target.value)} placeholder="VD: tăng 5% theo hợp đồng" /></label>
        {err ? <div className="error-box" role="alert">{err}</div> : null}
        <button className="btn block" disabled={busy}>{busy ? "Đang lưu…" : "Lưu"}</button>
      </form>
    </Sheet>
  );
}
