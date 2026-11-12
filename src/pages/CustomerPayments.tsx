import { useCallback, useEffect, useState, type FormEvent } from "react";
import { supabase } from "../lib/supabase";
import { useSession } from "../lib/session";
import { todayVN } from "../lib/dates";
import { parseMoney, vnd } from "../lib/money";
import { Empty, Sheet, TopBar } from "../components/ui";
import PayQR from "../components/PayQR";
import type { PaySettings } from "../lib/vietqr";
import "../feedback.css";

type Kind = "tien_phong" | "dien" | "nuoc" | "phi_dich_vu" | "tien_coc" | "phieu_thu";
type Status = "chua_thanh_toan" | "cho_xac_nhan" | "da_thanh_toan" | "huy";
type Bill = {
  id: string; customer_id: string; kind: Kind; period: string | null; amount: number; due_date: string | null;
  status: Status; pay_code: string; note: string | null; reported_at: string | null; reported_note: string | null;
  confirmed_at: string | null; created_at: string; lines: { label: string; amount: number; detail?: string }[] | null; building_id: string | null; room_id: string | null;
  customer?: { full_name: string; phone: string | null } | null;
};
const KIND: Record<Kind, string> = { tien_phong: "Tiền phòng", dien: "Tiền điện", nuoc: "Tiền nước", phi_dich_vu: "Phí dịch vụ", tien_coc: "Tiền cọc", phieu_thu: "Phiếu thu tháng" };
const STATUS: Record<Status, string> = { chua_thanh_toan: "Chưa thanh toán", cho_xac_nhan: "Chờ xác nhận", da_thanh_toan: "Đã thanh toán", huy: "Đã huỷ" };
const monthLabel = (p: string | null) => (p ? `T${p.slice(5, 7)}/${p.slice(0, 4)}` : "");
const dmy = (d: string | null) => (d ? d.slice(8, 10) + "/" + d.slice(5, 7) : "");

function useBank() {
  const [bank, setBank] = useState<PaySettings | null>(null);
  useEffect(() => { supabase.rpc("customer_pay_info").then(({ data }) => setBank(((data as PaySettings[]) ?? [])[0] ?? null)); }, []);
  return bank;
}

function BillRow({ b, onClick, who }: { b: Bill; onClick: () => void; who?: boolean }) {
  const late = b.status === "chua_thanh_toan" && b.due_date && b.due_date < todayVN();
  return (
    <button className="card" style={{ textAlign: "left", width: "100%" }} onClick={onClick}>
      <div className="row" style={{ justifyContent: "space-between", flexWrap: "nowrap" }}>
        <b>{KIND[b.kind]} {monthLabel(b.period)}</b>
        <b className="num">{vnd(b.amount)}</b>
      </div>
      <div className="muted small">
        {who && b.customer ? b.customer.full_name + " · " : ""}{STATUS[b.status]}
        {b.due_date ? ` · hạn ${dmy(b.due_date)}` : ""}{late ? " · quá hạn" : ""}
      </div>
    </button>
  );
}

