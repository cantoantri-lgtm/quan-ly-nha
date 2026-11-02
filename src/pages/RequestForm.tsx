import { useEffect, useState, type FormEvent } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { friendlyError, supabase } from "../lib/supabase";
import { useSession } from "../lib/session";
import { daysBetween, ddmmyyyy, todayVN, workDays } from "../lib/dates";
import { parseMoney, vnd } from "../lib/money";
import { KINDS, LEAVE_SPAN, LEAVE_TYPE, OUT_TYPE, PAY_METHOD, PAY_TYPE, fmtDays, type Req, type ReqAdvance, type ReqKind, type ReqLine } from "../lib/office";
import { uploadFile } from "../lib/files";
import DnttEditor, { advFromRow, calcLine, lineFromRow, lineToRow, totals, type AdvDraft, type LineDraft, type LinkDraft } from "../components/DnttEditor";
import { TopBar } from "../components/ui";
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
  const { profile, buildings, toast } = useSession();
  const nav = useNavigate();
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
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [loaded, setLoaded] = useState(!editing);
  const [origPending, setOrigPending] = useState(0);   // đơn đang sửa đã nằm trong số "chờ duyệt"
  // Đề nghị thanh toán đầy đủ
  const [payMethod, setPayMethod] = useState("chuyen_khoan");
  const [payType, setPayType] = useState("nha_cung_cap");
  const [loa, setLoa] = useState("");
  const [vendorCode, setVendorCode] = useState("");
  const [contactName, setContactName] = useState("");
  const [contactCode, setContactCode] = useState("");
  const [docNo, setDocNo] = useState<string | null>(null);
  const [lines, setLines] = useState<LineDraft[]>([]);
  const [advs, setAdvs] = useState<AdvDraft[]>([]);
  const [files, setFiles] = useState<File[]>([]);
  const [links, setLinks] = useState<LinkDraft[]>([]);

  const balance = useLeaveBalance(profile?.id);

  useEffect(() => {
    if (!id) return;
    supabase.from("requests").select("*").eq("id", id).maybeSingle().then(({ data }) => {
      const r = data as Req | null;
      if (!r) { nav("/van-phong", { replace: true }); return; }
      setKind(r.kind); setSubType(r.sub_type ?? ""); setSpan(r.span ?? "ca_ngay");
      setStart(r.start_date); setEnd(r.end_date ?? r.start_date);
      setT1(r.start_time?.slice(0, 5) ?? ""); setT2(r.end_time?.slice(0, 5) ?? "");
      setLocation(r.location ?? ""); setReason(r.reason); setAmount(r.amount ? String(r.amount) : "");
      setPayee(r.payee ?? ""); setBank(r.bank_info ?? ""); setBuildingId(r.building_id ?? "");
      if (r.kind === "nghi_phep" && r.sub_type === "phep_nam" && r.status === "cho_duyet") setOrigPending(Number(r.days ?? 0));
      setPayMethod(r.pay_method ?? (r.bank_info ? "chuyen_khoan" : "tien_mat")); setPayType(r.pay_type ?? "khac");
      setLoa(r.loa_no ?? ""); setVendorCode(r.vendor_code ?? ""); setContactName(r.contact_name ?? ""); setContactCode(r.contact_code ?? "");
      setDocNo(r.doc_no);
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
  const isPay = kind === "thanh_toan";
  const hasLines = isPay && lines.length > 0;
  const tot = totals(lines, advs);
  const multiDay = kind === "cong_tac" || (kind === "nghi_phep" && span === "ca_ngay") || kind === "ra_ngoai";
  const isSunday = (iso: string) => new Date(iso + "T00:00:00Z").getUTCDay() === 0;
  const days = kind === "nghi_phep"
    ? (span !== "ca_ngay" ? (isSunday(start) ? 0 : 0.5) : end >= start ? workDays(start, end) : 0)   // nghỉ phép: bỏ Chủ nhật
    : end >= start ? daysBetween(start, end) + 1 : 0;
  const sundays = kind === "nghi_phep" && span === "ca_ngay" && end >= start ? daysBetween(start, end) + 1 - days : 0;
  const quota = profile?.annual_leave_days == null ? null : Number(profile.annual_leave_days);
  const leftAfter = balance && quota != null && kind === "nghi_phep" && subType === "phep_nam" ? quota - balance.used - (balance.pending - origPending) - days : null;

  async function submit(e: FormEvent) {
    e.preventDefault();
    setErr(null);
    const amt = hasLines ? tot.net : parseMoney(amount);
    if (isMoney && !amt) { setErr(hasLines ? "Tiền tạm ứng phải nhỏ hơn tổng thanh toán." : "Nhập số tiền đề nghị."); return; }
    if (!hasLines && amount && !amt) { setErr("Số tiền chưa đúng định dạng."); return; }
    if (isPay) {
      if (payMethod === "chuyen_khoan" && !bank.trim()) { setErr("Nhập số tài khoản và ngân hàng nhận tiền."); return; }
      for (let i = 0; i < lines.length; i++) {
        if (!calcLine(lines[i]).pre) { setErr(`Khoản ${i + 1}: nhập tiền trước VAT.`); return; }
        if (!lines[i].cost_center.trim()) { setErr(`Khoản ${i + 1}: nhập Cost Center.`); return; }
      }
      for (let i = 0; i < advs.length; i++) if (!parseMoney(advs[i].amount)) { setErr(`Tạm ứng ${i + 1}: nhập số tiền.`); return; }
    }
    if (multiDay && end < start) { setErr("Ngày kết thúc phải sau ngày bắt đầu."); return; }
    if (kind === "nghi_phep" && days === 0) { setErr("Chủ nhật công ty nghỉ, không cần xin nghỉ phép."); return; }
    if (kind === "ra_ngoai" && t1 && t2 && t2 <= t1) { setErr("Giờ về phải sau giờ đi."); return; }
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
      amount: isMoney || kind === "cong_tac" ? amt : null,
      payee: isMoney ? payee.trim() || null : null,
      bank_info: isMoney ? bank.trim() || null : null,
      building_id: buildingId || null,
      pay_method: isPay ? payMethod : null,
      pay_type: isPay ? payType : null,
      loa_no: isPay ? loa.trim() || null : null,
      vendor_code: isPay ? vendorCode.trim() || null : null,
      contact_name: isPay ? contactName.trim() || null : null,
      contact_code: isPay ? contactCode.trim() || null : null,
    };
    setBusy(true);
    const res = editing
      ? await supabase.from("requests").update(row).eq("id", id!).select("id").single()
      : await supabase.from("requests").insert(row).select("id").single();
    if (res.error) { setBusy(false); setErr(friendlyError(res.error)); return; }
    const rid = res.data.id as string;
    const problems: string[] = [];
    if (isPay) {
      // Xoá tạm ứng trước khoản chi để tổng không bao giờ âm giữa chừng
      if (editing) {
        const d1 = await supabase.from("request_advances").delete().eq("request_id", rid);
        const d2 = await supabase.from("request_lines").delete().eq("request_id", rid);
        if (d1.error || d2.error) problems.push(friendlyError((d1.error || d2.error)!));
      }
      if (lines.length) {
        const r1 = await supabase.from("request_lines").insert(lines.map((l, i) => ({ ...lineToRow(l, i), request_id: rid })));
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
    setBusy(false);
    if (problems.length) {
      toast(`Đã lưu đề nghị nhưng có lỗi: ${problems.join("; ")}. Mở đề nghị để bổ sung.`);
      nav(`/van-phong/${rid}`, { replace: true });
      return;
    }
    toast(editing ? "Đã lưu thay đổi." : "Đã gửi đề nghị, chờ quản lý duyệt.");
    nav(`/van-phong/${rid}`, { replace: true });
  }

  if (!loaded) return (<><TopBar title="Sửa đề nghị" back /><div className="loading">Đang tải…</div></>);

  if (isPay) {
    const bankReq = payMethod === "chuyen_khoan";
    return (
      <>
        <TopBar title={editing ? "Sửa đề nghị thanh toán" : meta.label} back />
        <main className="main main-wide">
          <form className="stack dn-form" onSubmit={submit}
            onKeyDown={(e) => { if (e.key === "Enter" && (e.target as HTMLElement).tagName === "INPUT") e.preventDefault(); }}>
            <section className="card dn-sec">
              <h2 className="dn-h">Thông tin chứng từ</h2>
              <div className="dn-fields">
                <div className="field"><span>Người đề nghị</span><div className="input ro">{profile?.full_name}</div></div>
                <div className="field"><span>Số chứng từ</span><div className="input ro num">{docNo ?? "Tự cấp khi gửi"}</div></div>
                <div className="field"><span>Ngày chứng từ</span><div className="input ro num">{ddmmyyyy(today)}</div></div>
                <div className="field"><span>Loại tiền</span><div className="input ro">VND</div></div>
                <label className="field"><span>LOA No.</span>
                  <input id="rq-loa" className="input" value={loa} onChange={(e) => setLoa(e.target.value)} /></label>
                <label className="field"><span>Loại thanh toán *</span>
                  <select id="rq-paytype" className="input" value={payType} onChange={(e) => setPayType(e.target.value)}>
                    {Object.entries(PAY_TYPE).map(([k, l]) => <option key={k} value={k}>{l}</option>)}
                  </select></label>
                <div className="field"><span>Hình thức thanh toán *</span><Options name="Hình thức thanh toán" value={payMethod} options={PAY_METHOD} onChange={setPayMethod} /></div>
                <label className="field"><span>Ngày cần thanh toán *</span>
                  <input id="rq-start" type="date" className="input" value={start} required onChange={(e) => setStart(e.target.value)} /></label>
                {buildings.length ? (
                  <label className="field"><span>Toà nhà liên quan</span>
                    <select id="rq-building" className="input" value={buildingId} onChange={(e) => setBuildingId(e.target.value)}>
                      <option value="">Không gắn toà</option>
                      {buildings.map((b) => <option key={b.id} value={b.id}>{b.code} · {b.name}</option>)}
                    </select></label>
                ) : null}
              </div>
            </section>

            <section className="card dn-sec">
              <h2 className="dn-h">Đơn vị nhận tiền</h2>
              <div className="dn-fields">
                <label className="field"><span>Tên đơn vị</span>
                  <input id="rq-payee" className="input" value={payee} onChange={(e) => setPayee(e.target.value)} placeholder="VD: Cửa hàng nội thất An Phát" /></label>
                <label className="field"><span>Mã đơn vị</span>
                  <input id="rq-vendor" className="input" value={vendorCode} onChange={(e) => setVendorCode(e.target.value)} /></label>
                <label className="field"><span>Người liên hệ</span>
                  <input id="rq-contact" className="input" value={contactName} onChange={(e) => setContactName(e.target.value)} /></label>
                <label className="field"><span>Mã liên hệ</span>
                  <input id="rq-contact-code" className="input" value={contactCode} onChange={(e) => setContactCode(e.target.value)} /></label>
                <label className="field dn-span2"><span>{bankReq ? "Thông tin chuyển khoản (STK, ngân hàng) *" : "Số tài khoản, ngân hàng"}</span>
                  <input id="rq-bank" className="input" value={bank} onChange={(e) => setBank(e.target.value)} required={bankReq}
                    placeholder={bankReq ? "VD: 20338000 · VietinBank" : "Không cần nếu trả tiền mặt"} /></label>
              </div>
              <label className="field"><span>Nội dung *</span>
                <textarea id="rq-reason" className="input" value={reason} onChange={(e) => setReason(e.target.value)} required
                  placeholder="VD: Mua 2 bộ bàn ghế ngoài trời cho 89CMT8" /></label>
            </section>

            {!hasLines ? (
              <section className="card dn-sec">
                <MoneyInput id="rq-amount" label="Số tiền" value={amount} onChange={setAmount} required />
              </section>
            ) : null}

            <DnttEditor lines={lines} setLines={setLines} advs={advs} setAdvs={setAdvs}
              files={editing ? undefined : files} setFiles={editing ? undefined : setFiles}
              links={editing ? undefined : links} setLinks={editing ? undefined : setLinks}
              onError={setErr} />
            {editing ? <p className="muted small" style={{ margin: 0 }}>Tệp và link đính kèm thêm hoặc xoá ở trang chi tiết của đề nghị.</p> : null}

            {err ? <div className="error-box" role="alert">{err}</div> : null}
            <div className="dn-submit">
              <div className="num">{hasLines ? <>Tổng tiền VNĐ: <b>{vnd(tot.net)}</b></> : amount ? <b>{vnd(parseMoney(amount))}</b> : null}</div>
              <button className="btn" disabled={busy}>{busy ? "Đang gửi…" : editing ? "Lưu thay đổi" : "Gửi đề nghị"}</button>
            </div>
          </form>
        </main>
      </>
    );
  }

  return (
    <>
      <TopBar title={editing ? "Sửa đề nghị" : meta.label} back />
      <main className="main">
        <form className="stack" onSubmit={submit}>
          {kind === "nghi_phep" ? (
            <>
              <div className="field"><span>Loại nghỉ</span><Options name="Loại nghỉ" value={subType} options={LEAVE_TYPE} onChange={setSubType} /></div>
              <div className="field"><span>Thời gian nghỉ</span><Options name="Thời gian nghỉ" value={span} options={LEAVE_SPAN} onChange={setSpan} /></div>
            </>
          ) : null}
          {kind === "ra_ngoai" ? (
            <div className="field"><span>Hình thức</span><Options name="Hình thức" value={subType} options={OUT_TYPE} onChange={setSubType} /></div>
          ) : null}
          {kind === "cong_tac" ? (
            <label className="field"><span>Nơi công tác *</span>
              <input id="rq-location" className="input" value={location} onChange={(e) => setLocation(e.target.value)} placeholder="VD: Đà Lạt" required /></label>
          ) : null}

          {isMoney ? (
            <MoneyInput id="rq-amount" label="Số tiền" value={amount} onChange={setAmount} required />
          ) : null}

          <div className="row" style={{ alignItems: "flex-start" }}>
            <label className="field" style={{ flex: "1 1 140px" }}>
              <span>{isMoney ? "Cần tiền trước ngày" : multiDay ? (kind === "cong_tac" ? "Ngày đi *" : "Từ ngày *") : "Ngày *"}</span>
              <input id="rq-start" type="date" className="input" value={start} required
                onChange={(e) => { setStart(e.target.value); if (end < e.target.value) setEnd(e.target.value); }} /></label>
            {multiDay ? (
              <label className="field" style={{ flex: "1 1 140px" }}><span>{kind === "cong_tac" ? "Ngày về *" : "Đến ngày"}</span>
                <input id="rq-end" type="date" className="input" value={end} min={start} required onChange={(e) => setEnd(e.target.value)} /></label>
            ) : null}
          </div>

          {kind === "ra_ngoai" ? (
            <div className="row" style={{ alignItems: "flex-start" }}>
              <label className="field" style={{ flex: "1 1 120px" }}><span>{subType === "khong_den_cty" ? "Bắt đầu lúc" : "Rời công ty lúc"}</span>
                <input id="rq-t1" type="time" className="input" value={t1} onChange={(e) => setT1(e.target.value)} /></label>
              {subType === "co_quay_lai" ? (
                <label className="field" style={{ flex: "1 1 120px" }}><span>Quay lại lúc</span>
                  <input id="rq-t2" type="time" className="input" value={t2} onChange={(e) => setT2(e.target.value)} /></label>
              ) : null}
            </div>
          ) : null}
          {kind === "ra_ngoai" ? (
            <label className="field"><span>Đi đâu</span>
              <input id="rq-location" className="input" value={location} onChange={(e) => setLocation(e.target.value)} placeholder="VD: Ngân hàng, toà 89CMT8, chủ nhà…" /></label>
          ) : null}

          {kind === "nghi_phep" || kind === "cong_tac" ? (
            <div className="calc-line num">
              {days > 0 ? <>Tổng: <b>{fmtDays(days)}</b>{sundays ? ` (không tính ${sundays} Chủ nhật)` : ""}</> : kind === "nghi_phep" ? <span className="over">Chủ nhật công ty nghỉ</span> : null}
              {leftAfter != null ? <span className={leftAfter < 0 ? "over" : ""}> · {leftAfter < 0 ? `vượt ${fmtDays(-leftAfter)} phép năm` : `còn ${fmtDays(leftAfter)} phép năm sau đơn này`}</span> : null}
            </div>
          ) : null}

          <label className="field"><span>{isMoney ? "Nội dung chi *" : kind === "cong_tac" ? "Mục đích công tác *" : kind === "ra_ngoai" ? "Công việc *" : "Lý do *"}</span>
            <textarea id="rq-reason" className="input" value={reason} onChange={(e) => setReason(e.target.value)} required
              placeholder={isMoney ? "VD: Mua 2 bộ bàn ghế ngoài trời cho 89CMT8" : kind === "nghi_phep" ? "VD: Việc gia đình" : ""} /></label>

          {kind === "cong_tac" ? <MoneyInput id="rq-amount" label="Dự trù chi phí" value={amount} onChange={setAmount} /> : null}

          {isMoney ? (
            <>
              <label className="field"><span>{kind === "tam_ung" ? "Người nhận tiền" : "Tên đơn vị nhận tiền"}</span>
                <input id="rq-payee" className="input" value={payee} onChange={(e) => setPayee(e.target.value)} placeholder={kind === "tam_ung" ? profile?.full_name : "VD: Cửa hàng nội thất An Phát"} /></label>
              <label className="field"><span>Số tài khoản, ngân hàng</span>
                <input id="rq-bank" className="input" value={bank} onChange={(e) => setBank(e.target.value)}
                  placeholder="Để trống nếu nhận tiền mặt" /></label>
            </>
          ) : null}


          {kind !== "nghi_phep" && buildings.length ? (
            <label className="field"><span>Toà nhà liên quan</span>
              <select id="rq-building" className="input" value={buildingId} onChange={(e) => setBuildingId(e.target.value)}>
                <option value="">Không gắn toà</option>
                {buildings.map((b) => <option key={b.id} value={b.id}>{b.code} · {b.name}</option>)}
              </select></label>
          ) : null}

          {err ? <div className="error-box" role="alert">{err}</div> : null}
          <button className="btn block" disabled={busy}>{busy ? "Đang gửi…" : editing ? "Lưu thay đổi" : "Gửi đề nghị"}</button>
          {!editing ? <p className="muted small" style={{ textAlign: "center", margin: 0 }}>Quản lý sẽ nhận thông báo để duyệt.</p> : null}
        </form>
      </main>
    </>
  );
}
