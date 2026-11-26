import { useCallback, useEffect, useState } from "react";
import { friendlyError, supabase } from "../lib/supabase";
import { useSession } from "../lib/session";
import { DUTY_LABEL, KINDS, type FlowKind } from "../lib/office";
import { parseMoney, vnd } from "../lib/money";
import { loadPurchaseSettings, type PurchaseSettings } from "../lib/purchase";
import { Icon, TopBar } from "../components/ui";
import "../office.css";
import "../flows.css";

type Step = { duty: string; approver_id: string | null; approver_name?: string | null };
type Flow = { kind: FlowKind; steps: Step[]; is_custom: boolean; updated_at: string | null; updated_by_name: string | null };

const DUTIES = ["leader", "truong_phong", "nhan_su", "ke_toan", "giam_doc", "khac"] as const;
const AUTO_HINT: Record<string, string> = {
  leader: "Leader cùng nhóm với người lập (không có thì bỏ qua)",
  truong_phong: "Trưởng phòng của người lập (không có thì Giám đốc)",
  nhan_su: "Người giữ nhiệm vụ Nhân sự trong sơ đồ công ty",
  ke_toan: "Người giữ nhiệm vụ Kế toán (không có thì Giám đốc)",
  giam_doc: "Người giữ nhiệm vụ Giám đốc trong sơ đồ công ty",
  khac: "Chọn một người cụ thể",
};
/** Loại luồng: đề nghị mua hàng có 2 luồng (duyệt nhu cầu, duyệt NCC & giá, SQL 108) */
const FLOW_KINDS: { kind: FlowKind; label: string }[] = KINDS.flatMap((k) => k.kind === "mua_hang"
  ? [{ kind: "mua_hang" as FlowKind, label: "Mua hàng · Duyệt nhu cầu" }, { kind: "mua_hang_gia" as FlowKind, label: "Mua hàng · Duyệt NCC & giá" }]
  : [{ kind: k.kind as FlowKind, label: k.label }]);