/** Khách: xem khoản phải trả và chuyển khoản TPBank */
export function MyPayments() {
  const { toast } = useSession();
  const bank = useBank();
  const [rows, setRows] = useState<Bill[] | null>(null);
  const [sel, setSel] = useState<Bill | null>(null);
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const load = useCallback(async () => {
    const { data } = await supabase.from("customer_bills").select("*").neq("status", "huy").order("created_at", { ascending: false });
    setRows((data as Bill[]) ?? []);
  }, []);
  useEffect(() => { load(); }, [load]);

  async function report() {
    if (!sel) return;
    setBusy(true);
    const { error } = await supabase.rpc("cbill_report_paid", { p_bill: sel.id, p_note: note });
    setBusy(false);
    if (error) { toast(error.message); return; }
    toast("Đã báo cho công ty. Công ty sẽ xác nhận khi nhận được tiền."); setSel(null); setNote(""); load();
  }
  const open = (rows ?? []).filter((b) => b.status !== "da_thanh_toan");
  const done = (rows ?? []).filter((b) => b.status === "da_thanh_toan");
  return (
    <>
      <TopBar title="Thanh toán" />
      <main className="main stack">
        {rows === null ? <div className="loading">Đang tải…</div> : rows.length === 0 ? <Empty title="Chưa có khoản nào cần thanh toán." /> : (
          <>
            {open.length ? <h2 className="small muted" style={{ margin: 0 }}>Cần thanh toán</h2> : null}
            {open.map((b) => <BillRow key={b.id} b={b} onClick={() => setSel(b)} />)}
            {done.length ? <h2 className="small muted" style={{ margin: "8px 0 0" }}>Đã thanh toán</h2> : null}
            {done.map((b) => <BillRow key={b.id} b={b} onClick={() => setSel(b)} />)}
          </>
        )}
      </main>
      <Sheet open={!!sel} onClose={() => setSel(null)} title={sel ? `${KIND[sel.kind]} ${monthLabel(sel.period)}` : ""}>
        {sel ? (
          <div className="stack">
            <p style={{ margin: 0 }}><b className="num">{vnd(sel.amount)}</b> · {STATUS[sel.status]}{sel.due_date ? ` · hạn ${dmy(sel.due_date)}` : ""}</p>
            {sel.lines?.length ? (
              <div className="card" style={{ padding: 12 }}>
                {sel.lines.map((l, i) => (
                  <div key={i} style={{ marginBottom: 6 }}>
                    <div className="row" style={{ justifyContent: "space-between", flexWrap: "nowrap" }}><span>{l.label}</span><b className="num">{vnd(l.amount)}</b></div>
                    {l.detail ? <div className="muted small">{l.detail}</div> : null}
                  </div>
                ))}
              </div>
            ) : null}
            {sel.note ? <p className="muted small" style={{ margin: 0 }}>{sel.note}</p> : null}
            {sel.status === "chua_thanh_toan" && bank ? (
              <>
                <PayQR bank={bank} amount={sel.amount} code={sel.pay_code} toast={toast} note="Quét QR bằng app ngân hàng và giữ nguyên nội dung chuyển khoản." />
                <label className="field"><span>Ghi chú cho công ty (không bắt buộc)</span>
                  <input className="input" value={note} maxLength={300} onChange={(e) => setNote(e.target.value)} /></label>
                <button className="btn block" disabled={busy} onClick={report}>{busy ? "Đang gửi…" : "Tôi đã chuyển khoản"}</button>
              </>
            ) : null}
            {sel.status === "cho_xac_nhan" ? <p className="muted small" style={{ margin: 0 }}>Đã báo chuyển khoản. Đang chờ công ty xác nhận.</p> : null}
            {sel.status === "da_thanh_toan" ? <p className="small" style={{ margin: 0, color: "var(--s-done)" }}>Công ty đã nhận tiền. Cảm ơn bạn.</p> : null}
          </div>
        ) : null}
      </Sheet>
    </>
  );
}

type Cust = { id: string; full_name: string; building_code: string | null; room_code: string | null };

