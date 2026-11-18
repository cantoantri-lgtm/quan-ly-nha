import { Fragment, useEffect, useRef, useState, type ClipboardEvent, type KeyboardEvent } from "react";
import { parseMoney, vnd } from "../lib/money";
import { VAT_RATES, type ReqAdvance, type ReqLine } from "../lib/office";
import { MAX_BYTES } from "../lib/files";
import { Icon, Sheet } from "./ui";

/** Bản nháp trong form: mọi ô đều là chuỗi cho tới khi lưu */
export type LineDraft = {
  invoice_serial: string; invoice_no: string; invoice_date: string; seller_name: string; seller_tax: string;
  amount: string; quantity: string; vat_pct: string; description: string; cost_center: string; object_ref: string;
};
export type AdvDraft = { amount: string; description: string };
export type LinkDraft = { url: string; title: string };

export const emptyLine = (): LineDraft => ({
  invoice_serial: "", invoice_no: "", invoice_date: "", seller_name: "", seller_tax: "",
  amount: "", quantity: "", vat_pct: "0", description: "", cost_center: "", object_ref: "",
});
export const emptyAdv = (): AdvDraft => ({ amount: "", description: "" });

export const lineFromRow = (l: ReqLine): LineDraft => ({
  invoice_serial: l.invoice_serial ?? "", invoice_no: l.invoice_no ?? "", invoice_date: l.invoice_date ?? "",
  seller_name: l.seller_name ?? "", seller_tax: l.seller_tax ?? "", amount: String(l.amount_pre_vat),
  quantity: l.quantity != null ? String(l.quantity) : "", vat_pct: String(l.vat_pct), description: l.description ?? "",
  cost_center: l.cost_center, object_ref: l.object_ref ?? "",
});
export const advFromRow = (a: ReqAdvance): AdvDraft => ({ amount: String(a.amount), description: a.description ?? "" });

/** VAT và tổng của một dòng (CSDL tính lại khi lưu, đây chỉ để xem trước) */
export function calcLine(l: LineDraft) {
  const pre = parseMoney(l.amount) ?? 0;
  const vat = Math.round((pre * Number(l.vat_pct || 0)) / 100);
  return { pre, vat, total: pre + vat };
}
export function totals(lines: LineDraft[], advs: AdvDraft[]) {
  const gross = lines.reduce((s, l) => s + calcLine(l).total, 0);
  const adv = advs.reduce((s, a) => s + (parseMoney(a.amount) ?? 0), 0);
  return { gross, adv, net: gross - adv };
}

const nullIf = (s: string) => (s.trim() ? s.trim() : null);
export const lineToRow = (l: LineDraft, i: number) => ({
  line_no: i + 1, invoice_serial: nullIf(l.invoice_serial), invoice_no: nullIf(l.invoice_no),
  invoice_date: l.invoice_date || null, seller_name: nullIf(l.seller_name), seller_tax: nullIf(l.seller_tax),
  amount_pre_vat: parseMoney(l.amount) ?? 0, quantity: l.quantity ? Number(l.quantity.replace(",", ".")) : null,
  vat_pct: Number(l.vat_pct || 0), description: nullIf(l.description), cost_center: l.cost_center.trim(), object_ref: nullIf(l.object_ref),
});

type Props = {
  lines: LineDraft[]; setLines: (v: LineDraft[]) => void;
  advs: AdvDraft[]; setAdvs: (v: AdvDraft[]) => void;
  /** Tệp và link chọn trước (chỉ khi tạo mới; khi sửa dùng mục đính kèm ở trang chi tiết) */
  files?: File[]; setFiles?: (v: File[]) => void;
  links?: LinkDraft[]; setLinks?: (v: LinkDraft[]) => void;
  onError: (m: string) => void;
};

/** Màn hình rộng (PC): nhập chi tiết dạng bảng như Excel; điện thoại: từng thẻ */
export function useWide(min = 900) {
  const q = `(min-width: ${min}px)`;
  const [w, setW] = useState(() => typeof matchMedia !== "undefined" && matchMedia(q).matches);
  useEffect(() => {
    const m = matchMedia(q); const f = () => setW(m.matches);
    m.addEventListener("change", f); return () => m.removeEventListener("change", f);
  }, [q]);
  return w;
}