const when = (iso: string | null) => (iso ? new Date(iso).toLocaleString("vi-VN", { timeZone: "Asia/Ho_Chi_Minh", day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit" }) : "");

/** Luồng phê duyệt theo từng loại đề nghị. Ai cũng xem được; chỉ anh Trí và người giữ nhiệm vụ Nhân sự sửa (CSDL kiểm tra trong approval_flow_save). */
export default function FlowSettings() {
  const { people, isFlowAdmin, toast } = useSession();
  const [flows, setFlows] = useState<Flow[] | null>(null);
  const [draft, setDraft] = useState<Record<string, Step[]>>({});
  const [busy, setBusy] = useState<string | null>(null);
  const [err, setErr] = useState<Record<string, string>>({});

  const load = useCallback(async () => {
    const { data, error } = await supabase.rpc("approval_flow_list");
    if (error) { toast(friendlyError(error)); return; }
    const list = ((data ?? []) as Flow[]).map((f) => ({ ...f, steps: (f.steps ?? []).map((s) => ({ ...s, approver_id: s.approver_id || null })) }));
    setFlows(list);
    setDraft(Object.fromEntries(list.map((f) => [f.kind, f.steps.map((s) => ({ ...s }))])));
  }, [toast]);
  useEffect(() => { load(); }, [load]);

  const staff = people.filter((p) => p.is_active);
  const name = (id: string | null | undefined) => staff.find((p) => p.id === id)?.full_name ?? people.find((p) => p.id === id)?.full_name ?? "—";
  const setSteps = (k: string, steps: Step[]) => { setDraft((d) => ({ ...d, [k]: steps })); setErr((e) => ({ ...e, [k]: "" })); };
  const same = (a: Step[], b: Step[]) => JSON.stringify(a.map((s) => [s.duty, s.approver_id])) === JSON.stringify(b.map((s) => [s.duty, s.approver_id]));

  async function save(f: Flow) {
    const steps = draft[f.kind] ?? [];
    const bad = steps.findIndex((s) => s.duty === "khac" && !s.approver_id);
    if (bad >= 0) { setErr((e) => ({ ...e, [f.kind]: `Bước ${bad + 1}: chọn người duyệt.` })); return; }
    setBusy(f.kind);
    const { error } = await supabase.rpc("approval_flow_save", { p_kind: f.kind, p_steps: steps.map((s) => ({ duty: s.duty, approver_id: s.approver_id })) });
    setBusy(null);
    if (error) { setErr((e) => ({ ...e, [f.kind]: friendlyError(error) })); return; }
    toast("Đã lưu luồng duyệt. Áp dụng cho phiếu gửi từ bây giờ."); load();
  }
  async function reset(f: Flow) {
    setBusy(f.kind);
    const { error } = await supabase.rpc("approval_flow_reset", { p_kind: f.kind });
    setBusy(null);
    if (error) { setErr((e) => ({ ...e, [f.kind]: friendlyError(error) })); return; }
    toast("Đã khôi phục luồng mặc định."); load();
  }

  return (
    <>
      <TopBar title="Luồng phê duyệt" back="/van-phong" />
      <main className="main main-wide stack">
        <div className="ok-box">
          {isFlowAdmin
            ? "Mỗi bước chọn chức danh theo sơ đồ công ty, hoặc chỉ định một người cụ thể. Bước chưa có người giữ tự bỏ qua; một người đứng nhiều bước chỉ duyệt một lần. Luồng mới áp dụng cho phiếu gửi sau khi lưu, phiếu đang chờ duyệt giữ luồng cũ."
            : "Luồng duyệt của từng loại đề nghị. Chỉ người có quyền Luồng phê duyệt mức Sửa được thay đổi."}
        </div>
        <PurchaseLimitCard canEdit={isFlowAdmin} />
        {!flows ? <div className="loading">Đang tải…</div> : FLOW_KINDS.map(({ kind, label }) => {
          const f = flows.find((x) => x.kind === kind);
          if (!f) return null;
          const steps = draft[kind] ?? f.steps;
          const dirty = !same(steps, f.steps);
          return (
            <section key={kind} className="card fl-card" aria-label={`Luồng duyệt ${label}`}>
              <div className="fl-head">
                <h2>{label}</h2>
                <span className={`fl-tag${f.is_custom ? " custom" : ""}`}>{f.is_custom ? "Đã tuỳ chỉnh" : "Mặc định"}</span>
                {f.is_custom && f.updated_at ? <span className="muted small">Sửa {when(f.updated_at)}{f.updated_by_name ? ` · ${f.updated_by_name}` : ""}</span> : null}
              </div>
              <div className="fl-chain" aria-label="Thứ tự duyệt">
                <span className="fl-node me">Người lập</span>
                {steps.map((s, i) => (
                  <span key={i} className="fl-arrow-node"><span aria-hidden="true">→</span>
                    <span className="fl-node"><b>{DUTY_LABEL[s.duty] ?? s.duty}</b><small>{s.approver_id ? name(s.approver_id) : "theo sơ đồ"}</small></span>
                  </span>
                ))}
              </div>
              {isFlowAdmin ? (
                <>
                  <ol className="fl-steps">
                    {steps.map((s, i) => (
                      <li key={i}>
                        <span className="fl-no num">{i + 1}</span>
                        <label className="field"><span>Chức danh</span>
                          <select className="input" value={s.duty} onChange={(e) => {
                            const duty = e.target.value;
                            setSteps(kind, steps.map((x, k) => (k === i ? { ...x, duty } : x)));
                          }}>
                            {DUTIES.map((d) => <option key={d} value={d}>{DUTY_LABEL[d]}</option>)}
                          </select></label>
                        <label className="field"><span>Người duyệt</span>
                          <select className="input" value={s.approver_id ?? ""} onChange={(e) => setSteps(kind, steps.map((x, k) => (k === i ? { ...x, approver_id: e.target.value || null } : x)))}>
                            <option value="">{s.duty === "khac" ? "Chọn người…" : "Theo sơ đồ công ty"}</option>
                            {staff.map((p) => <option key={p.id} value={p.id}>{p.full_name}</option>)}
                          </select>
                          <small className="muted">{s.approver_id ? "Luôn do người này duyệt" : AUTO_HINT[s.duty]}</small></label>
                        <div className="fl-acts">
                          <button type="button" className="xls-btn" aria-label={`Đưa bước ${i + 1} lên`} title="Lên" disabled={i === 0}
                            onClick={() => { const a = [...steps]; [a[i - 1], a[i]] = [a[i], a[i - 1]]; setSteps(kind, a); }}>↑</button>
                          <button type="button" className="xls-btn" aria-label={`Đưa bước ${i + 1} xuống`} title="Xuống" disabled={i === steps.length - 1}
                            onClick={() => { const a = [...steps]; [a[i + 1], a[i]] = [a[i], a[i + 1]]; setSteps(kind, a); }}>↓</button>
                          <button type="button" className="xls-btn no" aria-label={`Xoá bước ${i + 1}`} title="Xoá bước" disabled={steps.length <= 1}
                            onClick={() => setSteps(kind, steps.filter((_, k) => k !== i))}>{Icon.trash}</button>
                        </div>
                      </li>
                    ))}
                  </ol>
                  {err[kind] ? <div className="error-box" role="alert">{err[kind]}</div> : null}
                  <div className="row fl-foot">
                    <button type="button" className="btn secondary sm" disabled={steps.length >= 8} onClick={() => setSteps(kind, [...steps, { duty: "khac", approver_id: null }])}>{Icon.plus}Thêm bước</button>
                    <span className="grow" />
                    {f.is_custom ? <button type="button" className="btn ghost sm" disabled={busy === kind} onClick={() => reset(f)}>Khôi phục mặc định</button> : null}
                    {dirty ? <button type="button" className="btn ghost sm" onClick={() => setSteps(kind, f.steps.map((x) => ({ ...x })))}>Huỷ thay đổi</button> : null}
                    <button type="button" className="btn sm" disabled={!dirty || busy === kind} onClick={() => save(f)}>{busy === kind ? "Đang lưu…" : "Lưu luồng"}</button>
                  </div>
                </>
              ) : null}
            </section>
          );
        })}
      </main>
    </>
  );
}

/** Hạn mức báo giá theo quy trình mua hàng: đơn từ hạn mức cần tối thiểu N báo giá (SQL 108, purchase_settings_save) */
function PurchaseLimitCard({ canEdit }: { canEdit: boolean }) {
  const { toast } = useSession();
  const [cfg, setCfg] = useState<PurchaseSettings | null>(null);
  const [limit, setLimit] = useState("");
  const [min, setMin] = useState("3");
  const [busy, setBusy] = useState(false);
  const fill = (c: PurchaseSettings) => { setCfg(c); setLimit(new Intl.NumberFormat("vi-VN").format(c.quote_threshold)); setMin(String(c.min_quotes)); };
  useEffect(() => { loadPurchaseSettings().then(fill); }, []);
  if (!cfg) return null;
  const amount = parseMoney(limit);
  const dirty = amount !== cfg.quote_threshold || Number(min) !== cfg.min_quotes;
  async function save() {
    if (amount == null || amount < 0) { toast("Nhập hạn mức hợp lệ"); return; }
    setBusy(true);
    const { error } = await supabase.rpc("purchase_settings_save", { p_threshold: amount, p_min: Number(min) });
    setBusy(false);
    if (error) { toast(friendlyError(error)); return; }
    toast("Đã lưu hạn mức báo giá"); fill({ quote_threshold: amount, min_quotes: Number(min) });
  }
  return (
    <section className="card fl-card stack" aria-label="Hạn mức báo giá mua hàng">
      <h2 style={{ margin: 0 }}>Mua hàng · Hạn mức báo giá</h2>
      <p className="muted small" style={{ margin: 0 }}>Theo quy trình mua hàng: đơn từ hạn mức trở lên cần đủ số báo giá tối thiểu. Thiếu báo giá hoặc không chọn giá thấp nhất thì người mua hàng phải ghi lý do khi trình duyệt.</p>
      {canEdit ? (
        <>
          <div className="row" style={{ gap: 8, flexWrap: "nowrap" }}>
            <label className="field" style={{ flex: 2 }}><span>Hạn mức (đ)</span>
              <input className="input num" inputMode="numeric" value={limit} onChange={(e) => setLimit(e.target.value)}
                onBlur={() => { if (amount != null) setLimit(new Intl.NumberFormat("vi-VN").format(amount)); }} /></label>
            <label className="field" style={{ flex: 1 }}><span>Số báo giá</span>
              <select className="input" value={min} onChange={(e) => setMin(e.target.value)}>
                {[1, 2, 3, 4, 5].map((n) => <option key={n} value={n}>{n}</option>)}</select></label>
          </div>
          <div className="row fl-foot"><span className="grow" />
            <button type="button" className="btn sm" disabled={!dirty || busy} onClick={save}>{busy ? "Đang lưu…" : "Lưu hạn mức"}</button></div>
        </>
      ) : (
        <p style={{ margin: 0 }}>Đơn từ <b>{vnd(cfg.quote_threshold)}</b> cần tối thiểu <b>{cfg.min_quotes}</b> báo giá.</p>
      )}
    </section>
  );
}