/** Nhân sự: tạo khoản thu, xác nhận đã nhận tiền */
export function StaffPayments() {
  const { toast, isManager } = useSession();
  const bank = useBank();
  const [rows, setRows] = useState<Bill[] | null>(null);
  const [filter, setFilter] = useState<Status | "all">("cho_xac_nhan");
  const [sel, setSel] = useState<Bill | null>(null);
  const [creating, setCreating] = useState(false);
  const [editing, setEditing] = useState(false);
  const load = useCallback(async () => {
    const { data } = await supabase.from("customer_bills").select("*").order("created_at", { ascending: false }).limit(300);
    const bills = (data as Bill[]) ?? [];
    const ids = [...new Set(bills.map((b) => b.customer_id))];
    const { data: ps } = ids.length ? await supabase.from("profiles").select("id,full_name,phone").in("id", ids) : { data: [] };
    const m = new Map(((ps as { id: string; full_name: string; phone: string | null }[]) ?? []).map((p) => [p.id, p]));
    setRows(bills.map((b) => ({ ...b, customer: m.get(b.customer_id) ?? null })));
  }, []);
  useEffect(() => { load(); }, [load]);

  async function act(b: Bill, a: "xac_nhan" | "tu_choi" | "huy") {
    const { error } = await supabase.rpc("cbill_set", { p_bill: b.id, p_action: a });
    if (error) { toast(error.message); return; }
    toast(a === "xac_nhan" ? "Đã xác nhận nhận tiền." : a === "tu_choi" ? "Đã trả về chưa thanh toán." : "Đã huỷ khoản."); setSel(null); load();
  }
  const list = (rows ?? []).filter((b) => filter === "all" ? true : b.status === filter);
  const waiting = (rows ?? []).filter((b) => b.status === "cho_xac_nhan").length;
  return (
    <>
      <TopBar title="Thu tiền khách" action={<button className="btn sm" onClick={() => setCreating(true)}>+ Khoản thu</button>} />
      <main className="main stack">
        <div className="row" style={{ gap: 6 }}>
          {(["cho_xac_nhan", "chua_thanh_toan", "da_thanh_toan", "all"] as const).map((s) => (
            <button key={s} className={"btn sm " + (filter === s ? "" : "secondary")} onClick={() => setFilter(s)}>
              {s === "all" ? "Tất cả" : STATUS[s]}{s === "cho_xac_nhan" && waiting ? ` (${waiting})` : ""}
            </button>
          ))}
        </div>
        {bank ? <p className="muted small" style={{ margin: 0 }}>Khách chuyển tới: {bank.bank_name} {bank.account_no} · {bank.account_name}
          {isManager ? <> · <button className="btn ghost sm" onClick={() => setEditing(true)}>Sửa</button></> : null}</p> : null}
        {rows === null ? <div className="loading">Đang tải…</div> : list.length === 0 ? <Empty title="Không có khoản nào." />
          : list.map((b) => <BillRow key={b.id} b={b} who onClick={() => setSel(b)} />)}
      </main>
      <Sheet open={!!sel} onClose={() => setSel(null)} title={sel ? `${KIND[sel.kind]} ${monthLabel(sel.period)}` : ""}>
        {sel ? (
          <div className="stack">
            <p style={{ margin: 0 }}>{sel.customer?.full_name} · {sel.customer?.phone}</p>
            <p style={{ margin: 0 }}><b className="num">{vnd(sel.amount)}</b> · {STATUS[sel.status]}</p>
            <p className="muted small" style={{ margin: 0 }}>Nội dung chuyển khoản: <b>{sel.pay_code}</b>{sel.due_date ? ` · hạn ${dmy(sel.due_date)}` : ""}</p>
            {sel.note ? <p className="muted small" style={{ margin: 0 }}>Ghi chú: {sel.note}</p> : null}
            {sel.lines?.length ? (
              <div className="card" style={{ padding: 12 }}>
                {sel.lines.map((l, i) => (
                  <div key={i} style={{ marginBottom: 6 }}>
                    <div className="row" style={{ justifyContent: "space-between", flexWrap: "nowrap" }}><span>{l.label}</span><b className="num">{vnd(l.amount)}</b></div>
                    {l.detail ? <div className="muted small">{l.detail}</div> : null}
                  </div>
                ))}
              </div>
            ) : null}
            {sel.status === "chua_thanh_toan" && bank ? <PayQR bank={bank} amount={sel.amount} code={sel.pay_code} toast={toast} note="Đưa mã này cho khách quét nếu khách chưa mở app." /> : null}
            {sel.reported_note ? <p className="small" style={{ margin: 0 }}>Khách ghi: {sel.reported_note}</p> : null}
            {sel.status === "chua_thanh_toan" || sel.status === "cho_xac_nhan" ? (
              <button className="btn block" onClick={() => act(sel, "xac_nhan")}>Đã nhận tiền</button>) : null}
            {sel.status === "cho_xac_nhan" ? <button className="btn secondary block" onClick={() => act(sel, "tu_choi")}>Chưa thấy tiền</button> : null}
            {sel.status !== "da_thanh_toan" && sel.status !== "huy" ? <button className="btn ghost block" onClick={() => act(sel, "huy")}>Huỷ khoản này</button> : null}
          </div>
        ) : null}
      </Sheet>
      <CreateBill open={creating} onClose={() => setCreating(false)} onDone={() => { setCreating(false); load(); }} />
      <BankSheet open={editing} onClose={() => setEditing(false)} />
    </>
  );
}

