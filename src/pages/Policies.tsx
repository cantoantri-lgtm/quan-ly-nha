import { FormEvent, useCallback, useEffect, useMemo, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { friendlyError, supabase } from "../lib/supabase";
import { useSession } from "../lib/session";
import { ddmmyyyy } from "../lib/dates";
import { naturalCompare, parseMoney, vnd } from "../lib/money";
import { Empty, Sheet, TopBar } from "../components/ui";
import "../policy.css";

export type Fee = { label: string; amount: number; unit: string };
export type Term = { months: number; pct: number };
type Policy = {
  building_id: string; code: string; name: string; address: string | null;
  fees: Fee[]; amenities: string[]; furniture: string[]; deposit_lines: string[]; commission_terms: Term[];
  forfeit_min: number | null; forfeit_pct: number | null; note: string | null; updated_at: string | null;
};

const hasData = (p: Policy) => p.fees.length > 0 || p.amenities.length > 0 || p.furniture.length > 0 || p.deposit_lines.length > 0 || p.commission_terms.length > 0 || p.forfeit_pct != null;
const pctText = (n: number) => String(n).replace(".", ",");

/** Dịch vụ và chính sách theo từng toà. Mọi vai trò (kể cả Cộng tác viên) xem; chỉ Quản lý sửa (RLS ở CSDL). */
export default function Policies() {
  const { isManager } = useSession();
  const [sp, setSp] = useSearchParams();
  const [rows, setRows] = useState<Policy[] | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [editing, setEditing] = useState(false);
  const [guest, setGuest] = useState(false);   // chế độ khách xem: ẩn ký hợp đồng và hoa hồng
  const { toast } = useSession();

  const load = useCallback(async () => {
    const { data, error } = await supabase.rpc("building_policies");
    if (error) { setErr("Không tải được chính sách. Thử lại sau."); return; }
    setErr(null);
    setRows(((data as Policy[]) ?? []).slice().sort((a, b) => naturalCompare(a.code, b.code)));
  }, []);
  useEffect(() => { load(); }, [load]);

  const wanted = sp.get("toa");
  const current = useMemo(() => {
    if (!rows?.length) return null;
    return rows.find((r) => r.building_id === wanted) ?? rows.find(hasData) ?? rows[0];
  }, [rows, wanted]);

  return (
    <>
      <TopBar title="Chính sách toà" back
        action={isManager && current ? <button className="tb-action" onClick={() => setEditing(true)}>Sửa</button> : null} />
      <main className="main stack">
        {err ? <div className="error-box" role="alert">{err}</div> : null}
        {!rows && !err ? <div className="loading">Đang tải…</div> : null}
        {rows && rows.length > 1 ? (
          <div className="pl-chips" role="group" aria-label="Chọn toà">
            {rows.map((r) => (
              <button key={r.building_id} type="button" className={`chip${current?.building_id === r.building_id ? " on" : ""}`}
                aria-pressed={current?.building_id === r.building_id} onClick={() => setSp({ toa: r.building_id })}>{r.code}</button>
            ))}
          </div>
        ) : null}
        {rows && !rows.length ? <Empty title="Chưa có toà nào" /> : null}
        {current && hasData(current) ? (
          <label className="pl-guest">
            <input type="checkbox" checked={guest} onChange={(e) => setGuest(e.target.checked)} />
            <span><b>Chế độ khách xem</b><small className="muted"> Ẩn phần ký hợp đồng và hoa hồng, dùng khi đưa màn hình cho khách.</small></span>
          </label>
        ) : null}
        {current ? <PolicyView p={current} isManager={isManager} guest={guest} onEdit={() => setEditing(true)} /> : null}
      </main>
      {editing && current ? (
        <PolicySheet p={current} onClose={() => setEditing(false)} onSaved={() => { setEditing(false); toast("Đã lưu chính sách toà."); load(); }} />
      ) : null}
    </>
  );
}

function PolicyView({ p, isManager, guest, onEdit }: { p: Policy; isManager: boolean; guest: boolean; onEdit: () => void }) {
  if (!hasData(p)) {
    return (
      <Empty title={`${p.code} chưa có chính sách`}>
        {isManager ? <button className="btn" onClick={onEdit}>Nhập chính sách cho toà này</button> : "Quản lý sẽ cập nhật dịch vụ và chính sách cho toà này."}
      </Empty>
    );
  }
  return (
    <div className="stack pl">
      <section className="card pl-head">
        <h2>{p.name}</h2>
        <p className="muted small">{p.code}{p.address ? ` · ${p.address}` : ""}</p>
      </section>

      {p.fees.length ? (
        <section className="card pl-sec">
          <h3>Phí dịch vụ</h3>
          <dl className="pl-fees">
            {p.fees.map((f, i) => (
              <div key={i}><dt>{f.label}</dt><dd className="num">{vnd(f.amount)}{f.unit ? `/${f.unit}` : ""}</dd></div>
            ))}
          </dl>
        </section>
      ) : null}

      {p.amenities.length ? (
        <section className="card pl-sec">
          <h3>Tiện ích</h3>
          <ul className="pl-chips-list">{p.amenities.map((a, i) => <li key={i}>{a}</li>)}</ul>
        </section>
      ) : null}

      {p.furniture.length ? (
        <section className="card pl-sec">
          <h3>Danh mục nội thất</h3>
          <ul className="pl-chips-list">{p.furniture.map((a, i) => <li key={i}>{a}</li>)}</ul>
        </section>
      ) : null}

      {guest ? null : p.deposit_lines.length ? (
        <section className="card pl-sec">
          <h3>Ký hợp đồng <span className="pl-tag">Chỉ Sale và CTV</span></h3>
          <ul className="pl-lines">{p.deposit_lines.map((a, i) => <li key={i}>{a}</li>)}</ul>
        </section>
      ) : null}

      {guest ? null : p.commission_terms.length || p.forfeit_pct != null ? (
        <section className="card pl-sec pl-comm">
          <h3>Hoa hồng Cộng tác viên <span className="pl-tag">Chỉ Sale và CTV</span></h3>
          {p.commission_terms.length ? (
            <>
              <p className="muted small" style={{ margin: 0 }}>Hợp đồng thành công, tính trên tiền thuê tháng đầu:</p>
              <div className="pl-terms">
                {p.commission_terms.slice().sort((a, b) => a.months - b.months).map((t, i) => (
                  <div key={i} className="pl-term"><span className="muted small">Hợp đồng {t.months} tháng</span><b className="num">{pctText(t.pct)}%</b></div>
                ))}
              </div>
            </>
          ) : null}
          {p.forfeit_pct != null ? (
            <div className="pl-forfeit">
              <b>Khách bỏ cọc</b>
              <p className="small" style={{ margin: 0 }}>
                {p.forfeit_min != null && p.forfeit_min > 0
                  ? <>Tiền cọc công ty giữ lại dưới <b className="num">{vnd(p.forfeit_min)}</b>: <b>không chi</b> hoa hồng. Từ <b className="num">{vnd(p.forfeit_min)}</b> trở lên: hoa hồng <b className="num">{pctText(p.forfeit_pct)}%</b> số tiền cọc đó.</>
                  : <>Hoa hồng <b className="num">{pctText(p.forfeit_pct)}%</b> số tiền cọc công ty giữ lại.</>}
              </p>
            </div>
          ) : null}
        </section>
      ) : null}

      {!guest && p.note ? <section className="card pl-sec"><h3>Ghi chú</h3><p className="small" style={{ margin: 0, whiteSpace: "pre-line" }}>{p.note}</p></section> : null}
      {p.updated_at ? <p className="muted small" style={{ margin: 0 }}>Cập nhật {ddmmyyyy(p.updated_at)}.{guest ? "" : " Mức hoa hồng cuối cùng do Quản lý xác nhận."}</p> : null}
    </div>
  );
}

type FeeRow = { label: string; amount: string; unit: string };
type TermRow = { months: string; pct: string };
const lines = (s: string) => s.split("\n").map((x) => x.trim()).filter(Boolean);

function PolicySheet({ p, onClose, onSaved }: { p: Policy; onClose: () => void; onSaved: () => void }) {
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