export default function DnttEditor({ lines, setLines, advs, setAdvs, files, setFiles, links, setLinks, onError }: Props) {
  const t = totals(lines, advs);
  const wide = useWide();
  const fileRef = useRef<HTMLInputElement>(null);
  const [linkUrl, setLinkUrl] = useState("");
  const [linkTitle, setLinkTitle] = useState("");

  const setLine = (i: number, patch: Partial<LineDraft>) => setLines(lines.map((l, k) => (k === i ? { ...l, ...patch } : l)));
  const setAdv = (i: number, patch: Partial<AdvDraft>) => setAdvs(advs.map((a, k) => (k === i ? { ...a, ...patch } : a)));

  function pickFiles(list: FileList | null) {
    if (!list || !setFiles) return;
    const ok: File[] = [];
    for (const f of Array.from(list)) {
      if (!/^(image\/|application\/pdf)/.test(f.type)) { onError(`"${f.name}" không phải ảnh hoặc PDF.`); continue; }
      if (f.size > MAX_BYTES * 3) { onError(`"${f.name}" quá lớn.`); continue; }
      ok.push(f);
    }
    setFiles([...(files ?? []), ...ok]);
    if (fileRef.current) fileRef.current.value = "";
  }
  function addLink() {
    if (!setLinks) return;
    const u = linkUrl.trim();
    if (!/^https?:\/\/\S+$/i.test(u)) { onError("Link phải bắt đầu bằng http:// hoặc https://"); return; }
    setLinks([...(links ?? []), { url: u, title: linkTitle.trim() }]);
    setLinkUrl(""); setLinkTitle("");
  }

  const attach = setFiles && setLinks ? (
    <>
      <h2 className="dn-h dn-h-out">Đính kèm</h2>
      <div className="card dn-attach">
        <input ref={fileRef} type="file" accept="image/*,application/pdf" multiple hidden onChange={(e) => pickFiles(e.target.files)} />
        <button type="button" className="btn secondary block" onClick={() => fileRef.current?.click()}>Tải lên (ảnh hoặc PDF)</button>
        {files?.length ? (
          <ul className="dn-list">
            {files.map((f, i) => (
              <li key={i}><span>{f.name}</span><button type="button" className="btn ghost" aria-label={`Bỏ ${f.name}`} onClick={() => setFiles(files.filter((_, k) => k !== i))}>Bỏ</button></li>
            ))}
          </ul>
        ) : null}
        <div className="dn-linkrow">
          <label className="field"><span>Thêm link</span>
            <input className="input" inputMode="url" value={linkUrl} onChange={(e) => setLinkUrl(e.target.value)} placeholder="https://…" /></label>
          <label className="field"><span>Tên link (không bắt buộc)</span>
            <input className="input" value={linkTitle} onChange={(e) => setLinkTitle(e.target.value)} placeholder="VD: Báo giá trên Drive" /></label>
          <button type="button" className="btn secondary" onClick={addLink}>+ Thêm link</button>
        </div>
        {links?.length ? (
          <ul className="dn-list">
            {links.map((k, i) => (
              <li key={i}><span>{k.title || k.url}</span><button type="button" className="btn ghost" onClick={() => setLinks(links.filter((_, j) => j !== i))}>Bỏ</button></li>
            ))}
          </ul>
        ) : null}
      </div>
    </>
  ) : null;

  if (wide) return (
    <>
      <LineGrid lines={lines} setLines={setLines} />
      <AdvGrid advs={advs} setAdvs={setAdvs} />
      {attach}
    </>
  );

  return (
    <>
      <h2 className="dn-h dn-h-out">Chi tiết thanh toán</h2>
      {lines.length === 0 ? <p className="muted small" style={{ margin: 0 }}>Thêm từng hoá đơn / khoản chi. Nếu chỉ có một số tiền gộp, có thể bỏ qua và nhập số tiền ở trên.</p> : null}
      {lines.map((l, i) => {
        const c = calcLine(l);
        return (
          <fieldset key={i} className="card dn-line">
            <legend>Khoản {i + 1}</legend>
            <div className="dn-fields">
              <label className="field"><span>Số serial</span>
                <input className="input" value={l.invoice_serial} onChange={(e) => setLine(i, { invoice_serial: e.target.value })} placeholder="VD: C26TAA" /></label>
              <label className="field"><span>Số hoá đơn</span>
                <input className="input" value={l.invoice_no} onChange={(e) => setLine(i, { invoice_no: e.target.value })} /></label>
              <label className="field"><span>Ngày hoá đơn</span>
                <input type="date" className="input" value={l.invoice_date} onChange={(e) => setLine(i, { invoice_date: e.target.value })} /></label>
              <label className="field"><span>Tên người bán</span>
                <input className="input" value={l.seller_name} onChange={(e) => setLine(i, { seller_name: e.target.value })} /></label>
              <label className="field"><span>MST người bán</span>
                <input className="input num" inputMode="numeric" value={l.seller_tax} onChange={(e) => setLine(i, { seller_tax: e.target.value })} /></label>
              <label className="field"><span>Tiền trước VAT *</span>
                <input className="input num" inputMode="decimal" value={l.amount} onChange={(e) => setLine(i, { amount: e.target.value })} placeholder="VD: 3.500.000 hoặc 3tr5" />
                {l.amount ? <small className={c.pre ? "muted" : "err-text"}>{c.pre ? vnd(c.pre) : "Chưa đọc được số tiền"}</small> : null}</label>
              <label className="field"><span>Số lượng</span>
                <input className="input num" inputMode="decimal" value={l.quantity} onChange={(e) => setLine(i, { quantity: e.target.value })} /></label>
              <label className="field"><span>% VAT</span>
                <select className="input" value={l.vat_pct} onChange={(e) => setLine(i, { vat_pct: e.target.value })}>
                  {VAT_RATES.map((v) => <option key={v} value={v}>{v}%</option>)}
                </select></label>
              <label className="field"><span>Cost Center *</span>
                <input className="input" value={l.cost_center} onChange={(e) => setLine(i, { cost_center: e.target.value })} placeholder="VD: 89CMT8" /></label>
              <label className="field"><span>Vụ việc (IO/Object)</span>
                <input className="input" value={l.object_ref} onChange={(e) => setLine(i, { object_ref: e.target.value })} /></label>
              <label className="field dn-span2"><span>Diễn giải</span>
                <input className="input" value={l.description} onChange={(e) => setLine(i, { description: e.target.value })} /></label>
            </div>
            <div className="dn-calc num">VAT {vnd(c.vat)} · <b>Tổng {vnd(c.total)}</b></div>
            <button type="button" className="btn ghost" style={{ color: "var(--danger)" }} onClick={() => setLines(lines.filter((_, k) => k !== i))}>Xoá khoản {i + 1}</button>
          </fieldset>
        );
      })}
      <button type="button" className="btn secondary block" onClick={() => setLines([...lines, { ...emptyLine(), cost_center: lines[lines.length - 1]?.cost_center ?? "" }])}>+ Thêm khoản chi</button>

      {lines.length ? (
        <>
          <h2 className="dn-h dn-h-out">Chi tiết tạm ứng (trừ vào đề nghị)</h2>
          {advs.map((a, i) => (
            <fieldset key={i} className="card dn-line">
              <legend>Tạm ứng {i + 1}</legend>
              <label className="field"><span>Tiền (VNĐ) *</span>
                <input className="input num" inputMode="decimal" value={a.amount} onChange={(e) => setAdv(i, { amount: e.target.value })} />
                {a.amount ? <small className={parseMoney(a.amount) ? "muted" : "err-text"}>{parseMoney(a.amount) ? vnd(parseMoney(a.amount)) : "Chưa đọc được số tiền"}</small> : null}</label>
              <label className="field"><span>Diễn giải</span>
                <input className="input" value={a.description} onChange={(e) => setAdv(i, { description: e.target.value })} /></label>
              <button type="button" className="btn ghost" style={{ color: "var(--danger)" }} onClick={() => setAdvs(advs.filter((_, k) => k !== i))}>Xoá</button>
            </fieldset>
          ))}
          <button type="button" className="btn secondary block" onClick={() => setAdvs([...advs, emptyAdv()])}>+ Thêm tạm ứng</button>

          <dl className="card kv dn-total">
            <dt>Tổng thanh toán</dt><dd className="num">{vnd(t.gross)}</dd>
            <dt>Trừ tạm ứng</dt><dd className="num">{t.adv ? `− ${vnd(t.adv)}` : "—"}</dd>
            <dt><b>Tổng tiền VNĐ</b></dt><dd className={`num${t.net <= 0 ? " err-text" : ""}`}><b>{vnd(t.net)}</b></dd>
          </dl>
        </>
      ) : null}

      {attach}
    </>
  );
}

