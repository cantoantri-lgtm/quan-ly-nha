import { useRef, useState } from "react";
import { parseMoney, vnd } from "../lib/money";
import { VAT_RATES, type ReqAdvance, type ReqLine } from "../lib/office";
import { MAX_BYTES } from "../lib/files";

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

export default function DnttEditor({ lines, setLines, advs, setAdvs, files, setFiles, links, setLinks, onError }: Props) {
  const t = totals(lines, advs);
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

      {setFiles && setLinks ? (
        <>
          <h2 className="dn-h dn-h-out">Tập tin đính kèm</h2>
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
            <label className="field"><span>Thêm link</span>
              <input className="input" inputMode="url" value={linkUrl} onChange={(e) => setLinkUrl(e.target.value)} placeholder="https://…" /></label>
            <label className="field"><span>Tên link (không bắt buộc)</span>
              <input className="input" value={linkTitle} onChange={(e) => setLinkTitle(e.target.value)} placeholder="VD: Báo giá trên Drive" /></label>
            <button type="button" className="btn secondary block" onClick={addLink}>+ Thêm link</button>
            {links?.length ? (
              <ul className="dn-list">
                {links.map((k, i) => (
                  <li key={i}><span>{k.title || k.url}</span><button type="button" className="btn ghost" onClick={() => setLinks(links.filter((_, j) => j !== i))}>Bỏ</button></li>
                ))}
              </ul>
            ) : null}
          </div>
        </>
      ) : null}
    </>
  );
}
