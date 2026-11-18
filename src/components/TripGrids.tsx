import { Fragment, useRef, type ClipboardEvent, type KeyboardEvent } from "react";
import { parseMoney } from "../lib/money";
import { ddmmyyyy } from "../lib/dates";
import { COST_CATEGORIES, costAmount, emptyCost, emptyLeg, type CostDraft, type LegDraft, type TripCost, type TripLeg } from "../lib/trip";
import { Icon } from "./ui";
import "../office.css";

type Person = { id: string; full_name: string };
type Col<T> = { k: keyof T & string; label: string; w: number; req?: boolean; num?: boolean; type?: "date" | "staff" | "money" | "cat" };
const fmt = (n: number) => new Intl.NumberFormat("vi-VN").format(n);

function toIso(v: string) {
  const m = v.trim().match(/^(\d{1,2})[/.-](\d{1,2})[/.-](\d{4})$/);
  return m ? `${m[3]}-${m[2].padStart(2, "0")}-${m[1].padStart(2, "0")}` : /^\d{4}-\d{2}-\d{2}$/.test(v.trim()) ? v.trim() : "";
}

/** Bảng nhập kiểu Excel dùng chung: Tab sang ô, Enter xuống dòng / thêm dòng, dán nhiều ô từ Excel */
function XlsGrid<T extends Record<string, string>>({ title, rows, setRows, cols, blank, people, extra, extraAfter, foot, caption }: {
  title: string; rows: T[]; setRows: (v: T[]) => void; cols: Col<T>[]; blank: () => T; people?: Person[];
  extra?: { label: string; w: number; render: (r: T) => string }; extraAfter?: string; foot?: React.ReactNode; caption: string;
}) {
  const box = useRef<HTMLDivElement>(null);
  const set = (i: number, patch: Partial<T>) => setRows(rows.map((r, k) => (k === i ? { ...r, ...patch } : r)));
  const focus = (r: number, c: number) => setTimeout(() => box.current?.querySelector<HTMLElement>(`[data-r="${r}"][data-c="${c}"]`)?.focus(), 0);
  const add = () => { setRows([...rows, blank()]); focus(rows.length, 0); };
  function onKey(e: KeyboardEvent<HTMLElement>, r: number, c: number) {
    if (e.key !== "Enter" || e.shiftKey) return;
    e.preventDefault();
    if (r === rows.length - 1) add(); else focus(r + 1, c);
  }
  function onPaste(e: ClipboardEvent<HTMLElement>, r: number, c: number) {
    const text = e.clipboardData.getData("text/plain");
    if (!/[\t\n]/.test(text.trim())) return;
    e.preventDefault();
    const out = [...rows];
    text.replace(/\r/g, "").split("\n").filter((x) => x.trim()).forEach((line, i) => {
      const next = { ...(out[r + i] ?? blank()) } as T;
      line.split("\t").forEach((v, j) => {
        const col = cols[c + j]; if (!col) return;
        const val = col.type === "date" ? toIso(v) : col.type === "money" ? (parseMoney(v) ? fmt(parseMoney(v)!) : v.trim())
          : col.type === "staff" ? (people?.find((p) => p.full_name.toLowerCase() === v.trim().toLowerCase())?.id ?? "") : v.trim();
        (next as Record<string, string>)[col.k] = val;
      });
      out[r + i] = next;
    });
    setRows(out);
  }
  const extraAt = extraAfter ? cols.findIndex((c) => c.k === extraAfter) : -1;
  return (
    <>
      <div className="dn-grid-head">
        <h2 className="dn-h">{title}</h2>
        <div className="row"><button type="button" className="btn secondary sm" onClick={add}>{Icon.plus}Thêm dòng</button></div>
      </div>
      <div className="dn-xls" ref={box}>
        <table>
          <caption className="sr-only">{caption}</caption>
          <thead>
            <tr>
              <th style={{ width: 70 }}><span className="sr-only">Thao tác</span></th><th style={{ width: 36 }}>#</th>
              {cols.map((c, j) => (
                <Fragment key={c.k}>
                  <th className={c.num || c.type === "money" ? "r" : ""} style={{ minWidth: c.w }}>{c.label}{c.req ? <span className="req"> *</span> : null}</th>
                  {j === extraAt && extra ? <th className="r" style={{ minWidth: extra.w }}>{extra.label}</th> : null}
                </Fragment>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((row, i) => (
              <tr key={i}>
                <td className="acts">
                  <button type="button" className="xls-btn no" aria-label={`Xoá dòng ${i + 1}`} title="Xoá dòng" onClick={() => setRows(rows.filter((_, k) => k !== i))}>{Icon.trash}</button>
                  <button type="button" className="xls-btn" aria-label={`Nhân bản dòng ${i + 1}`} title="Nhân bản dòng" onClick={() => { const a = [...rows]; a.splice(i + 1, 0, { ...row }); setRows(a); }}>{Icon.copy}</button>
                </td>
                <td className="idx num">{i + 1}</td>
                {cols.map((c, j) => (
                  <Fragment key={c.k}>
                    <td className={c.type === "money" && row[c.k] && !parseMoney(row[c.k]) ? "bad" : ""}>
                      {c.type === "staff" ? (
                        <select data-r={i} data-c={j} aria-label={`${c.label} dòng ${i + 1}`} value={row[c.k]} onChange={(e) => set(i, { [c.k]: e.target.value } as Partial<T>)} onKeyDown={(e) => onKey(e, i, j)}>
                          <option value="">—</option>
                          {(people ?? []).map((p) => <option key={p.id} value={p.id}>{p.full_name}</option>)}
                        </select>
                      ) : (
                        <input data-r={i} data-c={j} aria-label={`${c.label} dòng ${i + 1}`} type={c.type === "date" ? "date" : "text"}
                          list={c.type === "cat" ? "trip-cats" : undefined} className={c.num || c.type === "money" ? "r num" : ""}
                          inputMode={c.num || c.type === "money" ? "decimal" : undefined} value={row[c.k]}
                          onChange={(e) => set(i, { [c.k]: e.target.value } as Partial<T>)}
                          onBlur={c.type === "money" ? () => { const n = parseMoney(row[c.k]); if (n) set(i, { [c.k]: fmt(n) } as Partial<T>); } : undefined}
                          onKeyDown={(e) => onKey(e, i, j)} onPaste={(e) => onPaste(e, i, j)} />
                      )}
                    </td>
                    {j === extraAt && extra ? <td className="calc r num"><b>{extra.render(row)}</b></td> : null}
                  </Fragment>
                ))}
              </tr>
            ))}
            <tr className="newrow"><td colSpan={cols.length + 2 + (extra ? 1 : 0)}>
              <button type="button" className="btn ghost sm" onClick={add}>+ Dòng mới</button>
              <span className="muted small"> Enter ở dòng cuối để thêm dòng · dán (Ctrl+V) nhiều ô từ Excel</span>
            </td></tr>
          </tbody>
          {foot ? <tfoot>{foot}</tfoot> : null}
        </table>
        <datalist id="trip-cats">{COST_CATEGORIES.map((c) => <option key={c} value={c} />)}</datalist>
      </div>
    </>
  );
}

const LEG_COLS: Col<LegDraft>[] = [
  { k: "staff_id", label: "Người đi công tác", w: 170, type: "staff" },
  { k: "start_date", label: "Từ ngày", w: 140, type: "date" },
  { k: "end_date", label: "Đến ngày", w: 140, type: "date" },
  { k: "from_place", label: "Nơi đi", w: 130 },
  { k: "to_place", label: "Nơi đến", w: 130 },
  { k: "content", label: "Nội dung", w: 220 },
  { k: "transport", label: "Phương tiện", w: 120 },
];
const LEG_COLS_ACT: Col<LegDraft>[] = [...LEG_COLS, { k: "stay_reason", label: "Lý do lưu trú", w: 150 }];
const COST_COLS: Col<CostDraft>[] = [
  { k: "category", label: "Hạng mục", w: 210, req: true, type: "cat" },
  { k: "location", label: "Địa điểm", w: 150 },
  { k: "days", label: "Số ngày", w: 80, num: true },
  { k: "persons", label: "Số người", w: 80, num: true },
  { k: "unit_price", label: "Đơn giá", w: 120, type: "money", req: true },
  { k: "note", label: "Ghi chú", w: 180 },
];

export function LegGrid({ title, rows, setRows, people, actual, defaultStaff }: { title: string; rows: LegDraft[]; setRows: (v: LegDraft[]) => void; people: Person[]; actual?: boolean; defaultStaff: string }) {
  return <XlsGrid title={title} rows={rows} setRows={setRows} cols={actual ? LEG_COLS_ACT : LEG_COLS} blank={() => emptyLeg(defaultStaff)} people={people}
    caption="Lộ trình công tác. Enter: xuống dòng hoặc thêm dòng. Dán nhiều ô từ Excel được." />;
}

export function CostGrid({ title, rows, setRows }: { title: string; rows: CostDraft[]; setRows: (v: CostDraft[]) => void }) {
  const total = rows.reduce((s, c) => s + costAmount(c), 0);
  return <XlsGrid title={title} rows={rows} setRows={setRows} cols={COST_COLS} blank={emptyCost} extraAfter="unit_price"
    extra={{ label: "Thành tiền", w: 120, render: (r) => fmt(costAmount(r)) }}
    caption="Chi phí công tác: Thành tiền = Số ngày × Số người × Đơn giá, tự cộng."
    foot={<tr><td colSpan={6} className="r">Tổng cộng</td><td /><td className="r num"><b>{fmt(total)}</b></td><td /></tr>} />;
}

/** Bảng chỉ xem */
export function LegTable({ legs, people, actual }: { legs: TripLeg[]; people: Person[]; actual?: boolean }) {
  const name = (id: string | null) => people.find((p) => p.id === id)?.full_name ?? "—";
  if (!legs.length) return <div className="dt-empty">Chưa có lộ trình.</div>;
  return (
    <div className="dt-wrap">
      <table className="dt">
        <thead><tr><th>#</th><th>Người đi</th><th>Từ ngày</th><th>Đến ngày</th><th>Nơi đi</th><th>Nơi đến</th><th>Nội dung</th><th>Phương tiện</th>{actual ? <th>Lý do lưu trú</th> : null}</tr></thead>
        <tbody>
          {legs.map((l) => (
            <tr key={l.id ?? l.line_no}>
              <td className="num">{l.line_no}</td><td>{name(l.staff_id)}</td><td className="num">{l.start_date ? ddmmyyyy(l.start_date) : ""}</td>
              <td className="num">{l.end_date ? ddmmyyyy(l.end_date) : ""}</td><td>{l.from_place}</td><td>{l.to_place}</td>
              <td><div className="clip">{l.content}</div></td><td>{l.transport}</td>{actual ? <td>{l.stay_reason}</td> : null}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export function CostTable({ costs }: { costs: TripCost[] }) {
  if (!costs.length) return <div className="dt-empty">Chưa có chi phí.</div>;
  const total = costs.reduce((s, c) => s + Number(c.amount ?? 0), 0);
  const n = (x: number) => String(x).replace(".", ",");
  return (
    <div className="dt-wrap">
      <table className="dt">
        <thead><tr><th>#</th><th>Hạng mục</th><th>Địa điểm</th><th className="r">Số ngày</th><th className="r">Số người</th><th className="r">Đơn giá</th><th className="r">Thành tiền</th><th>Ghi chú</th></tr></thead>
        <tbody>
          {costs.map((c) => (
            <tr key={c.id ?? c.line_no}>
              <td className="num">{c.line_no}</td><td>{c.category}</td><td>{c.location}</td><td className="r">{n(c.days)}</td><td className="r">{n(c.persons)}</td>
              <td className="r">{fmt(c.unit_price)}</td><td className="r"><b>{fmt(Number(c.amount ?? 0))}</b></td><td>{c.note}</td>
            </tr>
          ))}
        </tbody>
        <tfoot><tr><td colSpan={6} style={{ textAlign: "right" }}>Tổng cộng</td><td className="r num">{fmt(total)}</td><td /></tr></tfoot>
      </table>
    </div>
  );
}
