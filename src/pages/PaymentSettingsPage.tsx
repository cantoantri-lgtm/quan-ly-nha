import { useEffect, useState, type FormEvent } from "react";
import { friendlyError, supabase } from "../lib/supabase";
import { useSession } from "../lib/session";
import { BANKS } from "../lib/vietqr";
import { vnd } from "../lib/money";
import { clock } from "../lib/dates";
import { TopBar, copyText } from "../components/ui";
import "../files.css";

const WEBHOOK_URL = `${import.meta.env.VITE_SUPABASE_URL ?? "https://nbxnupvceeyqqwrabjfc.supabase.co"}/functions/v1/sepay-webhook`;
const RESULT: Record<string, string> = { khop: "Khớp, đã thu", khong_khop: "Không tìm thấy hoá đơn", lech_so_tien: "Chuyển thiếu tiền", da_thu_truoc: "Hoá đơn đã thu trước đó" };

type Txn = { id: number; amount: number; content: string | null; txn_time: string | null; result: string; created_at: string };

/** Quản lý cài tài khoản nhận tiền thuê; xem giao dịch ngân hàng đã nhận từ SePay */
export default function PaymentSettingsPage() {
  const { toast } = useSession();
  const [bin, setBin] = useState(BANKS[0].bin);
  const [customBin, setCustomBin] = useState("");
  const [customName, setCustomName] = useState("");
  const [acct, setAcct] = useState("");
  const [holder, setHolder] = useState("");
  const [loaded, setLoaded] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [txns, setTxns] = useState<Txn[]>([]);

  useEffect(() => {
    supabase.from("payment_settings").select("*").maybeSingle().then(({ data }) => {
      if (data) {
        const known = BANKS.some((b) => b.bin === data.bank_bin);
        setBin(known ? data.bank_bin : "khac");
        if (!known) { setCustomBin(data.bank_bin); setCustomName(data.bank_name); }
        setAcct(data.account_no); setHolder(data.account_name);
      }
      setLoaded(true);
    });
    supabase.from("bank_transactions").select("id,amount,content,txn_time,result,created_at").order("created_at", { ascending: false }).limit(20)
      .then(({ data }) => setTxns((data as Txn[]) ?? []));
  }, []);

  async function save(e: FormEvent) {
    e.preventDefault(); setErr(null);
    const finalBin = bin === "khac" ? customBin.trim() : bin;
    const bankName = bin === "khac" ? customName.trim() : BANKS.find((b) => b.bin === bin)!.name;
    const acc = acct.replace(/\s/g, "");
    if (!/^\d{6}$/.test(finalBin)) { setErr("Mã BIN ngân hàng gồm 6 chữ số."); return; }
    if (!/^\d{6,19}$/.test(acc)) { setErr("Số tài khoản gồm 6–19 chữ số."); return; }
    if (!bankName) { setErr("Nhập tên ngân hàng."); return; }
    setBusy(true);
    const { error } = await supabase.from("payment_settings").upsert({ id: 1, bank_bin: finalBin, bank_name: bankName, account_no: acc, account_name: holder.trim().toUpperCase() });
    setBusy(false);
    if (error) { setErr(friendlyError(error)); return; }
    toast("Đã lưu tài khoản nhận tiền.");
  }

  return (
    <>
      <TopBar title="Thu tiền chuyển khoản" back="/quan-tri" />
      <main className="main stack">
        <form className="card stack" style={{ padding: 16 }} onSubmit={save}>
          <b>Tài khoản nhận tiền thuê phòng</b>
          <p className="muted small" style={{ margin: 0 }}>Dùng tài khoản đã liên kết với SePay. Khách quét mã QR sẽ chuyển thẳng vào tài khoản này.</p>
          {!loaded ? <div className="loading">Đang tải…</div> : (
            <>
              <label className="field"><span>Ngân hàng</span>
                <select id="p-bank" className="input" value={bin} onChange={(e) => setBin(e.target.value)}>
                  {BANKS.map((b) => <option key={b.bin} value={b.bin}>{b.name}</option>)}
                  <option value="khac">Ngân hàng khác…</option>
                </select></label>
              {bin === "khac" ? (
                <div className="row" style={{ alignItems: "flex-start" }}>
                  <label className="field" style={{ flex: "1 1 120px" }}><span>Mã BIN (6 số)</span><input id="p-bin" className="input num" inputMode="numeric" value={customBin} onChange={(e) => setCustomBin(e.target.value.replace(/\D/g, ""))} /></label>
                  <label className="field" style={{ flex: "1 1 160px" }}><span>Tên ngân hàng</span><input id="p-bname" className="input" value={customName} onChange={(e) => setCustomName(e.target.value)} /></label>
                </div>
              ) : null}
              <label className="field"><span>Số tài khoản</span><input id="p-acct" className="input num" inputMode="numeric" value={acct} onChange={(e) => setAcct(e.target.value)} required /></label>
              <label className="field"><span>Tên chủ tài khoản (không dấu)</span><input id="p-holder" className="input" value={holder} onChange={(e) => setHolder(e.target.value)} placeholder="CONG TY ..." required /></label>
              {err ? <div className="error-box" role="alert">{err}</div> : null}
              <button className="btn block" disabled={busy}>{busy ? "Đang lưu…" : "Lưu"}</button>
            </>
          )}
        </form>

        <section className="card stack" style={{ padding: 16 }}>
          <b>Nối với SePay để tự đánh dấu "đã thu"</b>
          <ol className="small" style={{ margin: 0, paddingLeft: 18, display: "grid", gap: 4 }}>
            <li>Đăng ký sepay.vn và liên kết tài khoản ngân hàng nhận tiền ở trên.</li>
            <li>Vào SePay → Tích hợp WebHooks → Thêm webhooks, dán địa chỉ bên dưới. Kiểu chứng thực chọn <b>API Key</b> và tự đặt một chuỗi khoá dài.</li>
            <li>Đặt cùng chuỗi khoá đó vào Supabase → Edge Functions → Secrets, tên <b>SEPAY_WEBHOOK_KEY</b>.</li>
            <li>Chọn gửi cả giao dịch tiền vào. Hệ thống đọc mã <b>NN…</b> trong nội dung chuyển khoản để biết hoá đơn nào.</li>
          </ol>
          <div className="row" style={{ flexWrap: "nowrap" }}>
            <code className="small" style={{ overflowWrap: "anywhere", flex: 1 }}>{WEBHOOK_URL}</code>
            <button className="btn secondary sm" onClick={async () => { await copyText(WEBHOOK_URL); toast("Đã chép địa chỉ webhook."); }}>Chép</button>
          </div>
        </section>

        <div className="section-title">Giao dịch gần đây</div>
        {txns.length === 0 ? <p className="muted small" style={{ margin: 0 }}>Chưa nhận giao dịch nào từ ngân hàng.</p> : (
          <section className="card">
            {txns.map((t) => (
              <div key={t.id} className="list-row" style={{ cursor: "default" }}>
                <div className="grow">
                  <div className="name num">{vnd(t.amount)}</div>
                  <div className="sub">{t.content ?? ""}</div>
                </div>
                <div style={{ textAlign: "right" }}>
                  <span className={`tag ${t.result === "khop" ? "st-ok" : t.result === "khong_khop" || t.result === "lech_so_tien" ? "st-late" : ""}`}>{RESULT[t.result]}</span>
                  <div className="small muted">{clock(t.txn_time ?? t.created_at)}</div>
                </div>
              </div>
            ))}
          </section>
        )}
      </main>
    </>
  );
}
