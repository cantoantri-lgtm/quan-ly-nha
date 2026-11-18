import { useMemo, useState } from "react";
import { vnd } from "../lib/money";
import { ddmmyyyy } from "../lib/dates";
import { loaLeft, type LoaPick } from "../lib/office";
import { Sheet } from "./ui";

/** Hộp tìm và chọn Tờ trình (LOA) đã duyệt để gắn vào đề nghị tiền. Danh sách lấy từ loa_pickable (quyền do CSDL lọc). */
export function LoaPicker({ open, onClose, picks, value, onPick }: {
  open: boolean; onClose: () => void; picks: LoaPick[] | null; value: string; onPick: (id: string) => void;
}) {
  const [q, setQ] = useState("");
  const list = useMemo(() => {
    const s = q.trim().toLowerCase();
    return (picks ?? []).filter((x) => !s || `${x.doc_no ?? ""} ${x.subject} ${x.requester_name ?? ""}`.toLowerCase().includes(s));
  }, [picks, q]);

  return (
    <Sheet open={open} onClose={onClose} title="Chọn Tờ trình (LOA)" wide>
      <div className="stack">
        <input className="input" autoFocus placeholder="Tìm số LOA, tiêu đề, người lập…" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Tìm LOA" />
        {picks == null ? <div className="muted small">Đang tải…</div>
          : list.length === 0 ? <div className="muted small">{picks.length ? "Không có LOA khớp từ khoá." : "Chưa có LOA chi tiền đã duyệt nào bạn được dùng."}</div>
          : (
            <div className="dt-wrap loa-pick">
              <table className="dt">
                <thead><tr><th>Số LOA</th><th>Tiêu đề</th><th>Người lập</th><th>Từ ngày</th><th className="r">Dự toán</th><th className="r">Còn lại</th></tr></thead>
                <tbody>
                  {list.map((x) => {
                    const left = loaLeft(x);
                    return (
                      <tr key={x.id} className={x.id === value ? "sel" : ""} tabIndex={0} role="button" aria-label={`Chọn ${x.doc_no ?? "LOA"}: ${x.subject}`}
                        onClick={() => { onPick(x.id); onClose(); }}
                        onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); onPick(x.id); onClose(); } }}>
                        <td className="num" style={{ whiteSpace: "nowrap" }}><b className="dt-link">{x.doc_no ?? "—"}</b></td>
                        <td><div className="clip">{x.subject}</div></td>
                        <td>{x.requester_name ?? "—"}</td>
                        <td className="num">{ddmmyyyy(x.start_date)}</td>
                        <td className="r" style={{ whiteSpace: "nowrap" }}>{vnd(x.amount)}</td>
                        <td className={`r${left < 0 ? " err-text" : ""}`} style={{ whiteSpace: "nowrap" }}><b>{vnd(left)}</b></td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        <p className="muted small" style={{ margin: 0 }}>Còn lại = dự toán − đã duyệt chi − đang chờ duyệt. Bấm một dòng để chọn.</p>
        {value ? <button type="button" className="btn ghost" onClick={() => { onPick(""); onClose(); }}>Bỏ gắn LOA</button> : null}
      </div>
    </Sheet>
  );
}
