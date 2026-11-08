import { useEffect, useState, type FormEvent } from "react";
import { friendlyError, supabase } from "../lib/supabase";
import { useSession } from "../lib/session";
import { kindLabel, summary, type Req } from "../lib/office";
import { Sheet } from "./ui";

export type DecideMode = "da_duyet" | "tu_choi" | "tra_lai";

const TITLE: Record<DecideMode, string> = { da_duyet: "Duyệt đề nghị", tu_choi: "Từ chối đề nghị", tra_lai: "Trả lại đề nghị" };
const HINT: Record<DecideMode, string> = {
  da_duyet: "Đề nghị chuyển sang cấp duyệt tiếp theo (nếu có).",
  tu_choi: "Đề nghị bị từ chối, kết thúc luồng duyệt. Người lập sửa lại được rồi gửi lại.",
  tra_lai: "Trả về cho người lập sửa. Sau khi sửa và gửi lại, đề nghị đi duyệt lại từ cấp đầu.",
};

/** Cấp duyệt xử lý một đề nghị: Duyệt / Từ chối / Trả lại. Từ chối và Trả lại bắt buộc ghi lý do. */
export default function DecideSheet({ req, mode, onClose, onDone }: { req: Req | null; mode: DecideMode | null; onClose: () => void; onDone: () => void }) {
  const { people, toast, refreshUnread } = useSession();
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  useEffect(() => { setNote(""); setErr(null); }, [req?.id, mode]);

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (!req || !mode) return;
    if (mode !== "da_duyet" && !note.trim()) { setErr(mode === "tu_choi" ? "Ghi lý do từ chối để người đề nghị biết." : "Ghi lý do trả lại để người đề nghị biết cần sửa gì."); return; }
    setBusy(true); setErr(null);
    const { error } = mode === "tra_lai"
      ? await supabase.rpc("return_step", { p_request: req.id, p_note: note.trim() })
      : await supabase.rpc("decide_step", { p_request: req.id, p_approve: mode === "da_duyet", p_note: note.trim() || null });
    setBusy(false);
    if (error) { setErr(friendlyError(error)); return; }
    toast(mode === "da_duyet" ? "Đã duyệt bước của bạn." : mode === "tu_choi" ? "Đã từ chối đề nghị." : "Đã trả lại đề nghị cho người lập.");
    refreshUnread(); onDone();
  }

  const who = people.find((p) => p.id === req?.requester_id)?.full_name;
  return (
    <Sheet open={!!req && !!mode} onClose={onClose} title={mode ? TITLE[mode] : ""}>
      {req && mode ? (
        <form className="stack" onSubmit={submit}>
          <p className="muted" style={{ margin: 0 }}>{who} · {kindLabel(req)} · {summary(req)}</p>
          <p className="small muted" style={{ margin: 0 }}>{HINT[mode]}</p>
          <label className="field"><span>{mode === "da_duyet" ? "Ghi chú (không bắt buộc)" : mode === "tu_choi" ? "Lý do từ chối *" : "Lý do trả lại *"}</span>
            <textarea className="input" value={note} onChange={(e) => setNote(e.target.value)} autoFocus /></label>
          {err ? <div className="error-box" role="alert">{err}</div> : null}
          <button className={`btn block${mode === "tu_choi" ? " danger" : ""}`} disabled={busy}>{busy ? "Đang xử lý…" : mode === "da_duyet" ? "Duyệt" : mode === "tu_choi" ? "Từ chối" : "Trả lại"}</button>
        </form>
      ) : null}
    </Sheet>
  );
}