// ---------- Bảng nhập kiểu Excel (PC) ----------
type Col = { k: keyof LineDraft; label: string; req?: boolean; num?: boolean; w: number; type?: "date" | "vat" };
const COLS: Col[] = [
  { k: "invoice_serial", label: "Số serial", w: 100 },
  { k: "invoice_no", label: "Số hoá đơn", w: 100 },
  { k: "invoice_date", label: "Ngày hoá đơn", w: 140, type: "date" },
  { k: "seller_name", label: "Tên người bán", w: 190 },
  { k: "seller_tax", label: "MST người bán", w: 120 },
  { k: "description", label: "Diễn giải", w: 220 },
  { k: "amount", label: "Tiền trước VAT", req: true, num: true, w: 130 },
  { k: "quantity", label: "SL", num: true, w: 60 },
  { k: "vat_pct", label: "% VAT", w: 80, type: "vat" },
  { k: "cost_center", label: "Cost center", req: true, w: 120 },
  { k: "object_ref", label: "Vụ việc", w: 110 },
];
const VAT_AT = COLS.findIndex((c) => c.k === "vat_pct");
const fmtNum = (n: number) => new Intl.NumberFormat("vi-VN").format(n);

/** Chuẩn hoá một ô dán từ Excel theo cột */
function pasteValue(c: Col, raw: string): string {
  const v = raw.trim();
  if (c.type === "date") {
    const m = v.match(/^(\d{1,2})[/.-](\d{1,2})[/.-](\d{4})$/);
    if (m) return `${m[3]}-${m[2].padStart(2, "0")}-${m[1].padStart(2, "0")}`;
    return /^\d{4}-\d{2}-\d{2}$/.test(v) ? v : "";
  }
  if (c.type === "vat") { const n = Number(v.replace("%", "").replace(",", ".")); return VAT_RATES.includes(n) ? String(n) : "0"; }
  if (c.k === "amount") { const n = parseMoney(v); return n ? fmtNum(n) : v; }
  return v;
}

