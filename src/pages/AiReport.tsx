import { useEffect, useState } from "react";
import { supabase } from "../lib/supabase";
import { useSession } from "../lib/session";
import { ddmm, ddmmyyyy } from "../lib/dates";
import { vndShort } from "../lib/money";
import { weeklyAi, type AiAnswer } from "../lib/ai";
import { TopBar } from "../components/ui";
import { AiAnswerView, Spark } from "../components/AiAnswer";
import { AiChat } from "../components/AiChat";
import "../ai.css";

type Period = "ngay" | "tuan" | "thang" | "quy";
const PERIODS: [Period, string][] = [["ngay", "Hôm nay"], ["tuan", "Tuần này"], ["thang", "Tháng này"], ["quy", "Quý này"]];
const PREV: Record<Period, string> = { ngay: "hôm qua", tuan: "tuần trước", thang: "tháng trước", quy: "quý trước" };

type Kpis = {
  as_of: string; from: string; to: string;
  revenue: { collected: number; collected_prev: number; invoiced: number };
  occupancy: { rooms: number; occupied: number; vacant: number; expiring_30d: number; new_contracts: number };
  debt: { amount: number; invoices: number; over_15_days: number };
  costs: { amount: number; amount_prev: number; pending: number };
  projects: { running: number; late: number };
  tasks: { open: number; overdue: number; done: number };
};

function change(now: number, prev: number, label: string, upGood = true) {
  if (!prev && !now) return { text: `Chưa có số liệu ${label}`, tone: "neutral" };
  if (!prev) return { text: `${label}: 0 đ`, tone: "neutral" };
  const pct = Math.round(((now - prev) / prev) * 1000) / 10;
  const sign = pct > 0 ? "+" : pct < 0 ? "−" : "±";
  return { text: `${sign}${Math.abs(pct).toLocaleString("vi-VN")}% so với ${label}`, tone: pct === 0 ? "neutral" : (pct > 0) === upGood ? "good" : "bad" };
}

