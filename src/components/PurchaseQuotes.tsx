import { useCallback, useEffect, useMemo, useState, type FormEvent } from "react";
import { Link } from "react-router-dom";
import { friendlyError, supabase } from "../lib/supabase";
import { useSession } from "../lib/session";
import { parseMoney, vnd } from "../lib/money";
import { BUY_STAGE_LABEL, type BuyStage, type Req } from "../lib/office";
import {
  DEFAULT_PSETTINGS, loadPurchaseSettings, loadQuotes, loadVendors, reasonNeeded,
  type PurchaseSettings, type Quote, type Vendor,
} from "../lib/purchase";
import { Combo, Sheet } from "./ui";
import { VendorSheet } from "./VendorSheet";

const STAGES: BuyStage[] = ["nhu_cau", "bao_gia", "duyet_gia", "da_chot"];
const fmt = (n: number) => new Intl.NumberFormat("vi-VN").format(n);

/** Tiến trình + báo giá NCC của đề nghị mua hàng 2 bước (SQL 108). CSDL kiểm tra quyền trong purchase_quote_save / purchase_price_submit. */
export function PurchaseQuotes({ r, canQuote, onChanged }: { r: Req; canQuote: boolean; onChanged: () => void }) {
  const { toast, isManager, myStaff } = useSession();
  const [quotes, setQuotes] = useState<Quote[]>([]);
  const [vendors, setVendors] = useState<Vendor[]>([]);
  const [cfg, setCfg] = useState<PurchaseSettings>(DEFAULT_PSETTINGS);
  const [editing, setEditing] = useState<Quote | "new" | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const load = useCallback(async () => {
    const [q, v, c] = await Promise.all([loadQuotes(r.id), loadVendors(), loadPurchaseSettings()]);
    setQuotes(q); setVendors(v); setCfg(c);
  }, [r.id]);
  useEffect(() => { load(); }, [load, r.updated_at]);

  const stage = r.buy_stage as BuyStage;
  const idx = STAGES.indexOf(stage);
  const vName = (id: string | null | undefined) => vendors.find((v) => v.id === id)?.name ?? "—";
  const low = quotes.length ? Math.min(...quotes.map((q) => Number(q.total))) : 0;
  const needN = quotes.length && Math.max(...quotes.map((q) => Number(q.total))) >= cfg.quote_threshold ? cfg.min_quotes : 1;
  const canEditVendors = isManager || myStaff?.duty === "mua_hang" || myStaff?.duty === "ke_toan";

  async function del(q: Quote) {
    if (!confirm(`Xoá báo giá của ${vName(q.vendor_id)}?`)) return;
    const { error } = await supabase.rpc("purchase_quote_delete", { p_id: q.id });
    if (error) { toast(friendlyError(error)); return; }
    toast("Đã xoá báo giá"); load();
  }

  return (
    <>
      <div className="section-title">Tiến trình mua hàng</div>
      <div className="buy-track" aria-label="Tiến trình mua hàng">
        {STAGES.map((s, i) => (
          <span key={s} className={i < idx || (s === "da_chot" && stage === "da_chot") ? "done" : i === idx ? "now" : ""}
            aria-current={i === idx ? "step" : undefined}>{BUY_STAGE_LABEL[s]}</span>
        ))}
      </div>

      {stage === "nhu_cau" ? (
        <p className="muted small" style={{ margin: 0 }}>Duyệt xong nhu cầu, người mua hàng sẽ lấy báo giá các nhà cung cấp (NCC) và chọn NCC để trình duyệt giá.</p>
      ) : (
        <>
          <div className="section-title">Báo giá nhà cung cấp</div>
          <p className="muted small" style={{ margin: 0 }}>
            Quy trình mua hàng: đơn từ {vnd(cfg.quote_threshold)} cần tối thiểu {cfg.min_quotes} báo giá. Đang có {quotes.length}{needN > 1 && quotes.length < needN ? `, thiếu ${needN - quotes.length}` : ""}.
          </p>
          {stage !== "bao_gia" && r.buy_vendor_id ? (
            <div className="card stack" style={{ padding: 12, gap: 4 }}>
              <div><b>NCC trình duyệt:</b> {vName(r.buy_vendor_id)} · <b className="num">{vnd(r.amount)}</b></div>
              {r.buy_estimate != null && Number(r.buy_estimate) !== Number(r.amount) ? (
                <div className="muted small">Dự kiến lúc duyệt nhu cầu {vnd(r.buy_estimate)} · {Number(r.amount) < Number(r.buy_estimate) ? "tiết kiệm" : "vượt"} {vnd(Math.abs(Number(r.amount) - Number(r.buy_estimate)))}</div>
              ) : null}
              {r.buy_reason ? <div className="small"><b>Lý do:</b> {r.buy_reason}</div> : null}
            </div>
          ) : null}
          {quotes.length ? (
            <div className="card" style={{ padding: 0 }}>
              {quotes.map((q) => (
                <div key={q.id} className={`quote${q.id === r.buy_quote_id && stage !== "bao_gia" ? " chosen" : ""}`}>
                  <div className="quote-head">
                    <b>{vName(q.vendor_id)}</b>
                    <span className="quote-total">{vnd(q.total)}</span>
                  </div>
                  <div className="quote-tags">
                    {Number(q.total) === low && quotes.length > 1 ? <span className="tag perm-l1">Giá thấp nhất</span> : null}
                    {q.id === r.buy_quote_id && stage !== "bao_gia" ? <span className="tag perm-l2">Đã chọn</span> : null}
                    <span className="tag">{q.vat_included ? "Đã gồm VAT" : "Chưa gồm VAT"}</span>
                    {Number(q.total) > low ? <span className="tag">+{fmt(Number(q.total) - low)} đ</span> : null}
                  </div>
                  <div className="quote-meta">
                    {[q.delivery_days != null ? `Giao ${q.delivery_days} ngày` : null, q.payment_terms, q.warranty ? `Bảo hành ${q.warranty}` : null].filter(Boolean).join(" · ")}
                  </div>
                  {q.note ? <div className="quote-meta">{q.note}</div> : null}
                  {canQuote ? (
                    <div className="quote-acts">
                      <button type="button" className="btn secondary sm" onClick={() => setEditing(q)}>Sửa</button>
                      <button type="button" className="btn ghost sm" onClick={() => del(q)}>Xoá</button>
                    </div>
                  ) : null}
                </div>
              ))}
            </div>
          ) : (
            <p className="muted" style={{ margin: 0 }}>{stage === "bao_gia" ? "Chưa có báo giá." : "Không có báo giá."}</p>
          )}
          {canQuote ? (
            <div className="row" style={{ gap: 8 }}>
              <button type="button" className="btn secondary" onClick={() => setEditing("new")}>+ Thêm báo giá</button>
              <button type="button" className="btn" disabled={!quotes.length} onClick={() => setSubmitting(true)}>Chọn NCC & trình duyệt</button>
            </div>
          ) : stage === "bao_gia" ? (
            <p className="muted small" style={{ margin: 0 }}>Đang chờ người mua hàng nhập báo giá.</p>
          ) : null}
          {canQuote ? <p className="muted small" style={{ margin: 0 }}>Tải ảnh / PDF báo giá ở mục "Báo giá đính kèm" bên dưới. <Link to="/van-phong/nha-cung-cap">Danh bạ nhà cung cấp</Link></p> : null}
        </>
      )}

      <QuoteSheet open={editing !== null} quote={editing === "new" ? null : editing} requestId={r.id} vendors={vendors}
        usedVendorIds={quotes.filter((q) => editing === "new" || (editing && q.id !== editing.id)).map((q) => q.vendor_id)}
        canEditVendors={canEditVendors}
        onVendorsChanged={(v) => setVendors((list) => [...list.filter((x) => x.id !== v.id), v].sort((a, b) => a.name.localeCompare(b.name, "vi")))}
        onClose={() => setEditing(null)} onSaved={() => { setEditing(null); toast("Đã lưu báo giá"); load(); }} />
      <SubmitSheet open={submitting} r={r} quotes={quotes} cfg={cfg} vName={vName}
        onClose={() => setSubmitting(false)} onDone={() => { setSubmitting(false); toast("Đã trình duyệt NCC & giá"); onChanged(); }} />
    </>
  );
}