function CreateBill({ open, onClose, onDone }: { open: boolean; onClose: () => void; onDone: () => void }) {
  const { toast } = useSession();
  const [custs, setCusts] = useState<Cust[]>([]);
  const [cid, setCid] = useState("");
  const [kind, setKind] = useState<Kind>("tien_phong");
  const [month, setMonth] = useState(todayVN().slice(0, 7));
  const [amount, setAmount] = useState("");
  const [due, setDue] = useState("");
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    if (!open) return;
    supabase.rpc("customers_list").then(({ data }) => setCusts(((data as Cust[]) ?? [])));
  }, [open]);
  async function submit(e: FormEvent) {
    e.preventDefault();
    const amt = parseMoney(amount);
    if (!cid) { toast("Chọn khách hàng."); return; }
    if (!amt || amt <= 0) { toast("Nhập số tiền hợp lệ."); return; }
    setBusy(true);
    const { error } = await supabase.rpc("cbill_create", {
      p_customer: cid, p_kind: kind, p_period: kind === "tien_coc" ? null : month + "-01", p_amount: amt, p_due: due || null, p_note: note,
    });
    setBusy(false);
    if (error) { toast(error.message); return; }
    toast("Đã tạo khoản thu, khách nhận được thông báo."); setAmount(""); setNote(""); onDone();
  }
  return (
    <Sheet open={open} onClose={onClose} title="Tạo khoản thu cho khách">
      <form className="stack" onSubmit={submit}>
        <label className="field"><span>Khách hàng *</span>
          <select className="input" value={cid} onChange={(e) => setCid(e.target.value)} required>
            <option value="">Chọn khách…</option>
            {custs.map((c) => <option key={c.id} value={c.id}>{c.full_name}{c.room_code ? ` · ${c.building_code} P.${c.room_code}` : ""}</option>)}
          </select></label>
        <label className="field"><span>Loại khoản *</span>
          <select className="input" value={kind} onChange={(e) => setKind(e.target.value as Kind)}>
            {(Object.keys(KIND) as Kind[]).map((k) => <option key={k} value={k}>{KIND[k]}</option>)}
          </select></label>
        {kind !== "tien_coc" ? <label className="field"><span>Tháng</span><input className="input" type="month" value={month} onChange={(e) => setMonth(e.target.value)} /></label> : null}
        <label className="field"><span>Số tiền * (vd 6tr, 450k, 1.250.000)</span><input className="input" inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} required /></label>
        <label className="field"><span>Hạn thanh toán</span><input className="input" type="date" value={due} onChange={(e) => setDue(e.target.value)} /></label>
        <label className="field"><span>Ghi chú (vd: số điện 120 kWh)</span><input className="input" value={note} onChange={(e) => setNote(e.target.value)} /></label>
        <button className="btn block" disabled={busy}>{busy ? "Đang tạo…" : "Tạo khoản thu"}</button>
      </form>
    </Sheet>
  );
}

function BankSheet({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { toast } = useSession();
  const [name, setName] = useState("");
  useEffect(() => { if (open) supabase.rpc("customer_pay_info").then(({ data }) => setName(((data as PaySettings[]) ?? [])[0]?.account_name ?? "")); }, [open]);
  async function save() {
    const { error } = await supabase.from("customer_pay_account").update({ account_name: name.trim().toUpperCase(), updated_at: new Date().toISOString() }).eq("id", 1);
    if (error) { toast(error.message); return; }
    toast("Đã lưu tên chủ tài khoản."); onClose();
  }
  return (
    <Sheet open={open} onClose={onClose} title="Tên chủ tài khoản TPBank">
      <div className="stack">
        <label className="field"><span>Tên chủ tài khoản (in hoa, không dấu)</span><input className="input" value={name} onChange={(e) => setName(e.target.value)} /></label>
        <button className="btn block" disabled={!name.trim()} onClick={save}>Lưu</button>
      </div>
    </Sheet>
  );
}