/** Ghép bảng dán (dòng = \n, ô = \t) vào danh sách, bắt đầu từ dòng r, cột c */
export function pasteGrid(lines: LineDraft[], text: string, r: number, c: number): LineDraft[] {
  const rows = text.replace(/\r/g, "").split("\n").filter((x) => x.trim() !== "");
  const out = [...lines];
  rows.forEach((row, i) => {
    const cells = row.split("\t");
    const base = out[r + i] ?? { ...emptyLine(), cost_center: out[out.length - 1]?.cost_center ?? "" };
    const next = { ...base };
    cells.forEach((v, j) => { const col = COLS[c + j]; if (col) next[col.k] = pasteValue(col, v); });
    out[r + i] = next;
  });
  return out;
}

function LineGrid({ lines, setLines }: { lines: LineDraft[]; setLines: (v: LineDraft[]) => void }) {
  const box = useRef<HTMLDivElement>(null);
  const [pasteOpen, setPasteOpen] = useState(false);
  const [pasteText, setPasteText] = useState("");
  const t = totals(lines, []);
  const pre = lines.reduce((s, l) => s + calcLine(l).pre, 0);
  const vat = lines.reduce((s, l) => s + calcLine(l).vat, 0);

  const setLine = (i: number, patch: Partial<LineDraft>) => setLines(lines.map((l, k) => (k === i ? { ...l, ...patch } : l)));
  const focus = (r: number, c: number) => setTimeout(() => box.current?.querySelector<HTMLElement>(`[data-r="${r}"][data-c="${c}"]`)?.focus(), 0);
  const addRow = () => { setLines([...lines, { ...emptyLine(), cost_center: lines[lines.length - 1]?.cost_center ?? "" }]); focus(lines.length, 0); };

  function onKey(e: KeyboardEvent<HTMLElement>, r: number, c: number) {
    if (e.key !== "Enter" || e.shiftKey) return;
    e.preventDefault();
    if (r === lines.length - 1) addRow(); else focus(r + 1, c);
  }
  function onPaste(e: ClipboardEvent<HTMLElement>, r: number, c: number) {
    const text = e.clipboardData.getData("text/plain");
    if (!/[\t\n]/.test(text.trim())) return;   // một ô: để trình duyệt dán bình thường
    e.preventDefault();
    setLines(pasteGrid(lines, text, r, c));
  }

  return (
    <>
      <div className="dn-grid-head">
        <h2 className="dn-h">Chi tiết thanh toán</h2>
        <div className="row">
          <button type="button" className="btn secondary sm" onClick={addRow}>{Icon.plus}Thêm dòng</button>
          <button type="button" className="btn ghost sm" onClick={() => { setPasteText(""); setPasteOpen(true); }}>{Icon.copy}Dán từ Excel</button>
          <span className="dn-grid-sum num">Tổng tiền VNĐ (tự cộng): <b>{vnd(t.gross)}</b></span>
        </div>
      </div>
      <div className="dn-xls" ref={box}>
        <table>
          <caption className="sr-only">Chi tiết thanh toán. Enter: xuống dòng / thêm dòng. Dán nhiều ô từ Excel được.</caption>
          <thead>
            <tr>
              <th style={{ width: 70 }}><span className="sr-only">Thao tác</span></th><th style={{ width: 36 }}>#</th>
              {COLS.map((c, j) => (
                <Fragment key={c.k}>{j === VAT_AT + 1 ? <><th className="r" style={{ width: 110 }}>Tiền VAT</th><th className="r" style={{ width: 130 }}>Tổng</th></> : null}
                  <th className={c.num ? "r" : ""} style={{ minWidth: c.w }}>{c.label}{c.req ? <span className="req"> *</span> : null}</th></Fragment>
              ))}
            </tr>
          </thead>
          <tbody>
            {lines.map((l, i) => {
              const cl = calcLine(l);
              return (
                <tr key={i}>
                  <td className="acts">
                    <button type="button" className="xls-btn no" aria-label={`Xoá dòng ${i + 1}`} title="Xoá dòng" onClick={() => setLines(lines.filter((_, k) => k !== i))}>{Icon.trash}</button>
                    <button type="button" className="xls-btn" aria-label={`Nhân bản dòng ${i + 1}`} title="Nhân bản dòng" onClick={() => { const a = [...lines]; a.splice(i + 1, 0, { ...l }); setLines(a); }}>{Icon.copy}</button>
                  </td>
                  <td className="idx num">{i + 1}</td>
                  {COLS.map((c, j) => (
                    <Fragment key={c.k}>{j === VAT_AT + 1 ? <><td className="calc r num">{fmtNum(cl.vat)}</td><td className="calc r num"><b>{fmtNum(cl.total)}</b></td></> : null}
                      <td className={l.amount && c.k === "amount" && !cl.pre ? "bad" : ""}>
                        {c.type === "vat" ? (
                          <select data-r={i} data-c={j} aria-label={`${c.label} dòng ${i + 1}`} value={l.vat_pct} onChange={(e) => setLine(i, { vat_pct: e.target.value })} onKeyDown={(e) => onKey(e, i, j)}>
                            {VAT_RATES.map((v) => <option key={v} value={v}>{v}%</option>)}
                          </select>
                        ) : (
                          <input data-r={i} data-c={j} aria-label={`${c.label} dòng ${i + 1}`} type={c.type === "date" ? "date" : "text"}
                            className={c.num ? "r num" : ""} inputMode={c.num ? "decimal" : undefined} value={l[c.k]} required={c.req}
                            onChange={(e) => setLine(i, { [c.k]: e.target.value } as Partial<LineDraft>)}
                            onBlur={c.k === "amount" ? () => { const n = parseMoney(l.amount); if (n) setLine(i, { amount: fmtNum(n) }); } : undefined}
                            onKeyDown={(e) => onKey(e, i, j)} onPaste={(e) => onPaste(e, i, j)} />
                        )}
                      </td></Fragment>
                  ))}
                </tr>
              );
            })}
            <tr className="newrow"><td colSpan={COLS.length + 4}>
              <button type="button" className="btn ghost sm" onClick={addRow}>+ Dòng mới</button>
              <span className="muted small"> Enter ở dòng cuối để thêm dòng · dán (Ctrl+V) nhiều ô từ Excel</span>
            </td></tr>
          </tbody>
          <tfoot>
            <tr>
              <td colSpan={2 + COLS.findIndex((c) => c.k === "amount")} className="r">Cộng {lines.length} dòng</td>
              <td className="r num">{fmtNum(pre)}</td><td /><td /><td className="r num">{fmtNum(vat)}</td><td className="r num"><b>{fmtNum(t.gross)}</b></td><td colSpan={2} />
            </tr>
          </tfoot>
        </table>
      </div>
      <Sheet open={pasteOpen} onClose={() => setPasteOpen(false)} title="Dán từ Excel">
        <div className="stack">
          <p className="muted small" style={{ margin: 0 }}>Trong Excel, chọn các dòng theo đúng thứ tự cột: Số serial, Số hoá đơn, Ngày hoá đơn, Tên người bán, MST, Diễn giải, Tiền trước VAT, SL, % VAT, Cost center, Vụ việc. Bấm Ctrl+C rồi dán vào ô dưới.</p>
          <textarea className="input" rows={8} value={pasteText} onChange={(e) => setPasteText(e.target.value)} placeholder="Dán vào đây (Ctrl+V)" aria-label="Dữ liệu dán từ Excel" />
          <button type="button" className="btn" disabled={!pasteText.trim()} onClick={() => {
            const keep = lines.filter((l) => l.amount.trim() || l.seller_name.trim() || l.invoice_no.trim() || l.description.trim());
            setLines(pasteGrid(keep, pasteText, keep.length, 0)); setPasteOpen(false);
          }}>Thêm vào bảng</button>
        </div>
      </Sheet>
    </>
  );
}

