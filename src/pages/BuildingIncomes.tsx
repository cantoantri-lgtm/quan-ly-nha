import { useCallback, useEffect, useMemo, useState, type FormEvent } from "react";
import { useParams } from "react-router-dom";
import { friendlyError, supabase } from "../lib/supabase";
import { useSession } from "../lib/session";
import { ddmmyyyy, monthRange, rangeLabel, todayVN, type DateRange } from "../lib/dates";
import { parseMoney, vnd } from "../lib/money";
import { Combo, Empty, Sheet, TopBar } from "../components/ui";
import { HANDOVER_LABEL, INC_COLS, INCOME_METHOD, OTHER_INCOME_CATS, otherIncomeOptions, saveIncome,
  type Handover, type IncomeMethod, type OtherIncome } from "../lib/income";

/** Thu khác của toà (ngoài tiền phòng): gửi xe vãng lai, giặt sấy, bán phế liệu, đền bù… (SQL 099).
 *  Tiền mặt: người thu giữ, nộp Kế toán trong 24 giờ; Kế toán bấm "Đã nhận tiền". Chuyển khoản: ghi là đã nộp luôn. */
type Filter = "all" | Handover;
const FILTERS: [Filter, string][] = [["all", "Tất cả"], ["chua_nop", "Chưa nộp Kế toán"], ["da_nop", "Đã nộp"]];
const COLOR: Record<Handover, string> = { chua_nop: "var(--danger)", da_nop: "var(--s-done)" };
const methodOpts = Object.entries(INCOME_METHOD) as [IncomeMethod, string][];

