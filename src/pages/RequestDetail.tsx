import { useCallback, useEffect, useState, type FormEvent } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { RelatedPanel } from "../components/RelatedPanel";
import { friendlyError, supabase } from "../lib/supabase";
import { useSession } from "../lib/session";
import { clock, daysBetween, todayVN } from "../lib/dates";
import { vnd, vndWords } from "../lib/money";
import { EDIT_LOCK_TIP, LEAVE_SPAN, LEAVE_TYPE, LOA_DOC_TYPE, OUT_TYPE, PAY_METHOD, PAY_TYPE, deleteRequest, fmtDays, fullDate, hhmm, isEditableStatus, kindLabel, statusLabel, summary, type LoaDetails, type Req, type ReqStep } from "../lib/office";
import { Empty, Icon, Sheet, TopBar } from "../components/ui";
import DecideSheet, { type DecideMode } from "../components/DecideSheet";
import FileGallery from "../components/FileGallery";
import DnttView from "../components/DnttView";
import LoaView, { LoaBudget } from "../components/LoaView";
import { ApprovalSteps } from "../components/ApprovalChain";
import { KIND_ICON, LeaveBalance } from "./Office";
import { CostGrid, CostTable, LegGrid, LegTable } from "../components/TripGrids";
import { TRIP_TYPE, VISA_TYPE, costFilled, costFromRow, costTotal, emptyCost, emptyLeg, legFilled, legFromRow, loadTrip, saveTrip, type CostDraft, type LegDraft, type TripCost, type TripLeg } from "../lib/trip";
import { PurchaseTable } from "../components/PurchaseGrid";
import { loadPLines, type PLine } from "../lib/purchase";
import "../office.css";

