import { daysBetween, ddmmyyyy, termEndISO, termMonths, todayVN } from "../lib/dates";

const TERMS = [3, 6, 12, 24];

/** Ngày hiệu lực hợp đồng: bắt đầu, kết thúc, nút chọn nhanh thời hạn. Dùng ở lập hợp đồng, sửa hợp đồng, cho thuê phòng. */
export function ContractTerm({ start, end, onStart, onEnd, idPrefix = "c" }: {
  start: string; end: string; onStart: (v: string) => void; onEnd: (v: string) => void; idPrefix?: string;
}) {
  const months = start && end ? termMonths(start, end) : null;
  const left = end ? daysBetween(todayVN(), end) : null;
  function pickStart(v: string) {
    // Đổi ngày bắt đầu thì giữ nguyên thời hạn đã chọn
    const n = start && end ? termMonths(start, end) : null;
    onStart(v);
    if (n && v) onEnd(termEndISO(v, n));
  }
  return (
    <div className="stack" style={{ gap: 6 }}>
      <div className="row" style={{ alignItems: "flex-start" }}>
        <label className="field" style={{ flex: "1 1 140px" }}><span>Hiệu lực từ ngày *</span>
          <input id={`${idPrefix}-start`} className="input" type="date" value={start} onChange={(e) => pickStart(e.target.value)} required /></label>
        <label className="field" style={{ flex: "1 1 120px" }}><span>Thời hạn</span>
          <select id={`${idPrefix}-term`} className="input" value={months && TERMS.includes(months) ? String(months) : ""} disabled={!start}
            onChange={(e) => e.target.value && onEnd(termEndISO(start, Number(e.target.value)))}>
            <option value="">{end ? (months ? `${months} tháng` : "Tự chọn ngày") : "— Chọn —"}</option>
            {TERMS.map((n) => <option key={n} value={n}>{n} tháng</option>)}
          </select></label>
        <label className="field" style={{ flex: "1 1 140px" }}><span>Đến ngày *</span>
          <input id={`${idPrefix}-end`} className="input" type="date" value={end} min={start || undefined} onChange={(e) => onEnd(e.target.value)} required /></label>
      </div>
      {start && end ? (
        end < start ? <small style={{ color: "var(--danger)" }}>Ngày kết thúc phải sau ngày bắt đầu.</small>
          : <small className="muted">Hợp đồng {months ? `${months} tháng` : `${daysBetween(start, end) + 1} ngày`}, từ {ddmmyyyy(start)} đến hết {ddmmyyyy(end)}
            {left != null && left >= 0 && left <= 30 ? <b style={{ color: "var(--today)" }}> · còn {left} ngày</b> : null}
            {left != null && left < 0 ? <b style={{ color: "var(--late)" }}> · đã quá hạn {-left} ngày</b> : null}</small>
      ) : null}
    </div>
  );
}
