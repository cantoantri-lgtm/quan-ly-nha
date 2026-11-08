import { useEffect, useMemo, useState } from "react";
import { supabase } from "../lib/supabase";
import { useSession } from "../lib/session";
import { parseMoney, vnd } from "../lib/money";
import { plainText, type PaySettings } from "../lib/vietqr";
import PayQR from "./PayQR";

type Mode = "ca_hai" | "coc" | "thue";
const MODE_LABEL: Record<Mode, string> = { ca_hai: "Thuê + cọc", coc: "Chỉ cọc", thue: "Chỉ tiền thuê" };
const WHAT: Record<Mode, string> = { ca_hai: "Tien thue phong va tien coc", coc: "Tien coc", thue: "Tien thue phong" };
const MAX = 99; // giới hạn của trường nội dung trong mã VietQR

/** QR chuyển khoản tiền thuê / tiền cọc cho khách. Tài khoản theo toà; toà chưa cài thì dùng tài khoản chung. */
export default function ContractQR({ buildingId, tenantName, roomCode, rent, deposit }: {
  buildingId: string; tenantName: string; roomCode: string; rent: number; deposit: number;
}) {
  const { toast } = useSession();
  const [open, setOpen] = useState(false);
  const [bank, setBank] = useState<PaySettings | null | undefined>(undefined);
  const [shared, setShared] = useState(false);
  const [mode, setMode] = useState<Mode>(deposit > 0 ? "ca_hai" : "thue");
  const [custom, setCustom] = useState<string | null>(null);

  useEffect(() => {
    if (!open || bank !== undefined) return;
    (async () => {
      const own = await supabase.from("building_bank_accounts").select("bank_bin,bank_name,account_no,account_name").eq("building_id", buildingId).maybeSingle();
      if (own.data) { setBank(own.data as PaySettings); return; }
      const g = await supabase.from("payment_settings").select("bank_bin,bank_name,account_no,account_name").maybeSingle();
      setShared(!!g.data); setBank((g.data as PaySettings) ?? null);
    })();
  }, [open, bank, buildingId]);

  const base = mode === "ca_hai" ? rent + deposit : mode === "coc" ? deposit : rent;
  const amount = custom != null ? parseMoney(custom) : base;
  const content = useMemo(() => {
    const tail = `${WHAT[mode]} phong ${plainText(roomCode)} theo HD`;
    const room = Math.max(0, MAX - tail.length - 1);
    return `${plainText(tenantName).toUpperCase().slice(0, room).trim()} ${tail}`.trim();
  }, [tenantName, roomCode, mode]);

  if (!open) return <button type="button" className="btn secondary sm" onClick={() => setOpen(true)}>Tạo QR chuyển tiền</button>;
  return (
    <section className="stack cqr" style={{ borderTop: "1px solid var(--line)", paddingTop: 12 }}>
      <div className="row" style={{ justifyContent: "space-between" }}>
        <b>QR chuyển tiền cho khách</b>
        <button type="button" className="btn ghost sm" onClick={() => setOpen(false)}>Đóng</button>
      </div>
      <div className="chips" role="group" aria-label="Khoản thu">
        {(Object.keys(MODE_LABEL) as Mode[]).filter((m) => m === "thue" || deposit > 0).map((m) => (
          <button type="button" className="chip" key={m} aria-pressed={mode === m} onClick={() => { setMode(m); setCustom(null); }}>{MODE_LABEL[m]}</button>
        ))}
      </div>
      <label className="field"><span>Số tiền (sửa được nếu khách chuyển một phần)</span>
        <input id="cq-amt" className="input num" inputMode="decimal" value={custom ?? new Intl.NumberFormat("vi-VN").format(base)} onChange={(e) => setCustom(e.target.value)} /></label>
      {bank === undefined ? <div className="loading">Đang tải tài khoản…</div>
        : bank === null ? <div className="error-box" role="alert">Toà này chưa có tài khoản nhận tiền. Quản lý cài ở Quản trị → Toà nhà &amp; phòng → Sửa toà.</div>
        : amount == null || amount <= 0 ? <div className="error-box" role="alert">Nhập số tiền lớn hơn 0.</div>
        : (
          <>
            {shared ? <p className="small" style={{ margin: 0, color: "var(--today)" }}>Toà chưa cài tài khoản riêng, đang dùng tài khoản chung của công ty.</p> : null}
            <PayQR bank={bank} amount={amount} code={content} toast={toast} maxLen={MAX}
              note={`Nội dung gồm: tên khách – ${WHAT[mode].toLowerCase()} – phòng ${roomCode} – theo HĐ (không dấu). Tổng ${vnd(amount)}. Một số ngân hàng tự cắt nội dung dài — quét thử một lần trước khi gửi khách.`} />
          </>
        )}
    </section>
  );
}
