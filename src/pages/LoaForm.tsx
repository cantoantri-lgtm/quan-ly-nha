import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { Link, useLocation, useNavigate, useParams } from "react-router-dom";
import { friendlyError, supabase } from "../lib/supabase";
import { useSession } from "../lib/session";
import { ddmmyyyy, todayVN } from "../lib/dates";
import { parseMoney, vndWords } from "../lib/money";
import { PAUSED_TIP, usePausedKinds, LOA_BUDGET, LOA_CATEGORY, LOA_DOC_TYPE, LOA_PAY, LOA_SBU, LOA_TAX, moneyCur, statusLabel,
  type LoaDept, type LoaDetails, type LoaLine, type LoaMember, type Req } from "../lib/office";
import { MAX_BYTES, uploadFile } from "../lib/files";
import { Sheet, TopBar } from "../components/ui";
import { ChainPreview } from "../components/ApprovalChain";
import FileGallery from "../components/FileGallery";
import "../office.css";

type LineDraft = { description: string; unit: string; quantity: string; unit_price: string; note: string };
type Pending = { file: File; label: string };
type LoaRef = { id: string; doc_no: string | null; reason: string; status: Req["status"]; requester_id: string };

const emptyLine = (): LineDraft => ({ description: "", unit: "", quantity: "1", unit_price: "", note: "" });
const qtyOf = (s: string) => { const n = Number((s || "1").trim().replace(",", ".")); return Number.isFinite(n) ? n : NaN; };
const lineAmount = (l: LineDraft) => { const q = qtyOf(l.quantity); const p = parseMoney(l.unit_price) ?? 0; return Number.isFinite(q) ? Math.round(q * p) : 0; };

function Choice({ name, value, options, onChange }: { name: string; value: string; options: Record<string, string>; onChange: (v: string) => void }) {
  return (
    <div className="opt-grid" role="radiogroup" aria-label={name}>
      {Object.entries(options).map(([k, l]) => (
        <button type="button" key={k} role="radio" aria-checked={value === k} className="opt" onClick={() => onChange(k)}>{l}</button>
      ))}
    </div>
  );
}

function Switch({ id, checked, onChange, children }: { id: string; checked: boolean; onChange: (v: boolean) => void; children: ReactNode }) {
  return (
    <label className="loa-switch" htmlFor={id}>
      <input id={id} type="checkbox" role="switch" checked={checked} onChange={(e) => onChange(e.target.checked)} />
      <span>{children}</span>
    </label>
  );
}

