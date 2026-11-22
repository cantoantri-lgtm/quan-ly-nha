import { useCallback, useEffect, useMemo, useState, type FormEvent } from "react";
import { Link, useParams } from "react-router-dom";
import { friendlyError, supabase } from "../lib/supabase";
import { useSession } from "../lib/session";
import { ddmmyyyy, todayVN } from "../lib/dates";
import { parseMoney, vnd } from "../lib/money";
import { Combo, Empty, Sheet, TopBar } from "../components/ui";
import { EXP_COLS, EXPENSE_CATS, expenseOptions, PAY_SOURCE, saveExpense, SETTLE_LABEL,
  type Expense, type PaySource, type SettleStatus } from "../lib/expense";

/** Chi phí toà (trang quản lý toà): Sale / nhân sự phụ trách toà ghi khoản mình tự ứng tiền chi cho toà.
 *  Lập ĐNTT hoặc tạm ứng thì chọn các khoản này; kế toán chi xong → "Đã quyết toán" (SQL 091). */
type Filter = "all" | SettleStatus;
const FILTERS: [Filter, string][] = [["all", "Tất cả"], ["chua_quyet_toan", "Chưa quyết toán"], ["cho_quyet_toan", "Chờ quyết toán"], ["da_quyet_toan", "Đã quyết toán"]];
const ym = (iso: string) => iso.slice(0, 7);
const shiftMonth = (m: string, n: number) => { const d = new Date(Number(m.slice(0, 4)), Number(m.slice(5, 7)) - 1 + n, 1); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`; };
const COLOR: Record<SettleStatus, string> = { chua_quyet_toan: "var(--danger)", cho_quyet_toan: "var(--today)", da_quyet_toan: "var(--s-done)" };

/** Dùng làm trang riêng (/toa/:id/chi-phi) hoặc nhúng trong "Thu & chi toà nhà" (embedded) */
export default function BuildingExpenses({ buildingId, embedded }: { buildingId?: string; embedded?: boolean } = {}) {
  const params = useParams();
  const id = buildingId ?? params.id ?? "";
  const { buildings, profile, people, isManager, isAccountant, toast } = useSession();
  const payer = isManager || isAccountant;
  const b = buildings.find((x: { id: string }) => x.id === id);
  const [month, setMonth] = useState(() => ym(todayVN()));
  const [rows, setRows] = useState<Expense[] | null>(null);
  const [f, setF] = useState<Filter>("all");
  const [edit, setEdit] = useState<Expense | null | "new">(null);
  const name = (u: string | null) => (u ? people.find((p: { id: string }) => p.id === u)?.full_name ?? "—" : "Công ty");

  const load = useCallback(async () => {
    const start = `${month}-01`, end = `${shiftMonth(month, 1)}-01`;
    const { data, error } = await supabase.from("building_expenses").select(EXP_COLS).eq("building_id", id)
      .gte("spent_on", start).lt("spent_on", end).order("spent_on", { ascending: false }).order("created_at", { ascending: false });
    if (error) toast(friendlyError(error));
    setRows(((data as Expense[]) ?? []).map((e) => ({ ...e, amount: Number(e.amount) })));
  }, [id, month, toast]);
  useEffect(() => { load(); }, [load]);

  const shown = useMemo(() => (rows ?? []).filter((r) => f === "all" || r.settle_status === f), [rows, f]);
  const sum = (s?: SettleStatus) => (rows ?? []).filter((r) => !s || r.settle_status === s).reduce((t, r) => t + r.amount, 0);
  const mineOpen = (rows ?? []).filter((r) => r.paid_by === profile?.id && r.settle_status === "chua_quyet_toan");

  async function del(e: Expense) {
    if (!window.confirm(`Xoá khoản chi ${vnd(e.amount)} (${e.category})?`)) return;
    const { error } = await supabase.rpc("expense_delete", { p_id: e.id });
    if (error) toast(friendlyError(error)); else { toast("Đã xoá."); load(); }
  }

  const Wrap = embedded ? "div" : "main";
  return (
    <>
      {embedded ? null : <TopBar title={`Chi phí toà · ${b?.code ?? ""}`} back action={<button className="btn sm" onClick={() => setEdit("new")}>+ Ghi chi</button>} />}
      <Wrap className={embedded ? "stack" : "main stack"}>
        {embedded ? <button className="btn" onClick={() => setEdit("new")}>+ Ghi khoản chi</button> : null}
        <p className="muted small" style={{ margin: 0 }}>
          Ghi các khoản bạn tự ứng tiền chi cho toà (rác, sửa chữa, mua đồ…). Khi lập đề nghị thanh toán hoặc tạm ứng, chọn các khoản này để công ty hoàn tiền.
          Kế toán chi xong thì khoản chuyển sang "Đã quyết toán".
        </p>
        <div className="row" style={{ justifyContent: "space-between", flexWrap: "nowrap" }}>
          <button className="btn ghost sm" onClick={() => setMonth(shiftMonth(month, -1))}>‹ Tháng trước</button>
          <b>Tháng {month.slice(5, 7)}/{month.slice(0, 4)}</b>
          <button className="btn ghost sm" onClick={() => setMonth(shiftMonth(month, 1))}>Tháng sau ›</button>
        </div>
        <div className="rpt-kpis" style={{ display: "grid", gridTemplateColumns: "repeat(2, minmax(0,1fr))", gap: 8 }}>
          <div className="card" style={{ padding: 10 }}><b className="num">{vnd(sum())}</b><br /><small className="muted">Tổng chi tháng</small></div>
          <div className="card" style={{ padding: 10 }}><b className="num" style={{ color: sum("chua_quyet_toan") ? "var(--danger)" : undefined }}>{vnd(sum("chua_quyet_toan") + sum("cho_quyet_toan"))}</b><br /><small className="muted">Nhân viên đang ứng, chưa hoàn</small></div>
        </div>
        {mineOpen.length ? (
          <div className="card row" style={{ padding: 10, justifyContent: "space-between" }}>
            <span className="small">Bạn có {mineOpen.length} khoản chưa quyết toán, {vnd(mineOpen.reduce((t, r) => t + r.amount, 0))}.</span>
            <Link className="btn sm" to="/van-phong/moi/thanh_toan?chi=1">Lập đề nghị thanh toán</Link>
          </div>
        ) : null}
        <div className="chips" role="group" aria-label="Lọc theo quyết toán">
          {FILTERS.map(([k, t]) => <button key={k} className="chip" aria-pressed={f === k} onClick={() => setF(k)}>{t}</button>)}
        </div>
        {rows === null ? <div className="loading">Đang tải…</div> : shown.length === 0 ? <Empty title="Chưa có khoản chi nào." /> : shown.map((e) => {
          const mine = e.paid_by === profile?.id;
          const canEdit = e.settle_status === "chua_quyet_toan" && (mine || payer);
          return (
            <div key={e.id} className="card stack" style={{ padding: 12, gap: 4 }}>
              <div className="row" style={{ justifyContent: "space-between", flexWrap: "nowrap" }}>
                <b>{e.category}</b><b className="num">{vnd(e.amount)}</b>
              </div>
              <div className="small">{ddmmyyyy(e.spent_on)}{e.note ? ` · ${e.note}` : ""}</div>
              <div className="small muted">{e.pay_source === "cong_ty" ? "Công ty trả trực tiếp" : `Người ứng: ${name(e.paid_by)}`}</div>
              <div className="row small" style={{ justifyContent: "space-between" }}>
                <span style={{ color: COLOR[e.settle_status], fontWeight: 600 }}>{SETTLE_LABEL[e.settle_status]}</span>
                {e.request_id ? <Link to={`/van-phong/${e.request_id}`}>Xem đề nghị</Link> : null}
              </div>
              {e.settle_note ? <small className="muted">{e.settle_note}</small> : null}
              {canEdit ? (
                <div className="row">
                  <button className="btn ghost sm" onClick={() => setEdit(e)}>Sửa</button>
                  <button className="btn ghost sm" onClick={() => del(e)}>Xoá</button>
                </div>
              ) : null}
            </div>
          );
        })}
      </Wrap>
      <ExpenseSheet open={edit !== null} item={edit === "new" ? null : edit} buildingId={id} payer={payer}
        onClose={() => setEdit(null)} onDone={() => { setEdit(null); load(); }} />
    </>
  );
}

function ExpenseSheet({ open, item, buildingId, payer, onClose, onDone }: {
  open: boolean; item: Expense | null; buildingId: string; payer: boolean; onClose: () => void; onDone: () => void;
}) {
  const { toast } = useSession();
  const [d, setD] = useState(todayVN());
  const [cat, setCat] = useState<string>("Khác");
  const [amt, setAmt] = useState("");
  const [note, setNote] = useState("");
  const [src, setSrc] = useState<PaySource>("nhan_vien");
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    if (!open) return;
    setD(item?.spent_on ?? todayVN()); setCat(item?.category ?? "Khác"); setAmt(item ? String(item.amount) : "");
    setNote(item?.note ?? ""); setSrc(item?.pay_source ?? "nhan_vien");
  }, [open, item]);
  async function submit(e: FormEvent) {
    e.preventDefault();
    const a = parseMoney(amt);
    if (!a || a <= 0) { toast("Nhập số tiền chi."); return; }
    setBusy(true);
    try {
      await saveExpense({ id: item?.id, building: buildingId, date: d, category: cat, amount: a, note, source: src });
      toast(item ? "Đã sửa khoản chi." : "Đã ghi khoản chi."); onDone();
    } catch (ex) { toast((ex as Error).message); }
    setBusy(false);
  }
  const catOpts = (EXPENSE_CATS as readonly string[]).includes(cat) ? expenseOptions : [...expenseOptions, [cat, cat] as const];
  return (
    <Sheet open={open} onClose={onClose} title={item ? "Sửa khoản chi" : "Ghi khoản chi toà"}>
      <form className="stack" onSubmit={submit}>
        <div className="row" style={{ flexWrap: "nowrap", gap: 8 }}>
          <label className="field" style={{ flex: 1 }}><span>Ngày chi</span><input id="ex-d" className="input" type="date" value={d} max={todayVN()} onChange={(e) => setD(e.target.value)} /></label>
          <label className="field" style={{ flex: 1 }}><span>Khoản chi</span><Combo id="ex-cat" value={cat} options={catOpts} onChange={setCat} label="Khoản chi" /></label>
        </div>
        <label className="field"><span>Số tiền (đ) *</span><input id="ex-amt" className="input num" inputMode="decimal" value={amt} onChange={(e) => setAmt(e.target.value)} required /></label>
        <label className="field"><span>Nội dung</span><input id="ex-note" className="input" maxLength={300} value={note} onChange={(e) => setNote(e.target.value)} placeholder="VD: Đổ rác tháng 11, thay bóng đèn hành lang" /></label>
        {payer && !item ? (
          <label className="field"><span>Hình thức</span><Combo id="ex-src" value={src} options={PAY_SOURCE} onChange={setSrc} label="Hình thức" />
            <small className="muted">{src === "cong_ty" ? "Công ty đã trả: ghi luôn là Đã quyết toán." : "Người ghi là người ứng tiền, chờ quyết toán qua đề nghị thanh toán hoặc tạm ứng."}</small></label>
        ) : null}
        <button className="btn block" disabled={busy}>{busy ? "Đang lưu…" : "Lưu"}</button>
      </form>
    </Sheet>
  );
}