/** Dùng làm trang riêng (/toa/:id/thu-khac) hoặc nhúng trong "Thu & chi toà nhà" (embedded, theo khoảng ngày) */
export default function BuildingIncomes({ buildingId, embedded, range }: { buildingId?: string; embedded?: boolean; range?: DateRange } = {}) {
  const params = useParams();
  const id = buildingId ?? params.id ?? "";
  const { buildings, profile, people, isManager, isAccountant, toast } = useSession();
  const payer = isManager || isAccountant;
  const b = buildings.find((x: { id: string }) => x.id === id);
  const r = range ?? monthRange();
  const [rows, setRows] = useState<OtherIncome[] | null>(null);
  const [f, setF] = useState<Filter>("all");
  const [edit, setEdit] = useState<OtherIncome | null | "new">(null);
  const [picked, setPicked] = useState<string[]>([]);
  const name = (u: string | null) => (u ? people.find((p: { id: string }) => p.id === u)?.full_name ?? "—" : "—");

  const load = useCallback(async () => {
    const { data, error } = await supabase.from("building_incomes").select(INC_COLS).eq("building_id", id)
      .gte("received_on", r.from).lte("received_on", r.to).order("received_on", { ascending: false }).order("created_at", { ascending: false });
    if (error) toast(friendlyError(error));
    setRows(((data as OtherIncome[]) ?? []).map((x) => ({ ...x, amount: Number(x.amount) })));
    setPicked([]);
  }, [id, r.from, r.to, toast]);
  useEffect(() => { load(); }, [load]);

  const shown = useMemo(() => (rows ?? []).filter((x) => f === "all" || x.handover_status === f), [rows, f]);
  const sum = (h?: Handover, m?: IncomeMethod) => (rows ?? []).filter((x) => (!h || x.handover_status === h) && (!m || x.method === m)).reduce((t, x) => t + x.amount, 0);
  const openCash = (rows ?? []).filter((x) => x.handover_status === "chua_nop");

  async function del(x: OtherIncome) {
    if (!window.confirm(`Xoá khoản thu ${vnd(x.amount)} (${x.category})?`)) return;
    const { error } = await supabase.rpc("income_delete", { p_id: x.id });
    if (error) toast(friendlyError(error)); else { toast("Đã xoá."); load(); }
  }
  async function confirm(ids: string[]) {
    if (!ids.length) return;
    const tot = (rows ?? []).filter((x) => ids.includes(x.id)).reduce((t, x) => t + x.amount, 0);
    if (!window.confirm(`Xác nhận đã nhận ${vnd(tot)} tiền mặt (${ids.length} khoản)?`)) return;
    const { data, error } = await supabase.rpc("income_confirm", { p_ids: ids });
    if (error) toast(friendlyError(error)); else { toast(`Đã xác nhận ${data ?? 0} khoản.`); load(); }
  }

  const Wrap = embedded ? "div" : "main";
  return (
    <>
      {embedded ? null : <TopBar title={`Thu khác · ${b?.code ?? ""}`} back action={<button className="btn sm" onClick={() => setEdit("new")}>+ Ghi thu</button>} />}
      <Wrap className={embedded ? "stack" : "main stack"}>
        {embedded ? <button className="btn" onClick={() => setEdit("new")}>+ Ghi khoản thu khác</button> : null}
        <p className="muted small" style={{ margin: 0 }}>
          Các khoản thu ngoài tiền phòng: gửi xe vãng lai, giặt sấy, bán phế liệu, đền bù hư hỏng… Thu tiền mặt thì nộp Kế toán trong 24 giờ; Kế toán xác nhận "Đã nhận tiền".
          Tiền cọc thu trong hợp đồng (nút "Thu tiền cọc").
        </p>
        <div className="rpt-kpis" style={{ display: "grid", gridTemplateColumns: "repeat(2, minmax(0,1fr))", gap: 8 }}>
          <div className="card" style={{ padding: 10 }}><b className="num">{vnd(sum())}</b><br /><small className="muted">Tổng thu khác {rangeLabel(r)}</small></div>
          <div className="card" style={{ padding: 10 }}><b className="num" style={{ color: sum("chua_nop") ? "var(--danger)" : undefined }}>{vnd(sum("chua_nop"))}</b><br /><small className="muted">Tiền mặt chưa nộp Kế toán</small></div>
        </div>
        {payer && openCash.length ? (
          <div className="card row" style={{ padding: 10, justifyContent: "space-between" }}>
            <span className="small">{picked.length ? `Đã chọn ${picked.length} khoản, ${vnd(openCash.filter((x) => picked.includes(x.id)).reduce((t, x) => t + x.amount, 0))}` : `${openCash.length} khoản tiền mặt chờ nộp. Tích chọn rồi bấm xác nhận.`}</span>
            <button className="btn sm" disabled={!picked.length} onClick={() => confirm(picked)}>Đã nhận tiền</button>
          </div>
        ) : null}
        <div className="chips" role="group" aria-label="Lọc theo nộp tiền">
          {FILTERS.map(([k, t]) => <button key={k} className="chip" aria-pressed={f === k} onClick={() => setF(k)}>{t}</button>)}
        </div>
        {rows === null ? <div className="loading">Đang tải…</div> : shown.length === 0 ? <Empty title="Chưa có khoản thu khác nào." /> : shown.map((x) => {
          const mine = x.received_by === profile?.id;
          const canEdit = payer || (mine && x.handover_status === "chua_nop");
          const pickable = payer && x.handover_status === "chua_nop";
          return (
            <div key={x.id} className="card stack" style={{ padding: 12, gap: 4 }}>
              <div className="row" style={{ justifyContent: "space-between", flexWrap: "nowrap", gap: 8 }}>
                {pickable ? (
                  <label className="row" style={{ gap: 8, flexWrap: "nowrap", minWidth: 0 }}>
                    <input type="checkbox" checked={picked.includes(x.id)} onChange={(e) => setPicked(e.target.checked ? [...picked, x.id] : picked.filter((p) => p !== x.id))} aria-label={`Chọn ${x.category} ${vnd(x.amount)}`} />
                    <b>{x.category}</b>
                  </label>
                ) : <b>{x.category}</b>}
                <b className="num">{vnd(x.amount)}</b>
              </div>
              <div className="small">{ddmmyyyy(x.received_on)}{x.payer_name ? ` · người nộp: ${x.payer_name}` : ""}{x.note ? ` · ${x.note}` : ""}</div>
              <div className="small muted">{x.method === "chuyen_khoan" ? "Chuyển khoản" : "Tiền mặt"} · người thu: {name(x.received_by)}</div>
              <div className="row small" style={{ justifyContent: "space-between" }}>
                <span style={{ color: COLOR[x.handover_status], fontWeight: 600 }}>
                  {x.method === "chuyen_khoan" ? "Vào tài khoản công ty" : HANDOVER_LABEL[x.handover_status]}
                  {x.method === "tien_mat" && x.handover_status === "da_nop" && x.handed_by ? ` · ${name(x.handed_by)} nhận ${x.handed_at ? ddmmyyyy(x.handed_at.slice(0, 10)) : ""}` : ""}
                </span>
              </div>
              {canEdit ? (
                <div className="row">
                  <button className="btn ghost sm" onClick={() => setEdit(x)}>Sửa</button>
                  <button className="btn ghost sm" onClick={() => del(x)}>Xoá</button>
                </div>
              ) : null}
            </div>
          );
        })}
      </Wrap>
      <IncomeSheet open={edit !== null} item={edit === "new" ? null : edit} buildingId={id}
        onClose={() => setEdit(null)} onDone={() => { setEdit(null); load(); }} />
    </>
  );
}

