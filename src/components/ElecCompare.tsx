import { useEffect, useState } from "react";
import { friendlyError, supabase } from "../lib/supabase";

type Row = {
  period: string; building_reading: number | null; building_prev: number | null; building_kwh: number | null;
  rooms_kwh: number; rooms_recorded: number; rooms_to_record: number; rooms_missing: number;
  diff_kwh: number | null; diff_pct: number | null; complete: boolean;
};
const num = (n: number | null | undefined) => (n == null ? "—" : new Intl.NumberFormat("vi-VN", { maximumFractionDigits: 1 }).format(Number(n)));
const label = (p: string) => `T${Number(p.slice(5, 7))}/${p.slice(2, 4)}`;
/** Chênh lệch từ mức này trở lên thì báo đỏ */
const HIGH_PCT = 15;

/** So sánh điện đồng hồ tổng toà với tổng điện các phòng theo kỳ ghi điện */
export default function ElecCompare({ buildingId, refresh }: { buildingId: string; refresh?: number }) {
  const [rows, setRows] = useState<Row[] | null>(null);
  const [err, setErr] = useState<string | null>(null);
  useEffect(() => {
    setRows(null);
    supabase.rpc("elec_compare", { p_building: buildingId, p_months: 6 }).then(({ data, error }) => {
      if (error) { setErr(friendlyError(error)); setRows([]); return; }
      setRows((data as Row[]) ?? []);
    });
  }, [buildingId, refresh]);

  const status = (r: Row) => {
    if (r.building_kwh == null) return r.building_reading == null ? "Chưa ghi đồng hồ tổng" : "Cần số đồng hồ tổng kỳ trước";
    if (r.rooms_missing > 0) return `Còn ${r.rooms_missing} phòng chưa ghi`;
    return "";
  };

  return (
    <section className="card stack" style={{ padding: 14 }} aria-label="So sánh điện toà và các phòng">
      <b>So sánh điện toà và các phòng</b>
      <p className="muted small" style={{ margin: 0 }}>
        Chênh lệch = điện đồng hồ tổng toà − tổng điện các phòng đã ghi. Phần chênh là điện khu chung, phòng trống, hao hụt.
        Trên {HIGH_PCT}% thì nên kiểm tra đồng hồ, điện khu chung hoặc câu trộm.
      </p>
      {err ? <div className="error-box" role="alert">{err}</div> : null}
      {rows === null ? <div className="loading">Đang tải…</div> : (
        <div className="ec-grid" role="table">
          <div className="ec-row ec-head" role="row"><span>Kỳ</span><span>Toà kWh</span><span>Các phòng kWh</span><span>Chênh lệch</span></div>
          {rows.map((r) => {
            const high = r.diff_pct != null && r.diff_pct >= HIGH_PCT;
            const st = status(r);
            return (
              <div key={r.period} className="ec-row" role="row">
                <b>{label(r.period)}</b>
                <span className="num">{num(r.building_kwh)}</span>
                <span className="num">{num(r.rooms_kwh)}<small className="muted">{r.rooms_recorded}/{r.rooms_to_record} phòng</small></span>
                <span className="num" style={{ color: high ? "var(--danger)" : undefined, fontWeight: high ? 700 : undefined }}>
                  {r.diff_kwh != null ? <>{num(r.diff_kwh)}{r.diff_pct != null ? <small>{num(r.diff_pct)}%</small> : null}</> : "—"}
                  {st ? <small className="muted" style={{ fontWeight: 400 }}>{st}</small> : null}
                </span>
              </div>
            );
          })}
        </div>
      )}
    </section>
  );
}
