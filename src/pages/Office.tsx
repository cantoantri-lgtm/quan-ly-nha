import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { supabase } from "../lib/supabase";
import { useSession } from "../lib/session";
import { timeAgo, todayVN } from "../lib/dates";
import { KINDS, fmtDays, kindLabel, statusLabel, summary, type Req, type ReqKind } from "../lib/office";
import { Icon } from "../components/ui";
import "../office.css";
import "../table.css";

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

/** Văn phòng số: trang các chức năng phụ. Mỗi ô mở danh sách của loại đề nghị đó. */
export default function Office() {
  const { profile, isManager, isApprover } = useSession();
  const [waiting, setWaiting] = useState<Partial<Record<ReqKind, number>>>({});
  const [fix, setFix] = useState<Partial<Record<ReqKind, number>>>({});

  useEffect(() => {
    if (!profile) return;
    (async () => {
      const { data: q } = await supabase.rpc("my_approval_queue");
      const ids = ((q ?? []) as { request_id: string }[]).map((x) => x.request_id);
      const w: Partial<Record<ReqKind, number>> = {};
      if (ids.length) {
        const { data } = await supabase.from("requests").select("kind").in("id", ids);
        ((data ?? []) as { kind: ReqKind }[]).forEach((r) => { w[r.kind] = (w[r.kind] ?? 0) + 1; });
      }
      setWaiting(w);
      const { data: f } = await supabase.from("requests").select("kind").eq("requester_id", profile.id).in("status", ["tra_lai", "tu_choi"]);
      const fx: Partial<Record<ReqKind, number>> = {};
      ((f ?? []) as { kind: ReqKind }[]).forEach((r) => { fx[r.kind] = (fx[r.kind] ?? 0) + 1; });
      setFix(fx);
    })();
  }, [profile]);

  return (
    <main className="main stack">
      <section className="pg-card">
        <div className="pg-head">
          <span className="pg-ico">{Icon.office}</span>
          <div className="grow"><h2>Văn phòng số</h2><p>Chọn nghiệp vụ để xem danh sách và lập đề nghị</p></div>
        </div>
        <div className="kind-grid" style={{ padding: 16 }}>
          {KINDS.map((k) => (
            <Link key={k.kind} to={`/van-phong/ds/${k.kind}`} className={`kind-tile k-${k.kind}`}>
              <span className="rq-ico">{KIND_ICON[k.kind]}</span>
              <span className="kt-label">{k.label}</span>
              <span className="kt-hint">
                {waiting[k.kind] ? <b style={{ color: "var(--danger)" }}>{waiting[k.kind]} chờ bạn duyệt · </b> : null}
                {fix[k.kind] ? <b style={{ color: "var(--today)" }}>{fix[k.kind]} cần sửa · </b> : null}
                {k.hint}
              </span>
            </Link>
          ))}
          {isManager || isApprover ? (
            <Link to="/to-chuc" className="kind-tile k-thanh_toan">
              <span className="rq-ico">{Icon.org}</span>
              <span className="kt-label">Sơ đồ công ty</span>
              <span className="kt-hint">Cơ cấu tổ chức, người duyệt</span>
            </Link>
          ) : null}
        </div>
      </section>
      {profile ? <LeaveBalance userId={profile.id} quota={profile.annual_leave_days == null ? null : Number(profile.annual_leave_days)} /> : null}
    </main>
  );
}