function QuoteSheet({ open, quote, requestId, vendors, usedVendorIds, canEditVendors, onVendorsChanged, onClose, onSaved }: {
  open: boolean; quote: Quote | null; requestId: string; vendors: Vendor[]; usedVendorIds: string[]; canEditVendors: boolean;
  onVendorsChanged: (v: Vendor) => void; onClose: () => void; onSaved: () => void;
}) {
  const [vendor, setVendor] = useState("");
  const [total, setTotal] = useState("");
  const [vat, setVat] = useState<"1" | "0">("1");
  const [days, setDays] = useState("");
  const [terms, setTerms] = useState("");
  const [warranty, setWarranty] = useState("");
  const [note, setNote] = useState("");
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);
  const [newVendor, setNewVendor] = useState(false);
  useEffect(() => {
    if (!open) return;
    setErr("");
    setVendor(quote?.vendor_id ?? ""); setTotal(quote ? fmt(Number(quote.total)) : ""); setVat(quote && !quote.vat_included ? "0" : "1");
    setDays(quote?.delivery_days != null ? String(quote.delivery_days) : ""); setTerms(quote?.payment_terms ?? "");
    setWarranty(quote?.warranty ?? ""); setNote(quote?.note ?? "");
  }, [open, quote]);

  const opts = useMemo(() => vendors.filter((v) => (v.is_active || v.id === vendor) && !usedVendorIds.includes(v.id)).map((v) => [v.id, v.name] as const), [vendors, usedVendorIds, vendor]);
  const amount = parseMoney(total);

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (!vendor) { setErr("Chọn nhà cung cấp."); return; }
    if (!amount || amount <= 0) { setErr("Nhập tổng tiền báo giá."); return; }
    const d = days.trim() ? Number(days) : null;
    if (d != null && !(Number.isInteger(d) && d >= 0 && d <= 365)) { setErr("Số ngày giao hàng từ 0 đến 365."); return; }
    setBusy(true); setErr("");
    const { error } = await supabase.rpc("purchase_quote_save", {
      p_request: requestId, p_id: quote?.id ?? null, p_vendor: vendor, p_total: amount, p_vat: vat === "1",
      p_delivery: d, p_terms: terms.trim() || null, p_warranty: warranty.trim() || null, p_note: note.trim() || null,
    });
    setBusy(false);
    if (error) { setErr(friendlyError(error)); return; }
    onSaved();
  }

  return (
    <>
      <Sheet open={open && !newVendor} onClose={onClose} title={quote ? "Sửa báo giá" : "Thêm báo giá"}>
        <form className="stack" onSubmit={submit}>
          <label className="field"><span>Nhà cung cấp</span>
            <Combo id="q-vendor" value={vendor} options={opts} onChange={setVendor} label="Nhà cung cấp" placeholder={opts.length ? "— Chọn nhà cung cấp —" : "Chưa có NCC, thêm mới bên dưới"} /></label>
          {canEditVendors ? <button type="button" className="btn ghost sm" style={{ justifySelf: "start" }} onClick={() => setNewVendor(true)}>+ Thêm nhà cung cấp mới</button> : null}
          <label className="field"><span>Tổng tiền báo giá</span>
            <input className="input num" inputMode="numeric" placeholder="VD: 12.500.000 hoặc 12,5tr" value={total} onChange={(e) => setTotal(e.target.value)}
              onBlur={() => { if (amount) setTotal(fmt(amount)); }} />
            {amount ? <small className="muted">{vnd(amount)}</small> : null}</label>
          <div className="row" style={{ gap: 8, flexWrap: "nowrap" }}>
            <label className="field" style={{ flex: 1 }}><span>Thuế VAT</span>
              <Combo value={vat} options={[["1", "Đã gồm VAT"], ["0", "Chưa gồm VAT"]] as const} onChange={setVat} label="Thuế VAT" /></label>
            <label className="field" style={{ flex: 1 }}><span>Giao hàng (ngày)</span>
              <input className="input num" inputMode="numeric" value={days} onChange={(e) => setDays(e.target.value.replace(/\D/g, ""))} maxLength={3} /></label>
          </div>
          <label className="field"><span>Điều kiện thanh toán</span><input className="input" placeholder="VD: cọc 30%, còn lại khi giao" value={terms} onChange={(e) => setTerms(e.target.value)} maxLength={200} /></label>
          <label className="field"><span>Bảo hành</span><input className="input" placeholder="VD: 12 tháng" value={warranty} onChange={(e) => setWarranty(e.target.value)} maxLength={200} /></label>
          <label className="field"><span>Ghi chú</span><textarea className="input" rows={2} value={note} onChange={(e) => setNote(e.target.value)} maxLength={500} /></label>
          {err ? <div className="error-box" role="alert">{err}</div> : null}
          <button className="btn block" disabled={busy}>{busy ? "Đang lưu…" : "Lưu báo giá"}</button>
        </form>
      </Sheet>
      <VendorSheet open={open && newVendor} vendor={null} onClose={() => setNewVendor(false)}
        onSaved={(v) => { onVendorsChanged(v); setVendor(v.id); setNewVendor(false); }} />
    </>
  );
}

