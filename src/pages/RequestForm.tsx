import { useEffect, useId, useState, type FormEvent } from "react";
import { Link, Navigate, useNavigate, useParams, useSearchParams } from "react-router-dom";
import { friendlyError, supabase } from "../lib/supabase";
import { useSession } from "../lib/session";
import { daysBetween, ddmmyyyy, todayVN, workDays } from "../lib/dates";
import { parseMoney, vnd, vndWords } from "../lib/money";
import { KINDS, PAUSED_TIP, usePausedKinds, LEAVE_SPAN, LEAVE_SPAN_DAYS, LEAVE_TYPE, OUT_TYPE, PAY_METHOD, PAY_TYPE, fmtDays, isEditableStatus, loaLeft, type LoaPick, type Req, type ReqAdvance, type ReqKind, type ReqLine } from "../lib/office";
import { uploadFile } from "../lib/files";
import DnttEditor, { advFromRow, calcLine, emptyLine, lineFromRow, lineToRow, totals, type AdvDraft, type LineDraft, type LinkDraft } from "../components/DnttEditor";
import { LoaPicker } from "../components/LoaPicker";
import { CostGrid, LegGrid } from "../components/TripGrids";
import { TRIP_TYPE, VISA_TYPE, costFilled, costFromRow, costTotal, emptyCost, emptyLeg, legFromRow, loadTrip, saveTrip, type CostDraft, type LegDraft } from "../lib/trip";
import { LEVEL_SHORT } from "../lib/org";
import { Icon, TopBar } from "../components/ui";
import { LinkFromNote, useLinkFrom } from "../components/RelatedPanel";
import { addLink } from "../lib/links";
import { ChainPreview } from "../components/ApprovalChain";
import { useLeaveBalance } from "./Office";
import "../office.css";

function Options({ name, value, options, onChange }: { name: string; value: string; options: Record<string, string>; onChange: (v: string) => void }) {
  return (
    <div className="opt-grid" role="radiogroup" aria-label={name}>
      {Object.entries(options).map(([k, l]) => (
        <button type="button" key={k} role="radio" aria-checked={value === k} className="opt" onClick={() => onChange(k)}>{l}</button>
      ))}
    </div>
  );
}

function MoneyInput({ id, value, onChange, label, required }: { id: string; value: string; onChange: (v: string) => void; label: string; required?: boolean }) {
  const n = parseMoney(value);
  return (
    <label className="field"><span>{label}{required ? " *" : ""}</span>
      <input id={id} className="input num" inputMode="decimal" value={value} onChange={(e) => onChange(e.target.value)}
        placeholder="VD: 3.500.000 hoặc 3tr5" required={required} />
      {value ? <small className={n ? "muted" : "err-text"}>{n ? vnd(n) : "Chưa đọc được số tiền"}</small> : null}
    </label>
  );
}