export default function AiReport() {
  const { toast } = useSession();
  const [period, setPeriod] = useState<Period>("thang");
  const [k, setK] = useState<Kpis | null>(null);
  const [kErr, setKErr] = useState<string | null>(null);
  const [week, setWeek] = useState<{ week_start: string; created_at: string; answer: AiAnswer } | null>(null);
  const [wBusy, setWBusy] = useState(false);
  const [wErr, setWErr] = useState<string | null>(null);
  const [ask, setAsk] = useState<string | null>(null);

  useEffect(() => {
    setK(null); setKErr(null);
    supabase.rpc("ai_kpis", { p_period: period }).then(({ data, error }) => {
      if (error) setKErr("Không tải được số liệu. " + error.message); else setK(data as Kpis);
    });
  }, [period]);

  async function loadWeek(force = false) {
    setWBusy(true); setWErr(null);
    try { setWeek(await weeklyAi(force)); if (force) toast("Đã lập lại nhận định tuần"); }
    catch (e) { setWErr((e as Error).message); }
    finally { setWBusy(false); }
  }
  useEffect(() => { void loadWeek(); }, []);   // eslint-disable-line react-hooks/exhaustive-deps

  function exportPdf() {
    document.body.classList.add("ai-printing");
    const done = () => { document.body.classList.remove("ai-printing"); window.removeEventListener("afterprint", done); };
    window.addEventListener("afterprint", done);
    window.print();
  }

  const occPct = k && k.occupancy.rooms ? Math.round((1000 * k.occupancy.occupied) / k.occupancy.rooms) / 10 : 0;
  const rev = k ? change(k.revenue.collected, k.revenue.collected_prev, PREV[period]) : null;
  const cost = k ? change(k.costs.amount, k.costs.amount_prev, PREV[period], false) : null;

  return (
    <div className="ai-page">
      <TopBar title="Báo cáo AI" back="/" />
      <main className="main ai-wrap">
        <div className="ai-bar">
          <div className="ai-period" role="group" aria-label="Kỳ báo cáo">
            {PERIODS.map(([p, l]) => <button key={p} type="button" aria-pressed={period === p} onClick={() => setPeriod(p)}>{l}</button>)}
          </div>
          {k ? <small className="muted">Từ {ddmm(k.from)} đến {ddmmyyyy(k.to)}</small> : null}
        </div>

        {kErr ? <div className="error-box" role="alert">{kErr}</div> : null}
        <div className="ai-cards">
          <article className="ai-card">
            <small>Doanh thu đã thu</small>
            <b className="num">{k ? vndShort(k.revenue.collected) : "…"}</b>
            {rev ? <span className={rev.tone}>{rev.text}</span> : null}
            {k ? <em>Hoá đơn lập trong kỳ: {vndShort(k.revenue.invoiced)}</em> : null}
          </article>
          <article className="ai-card">
            <small>Lấp đầy hiện tại</small>
            <b className="num">{k ? `${occPct.toLocaleString("vi-VN")}%` : "…"}</b>
            {k ? <span className={occPct >= 85 ? "good" : occPct < 70 ? "bad" : "neutral"}>{k.occupancy.occupied}/{k.occupancy.rooms} phòng · {k.occupancy.vacant} trống</span> : null}
            {k ? <em>{k.occupancy.expiring_30d} HĐ hết hạn trong 30 ngày · {k.occupancy.new_contracts} HĐ mới trong kỳ</em> : null}
          </article>
          <article className="ai-card">
            <small>Công nợ quá hạn</small>
            <b className="num">{k ? vndShort(k.debt.amount) : "…"}</b>
            {k ? <span className={k.debt.amount > 0 ? "bad" : "good"}>{k.debt.invoices ? `${k.debt.invoices} hoá đơn` : "Không có hoá đơn quá hạn"}</span> : null}
            {k && k.debt.over_15_days > 0 ? <em>Quá 15 ngày: {vndShort(k.debt.over_15_days)}</em> : null}
          </article>
          <article className="ai-card">
            <small>Chi phí đã duyệt</small>
            <b className="num">{k ? vndShort(k.costs.amount) : "…"}</b>
            {cost ? <span className={cost.tone}>{cost.text}</span> : null}
            {k ? <em>{k.projects.running} dự án đang chạy{k.projects.late ? `, ${k.projects.late} chậm` : ""} · {k.tasks.overdue} việc trễ hạn</em> : null}
          </article>
        </div>

        <section className="ai-week">
          <header>
            <span className="ai-av"><Spark size={17} /></span>
            <div><b>Nhận định tuần</b><small>{week ? `Tuần từ ${ddmm(week.week_start)} · lập lúc ${new Date(week.created_at).toLocaleString("vi-VN", { timeZone: "Asia/Ho_Chi_Minh", hour: "2-digit", minute: "2-digit", day: "2-digit", month: "2-digit" })}` : "AI đọc toàn bộ số liệu và chọn 3 điểm cần chú ý"}</small></div>
            <span className="grow" />
            <span className="ai-wact">
              <button type="button" className="btn ghost sm" disabled={wBusy} onClick={() => loadWeek(true)}>{wBusy ? "Đang lập…" : "Lập lại"}</button>
              <button type="button" className="btn ghost sm" disabled={!week} onClick={exportPdf}>Xuất PDF</button>
            </span>
          </header>
          {wErr ? <div className="error-box" role="alert">{wErr}</div> : null}
          {wBusy && !week ? <div className="ai-wait" role="status"><i /><i /><i /> Đang đọc số liệu và lập nhận định, khoảng 10–20 giây…</div> : null}
          {week ? <AiAnswerView a={week.answer} onFollow={(q) => { setAsk(q); document.getElementById("ai-hoi-tiep")?.scrollIntoView({ behavior: "smooth" }); }} /> : null}
        </section>

        <section className="ai-follow" id="ai-hoi-tiep">
          <h3>Hỏi tiếp</h3>
          <AiChat context={{}} ask={ask} onAsked={() => setAsk(null)} />
        </section>
      </main>
    </div>
  );
}
