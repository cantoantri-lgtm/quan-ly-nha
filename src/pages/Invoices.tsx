import { useCallback, useEffect, useMemo, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { friendlyError, supabase } from "../lib/supabase";
import { useSession } from "../lib/session";
import { ddmm, todayVN } from "../lib/dates";
import { naturalCompare, vnd } from "../lib/money";
import { Empty, Sheet, TopBar, copyText } from "../components/ui";
import PayQR from "../components/PayQR";
import type { PaySettings } from "../lib/vietqr";
import "../files.css";

type Invoice = {
  id: string; contract_id: string; period: string; amount: number; due_date: string; status: "chua_thu" | "da_thu" | "huy";
  collected_at: string | null; paid_via: "thu_cong" | "chuyen_khoan" | null; pay_code: string; note: string | null;
  contracts: { rooms: { code: string } | null; tenants: { full_name: string; phone: string | null } | null } | null;
};
const room = (i: Invoice) => i.contracts?.rooms?.code ?? "?";
const monthKey = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-01`;
const monthLabel = (k: string) => `Tháng ${Number(k.slice(5, 7))}/${k.slice(0, 4)}`;
const shiftMonth = (k: string, n: number) => { const d = new Date(Number(k.slice(0, 4)), Number(k.slice(5, 7)) - 1 + n, 1); return monthKey(d); };

export function payLink(code: string) { return `${window.location.origin}/thanh-toan/${code}`; }

export default function Invoices() {
  const { id } = useParams();
  const { buildings, isManager, toast } = useSession();
  const building = buildings.find((b) => b.id === id);
  const [period, setPeriod] = useState(() => monthKey(new Date(todayVN() + "T00:00:00")));
  const [list, setList] = useState<Invoice[]>([]);
  const [bank, setBank] = useState<PaySettings | null>(null);
  const [filter, setFilter] = useState<"" | "chua_thu" | "da_thu">("");
  const [openId, setOpenId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    const { data } = await supabase.from("invoices")
      .select("id,contract_id,period,amount,due_date,status,collected_at,paid_via,pay_code,note, contracts(rooms(code), tenants(full_name,phone))")
      .eq("building_id", id!).eq("period", period).neq("status", "huy");
    setList(((data as unknown as Invoice[]) ?? []).sort((a, b) => naturalCompare(room(a), room(b))));
    setLoading(false);
  }, [id, period]);
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
    toast(data ? `Đã tạo ${data} hoá đơn cho ${monthLabel(period).toLowerCase()}.` : "Không có hoá đơn mới (đã đủ hoặc chưa có hợp đồng).");
    load();
  }

  if (!building) return (<><TopBar title="Hoá đơn" back /><main className="main"><Empty title="Không tìm thấy toà này" /></main></>);
  const today = todayVN();

  return (
    <>
      <TopBar title={`Thu tiền phòng · ${building.code}`} back={`/toa/${building.id}`} />
      <main className="main stack">
        <div className="row" style={{ justifyContent: "space-between", flexWrap: "nowrap" }}>
          <button className="btn ghost sm" onClick={() => setPeriod(shiftMonth(period, -1))} aria-label="Tháng trước">‹ Trước</button>
          <b>{monthLabel(period)}</b>
          <button className="btn ghost sm" onClick={() => setPeriod(shiftMonth(period, 1))} aria-label="Tháng sau">Sau ›</button>
        </div>
        <section className="room-stats" style={{ gridTemplateColumns: "repeat(3, minmax(0, 1fr))" }}>
          <div className="stat"><b className="num">{sums.nPaid}/{sums.n}</b><span>phòng đã thu</span></div>
          <div className="stat st-trong"><b className="num">{vnd(sums.paid)}</b><span>đã thu</span></div>
          <div className="stat st-dang_sua"><b className="num">{vnd(sums.left)}</b><span>còn lại</span></div>
        </section>
        <div className="chips" role="group" aria-label="Lọc hoá đơn">
          {([["", "Tất cả", sums.n], ["chua_thu", "Chưa thu", sums.n - sums.nPaid], ["da_thu", "Đã thu", sums.nPaid]] as ["" | "chua_thu" | "da_thu", string, number][])
            .map(([k, l, n]) => <button key={k} className="chip" aria-pressed={filter === k} onClick={() => setFilter(k)}>{l}<span className="n">{n}</span></button>)}
        </div>
        {isManager ? <button className="btn secondary sm" disabled={busy} onClick={generate}>{busy ? "Đang tạo…" : `Tạo hoá đơn ${monthLabel(period).toLowerCase()}`}</button> : null}

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
                    <div className="sub">Hạn {ddmm(i.due_date)}{i.paid_via === "chuyen_khoan" ? " · khách chuyển khoản" : ""}</div>
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
      </main>
      {opened ? <InvoiceSheet inv={opened} bank={bank} canUndo={isManager} onClose={() => setOpenId(null)} onChanged={load} /> : null}
    </>
  );
}

function InvoiceSheet({ inv, bank, canUndo, onClose, onChanged }: { inv: Invoice; bank: PaySettings | null; canUndo: boolean; onClose: () => void; onChanged: () => void }) {
  const { toast } = useSession();
  const [busy, setBusy] = useState(false);
  const [confirm, setConfirm] = useState(false);

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
        {inv.note ? <p className="muted small" style={{ margin: 0 }}>{inv.note}</p> : null}

        {inv.status !== "da_thu" ? (
          bank ? (
            <>
              <PayQR bank={bank} amount={inv.amount} code={inv.pay_code} toast={toast} />
              <div className="row">
                <button className="btn secondary sm" onClick={async () => { await copyText(link); toast("Đã chép link thanh toán. Dán gửi khách qua Zalo."); }}>Chép link gửi khách</button>
                {inv.contracts?.tenants?.phone ? <a className="btn ghost sm" href={`sms:${inv.contracts.tenants.phone}?body=${encodeURIComponent(`Tiền phòng ${room(inv)} ${monthLabel(inv.period)}: ${link}`)}`}>Nhắn tin</a> : null}
              </div>
            </>
          ) : <div className="error-box">Chưa cài tài khoản nhận tiền. Quản lý vào Quản trị → Thu tiền chuyển khoản để cài.</div>
        ) : null}

        {inv.status === "chua_thu" ? (
          <button className="btn block" disabled={busy} onClick={() => mark("da_thu")}>{busy ? "Đang lưu…" : "Đã nhận tiền mặt / tự đối chiếu → Đánh dấu đã thu"}</button>
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
