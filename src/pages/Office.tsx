import { useCallback, useEffect, useMemo, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { friendlyError, supabase } from "../lib/supabase";
import { useSession } from "../lib/session";
import { timeAgo, todayVN } from "../lib/dates";
import { KINDS, fmtDays, kindLabel, statusLabel, summary, type Req, type ReqKind } from "../lib/office";
import { Empty, TopBar } from "../components/ui";
import "../office.css";

type Tab = "duyet" | "cua_toi" | "tat_ca";

export const KIND_ICON: Record<ReqKind, JSX.Element> = {
  nghi_phep: <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><rect x="3" y="5" width="18" height="16" rx="2" /><path d="M16 3v4M8 3v4M3 10h18M9 15l2 2 4-4" /></svg>,
  ra_ngoai: <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M12 21s-7-6.2-7-11.5A7 7 0 0 1 19 9.5C19 14.8 12 21 12 21Z" /><circle cx="12" cy="9.5" r="2.5" /></svg>,
  cong_tac: <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><rect x="3" y="7" width="18" height="13" rx="2" /><path d="M8 7V5a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2M3 13h18" /></svg>,
  thanh_toan: <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M6 3h12v18l-3-2-3 2-3-2-3 2V3Z" /><path d="M9 8h6M9 12h6M9 16h3" /></svg>,
  tam_ung: <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><rect x="2" y="6" width="20" height="12" rx="2" /><circle cx="12" cy="12" r="2.5" /><path d="M6 12h.01M18 12h.01" /></svg>,
};

export function ReqCard({ r, showWho }: { r: Req; showWho?: boolean }) {
  const { people } = useSession();
  const who = people.find((p) => p.id === r.requester_id)?.full_name;
  return (
    <Link to={`/van-phong/${r.id}`} className={`card rq-card k-${r.kind}`}>
      <span className="rq-ico" aria-hidden="true">{KIND_ICON[r.kind]}</span>
      <div className="rq-body">
        <div className="row rq-top">
          <span className="rq-title">{kindLabel(r)}</span>
          <span className={`rq-pill ${r.status}`}>{statusLabel(r)}</span>
        </div>
        <div className="rq-sum num">{summary(r)}</div>
        <div className="rq-meta">{showWho && who ? <b>{who}</b> : null}<span>{timeAgo(r.created_at)}</span>{r.reason ? <span className="rq-reason">{r.reason}</span> : null}</div>
      </div>
    </Link>
  );
}

/** Phép năm đã dùng trong năm (đã duyệt) và đang chờ duyệt */
export function useLeaveBalance(userId: string | undefined) {
  const [state, setState] = useState<{ used: number; pending: number } | null>(null);
  useEffect(() => {
    if (!userId) return;
    const y = todayVN().slice(0, 4);
    supabase.from("requests").select("days,status").eq("requester_id", userId).eq("kind", "nghi_phep").eq("sub_type", "phep_nam")
      .in("status", ["cho_duyet", "da_duyet", "hoan_tat"]).gte("start_date", `${y}-01-01`).lte("start_date", `${y}-12-31`)
      .then(({ data }) => {
        const rows = (data ?? []) as { days: number; status: string }[];
        setState({
          used: rows.filter((r) => r.status !== "cho_duyet").reduce((s, r) => s + Number(r.days), 0),
          pending: rows.filter((r) => r.status === "cho_duyet").reduce((s, r) => s + Number(r.days), 0),
        });
      });
  }, [userId]);
  return state;
}

export function LeaveBalance({ userId, quota, compact }: { userId: string; quota: number | null; compact?: boolean }) {
  const b = useLeaveBalance(userId);
  if (!b) return null;
  if (quota == null) {
    return (
      <section className={`card leave-card${compact ? " compact" : ""}`} aria-label="Phép năm">
        <div className="row" style={{ justifyContent: "space-between", alignItems: "baseline" }}>
          <span className="lc-label">Phép năm {todayVN().slice(0, 4)}</span>
          <span className="lc-none">Chưa có số ngày phép</span>
        </div>
        <div className="lc-sub num">Quản lý sẽ nhập số ngày phép năm. Đã nghỉ {fmtDays(b.used) || "0 ngày"}{b.pending ? ` · ${fmtDays(b.pending)} đang chờ duyệt` : ""}</div>
      </section>
    );
  }
  const left = quota - b.used;
  const pct = Math.min(100, (b.used / Math.max(quota, 0.5)) * 100);
  return (
    <section className={`card leave-card${compact ? " compact" : ""}`} aria-label="Phép năm">
      <div className="row" style={{ justifyContent: "space-between", alignItems: "baseline" }}>
        <span className="lc-label">Phép năm {todayVN().slice(0, 4)}</span>
        <span className={`lc-left num${left < 0 ? " over" : ""}`}>{left < 0 ? `Vượt ${fmtDays(-left)}` : `Còn ${fmtDays(left)}`}</span>
      </div>
      <div className="progress lc-bar" aria-hidden="true"><span style={{ width: `${pct}%` }} /></div>
      <div className="lc-sub num">Đã nghỉ {fmtDays(b.used) || "0 ngày"} / {fmtDays(quota)}{b.pending ? ` · ${fmtDays(b.pending)} đang chờ duyệt` : ""}</div>
    </section>
  );
}

export default function Office() {
  const { profile, isManager, isApprover, pendingApprovals } = useSession();
  const canApprove = isManager || isApprover;
  const [params, setParams] = useSearchParams();
  const tab = (params.get("tab") as Tab) || (canApprove ? "duyet" : "cua_toi");
  const kindFilter = params.get("loai") || "";
  const [rows, setRows] = useState<Req[]>([]);
  const [phases, setPhases] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);

  const setParam = (k: string, v: string) => {
    const p = new URLSearchParams(params);
    if (v) p.set(k, v); else p.delete(k);
    setParams(p, { replace: true });
  };

  const load = useCallback(async () => {
    if (!profile) return;
    setErr(null);
    let q = supabase.from("requests").select("*");
    if (tab === "duyet") {
      // Hàng đợi của tôi: đang đến lượt tôi duyệt, hoặc đã duyệt xong chờ tôi chi tiền
      const { data: queue, error: qe } = await supabase.rpc("my_approval_queue");
      if (qe) setErr(friendlyError(qe));
      const items = (queue ?? []) as { request_id: string; phase: string }[];
      setPhases(Object.fromEntries(items.map((i) => [i.request_id, i.phase])));
      if (!items.length) { setRows([]); setLoading(false); return; }
      q = q.in("id", items.map((i) => i.request_id));
    }
    if (tab === "cua_toi") q = q.eq("requester_id", profile.id);
    if (tab === "tat_ca" && kindFilter) q = q.eq("kind", kindFilter);
    const { data, error } = await q.order("created_at", { ascending: tab === "duyet" }).limit(300);
    if (error) setErr(friendlyError(error));
    setRows((data as Req[]) ?? []);
    setLoading(false);
  }, [profile, tab, kindFilter]);

  useEffect(() => { setLoading(true); load(); }, [load]);
  useEffect(() => {
    const h = () => load();
    window.addEventListener("neo:notification", h);
    window.addEventListener("focus", h);
    return () => { window.removeEventListener("neo:notification", h); window.removeEventListener("focus", h); };
  }, [load]);

  const toApprove = useMemo(() => rows.filter((r) => phases[r.id] === "duyet"), [rows, phases]);
  const toPay = useMemo(() => rows.filter((r) => phases[r.id] === "chi"), [rows, phases]);

  return (
    <>
      <TopBar title="Văn phòng" action={<Link className="tb-action" to="/to-chuc" style={{ color: "inherit" }}>Sơ đồ công ty</Link>} />
      <main className="main stack">
        {canApprove ? (
          <div className="tabs" role="tablist">
            {(([["duyet", "Cần xử lý"], ["cua_toi", "Của tôi"], ["tat_ca", "Tất cả"]] as [Tab, string][]).filter(([k]) => k !== "tat_ca" || isManager)).map(([k, l]) => (
              <button key={k} role="tab" aria-selected={tab === k} onClick={() => setParam("tab", k)}>
                {l}{k === "duyet" && pendingApprovals ? <span className="tab-n num">{pendingApprovals}</span> : null}
              </button>
            ))}
          </div>
        ) : null}

        {tab === "cua_toi" && profile ? (
          <>
            <LeaveBalance userId={profile.id} quota={profile.annual_leave_days == null ? null : Number(profile.annual_leave_days)} />
            <div className="section-title" style={{ marginTop: 6 }}>Tạo đề nghị</div>
            <div className="kind-grid">
              {KINDS.map((k) => (
                <Link key={k.kind} to={`/van-phong/moi/${k.kind}`} className={`kind-tile k-${k.kind}`}>
                  <span className="rq-ico">{KIND_ICON[k.kind]}</span>
                  <span className="kt-label">{k.label}</span>
                  <span className="kt-hint">{k.hint}</span>
                </Link>
              ))}
            </div>
            <div className="section-title">Đề nghị của tôi</div>
          </>
        ) : null}

        {tab === "tat_ca" ? (
          <div className="chips" role="group" aria-label="Lọc theo loại">
            <button className="chip" aria-pressed={!kindFilter} onClick={() => setParam("loai", "")}>Tất cả</button>
            {KINDS.map((k) => (
              <button key={k.kind} className="chip" aria-pressed={kindFilter === k.kind} onClick={() => setParam("loai", k.kind)}>
                {k.label.replace(/^(Xin |Đề nghị |Đi )/, "").replace(/^./, (c) => c.toUpperCase())}
              </button>
            ))}
          </div>
        ) : null}

        {err ? <div className="error-box">{err}</div> : null}
        {loading ? <div className="loading">Đang tải…</div> : tab === "duyet" ? (
          toApprove.length + toPay.length === 0 ? (
            <Empty title="Không có gì cần xử lý">Đề nghị đến lượt bạn duyệt hoặc chờ bạn chi tiền sẽ hiện ở đây kèm thông báo.</Empty>
          ) : (
            <>
              {toApprove.length ? <div className="section-title" style={{ marginTop: 4 }}>Chờ duyệt · {toApprove.length}</div> : null}
              <div className="stack">{toApprove.map((r) => <ReqCard key={r.id} r={r} showWho />)}</div>
              {toPay.length ? <div className="section-title">Đã duyệt, chờ chi tiền · {toPay.length}</div> : null}
              <div className="stack">{toPay.map((r) => <ReqCard key={r.id} r={r} showWho />)}</div>
            </>
          )
        ) : rows.length === 0 ? (
          <Empty title="Chưa có đề nghị nào">{tab === "cua_toi" ? "Chọn một loại ở trên để tạo đề nghị gửi quản lý duyệt." : null}</Empty>
        ) : (
          <div className="stack">{rows.map((r) => <ReqCard key={r.id} r={r} showWho={tab !== "cua_toi"} />)}</div>
        )}
      </main>
    </>
  );
}