function AdvGrid({ advs, setAdvs }: { advs: AdvDraft[]; setAdvs: (v: AdvDraft[]) => void }) {
  const setAdv = (i: number, patch: Partial<AdvDraft>) => setAdvs(advs.map((a, k) => (k === i ? { ...a, ...patch } : a)));
  const sum = advs.reduce((s, a) => s + (parseMoney(a.amount) ?? 0), 0);
  return (
    <>
      <div className="dn-grid-head">
        <h2 className="dn-h">Chi tiết tạm ứng (trừ vào đề nghị)</h2>
        <div className="row"><button type="button" className="btn secondary sm" onClick={() => setAdvs([...advs, emptyAdv()])}>{Icon.plus}Thêm tạm ứng</button></div>
      </div>
      {advs.length ? (
        <div className="dn-xls">
          <table>
            <thead><tr><th style={{ width: 40 }}><span className="sr-only">Thao tác</span></th><th style={{ width: 36 }}>#</th><th>Diễn giải</th><th className="r" style={{ width: 180 }}>Tiền (VNĐ)<span className="req"> *</span></th></tr></thead>
            <tbody>
              {advs.map((a, i) => (
                <tr key={i}>
                  <td className="acts"><button type="button" className="xls-btn no" aria-label={`Xoá tạm ứng ${i + 1}`} onClick={() => setAdvs(advs.filter((_, k) => k !== i))}>{Icon.trash}</button></td>
                  <td className="idx num">{i + 1}</td>
                  <td><input aria-label={`Diễn giải tạm ứng ${i + 1}`} value={a.description} onChange={(e) => setAdv(i, { description: e.target.value })} placeholder="VD: Đã tạm ứng mua sơn ngày 12/11" /></td>
                  <td className={a.amount && !parseMoney(a.amount) ? "bad" : ""}><input className="r num" inputMode="decimal" aria-label={`Tiền tạm ứng ${i + 1}`} value={a.amount}
                    onChange={(e) => setAdv(i, { amount: e.target.value })} onBlur={() => { const n = parseMoney(a.amount); if (n) setAdv(i, { amount: fmtNum(n) }); }} /></td>
                </tr>
              ))}
            </tbody>
            <tfoot><tr><td colSpan={3} className="r">Cộng tạm ứng</td><td className="r num"><b>{fmtNum(sum)}</b></td></tr></tfoot>
          </table>
        </div>
      ) : <p className="muted small" style={{ margin: 0 }}>Không có tạm ứng thì bỏ qua.</p>}
    </>
  );
}
