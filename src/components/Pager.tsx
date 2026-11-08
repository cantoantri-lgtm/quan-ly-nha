import { useEffect, useState } from "react";

/** Phân trang phía trình duyệt: trả về dòng của trang hiện tại */
export function usePaging<T>(rows: T[], initial = 15) {
  const [page, setPage] = useState(1);
  const [size, setSize] = useState(initial);
  const pages = Math.max(1, Math.ceil(rows.length / size));
  useEffect(() => { if (page > pages) setPage(pages); }, [page, pages]);
  const slice = rows.slice((page - 1) * size, page * size);
  return { slice, page, setPage, size, setSize: (n: number) => { setSize(n); setPage(1); }, pages, total: rows.length };
}

export function Pager({ p }: { p: ReturnType<typeof usePaging> }) {
  const from = p.total ? (p.page - 1) * p.size + 1 : 0;
  const to = Math.min(p.total, p.page * p.size);
  const nums = Array.from({ length: p.pages }, (_, i) => i + 1).filter((n) => Math.abs(n - p.page) <= 2 || n === 1 || n === p.pages);
  return (
    <div className="pager">
      <div className="pg-nav">
        <button type="button" aria-label="Trang đầu" disabled={p.page === 1} onClick={() => p.setPage(1)}>«</button>
        <button type="button" aria-label="Trang trước" disabled={p.page === 1} onClick={() => p.setPage(p.page - 1)}>‹</button>
        {nums.map((n, i) => (
          <span key={n}>{i > 0 && n - nums[i - 1] > 1 ? <i className="pg-gap">…</i> : null}
            <button type="button" className={n === p.page ? "on" : ""} aria-current={n === p.page ? "page" : undefined} onClick={() => p.setPage(n)}>{n}</button></span>
        ))}
        <button type="button" aria-label="Trang sau" disabled={p.page === p.pages} onClick={() => p.setPage(p.page + 1)}>›</button>
        <button type="button" aria-label="Trang cuối" disabled={p.page === p.pages} onClick={() => p.setPage(p.pages)}>»</button>
        <select aria-label="Số dòng mỗi trang" value={p.size} onChange={(e) => p.setSize(Number(e.target.value))}>
          {[15, 30, 50, 100].map((n) => <option key={n} value={n}>{n}</option>)}
        </select>
        <span className="muted small">dòng / trang</span>
      </div>
      <span className="muted small num">{from} - {to} ({p.total} dòng)</span>
    </div>
  );
}
