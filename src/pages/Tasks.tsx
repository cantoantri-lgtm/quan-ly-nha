import { useCallback, useEffect, useMemo, useState } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { friendlyError, supabase } from "../lib/supabase";
import { useSession } from "../lib/session";
import { PRIORITY_LABEL, STATUS_LABEL, type Task } from "../lib/labels";
import { daysBetween, dueInfo, todayVN } from "../lib/dates";
import { Empty, Icon, TopBar } from "../components/ui";

type Row = Task & { assignee: { full_name: string } | null; creator: { full_name: string } | null; building: { code: string } | null };
type Tab = "mine" | "given" | "all";
type Filter = "open" | "late" | "block" | "done";

const SELECT = "*, assignee:profiles!tasks_assignee_id_fkey(full_name), creator:profiles!tasks_created_by_fkey(full_name), building:buildings(code)";

export default function Tasks() {
  const { profile, isManager, isSupervisor, buildings } = useSession();
  const canAssign = isManager || isSupervisor;
  const [params, setParams] = useSearchParams();
  const tab = (params.get("tab") as Tab) || "mine";
  const filter = (params.get("loc") as Filter) || "open";
  const bFilter = params.get("toa") || "";
  const [rows, setRows] = useState<Row[]>([]);
  const [steps, setSteps] = useState<Record<string, { total: number; done: number }>>({});
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);
  const nav = useNavigate();

  const setParam = (k: string, v: string) => {
    const p = new URLSearchParams(params);
    if (v) p.set(k, v); else p.delete(k);
    setParams(p, { replace: true });
  };

  const load = useCallback(async () => {
    if (!profile) return;
    setErr(null);
    const base = () => {
      let q = supabase.from("tasks").select(SELECT).is("parent_id", null);
      if (tab === "mine") q = q.eq("assignee_id", profile.id);
      if (tab === "given") q = q.eq("created_by", profile.id).neq("assignee_id", profile.id);
      if (bFilter) q = q.eq("building_id", bFilter);
      return q;
    };
    const [open, done] = await Promise.all([
      base().neq("status", "xong").order("due_date", { ascending: true, nullsFirst: false }).order("created_at", { ascending: false }).limit(500),
      base().eq("status", "xong").order("completed_at", { ascending: false }).limit(50),
    ]);
    if (open.error || done.error) { setErr(friendlyError(open.error ?? done.error)); setLoading(false); return; }
    const all = [...(open.data as Row[]), ...(done.data as Row[])];
    setRows(all);
    const ids = all.map((r) => r.id);
    if (ids.length) {
      const { data } = await supabase.from("tasks").select("parent_id,status").in("parent_id", ids);
      const m: Record<string, { total: number; done: number }> = {};
      (data ?? []).forEach((s: { parent_id: string; status: string }) => {
        m[s.parent_id] ??= { total: 0, done: 0 };
        m[s.parent_id].total++;
        if (s.status === "xong") m[s.parent_id].done++;
      });
      setSteps(m);
    } else setSteps({});
    setLoading(false);
  }, [profile, tab, bFilter]);

  useEffect(() => { setLoading(true); load(); }, [load]);
  useEffect(() => {
    const h = () => load();
    window.addEventListener("neo:notification", h);
    window.addEventListener("focus", h);
    return () => { window.removeEventListener("neo:notification", h); window.removeEventListener("focus", h); };
  }, [load]);

  const today = todayVN();
  const isLate = (r: Row) => r.status !== "xong" && !!r.due_date && r.due_date < today;
  const counts = useMemo(() => ({
    open: rows.filter((r) => r.status !== "xong").length,
    late: rows.filter(isLate).length,
    block: rows.filter((r) => r.status === "vuong").length,
    done: rows.filter((r) => r.status === "xong").length,
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }), [rows, today]);

  const shown = rows.filter((r) =>
    filter === "open" ? r.status !== "xong" : filter === "late" ? isLate(r) : filter === "block" ? r.status === "vuong" : r.status === "xong");

  return (
    <>
      <TopBar title="Công việc" />
      <main className="main stack">
        {canAssign ? (
          <div className="tabs" role="tablist">
            {([["mine", "Việc của tôi"], ["given", "Tôi đã giao"], ["all", "Tất cả"]] as [Tab, string][]).map(([k, l]) => (
              <button key={k} role="tab" aria-selected={tab === k} onClick={() => setParam("tab", k === "mine" ? "" : k)}>{l}</button>
            ))}
          </div>
        ) : null}

        <div className="chips" role="group" aria-label="Lọc theo trạng thái">
          {([["open", "Đang mở"], ["late", "Trễ hạn"], ["block", "Vướng"], ["done", "Đã xong"]] as [Filter, string][]).map(([k, l]) => (
            <button key={k} className="chip" aria-pressed={filter === k} onClick={() => setParam("loc", k === "open" ? "" : k)}>
              {l}<span className="n">{counts[k]}</span>
            </button>
          ))}
        </div>

        {canAssign && buildings.length > 1 ? (
          <select id="filter-building" className="input" value={bFilter} onChange={(e) => setParam("toa", e.target.value)} aria-label="Lọc theo toà">
            <option value="">Tất cả toà</option>
            {buildings.map((b) => <option key={b.id} value={b.id}>{b.code} · {b.name}</option>)}
          </select>
        ) : null}

        {err ? <div className="error-box">{err}</div> : null}
        {loading ? <div className="loading">Đang tải…</div> : shown.length === 0 ? (
          <Empty title={filter === "open" ? "Không còn việc nào đang mở" : "Không có việc nào"}>
            {tab === "mine" && filter === "open" ? "Việc được giao sẽ hiện ở đây kèm thông báo." : null}
          </Empty>
        ) : (
          <div className="stack">
            {shown.map((r) => {
              const d = dueInfo(r.due_date, r.status === "xong");
              const s = steps[r.id];
              return (
                <Link key={r.id} to={`/viec/${r.id}`} className={`card task-card${r.status === "xong" ? " done" : ""}${isLate(r) ? " late" : ""}`}>
                  <div className="row" style={{ alignItems: "flex-start", flexWrap: "nowrap" }}>
                    <div className="t" style={{ flex: 1, minWidth: 0 }}>{r.title}</div>
                    <span className={`pill ${r.status}`}>{STATUS_LABEL[r.status]}</span>
                  </div>
                  <div className="meta">
                    {r.building ? <span className="tag">{r.building.code}</span> : null}
                    {tab !== "mine" && r.assignee ? <span>→ {r.assignee.full_name}</span> : null}
                    {tab === "mine" && r.creator && r.created_by !== profile?.id ? <span>Giao bởi {r.creator.full_name}</span> : null}
                    {d ? <span className={`due ${d.tone}`}>{d.text}</span> : null}
                    {r.priority === "cao" || r.priority === "gap" ? <span className="prio">{PRIORITY_LABEL[r.priority]}</span> : null}
                    {s ? <span className="num">{s.done}/{s.total} bước</span> : null}
                  </div>
                  {s && s.total > 0 ? <div className="progress" aria-hidden="true"><span style={{ width: `${(s.done / s.total) * 100}%` }} /></div> : null}
                </Link>
              );
            })}
            {filter === "late" && shown.length ? (
              <p className="muted small" style={{ textAlign: "center" }}>
                Trễ lâu nhất: {Math.max(...shown.map((r) => daysBetween(r.due_date!, today)))} ngày
              </p>
            ) : null}
          </div>
        )}
      </main>
      {canAssign ? <div className="fab-group">
        <button className="fab mic-fab" onClick={() => nav("/viec/giong-noi")} aria-label="Giao việc bằng giọng nói" title="Giao việc bằng giọng nói">
          <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" aria-hidden="true">
            <rect x="9" y="3" width="6" height="11" rx="3" /><path d="M5 11a7 7 0 0 0 14 0M12 18v3" />
          </svg>
        </button>
        <button className="fab" onClick={() => nav("/viec/moi")}>{Icon.plus}Giao việc</button>
      </div> : null}
    </>
  );
}
