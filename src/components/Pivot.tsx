import { useMemo, useState, type ReactNode } from "react";
import { naturalCompare } from "../lib/money";

/** Một cấp của bảng pivot: gom dòng theo key, hiện label. */
export type Dim<F> = { id: string; title: string; key: (f: F) => string; label: (f: F) => string };

type Node<A> = { path: string; key: string; label: string; agg: A; level: number; children: Node<A>[] };

/** Bảng pivot bấm mở xuống từng cấp (như Pivot Table của Excel).
 *  facts: số liệu ở mức chi tiết nhất; dims: các cấp từ ngoài vào trong; zero/add: cách cộng dồn. */
export default function Pivot<F, A>({ facts, dims, zero, add, head, cells, order, total, totalLabel = "Cộng" }: {
  facts: F[];
  dims: Dim<F>[];
  zero: () => A;
  add: (a: A, f: F) => void;
  head: ReactNode;                                  // các ô <th> sau cột đầu
  cells: (a: A, dim: Dim<F>) => ReactNode;          // các ô <td> sau cột đầu cho một dòng
  order?: (a: A) => number;                         // sắp cấp ngoài cùng theo số (lớn trước); không có thì theo tên
  total?: A;                                        // dòng Cộng (tính riêng, tránh cộng trùng)
  totalLabel?: string;
}) {
  const roots = useMemo(() => {
    const build = (list: F[], level: number, parent: string): Node<A>[] => {
      const d = dims[level];
      const m = new Map<string, { label: string; items: F[] }>();
      for (const f of list) {
        const k = d.key(f);
        const g = m.get(k) ?? { label: d.label(f), items: [] };
        g.items.push(f); m.set(k, g);
      }
      const nodes = [...m.entries()].map(([key, g]) => {
        const agg = zero();
        g.items.forEach((f) => add(agg, f));
        const path = `${parent}/${d.id}:${key}`;
        return { path, key, label: g.label, agg, level, children: level + 1 < dims.length ? build(g.items, level + 1, path) : [] };
      });
      const last = (n: Node<A>) => (/^(none|khong_toa)$/.test(n.key) ? 1 : 0);   // "Chưa gán…", "Không gắn toà" xuống cuối
      nodes.sort((a, b) => last(a) - last(b) || (level === 0 && order ? order(b.agg) - order(a.agg) : 0) || naturalCompare(a.label, b.label));
      return nodes;
    };
    return build(facts, 0, "");
  }, [facts, dims, zero, add, order]);

  const [open, setOpen] = useState<Set<string>>(() => new Set());
  const toggle = (p: string) => setOpen((s) => { const n = new Set(s); if (n.has(p)) n.delete(p); else n.add(p); return n; });
  const allPaths = (level: number) => {
    const out: string[] = [];
    const walk = (ns: Node<A>[]) => ns.forEach((n) => { if (n.children.length && n.level < level) { out.push(n.path); walk(n.children); } });
    walk(roots);
    return out;
  };
  const rows: Node<A>[] = [];
  const walk = (ns: Node<A>[]) => ns.forEach((n) => { rows.push(n); if (open.has(n.path)) walk(n.children); });
  walk(roots);

  return (
    <>
      {dims.length > 1 ? (
        <div className="pv-tools">
          <span className="muted small">Mở xuống:</span>
          {dims.slice(1).map((d, i) => (
            <button key={d.id} type="button" className="btn ghost sm" onClick={() => setOpen(new Set(allPaths(i + 1)))}>{d.title}</button>
          ))}
          <button type="button" className="btn ghost sm" onClick={() => setOpen(new Set())} disabled={!open.size}>Thu gọn</button>
        </div>
      ) : null}
      <div className="rpt-wrap"><table className="rpt pv">
        <thead><tr><th>{dims.map((d) => d.title).join(" › ")}</th>{head}</tr></thead>
        <tbody>{rows.map((n) => {
          const can = n.children.length > 0, isOpen = open.has(n.path);
          return (
            <tr key={n.path} className={`pv-row pv-l${Math.min(n.level, 3)}`}>
              <td>
                <button type="button" className="pv-cell" style={{ paddingLeft: n.level * 14 }} disabled={!can}
                  aria-expanded={can ? isOpen : undefined} onClick={() => toggle(n.path)}>
                  <span className="pv-caret" aria-hidden="true">{can ? (isOpen ? "▾" : "▸") : ""}</span>
                  <span>{n.label}{can && !isOpen ? <small className="muted"> ({n.children.length})</small> : null}</span>
                </button>
              </td>
              {cells(n.agg, dims[n.level])}
            </tr>
          );
        })}</tbody>
        {total ? <tfoot><tr><td>{totalLabel}</td>{cells(total, dims[0])}</tr></tfoot> : null}
      </table></div>
    </>
  );
}

/** Gắn sale / leader sale của toà vào từng dòng số liệu. Toà nhiều sale → dòng được nhân lên cho mỗi sale. */
export type SaleMap = { building_id: string; sale_key: string; sale_name: string; lead_key: string; lead_name: string };
export type WithSale<F> = F & { sale_key: string; sale_name: string; lead_key: string; lead_name: string };
export function withSales<F extends { building_id: string | null }>(facts: F[], map: SaleMap[]): WithSale<F>[] {
  const by = new Map<string, SaleMap[]>();
  map.forEach((m) => { const l = by.get(m.building_id) ?? []; if (!l.some((x) => x.sale_key === m.sale_key)) l.push(m); by.set(m.building_id, l); });
  const out: WithSale<F>[] = [];
  for (const f of facts) {
    const tuples = f.building_id ? by.get(f.building_id) : null;
    if (!f.building_id) out.push({ ...f, sale_key: "khong_toa", sale_name: "Không gắn toà", lead_key: "khong_toa", lead_name: "Không gắn toà" });
    else if (!tuples?.length) out.push({ ...f, sale_key: "none", sale_name: "Chưa gán sale", lead_key: "none", lead_name: "Chưa gán sale" });
    else tuples.forEach((t) => out.push({ ...f, sale_key: t.sale_key, sale_name: t.sale_name, lead_key: t.lead_key, lead_name: t.lead_name }));
  }
  return out;
}