function IncomeSheet({ open, item, buildingId, onClose, onDone }: {
  open: boolean; item: OtherIncome | null; buildingId: string; onClose: () => void; onDone: () => void;
}) {
  const { toast } = useSession();
  const [d, setD] = useState(todayVN());
  const [cat, setCat] = useState<string>("Gửi xe vãng lai");
  const [amt, setAmt] = useState("");
  const [note, setNote] = useState("");
  const [payerName, setPayerName] = useState("");
  const [method, setMethod] = useState<IncomeMethod>("tien_mat");
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    if (!open) return;
    setD(item?.received_on ?? todayVN()); setCat(item?.category ?? "Gửi xe vãng lai"); setAmt(item ? String(item.amount) : "");
    setNote(item?.note ?? ""); setPayerName(item?.payer_name ?? ""); setMethod(item?.method ?? "tien_mat");
  }, [open, item]);
  async function submit(e: FormEvent) {
    e.preventDefault();
    const a = parseMoney(amt);
    if (!a || a <= 0) { toast("Nhập số tiền thu."); return; }
    setBusy(true);
    try {
      await saveIncome({ id: item?.id, building: buildingId, date: d, category: cat, amount: a, note, method, payer: payerName });
      toast(item ? "Đã sửa khoản thu." : method === "tien_mat" ? "Đã ghi khoản thu. Nhớ nộp tiền mặt cho Kế toán trong 24 giờ." : "Đã ghi khoản thu."); onDone();
    } catch (ex) { toast((ex as Error).message); }
    setBusy(false);
  }
  const catOpts = (OTHER_INCOME_CATS as readonly string[]).includes(cat) ? otherIncomeOptions : [...otherIncomeOptions, [cat, cat] as const];
  return (
    <Sheet open={open} onClose={onClose} title={item ? "Sửa khoản thu" : "Ghi khoản thu khác"}>
      <form className="stack" onSubmit={submit}>
        <div className="row" style={{ flexWrap: "nowrap", gap: 8 }}>
          <label className="field" style={{ flex: 1 }}><span>Ngày thu</span><input id="in-d" className="input" type="date" value={d} max={todayVN()} onChange={(e) => setD(e.target.value)} /></label>
          <label className="field" style={{ flex: 1 }}><span>Khoản thu</span><Combo id="in-cat" value={cat} options={catOpts} onChange={setCat} label="Khoản thu" /></label>
        </div>
        <label className="field"><span>Số tiền (đ) *</span><input id="in-amt" className="input num" inputMode="decimal" value={amt} onChange={(e) => setAmt(e.target.value)} required /></label>
        <label className="field"><span>Nội dung</span><input id="in-note" className="input" maxLength={300} value={note} onChange={(e) => setNote(e.target.value)} placeholder="VD: Gửi xe khách vãng lai 3 ngày, bán thùng giấy" /></label>
        <label className="field"><span>Người nộp tiền (không bắt buộc)</span><input id="in-payer" className="input" maxLength={100} value={payerName} onChange={(e) => setPayerName(e.target.value)} placeholder="VD: Khách phòng 201, vựa phế liệu" /></label>
        <label className="field"><span>Hình thức</span><Combo id="in-method" value={method} options={methodOpts} onChange={setMethod} label="Hình thức" />
          <small className="muted">{method === "tien_mat" ? "Bạn giữ tiền mặt, nộp Kế toán trong 24 giờ. Kế toán nhận được thông báo." : "Tiền đã vào tài khoản công ty, ghi là đã nộp."}</small></label>
        <button className="btn block" disabled={busy}>{busy ? "Đang lưu…" : "Lưu"}</button>
      </form>
    </Sheet>
  );
}
