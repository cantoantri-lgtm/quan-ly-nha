import { useEffect, useState, type FormEvent } from "react";
import type { Profile } from "../lib/labels";
import { dirLine, useDirectory } from "../lib/directory";
import { useSession } from "../lib/session";
import { Combo, Sheet } from "./ui";

/** Người giao đổi người phụ trách chính (việc) hoặc PIC (dự án) */
export function ReassignSheet({ open, onClose, title, what, current, currentName, candidates, keepLabel, onSave, onDone }: {
  open: boolean; onClose: () => void;
  title: string;                 // "Đổi người phụ trách chính"
  what: string;                  // tên việc / dự án, hiện dưới tiêu đề
  current: string | null; currentName: string;
  candidates: Profile[];
  keepLabel: string;             // "Giữ … lại cùng làm"
  onSave: (user: string, keep: boolean, note: string) => Promise<void>;
  onDone: () => void;
}) {
  const { toast } = useSession();
  const dir = useDirectory();
  const [who, setWho] = useState("");
  const [keep, setKeep] = useState(false);
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  useEffect(() => { if (open) { setWho(""); setKeep(false); setNote(""); setErr(null); } }, [open]);

  const options = candidates.filter((p) => p.id !== current).map((p) => {
    const d = dirLine(dir.get(p.id));
    return [p.id, d ? `${p.full_name} · ${d}` : p.full_name] as const;
  });

  async function submit(e: FormEvent) {
    e.preventDefault(); setErr(null);
    if (!who) { setErr("Chọn người phụ trách mới."); return; }
    setBusy(true);
    try {
      await onSave(who, keep, note.trim());
      toast("Đã đổi người phụ trách. Người mới sẽ nhận thông báo.");
      onClose(); onDone();
    } catch (e2) { setErr((e2 as Error).message); }
    finally { setBusy(false); }
  }

  return (
    <Sheet open={open} onClose={onClose} title={title}>
      <form className="stack" onSubmit={submit}>
        <p className="muted small" style={{ margin: 0 }}>{what} · đang phụ trách <b>{currentName}</b></p>
        <label className="field"><span>Người phụ trách mới *</span>
          <Combo id="ra-who" value={who} options={options} onChange={setWho} placeholder="— Chọn người —" />
          {!options.length ? <small className="muted">Chưa có ai để giao. Người nhận phải là cấp dưới của anh/chị và đang làm việc.</small> : null}
        </label>
        {current ? (
          <label style={{ display: "flex", gap: 8, alignItems: "center", fontSize: 14 }}>
            <input type="checkbox" checked={keep} onChange={(e) => setKeep(e.target.checked)} />
            <span>{keepLabel}</span>
          </label>
        ) : null}
        <label className="field"><span>Lý do</span>
          <textarea id="ra-note" className="input" style={{ minHeight: 70 }} maxLength={500} value={note} onChange={(e) => setNote(e.target.value)}
            placeholder="VD: chuyển sang toà khác, nghỉ phép dài ngày" /></label>
        <small className="muted">Thay đổi được ghi vào nhật ký. Người mới, người cũ và những người cùng làm đều nhận thông báo.</small>
        {err ? <div className="error-box" role="alert">{err}</div> : null}
        <button className="btn block" disabled={busy}>{busy ? "Đang lưu…" : "Đổi người phụ trách"}</button>
      </form>
    </Sheet>
  );
}
