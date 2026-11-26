import { Link } from "react-router-dom";
import { useSession } from "../lib/session";
import { ddmmyyyy } from "../lib/dates";
import { taskLinkFrom, type AiAnswer, type AiChart } from "../lib/ai";
import "../ai.css";

const COLORS = ["var(--ai)", "var(--ai-2)", "var(--brand)", "var(--late)"];

export function Spark({ size = 16 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
      <path d="M12 2.5l1.9 5.6 5.6 1.9-5.6 1.9L12 17.5l-1.9-5.6L4.5 10l5.6-1.9L12 2.5z" />
      <path d="M19 15l.9 2.1 2.1.9-2.1.9L19 21l-.9-2.1L16 18l2.1-.9L19 15z" opacity=".7" />
    </svg>
  );
}

const fmtNum = (v: number) => (Math.abs(v) >= 100 ? Math.round(v).toLocaleString("vi-VN") : (Math.round(v * 10) / 10).toLocaleString("vi-VN"));

/** Biểu đồ cột / đường đơn giản bằng SVG, theo token màu nên đúng cả chế độ tối */
export function AiChartView({ chart }: { chart: AiChart }) {
  if (chart.type === "none" || !chart.labels.length || !chart.series.length) return null;
  const W = 560, H = 230, L = 48, R = 10, T = 14, B = 36;
  const all = chart.series.flatMap((s) => s.values);
  const max = Math.max(0, ...all), min = Math.min(0, ...all);
  const span = max - min || 1;
  const y = (v: number) => T + (H - T - B) * (1 - (v - min) / span);
  const n = chart.labels.length;
  const band = (W - L - R) / n;
  const ticks = [0, 0.5, 1].map((k) => min + span * k);
  const bars = chart.type === "bar";
  const bw = bars ? Math.min(28, (band * 0.7) / chart.series.length) : 0;
  const every = Math.ceil(n / 8);
  return (
    <figure className="ai-chart">
      {chart.title ? <figcaption>{chart.title}{chart.unit ? <small> ({chart.unit})</small> : null}</figcaption> : null}
      <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label={chart.title || "Biểu đồ"}>
        {ticks.map((v, i) => (
          <g key={i}>
            <line x1={L} x2={W - R} y1={y(v)} y2={y(v)} className="ai-grid" />
            <text x={L - 6} y={y(v) + 4} textAnchor="end" className="ai-tick">{fmtNum(v)}</text>
          </g>
        ))}
        {chart.labels.map((lb, i) => (i % every === 0 ? (
          <text key={lb + i} x={L + band * i + band / 2} y={H - 12} textAnchor="middle" className="ai-tick">{lb.length > 10 ? lb.slice(0, 9) + "…" : lb}</text>
        ) : null))}
        {chart.series.map((s, si) => bars ? (
          s.values.map((v, i) => {
            const x = L + band * i + band / 2 - (bw * chart.series.length) / 2 + bw * si;
            const top = Math.min(y(v), y(0)), h = Math.max(1, Math.abs(y(v) - y(0)));
            return <rect key={si + "-" + i} x={x} y={top} width={bw - 2} height={h} rx={3} fill={COLORS[si % 4]}><title>{`${chart.labels[i]}: ${fmtNum(v)} ${chart.unit}`}</title></rect>;
          })
        ) : (
          <g key={si}>
            <polyline fill="none" stroke={COLORS[si % 4]} strokeWidth={2.5} strokeLinejoin="round"
              points={s.values.map((v, i) => `${L + band * i + band / 2},${y(v)}`).join(" ")} />
            {s.values.map((v, i) => <circle key={i} cx={L + band * i + band / 2} cy={y(v)} r={3.5} fill={COLORS[si % 4]}><title>{`${chart.labels[i]}: ${fmtNum(v)} ${chart.unit}`}</title></circle>)}
          </g>
        ))}
      </svg>
      {chart.series.length > 1 || chart.series[0]?.name ? (
        <div className="ai-legend">
          {chart.series.map((s, i) => <span key={i}><i style={{ background: COLORS[i % 4] }} />{s.name}</span>)}
        </div>
      ) : null}
    </figure>
  );
}

/** Câu trả lời AI: kết luận, chỉ số, biểu đồ, nguyên nhân, giải pháp, dữ liệu đã dùng */
export function AiAnswerView({ a, onFollow, compact }: { a: AiAnswer; onFollow?: (q: string) => void; compact?: boolean }) {
  const { buildings } = useSession();
  return (
    <div className={`ai-ans${compact ? " compact" : ""}`}>
      <p className="ai-sum">{a.summary}</p>
      {a.kpis.length ? (
        <div className="ai-kpis">
          {a.kpis.map((k, i) => (
            <div key={i} className={`ai-kpi ${k.tone}`}>
              <small>{k.label}</small><b className="num">{k.value}</b>{k.note ? <span>{k.note}</span> : null}
            </div>
          ))}
        </div>
      ) : null}
      <AiChartView chart={a.chart} />
      {a.causes.length ? (
        <section className="ai-sec">
          <h4>Nguyên nhân</h4>
          <ol>{a.causes.map((c, i) => <li key={i}>{c}</li>)}</ol>
        </section>
      ) : null}
      {a.solutions.length ? (
        <section className="ai-sec">
          <h4>Giải pháp đề xuất</h4>
          <ol className="ai-sol">
            {a.solutions.map((s, i) => (
              <li key={i}>
                <span>{s.text}</span>
                {s.task_title ? <Link className="ai-mk" to={taskLinkFrom(s, buildings)} title="Mở màn hình Giao việc đã điền sẵn để anh xem lại rồi lưu">+ Tạo việc</Link> : null}
              </li>
            ))}
          </ol>
        </section>
      ) : null}
      <div className="ai-src">
        Dữ liệu đã dùng: {a.sources.length ? a.sources.join(" · ") : "không có"} · số liệu đến {ddmmyyyy(a.as_of)}
      </div>
      {onFollow && a.followups.length ? (
        <div className="ai-chips">
          {a.followups.map((q) => <button key={q} type="button" onClick={() => onFollow(q)}>{q}</button>)}
        </div>
      ) : null}
    </div>
  );
}