/** Lập / sửa Tờ trình phê duyệt (LOA): lưu nháp nhiều lần, trình duyệt khi đủ thông tin. Mọi thao tác ghi đi qua RPC loa_save. */
export default function LoaForm() {
  const { id } = useParams();
  const editing = !!id;
  const { profile, people, buildings, toast, refreshUnread, isManager } = useSession();
  const { paused, loaded: pauseLoaded } = usePausedKinds();
  const nav = useNavigate();
  const loc = useLocation();

  const [loaded, setLoaded] = useState(!editing);
  const [req, setReq] = useState<Req | null>(null);
  const [depts, setDepts] = useState<LoaDept[]>([]);
  const [refs, setRefs] = useState<LoaRef[]>([]);

  const [subject, setSubject] = useState("");
  const [category, setCategory] = useState("");
  const [dept, setDept] = useState("");
  const [sbu, setSbu] = useState<string[]>([]);
  const [background, setBackground] = useState("");
  const [seek, setSeek] = useState("");
  const [payReceive, setPayReceive] = useState("chi");
  const [currency, setCurrency] = useState("VND");
  const [amount, setAmount] = useState("");
  const [tax, setTax] = useState("chua_gom");
  const [budget, setBudget] = useState("trong");
  const [hasBudgetNo, setHasBudgetNo] = useState(false);
  const [budgetNo, setBudgetNo] = useState("");
  const [details, setDetails] = useState("");
  const [lines, setLines] = useState<LineDraft[]>([]);
  const [autosum, setAutosum] = useState(true);
  const [start, setStart] = useState("");
  const [hasRef, setHasRef] = useState(false);
  const [refId, setRefId] = useState("");
  const [reportDue, setReportDue] = useState("");
  const [buildingId, setBuildingId] = useState("");
  const [cowriters, setCowriters] = useState<string[]>([]);
  const [viewers, setViewers] = useState<string[]>([]);
  const [viewerDepts, setViewerDepts] = useState<string[]>([]);
  const [pending, setPending] = useState<Pending[]>([]);
  const [docType, setDocType] = useState("du_toan");

  const [busy, setBusy] = useState<null | "luu" | "trinh">(null);
  const [err, setErr] = useState<string | null>((loc.state as { err?: string } | null)?.err ?? null);
  const [copyOpen, setCopyOpen] = useState(false);
  const [copyText, setCopyText] = useState("");
  const fileRef = useRef<HTMLInputElement>(null);
  const chainRef = useRef<HTMLDivElement>(null);
  // Lỗi mang theo khi chuyển từ "lập mới" sang "sửa bản nháp"
  useEffect(() => { const e = (loc.state as { err?: string } | null)?.err; if (e) setErr(e); }, [loc.state]);

  // Danh mục dùng chung: phòng ban, các LOA mình xem được (để tham chiếu / sao chép)
  useEffect(() => {
    supabase.rpc("loa_departments").then(({ data }) => {
      const list = (data ?? []) as LoaDept[];
      setDepts(list);
      if (!editing) setDept((cur) => cur || list.find((d) => d.mine)?.id || "");
    });
    supabase.from("requests").select("id,doc_no,reason,status,requester_id").eq("kind", "loa").order("created_at", { ascending: false }).limit(300)
      .then(({ data }) => setRefs((data ?? []) as LoaRef[]));
  }, [editing]);

  function fill(d: LoaDetails, r: Pick<Req, "amount" | "currency" | "start_date" | "building_id">, ls: LoaLine[], keepDates: boolean) {
    setSubject(d.subject); setCategory(d.category ?? ""); setDept(d.propose_dept ?? ""); setSbu(d.sbu ?? []);
    setBackground(d.background ?? ""); setSeek(d.seek_approval ?? ""); setPayReceive(d.pay_receive); setTax(d.tax);
    setBudget(d.budget_status); setHasBudgetNo(!!d.budget_item_no); setBudgetNo(d.budget_item_no ?? "");
    setDetails(d.details ?? ""); setAutosum(d.autosum);
    setCurrency(r.currency || "VND"); setAmount(r.amount != null ? String(r.amount) : ""); setBuildingId(r.building_id ?? "");
    setLines(ls.map((l) => ({ description: l.description, unit: l.unit ?? "", quantity: String(l.quantity).replace(".", ","), unit_price: String(l.unit_price), note: l.note ?? "" })));
    if (keepDates) { setStart(r.start_date ?? ""); setReportDue(d.report_due ?? ""); setHasRef(!!d.ref_loa_id); setRefId(d.ref_loa_id ?? ""); }
  }

  async function fetchLoa(loaId: string) {
    const [r, d, l] = await Promise.all([
      supabase.from("requests").select("*").eq("id", loaId).maybeSingle(),
      supabase.from("loa_details").select("*").eq("request_id", loaId).maybeSingle(),
      supabase.from("loa_lines").select("*").eq("request_id", loaId).order("line_no"),
    ]);
    return { r: r.data as Req | null, d: d.data as LoaDetails | null, l: (l.data ?? []) as LoaLine[] };
  }

  useEffect(() => {
    if (!id) return;
    let live = true;
    (async () => {
      const [{ r, d, l }, m, vd, can] = await Promise.all([
        fetchLoa(id),
        supabase.from("loa_members").select("*").eq("request_id", id),
        supabase.from("loa_viewer_depts").select("department_id").eq("request_id", id),
        supabase.rpc("loa_can_edit", { p_loa: id }),
      ]);
      if (!live) return;
      if (!r || r.kind !== "loa" || !d) { nav("/van-phong/ds/loa", { replace: true }); return; }
      if (!can.data) { toast("Tờ trình đang trong quá trình duyệt hoặc đã duyệt xong nên không sửa được."); nav(`/van-phong/${r.id}`, { replace: true }); return; }
      setReq(r); fill(d, r, l, true);
      const mem = (m.data ?? []) as LoaMember[];
      setCowriters(mem.filter((x) => x.role === "soan").map((x) => x.user_id));
      setViewers(mem.filter((x) => x.role === "xem").map((x) => x.user_id));
      setViewerDepts(((vd.data ?? []) as { department_id: string }[]).map((x) => x.department_id));
      setLoaded(true);
    })();
    return () => { live = false; };
  }, [id]); // eslint-disable-line react-hooks/exhaustive-deps

  const ownerId = req?.requester_id ?? profile?.id ?? "";
  const isOwner = ownerId === profile?.id;
  const name = (uid: string | null | undefined) => people.find((p) => p.id === uid)?.full_name ?? "—";
  const staff = useMemo(() => people.filter((p) => p.is_active && p.id !== ownerId), [people, ownerId]);
  const total = lines.reduce((s, l) => s + lineAmount(l), 0);
  const useSum = autosum && lines.length > 0;
  const amt = useSum ? total : parseMoney(amount);
  const ownerDepts = depts.filter((d) => d.mine).map((d) => d.name).join(", ");
  const refOptions = refs.filter((x) => x.id !== id && x.status !== "nhap");

  function toggleSbu(k: string) {
    const solo = k === "tat_ca" || k === "khong_ap_dung";
    setSbu((cur) => cur.includes(k) ? cur.filter((x) => x !== k)
      : solo ? [k] : [...cur.filter((x) => x !== "tat_ca" && x !== "khong_ap_dung"), k]);
  }
  const setLine = (i: number, patch: Partial<LineDraft>) => setLines(lines.map((l, k) => (k === i ? { ...l, ...patch } : l)));
  const toggle = (list: string[], set: (v: string[]) => void, v: string) => set(list.includes(v) ? list.filter((x) => x !== v) : [...list, v]);

  function pickFiles(list: FileList | null) {
    const picked = [...(list ?? [])];
    if (fileRef.current) fileRef.current.value = "";
    const big = picked.find((f) => f.size > MAX_BYTES && f.type === "application/pdf");
    if (big) { setErr(`${big.name} lớn hơn 10 MB.`); return; }
    setPending((cur) => [...cur, ...picked.map((file) => ({ file, label: docType }))]);
  }

  /** Kiểm tra dự toán (cả khi lưu nháp) và các ô bắt buộc (khi trình duyệt) */
  function check(submit: boolean): string | null {
    if (!subject.trim()) return "Nhập tiêu đề tờ trình.";
    for (let i = 0; i < lines.length; i++) {
      if (!lines[i].description.trim()) return `Dự toán dòng ${i + 1}: nhập nội dung.`;
      const q = qtyOf(lines[i].quantity);
      if (!Number.isFinite(q) || q <= 0) return `Dự toán dòng ${i + 1}: số lượng chưa đúng.`;
      if (lines[i].unit_price.trim() && parseMoney(lines[i].unit_price) == null) return `Dự toán dòng ${i + 1}: đơn giá chưa đúng định dạng.`;
    }
    if (!useSum && amount.trim() && parseMoney(amount) == null) return "Số tiền chưa đúng định dạng.";
    if (!submit) return null;
    if (!category) return "Chọn phân loại.";
    if (!dept) return "Chọn đơn vị đề xuất cuối cùng.";
    if (!sbu.length) return "Chọn mảng kinh doanh (chọn “Không áp dụng” nếu không thuộc mảng nào).";
    if (!background.trim()) return "Nhập bối cảnh.";
    if (!seek.trim()) return "Nhập nội dung xin phê duyệt.";
    if (amt == null) return "Nhập số tiền (nhập 0 nếu tờ trình không phát sinh tiền).";
    if (payReceive === "chi" && amt > 0 && !lines.length) return "Tờ trình có chi tiền cần bảng dự toán ngân sách: thêm ít nhất 1 dòng dự toán.";
    if (!start) return "Chọn ngày bắt đầu.";
    if (!reportDue) return "Chọn hạn báo cáo kết quả.";
    if (reportDue < start) return "Hạn báo cáo kết quả phải từ ngày bắt đầu trở đi.";
    return null;
  }

  const payload = () => ({
    subject, category, propose_dept: dept, sbu, background, seek_approval: seek, pay_receive: payReceive, currency,
    amount: amt == null ? "" : String(amt), tax, budget_status: budget, budget_item_no: hasBudgetNo ? budgetNo : "",
    details, autosum: useSum, start_date: start, ref_loa_id: hasRef ? refId : "", report_due: reportDue, building_id: buildingId,
    lines: lines.map((l) => ({ description: l.description, unit: l.unit, quantity: String(qtyOf(l.quantity)), unit_price: String(parseMoney(l.unit_price) ?? 0), note: l.note })),
    cowriters, viewers, viewer_depts: viewerDepts,
  });

  async function save(submit: boolean) {
    const bad = check(submit);
    if (bad) { setErr(bad); return; }
    setErr(null); setBusy(submit ? "trinh" : "luu");
    const p = payload();
    // 1) Lưu nháp trước để có mã tờ trình (tệp đính kèm cần mã này)
    const first = await supabase.rpc("loa_save", { p_id: id ?? null, p, p_submit: false });
    if (first.error) { setBusy(null); setErr(friendlyError(first.error)); return; }
    const rid = first.data as string;
    const problems: string[] = [];
    for (const f of pending) {
      try { await uploadFile({ kind: "dinh_kem_de_nghi", requestId: rid }, f.file, { label: f.label }); }
      catch (ex) { problems.push(`${f.file.name}: ${ex instanceof Error ? ex.message : "không tải lên được"}`); }
    }
    setPending([]);
    const editUrl = `/van-phong/loa/${rid}/sua`;
    if (problems.length) {
      setBusy(null);
      nav(editUrl, { replace: true, state: { err: `Đã lưu nháp nhưng có tệp chưa tải lên được: ${problems.join("; ")}. Tải lại tệp ở mục Tài liệu đính kèm${submit ? ", rồi bấm Trình duyệt" : ""}.` } });
      return;
    }
    if (!submit) {
      setBusy(null); toast("Đã lưu nháp. Chỉ bạn và người cùng soạn nhìn thấy bản nháp.");
      if (!editing) nav(editUrl, { replace: true });
      return;
    }
    // 2) Trình duyệt: cấp số LOA, dựng luồng duyệt
    const sub = await supabase.rpc("loa_save", { p_id: rid, p, p_submit: true });
    setBusy(null);
    if (sub.error) {
      const msg = `Đã lưu nháp nhưng chưa trình duyệt được: ${friendlyError(sub.error)}`;
      if (editing) setErr(msg); else nav(editUrl, { replace: true, state: { err: msg } });
      return;
    }
    refreshUnread();
    toast("Đã trình duyệt. Tờ trình đang chờ cấp duyệt đầu tiên.");
    nav(`/van-phong/${rid}`, { replace: true });
  }

  async function copyFrom(src: LoaRef) {
    const { d, r, l } = await fetchLoa(src.id);
    if (!d || !r) { toast("Không đọc được tờ trình này."); return; }
    fill(d, r, l, false);
    setCopyOpen(false);
    toast(`Đã sao chép nội dung từ ${src.doc_no ?? "bản nháp"}. Kiểm tra lại ngày, số tiền và tệp đính kèm.`);
  }

  if (!loaded || !pauseLoaded) return (<><TopBar title="Tờ trình (LOA)" back /><div className="loading">Đang tải…</div></>);
  if (paused.has("loa") && !isManager) return (
    <><TopBar title="Tờ trình (LOA)" back="/van-phong/ds/loa" /><main className="main stack"><div className="ok-box">{PAUSED_TIP}</div>
      <Link className="btn secondary block" to="/van-phong/ds/loa">Về danh sách</Link></main></>
  );

  const status = req?.status ?? "nhap";
  const kw = copyText.trim().toLowerCase();
  const copyList = refs.filter((x) => x.id !== id && (!kw || [x.doc_no, x.reason, name(x.requester_id)].some((v) => (v ?? "").toLowerCase().includes(kw))));
  const Actions = (
    <>
      <button type="button" className="btn secondary" disabled={!!busy} onClick={() => save(false)}>{busy === "luu" ? "Đang lưu…" : "Lưu nháp"}</button>
      {isOwner ? <button type="button" className="btn" disabled={!!busy} onClick={() => save(true)}>{busy === "trinh" ? "Đang trình…" : status === "nhap" ? "Trình duyệt" : "Lưu và trình lại"}</button> : null}
    </>
  );

  return (
    <>
      <TopBar title={editing ? "Sửa tờ trình (LOA)" : "Lập tờ trình (LOA)"} back={editing ? `/van-phong/${id}` : "/van-phong/ds/loa"} />
      <main className="main main-wide">
        <form className="stack dn-form" onSubmit={(e) => e.preventDefault()}
          onKeyDown={(e) => { if (e.key === "Enter" && (e.target as HTMLElement).tagName === "INPUT") e.preventDefault(); }}>

          {/* ---------- Đầu tờ trình ---------- */}
          <section className="card dn-sec k-loa">
            <div className="row" style={{ justifyContent: "space-between", flexWrap: "wrap" }}>
              <h2 className="loa-title">Tờ trình phê duyệt (LOA) <span className={`rq-pill ${status}`}>{statusLabel({ kind: "loa", status })}</span></h2>
              <span className="loa-conf">Bảo mật</span>
            </div>
            <div className="row loa-bar">
              {Actions}
              <button type="button" className="btn ghost sm" onClick={() => setCopyOpen(true)}>Sao chép từ LOA khác</button>
              <button type="button" className="btn ghost sm" onClick={() => chainRef.current?.scrollIntoView({ behavior: "smooth", block: "center" })}>Luồng duyệt</button>
            </div>
            <details className="loa-help">
              <summary>Trợ giúp: đổi luồng duyệt, in tờ trình, người kiêm nhiệm</summary>
              <p><b>Đổi luồng duyệt:</b> luồng duyệt lấy theo Sơ đồ công ty (Leader, Trưởng phòng, Kế toán, Giám đốc). Muốn đổi người duyệt, Quản lý sửa ở Văn phòng số → Sơ đồ công ty.</p>
              <p><b>In tờ trình:</b> sau khi lưu, mở tờ trình rồi bấm “In / lưu PDF”.</p>
              <p><b>Người kiêm nhiệm:</b> một người giữ nhiều vai trong luồng chỉ duyệt một lần, các bước trùng tự bỏ qua.</p>
            </details>
            <dl className="loa-meta">
              <div><dt>Tiêu đề</dt><dd>{subject || "—"}</dd></div>
              <div><dt>Số LOA</dt><dd className="num">{req?.doc_no ?? "Tự cấp khi trình duyệt"}</dd></div>
              <div><dt>Ngày trình</dt><dd className="num">{req?.doc_date ? ddmmyyyy(req.doc_date) : "—"}</dd></div>
              <div><dt>Người trình</dt><dd>{name(ownerId)}</dd></div>
              <div><dt>Đơn vị</dt><dd>{isOwner ? ownerDepts || "—" : "—"}</dd></div>
              <div><dt>Người soạn</dt><dd>{profile?.full_name ?? "—"}</dd></div>
            </dl>
            <details className="loa-help">
              <summary>Quy định LOA áp dụng</summary>
              <p>Tờ trình (LOA) dùng để xin duyệt và lưu lại các quy trình kiểm soát, chính sách, ngân sách.</p>
              <p>Đề nghị tạm ứng và đề nghị thanh toán có thể chọn một LOA chi tiền đã duyệt để tham chiếu (không bắt buộc). Tổng tạm ứng và thanh toán được theo dõi so với dự toán của LOA; vượt dự toán sẽ có cảnh báo cho các cấp duyệt.</p>
              <p>LOA đã duyệt xong thì khoá, không sửa. Cần thay đổi thì lập LOA mới và chọn “LOA tham chiếu” là LOA cũ.</p>
            </details>
          </section>

          {status === "tra_lai" || status === "tu_choi" ? (
            <div className="error-box"><b>{status === "tra_lai" ? "Tờ trình bị trả lại để sửa." : "Tờ trình bị từ chối."}</b>{req?.decision_note ? ` Lý do: ${req.decision_note}` : ""} Sửa xong bấm “Lưu và trình lại”, tờ trình đi duyệt lại từ cấp đầu.</div>
          ) : null}

          {/* ---------- Phân loại, đơn vị ---------- */}
          <section className="card dn-sec">
            <h2 className="dn-h">Phân loại *</h2>
            <Choice name="Phân loại" value={category} options={LOA_CATEGORY} onChange={setCategory} />
            <label className="field"><span>Đơn vị đề xuất cuối cùng *</span>
              <select id="loa-dept" className="input" value={dept} onChange={(e) => setDept(e.target.value)}>
                <option value="">Chọn phòng ban</option>
                {depts.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
              </select>
              <small className="muted">Phòng ban chịu trách nhiệm đề xuất và thực hiện nội dung này.</small></label>
          </section>

          {/* ---------- Nội dung đề xuất ---------- */}
          <section className="card dn-sec">
            <h2 className="dn-h">Nội dung đề xuất</h2>
            <label className="field"><span>Tiêu đề *</span>
              <input id="loa-subject" className="input" value={subject} maxLength={200} onChange={(e) => setSubject(e.target.value)} placeholder="VD: Xin duyệt ngân sách sơn lại sảnh toà 89 CMT8" />
              <small className="muted">Ngắn gọn, nêu rõ việc xin duyệt.</small></label>
            <div className="field"><span>Mảng kinh doanh *</span>
              <div className="opt-grid" role="group" aria-label="Mảng kinh doanh">
                {Object.entries(LOA_SBU).map(([k, l]) => (
                  <button type="button" key={k} role="checkbox" aria-checked={sbu.includes(k)} className="opt" onClick={() => toggleSbu(k)}>{l}</button>
                ))}
              </div></div>
            <label className="field"><span>Bối cảnh *</span>
              <textarea id="loa-background" className="input" value={background} maxLength={4000} onChange={(e) => setBackground(e.target.value)} />
              <small className="muted">Vì sao cần làm, hiện trạng, số liệu liên quan.</small></label>
            <label className="field"><span>Nội dung xin phê duyệt *</span>
              <textarea id="loa-seek" className="input" value={seek} maxLength={4000} onChange={(e) => setSeek(e.target.value)} />
              <small className="muted">Điều cần cấp trên quyết: làm gì, với ai, bao nhiêu tiền, trong thời gian nào.</small></label>
          </section>

          {/* ---------- Số tiền, ngân sách ---------- */}
          <section className="card dn-sec">
            <h2 className="dn-h">Số tiền và ngân sách</h2>
            <div className="dn-fields">
              <label className="field"><span>Chi / Thu *</span>
                <select id="loa-pay" className="input" value={payReceive} onChange={(e) => setPayReceive(e.target.value)}>
                  {Object.entries(LOA_PAY).map(([k, l]) => <option key={k} value={k}>{l}</option>)}
                </select></label>
              <label className="field"><span>Loại tiền</span>
                <select id="loa-cur" className="input" value={currency} onChange={(e) => setCurrency(e.target.value)}>
                  <option value="VND">VND</option><option value="USD">USD</option>
                </select></label>
              <label className="field"><span>Số tiền *</span>
                {useSum
                  ? <div className="input ro num">{moneyCur(total, currency)}</div>
                  : <input id="loa-amount" className="input num" inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} placeholder="VD: 25.000.000 hoặc 25tr" />}
                <small className={!useSum && amount && amt == null ? "err-text" : "muted"}>
                  {useSum ? "Tự cộng từ bảng dự toán bên dưới." : amount ? (amt == null ? "Chưa đọc được số tiền" : moneyCur(amt, currency)) : "Không phát sinh tiền thì nhập 0."}
                </small></label>
              <label className="field"><span>Thuế</span>
                <select id="loa-tax" className="input" value={tax} onChange={(e) => setTax(e.target.value)}>
                  {Object.entries(LOA_TAX).map(([k, l]) => <option key={k} value={k}>{l}</option>)}
                </select></label>
              <label className="field"><span>Ngân sách *</span>
                <select id="loa-budget" className="input" value={budget} onChange={(e) => setBudget(e.target.value)}>
                  {Object.entries(LOA_BUDGET).map(([k, l]) => <option key={k} value={k}>{l}</option>)}
                </select></label>
            </div>
            {currency !== "VND" && payReceive === "chi" ? <p className="muted small" style={{ margin: 0 }}>Lưu ý: tạm ứng và đề nghị thanh toán chỉ tham chiếu được LOA chi tiền bằng VND.</p> : null}
            <Switch id="loa-has-budget-no" checked={hasBudgetNo} onChange={setHasBudgetNo}>Có mã khoản mục ngân sách</Switch>
            {hasBudgetNo ? (
              <label className="field"><span>Mã khoản mục ngân sách</span>
                <input id="loa-budget-no" className="input" value={budgetNo} maxLength={60} onChange={(e) => setBudgetNo(e.target.value)} placeholder="VD: NS2027-BT-03" /></label>
            ) : null}
          </section>

          {/* ---------- Chi tiết và dự toán ---------- */}
          <h2 className="dn-h dn-h-out">Chi tiết và dự toán ngân sách</h2>
          <section className="card dn-sec">
            <label className="field"><span>Chi tiết</span>
              <textarea id="loa-details" className="input" style={{ minHeight: 120 }} value={details} maxLength={8000} onChange={(e) => setDetails(e.target.value)} />
              <small className="muted">Phương án, so sánh báo giá, điều khoản chính, tiến độ…</small></label>
          </section>
          {lines.map((l, i) => (
            <fieldset key={i} className="card dn-line">
              <legend>Dự toán dòng {i + 1}</legend>
              <label className="field"><span>Nội dung *</span>
                <input className="input" value={l.description} maxLength={300} onChange={(e) => setLine(i, { description: e.target.value })} placeholder="VD: Sơn nước ngoại thất" /></label>
              <div className="dn-fields">
                <label className="field"><span>Đơn vị tính</span>
                  <input className="input" value={l.unit} maxLength={20} onChange={(e) => setLine(i, { unit: e.target.value })} placeholder="thùng, m², gói…" /></label>
                <label className="field"><span>Số lượng</span>
                  <input className="input num" inputMode="decimal" value={l.quantity} onChange={(e) => setLine(i, { quantity: e.target.value })} /></label>
                <label className="field"><span>Đơn giá</span>
                  <input className="input num" inputMode="decimal" value={l.unit_price} onChange={(e) => setLine(i, { unit_price: e.target.value })} placeholder="VD: 1.500.000 hoặc 1tr5" /></label>
                <label className="field"><span>Ghi chú</span>
                  <input className="input" value={l.note} maxLength={300} onChange={(e) => setLine(i, { note: e.target.value })} /></label>
              </div>
              <div className="dn-calc num">Thành tiền <b>{moneyCur(lineAmount(l), currency)}</b></div>
              <button type="button" className="btn ghost" style={{ color: "var(--danger)" }} onClick={() => setLines(lines.filter((_, k) => k !== i))}>Xoá dòng {i + 1}</button>
            </fieldset>
          ))}
          <button type="button" className="btn secondary block" onClick={() => setLines([...lines, emptyLine()])}>+ Thêm dòng dự toán</button>
          {lines.length ? (
            <section className="card dn-sec">
              <div className="row" style={{ justifyContent: "space-between", flexWrap: "wrap" }}>
                <Switch id="loa-autosum" checked={autosum} onChange={setAutosum}>Tự cộng dự toán vào số tiền</Switch>
                <span className="num">Tổng dự toán: <b>{moneyCur(total, currency)}</b></span>
              </div>
              {!useSum && amt != null && amt !== total ? <p className="err-text small" style={{ margin: 0 }}>Số tiền xin duyệt ({moneyCur(amt, currency)}) khác tổng dự toán ({moneyCur(total, currency)}).</p> : null}
            </section>
          ) : null}

          {/* ---------- Thời gian, tham chiếu, tệp ---------- */}
          <section className="card dn-sec">
            <h2 className="dn-h">Thời gian và tài liệu</h2>
            <div className="dn-fields">
              <label className="field"><span>Ngày bắt đầu *</span>
                <input id="loa-start" type="date" className="input" value={start} onChange={(e) => setStart(e.target.value)} /></label>
              <label className="field"><span>Hạn báo cáo kết quả *</span>
                <input id="loa-due" type="date" className="input" value={reportDue} min={start || todayVN()} onChange={(e) => setReportDue(e.target.value)} />
                <small className="muted">Ngày người lập báo cáo lại kết quả thực hiện.</small></label>
              {buildings.length ? (
                <label className="field"><span>Toà nhà liên quan</span>
                  <select id="loa-building" className="input" value={buildingId} onChange={(e) => setBuildingId(e.target.value)}>
                    <option value="">Không gắn toà</option>
                    {buildings.map((b) => <option key={b.id} value={b.id}>{b.code} · {b.name}</option>)}
                  </select></label>
              ) : null}
            </div>
            <Switch id="loa-has-ref" checked={hasRef} onChange={setHasRef}>Có LOA tham chiếu</Switch>
            {hasRef ? (
              <label className="field"><span>LOA tham chiếu</span>
                <select id="loa-ref" className="input" value={refId} onChange={(e) => setRefId(e.target.value)}>
                  <option value="">Chọn LOA</option>
                  {refOptions.map((x) => <option key={x.id} value={x.id}>{x.doc_no ?? "—"} · {x.reason}</option>)}
                </select>
                {!refOptions.length ? <small className="muted">Chưa có LOA nào đã trình mà bạn xem được.</small> : null}</label>
            ) : null}
          </section>

          {editing && id ? (
            <FileGallery owner={{ kind: "dinh_kem_de_nghi", requestId: id }} title="Tài liệu đính kèm" docTypes={LOA_DOC_TYPE}
              hint="Dự toán, báo giá, hợp đồng… (ảnh hoặc PDF, tối đa 10 MB mỗi tệp). Chọn loại tài liệu trước khi bấm Thêm."
              canUpload canDelete />
          ) : (
            <section className="card dn-attach">
              <b>Tài liệu đính kèm</b>
              <p className="muted small" style={{ margin: 0 }}>Dự toán, báo giá, hợp đồng… (ảnh hoặc PDF, tối đa 10 MB mỗi tệp). Tệp được tải lên khi bạn bấm Lưu nháp hoặc Trình duyệt.</p>
              <input ref={fileRef} type="file" accept="image/*,application/pdf" multiple hidden onChange={(e) => pickFiles(e.target.files)} />
              <div className="row" style={{ flexWrap: "wrap", alignItems: "flex-end" }}>
                <label className="field" style={{ flex: "1 1 180px" }}><span>Loại tài liệu</span>
                  <select id="loa-doc-type" className="input" value={docType} onChange={(e) => setDocType(e.target.value)}>
                    {Object.entries(LOA_DOC_TYPE).map(([k, l]) => <option key={k} value={k}>{l}</option>)}
                  </select></label>
                <button type="button" className="btn secondary" style={{ flex: "1 1 160px" }} onClick={() => fileRef.current?.click()}>+ Chọn tệp</button>
              </div>
              {pending.length ? (
                <ul className="dn-list">
                  {pending.map((f, i) => (
                    <li key={i}><span>{f.file.name} <small className="muted">· {LOA_DOC_TYPE[f.label]}</small></span>
                      <button type="button" className="btn ghost" aria-label={`Bỏ ${f.file.name}`} onClick={() => setPending(pending.filter((_, k) => k !== i))}>Bỏ</button></li>
                  ))}
                </ul>
              ) : null}
            </section>
          )}

          {/* ---------- Người cùng soạn ---------- */}
          <section className="card dn-sec">
            <h2 className="dn-h">Người cùng soạn</h2>
            <p className="muted small" style={{ margin: 0 }}>Người cùng soạn sửa được tờ trình khi còn nháp hoặc bị trả lại. Thêm khi cần nhiều người cùng điền. Chỉ người lập mới bấm Trình duyệt.</p>
            <PeoplePicker id="loa-cowriter" label="Thêm người cùng soạn" people={staff.filter((p) => !cowriters.includes(p.id))} onAdd={(v) => { setCowriters([...cowriters, v]); setViewers(viewers.filter((x) => x !== v)); }} />
            <PickedList ids={cowriters} name={name} onRemove={(v) => setCowriters(cowriters.filter((x) => x !== v))} empty="Chưa có người cùng soạn." />
          </section>

          {/* ---------- Người được xem ---------- */}
          <section className="card dn-sec">
            <h2 className="dn-h">Người được xem</h2>
            <p className="muted small" style={{ margin: 0 }}>Sau khi trình duyệt, người và phòng ban ở đây xem được tờ trình. Khi LOA đã duyệt, họ gắn được LOA này vào đề nghị tạm ứng, thanh toán của mình. Các cấp duyệt và Quản lý luôn xem được.</p>
            <div className="field"><span>Đơn vị được xem</span>
              <div className="opt-grid" role="group" aria-label="Đơn vị được xem">
                {depts.map((d) => (
                  <button type="button" key={d.id} role="checkbox" aria-checked={viewerDepts.includes(d.id)} className="opt" onClick={() => toggle(viewerDepts, setViewerDepts, d.id)}>{d.name}</button>
                ))}
              </div></div>
            <PeoplePicker id="loa-viewer" label="Thêm cá nhân được xem" people={staff.filter((p) => !viewers.includes(p.id) && !cowriters.includes(p.id))} onAdd={(v) => setViewers([...viewers, v])} />
            <PickedList ids={viewers} name={name} onRemove={(v) => setViewers(viewers.filter((x) => x !== v))} empty="Chưa có cá nhân nào." />
          </section>

          <div ref={chainRef}>{isOwner ? <ChainPreview kind="loa" /> : <p className="muted small" style={{ margin: 0 }}>Luồng duyệt tính theo người lập ({name(ownerId)}): Leader → Trưởng phòng → Kế toán → Giám đốc.</p>}</div>

          {err ? <div className="error-box" role="alert">{err}</div> : null}
          <div className="dn-submit loa-submit">
            <div className="dn-total-words">
              {amt ? <><b className="num">{moneyCur(amt, currency)}</b>{currency === "VND" ? <small>{vndWords(amt)}</small> : null}</>
                : <small>{isOwner ? "Lưu nháp để làm tiếp sau, hoặc Trình duyệt để bắt đầu luồng duyệt." : "Bạn là người cùng soạn: lưu nháp, người lập sẽ trình duyệt."}</small>}
            </div>
            <div className="row">{Actions}</div>
          </div>
          {editing ? <p className="muted small" style={{ margin: 0 }}><Link to={`/van-phong/${id}`} className="dt-link">Xem tờ trình</Link> để in hoặc xoá bản nháp.</p> : null}
        </form>
      </main>

      <Sheet open={copyOpen} onClose={() => setCopyOpen(false)} title="Sao chép từ LOA khác">
        <div className="stack">
          <p className="muted small" style={{ margin: 0 }}>Chọn một tờ trình để lấy nội dung, số tiền và dự toán. Ngày, tệp đính kèm, người cùng soạn và người được xem không sao chép.</p>
          <input className="input" placeholder="Tìm số LOA, tiêu đề, người lập…" value={copyText} onChange={(e) => setCopyText(e.target.value)} />
          {copyList.length ? (
            <ul className="dn-list">
              {copyList.slice(0, 30).map((x) => (
                <li key={x.id}><span><b className="num">{x.doc_no ?? "Bản nháp"}</b> · {x.reason}<br /><small className="muted">{name(x.requester_id)} · {statusLabel({ kind: "loa", status: x.status })}</small></span>
                  <button type="button" className="btn secondary sm" onClick={() => copyFrom(x)}>Chọn</button></li>
              ))}
            </ul>
          ) : <p className="muted small" style={{ margin: 0 }}>Không tìm thấy tờ trình nào.</p>}
        </div>
      </Sheet>
    </>
  );
}

function PeoplePicker({ id, label, people, onAdd }: { id: string; label: string; people: { id: string; full_name: string }[]; onAdd: (id: string) => void }) {
  return (
    <label className="field"><span>{label}</span>
      <select id={id} className="input" value="" onChange={(e) => { if (e.target.value) onAdd(e.target.value); }}>
        <option value="">Chọn nhân viên…</option>
        {people.map((p) => <option key={p.id} value={p.id}>{p.full_name}</option>)}
      </select></label>
  );
}

function PickedList({ ids, name, onRemove, empty }: { ids: string[]; name: (id: string) => string; onRemove: (id: string) => void; empty: string }) {
  if (!ids.length) return <p className="muted small" style={{ margin: 0 }}>{empty}</p>;
  return (
    <ul className="dn-list">
      {ids.map((u) => (
        <li key={u}><span>{name(u)}</span><button type="button" className="btn ghost" aria-label={`Bỏ ${name(u)}`} onClick={() => onRemove(u)}>Bỏ</button></li>
      ))}
    </ul>
  );
}
