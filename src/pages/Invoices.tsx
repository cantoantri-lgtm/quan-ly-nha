import { useCallback, useEffect, useMemo, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { friendlyError, supabase } from "../lib/supabase";
import { useSession } from "../lib/session";
import { ddmm, todayVN, type DateRange } from "../lib/dates";
import { naturalCompare, parseMoney, vnd } from "../lib/money";
import { Empty, Sheet, TopBar, copyText } from "../components/ui";
import PayQR from "../components/PayQR";
import type { PaySettings } from "../lib/vietqr";
import "../files.css";
import "../table.css";

type Invoice = {
  id: string; contract_id: string; period: string; amount: number; due_date: string; status: "chua_thu" | "da_thu" | "huy";
  collected_at: string | null; paid_via: "thu_cong" | "chuyen_khoan" | null; pay_code: string; note: string | null;
  txn_ref: string | null; txn_at: string | null;   // mã giao dịch ngân hàng do SePay gửi (SQL 084)
  transfer_note: string | null;                    // nội dung chuyển khoản không dấu (SQL 087)
  lines: InvLine[] | null; vat_amount: number | null;
  contracts: { rooms: { code: string } | null; tenants: { full_name: string; phone: string | null } | null } | null;
};
/** Một dòng hoá đơn: amount = giá đã gồm thuế; pre = tiền trước thuế; vat = tiền thuế; rate = % GTGT */
export type InvLine = { k: string; label: string; detail: string | null; amount: number; rate: number; pre: number; vat: number; by?: string; at?: string };
const room = (i: Invoice) => i.contracts?.rooms?.code ?? "?";
const monthKey = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-01`;
const monthLabel = (k: string) => `Tháng ${Number(k.slice(5, 7))}/${k.slice(0, 4)}`;
const shiftMonth = (k: string, n: number) => { const d = new Date(Number(k.slice(0, 4)), Number(k.slice(5, 7)) - 1 + n, 1); return monthKey(d); };

export function payLink(code: string) { return `${window.location.origin}/thanh-toan/${code}`; }
/** Giờ tiền về theo giờ Việt Nam, dạng 22/11 09:41 */
const fmtTime = (iso: string) => {
  const p = Object.fromEntries(new Intl.DateTimeFormat("en-GB", { timeZone: "Asia/Ho_Chi_Minh", day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit", hour12: false })
    .formatToParts(new Date(iso)).map((x) => [x.type, x.value]));
  return `${p.hour}:${p.minute} ${p.day}/${p.month}`;
};

/** Thu tiền phòng của một toà. Dùng làm trang riêng (/toa/:id/hoa-don) hoặc nhúng trong "Thu & chi toà nhà" (embedded) */
/** range (khi nhúng trong Thu & chi toà nhà): hoá đơn của các tháng nằm trong khoảng ngày, cộng hoá đơn tháng khác nhưng thu trong khoảng ngày. */
export default function Invoices({ buildingId, embedded, range }: { buildingId?: string; embedded?: boolean; range?: DateRange } = {}) {
  const params = useParams();
  const id = buildingId ?? params.id;
  const { buildings, isManager, toast } = useSession();
  const building = buildings.find((b) => b.id === id);
  const [period0, setPeriod] = useState(() => monthKey(new Date(todayVN() + "T00:00:00")));
  const period = range ? range.to.slice(0, 8) + "01" : period0;   // tháng dùng cho nút tạo hoá đơn
  const [list, setList] = useState<Invoice[]>([]);
  const [bank, setBank] = useState<PaySettings | null>(null);
  const [filter, setFilter] = useState<"" | "chua_thu" | "da_thu">("");
  const [openId, setOpenId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    let q = supabase.from("invoices")
      .select("id,contract_id,period,amount,due_date,status,collected_at,paid_via,pay_code,note,lines,vat_amount,txn_ref,txn_at,transfer_note, contracts(rooms(code), tenants(full_name,phone))")
      .eq("building_id", id!).neq("status", "huy");
    q = range
      ? q.or(`and(period.gte.${range.from.slice(0, 8)}01,period.lte.${range.to.slice(0, 8)}01),and(collected_at.gte.${range.from},collected_at.lte.${range.to})`)
      : q.eq("period", period);
    const { data } = await q;
    setList(((data as unknown as Invoice[]) ?? []).sort((a, b) => naturalCompare(room(a), room(b))));
    setLoading(false);
  }, [id, period, range?.from, range?.to]);   // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { setLoading(true); load(); }, [load]);
  useEffect(() => {
    supabase.from("payment_settings").select("bank_bin,bank_name,account_no,account_name").maybeSingle().then(({ data }) => setBank((data as PaySettings) ?? null));
  }, []);

  const sums = useMemo(() => {
    let total = 0, paid = 0;
    list.forEach((i) => { total += i.amount; if (i.status === "da_thu") paid += i.amount; });
    return { total, paid, left: total - paid, n: list.length, nPaid: list.filter((i) => i.status === "da_thu").length };
  }, [list]);
  const shown = list.filter((i) => !filter || i.status === filter);
  const opened = list.find((i) => i.id === openId) ?? null;

  async function generate() {
    setBusy(true);
    const { data, error } = await supabase.rpc("generate_monthly_invoices", { p_period: period });
    setBusy(false);
    if (error) { toast(friendlyError(error)); return; }
    toast(data ? `Đã tạo / cập nhật ${data} hoá đơn ${monthLabel(period).toLowerCase()}.` : "Không có hoá đơn nào để tạo hoặc cập nhật (hoá đơn đã thu giữ nguyên).");
    load();
  }

  if (!building) return embedded ? <Empty title="Không tìm thấy toà này" /> : (<><TopBar title="Hoá đơn" back /><main className="main"><Empty title="Không tìm thấy toà này" /></main></>);
  const Wrap = embedded ? "div" : "main";
  const today = todayVN();

  return (
    <>
      {embedded ? null : <TopBar title={`Thu tiền phòng · ${building.code}`} back={`/toa/${building.id}`} />}
      <Wrap className={embedded ? "stack" : "main stack"}>
        {range ? null : (
          <div className="row" style={{ justifyContent: "space-between", flexWrap: "nowrap" }}>
            <button className="btn ghost sm" onClick={() => setPeriod(shiftMonth(period, -1))} aria-label="Tháng trước">‹ Trước</button>
            <b>{monthLabel(period)}</b>
            <button className="btn ghost sm" onClick={() => setPeriod(shiftMonth(period, 1))} aria-label="Tháng sau">Sau ›</button>
          </div>
        )}
        <section className="room-stats" style={{ gridTemplateColumns: "repeat(3, minmax(0, 1fr))" }}>
          <div className="stat"><b className="num">{sums.nPaid}/{sums.n}</b><span>phòng đã thu</span></div>
          <div className="stat st-trong"><b className="num">{vnd(sums.paid)}</b><span>đã thu</span></div>
          <div className="stat st-dang_sua"><b className="num">{vnd(sums.left)}</b><span>còn lại</span></div>
        </section>
        <div className="chips" role="group" aria-label="Lọc hoá đơn">
          {([["", "Tất cả", sums.n], ["chua_thu", "Chưa thu", sums.n - sums.nPaid], ["da_thu", "Đã thu", sums.nPaid]] as ["" | "chua_thu" | "da_thu", string, number][])
            .map(([k, l, n]) => <button key={k} className="chip" aria-pressed={filter === k} onClick={() => setFilter(k)}>{l}<span className="n">{n}</span></button>)}
        </div>
        {isManager ? <button className="btn secondary sm" disabled={busy} onClick={generate}>{busy ? "Đang tạo…" : `Tạo / cập nhật hoá đơn ${monthLabel(period).toLowerCase()}`}</button> : null}
        {isManager ? <p className="muted small" style={{ margin: 0 }}>Hoá đơn gồm tiền phòng tháng này, điện và nước tháng trước, phí dịch vụ, phí xe. Nhập số điện phòng xong thì bấm lại nút này để cập nhật các hoá đơn chưa thu.</p> : null}

        {loading ? <div className="loading">Đang tải…</div> : shown.length === 0 ? (
          <Empty title="Chưa có hoá đơn">Hoá đơn tự tạo vào ngày 1 hằng tháng cho các hợp đồng đang hiệu lực. <Link to={`/toa/${building.id}/hop-dong`}>Xem hợp đồng</Link></Empty>
        ) : (
          <section className="card">
            {shown.map((i) => {
              const late = i.status === "chua_thu" && i.due_date < today;
              return (
                <div key={i.id} className="list-row" role="button" tabIndex={0} onClick={() => setOpenId(i.id)} onKeyDown={(e) => e.key === "Enter" && setOpenId(i.id)}>
                  <div className="grow">
                    <div className="name">Phòng {room(i)} · {i.contracts?.tenants?.full_name}</div>
                    <div className="sub">Hạn {ddmm(i.due_date)}{i.status === "da_thu" ? (i.paid_via === "chuyen_khoan" ? " · chuyển khoản" : " · thu tay") : ""}</div>
                    {i.status === "da_thu" && i.txn_ref ? <div className="sub num">Mã GD {i.txn_ref}</div> : null}
                  </div>
                  <div style={{ textAlign: "right" }}>
                    <div className="num" style={{ fontWeight: 600 }}>{vnd(i.amount)}</div>
                    <span className={`tag ${i.status === "da_thu" ? "st-ok" : late ? "st-late" : ""}`}>{i.status === "da_thu" ? "Đã thu" : late ? "Quá hạn" : "Chưa thu"}</span>
                  </div>
                </div>
              );
            })}
          </section>
        )}
      </Wrap>
      {opened ? <InvoiceSheet inv={opened} bank={bank} canUndo={isManager} onClose={() => setOpenId(null)} onChanged={load} /> : null}
    </>
  );
}

const fmtAmt = (n: number) => new Intl.NumberFormat("vi-VN").format(Math.round(n));

function InvoiceSheet({ inv, bank, canUndo, onClose, onChanged }: { inv: Invoice; bank: PaySettings | null; canUndo: boolean; onClose: () => void; onChanged: () => void }) {
  const { toast } = useSession();
  const [busy, setBusy] = useState(false);
  const [confirm, setConfirm] = useState(false);
  // Form thu tiền: sửa số tiền phải thu khi app tính sai (SQL 100 invoice_adjust)
  const [collect, setCollect] = useState(false);
  const [amtStr, setAmtStr] = useState(() => fmtAmt(inv.amount));
  const [reason, setReason] = useState("");
  const autoTotal = (inv.lines ?? []).filter((l) => l.k !== "dieu_chinh").reduce((t, l) => t + Number(l.amount), 0);
  const hasAdj = (inv.lines ?? []).some((l) => l.k === "dieu_chinh");
  const amt = parseMoney(amtStr);
  const changed = amt != null && Math.round(amt) !== Math.round(inv.amount);
  useEffect(() => { setAmtStr(fmtAmt(inv.amount)); setReason(""); }, [inv.amount]);

  async function adjust(total: number, why: string): Promise<boolean> {
    const { error } = await supabase.rpc("invoice_adjust", { p_invoice: inv.id, p_total: total, p_reason: why });
    if (error) { toast(friendlyError(error)); return false; }
    return true;
  }
  async function updateQR() {
    if (amt == null || amt < 0) { toast("Nhập số tiền thu."); return; }
    if (changed && reason.trim().length < 5) { toast("Ghi lý do điều chỉnh (ít nhất 5 ký tự)."); return; }
    setBusy(true);
    const ok = await adjust(amt, reason.trim());
    setBusy(false);
    if (ok) { toast("Đã cập nhật số tiền, mã QR và nội dung chuyển khoản."); setCollect(false); onChanged(); }
  }
  async function resetAuto() {
    setBusy(true);
    const ok = await adjust(autoTotal, "");
    setBusy(false);
    if (ok) { toast("Đã trả về số app tính."); onChanged(); }
  }
  async function collectCash() {
    if (amt == null || amt <= 0) { toast("Nhập số tiền thu."); return; }
    if (changed && reason.trim().length < 5) { toast("Ghi lý do điều chỉnh (ít nhất 5 ký tự)."); return; }
    if (!window.confirm(`Xác nhận đã nhận ${vnd(amt)} tiền mặt phòng ${room(inv)}?`)) return;
    setBusy(true);
    if (changed && !(await adjust(amt, reason.trim()))) { setBusy(false); return; }
    const { error } = await supabase.from("invoices").update({ status: "da_thu" }).eq("id", inv.id);
    setBusy(false);
    if (error) { toast(friendlyError(error)); return; }
    toast(`Đã ghi nhận thu ${vnd(amt)} tiền mặt.`); setCollect(false); onChanged();
  }

  // Khách đang chuyển khoản: tự làm mới mỗi 10 giây để thấy "Đã thu" ngay khi tiền về
  useEffect(() => {
    if (inv.status === "da_thu") return;
    const t = window.setInterval(onChanged, 10000);
    return () => window.clearInterval(t);
  }, [inv.status, onChanged]);

  async function mark(status: "da_thu" | "chua_thu") {
    setBusy(true);
    const { error } = await supabase.from("invoices").update({ status }).eq("id", inv.id);
    setBusy(false);
    if (error) { toast(friendlyError(error)); return; }
    toast(status === "da_thu" ? "Đã ghi nhận thu tiền." : "Đã bỏ đánh dấu đã thu."); setConfirm(false); onChanged();
  }

  const link = payLink(inv.pay_code);
  return (
    <Sheet open onClose={onClose} title={`Phòng ${room(inv)} · ${inv.contracts?.tenants?.full_name ?? ""}`}>
      <div className="stack">
        <div className="row" style={{ justifyContent: "space-between" }}>
          <b className="num" style={{ fontSize: 20 }}>{vnd(inv.amount)}</b>
          {inv.status === "da_thu" ? <span className="paid-stamp">Đã thu{inv.paid_via === "chuyen_khoan" ? " · chuyển khoản" : ""}</span> : <span className="tag">Hạn {ddmm(inv.due_date)}</span>}
        </div>
        {inv.status === "da_thu" && inv.paid_via === "chuyen_khoan" && inv.txn_ref ? (
          <div className="row small" style={{ gap: 6, flexWrap: "wrap" }}>
            <span className="muted">Mã giao dịch</span><b className="num">{inv.txn_ref}</b>
            {inv.txn_at ? <span className="muted">· tiền về {fmtTime(inv.txn_at)}</span> : null}
            <button type="button" className="btn ghost sm" onClick={async () => { await copyText(inv.txn_ref!); toast("Đã chép mã giao dịch."); }}>Chép</button>
          </div>
        ) : null}
        {inv.note ? <p className="muted small" style={{ margin: 0 }}>{inv.note}</p> : null}
        {inv.lines?.length ? <InvoiceLines lines={inv.lines} /> : null}

        {inv.status !== "da_thu" ? (
          bank ? (
            <>
              <PayQR bank={bank} amount={inv.amount} code={inv.transfer_note ?? inv.pay_code} maxLen={50} toast={toast} />
              <div className="row">
                <button className="btn secondary sm" onClick={async () => { await copyText(link); toast("Đã chép link thanh toán. Dán gửi khách qua Zalo."); }}>Chép link gửi khách</button>
                {inv.contracts?.tenants?.phone ? <a className="btn ghost sm" href={`sms:${inv.contracts.tenants.phone}?body=${encodeURIComponent(`Tiền phòng ${room(inv)} ${monthLabel(inv.period)}: ${link}`)}`}>Nhắn tin</a> : null}
              </div>
            </>
          ) : <div className="error-box">Chưa cài tài khoản nhận tiền. Quản lý vào Quản trị → Thu tiền chuyển khoản để cài.</div>
        ) : null}

        {inv.status === "chua_thu" && hasAdj ? (
          <div className="row small" style={{ justifyContent: "space-between", gap: 6 }}>
            <span className="muted">App tính {vnd(autoTotal)}, đã điều chỉnh thành {vnd(inv.amount)}.</span>
            <button type="button" className="btn ghost sm" disabled={busy} onClick={resetAuto}>Về số app tính</button>
          </div>
        ) : null}
        {inv.status === "chua_thu" ? (
          collect ? (
            <div className="card stack" style={{ padding: 12, gap: 8, background: "var(--surface-2)" }}>
              <b>Thu tiền phòng {room(inv)}</b>
              <label className="field"><span>Số tiền thu (đ)</span>
                <input className="input num" inputMode="decimal" value={amtStr} onChange={(e) => setAmtStr(e.target.value)} autoFocus />
                <small className="muted">{inv.lines?.length ? `App tính ${vnd(autoTotal)}${hasAdj ? `, hoá đơn đang là ${vnd(inv.amount)}` : ""}. ` : ""}Sửa nếu app tính sai.</small></label>
              {changed ? (
                <label className="field"><span>Lý do điều chỉnh *</span>
                  <input className="input" maxLength={110} value={reason} onChange={(e) => setReason(e.target.value)} placeholder="VD: Đồng hồ điện chạy sai, giảm theo thoả thuận" />
                  <small className="muted">{amt != null ? `${amt > inv.amount ? "Tăng" : "Giảm"} ${vnd(Math.abs(amt - inv.amount))}. Kế toán và Quản lý nhận thông báo.` : ""}</small></label>
              ) : null}
              {changed && bank ? (
                <button className="btn secondary block" disabled={busy} onClick={updateQR}>Cập nhật mã QR chuyển khoản theo {amt != null ? vnd(amt) : ""}</button>
              ) : null}
              <button className="btn block" disabled={busy || amt == null || amt <= 0} onClick={collectCash}>{busy ? "Đang lưu…" : `Xác nhận đã thu tiền mặt${amt != null ? ` ${vnd(amt)}` : ""}`}</button>
              <button type="button" className="btn ghost sm" onClick={() => { setCollect(false); setAmtStr(fmtAmt(inv.amount)); setReason(""); }}>Huỷ</button>
            </div>
          ) : (
            <button className="btn block" disabled={busy} onClick={() => setCollect(true)}>Thu tiền mặt / điều chỉnh số tiền</button>
          )
        ) : canUndo ? (
          confirm ? (
            <div className="row">
              <span className="small" style={{ flex: 1 }}>Bỏ đánh dấu đã thu?</span>
              <button className="btn secondary sm" onClick={() => setConfirm(false)}>Giữ nguyên</button>
              <button className="btn danger sm" disabled={busy} onClick={() => mark("chua_thu")}>Bỏ đánh dấu</button>
            </div>
          ) : <button className="btn ghost" onClick={() => setConfirm(true)}>Bỏ đánh dấu đã thu</button>
        ) : null}
      </div>
    </Sheet>
  );
}

/** Bảng các dòng hoá đơn: giá đã gồm thuế, tách tiền trước thuế và thuế GTGT theo từng dòng */
export function InvoiceLines({ lines }: { lines: InvLine[] }) {
  const pre = lines.reduce((t, l) => t + Number(l.pre), 0), vat = lines.reduce((t, l) => t + Number(l.vat), 0), all = lines.reduce((t, l) => t + Number(l.amount), 0);
  return (
    <div className="dt-wrap">
      <table className="dt inv-lines">
        <thead><tr><th>Khoản</th><th className="r">Trước thuế</th><th className="r">GTGT</th><th className="r">Thành tiền</th></tr></thead>
        <tbody>
          {lines.map((l, i) => (
            <tr key={i}>
              <td>{l.label}{l.detail ? <div className="t2">{l.detail}</div> : null}{l.k === "dieu_chinh" && (l.by || l.at) ? <div className="t2">{[l.by, l.at].filter(Boolean).join(" · ")}</div> : null}</td>
              <td className="r num">{vnd(l.pre)}</td>
              <td className="r num">{l.k === "dieu_chinh" ? "—" : <>{vnd(l.vat)}<div className="t2">{l.rate}%</div></>}</td>
              <td className="r num"><b>{vnd(l.amount)}</b></td>
            </tr>
          ))}
        </tbody>
        <tfoot><tr><td>Cộng</td><td className="r num">{vnd(pre)}</td><td className="r num">{vnd(vat)}</td><td className="r num"><b>{vnd(all)}</b></td></tr></tfoot>
      </table>
    </div>
  );
}
