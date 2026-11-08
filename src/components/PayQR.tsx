import { useEffect, useState } from "react";
import { vietQrSvg, type PaySettings } from "../lib/vietqr";
import { vnd } from "../lib/money";
import { copyText } from "./ui";
import "../files.css";

/** Mã QR chuyển khoản đúng số tiền và đúng nội dung (nội dung = mã hoá đơn để hệ thống tự đối soát). */
export default function PayQR({ bank, amount, code, toast, maxLen, note }: { bank: PaySettings; amount: number; code: string; toast?: (m: string) => void; maxLen?: number; note?: string }) {
  const [svg, setSvg] = useState("");
  const [copied, setCopied] = useState("");
  useEffect(() => {
    vietQrSvg({ bin: bank.bank_bin, account: bank.account_no, amount, content: code, maxLen }).then(setSvg).catch(() => setSvg(""));
  }, [bank.bank_bin, bank.account_no, amount, code, maxLen]);

  const copy = async (t: string, what: string) => { await copyText(t); setCopied(`Đã chép ${what}.`); toast?.(`Đã chép ${what}.`); window.setTimeout(() => setCopied(""), 2500); };
  return (
    <div className="payqr">
      <div className="qr" dangerouslySetInnerHTML={{ __html: svg }} aria-label="Mã QR chuyển khoản" role="img" />
      <dl>
        <dt>Ngân hàng</dt><dd>{bank.bank_name}</dd>
        <dt>Số tài khoản</dt><dd>{bank.account_no} <button type="button" className="btn ghost sm" onClick={() => copy(bank.account_no, "số tài khoản")}>Chép</button></dd>
        <dt>Chủ tài khoản</dt><dd>{bank.account_name}</dd>
        <dt>Số tiền</dt><dd className="num">{vnd(amount)} <button type="button" className="btn ghost sm" onClick={() => copy(String(amount), "số tiền")}>Chép</button></dd>
        <dt>Nội dung</dt><dd>{code} <button type="button" className="btn ghost sm" onClick={() => copy(code, "nội dung")}>Chép</button></dd>
      </dl>
      <p className="small" role="status" style={{ margin: 0, minHeight: 20, color: "var(--s-done)" }}>{copied}</p>
      <p className="muted small" style={{ margin: 0 }}>{note ?? "Giữ nguyên nội dung chuyển khoản để dễ đối chiếu."}</p>
    </div>
  );
}

