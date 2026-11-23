import { useState, type FormEvent } from "react";
import { friendlyError, supabase } from "../lib/supabase";
import { useSession } from "../lib/session";
import { parseMoney } from "../lib/money";
import { Sheet } from "./ui";
import type { Policy } from "./PolicyView";

type Row = { months: string; pct: string };

/** Hoa hồng CTV của một toà. Chỉ Lead Sale trở lên mở được; quyền kiểm ở hàm policy_commission_save (097). */
export default function CommissionSheet({ p, onClose, onSaved }: { p: Policy; onClose: () => void; onSaved: () => void }) {
  const { toast } = useSession();
  const [rows, setRows] = useState<Row[]>(p.commission_terms.length
    ? p.commission_terms.slice().sort((a, b) => a.months - b.months).map((t) => ({ months: String(t.months), pct: String(t.pct).replace(".", ",") }))
    : [{ months: "12", pct: "" }]);
  const [fMin, setFMin] = useState(p.forfeit_min != null ? new Intl.NumberFormat("vi-VN").format(p.forfeit_min) : "");
  const [fPct, setFPct] = useState(p.forfeit_pct != null ? String(p.forfeit_pct).replace(".", ",") : "");
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const num = (s: string) => Number(s.trim().replace(",", "."));

  async function save(e: FormEvent) {
    e.preventDefault(); setErr(null);
    const terms: { months: number; pct: number }[] = [];
    for (const r of rows) {
      if (!r.months.trim() && !r.pct.trim()) continue;
      const m = Number(r.months), pc = num(r.pct);
      if (!Number.isInteger(m) || m < 1 || m > 120 || !Number.isFinite(pc) || pc < 0 || pc > 100) { setErr("Mỗi dòng: số tháng nguyên (VD 12) và tỷ lệ từ 0 đến 100."); return; }
      terms.push({ months: m, pct: pc });
    }
    const fm = fMin.trim() ? parseMoney(fMin) : null;
    if (fMin.trim() && (fm == null || fm < 0)) { setErr("Mức cọc giữ lại chưa đúng."); return; }
    const fp = fPct.trim() ? num(fPct) : null;
    if (fp != null && (!Number.isFinite(fp) || fp < 0 || fp > 100)) { setErr("Hoa hồng bỏ cọc từ 0 đến 100%."); return; }
    setBusy(true);
    const { error } = await supabase.rpc("policy_commission_save", { p_building: p.building_id, p_terms: terms, p_forfeit_min: fm, p_forfeit_pct: fp });
    setBusy(false);
    if (error) { setErr(friendlyError(error)); return; }
    toast(`Đã cập nhật hoa hồng CTV toà ${p.code}.`);
    onSaved();
  }

  return (
    <Sheet open onClose={onClose} title={`Hoa hồng CTV · ${p.code}`}>
      <form className="stack" onSubmit={save}>
        <p className="muted small" style={{ margin: 0 }}>Hợp đồng thành công: tỷ lệ % tiền thuê tháng đầu theo kỳ hợp đồng. Nhân viên xem được, khách không thấy. Chỉ Lead Sale trở lên cập nhật.</p>
        {rows.map((t, i) => (
          <div key={i} className="pl-edit-row pl-edit-terms">
            <input className="input num" aria-label="Số tháng" inputMode="numeric" placeholder="12" value={t.months} onChange={(e) => setRows(rows.map((x, j) => j === i ? { ...x, months: e.target.value.replace(/\D/g, "") } : x))} />
            <span className="muted small">tháng →</span>
            <input className="input num" aria-label="Tỷ lệ %" inputMode="decimal" placeholder="80" value={t.pct} onChange={(e) => setRows(rows.map((x, j) => j === i ? { ...x, pct: e.target.value } : x))} />
            <span className="muted small">%</span>
            <button type="button" className="btn ghost sm" aria-label="Bỏ dòng" onClick={() => setRows(rows.filter((_, j) => j !== i))}>×</button>
          </div>
        ))}
        {rows.length < 10 ? <button type="button" className="btn secondary sm" style={{ alignSelf: "flex-start" }} onClick={() => setRows([...rows, { months: "", pct: "" }])}>+ Thêm kỳ hợp đồng</button> : null}
        <div className="row" style={{ alignItems: "flex-start" }}>
          <label className="field" style={{ flex: "1 1 170px" }}><span>Khách bỏ cọc: chỉ chi khi cọc giữ từ (đ)</span>
            <input className="input num" inputMode="decimal" placeholder="3.000.000" value={fMin} onChange={(e) => setFMin(e.target.value)} /></label>
          <label className="field" style={{ flex: "1 1 110px" }}><span>Hoa hồng bỏ cọc (%)</span>
            <input className="input num" inputMode="decimal" placeholder="30" value={fPct} onChange={(e) => setFPct(e.target.value)} /></label>
        </div>
        {err ? <div className="error-box" role="alert">{err}</div> : null}
        <button className="btn block" disabled={busy}>{busy ? "Đang lưu…" : "Lưu hoa hồng"}</button>
      </form>
    </Sheet>
  );
}
