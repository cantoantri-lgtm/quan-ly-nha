import { useCallback, useEffect, useState } from "react";
import { friendlyError, supabase } from "../lib/supabase";
import { useSession } from "../lib/session";
import { parseMoney, vnd } from "../lib/money";
import type { PaySettings } from "../lib/vietqr";
import PayQR from "./PayQR";

type Bill = { id: string; pay_code: string; amount: number; status: string };
const fmt = (n: number) => new Intl.NumberFormat("vi-VN").format(Math.round(n));

/** Thu tiền cọc trong hợp đồng (SQL 101): mã KH… riêng, QR chuyển khoản tự khớp hoặc xác nhận tiền mặt.
 *  Thanh toán xong hợp đồng tự chuyển "Đã thu cọc"; tiền cọc vào cột Tiền cọc của sổ thu chi. */
export default function DepositPanel({ contractId, roomCode, deposit, onDone }: { contractId: string; roomCode: string; deposit: number; onDone: () => void }) {
  const { toast } = useSession();
  const [open, setOpen] = useState(false);
  const [bill, setBill] = useState<Bill | null>(null);
  const [bank, setBank] = useState<PaySettings | null | undefined>(undefined);
  const [amtStr, setAmtStr] = useState(fmt(deposit));
  const [busy, setBusy] = useState(false);
  const amt = parseMoney(amtStr);

  const request = useCallback(async (amount?: number) => {
    const { data, error } = await supabase.rpc("deposit_request", { p_contract: contractId, p_amount: amount ?? null });
    if (error) { toast(friendlyError(error)); return null; }
    const b = data as Bill; setBill(b); setAmtStr(fmt(Number(b.amount))); return b;
  }, [contractId, toast]);

  useEffect(() => {
    if (!open) return;
    request();
    supabase.from("payment_settings").select("bank_bin,bank_name,account_no,account_name").maybeSingle()
      .then(({ data }) => setBank((data as PaySettings) ?? null));
  }, [open, request]);

  // Khách đang chuyển khoản: kiểm tra mỗi 10 giây, tiền về thì báo xong
  useEffect(() => {
    if (!open || !bill) return;
    const t = window.setInterval(async () => {
      const { data } = await supabase.from("customer_bills").select("status").eq("id", bill.id).maybeSingle();
      if ((data as { status: string } | null)?.status === "da_thanh_toan") { toast("Đã nhận tiền cọc qua chuyển khoản."); setOpen(false); onDone(); }
    }, 10000);
    return () => window.clearInterval(t);
  }, [open, bill, onDone, toast]);

  const changed = bill != null && amt != null && Math.round(amt) !== Math.round(Number(bill.amount));
  async function updateQR() {
    if (amt == null || amt <= 0) { toast("Nhập số tiền cọc."); return; }
    setBusy(true); const b = await request(amt); setBusy(false);
    if (b) toast("Đã cập nhật số tiền và mã QR.");
  }
  async function cash() {
    if (amt == null || amt <= 0) { toast("Nhập số tiền cọc."); return; }
    if (!window.confirm(`Xác nhận đã nhận ${vnd(amt)} tiền mặt (cọc) phòng ${roomCode}?`)) return;
    setBusy(true);
    const b = changed || !bill ? await request(amt) : bill;
    if (!b) { setBusy(false); return; }
    const { error } = await supabase.rpc("cbill_set", { p_bill: b.id, p_action: "xac_nhan" });
    setBusy(false);
    if (error) { toast(friendlyError(error)); return; }
    toast(`Đã ghi nhận thu ${vnd(amt)} tiền cọc.`); setOpen(false); onDone();
  }

  if (!open) return <button type="button" className="btn sm" onClick={() => setOpen(true)}>Thu tiền cọc</button>;
  return (
    <section className="card stack" style={{ padding: 12, gap: 8, background: "var(--surface-2)", flexBasis: "100%" }} aria-label="Thu tiền cọc">
      <div className="row" style={{ justifyContent: "space-between" }}>
        <b>Thu tiền cọc phòng {roomCode}</b>
        <button type="button" className="btn ghost sm" onClick={() => setOpen(false)}>Đóng</button>
      </div>
      <label className="field"><span>Số tiền cọc (đ)</span>
        <input className="input num" inputMode="decimal" value={amtStr} onChange={(e) => setAmtStr(e.target.value)} />
        <small className="muted">Theo hợp đồng {vnd(deposit)}. Sửa nếu khách cọc số khác.</small></label>
      {changed ? <button className="btn secondary block" disabled={busy} onClick={updateQR}>Cập nhật mã QR theo {amt != null ? vnd(amt) : ""}</button> : null}
      {bill == null || bank === undefined ? <div className="loading">Đang tạo mã thu cọc…</div>
        : bank === null ? <div className="error-box">Chưa cài tài khoản nhận tiền. Quản lý vào Quản trị → Thu tiền chuyển khoản để cài.</div>
        : !changed ? <PayQR bank={bank} amount={Number(bill.amount)} code={bill.pay_code} maxLen={50} toast={toast} note="Khách chuyển đúng nội dung để app tự ghi nhận đã thu cọc." />
        : null}
      <button className="btn block" disabled={busy || amt == null || amt <= 0} onClick={cash}>{busy ? "Đang lưu…" : `Xác nhận đã thu tiền mặt${amt != null ? ` ${vnd(amt)}` : ""}`}</button>
      <small className="muted">Thu xong hợp đồng tự chuyển "Đã thu cọc". Tiền cọc ghi riêng trong sổ thu chi, không tính vào doanh thu.</small>
    </section>
  );
}
