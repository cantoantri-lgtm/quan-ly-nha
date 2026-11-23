import { useState } from "react";
import { friendlyError } from "../lib/supabase";
import { useSession } from "../lib/session";
import { defaultLayout, saveLayout, WIDGETS, type WidgetKey } from "../lib/homeLayout";
import { Sheet } from "./ui";

type Who = { isManager: boolean; isLeadUp: boolean; isAccountant: boolean };

/** Thêm, bỏ, đổi thứ tự các ô báo cáo ở màn hình chính. Lưu ngay mỗi lần đổi, theo tài khoản. */
export default function HomeCustomize({ open, onClose, userId, keys, who, onChange }:
  { open: boolean; onClose: () => void; userId: string; keys: WidgetKey[]; who: Who; onChange: (k: string[]) => void }) {
  const { toast } = useSession();
  const [busy, setBusy] = useState(false);
  const avail = WIDGETS.filter((w) => w.need(who));
  const hidden = avail.filter((w) => !keys.includes(w.key));
  const title = (k: WidgetKey) => WIDGETS.find((w) => w.key === k)?.title ?? k;

  async function apply(next: WidgetKey[]) {
    const prev = keys;
    onChange(next);                       // hiện ngay, lỗi thì trả lại như cũ
    setBusy(true);
    const { error } = await saveLayout(userId, next);
    setBusy(false);
    if (error) { onChange(prev); toast(`Chưa lưu được: ${friendlyError(error)}`); }
  }
  const move = (i: number, d: -1 | 1) => {
    const j = i + d; if (j < 0 || j >= keys.length) return;
    const n = [...keys]; [n[i], n[j]] = [n[j], n[i]]; apply(n);
  };

  return (
    <Sheet open={open} onClose={onClose} title="Tuỳ chỉnh màn hình chính">
      <div className="stack">
        <p className="muted small" style={{ margin: 0 }}>Bấm ▲ ▼ để đổi vị trí, “Bỏ” để ẩn, “Thêm” để đưa báo cáo ra màn hình chính. Lưu ngay theo tài khoản của bạn, điện thoại và máy tính giống nhau.</p>
        <h3 style={{ margin: 0, fontSize: 15 }}>Đang hiện ({keys.length})</h3>
        {keys.length === 0 ? <p className="muted" style={{ margin: 0 }}>Chưa có báo cáo nào.</p> : (
          <ol className="hw-list">
            {keys.map((k, i) => (
              <li key={k} className="hw-item">
                <span className="hw-no num">{i + 1}</span>
                <span className="hw-name"><b>{title(k)}</b><small>{WIDGETS.find((w) => w.key === k)?.desc}</small></span>
                <span className="hw-acts">
                  <button type="button" className="ico-btn" disabled={busy || i === 0} onClick={() => move(i, -1)} aria-label={`Đưa ${title(k)} lên`} title="Lên">▲</button>
                  <button type="button" className="ico-btn" disabled={busy || i === keys.length - 1} onClick={() => move(i, 1)} aria-label={`Đưa ${title(k)} xuống`} title="Xuống">▼</button>
                  <button type="button" className="btn ghost sm" style={{ color: "var(--danger)" }} disabled={busy} onClick={() => apply(keys.filter((x) => x !== k))}>Bỏ</button>
                </span>
              </li>
            ))}
          </ol>
        )}
        <h3 style={{ margin: 0, fontSize: 15 }}>Thêm báo cáo</h3>
        {hidden.length === 0 ? <p className="muted" style={{ margin: 0 }}>Đã hiện tất cả báo cáo bạn được xem.</p> : (
          <ul className="hw-list">
            {hidden.map((w) => (
              <li key={w.key} className="hw-item">
                <span className="hw-name"><b>{w.title}</b><small>{w.desc}</small></span>
                <span className="hw-acts"><button type="button" className="btn secondary sm" disabled={busy} onClick={() => apply([...keys, w.key])}>+ Thêm</button></span>
              </li>
            ))}
          </ul>
        )}
        <div className="row" style={{ justifyContent: "space-between" }}>
          <button type="button" className="btn ghost sm" disabled={busy} onClick={() => apply(defaultLayout(who))}>Về mặc định</button>
          <button type="button" className="btn sm" onClick={onClose}>Xong</button>
        </div>
      </div>
    </Sheet>
  );
}
