import { FormEvent, useState } from "react";
import { friendlyError, supabase } from "../lib/supabase";
import { parseMoney } from "../lib/money";
import { Sheet } from "./ui";
import type { Fee, Policy, Term } from "./PolicyView";
import "../policy.css";

type FeeRow = { label: string; amount: string; unit: string };
type TermRow = { months: string; pct: string };
const lines = (s: string) => s.split("\n").map((x) => x.trim()).filter(Boolean);

export default function PolicyEditSheet({ p, onClose, onSaved }: { p: Policy; onClose: () => void; onSaved: () => void }) {
  const [fees, setFees] = useState<FeeRow[]>(p.fees.map((f) => ({ label: f.label, amount: new Intl.NumberFormat("vi-VN").format(f.amount), unit: f.unit })));
  const [amenities, setAmenities] = useState(p.amenities.join("\n"));
  const [furn, setFurn] = useState(p.furniture.join("\n"));
  const [deposit, setDeposit] = useState(p.deposit_lines.join("\n"));
  const [terms, setTerms] = useState<TermRow[]>(p.commission_terms.map((t) => ({ months: String(t.months), pct: String(t.pct) })));
  const [fMin, setFMin] = useState(p.forfeit_min != null ? new Intl.NumberFormat("vi-VN").format(p.forfeit_min) : "");
  const [fPct, setFPct] = useState(p.forfeit_pct != null ? String(p.forfeit_pct) : "");
  const [note, setNote] = useState(p.note ?? "");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function submit(e: FormEvent) {
    e.preventDefault(); setErr(null);
    const feeOut: Fee[] = [];
    for (const r of fees) {
      if (!r.label.trim() && !r.amount.trim()) continue;
      const a = parseMoney(r.amount);
      if (!r.label.trim() || a == null) { setErr("Mỗi khoản phí cần có tên và số tiền (VD 4000, 120.000, 150k)."); return; }
      feeOut.push({ label: r.label.trim(), amount: a, unit: r.unit.trim() });
    }
    const termOut: Term[] = [];
    for (const r of terms) {
      if (!r.months.trim() && !r.pct.trim()) continue;
      const m = Number(r.months), pc = Number(r.pct.replace(",", "."));
      if (!Number.isInteger(m) || m < 1 || !Number.isFinite(pc) || pc < 0 || pc > 100) { setErr("Hoa hồng theo kỳ hợp đồng: số tháng nguyên (VD 12) và tỷ lệ từ 0 đến 100."); return; }
      termOut.push({ months: m, pct: pc });
    }
    const fm = fMin.trim() ? parseMoney(fMin) : null;
    if (fMin.trim() && fm == null) { setErr("Mức tiền cọc chưa đúng. Nhập dạng 3.000.000 hoặc 3tr."); return; }
    const fp = fPct.trim() ? Number(fPct.replace(",", ".")) : null;
    if (fp != null && (!Number.isFinite(fp) || fp < 0 || fp > 100)) { setErr("Tỷ lệ hoa hồng bỏ cọc phải từ 0 đến 100."); return; }
    setBusy(true);
    const { error } = await supabase.from("building_policy").upsert({
      building_id: p.building_id, fees: feeOut, amenities: lines(amenities), furniture: lines(furn), deposit_lines: lines(deposit),
      commission_terms: termOut, forfeit_min: fm, forfeit_pct: fp, note: note.trim() || null,
    }, { onConflict: "building_id" });
    setBusy(false);
    if (error) { setErr(friendlyError(error)); return; }
    onSaved();
  }

  return (
    <Sheet open onClose={onClose} title={`Chính sách · ${p.code}`}>
      <form className="stack" onSubmit={submit}>
        <section className="stack">
          <b>Phí dịch vụ</b>
          {fees.map((f, i) => (
            <div key={i} className="pl-edit-row">
              <input className="input" aria-label="Tên khoản phí" placeholder="Điện" value={f.label} onChange={(e) => setFees(fees.map((x, j) => j === i ? { ...x, label: e.target.value } : x))} />
              <input className="input num" aria-label="Số tiền" inputMode="decimal" placeholder="4.000" value={f.amount} onChange={(e) => setFees(fees.map((x, j) => j === i ? { ...x, amount: e.target.value } : x))} />
              <input className="input" aria-label="Đơn vị" placeholder="kWh" value={f.unit} onChange={(e) => setFees(fees.map((x, j) => j === i ? { ...x, unit: e.target.value } : x))} />
              <button type="button" className="btn ghost sm" aria-label="Bỏ khoản phí" onClick={() => setFees(fees.filter((_, j) => j !== i))}>×</button>
            </div>
          ))}
          <button type="button" className="btn secondary sm" onClick={() => setFees([...fees, { label: "", amount: "", unit: "" }])}>+ Thêm khoản phí</button>
          <small className="muted">Mỗi khoản: tên, số tiền (đ), đơn vị tính (kWh, người, chiếc, tháng).</small>
        </section>

        <label className="field"><span>Tiện ích (mỗi dòng một mục)</span>
          <textarea className="input" style={{ minHeight: 90 }} value={amenities} onChange={(e) => setAmenities(e.target.value)} /></label>
        <label className="field"><span>Danh mục nội thất (mỗi dòng một món)</span>
          <textarea className="input" style={{ minHeight: 90 }} value={furn} onChange={(e) => setFurn(e.target.value)} /></label>
        <p className="muted small" style={{ margin: 0 }}>Từ đây xuống: chỉ Sale và Cộng tác viên thấy, khách không thấy.</p>
        <label className="field"><span>Ký hợp đồng: đặt cọc, kỳ hợp đồng (mỗi dòng một ý)</span>
          <textarea className="input" style={{ minHeight: 110 }} value={deposit} onChange={(e) => setDeposit(e.target.value)} /></label>

        <section className="stack">
          <b>Hoa hồng Cộng tác viên</b>
          <small className="muted">Hợp đồng thành công: tỷ lệ % tiền thuê tháng đầu theo kỳ hợp đồng.</small>
          {terms.map((t, i) => (
            <div key={i} className="pl-edit-row pl-edit-terms">
              <input className="input num" aria-label="Số tháng" inputMode="numeric" placeholder="12" value={t.months} onChange={(e) => setTerms(terms.map((x, j) => j === i ? { ...x, months: e.target.value.replace(/\D/g, "") } : x))} />
              <span className="muted small">tháng →</span>
              <input className="input num" aria-label="Tỷ lệ %" inputMode="decimal" placeholder="80" value={t.pct} onChange={(e) => setTerms(terms.map((x, j) => j === i ? { ...x, pct: e.target.value } : x))} />
              <span className="muted small">%</span>
              <button type="button" className="btn ghost sm" aria-label="Bỏ dòng" onClick={() => setTerms(terms.filter((_, j) => j !== i))}>×</button>
            </div>
          ))}
          <button type="button" className="btn secondary sm" onClick={() => setTerms([...terms, { months: "", pct: "" }])}>+ Thêm kỳ hợp đồng</button>
          <div className="row" style={{ alignItems: "flex-start" }}>
            <label className="field" style={{ flex: "1 1 170px" }}><span>Khách bỏ cọc: chỉ chi khi cọc giữ từ (đ)</span>
              <input className="input num" inputMode="decimal" placeholder="3.000.000" value={fMin} onChange={(e) => setFMin(e.target.value)} /></label>
            <label className="field" style={{ flex: "1 1 110px" }}><span>Hoa hồng bỏ cọc (%)</span>
              <input className="input num" inputMode="decimal" placeholder="30" value={fPct} onChange={(e) => setFPct(e.target.value)} /></label>
          </div>
        </section>

        <label className="field"><span>Ghi chú</span>
          <textarea className="input" style={{ minHeight: 60 }} value={note} onChange={(e) => setNote(e.target.value)} /></label>
        {err ? <div className="error-box" role="alert">{err}</div> : null}
        <button className="btn block" disabled={busy}>{busy ? "Đang lưu…" : "Lưu"}</button>
      </form>
    </Sheet>
  );
}