function SubmitSheet({ open, r, quotes, cfg, vName, onClose, onDone }: {
  open: boolean; r: Req; quotes: Quote[]; cfg: PurchaseSettings; vName: (id: string) => string; onClose: () => void; onDone: () => void;
}) {
  const [pick, setPick] = useState("");
  const [reason, setReason] = useState("");
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    if (!open) return;
    setErr(""); setReason(r.buy_reason ?? "");
    const lowest = [...quotes].sort((a, b) => Number(a.total) - Number(b.total))[0];
    setPick(r.buy_quote_id && quotes.some((q) => q.id === r.buy_quote_id) ? r.buy_quote_id : lowest?.id ?? "");
  }, [open, quotes, r.buy_quote_id, r.buy_reason]);

  const chosen = quotes.find((q) => q.id === pick);
  const need = reasonNeeded(chosen, quotes, cfg);
  const est = r.buy_estimate ?? r.amount;

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (!chosen) { setErr("Chọn nhà cung cấp."); return; }
    if (need && !reason.trim()) { setErr(`Cần ghi lý do: ${need}.`); return; }
    setBusy(true); setErr("");
    const { error } = await supabase.rpc("purchase_price_submit", { p_request: r.id, p_quote: chosen.id, p_reason: reason.trim() || null });
    setBusy(false);
    if (error) { setErr(friendlyError(error)); return; }
    onDone();
  }

  return (
    <Sheet open={open} onClose={onClose} title="Chọn NCC & trình duyệt">
      <form className="stack" onSubmit={submit}>
        <label className="field"><span>Nhà cung cấp chọn mua</span>
          <Combo id="q-pick" value={pick} label="Nhà cung cấp chọn mua" onChange={setPick}
            options={quotes.map((q) => [q.id, `${vName(q.vendor_id)} · ${vnd(q.total)}`] as const)} /></label>
        {chosen && est != null ? (
          <p className="muted small" style={{ margin: 0 }}>Dự kiến lúc duyệt nhu cầu {vnd(est)}. Giá chọn {Number(chosen.total) <= Number(est) ? "thấp hơn" : "cao hơn"} {vnd(Math.abs(Number(chosen.total) - Number(est)))}.</p>
        ) : null}
        <label className="field"><span>Lý do chọn / ghi chú{need ? " (bắt buộc)" : ""}</span>
          <textarea className="input" rows={3} value={reason} onChange={(e) => setReason(e.target.value)} maxLength={1000}
            placeholder={need ? `Vì ${need}` : "VD: giao nhanh, bảo hành dài"} />
          {need ? <small style={{ color: "var(--late)" }}>Cần ghi lý do vì {need}.</small> : null}</label>
        <p className="muted small" style={{ margin: 0 }}>Trình xong, phiếu chuyển sang luồng Duyệt NCC & giá. Duyệt xong mới làm đề nghị thanh toán; đơn vị nhận và tài khoản ngân hàng lấy theo NCC đã chọn.</p>
        {err ? <div className="error-box" role="alert">{err}</div> : null}
        <button className="btn block" disabled={busy || !chosen}>{busy ? "Đang trình…" : "Trình duyệt NCC & giá"}</button>
      </form>
    </Sheet>
  );
}
