import { vnd } from "../lib/money";
import { emptyPLine, pAmount, pTotal, type PLine, type PLineDraft } from "../lib/purchase";
import { XlsGrid, type Col } from "./TripGrids";

const fmt = (n: number) => new Intl.NumberFormat("vi-VN").format(n);
const COLS: Col<PLineDraft>[] = [
  { k: "item_name", label: "Tên hàng, dịch vụ", w: 220, req: true },
  { k: "spec", label: "Quy cách, mô tả", w: 180 },
  { k: "unit", label: "ĐVT", w: 70 },
  { k: "quantity", label: "Số lượng", w: 80, num: true, req: true },
  { k: "unit_price", label: "Đơn giá dự kiến", w: 130, type: "money", req: true },
  { k: "note", label: "Ghi chú", w: 160 },
];

/** Bảng nhập danh sách hàng cần mua kiểu Excel: Thành tiền = Số lượng × Đơn giá */
export function PurchaseGrid({ rows, setRows }: { rows: PLineDraft[]; setRows: (v: PLineDraft[]) => void }) {
  return <XlsGrid title="Danh sách hàng cần mua" rows={rows} setRows={setRows} cols={COLS} blank={emptyPLine} extraAfter="unit_price"
    extra={{ label: "Thành tiền", w: 120, render: (r) => fmt(pAmount(r)) }}
    caption="Danh sách hàng cần mua. Thành tiền = Số lượng × Đơn giá dự kiến, tự cộng."
    foot={<tr><td colSpan={7} className="r">Tổng tiền dự kiến</td><td className="r num"><b>{fmt(pTotal(rows))}</b></td><td /></tr>} />;
}

/** Bảng xem danh sách hàng (trang chi tiết, bản in) */
export function PurchaseTable({ lines }: { lines: PLine[] }) {
  if (!lines.length) return <div className="dt-empty">Chưa có danh sách hàng.</div>;
  const total = lines.reduce((s, l) => s + Number(l.amount ?? 0), 0);
  return (
    <div className="dt-wrap">
      <table className="dt">
        <thead><tr><th>#</th><th>Tên hàng, dịch vụ</th><th>Quy cách</th><th>ĐVT</th><th className="r">SL</th><th className="r">Đơn giá</th><th className="r">Thành tiền</th><th>Ghi chú</th></tr></thead>
        <tbody>
          {lines.map((l) => (
            <tr key={l.id}>
              <td className="num">{l.line_no}</td><td>{l.item_name}</td><td>{l.spec}</td><td>{l.unit}</td>
              <td className="r num">{String(l.quantity).replace(".", ",")}</td><td className="r num">{fmt(Number(l.unit_price))}</td>
              <td className="r num">{fmt(Number(l.amount))}</td><td>{l.note}</td>
            </tr>
          ))}
        </tbody>
        <tfoot><tr><td colSpan={6} className="r">Tổng tiền dự kiến</td><td className="r num"><b>{vnd(total)}</b></td><td /></tr></tfoot>
      </table>
    </div>
  );
}
