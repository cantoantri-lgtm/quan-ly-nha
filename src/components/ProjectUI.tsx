import { useEffect, useMemo, useRef, useState, type FormEvent } from "react";
import { addDaysISO, daysBetween, ddmm, ddmmyyyy, todayVN } from "../lib/dates";
import { parseMoney, vnd } from "../lib/money";
import { ITEM_STATUS, type Node, type PLog } from "../lib/project";
import { Icon, Sheet } from "./ui";
import "../projects.css";

type Person = { id: string; full_name: string; is_active?: boolean };

export function initials(n: string) {
  const w = n.replace(/\[.*?\]/g, "").trim().split(/\s+/);
  return (w.length >= 2 ? w[w.length - 2][0] + w[w.length - 1][0] : (w[0] ?? "?").slice(0, 2)).toUpperCase();
}
export function Avatar({ name, size = 24 }: { name: string; size?: number }) {
  return <span className="pj-av" title={name} aria-label={name} style={{ width: size, height: size, fontSize: Math.round(size * 0.42) }}>{initials(name)}</span>;
}
export function Avatars({ names, size = 22, max = 5 }: { names: string[]; size?: number; max?: number }) {
  return (
    <span className="pj-avs">
      {names.slice(0, max).map((n, i) => <Avatar key={i} name={n} size={size} />)}
      {names.length > max ? <span className="pj-av more" style={{ width: size, height: size, fontSize: Math.round(size * 0.4) }}>+{names.length - max}</span> : null}
    </span>
  );
}
export function Bar({ pct, plan, late, h = 6 }: { pct: number; plan?: number; late?: boolean; h?: number }) {
  return (
    <span className={`pj-bar${late ? " late" : ""}`} style={{ height: h }}>
      <span style={{ width: `${Math.max(0, Math.min(100, pct))}%` }} />
      {plan != null ? <i style={{ left: `${Math.max(0, Math.min(100, plan))}%` }} aria-hidden="true" /> : null}
    </span>
  );
}
export function ItemChip({ n }: { n: Node }) {
  if (n.calc >= 100) return <span className="pj-chip done">Hoàn thành</span>;
  if (n.status === "tam_dung") return <span className="pj-chip">Tạm dừng</span>;
  if (n.late) return <span className="pj-chip late">Chậm tiến độ</span>;
  if (n.calc > 0) return <span className="pj-chip run">Đang làm</span>;
  return <span className="pj-chip">Chưa bắt đầu</span>;
}

/** Chọn nhiều người: chip + ô chọn thêm */
export function PeoplePick({ id, label, people, value, onChange, exclude = [] }: { id: string; label: string; people: Person[]; value: string[]; onChange: (v: string[]) => void; exclude?: string[] }) {
  const left = people.filter((p) => !value.includes(p.id) && !exclude.includes(p.id));
  return (
    <div className="field">
      <span><label htmlFor={id}>{label}</label></span>
      {value.length ? (
        <div className="pj-chips">
          {value.map((u) => {
            const n = people.find((p) => p.id === u)?.full_name ?? "?";
            return (
              <span key={u} className="pj-person">
                <Avatar name={n} size={20} />{n}
                <button type="button" aria-label={`Bỏ ${n}`} onClick={() => onChange(value.filter((x) => x !== u))}>{Icon.x}</button>
              </span>
            );
          })}
        </div>
      ) : null}
      <select id={id} className="input" value="" onChange={(e) => e.target.value && onChange([...value, e.target.value])}>
        <option value="">{value.length ? "Thêm người…" : "Chọn người…"}</option>
        {left.map((p) => <option key={p.id} value={p.id}>{p.full_name}</option>)}
      </select>
    </div>
  );
}

export type Zoom = "ngay" | "tuan" | "thang";
const PX: Record<Zoom, number> = { ngay: 26, tuan: 7, thang: 2.6 };