export default function RequestForm() {
  const { kind: kindParam, id } = useParams();
  const editing = !!id;
  const { profile, buildings, people, toast, refreshUnread, isManager, myStaff } = useSession();
  const nav = useNavigate();
  const formId = "dn-form-" + useId().replace(/:/g, "");   // mỗi trang đang mở một mã riêng (PC giữ nhiều tab)
  const [kind, setKind] = useState<ReqKind>((kindParam as ReqKind) || "nghi_phep");
  const today = todayVN();
  const [subType, setSubType] = useState(kind === "ra_ngoai" ? "co_quay_lai" : "phep_nam");
  const [span, setSpan] = useState("ca_ngay");
  const [start, setStart] = useState(today);
  const [end, setEnd] = useState(today);
  const [t1, setT1] = useState("");
  const [t2, setT2] = useState("");
  const [location, setLocation] = useState("");
  const [reason, setReason] = useState("");
  const [amount, setAmount] = useState("");
  const [payee, setPayee] = useState("");
  const [bank, setBank] = useState("");
  const [buildingId, setBuildingId] = useState("");
  const link = useLinkFrom(!editing);   // lập đề nghị từ công việc / phòng / phản ánh…: gắn liên kết sau khi gửi
  useEffect(() => { if (link.info?.parent && !buildingId && buildings.some((b) => b.id === link.info!.parent)) setBuildingId(link.info.parent); }, [link.info]);   // eslint-disable-line react-hooks/exhaustive-deps
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [loaded, setLoaded] = useState(!editing);
  const [origPending, setOrigPending] = useState(0);   // đơn đang sửa đã nằm trong số "chờ duyệt"
  // Đề nghị thanh toán đầy đủ
  const [payMethod, setPayMethod] = useState("chuyen_khoan");
  const [payType, setPayType] = useState("nha_cung_cap");
  const [loaId, setLoaId] = useState("");                      // Tờ trình (LOA) đã duyệt gắn với đề nghị tiền
  const [oldLoaNo, setOldLoaNo] = useState<string | null>(null); // số LOA ghi tay của đề nghị lập trước đây
  const [picks, setPicks] = useState<LoaPick[] | null>(null);
  const [vendorCode, setVendorCode] = useState("");
  const [contactName, setContactName] = useState("");
  const [contactCode, setContactCode] = useState("");
  const [docNo, setDocNo] = useState<string | null>(null);
  const [handover, setHandover] = useState("");
  const [phone, setPhone] = useState("");
  const [transport, setTransport] = useState("");
  // Đi công tác (migration 067)
  const [tripType, setTripType] = useState("trong_nuoc");
  const [tripArea, setTripArea] = useState("");
  const [visaType, setVisaType] = useState("khong_yeu_cau");
  const [traveler, setTraveler] = useState("");
  const [legs, setLegs] = useState<LegDraft[]>([]);
  const [costs, setCosts] = useState<CostDraft[]>([]);
  // Đề nghị tạm ứng / thanh toán lập từ một chuyến công tác (?trip=<id>); nhân bản phiếu công tác (?tu=<id>)
  const [qs] = useSearchParams();
  const tripParam = !id ? qs.get("trip") : null;
  const copyParam = !id ? qs.get("tu") : null;
  const [tripId, setTripId] = useState<string | null>(null);
  const [tripLabel, setTripLabel] = useState<string | null>(null);
  // Dự án (migration 069): gắn chi phí vào dự án / hạng mục chính
  const [projectId, setProjectId] = useState(!id ? qs.get("project") ?? "" : "");
  const [projectItemId, setProjectItemId] = useState(!id ? qs.get("item") ?? "" : "");
  const [projects, setProjects] = useState<{ id: string; code: string | null; name: string; status: string; building_id: string | null }[]>([]);
  const [projItems, setProjItems] = useState<{ id: string; project_id: string; name: string; sort: number; start_date: string }[]>([]);
  const [settleDue, setSettleDue] = useState("");
  const [lines, setLines] = useState<LineDraft[]>([]);
  const [advs, setAdvs] = useState<AdvDraft[]>([]);
  const [files, setFiles] = useState<File[]>([]);
  const [links, setLinks] = useState<LinkDraft[]>([]);
  const [loaOpen, setLoaOpen] = useState(false);
  const [deptName, setDeptName] = useState<string | null>(null);
  useEffect(() => {
    if (!myStaff?.department_id) return;
    supabase.from("departments").select("name").eq("id", myStaff.department_id).maybeSingle()
      .then(({ data }) => setDeptName((data as { name: string } | null)?.name ?? null));
  }, [myStaff?.department_id]);
  // Phiếu công tác mới: một dòng kế hoạch, một dòng chi phí; nhân bản từ phiếu cũ nếu có ?tu=
  useEffect(() => {
    if (editing || kind !== "cong_tac" || !profile) return;
    if (!copyParam) { setTraveler(profile.id); setLegs([emptyLeg(profile.id)]); setCosts([emptyCost()]); return; }
    (async () => {
      const { data } = await supabase.from("requests").select("*").eq("id", copyParam).maybeSingle();
      const r = data as Req | null;
      if (!r || r.kind !== "cong_tac") { setLegs([emptyLeg(profile.id)]); setCosts([emptyCost()]); return; }
      setReason(r.reason); setLocation(r.location ?? ""); setTransport(r.transport ?? ""); setBuildingId(r.building_id ?? "");
      setTripType(r.trip_type ?? "trong_nuoc"); setTripArea(r.trip_area ?? ""); setVisaType(r.visa_type ?? "khong_yeu_cau");
      setTraveler(profile.id);
      const t = await loadTrip(r.id);
      setLegs(t.planLegs.length ? t.planLegs.map((l) => ({ ...legFromRow(l), start_date: "", end_date: "", staff_id: l.staff_id === r.requester_id ? profile.id : l.staff_id ?? "" })) : [emptyLeg(profile.id)]);
      setCosts(t.planCosts.length ? t.planCosts.map(costFromRow) : [emptyCost()]);
      toast("Đã nhân bản phiếu công tác. Chọn lại ngày đi, ngày về rồi gửi.");
    })();
  }, [editing, kind, copyParam, profile?.id]);   // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (!tripParam || editing || !(kind === "tam_ung" || kind === "thanh_toan")) return;
    (async () => {
      const { data } = await supabase.from("requests").select("*").eq("id", tripParam).maybeSingle();
      const t = data as Req | null;
      if (!t || t.kind !== "cong_tac") return;
      const span = `${ddmmyyyy(t.actual_start ?? t.start_date)}${(t.actual_end ?? t.end_date) ? " – " + ddmmyyyy((t.actual_end ?? t.end_date)!) : ""}`;
      setTripId(t.id); setTripLabel(`${t.location ?? "Công tác"} · ${span}`);
      if (t.building_id) setBuildingId(t.building_id);
      const tr = await loadTrip(t.id);
      if (kind === "tam_ung") {
        setReason(`Tạm ứng công tác ${t.location ?? ""} ${span}`.trim());
        setStart(todayVN());
        const plan = tr.planCosts.reduce((a, c) => a + Number(c.amount ?? 0), 0) || Number(t.amount ?? 0);
        if (plan) setAmount(new Intl.NumberFormat("vi-VN").format(plan));
      } else {
        const src = tr.actCosts.length ? tr.actCosts : tr.planCosts;
        setReason(`Thanh toán công tác phí ${t.location ?? ""} ${span}`.trim());
        setPayType("khac"); setPayee(profile?.full_name ?? "");
        const n = (x: number) => String(x).replace(".", ",");
        if (src.length) setLines(src.map((c) => ({
          ...emptyLine(),
          description: `${c.category}${c.location ? " – " + c.location : ""} (${n(c.days)} ngày × ${n(c.persons)} người × ${new Intl.NumberFormat("vi-VN").format(c.unit_price)})`,
          amount: new Intl.NumberFormat("vi-VN").format(Number(c.amount ?? 0)),
        })));
      }
    })();
  }, [tripParam, editing, kind]);   // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (!(kind === "thanh_toan" || kind === "tam_ung")) return;
    (async () => {
      const [pj, it] = await Promise.all([
        supabase.from("projects").select("id,code,name,status,building_id").order("start_date", { ascending: false }),
        supabase.from("project_items").select("id,project_id,name,sort,start_date").eq("level", 1),
      ]);
      const list = (pj.data ?? []) as typeof projects;
      setProjects(list); setProjItems((it.data ?? []) as typeof projItems);
      const pre = !editing ? list.find((x) => x.id === projectId) : null;
      if (pre) {
        if (pre.building_id) setBuildingId((b) => b || pre.building_id!);
        setReason((r) => r || (kind === "tam_ung" ? `Tạm ứng dự án ${pre.code}: ${pre.name}` : `Thanh toán dự án ${pre.code}: ${pre.name}`));
      }
    })();
  }, [kind]);   // eslint-disable-line react-hooks/exhaustive-deps

  // Đề nghị thanh toán mới: mở sẵn một dòng chi tiết để gõ ngay
  useEffect(() => { if (!editing && kind === "thanh_toan" && lines.length === 0) setLines([emptyLine()]); }, [editing, kind]);   // eslint-disable-line react-hooks/exhaustive-deps

  const balance = useLeaveBalance(profile?.id);
  const { paused, loaded: pauseLoaded } = usePausedKinds();

  useEffect(() => {
    if (!id) return;
    supabase.from("requests").select("*").eq("id", id).maybeSingle().then(({ data }) => {
      const r = data as Req | null;
      if (!r) { nav("/van-phong", { replace: true }); return; }
      if (r.kind === "loa") { nav(`/van-phong/loa/${r.id}/sua`, { replace: true }); return; }
      if (!isEditableStatus(r.status)) { toast("Đề nghị đang trong quá trình duyệt nên chưa sửa được."); nav(`/van-phong/${r.id}`, { replace: true }); return; }
      setKind(r.kind); setSubType(r.sub_type ?? ""); setSpan(r.span ?? "ca_ngay");
      setStart(r.start_date); setEnd(r.end_date ?? r.start_date);
      setT1(r.start_time?.slice(0, 5) ?? ""); setT2(r.end_time?.slice(0, 5) ?? "");
      setLocation(r.location ?? ""); setReason(r.reason); setAmount(r.amount ? String(r.amount) : "");
      setPayee(r.payee ?? ""); setBank(r.bank_info ?? ""); setBuildingId(r.building_id ?? "");
      if (r.kind === "nghi_phep" && r.sub_type === "phep_nam" && r.status === "cho_duyet") setOrigPending(Number(r.days ?? 0));
      setPayMethod(r.pay_method ?? (r.bank_info ? "chuyen_khoan" : "tien_mat")); setPayType(r.pay_type ?? "khac");
      setLoaId(r.loa_id ?? ""); setOldLoaNo(r.loa_id ? null : r.loa_no); setVendorCode(r.vendor_code ?? ""); setContactName(r.contact_name ?? ""); setContactCode(r.contact_code ?? "");
      setDocNo(r.doc_no);
      setHandover(r.handover_to ?? ""); setPhone(r.contact_phone ?? ""); setTransport(r.transport ?? ""); setSettleDue(r.settle_due ?? "");
      setTripId(r.trip_id ?? null);
      setProjectId(r.project_id ?? ""); setProjectItemId(r.project_item_id ?? "");
      if (r.kind === "cong_tac") {
        setTripType(r.trip_type ?? "trong_nuoc"); setTripArea(r.trip_area ?? ""); setVisaType(r.visa_type ?? "khong_yeu_cau"); setTraveler(r.traveler_id ?? "");
        loadTrip(r.id).then((t) => {
          setLegs(t.planLegs.length ? t.planLegs.map(legFromRow) : [emptyLeg(r.traveler_id ?? r.requester_id)]);
          setCosts(t.planCosts.length ? t.planCosts.map(costFromRow) : [emptyCost()]);
          setLoaded(true);
        });
        return;
      }
      if (r.kind === "thanh_toan") {
        Promise.all([
          supabase.from("request_lines").select("*").eq("request_id", r.id).order("line_no"),
          supabase.from("request_advances").select("*").eq("request_id", r.id).order("created_at"),
        ]).then(([l, a]) => {
          setLines(((l.data ?? []) as ReqLine[]).map(lineFromRow));
          setAdvs(((a.data ?? []) as ReqAdvance[]).map(advFromRow));
          setLoaded(true);
        });
        return;
      }
      setLoaded(true);
    });
  }, [id, nav]);

  const meta = KINDS.find((k) => k.kind === kind)!;
  const isMoney = kind === "thanh_toan" || kind === "tam_ung";
  // LOA chi tiền đã duyệt mà mình được dùng (người lập, cùng soạn, được xem)
  useEffect(() => {
    if (!isMoney) return;
    supabase.rpc("loa_pickable").then(({ data }) => setPicks((data ?? []) as LoaPick[]));
  }, [isMoney]);
  const isPay = kind === "thanh_toan";
  const absence = kind === "nghi_phep" || kind === "ra_ngoai" || kind === "cong_tac";   // vắng mặt: có bàn giao
  // Dòng trống hoàn toàn (vd vừa bấm thêm dòng) thì bỏ qua khi tính và khi lưu
  const filled = lines.filter((l) => l.amount.trim() || l.seller_name.trim() || l.invoice_no.trim() || l.description.trim() || l.invoice_serial.trim());
  const hasLines = isPay && filled.length > 0;
  const tot = totals(filled, advs);
  const multiDay = kind === "cong_tac" || (kind === "nghi_phep" && span === "ca_ngay") || kind === "ra_ngoai";
  const isSunday = (iso: string) => new Date(iso + "T00:00:00Z").getUTCDay() === 0;
  const days = kind === "nghi_phep"
    ? (span !== "ca_ngay" ? (isSunday(start) ? 0 : LEAVE_SPAN_DAYS[span] ?? 0.5) : end >= start ? workDays(start, end) : 0)   // nghỉ phép: bỏ Chủ nhật
    : end >= start ? daysBetween(start, end) + 1 : 0;
  const sundays = kind === "nghi_phep" && span === "ca_ngay" && end >= start ? daysBetween(start, end) + 1 - days : 0;
  const quota = profile?.annual_leave_days == null ? null : Number(profile.annual_leave_days);
  const leftAfter = balance && quota != null && kind === "nghi_phep" && subType === "phep_nam" ? quota - balance.used - (balance.pending - origPending) - days : null;

  async function submit(e: FormEvent) {
    e.preventDefault();
    setErr(null);
    if (isPay && !hasLines) { setErr("Nhập ít nhất một dòng chi tiết thanh toán. Tổng tiền tự cộng từ các dòng."); return; }
    const amt = isPay ? tot.net : parseMoney(amount);
    if (isMoney && !amt) { setErr(isPay ? "Tiền tạm ứng phải nhỏ hơn tổng thanh toán." : "Nhập số tiền đề nghị."); return; }
    if (!hasLines && amount && !amt) { setErr("Số tiền chưa đúng định dạng."); return; }
    if (isPay) {
      if (payMethod === "chuyen_khoan" && !bank.trim()) { setErr("Nhập số tài khoản và ngân hàng nhận tiền."); return; }
      for (let i = 0; i < filled.length; i++) {
        if (!calcLine(filled[i]).pre) { setErr(`Dòng ${lines.indexOf(filled[i]) + 1}: nhập tiền trước VAT.`); return; }
        if (!filled[i].cost_center.trim()) { setErr(`Dòng ${lines.indexOf(filled[i]) + 1}: nhập Cost Center.`); return; }
      }
      for (let i = 0; i < advs.length; i++) if (!parseMoney(advs[i].amount)) { setErr(`Tạm ứng ${i + 1}: nhập số tiền.`); return; }
    }
    if (multiDay && end < start) { setErr("Ngày kết thúc phải sau ngày bắt đầu."); return; }
    if (kind === "cong_tac") {
      if (!location.trim()) { setErr("Nhập nơi công tác."); return; }
      if (!transport.trim()) { setErr("Nhập phương tiện."); return; }
      const badLeg = legs.findIndex((l) => l.start_date && l.end_date && l.end_date < l.start_date);
      if (badLeg >= 0) { setErr(`Kế hoạch dòng ${badLeg + 1}: đến ngày phải sau từ ngày.`); return; }
      const badCost = costs.findIndex((c) => costFilled(c) && !c.category.trim());
      if (badCost >= 0) { setErr(`Chi phí dòng ${badCost + 1}: nhập hạng mục.`); return; }
    }
    if (kind === "nghi_phep" && days === 0) { setErr("Chủ nhật công ty nghỉ, không cần xin nghỉ phép."); return; }
    if (kind === "ra_ngoai" && t1 && t2 && t2 <= t1) { setErr("Giờ về phải sau giờ đi."); return; }
    if (kind === "tam_ung" && settleDue && settleDue < start) { setErr("Hạn hoàn ứng phải sau ngày cần tiền."); return; }
    const row: Partial<Req> = {
      kind,
      sub_type: kind === "nghi_phep" || kind === "ra_ngoai" ? subType : null,
      span: kind === "nghi_phep" ? span : null,
      start_date: start,
      end_date: multiDay ? end : null,
      start_time: kind === "ra_ngoai" && t1 ? t1 : null,
      end_time: kind === "ra_ngoai" && t2 && subType === "co_quay_lai" ? t2 : null,
      location: kind === "ra_ngoai" || kind === "cong_tac" ? location.trim() || null : null,
      reason: reason.trim(),
      amount: kind === "cong_tac" ? (costTotal(costs.filter(costFilled)) || null) : isMoney ? amt : null,
      payee: isMoney ? payee.trim() || null : null,
      bank_info: isMoney ? bank.trim() || null : null,
      building_id: buildingId || null,
      pay_method: isPay ? payMethod : null,
      pay_type: isPay ? payType : null,
      loa_id: isMoney ? loaId || null : null,
      vendor_code: isPay ? vendorCode.trim() || null : null,
      contact_name: isPay ? contactName.trim() || null : null,
      contact_code: isPay ? contactCode.trim() || null : null,
      handover_to: absence ? handover || null : null,
      contact_phone: absence ? phone.trim() || null : null,
      transport: kind === "cong_tac" ? transport.trim() || null : null,
      trip_type: kind === "cong_tac" ? tripType : null,
      trip_area: kind === "cong_tac" ? tripArea.trim() || null : null,
      visa_type: kind === "cong_tac" && tripType === "nuoc_ngoai" ? visaType : null,
      traveler_id: kind === "cong_tac" ? traveler || null : null,
      trip_id: isMoney ? tripId : null,
      project_id: isMoney ? projectId || null : null,
      project_item_id: isMoney ? projectItemId || null : null,
      settle_due: kind === "tam_ung" ? settleDue || null : null,
    };
    setBusy(true);
    const res = editing
      ? await supabase.from("requests").update(row).eq("id", id!).select("id").single()
      : await supabase.from("requests").insert(row).select("id").single();
    if (res.error) { setBusy(false); setErr(friendlyError(res.error)); return; }
    const rid = res.data.id as string;
    const problems: string[] = [];
    if (kind === "cong_tac") {
      const te = await saveTrip(rid, "ke_hoach", legs, costs);
      if (te) problems.push(friendlyError({ message: te }));
    }
    if (isPay) {
      // Xoá tạm ứng trước khoản chi để tổng không bao giờ âm giữa chừng
      if (editing) {
        const d1 = await supabase.from("request_advances").delete().eq("request_id", rid);
        const d2 = await supabase.from("request_lines").delete().eq("request_id", rid);
        if (d1.error || d2.error) problems.push(friendlyError((d1.error || d2.error)!));
      }
      if (filled.length) {
        const r1 = await supabase.from("request_lines").insert(filled.map((l, i) => ({ ...lineToRow(l, i), request_id: rid })));
        if (r1.error) problems.push(friendlyError(r1.error));
        else if (advs.length) {
          const r2 = await supabase.from("request_advances").insert(advs.map((a) => ({ request_id: rid, amount: parseMoney(a.amount), description: a.description.trim() || null })));
          if (r2.error) problems.push(friendlyError(r2.error));
        }
      }
      if (!editing) {
        for (const f of files) {
          try { await uploadFile({ kind: "dinh_kem_de_nghi", requestId: rid }, f); }
          catch (ex) { problems.push(`${f.name}: ${ex instanceof Error ? ex.message : "không tải lên được"}`); }
        }
        if (links.length) {
          const r3 = await supabase.from("request_links").insert(links.map((k) => ({ request_id: rid, url: k.url, title: k.title || null })));
          if (r3.error) problems.push(friendlyError(r3.error));
        }
      }
    }
    if (!editing && link.from) {
      const le = await addLink("request", rid, link.from.type, link.from.id);
      if (le) problems.push("chưa gắn được liên kết: " + friendlyError({ message: le }));
    }
    setBusy(false);
    if (problems.length) {
      toast(`Đã lưu đề nghị nhưng có lỗi: ${problems.join("; ")}. Mở đề nghị để bổ sung.`);
      nav(`/van-phong/${rid}`, { replace: true });
      return;
    }
    if (editing) {
      // Sửa xong thì gửi lại: luồng duyệt dựng lại, duyệt lại từ cấp đầu
      const { error: re } = await supabase.rpc("resubmit_request", { p_request: rid });
      if (re) { toast(`Đã lưu nhưng chưa gửi lại được: ${friendlyError(re)}`); nav(`/van-phong/${rid}`, { replace: true }); return; }
      refreshUnread();
    }
    toast(editing ? "Đã lưu và gửi lại, đề nghị đi duyệt lại từ cấp đầu." : "Đã gửi đề nghị, đang chờ cấp duyệt đầu tiên.");
    nav(`/van-phong/${rid}`, { replace: true });
  }

  if (kindParam === "loa") return <Navigate to="/van-phong/loa/moi" replace />;
  if (!loaded || !pauseLoaded) return (<><TopBar title={editing ? "Sửa đề nghị" : "Đề nghị"} back /><div className="loading">Đang tải…</div></>);
  if (paused.has(kind) && !isManager) return (
    <><TopBar title={meta.label} back /><main className="main stack"><div className="ok-box">{PAUSED_TIP}</div>
      <Link className="btn secondary block" to={`/van-phong/ds/${kind}`}>Về danh sách</Link></main></>
  );

  const bankReq = isPay && payMethod === "chuyen_khoan";
  const total = isPay ? tot.net : parseMoney(amount);
  const others = people.filter((p) => p.is_active && p.id !== profile?.id);
  const pick = picks?.find((x) => x.id === loaId) ?? null;

  const loaAfter = pick && total ? loaLeft(pick) - total : null;
  const LoaField = isMoney ? (
    <div className="field dn-span3">
      <span>Tờ trình (LOA) <small className="muted" style={{ fontWeight: 400 }}>· không bắt buộc</small></span>
      <div className="dn-search">
        <button type="button" id="rq-loa" className="input dn-search-val" onClick={() => setLoaOpen(true)} aria-haspopup="dialog">
          {pick ? `${pick.doc_no ?? "LOA"} · ${pick.subject}` : loaId ? "LOA đang gắn" : <span className="muted">Bấm kính lúp để tìm LOA</span>}
        </button>
        {loaId ? <button type="button" className="dn-search-btn clear" aria-label="Bỏ gắn LOA" title="Bỏ gắn LOA" onClick={() => setLoaId("")}>{Icon.x}</button> : null}
        <button type="button" className="dn-search-btn" aria-label="Tìm và chọn LOA" title="Tìm LOA" onClick={() => setLoaOpen(true)}>{Icon.search}</button>
      </div>
      {oldLoaNo && !loaId ? <small className="muted">Số LOA ghi tay trước đây: {oldLoaNo}. Bấm kính lúp để chọn LOA tương ứng.</small> : null}
    </div>
  ) : null;
  const pjOpen = projects.filter((x) => (x.status !== "hoan_thanh" && x.status !== "huy") || x.id === projectId);
  const pjItems = projItems.filter((x) => x.project_id === projectId).sort((a, b) => a.sort - b.sort || a.start_date.localeCompare(b.start_date));
  const ProjectField = isMoney && (pjOpen.length || projectId) ? (
    <>
      <label className="field dn-span3"><span>Dự án <small className="muted" style={{ fontWeight: 400 }}>· không bắt buộc</small></span>
        <select id="rq-project" className="input" value={projectId} onChange={(e) => { setProjectId(e.target.value); setProjectItemId(""); }}>
          <option value="">Không thuộc dự án</option>
          {pjOpen.map((x) => <option key={x.id} value={x.id}>{x.code} · {x.name}</option>)}
        </select></label>
      {projectId ? (
        <label className="field dn-span3"><span>Hạng mục chính</span>
          <select id="rq-project-item" className="input" value={projectItemId} onChange={(e) => setProjectItemId(e.target.value)}>
            <option value="">Chưa gắn hạng mục</option>
            {pjItems.map((x, i) => <option key={x.id} value={x.id}>{i + 1}. {x.name}</option>)}
          </select></label>
      ) : null}
    </>
  ) : null;
  const LoaBudget = pick ? (
    <div className="loa-budget num dn-full" role="status" aria-label="Dự toán LOA">
      <span>Dự toán <b>{vnd(pick.amount)}</b></span>
      <span>Đã duyệt chi <b>{vnd(pick.used)}</b></span>
      <span>Đang chờ duyệt <b>{vnd(pick.pending)}</b></span>
      <span className="hl">Còn lại <b>{vnd(loaLeft(pick))}</b></span>
      {loaAfter != null ? <span className={loaAfter < 0 ? "over" : ""}>Còn lại sau đề nghị này <b>{vnd(loaAfter)}</b>{loaAfter < 0 ? " · vượt dự toán, vẫn gửi được, cấp duyệt sẽ thấy cảnh báo" : ""}</span> : null}
    </div>
  ) : null;

  const Handover = absence ? (
    <>
      <label className="field"><span>Người nhận bàn giao công việc</span>
        <select id="rq-handover" className="input" value={handover} onChange={(e) => setHandover(e.target.value)}>
          <option value="">Không bàn giao</option>
          {others.map((p) => <option key={p.id} value={p.id}>{p.full_name}</option>)}
        </select></label>
      <label className="field"><span>Số điện thoại liên hệ khi vắng</span>
        <input id="rq-phone" className="input" inputMode="tel" value={phone} onChange={(e) => setPhone(e.target.value)} placeholder={profile?.phone ?? ""} /></label>
    </>
  ) : null;

  const BuildingSel = kind !== "nghi_phep" && buildings.length ? (
    <label className="field"><span>Toà nhà liên quan</span>
      <select id="rq-building" className="input" value={buildingId} onChange={(e) => setBuildingId(e.target.value)}>
        <option value="">Không gắn toà</option>
        {buildings.map((b) => <option key={b.id} value={b.id}>{b.code} · {b.name}</option>)}
      </select></label>
  ) : null;

  const ReadOnly = ({ label, value, num }: { label: string; value: string; num?: boolean }) => (
    <div className="field"><span>{label}</span><div className={`input ro${num ? " num" : ""}`}>{value}</div></div>
  );

  return (
    <>
      <TopBar title={editing ? `Sửa · ${meta.label}` : `Lập ${meta.label.charAt(0).toLowerCase()}${meta.label.slice(1)}`} back
        action={<button type="submit" form={formId} className="tb-action" disabled={busy}>{busy ? "Đang gửi…" : editing ? "Lưu và gửi lại" : "Gửi"}</button>} />
      <main className={`main ${isMoney ? "main-form" : "main-wide"}`}>
        <form id={formId} className={`stack dn-form dn-erp${isMoney || kind === "cong_tac" ? " money" : ""}`} onSubmit={submit}
          onKeyDown={(e) => { if (e.key === "Enter" && (e.target as HTMLElement).tagName === "INPUT") e.preventDefault(); }}>
          <LinkFromNote from={link.from} info={link.info} />
          {tripId && isMoney ? <p className="ok-box" style={{ margin: 0 }}>Lập từ chuyến công tác: <b>{tripLabel ?? "đã gắn"}</b>. {kind === "thanh_toan" ? "Các dòng chi phí đã điền sẵn từ bảng kê; nhập Cost center và tự thêm phần trừ tạm ứng nếu có." : "Số tiền lấy từ dự trù chi phí, sửa được."}</p> : null}
          <div className="dn-sheet">

          {/* ---------- Người đăng ký ---------- */}
          <section className="card dn-sec">
            <h2 className="dn-h">Người đăng ký</h2>
            <div className="dn-req">
              <ReadOnly label="Người đăng ký" value={profile?.full_name ?? ""} />
              <ReadOnly label="Phòng ban" value={deptName ?? "—"} />
              <ReadOnly label="Chức vụ" value={myStaff?.position ?? "—"} />
              <ReadOnly label="Cấp" value={myStaff?.level ? LEVEL_SHORT[myStaff.level] ?? `L${myStaff.level}` : "—"} />
              <ReadOnly label="Điện thoại" value={profile?.phone ?? "—"} num />
            </div>
          </section>

          {/* ---------- Nghỉ phép / Ra ngoài / Công tác ---------- */}
          {absence && kind !== "cong_tac" ? (
            <section className="card dn-sec">
              <h2 className="dn-h">{kind === "nghi_phep" ? "Thời gian nghỉ" : kind === "ra_ngoai" ? "Thời gian ra ngoài" : "Thời gian công tác"}</h2>
              {kind === "nghi_phep" ? (
                <div className="dn-fields">
                  <div className="field"><span>Loại nghỉ</span><Options name="Loại nghỉ" value={subType} options={LEAVE_TYPE} onChange={setSubType} /></div>
                  <div className="field"><span>Thời gian nghỉ</span><Options name="Thời gian nghỉ" value={span} options={LEAVE_SPAN} onChange={setSpan} />
                    {span === "dau_gio" || span === "cuoi_gio" ? (
                      <small className="muted">Trừ 0,25 ngày phép. Khối văn phòng: {span === "dau_gio" ? "08:00–10:00" : "15:00–17:00"}; khối kinh doanh tính 2 giờ {span === "dau_gio" ? "đầu" : "cuối"} ca đã phân.</small>
                    ) : null}</div>
                </div>
              ) : null}
              {kind === "ra_ngoai" ? (
                <div className="field"><span>Hình thức</span><Options name="Hình thức" value={subType} options={OUT_TYPE} onChange={setSubType} /></div>
              ) : null}
              <div className="dn-fields">
                <label className="field"><span>{multiDay ? "Từ ngày *" : "Ngày *"}</span>
                  <input id="rq-start" type="date" className="input" value={start} required
                    onChange={(e) => { setStart(e.target.value); if (end < e.target.value) setEnd(e.target.value); }} /></label>
                {multiDay ? (
                  <label className="field"><span>Đến ngày</span>
                    <input id="rq-end" type="date" className="input" value={end} min={start} required onChange={(e) => setEnd(e.target.value)} /></label>
                ) : null}
                {kind === "ra_ngoai" ? (
                  <>
                    <label className="field"><span>{subType === "khong_den_cty" ? "Bắt đầu lúc" : "Rời công ty lúc"}</span>
                      <input id="rq-t1" type="time" className="input" value={t1} onChange={(e) => setT1(e.target.value)} /></label>
                    {subType === "co_quay_lai" ? (
                      <label className="field"><span>Quay lại lúc</span>
                        <input id="rq-t2" type="time" className="input" value={t2} onChange={(e) => setT2(e.target.value)} /></label>
                    ) : null}
                  </>
                ) : null}
              </div>
              {kind === "nghi_phep" ? (
                <div className="calc-line num">
                  {days > 0 ? <>Tổng: <b>{fmtDays(days)}</b>{sundays ? ` (không tính ${sundays} Chủ nhật)` : ""}</> : <span className="over">Chủ nhật công ty nghỉ</span>}
                  {leftAfter != null ? <span className={leftAfter < 0 ? "over" : ""}> · {leftAfter < 0 ? `vượt ${fmtDays(-leftAfter)} phép năm` : `còn ${fmtDays(leftAfter)} phép năm sau đơn này`}</span> : null}
                </div>
              ) : null}
            </section>
          ) : null}

          {kind === "cong_tac" ? (
            <>
              <section className="card dn-sec">
                <h2 className="dn-h">Thông tin phiếu</h2>
                <div className="dn-fields">
                  <label className="field dn-span2"><span>Người đi công tác</span>
                    <select id="ct-traveler" className="input" value={traveler} onChange={(e) => setTraveler(e.target.value)}>
                      {people.filter((p) => p.is_active).map((p) => <option key={p.id} value={p.id}>{p.full_name}</option>)}
                    </select></label>
                  <label className="field dn-span2"><span>Loại công tác</span>
                    <select id="ct-type" className="input" value={tripType} onChange={(e) => setTripType(e.target.value)}>
                      {Object.entries(TRIP_TYPE).map(([k, l]) => <option key={k} value={k}>{l}</option>)}
                    </select></label>
                  <ReadOnly label="Loại tiền" value="VND" />
                  {tripType === "nuoc_ngoai" ? (
                    <label className="field"><span>Loại visa</span>
                      <select id="ct-visa" className="input" value={visaType} onChange={(e) => setVisaType(e.target.value)}>
                        {Object.entries(VISA_TYPE).map(([k, l]) => <option key={k} value={k}>{l}</option>)}
                      </select></label>
                  ) : <ReadOnly label="Số đăng ký" value={docNo ?? "Tự cấp khi gửi"} num />}
                  <label className="field dn-span2"><span>Khu vực quản lý</span>
                    <input id="ct-area" className="input" value={tripArea} onChange={(e) => setTripArea(e.target.value)} placeholder="VD: Miền Đông" /></label>
                  <label className="field dn-span2"><span>Nơi công tác <span className="req">*</span></span>
                    <input id="rq-location" className="input" value={location} onChange={(e) => setLocation(e.target.value)} placeholder="VD: Bình Dương, Vĩnh Long" required /></label>
                  <label className="field dn-span2"><span>Phương tiện <span className="req">*</span></span>
                    <input id="rq-transport" className="input" value={transport} onChange={(e) => setTransport(e.target.value)} placeholder="VD: Xe khách, máy bay" required /></label>
                  <label className="field"><span>Từ ngày <span className="req">*</span></span>
                    <input id="rq-start" type="date" className="input" value={start} required
                      onChange={(e) => { setStart(e.target.value); if (end < e.target.value) setEnd(e.target.value); }} /></label>
                  <label className="field"><span>Đến ngày <span className="req">*</span></span>
                    <input id="rq-end" type="date" className="input" value={end} min={start} required onChange={(e) => setEnd(e.target.value)} /></label>
                  {BuildingSel}
                  <label className="field dn-full"><span>Nội dung <span className="req">*</span></span>
                    <input id="rq-reason" className="input" value={reason} onChange={(e) => setReason(e.target.value)} required
                      placeholder="VD: Tổ chức hội thảo, kiểm tra toà nhà, gặp chủ nhà" /></label>
                </div>
                <div className="calc-line num">Tổng: <b>{fmtDays(days)}</b> · Dự trù chi phí (tự cộng): <b>{vnd(costTotal(costs.filter(costFilled)))}</b></div>
              </section>
              <section className="card dn-sec">
                <LegGrid title="Kế hoạch công tác" rows={legs} setRows={setLegs} people={people.filter((p) => p.is_active)} defaultStaff={traveler || profile?.id || ""} />
              </section>
              <section className="card dn-sec">
                <CostGrid title="Thông tin chi phí (dự trù)" rows={costs} setRows={setCosts} />
                <p className="muted small" style={{ margin: 0 }}>Công ty chưa có định mức công tác phí: nhập đơn giá thực tế dự kiến. Thành tiền = số ngày × số người × đơn giá.</p>
              </section>
              <section className="card dn-sec">
                <h2 className="dn-h">Bàn giao khi vắng</h2>
                <div className="dn-fields">{Handover}</div>
              </section>
            </>
          ) : null}

          {absence && kind !== "cong_tac" ? (
            <section className="card dn-sec">
              <h2 className="dn-h">{kind === "ra_ngoai" ? "Nội dung ra ngoài" : "Lý do nghỉ"}</h2>
              <div className="dn-fields">
                {kind === "ra_ngoai" ? (
                  <label className="field dn-span2"><span>Đi đâu</span>
                    <input id="rq-location" className="input" value={location} onChange={(e) => setLocation(e.target.value)} placeholder="VD: Ngân hàng, toà 89CMT8, chủ nhà…" /></label>
                ) : null}
                {BuildingSel}
              </div>
              <label className="field"><span>{kind === "ra_ngoai" ? "Công việc *" : "Lý do *"}</span>
                <textarea id="rq-reason" className="input" value={reason} onChange={(e) => setReason(e.target.value)} required
                  placeholder={kind === "nghi_phep" ? "VD: Việc gia đình" : ""} /></label>
              <div className="dn-fields">{Handover}</div>
            </section>
          ) : null}

          {/* ---------- Tạm ứng ---------- */}
          {kind === "tam_ung" ? (
            <section className="card dn-sec">
              <h2 className="dn-h">Thông tin</h2>
              <div className="dn-fields">
                <ReadOnly label="Số chứng từ" value={docNo ?? "Tự cấp khi gửi"} num />
                <ReadOnly label="Ngày chứng từ" value={ddmmyyyy(today)} num />
                <ReadOnly label="Loại tiền" value="VND" />
                {LoaField}
                {LoaBudget}
                {ProjectField}
                <MoneyInput id="rq-amount" label="Số tiền tạm ứng" value={amount} onChange={setAmount} required />
                <label className="field"><span>Ngày cần tiền *</span>
                  <input id="rq-start" type="date" className="input" value={start} required onChange={(e) => setStart(e.target.value)} /></label>
                <label className="field"><span>Hạn hoàn ứng</span>
                  <input id="rq-settle" type="date" className="input" value={settleDue} min={start} onChange={(e) => setSettleDue(e.target.value)} /></label>
                <label className="field"><span>Người nhận tiền</span>
                  <input id="rq-payee" className="input" value={payee} onChange={(e) => setPayee(e.target.value)} placeholder={profile?.full_name} /></label>
                <label className="field dn-span2"><span>Số tài khoản, ngân hàng</span>
                  <input id="rq-bank" className="input" value={bank} onChange={(e) => setBank(e.target.value)} placeholder="Để trống nếu nhận tiền mặt" /></label>
                {BuildingSel}
              </div>
              <label className="field dn-full"><span>Lý do tạm ứng *</span>
                <textarea id="rq-reason" className="input" value={reason} onChange={(e) => setReason(e.target.value)} required
                  placeholder="VD: Ứng tiền mua vật tư sửa chữa toà 89CMT8" /></label>
            </section>
          ) : null}

          {/* ---------- Thanh toán ---------- */}
          {isPay ? (
            <>
              <section className="card dn-sec">
                <h2 className="dn-h">Thông tin</h2>
                <div className="dn-fields">
                  <ReadOnly label="Số chứng từ" value={docNo ?? "Tự cấp khi gửi"} num />
                  <ReadOnly label="Ngày chứng từ" value={ddmmyyyy(today)} num />
                  <ReadOnly label="Loại tiền" value="VND" />
                  {LoaField}
                  {LoaBudget}
                  {ProjectField}
                  <label className="field"><span>Hình thức thanh toán <span className="req">*</span></span>
                    <select id="rq-paymethod" className="input" value={payMethod} onChange={(e) => setPayMethod(e.target.value)}>
                      {Object.entries(PAY_METHOD).map(([k, l]) => <option key={k} value={k}>{l}</option>)}
                    </select></label>
                  <label className="field"><span>Loại thanh toán <span className="req">*</span></span>
                    <select id="rq-paytype" className="input" value={payType} onChange={(e) => setPayType(e.target.value)}>
                      {Object.entries(PAY_TYPE).map(([k, l]) => <option key={k} value={k}>{l}</option>)}
                    </select></label>
                  <label className="field"><span>Ngày cần thanh toán <span className="req">*</span></span>
                    <input id="rq-start" type="date" className="input" value={start} required onChange={(e) => setStart(e.target.value)} /></label>
                  {BuildingSel}
                  <label className="field"><span>Mã đơn vị</span>
                    <input id="rq-vendor" className="input" value={vendorCode} onChange={(e) => setVendorCode(e.target.value)} /></label>
                  <label className="field"><span>Tên đơn vị nhận</span>
                    <input id="rq-payee" className="input" value={payee} onChange={(e) => setPayee(e.target.value)} placeholder="VD: Cửa hàng nội thất An Phát" /></label>
                  <label className="field"><span>Mã liên hệ</span>
                    <input id="rq-contact-code" className="input" value={contactCode} onChange={(e) => setContactCode(e.target.value)} /></label>
                  <label className="field"><span>Người liên hệ</span>
                    <input id="rq-contact" className="input" value={contactName} onChange={(e) => setContactName(e.target.value)} /></label>
                  <label className="field dn-span4"><span>{bankReq ? <>Thông tin CK (STK + ngân hàng) <span className="req">*</span></> : "Số tài khoản, ngân hàng"}</span>
                    <input id="rq-bank" className="input" value={bank} onChange={(e) => setBank(e.target.value)} required={bankReq}
                      placeholder={bankReq ? "VD: 20338000 · VietinBank" : "Không cần nếu không chuyển khoản"} /></label>
                  <label className="field dn-full"><span>Nội dung <span className="req">*</span></span>
                    <input id="rq-reason" className="input" value={reason} onChange={(e) => setReason(e.target.value)} required
                      placeholder="VD: Thanh toán sơn và vật tư sửa chữa toà 89CMT8 tháng 11" /></label>
                </div>
              </section>

              <DnttEditor lines={lines} setLines={setLines} advs={advs} setAdvs={setAdvs}
                files={editing ? undefined : files} setFiles={editing ? undefined : setFiles}
                links={editing ? undefined : links} setLinks={editing ? undefined : setLinks}
                onError={setErr} />
              {editing ? <p className="muted small" style={{ margin: 0 }}>Tệp và link đính kèm thêm hoặc xoá ở trang chi tiết của đề nghị.</p> : null}
            </>
          ) : null}

          </div>

          <ChainPreview kind={kind} />

          {err ? <div className="error-box" role="alert">{err}</div> : null}
          <div className="dn-submit">
            {isPay ? (
              <div className="dn-totals num" aria-live="polite">
                <span>Tổng thanh toán <b>{vnd(tot.gross)}</b></span>
                {tot.adv ? <span>Trừ tạm ứng <b>− {vnd(tot.adv)}</b></span> : null}
                <span className={`grand${tot.net <= 0 && hasLines ? " over" : ""}`}>Tổng tiền VNĐ <b>{vnd(tot.net)}</b></span>
                {loaAfter != null ? <span className={loaAfter < 0 ? "over" : ""}>LOA còn lại sau đề nghị <b>{vnd(loaAfter)}</b></span> : null}
                {tot.net > 0 ? <span className="words">{vndWords(tot.net)}</span> : <span className="words">Tổng tiền tự cộng từ các dòng chi tiết.</span>}
              </div>
            ) : (
              <div className="dn-total-words">
                {isMoney && total ? <><b className="num">{vnd(total)}</b><small>{vndWords(total)}</small></>
                  : <small>{editing ? "Lưu và gửi lại để duyệt lại từ cấp đầu." : "Gửi để bắt đầu luồng duyệt."}</small>}
                {loaAfter != null ? <small className={loaAfter < 0 ? "err-text" : ""}>LOA còn lại sau đề nghị: {vnd(loaAfter)}</small> : null}
              </div>
            )}
            <button className="btn" disabled={busy}>{busy ? "Đang gửi…" : editing ? "Lưu và gửi lại" : "Gửi đề nghị"}</button>
          </div>
        </form>
        <LoaPicker open={loaOpen} onClose={() => setLoaOpen(false)} picks={picks} value={loaId} onPick={setLoaId} />
      </main>
    </>
  );
}