export default function RequestDetail() {
  const { id } = useParams();
  const { profile, people, buildings, isManager, isAccountant, isHr, toast, refreshUnread } = useSession();
  const nav = useNavigate();
  const [r, setR] = useState<Req | null>(null);
  const [steps, setSteps] = useState<ReqStep[]>([]);
  const [notFound, setNotFound] = useState(false);
  const [busy, setBusy] = useState(false);
  const [decide, setDecide] = useState<DecideMode | null>(null);
  const [confirm, setConfirm] = useState<null | "huy" | "chi" | "xoa">(null);
  const [report, setReport] = useState(false);
  const [aStart, setAStart] = useState("");
  const [aEnd, setAEnd] = useState("");
  const [trip, setTrip] = useState<{ planLegs: TripLeg[]; actLegs: TripLeg[]; planCosts: TripCost[]; actCosts: TripCost[] } | null>(null);
  const [aLegs, setALegs] = useState<LegDraft[]>([]);
  const [aCosts, setACosts] = useState<CostDraft[]>([]);
  const [linked, setLinked] = useState<{ id: string; kind: string; doc_no: string | null; amount: number | null; status: string; created_at: string; can_open: boolean }[]>([]);
  const [tripOf, setTripOf] = useState<Req | null>(null);   // chuyến công tác gốc của đề nghị tạm ứng / thanh toán
  const [hrOpen, setHrOpen] = useState(false);
  const [hrNote, setHrNote] = useState("");
  const [proj, setProj] = useState<{ id: string; code: string | null; name: string; item: string | null } | null>(null);
  const [aNote, setANote] = useState("");
  const [err, setErr] = useState<string | null>(null);
  const [uncCount, setUncCount] = useState(0);
  const [loa, setLoa] = useState<LoaDetails | null>(null);   // chỉ có khi đây là tờ trình (LOA)
  const [loaCanEdit, setLoaCanEdit] = useState(false);       // người lập hoặc người cùng soạn, khi còn sửa được
  // Đề nghị mua hàng: danh sách hàng + các đề nghị thanh toán tham chiếu; thanh toán: đề nghị mua hàng gốc
  const [pLines, setPLines] = useState<PLine[]>([]);
  const [prPays, setPrPays] = useState<{ id: string; doc_no: string | null; reason: string | null; amount: number; status: string; requester_name: string | null; created_at: string; can_open: boolean }[]>([]);
  const [prOf, setPrOf] = useState<{ id: string; doc_no: string | null; reason: string; amount: number } | null>(null);

  const load = useCallback(async () => {
    const [{ data }, st] = await Promise.all([
      supabase.from("requests").select("*").eq("id", id!).maybeSingle(),
      supabase.from("request_steps").select("*").eq("request_id", id!).order("step_no"),
    ]);
    if (!data) { setNotFound(true); return; }
    if ((data as Req).kind === "loa") {
      const [d, can] = await Promise.all([
        supabase.from("loa_details").select("*").eq("request_id", id!).maybeSingle(),
        supabase.rpc("loa_can_edit", { p_loa: id! }),
      ]);
      setLoa((d.data as LoaDetails | null) ?? null); setLoaCanEdit(!!can.data);
    } else { setLoa(null); setLoaCanEdit(false); }
    const rq = data as Req;
    if (rq.kind === "cong_tac") {
      const [t, lk] = await Promise.all([loadTrip(rq.id), supabase.rpc("trip_linked", { p_trip: rq.id })]);
      setTrip(t); setLinked((lk.data ?? []) as typeof linked);
    } else { setTrip(null); setLinked([]); }
    if (rq.project_id) {
      const [pj, it] = await Promise.all([
        supabase.from("projects").select("id,code,name").eq("id", rq.project_id).maybeSingle(),
        rq.project_item_id ? supabase.from("project_items").select("name").eq("id", rq.project_item_id).maybeSingle() : Promise.resolve({ data: null }),
      ]);
      setProj(pj.data ? { ...(pj.data as { id: string; code: string | null; name: string }), item: (it.data as { name: string } | null)?.name ?? null } : null);
    } else setProj(null);
    if (rq.kind === "mua_hang") {
      const [pl, lk] = await Promise.all([loadPLines(rq.id), supabase.rpc("purchase_linked", { p_pr: rq.id })]);
      setPLines(pl); setPrPays((lk.data ?? []) as typeof prPays);
    } else { setPLines([]); setPrPays([]); }
    if (rq.purchase_id) {
      const { data: pr } = await supabase.from("requests").select("id,doc_no,reason,amount").eq("id", rq.purchase_id).maybeSingle();
      setPrOf((pr as typeof prOf) ?? null);
    } else setPrOf(null);
    if (rq.trip_id) {
      const { data: t } = await supabase.from("requests").select("*").eq("id", rq.trip_id).maybeSingle();
      setTripOf((t as Req | null) ?? null);
    } else setTripOf(null);
    setR(data as Req);
    setSteps((st.data ?? []) as ReqStep[]);
  }, [id]);
  useEffect(() => { load(); }, [load]);
  useEffect(() => {
    const h = () => load();
    window.addEventListener("neo:notification", h);
    return () => window.removeEventListener("neo:notification", h);
  }, [load]);
  useEffect(() => {
    if (!id || !profile) return;
    supabase.from("notifications").update({ read_at: new Date().toISOString() }).eq("entity_id", id).is("read_at", null)
      .then(() => refreshUnread());
  }, [id, profile, refreshUnread]);

  if (notFound) return (<><TopBar title="Đề nghị" back="/van-phong" /><main className="main"><Empty title="Không tìm thấy đề nghị">Có thể bạn không có quyền xem đề nghị này.</Empty></main></>);
  if (!r || !profile) return (<><TopBar title="Đề nghị" back="/van-phong" /><div className="loading">Đang tải…</div></>);

  const name = (uid: string | null) => people.find((p) => p.id === uid)?.full_name ?? "—";
  const requester = people.find((p) => p.id === r.requester_id);
  const mine = r.requester_id === profile.id;
  const isMoney = r.kind === "thanh_toan" || r.kind === "tam_ung";
  const isLoa = r.kind === "loa";
  const isBuy = r.kind === "mua_hang";
  const prPaid = prPays.filter((x) => x.status === "da_duyet" || x.status === "hoan_tat").reduce((a, x) => a + Number(x.amount), 0);
  const prPending = prPays.filter((x) => x.status === "cho_duyet").reduce((a, x) => a + Number(x.amount), 0);
  const noun = isLoa ? "tờ trình" : "đề nghị";
  const Noun = isLoa ? "Tờ trình" : "Đề nghị";
  const today = todayVN();
  const curStep = r.status === "cho_duyet" ? steps.find((x) => x.status === "cho") : undefined;
  const canDecide = !!curStep && !mine && (curStep.approver_id === profile.id || (curStep.approver_id === null && isManager));
  const editable = isEditableStatus(r.status);                       // không đang trong quá trình duyệt
  const canEdit = isLoa ? loaCanEdit : mine && editable;
  const canDelete = (mine || isManager) && editable;
  const editUrl = isLoa ? `/van-phong/loa/${r.id}/sua` : `/van-phong/${r.id}/sua`;
  // Tệp tờ trình: sửa được tới khi duyệt xong (khớp storage_path_ok)
  const loaFiles = isLoa && r.status !== "da_duyet" && (mine || loaCanEdit || (isManager && r.status !== "nhap"));
  const sentAt = loa?.submitted_at ?? r.created_at;
  const listUrl = `/van-phong/ds/${r.kind}`;
  const canPay = isMoney && r.status === "da_duyet" && (isManager || isAccountant);
  const canCancel = mine && (r.status === "cho_duyet" || (r.status === "da_duyet" && !isMoney && !isLoa && r.start_date > today));
  const canReport = mine && r.kind === "cong_tac" && (r.status === "da_duyet" || r.status === "hoan_tat");
  const building = buildings.find((b) => b.id === r.building_id);

  async function update(patch: Partial<Req>, msg: string) {
    setBusy(true); setErr(null);
    const { data, error } = await supabase.from("requests").update(patch).eq("id", r!.id).select("*").single();
    setBusy(false);
    if (error) { setErr(friendlyError(error)); toast(friendlyError(error)); return false; }
    setR(data as Req);
    toast(msg);
    refreshUnread();
    return true;
  }

  async function markPaid() {
    setBusy(true); setErr(null);
    const { error } = await supabase.rpc("mark_paid", { p_request: r!.id });
    setBusy(false);
    if (error) { setErr(friendlyError(error)); toast(friendlyError(error)); return false; }
    toast(r!.kind === "thanh_toan" ? "Đã kết thúc đề nghị thanh toán." : "Đã kết thúc đề nghị tạm ứng."); await load(); refreshUnread();
    return true;
  }

  function openReport() {
    setAStart(r!.actual_start ?? r!.start_date);
    setAEnd(r!.actual_end ?? r!.end_date ?? r!.start_date);
    const t = trip;
    const me = r!.traveler_id ?? r!.requester_id;
    setALegs(t?.actLegs.length ? t.actLegs.map(legFromRow) : t?.planLegs.length ? t.planLegs.map(legFromRow) : [emptyLeg(me)]);
    setACosts(t?.actCosts.length ? t.actCosts.map(costFromRow) : t?.planCosts.length ? t.planCosts.map(costFromRow) : [emptyCost()]);
    setANote(r!.actual_note ?? "");
    setErr(null); setReport(true);
  }

  async function submitReport(e: FormEvent) {
    e.preventDefault();
    if (aEnd < aStart) { setErr("Ngày về phải sau ngày đi."); return; }
    const badCost = aCosts.findIndex((c) => costFilled(c) && !c.category.trim());
    if (badCost >= 0) { setErr(`Bảng kê dòng ${badCost + 1}: nhập hạng mục.`); return; }
    const locked = !!r!.hr_confirmed_at;
    setBusy(true); setErr(null);
    const te = await saveTrip(r!.id, "thuc_te", locked ? null : aLegs.filter(legFilled), aCosts.filter(costFilled));
    setBusy(false);
    if (te) { setErr(friendlyError({ message: te })); return; }
    const patch: Partial<Req> = { actual_note: aNote.trim() || null, status: "hoan_tat" };
    if (!locked) { patch.actual_start = aStart; patch.actual_end = aEnd; }
    const ok = await update(patch, r!.status === "hoan_tat" ? "Đã lưu thực tế công tác và bảng kê." : "Đã gửi thực tế công tác. Nhân sự sẽ xác nhận ngày công.");
    if (ok) { setReport(false); load(); }
  }

  async function hrConfirm(ok: boolean) {
    setBusy(true); setErr(null);
    const { error } = await supabase.rpc("trip_hr_confirm", { p_request: r!.id, p_confirm: ok, p_note: hrNote.trim() || null });
    setBusy(false);
    if (error) { setErr(friendlyError(error)); return; }
    setHrOpen(false); toast(ok ? "Đã xác nhận ngày công tác." : "Đã bỏ xác nhận."); load();
  }
  const isTrip = r.kind === "cong_tac";
  const canHr = isTrip && r.status === "hoan_tat" && (isHr || isManager);
  const tripOwner = isTrip && (mine || r.traveler_id === profile.id);
  const LINK_STATUS: Record<string, string> = { nhap: "Nháp", cho_duyet: "Chờ duyệt", da_duyet: "Đã duyệt", tra_lai: "Trả lại", tu_choi: "Từ chối", da_huy: "Đã rút", hoan_tat: "Hoàn tất" };

  const actualDays = r.actual_start && r.actual_end ? daysBetween(r.actual_start, r.actual_end) + 1 : null;

  return (
    <>
      <TopBar title={kindLabel(r)} back={listUrl} />
      <main className={`main stack${isMoney || isLoa || r.kind === "cong_tac" ? " main-wide" : ""}`}>
        <section className={`card rq-head k-${r.kind}`}>
          <div className="row" style={{ justifyContent: "space-between" }}>
            <span className="rq-ico" aria-hidden="true">{KIND_ICON[r.kind]}</span>
            <span className={`rq-pill ${r.status}`}>{statusLabel(r)}</span>
          </div>
          <h2 className="num">{isMoney || isBuy ? vnd(r.amount) : summary(r)}</h2>
          {isBuy ? <p style={{ margin: 0, fontWeight: 600 }}>{r.doc_no ? `${r.doc_no} · ` : ""}{r.reason}</p> : null}
          {(isMoney || isBuy) && r.amount ? <p className="muted" style={{ margin: 0, fontSize: 13 }}>{vndWords(r.amount)}</p> : null}
          {isLoa ? <p style={{ margin: 0, fontWeight: 600 }}>{r.doc_no ? `${r.doc_no} · ` : ""}{r.reason}</p> : null}
          <p className="muted" style={{ margin: 0 }}>{requester?.full_name ?? "—"} · {isLoa ? (loa?.submitted_at ? `trình ${clock(loa.submitted_at)}` : `lập ${clock(r.created_at)}`) : `gửi ${clock(r.created_at)}`}</p>
        </section>

        {r.status === "nhap" ? (
          <div className="ok-box"><b>Bản nháp, chưa trình duyệt.</b> Chỉ người lập và người cùng soạn nhìn thấy. Bấm “Sửa bản nháp” để điền tiếp và trình duyệt.</div>
        ) : null}

        {r.status === "tu_choi" && r.decision_note ? (
          <div className="error-box"><b>Lý do từ chối:</b> {r.decision_note}</div>
        ) : null}
        {r.status === "tra_lai" ? (
          <div className="error-box"><b>{Noun} bị trả lại để sửa.</b>{r.decision_note ? ` Lý do: ${r.decision_note}` : ""}{mine ? ` Bấm “${isLoa ? "Sửa và trình lại" : "Sửa và gửi lại"}” bên dưới; ${noun} sẽ được duyệt lại từ cấp đầu.` : ""}</div>
        ) : null}

        {isLoa ? (loa ? <LoaView r={r} d={loa} /> : null) : (
        <dl className="card kv">
          {r.kind === "nghi_phep" ? (<>
            <dt>Loại nghỉ</dt><dd>{LEAVE_TYPE[r.sub_type ?? ""]}</dd>
            <dt>Thời gian</dt><dd>{LEAVE_SPAN[r.span ?? ""]}</dd>
            <dt>{r.span === "ca_ngay" ? "Từ – đến" : "Ngày"}</dt>
            <dd className="num">{fullDate(r.start_date)}{r.span === "ca_ngay" && r.end_date !== r.start_date ? ` – ${fullDate(r.end_date)}` : ""}</dd>
            <dt>Số ngày</dt><dd className="num">{fmtDays(r.days)}</dd>
          </>) : null}
          {r.kind === "ra_ngoai" ? (<>
            <dt>Hình thức</dt><dd>{OUT_TYPE[r.sub_type ?? ""]}</dd>
            <dt>Ngày</dt><dd className="num">{fullDate(r.start_date)}{r.end_date && r.end_date !== r.start_date ? ` – ${fullDate(r.end_date)}` : ""}</dd>
            {r.start_time || r.end_time ? (<><dt>Giờ</dt><dd className="num">{hhmm(r.start_time) || "—"}{r.end_time ? ` → quay lại ${hhmm(r.end_time)}` : ""}</dd></>) : null}
            {r.location ? (<><dt>Đi đâu</dt><dd>{r.location}</dd></>) : null}
          </>) : null}
          {r.kind === "cong_tac" ? (<>
            {r.doc_no ? (<><dt>Số đăng ký</dt><dd className="num">{r.doc_no}</dd></>) : null}
            <dt>Người đi</dt><dd>{name(r.traveler_id ?? r.requester_id)}</dd>
            <dt>Loại công tác</dt><dd>{TRIP_TYPE[r.trip_type ?? "trong_nuoc"]}{r.trip_type === "nuoc_ngoai" && r.visa_type ? ` · ${VISA_TYPE[r.visa_type]}` : ""}</dd>
            {r.trip_area ? (<><dt>Khu vực</dt><dd>{r.trip_area}</dd></>) : null}
            <dt>Nơi công tác</dt><dd>{r.location}{r.transport ? ` · ${r.transport}` : ""}</dd>
            <dt>Kế hoạch</dt><dd className="num">{fullDate(r.start_date)} – {fullDate(r.end_date)} ({fmtDays(r.days)})</dd>
            {r.amount ? (<><dt>Dự trù</dt><dd className="num">{vnd(r.amount)}</dd></>) : null}
          </>) : null}
          {isBuy ? (<>
            {r.doc_no ? (<><dt>Số chứng từ</dt><dd className="num">{r.doc_no}{r.doc_date ? ` · ${fullDate(r.doc_date)}` : ""}</dd></>) : null}
            <dt>Tổng dự kiến</dt><dd className="num"><b>{vnd(r.amount)}</b></dd>
            <dt>Ngày cần hàng</dt><dd className="num">{fullDate(r.start_date)}</dd>
            {r.payee ? (<><dt>Nhà cung cấp đề xuất</dt><dd>{r.payee}</dd></>) : null}
            {r.loa_no ? (<><dt>LOA tham khảo</dt><dd className="num">{r.loa_id ? <Link to={`/van-phong/${r.loa_id}`}>{r.loa_no}</Link> : r.loa_no}</dd></>) : null}
          </>) : null}
          {r.kind === "thanh_toan" && prOf ? (<><dt>Đề nghị mua hàng</dt><dd><Link to={`/van-phong/${prOf.id}`}>{prOf.doc_no ?? "MH"} · {prOf.reason}</Link> <span className="muted num">({vnd(prOf.amount)})</span></dd></>) : null}
          {(isMoney || isBuy) && proj ? (<><dt>Dự án</dt><dd><Link to={`/du-an/${proj.id}`}>{proj.code} · {proj.name}</Link>{proj.item ? ` · ${proj.item}` : ""}</dd></>) : null}
          {isMoney && tripOf ? (<><dt>Chuyến công tác</dt><dd><Link to={`/van-phong/${tripOf.id}`}>{tripOf.doc_no ? `${tripOf.doc_no} · ` : ""}{tripOf.location} ({fullDate(tripOf.actual_start ?? tripOf.start_date)})</Link></dd></>) : null}
          {isMoney ? (<>
            {r.doc_no ? (<><dt>Số chứng từ</dt><dd className="num">{r.doc_no}{r.doc_date ? ` · ${fullDate(r.doc_date)}` : ""}</dd></>) : null}
            <dt>Số tiền</dt><dd className="num"><b>{vnd(r.amount)}</b></dd>
            <dt>{r.kind === "thanh_toan" ? "Ngày cần TT" : "Cần trước"}</dt><dd className="num">{fullDate(r.start_date)}</dd>
            {r.kind === "thanh_toan" && r.pay_type ? (<><dt>Loại thanh toán</dt><dd>{PAY_TYPE[r.pay_type] ?? r.pay_type}</dd></>) : null}
            {r.loa_no ? (<><dt>Số LOA</dt><dd className="num">{r.loa_no}</dd></>) : null}
            {r.kind === "tam_ung" && r.settle_due ? (<><dt>Hạn hoàn ứng</dt><dd className="num">{fullDate(r.settle_due)}</dd></>) : null}
            {r.payee ? (<><dt>{r.kind === "thanh_toan" ? "Đơn vị nhận" : "Người nhận"}</dt><dd>{r.payee}{r.vendor_code ? ` (${r.vendor_code})` : ""}</dd></>) : null}
            {r.contact_name || r.contact_code ? (<><dt>Liên hệ</dt><dd>{[r.contact_name, r.contact_code].filter(Boolean).join(" · ")}</dd></>) : null}
            <dt>Hình thức</dt><dd>{r.pay_method ? PAY_METHOD[r.pay_method] : r.bank_info ? "Chuyển khoản" : "Tiền mặt"}{r.bank_info ? ` — ${r.bank_info}` : ""}</dd>
          </>) : null}
          <dt>{isMoney ? "Nội dung" : isBuy || r.kind === "cong_tac" ? "Mục đích" : r.kind === "ra_ngoai" ? "Công việc" : "Lý do"}</dt><dd className="desc">{r.reason}</dd>
          {building ? (<><dt>Toà nhà</dt><dd>{building.code} · {building.name}</dd></>) : null}
          {r.handover_to ? (<><dt>Bàn giao cho</dt><dd>{name(r.handover_to)}</dd></>) : null}
          {r.contact_phone ? (<><dt>SĐT liên hệ</dt><dd className="num">{r.contact_phone}</dd></>) : null}
        </dl>
        )}

        {isTrip && trip ? (
          <>
            <div className="section-title">Kế hoạch công tác</div>
            <LegTable legs={trip.planLegs} people={people} />
            <div className="section-title">Chi phí dự trù</div>
            <CostTable costs={trip.planCosts} />
          </>
        ) : null}

        {isBuy ? (
          <>
            <div className="section-title">Danh sách hàng cần mua</div>
            <PurchaseTable lines={pLines} />
            <FileGallery owner={{ kind: "dinh_kem_de_nghi", requestId: r.id }} title="Báo giá đính kèm"
              hint="Báo giá, hình ảnh mẫu hàng (ảnh hoặc PDF, tối đa 10 MB mỗi tệp)."
              canUpload={isManager || (mine && (r.status === "cho_duyet" || editable))}
              canDelete={isManager || (mine && editable)} />
            {r.status === "da_duyet" || r.status === "hoan_tat" || prPays.length ? (
              <>
                <div className="section-title">Thanh toán theo đề nghị mua hàng này</div>
                <div className="card stack" style={{ gap: 8 }}>
                  <p className="num" style={{ margin: 0 }}>Duyệt mua <b>{vnd(r.amount)}</b> · đã duyệt chi <b>{vnd(prPaid)}</b>{prPending ? <> · đang chờ duyệt <b>{vnd(prPending)}</b></> : null} · còn <b className={Number(r.amount) - prPaid - prPending < 0 ? "err-text" : ""}>{vnd(Number(r.amount) - prPaid - prPending)}</b></p>
                  {prPays.length ? (
                    <ul className="plain-list">
                      {prPays.map((x) => (
                        <li key={x.id}>
                          {x.can_open ? <Link to={`/van-phong/${x.id}`}>Thanh toán {x.doc_no ?? ""}</Link> : <span>Thanh toán {x.doc_no ?? ""}</span>}
                          <span className="muted"> · {x.requester_name ?? "?"} · </span><b className="num">{vnd(x.amount)}</b>
                          <span className="muted"> · {statusLabel({ kind: "thanh_toan", status: x.status as Req["status"] })}</span>
                        </li>
                      ))}
                    </ul>
                  ) : <p className="muted" style={{ margin: 0 }}>Chưa có đề nghị thanh toán nào tham chiếu.</p>}
                  {r.status === "da_duyet" || r.status === "hoan_tat" ? (
                    <Link className="btn secondary sm" style={{ justifySelf: "start" }} to={`/van-phong/moi/thanh_toan?mh=${r.id}`}>Lập đề nghị thanh toán theo đề nghị này</Link>
                  ) : null}
                </div>
              </>
            ) : null}
          </>
        ) : null}

        {(isMoney || isBuy) && r.loa_id ? <LoaBudget loaId={r.loa_id} loaNo={r.loa_no} refreshKey={r.updated_at} /> : null}

        {isLoa ? (
          <FileGallery owner={{ kind: "dinh_kem_de_nghi", requestId: r.id }} title="Tài liệu đính kèm" docTypes={LOA_DOC_TYPE}
            hint={r.status === "da_duyet" ? "Tờ trình đã duyệt xong, tài liệu đã khoá." : "Dự toán, báo giá, hợp đồng… (ảnh hoặc PDF, tối đa 10 MB mỗi tệp)."}
            canUpload={loaFiles} canDelete={loaFiles} />
        ) : null}

        {r.kind === "cong_tac" && r.status === "hoan_tat" ? (
          <>
            <div className="section-title">Thực tế công tác</div>
            <dl className="card kv">
              <dt>Thời gian</dt><dd className="num">{fullDate(r.actual_start)} – {fullDate(r.actual_end)}{actualDays ? ` (${fmtDays(actualDays)})` : ""}
                {actualDays && r.days && actualDays !== Number(r.days) ? <span className="diff"> {actualDays > Number(r.days) ? "+" : "−"}{fmtDays(Math.abs(actualDays - Number(r.days)))} so với kế hoạch</span> : null}</dd>
              <dt>Chi phí</dt><dd className="num">{r.actual_cost != null ? vnd(r.actual_cost) : "—"}
                {r.actual_cost != null && r.amount ? <span className={`diff${r.actual_cost > r.amount ? " over" : ""}`}> {r.actual_cost > r.amount ? "vượt" : "dưới"} dự trù {vnd(Math.abs(r.actual_cost - r.amount))}</span> : null}</dd>
              {r.actual_note ? (<><dt>Kết quả</dt><dd className="desc">{r.actual_note}</dd></>) : null}
              <dt>Nhân sự xác nhận</dt><dd>{r.hr_confirmed_at
                ? <span className="ok-text">{Icon.check} {name(r.hr_confirmed_by ?? null)} · {clock(r.hr_confirmed_at)}{r.hr_note ? ` · ${r.hr_note}` : ""}</span>
                : <span className="muted">Chờ nhân sự xác nhận ngày công</span>}</dd>
            </dl>
            {trip?.actLegs.length ? (<><div className="section-title">Lộ trình thực tế</div><LegTable legs={trip.actLegs} people={people} actual /></>) : null}
            <div className="section-title">Bảng kê chứng từ thanh toán</div>
            <CostTable costs={trip?.actCosts ?? []} />
          </>
        ) : null}

        {isTrip && (r.status === "da_duyet" || r.status === "hoan_tat") ? (
          <>
            <div className="section-title">Tạm ứng / thanh toán của chuyến này</div>
            <div className="card stack">
              {linked.length ? (
                <ul className="trip-links">
                  {linked.map((x) => (
                    <li key={x.id}>
                      {x.can_open ? <Link to={`/van-phong/${x.id}`}>{x.kind === "tam_ung" ? "Tạm ứng" : "Thanh toán"} {x.doc_no ?? ""}</Link> : <span>{x.kind === "tam_ung" ? "Tạm ứng" : "Thanh toán"} {x.doc_no ?? ""}</span>}
                      <span className="num">{vnd(x.amount ?? 0)}</span><span className={`rq-pill ${x.status}`}>{LINK_STATUS[x.status] ?? x.status}</span>
                    </li>
                  ))}
                </ul>
              ) : <p className="muted small" style={{ margin: 0 }}>Chưa có đề nghị nào lập từ chuyến công tác này.</p>}
              {tripOwner ? (
                <div className="row">
                  <Link className="btn secondary" style={{ flex: 1 }} to={`/van-phong/moi/tam_ung?trip=${r.id}`}>{Icon.plus}Lập đề nghị tạm ứng</Link>
                  {r.status === "hoan_tat" && trip?.actCosts.length
                    ? <Link className="btn" style={{ flex: 1 }} to={`/van-phong/moi/thanh_toan?trip=${r.id}`}>{Icon.plus}Lập đề nghị thanh toán từ bảng kê</Link>
                    : null}
                </div>
              ) : null}
              {tripOwner && r.status === "hoan_tat" && !trip?.actCosts.length ? <p className="muted small" style={{ margin: 0 }}>Nhập bảng kê chứng từ ở phần thực tế để lập đề nghị thanh toán.</p> : null}
            </div>
          </>
        ) : null}

        {isManager && r.kind === "nghi_phep" && r.sub_type === "phep_nam" && requester ? (
          <LeaveBalance userId={requester.id} quota={requester.annual_leave_days == null ? null : Number(requester.annual_leave_days)} compact />
        ) : null}

        {r.kind === "thanh_toan" ? (
          <DnttView requestId={r.id} refreshKey={r.updated_at}
            canAddLink={isManager || (mine && (r.status === "cho_duyet" || r.status === "da_duyet" || editable))}
            canDeleteLink={isManager || (mine && editable)} />
        ) : null}

        {isMoney ? (
          <FileGallery owner={{ kind: "dinh_kem_de_nghi", requestId: r.id }} title="Chứng từ đính kèm" hideLabel="unc"
            hint="Hoá đơn, báo giá, ảnh chuyển khoản… (ảnh hoặc PDF, tối đa 10 MB mỗi tệp)."
            canUpload={isManager || (mine && (r.status === "cho_duyet" || r.status === "da_duyet" || editable))}
            canDelete={isManager || (mine && editable)} />
        ) : null}

        {isMoney && (canPay || r.status === "hoan_tat") ? (
          <div className={`rq-unc${r.status === "hoan_tat" ? " done" : ""}`}>
            <FileGallery owner={{ kind: "dinh_kem_de_nghi", requestId: r.id }} onlyLabel="unc" onCount={setUncCount}
              title={r.status === "hoan_tat" ? "Uỷ nhiệm chi (UNC)" : "Bước cuối · Đính kèm UNC *"}
              hint={r.status === "hoan_tat" ? "Đã kết thúc, UNC đã khoá."
                : r.pay_method === "tien_mat" ? "Chi tiền mặt: chụp phiếu chi có chữ ký người nhận. Sau đó bấm Kết thúc."
                : "Ảnh hoặc PDF uỷ nhiệm chi / xác nhận chuyển khoản từ ngân hàng. Sau đó bấm Kết thúc."}
              canUpload={canPay} canDelete={canPay} />
          </div>
        ) : null}

        {steps.length ? (
          <>
            <div className="section-title">Luồng duyệt</div>
            <ApprovalSteps steps={steps} people={people} requesterName={requester?.full_name ?? "—"} sentAt={sentAt} />
          </>
        ) : null}

        <div className="section-title">Lịch sử</div>
        <ol className="card rq-log">
          <li><b>{requester?.full_name}</b> {isLoa ? "lập tờ trình" : "gửi đề nghị"}<span>{clock(r.created_at)}</span></li>
          {isLoa && loa?.submitted_at ? <li><b>{requester?.full_name}</b> trình duyệt<span>{clock(loa.submitted_at)}</span></li> : null}
          {r.decided_at && !steps.length ? <li><b>{name(r.approver_id)}</b> {r.status === "tu_choi" ? "từ chối" : "duyệt"}{r.decision_note && r.status !== "tu_choi" ? ` — ${r.decision_note}` : ""}<span>{clock(r.decided_at)}</span></li> : null}
          {r.reported_at ? <li><b>{requester?.full_name}</b> nhập thực tế công tác<span>{clock(r.reported_at)}</span></li> : null}
          {r.paid_at ? <li><b>{name(r.paid_by)}</b> đính kèm UNC và kết thúc<span>{clock(r.paid_at)}</span></li> : null}
          {r.status === "tra_lai" ? <li><b>{name(r.approver_id)}</b> trả lại {noun}{r.decision_note ? ` — ${r.decision_note}` : ""}<span>{clock(r.decided_at ?? r.updated_at)}</span></li> : null}
          {r.status === "da_huy" ? <li><b>{requester?.full_name}</b> rút lại {noun}<span>{clock(r.updated_at)}</span></li> : null}
        </ol>

        {err && !decide && !report && !hrOpen ? <div className="error-box" role="alert">{err}</div> : null}

        <div className="stack rq-actions">
          {canDecide ? (
            <div className="row">
              <button className="btn danger" style={{ flex: 1 }} disabled={busy} onClick={() => { setErr(null); setDecide("tu_choi"); }}>{Icon.x}Từ chối</button>
              <button className="btn secondary" style={{ flex: 1 }} disabled={busy} onClick={() => { setErr(null); setDecide("tra_lai"); }}>{Icon.undo}Trả lại</button>
              <button className="btn" style={{ flex: 2 }} disabled={busy} onClick={() => { setErr(null); setDecide("da_duyet"); }}>{Icon.check}Duyệt</button>
            </div>
          ) : null}
          {canPay ? (
            <>
              <button className="btn block" disabled={busy || uncCount === 0} onClick={() => setConfirm("chi")}>{Icon.check}Kết thúc {r.kind === "thanh_toan" ? "DNTT" : "tạm ứng"} · {vnd(r.amount)}</button>
              {uncCount === 0 ? <p className="muted small" style={{ margin: 0 }}>Đính kèm UNC ở bước cuối phía trên để mở nút Kết thúc.</p> : null}
            </>
          ) : null}
          {isTrip ? (
            <div className="trip-prints">
              <Link className="btn secondary" to={`/van-phong/${r.id}/in-cong-tac/phieu`}>In phiếu yêu cầu</Link>
              <Link className="btn secondary" to={`/van-phong/${r.id}/in-cong-tac/ke-hoach`}>In kế hoạch công tác</Link>
              <Link className="btn secondary" to={`/van-phong/${r.id}/in-cong-tac/di-duong`}>In giấy đi đường</Link>
              <Link className="btn secondary" to={`/van-phong/${r.id}/in-cong-tac/bang-ke`}>In bảng kê thanh toán</Link>
            </div>
          ) : <Link className="btn secondary block" to={`/van-phong/${r.id}/in`}>In / lưu PDF</Link>}
          {canHr ? (
            <button className={`btn block${r.hr_confirmed_at ? " secondary" : ""}`} disabled={busy} onClick={() => { setHrNote(r.hr_note ?? ""); setErr(null); setHrOpen(true); }}>
              {Icon.check}{r.hr_confirmed_at ? "Bỏ xác nhận ngày công tác" : "Nhân sự xác nhận ngày công tác"}
            </button>
          ) : null}
          {canReport ? (
            <button className={`btn block${r.status === "hoan_tat" ? " secondary" : ""}`} onClick={openReport}>
              {r.status === "hoan_tat" ? "Sửa thực tế / bảng kê" : "Nhập thực tế công tác"}
            </button>
          ) : null}
          {mine || isManager || canEdit ? (
            <div className="row">
              {mine || canEdit ? (canEdit
                ? <Link className="btn block" style={{ flex: 2 }} to={editUrl}>{Icon.edit}{r.status === "nhap" ? "Sửa bản nháp" : isLoa ? (mine ? "Sửa và trình lại" : "Sửa tờ trình") : "Sửa và gửi lại"}</Link>
                : <button className="btn secondary block" style={{ flex: 2 }} disabled title={EDIT_LOCK_TIP}>{Icon.edit}Sửa</button>) : null}
              {mine || isManager ? <button className="btn danger" style={{ flex: 1 }} disabled={!canDelete} title={canDelete ? `Xoá ${noun}` : EDIT_LOCK_TIP} onClick={() => setConfirm("xoa")}>{Icon.trash}Xoá</button> : null}
            </div>
          ) : null}
          {(mine || isManager) && !editable && r.status !== "hoan_tat" && !(isLoa && r.status === "da_duyet") ? <p className="muted small" style={{ margin: 0 }}>Sửa và Xoá chỉ mở khi {noun} bị trả lại, bị từ chối hoặc đã rút. Đang chờ duyệt thì bấm “Rút lại” trước.</p> : null}
          {isLoa && r.status === "da_duyet" ? <p className="muted small" style={{ margin: 0 }}>Tờ trình đã duyệt xong nên khoá, không sửa / xoá. Cần thay đổi thì lập LOA mới và chọn LOA này làm tham chiếu.</p> : null}
          {canCancel ? <button className="btn ghost" style={{ color: "var(--danger)" }} onClick={() => setConfirm("huy")}>Rút lại {noun}</button> : null}
        </div>
        <RelatedPanel type="request" id={r.id} />
      </main>

      <DecideSheet req={decide ? r : null} mode={decide} onClose={() => setDecide(null)} onDone={() => { setDecide(null); load(); }} />

      <Sheet open={report} onClose={() => setReport(false)} title="Thực tế công tác" wide>
        <form className="stack dn-erp" onSubmit={submitReport}>
          {r.hr_confirmed_at ? <div className="ok-box">Nhân sự đã xác nhận ngày công nên ngày đi, ngày về và lộ trình đã khoá. Bảng kê chứng từ vẫn sửa được.</div> : null}
          <div className="row" style={{ alignItems: "flex-start" }}>
            <label className="field" style={{ flex: "1 1 130px" }}><span>Ngày đi thực tế *</span>
              <input id="ac-start" type="date" className="input" value={aStart} required disabled={!!r.hr_confirmed_at} onChange={(e) => setAStart(e.target.value)} /></label>
            <label className="field" style={{ flex: "1 1 130px" }}><span>Ngày về thực tế *</span>
              <input id="ac-end" type="date" className="input" value={aEnd} min={aStart} required disabled={!!r.hr_confirmed_at} onChange={(e) => setAEnd(e.target.value)} /></label>
          </div>
          {r.hr_confirmed_at ? null : <LegGrid title="Lộ trình thực tế (giấy đi đường)" rows={aLegs} setRows={setALegs} people={people.filter((p) => p.is_active)} actual defaultStaff={r.traveler_id ?? r.requester_id} />}
          <CostGrid title="Bảng kê chứng từ thanh toán" rows={aCosts} setRows={setACosts} />
          <p className="muted small" style={{ margin: 0 }}>Tổng bảng kê {vnd(costTotal(aCosts.filter(costFilled)))}{r.amount ? ` · dự trù ${vnd(r.amount)}` : ""}. Chênh lệch với tạm ứng anh/chị tự ghi khi lập đề nghị thanh toán.</p>
          <label className="field"><span>Kết quả công tác</span>
            <textarea id="ac-note" className="input" value={aNote} onChange={(e) => setANote(e.target.value)} placeholder="Đã làm được gì, việc cần theo dõi tiếp…" /></label>
          {err ? <div className="error-box" role="alert">{err}</div> : null}
          <button className="btn block" disabled={busy}>{busy ? "Đang lưu…" : r.status === "hoan_tat" ? "Lưu thực tế" : "Gửi thực tế công tác"}</button>
        </form>
      </Sheet>

      <Sheet open={hrOpen} onClose={() => setHrOpen(false)} title={r.hr_confirmed_at ? "Bỏ xác nhận ngày công tác?" : "Xác nhận ngày công tác"}>
        <div className="stack">
          <p style={{ margin: 0 }}>{name(r.traveler_id ?? r.requester_id)} đi công tác thực tế <b className="num">{fullDate(r.actual_start)} – {fullDate(r.actual_end)}</b>{actualDays ? ` (${fmtDays(actualDays)})` : ""}.</p>
          <label className="field"><span>Ghi chú</span>
            <input id="hr-note" className="input" value={hrNote} onChange={(e) => setHrNote(e.target.value)} placeholder="VD: Khớp vé xe, tính công đủ" /></label>
          {err ? <div className="error-box" role="alert">{err}</div> : null}
          {r.hr_confirmed_at
            ? <button className="btn danger block" disabled={busy} onClick={() => hrConfirm(false)}>Bỏ xác nhận để người đi sửa ngày</button>
            : <button className="btn block" disabled={busy} onClick={() => hrConfirm(true)}>{Icon.check}Xác nhận để tính ngày công</button>}
        </div>
      </Sheet>

      <Sheet open={!!confirm} onClose={() => setConfirm(null)} title={confirm === "chi" ? (r.kind === "thanh_toan" ? "Kết thúc đề nghị thanh toán?" : "Kết thúc đề nghị tạm ứng?") : confirm === "xoa" ? `Xoá ${noun}?` : `Rút lại ${noun}?`}>
        <p className="muted" style={{ marginTop: 0 }}>
          {confirm === "chi"
            ? `${vnd(r.amount)} cho ${r.payee || requester?.full_name}${r.bank_info ? ` (${r.bank_info})` : ""}. Đã đính kèm ${uncCount} tệp UNC. Sau khi kết thúc, UNC bị khoá, không sửa được. Người đề nghị sẽ nhận thông báo.`
            : confirm === "xoa" ? `Xoá hẳn ${noun} cùng tệp đính kèm, không khôi phục được.`
            : r.status === "da_duyet" ? "Đề nghị đã được duyệt. Rút lại sẽ báo cho quản lý biết." : `${Noun} sẽ không còn chờ duyệt nữa.`}
        </p>
        <div className="row">
          <button className="btn secondary" style={{ flex: 1 }} onClick={() => setConfirm(null)}>Thôi</button>
          <button className={`btn ${confirm === "huy" || confirm === "xoa" ? "danger" : ""}`} style={{ flex: 1 }} disabled={busy}
            onClick={async () => {
              if (confirm === "xoa") {
                setBusy(true);
                try { await deleteRequest(r.id); toast(`Đã xoá ${noun}.`); refreshUnread(); nav(listUrl, { replace: true }); }
                catch (e) { toast(friendlyError(e)); setConfirm(null); }
                setBusy(false);
                return;
              }
              const ok = confirm === "chi" ? await markPaid() : await update({ status: "da_huy" }, `Đã rút lại ${noun}.`);
              if (ok) { setConfirm(null); if (confirm === "huy") nav(listUrl, { replace: true }); }
            }}>{confirm === "chi" ? "Kết thúc" : confirm === "xoa" ? "Xoá" : "Rút lại"}</button>
        </div>
      </Sheet>
    </>
  );
}