/** Gantt: bảng cây bên trái (dính khi cuộn ngang), thanh thời gian bên phải */
export function Gantt({ rows, collapsed, onToggle, selId, onSelect, onOpen, zoom, from, to, people, compact }: {
  rows: Node[]; collapsed: Set<string>; onToggle: (id: string) => void; selId: string | null; onSelect: (id: string) => void; onOpen: (id: string) => void;
  zoom: Zoom; from: string; to: string; people: Person[]; compact: boolean;
}) {
  const box = useRef<HTMLDivElement>(null);
  const today = todayVN();
  const px = compact && zoom === "tuan" ? 4.2 : PX[zoom];
  const start = useMemo(() => { const d = new Date(from + "T00:00:00Z"); const dow = (d.getUTCDay() + 6) % 7; return addDaysISO(from, -dow - 7); }, [from]);
  const days = daysBetween(start, to) + 15;
  const W = Math.round(days * px);
  const x = (iso: string) => daysBetween(start, iso) * px;
  const name = (id: string | null) => people.find((p) => p.id === id)?.full_name ?? "";
  const leftW = compact ? 150 : 668;

  useEffect(() => {
    const el = box.current;
    if (el) el.scrollLeft = Math.max(0, x(today) - (el.clientWidth - leftW) / 3);
  }, [zoom, start]);   // eslint-disable-line react-hooks/exhaustive-deps

  const months = useMemo(() => {
    const out: { l: number; w: number; t: string }[] = [];
    let d = start.slice(0, 7) + "-01";
    const end = addDaysISO(start, days);
    while (d < end) {
      const [y, m] = d.split("-").map(Number);
      const nx = `${m === 12 ? y + 1 : y}-${String(m === 12 ? 1 : m + 1).padStart(2, "0")}-01`;
      const a = d < start ? start : d;
      const b = nx > end ? end : nx;
      const w = daysBetween(a, b) * px;
      out.push({ l: x(a), w, t: w > 80 ? `Tháng ${m}/${y}` : `T${m}` });
      d = nx;
    }
    return out;
  }, [start, days, px]);   // eslint-disable-line react-hooks/exhaustive-deps
  const ticks = useMemo(() => {
    const out: { l: number; w: number; t: string; sun?: boolean }[] = [];
    if (zoom === "thang") return out;
    for (let i = 0; i < days; i += zoom === "ngay" ? 1 : 7) {
      const d = addDaysISO(start, i);
      if (zoom === "tuan" && px * 7 < 40 && (i / 7) % 2) continue;
      out.push({ l: i * px, w: (zoom === "ngay" ? 1 : px * 7 < 40 ? 14 : 7) * px, t: zoom === "ngay" ? String(Number(d.slice(8))) : ddmm(d), sun: zoom === "ngay" && new Date(d + "T00:00:00Z").getUTCDay() === 0 });
    }
    return out;
  }, [zoom, start, days, px]);

  return (
    <div className={`gantt${compact ? " compact" : ""}`} ref={box} role="region" aria-label="Biểu đồ Gantt" tabIndex={0}>
      <div className="g-inner" style={{ width: leftW + W }}>
        <div className="g-row g-head">
          <div className="g-left" style={{ width: leftW }}>
            {compact ? <span className="g-c name">Hạng mục</span> : <>
              <span className="g-c wbs">#</span><span className="g-c name">Hạng mục</span><span className="g-c pic">PIC</span>
              <span className="g-c end">Kết thúc</span><span className="g-c pct">Tiến độ</span>
            </>}
          </div>
          <div className="g-time" style={{ width: W }}>
            {months.map((m, i) => <span key={i} className="g-month" style={{ left: m.l, width: m.w }}>{m.t}</span>)}
            {ticks.map((t, i) => <span key={i} className={`g-tick${t.sun ? " sun" : ""}`} style={{ left: t.l, width: t.w }}>{t.t}</span>)}
            <span className="g-today-tag" style={{ left: x(today) + px / 2 }}>Hôm nay</span>
          </div>
        </div>
        <div className="g-body">
          <div className="g-grid" style={{ left: leftW, width: W }} aria-hidden="true">
            {zoom === "ngay" ? ticks.filter((t) => t.sun).map((t, i) => <span key={i} className="g-sun" style={{ left: t.l, width: t.w }} />) : null}
            {months.map((m, i) => <span key={i} className="g-vline" style={{ left: m.l }} />)}
            <span className="g-today" style={{ left: x(today) + px / 2 }} />
          </div>
          {rows.length === 0 ? <div className="g-empty" style={{ width: leftW }}>Chưa có hạng mục. Bấm “Hạng mục chính” để thêm.</div> : null}
          {rows.map((n) => {
            const on = n.id === selId;
            const bx = x(n.start_date);
            const bw = Math.max(px, (daysBetween(n.start_date, n.end_date) + 1) * px);
            const tip = `${n.wbs} ${n.name} · ${ddmmyyyy(n.start_date)} – ${ddmmyyyy(n.end_date)} · ${n.calc}%`;
            return (
              <div key={n.id} className={`g-row lv${n.level}${on ? " on" : ""}`} onClick={() => onSelect(n.id)} onDoubleClick={() => onOpen(n.id)}>
                <div className="g-left" style={{ width: leftW }}>
                  {compact ? (
                    <span className="g-c name" style={{ paddingLeft: 6 + (n.level - 1) * 10 }}>
                      <button type="button" className="g-name" onClick={(e) => { e.stopPropagation(); onSelect(n.id); }}>{n.wbs} {n.name}</button>
                      <small>{n.calc}%{n.pic_id ? ` · ${name(n.pic_id).split(" ").slice(-1)[0]}` : ""}</small>
                    </span>
                  ) : <>
                    <span className="g-c wbs num">{n.wbs}</span>
                    <span className="g-c name" style={{ paddingLeft: 8 + (n.level - 1) * 16 }}>
                      {n.hasKids
                        ? <button type="button" className="g-caret" aria-expanded={!collapsed.has(n.id)} aria-label={`${collapsed.has(n.id) ? "Mở" : "Thu gọn"} ${n.name}`} onClick={(e) => { e.stopPropagation(); onToggle(n.id); }}>{Icon.chev}</button>
                        : <span className="g-caret-sp" />}
                      <button type="button" className="g-name" onClick={(e) => { e.stopPropagation(); onSelect(n.id); }}>{n.name}</button>
                    </span>
                    <span className="g-c pic">{n.pic_id ? <><Avatar name={name(n.pic_id)} size={20} /><span className="clip">{name(n.pic_id)}</span></> : <span className="muted">—</span>}</span>
                    <span className="g-c end num">{ddmm(n.end_date)}</span>
                    <span className="g-c pct"><Bar pct={n.calc} late={n.late} h={5} /><b className="num">{n.calc}%</b></span>
                  </>}
                </div>
                <div className="g-time" style={{ width: W }}>
                  {n.hasKids ? (
                    <span className="g-sum" style={{ left: bx, width: bw }} title={tip}><span style={{ width: `${n.calc}%` }} /></span>
                  ) : (
                    <span className={`g-bar${n.late ? " late" : ""}${n.calc >= 100 ? " done" : ""}`} style={{ left: bx, width: bw }} title={tip}><span style={{ width: `${n.calc}%` }} /></span>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

/** Ngăn chi tiết hạng mục: thông tin, cập nhật tiến độ, nhật ký */
export function ItemPane({ n, parent, people, canProgress, canEdit, logs, busy, onSave, onEdit, onAddChild, onDelete, onClose }: {
  n: Node; parent: Node | null; people: Person[]; canProgress: boolean; canEdit: boolean; logs: PLog[]; busy: boolean;
  onSave: (progress: number, note: string, done?: boolean) => void; onEdit: () => void; onAddChild: () => void; onDelete: () => void; onClose?: () => void;
}) {
  const [pct, setPct] = useState(n.progress);
  const [note, setNote] = useState("");
  useEffect(() => { setPct(n.progress); setNote(""); }, [n.id, n.progress]);
  const name = (id: string | null) => people.find((p) => p.id === id)?.full_name ?? "—";
  const days = daysBetween(n.start_date, n.end_date) + 1;
  const mine = logs.filter((l) => l.item_id === n.id).slice(0, 8);
  function submit(e: FormEvent) { e.preventDefault(); onSave(pct, note); }
  return (
    <aside className="card pj-pane" aria-label={`Chi tiết hạng mục ${n.wbs}`}>
      <div className="pj-pane-head">
        <div>
          <span className="muted small">Hạng mục {n.wbs} · cấp {n.level}</span>
          <h3>{n.name}</h3>
        </div>
        <ItemChip n={n} />
        {onClose ? <button type="button" className="ico-btn" aria-label="Đóng" onClick={onClose}>{Icon.x}</button> : null}
      </div>
      <dl className="pj-kv">
        <dt>Thời gian</dt><dd className="num">{ddmmyyyy(n.start_date)} – {ddmmyyyy(n.end_date)} · {days} ngày</dd>
        {parent ? (<><dt>Hạng mục cha</dt><dd>{parent.wbs}. {parent.name}</dd></>) : null}
        <dt>PIC</dt><dd>{name(n.pic_id)}</dd>
        <dt>Hỗ trợ</dt><dd>{n.members.length ? n.members.map(name).join(", ") : "—"}</dd>
        {n.level === 1 ? (<><dt>Ngân sách</dt><dd className="num">{n.budget != null ? vnd(n.budget) : "Chưa đặt"}</dd></>) : null}
      </dl>
      {n.late ? <div className="pj-warn">Theo kế hoạch đến hôm nay phải đạt {n.planPct}%, mới đạt {n.calc}%. Chậm {n.planPct - n.calc}%.</div> : null}
      {canProgress ? (
        n.hasKids ? (
          <p className="muted small" style={{ margin: 0 }}>Tiến độ {n.calc}% tự tính từ các cấp con (theo số ngày). Cập nhật ở từng hạng mục con.</p>
        ) : (
          <form className="stack pj-progress" onSubmit={submit}>
            <label htmlFor={`pg-${n.id}`} className="pj-lab">Cập nhật tiến độ</label>
            <div className="row" style={{ flexWrap: "nowrap" }}>
              <input id={`pg-${n.id}`} type="range" min={0} max={100} step={5} value={pct} onChange={(e) => setPct(Number(e.target.value))} style={{ flex: 1 }} />
              <input aria-label="Phần trăm tiến độ" className="input num" style={{ width: 72, textAlign: "right" }} inputMode="numeric" value={pct}
                onChange={(e) => setPct(Math.max(0, Math.min(100, Number(e.target.value.replace(/\D/g, "")) || 0)))} />
            </div>
            <input aria-label="Ghi chú cập nhật" className="input" value={note} onChange={(e) => setNote(e.target.value)} placeholder="Ghi chú cập nhật (đã làm gì, vướng gì)…" maxLength={1000} />
            <div className="row">
              <button className="btn sm" disabled={busy}>{Icon.check}Lưu tiến độ</button>
              {n.progress < 100 ? <button type="button" className="btn secondary sm" disabled={busy} onClick={() => onSave(100, note, true)}>Hoàn thành</button> : null}
            </div>
          </form>
        )
      ) : <p className="muted small" style={{ margin: 0 }}>Chỉ PIC, người hỗ trợ của hạng mục và người quản lý dự án cập nhật được tiến độ.</p>}
      {canEdit ? (
        <div className="row pj-pane-acts">
          <button type="button" className="btn ghost sm" onClick={onEdit}>{Icon.edit}Sửa</button>
          {n.level < 4 ? <button type="button" className="btn ghost sm" onClick={onAddChild}>{Icon.plus}Thêm cấp con</button> : null}
          <button type="button" className="btn ghost sm" style={{ color: "var(--danger)" }} onClick={onDelete}>{Icon.trash}Xoá</button>
        </div>
      ) : null}
      <h4 className="pj-h4">Nhật ký</h4>
      {mine.length ? (
        <ul className="pj-log">
          {mine.map((l) => (
            <li key={l.id}><Avatar name={name(l.by_id)} size={22} />
              <span><b>{name(l.by_id)}</b> <span className="muted">{new Date(l.at).toLocaleString("vi-VN", { timeZone: "Asia/Ho_Chi_Minh", day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" })}</span><br />
                {l.progress != null ? `${l.progress}%` : ""}{l.status ? ` · ${ITEM_STATUS[l.status] ?? l.status}` : ""}{l.note ? ` · ${l.note}` : ""}</span></li>
          ))}
        </ul>
      ) : <p className="muted small" style={{ margin: 0 }}>Chưa có cập nhật.</p>}
    </aside>
  );
}

export type ItemDraft = { name: string; start: string; end: string; pic: string; members: string[]; budget: string; note: string };
/** Form thêm / sửa hạng mục */
export function ItemSheet({ open, title, level, draft, setDraft, people, busy, err, onClose, onSubmit, parentRange }: {
  open: boolean; title: string; level: number; draft: ItemDraft; setDraft: (d: ItemDraft) => void; people: Person[]; busy: boolean; err: string | null;
  onClose: () => void; onSubmit: () => void; parentRange?: { start: string; end: string; name: string } | null;
}) {
  const set = (p: Partial<ItemDraft>) => setDraft({ ...draft, ...p });
  const outside = parentRange && draft.start && draft.end && (draft.start < parentRange.start || draft.end > parentRange.end);
  return (
    <Sheet open={open} onClose={onClose} title={title}>
      <form className="stack" onSubmit={(e) => { e.preventDefault(); onSubmit(); }}>
        <label className="field"><span>Tên hạng mục <span className="req">*</span></span>
          <input id="it-name" className="input" value={draft.name} onChange={(e) => set({ name: e.target.value })} required maxLength={300} placeholder="VD: Thi công phần thô" /></label>
        <div className="row" style={{ alignItems: "flex-start" }}>
          <label className="field" style={{ flex: "1 1 140px" }}><span>Bắt đầu <span className="req">*</span></span>
            <input id="it-start" type="date" className="input" value={draft.start} required onChange={(e) => set({ start: e.target.value, end: draft.end < e.target.value ? e.target.value : draft.end })} /></label>
          <label className="field" style={{ flex: "1 1 140px" }}><span>Kết thúc <span className="req">*</span></span>
            <input id="it-end" type="date" className="input" value={draft.end} min={draft.start} required onChange={(e) => set({ end: e.target.value })} /></label>
        </div>
        {outside ? <p className="muted small" style={{ margin: 0 }}>Lưu ý: ngoài khoảng của hạng mục cha “{parentRange!.name}” ({ddmm(parentRange!.start)} – {ddmm(parentRange!.end)}).</p> : null}
        <label className="field"><span>Người phụ trách (PIC)</span>
          <select id="it-pic" className="input" value={draft.pic} onChange={(e) => set({ pic: e.target.value, members: draft.members.filter((m) => m !== e.target.value) })}>
            <option value="">Chưa giao</option>
            {people.map((p) => <option key={p.id} value={p.id}>{p.full_name}</option>)}
          </select></label>
        <PeoplePick id="it-sup" label="Người hỗ trợ" people={people} value={draft.members} onChange={(v) => set({ members: v })} exclude={draft.pic ? [draft.pic] : []} />
        {level === 1 ? (
          <label className="field"><span>Ngân sách hạng mục chính</span>
            <input id="it-budget" className="input num" inputMode="decimal" value={draft.budget} onChange={(e) => set({ budget: e.target.value })} placeholder="VD: 420tr" />
            {draft.budget ? <small className={parseMoney(draft.budget) != null ? "muted" : "err-text"}>{parseMoney(draft.budget) != null ? vnd(parseMoney(draft.budget)) : "Chưa đọc được số tiền"}</small> : null}</label>
        ) : null}
        <label className="field"><span>Ghi chú</span>
          <textarea id="it-note" className="input" value={draft.note} onChange={(e) => set({ note: e.target.value })} maxLength={1000} /></label>
        {err ? <div className="error-box" role="alert">{err}</div> : null}
        <button className="btn block" disabled={busy}>{busy ? "Đang lưu…" : "Lưu hạng mục"}</button>
      </form>
    </Sheet>
  );
}

export function useIsWide(min = 900) {
  const [w, setW] = useState(() => typeof window !== "undefined" && window.innerWidth >= min);
  useEffect(() => { const h = () => setW(window.innerWidth >= min); window.addEventListener("resize", h); return () => window.removeEventListener("resize", h); }, [min]);
  return w;
}
