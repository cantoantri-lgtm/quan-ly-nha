import { useEffect, useState } from "react";
import { supabase } from "../lib/supabase";
import { clock } from "../lib/dates";
import { DUTY_LABEL, type ReqKind, type ReqStep } from "../lib/office";
import type { Profile } from "../lib/labels";

const STATE: Record<ReqStep["status"], string> = { cho: "Chờ duyệt", da_duyet: "Đã duyệt", tu_choi: "Từ chối", bo_qua: "Bỏ qua", tra_lai: "Trả lại" };

/** Các bước duyệt của một đề nghị đã gửi */
export function ApprovalSteps({ steps, people, requesterName, sentAt }: {
  steps: ReqStep[]; people: Profile[]; requesterName: string; sentAt: string;
}) {
  const nm = (id: string | null) => people.find((p) => p.id === id)?.full_name ?? null;
  const firstWaiting = steps.find((s) => s.status === "cho")?.id;
  return (
    <ol className="card ap-steps" aria-label="Luồng duyệt">
      <li className="ap-done">
        <span className="ap-dot" aria-hidden="true" />
        <div><b>Người đề nghị</b> · {requesterName}<small>Đã gửi {clock(sentAt)}</small></div>
      </li>
      {steps.map((s) => {
        const who = nm(s.decided_by) ?? nm(s.approver_id) ?? (s.approver_id ? "—" : "Quản lý (người đầu tiên duyệt)");
        return (
          <li key={s.id} className={`ap-${s.status}${s.id === firstWaiting ? " now" : ""}`}>
            <span className="ap-dot" aria-hidden="true" />
            <div>
              <b>{DUTY_LABEL[s.duty]}</b> · {s.status === "bo_qua" ? <span className="muted">{s.skip_reason ?? "Bỏ qua"}</span> : who}
              <small>
                {s.status === "cho" ? (s.id === firstWaiting ? "Đang chờ duyệt" : "Chờ các bước trước") : STATE[s.status]}
                {s.decided_at ? ` · ${clock(s.decided_at)}` : ""}
                {s.note ? ` — ${s.note}` : ""}
              </small>
            </div>
          </li>
        );
      })}
    </ol>
  );
}

type Prev = { step_no: number; duty: string; approver_id: string | null; approver_name: string | null; skip_reason: string | null };

/** Xem trước ai sẽ duyệt khi đang lập đề nghị */
export function ChainPreview({ kind }: { kind: ReqKind }) {
  const [rows, setRows] = useState<Prev[] | null>(null);
  useEffect(() => {
    let live = true;
    supabase.rpc("approval_preview", { p_kind: kind }).then(({ data }) => { if (live) setRows((data as Prev[]) ?? []); });
    return () => { live = false; };
  }, [kind]);
  if (!rows) return null;
  const active = rows.filter((r) => !r.skip_reason);
  return (
    <section className="card ap-preview" aria-label="Ai sẽ duyệt đề nghị này">
      <h2 className="dn-h">Luồng duyệt</h2>
      <div className="ap-flow">
        <span className="ap-chip me">Bạn</span>
        {rows.map((r) => (
          <span key={r.step_no} className="ap-seg">
            <span className="ap-arrow" aria-hidden="true">→</span>
            <span className={`ap-chip${r.skip_reason ? " skip" : ""}`} title={r.skip_reason ?? undefined}>
              {DUTY_LABEL[r.duty]}{!r.skip_reason ? <small>{r.approver_name ?? "Quản lý"}</small> : <small>bỏ qua</small>}
            </span>
          </span>
        ))}
      </div>
      <p className="muted small" style={{ margin: 0 }}>
        {active.length ? "Bước chưa có người giữ sẽ tự bỏ qua; một người đứng nhiều bước chỉ duyệt một lần." : "Không có cấp nào cần duyệt: đề nghị được duyệt ngay khi gửi."}
      </p>
    </section>
  );
}
