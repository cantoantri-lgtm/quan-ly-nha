import { useCallback, useEffect, useMemo, useState } from "react";
import { Link, Navigate, useNavigate, useParams, useSearchParams } from "react-router-dom";
import { friendlyError, supabase } from "../lib/supabase";
import { useSession } from "../lib/session";
import { ddmmyyyy, todayVN } from "../lib/dates";
import { vnd } from "../lib/money";
import { DUTY_LABEL, EDIT_LOCK_TIP, FLOW_TEXT, KINDS, PAUSED_TIP, usePausedKinds, deleteRequest, isEditableStatus, isFinished, kindLabel, moneyCur, statusLabel, summary, vnDate,
  type LoaLine, type Req, type ReqKind, type ReqLine, type ReqStep } from "../lib/office";
import { Icon, Sheet } from "../components/ui";
import { Pager, usePaging } from "../components/Pager";
import { RelatedPanel } from "../components/RelatedPanel";
import DecideSheet, { type DecideMode } from "../components/DecideSheet";
import { CostTable, LegTable } from "../components/TripGrids";
import { loadTrip, type TripCost, type TripLeg } from "../lib/trip";
import "../office.css";
import "../table.css";

type Tab = "tat_ca" | "cua_toi" | "duyet" | "xu_ly" | "can_sua" | "xac_nhan" | "hoan_tat";

const csvCell = (v: string | number | null | undefined) => `"${String(v ?? "").replace(/"/g, '""')}"`;

/** Danh sách một loại đề nghị: thẻ đếm, lọc theo tháng, tìm kiếm, bảng, Thêm / Xem / Sửa / Xoá, chi tiết phía dưới */
export default function RequestList() {
  const { kind: kindParam } = useParams();
  const meta = KINDS.find((k) => k.kind === kindParam);
  if (!meta) return <Navigate to="/van-phong" replace />;
  return <List kind={meta.kind} label={meta.label} />;
}

function List({ kind, label }: { kind: ReqKind; label: string }) {
  const { profile, people, isManager, toast, refreshUnread } = useSession();
  const nav = useNavigate();
  const [params, setParams] = useSearchParams();
  const tab = (params.get("tab") as Tab) || "tat_ca";
  const money = kind === "thanh_toan" || kind === "tam_ung";
  const loa = kind === "loa";
  const trip = kind === "cong_tac";
  const noun = loa ? "tờ trình" : "đề nghị";
  const newUrl = loa ? "/van-phong/loa/moi" : `/van-phong/moi/${kind}`;
  const { paused } = usePausedKinds();
  const closed = paused.has(kind) && !isManager;   // tạm ngưng với nhân viên
  const editUrl = (r: Req) => (loa ? `/van-phong/loa/${r.id}/sua` : `/van-phong/${r.id}/sua`);

  const thisMonth = todayVN().slice(0, 7);
  const [from, setFrom] = useState(thisMonth);
  const [to, setTo] = useState(thisMonth);
  const [text, setText] = useState("");
  const [applied, setApplied] = useState("");

  const [rows, setRows] = useState<Req[]>([]);
  const [queue, setQueue] = useState<Set<string>>(new Set());
  const [steps, setSteps] = useState<Record<string, ReqStep[]>>({});
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);
  const [selId, setSelId] = useState<string | null>(null);
  const [lines, setLines] = useState<ReqLine[]>([]);
  const [loaLines, setLoaLines] = useState<LoaLine[]>([]);
  const [coEdit, setCoEdit] = useState<Set<string>>(new Set());   // tờ trình mình là người cùng soạn
  const [tripData, setTripData] = useState<{ legs: TripLeg[]; costs: TripCost[]; act: boolean } | null>(null);
  const [decide, setDecide] = useState<DecideMode | null>(null);
  const hasPanel = kind === "thanh_toan" || loa || trip;
  const [panel, setPanel] = useState<"ct" | "cp" | "duyet" | "lk">(hasPanel ? "ct" : "duyet");
  const [delReq, setDelReq] = useState<Req | null>(null);
  const [busy, setBusy] = useState(false);
  const [help, setHelp] = useState(false);

  const load = useCallback(async () => {
    if (!profile) return;
    setErr(null);
    const [{ data, error }, q] = await Promise.all([
      supabase.from("requests").select("*").eq("kind", kind).order("created_at", { ascending: false }).limit(1000),
      supabase.rpc("my_approval_queue"),
    ]);
    if (error) setErr(friendlyError(error));
    const list = (data as Req[]) ?? [];
    setRows(list);
    setQueue(new Set(((q.data ?? []) as { request_id: string }[]).map((x) => x.request_id)));
    if (kind === "loa") {
      const { data: m } = await supabase.from("loa_members").select("request_id").eq("user_id", profile.id).eq("role", "soan");
      setCoEdit(new Set(((m ?? []) as { request_id: string }[]).map((x) => x.request_id)));
    }
    if (list.length) {
      const st: Record<string, ReqStep[]> = {};
      for (let i = 0; i < list.length; i += 200) {
        const { data: s } = await supabase.from("request_steps").select("*").in("request_id", list.slice(i, i + 200).map((r) => r.id)).order("step_no");
        ((s ?? []) as ReqStep[]).forEach((x) => { (st[x.request_id] ??= []).push(x); });
      }
      setSteps(st);
    } else setSteps({});
    setLoading(false);
  }, [profile, kind]);

  useEffect(() => { setLoading(true); load(); }, [load]);
  useEffect(() => {
    const h = () => load();
    window.addEventListener("neo:notification", h);
    window.addEventListener("focus", h);
    return () => { window.removeEventListener("neo:notification", h); window.removeEventListener("focus", h); };
  }, [load]);
  // Phím tắt F2: thêm mới
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === "F2" && !closed) { e.preventDefault(); nav(newUrl); } };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [nav, newUrl, closed]);

  const name = (id: string | null) => people.find((p) => p.id === id)?.full_name ?? "—";

  // Lọc theo tháng + từ khoá (các thẻ đếm tính trên kết quả này)
  const base = useMemo(() => {
    const kw = applied.trim().toLowerCase();
    return rows.filter((r) => {
      const m = (r.doc_date ?? vnDate(r.created_at)).slice(0, 7);
      if (from && m < from) return false;
      if (to && m > to) return false;
      if (!kw) return true;
      return [r.doc_no, r.reason, r.payee, r.location, name(r.requester_id), name(r.traveler_id ?? null)].some((v) => (v ?? "").toLowerCase().includes(kw));
    });
  }, [rows, from, to, applied, people]); // eslint-disable-line react-hooks/exhaustive-deps

  const inTab = useCallback((r: Req, t: Tab) =>
    t === "tat_ca" ? true
    : t === "cua_toi" ? r.requester_id === profile?.id || r.traveler_id === profile?.id
    : t === "xac_nhan" ? r.status === "hoan_tat" && !r.hr_confirmed_at
    : t === "duyet" ? queue.has(r.id)
    : t === "xu_ly" ? (r.status === "cho_duyet" || (r.status === "da_duyet" && !isFinished(r))) || r.status === "tra_lai"
    : t === "can_sua" ? isEditableStatus(r.status) && r.status !== "da_huy"
    : isFinished(r), [queue, profile?.id]);
  const shown = useMemo(() => base.filter((r) => inTab(r, tab)), [base, tab, inTab]);
  const n = (t: Tab) => base.filter((r) => inTab(r, t)).length;
  const paging = usePaging(shown);
  useEffect(() => { paging.setPage(1); }, [tab, from, to, applied]); // eslint-disable-line react-hooks/exhaustive-deps

  const setTab = (t: Tab) => { const p = new URLSearchParams(params); if (t === "tat_ca") p.delete("tab"); else p.set("tab", t); setParams(p, { replace: true }); };
  const total = shown.reduce((s, r) => s + Number(r.amount ?? 0), 0);

  // Chi tiết dòng đang chọn
  const sel = rows.find((r) => r.id === selId) ?? null;
  useEffect(() => {
    setLines([]); setLoaLines([]); setTripData(null);
    if (!sel) return;
    if (kind === "cong_tac") loadTrip(sel.id).then((t) => {
      const act = sel.status === "hoan_tat" && (t.actLegs.length > 0 || t.actCosts.length > 0);
      setTripData({ legs: act && t.actLegs.length ? t.actLegs : t.planLegs, costs: act && t.actCosts.length ? t.actCosts : t.planCosts, act });
    });
    if (kind === "thanh_toan") supabase.from("request_lines").select("*").eq("request_id", sel.id).order("line_no").then(({ data }) => setLines((data ?? []) as ReqLine[]));
    if (kind === "loa") supabase.from("loa_lines").select("*").eq("request_id", sel.id).order("line_no").then(({ data }) => setLoaLines((data ?? []) as LoaLine[]));
  }, [sel?.id, kind]); // eslint-disable-line react-hooks/exhaustive-deps

  const curStep = (r: Req) => (r.status === "cho_duyet" ? (steps[r.id] ?? []).find((s) => s.status === "cho") : undefined);

  function exportCsv() {
    const head = loa ? ["Số LOA", "Ngày", "Người trình", "Tiêu đề", "Số tiền", "Loại tiền", "Trạng thái"]
      : money
      ? ["Số chứng từ", "Ngày", "Người đề nghị", "Nội dung", "Đơn vị nhận", "Số tiền", "Trạng thái"]
      : trip
      ? ["Số đăng ký", "Ngày gửi", "Người đề nghị", "Người đi", "Nơi công tác", "Kế hoạch", "Nội dung", "Dự trù", "Thực tế từ", "Thực tế đến", "Chi phí thực tế", "Nhân sự xác nhận", "Trạng thái"]
      : ["Ngày gửi", "Người đề nghị", "Thời gian", "Lý do", "Trạng thái"];
    const lines = shown.map((r) => loa
      ? [r.doc_no, ddmmyyyy(r.doc_date ?? vnDate(r.created_at)), name(r.requester_id), r.reason, r.amount, r.currency, statusLabel(r)]
      : money
      ? [r.doc_no, ddmmyyyy(r.doc_date ?? r.created_at), name(r.requester_id), r.reason, r.payee, r.amount, statusLabel(r)]
      : trip
      ? [r.doc_no, ddmmyyyy(vnDate(r.created_at)), name(r.requester_id), name(r.traveler_id ?? r.requester_id), r.location, summary(r), r.reason, r.amount,
         r.actual_start ? ddmmyyyy(r.actual_start) : "", r.actual_end ? ddmmyyyy(r.actual_end) : "", r.actual_cost, r.hr_confirmed_at ? "Đã xác nhận" : "", statusLabel(r)]
      : [ddmmyyyy(vnDate(r.created_at)), name(r.requester_id), summary(r), r.reason, statusLabel(r)]);
    const csv = "﻿" + [head, ...lines].map((l) => l.map(csvCell).join(",")).join("\r\n");
    const a = document.createElement("a");
    a.href = URL.createObjectURL(new Blob([csv], { type: "text/csv;charset=utf-8" }));
    a.download = `${kind}_${from || "tat-ca"}_${to || ""}.csv`;
    a.click();
    URL.revokeObjectURL(a.href);
  }

  async function doDelete() {
    if (!delReq) return;
    setBusy(true);
    try {
      await deleteRequest(delReq.id);
      toast(`Đã xoá ${noun}.`);
      if (selId === delReq.id) setSelId(null);
      setDelReq(null); await load(); refreshUnread();
    } catch (e) { toast(friendlyError(e)); }
    setBusy(false);
  }

  const mine = (r: Req) => r.requester_id === profile?.id;
  const canEdit = (r: Req) => (mine(r) || coEdit.has(r.id)) && isEditableStatus(r.status);
  const canDel = (r: Req) => (mine(r) || isManager) && isEditableStatus(r.status);
  const lockTip = (r: Req, what: string) => (isEditableStatus(r.status) ? (what === "sửa" ? (loa ? "Chỉ người lập và người cùng soạn mới sửa được" : "Chỉ người lập đề nghị mới sửa được") : "Chỉ người lập hoặc Quản lý mới xoá được") : EDIT_LOCK_TIP);

  const tiles: [Tab, string][] = trip
    ? [["tat_ca", "Tất cả"], ["cua_toi", "Đăng ký của tôi"], ["duyet", "Chờ bạn duyệt"], ["xu_ly", "Đang xử lý"], ["can_sua", "Cần sửa"], ["xac_nhan", "Chờ nhân sự xác nhận"], ["hoan_tat", "Đã hoàn tất"]]
    : [["tat_ca", "Tất cả"], ["duyet", "Chờ bạn duyệt"], ["xu_ly", "Đang xử lý"], ["can_sua", loa ? "Nháp / cần sửa" : "Cần sửa"], ["hoan_tat", "Đã hoàn tất"]];
  const canDecideSel = !!sel && queue.has(sel.id) && sel.status === "cho_duyet";
  const dateRange = (r: Req) => summary(r);

  return (
    <main className="main main-full stack" style={{ gap: 14 }}>
      <div className="pg-card" style={{ padding: "10px 16px" }}>
        <div className="row" style={{ justifyContent: "space-between", flexWrap: "wrap" }}>
          <div className="row">
            <Link to="/van-phong" className="ico-btn" aria-label="Quay lại Văn phòng số" title="Quay lại">{Icon.back}</Link>
            <span className="btn sm" style={{ cursor: "default" }}>{label}</span>
            <details className="menu-dd">
              <summary className="btn ghost sm">{Icon.chart}Báo cáo ▾</summary>
              <div className="menu-pop">
                <button type="button" onClick={exportCsv} disabled={!shown.length}>{Icon.download}Xuất Excel (CSV) danh sách</button>
                <button type="button" onClick={() => window.print()}>{Icon.print}In danh sách</button>
              </div>
            </details>
          </div>
          <button type="button" className="btn ghost sm" onClick={() => setHelp(true)}>{Icon.help}Hướng dẫn</button>
        </div>
      </div>

      <section className="pg-card">
        <div className="tiles" role="group" aria-label="Lọc theo trạng thái">
          {tiles.map(([t, l]) => (
            <button key={t} className="tile" aria-pressed={tab === t} onClick={() => setTab(t)}><b>{n(t)}</b> {l}</button>
          ))}
        </div>
        <form className="filterbar" onSubmit={(e) => { e.preventDefault(); setApplied(text); }}>
          <input className="input" type="month" aria-label="Từ tháng" value={from} max={to || undefined} onChange={(e) => setFrom(e.target.value)} />
          <input className="input" type="month" aria-label="Đến tháng" value={to} min={from || undefined} onChange={(e) => setTo(e.target.value)} />
          <button type="button" className="btn secondary sm" onClick={() => { const y = todayVN().slice(0, 4); setFrom(`${y}-01`); setTo(`${y}-12`); }}>Trong năm</button>
          <button type="button" className="btn ghost sm" onClick={() => { setFrom(""); setTo(""); }}>Tất cả thời gian</button>
          <input className="input search" placeholder={loa ? "Tìm số LOA, tiêu đề, người trình…" : money ? "Tìm số chứng từ, đơn vị, nội dung…" : "Tìm người đề nghị, lý do…"} value={text} onChange={(e) => setText(e.target.value)} />
          <button className="btn secondary sm">Tìm</button>
        </form>
        <div className="toolbar ribbon" role="toolbar" aria-label="Thao tác">
          {closed ? <button type="button" className="rb rb-main" disabled title={PAUSED_TIP}>{Icon.plus}Thêm · tạm ngưng</button>
            : <Link to={newUrl} className="rb rb-main" title={`Thêm ${noun} mới (F2)`}>{Icon.plus}Thêm (F2)</Link>}
          <button type="button" className="rb" disabled={!sel} title={sel ? `Xem ${noun} đang chọn` : "Chọn một dòng trước"} onClick={() => sel && nav(`/van-phong/${sel.id}`)}>{Icon.eye}Xem</button>
          <button type="button" className="rb" disabled={!sel || !canEdit(sel)} title={!sel ? "Chọn một dòng trước" : canEdit(sel) ? `Sửa ${noun}` : lockTip(sel, "sửa")} onClick={() => sel && nav(editUrl(sel))}>{Icon.edit}Sửa</button>
          <button type="button" className="rb" disabled={!sel || !canDel(sel)} title={!sel ? "Chọn một dòng trước" : canDel(sel) ? `Xoá ${noun}` : lockTip(sel, "xoá")} onClick={() => sel && setDelReq(sel)}>{Icon.trash}Xoá</button>
          {trip ? <button type="button" className="rb" disabled={!sel || closed} title={sel ? "Tạo phiếu mới chép từ phiếu đang chọn" : "Chọn một dòng trước"} onClick={() => sel && nav(`/van-phong/moi/cong_tac?tu=${sel.id}`)}>{Icon.copy}Nhân bản</button> : null}
          {trip ? <>
            <span className="rb-sep" aria-hidden="true" />
            <button type="button" className="rb" disabled={!canDecideSel} title={canDecideSel ? "Duyệt phiếu đang chọn" : "Chọn phiếu đang chờ bạn duyệt"} onClick={() => setDecide("da_duyet")}>{Icon.check}Duyệt</button>
            <button type="button" className="rb" disabled={!canDecideSel} title="Trả lại để người lập sửa" onClick={() => setDecide("tra_lai")}>{Icon.undo}Trả lại</button>
            <button type="button" className="rb" disabled={!canDecideSel} title="Từ chối phiếu" onClick={() => setDecide("tu_choi")}>{Icon.x}Từ chối</button>
          </> : null}
          <span className="rb-sep" aria-hidden="true" />
          <button type="button" className="rb" title="In danh sách" onClick={() => window.print()}>{Icon.print}In</button>
          <button type="button" className="rb" title="Tải danh sách dạng CSV, mở bằng Excel" disabled={!shown.length} onClick={exportCsv}>{Icon.download}Xuất Excel</button>
          <button type="button" className="rb" title="Tải lại dữ liệu" onClick={() => { setLoading(true); load(); }}>{Icon.refresh}Làm mới</button>
          <span className="rb-sep" aria-hidden="true" />
          <button type="button" className="rb" onClick={() => setHelp(true)}>{Icon.help}Hướng dẫn</button>
          <span className="tl-title">{label}</span>
        </div>

        {closed ? <div className="ok-box" style={{ margin: 12 }}>{label} đang tạm ngưng với nhân viên. Bạn vẫn xem được đề nghị đã gửi; lập mới khi Quản lý mở lại.</div> : null}
        {err ? <div className="error-box" style={{ margin: 12 }}>{err}</div> : null}
        {loading ? <div className="dt-empty">Đang tải…</div> : shown.length === 0 ? (
          <div className="dt-empty"><b>Không có {noun} nào</b><br />Đổi tháng / bộ lọc hoặc bấm “+ Thêm” để lập {noun} mới.</div>
        ) : (
          <div className="dt-wrap">
            <table className="dt cards">
              <thead>
                <tr>
                  <th>Thao tác</th>
                  {loa ? <><th>Số LOA</th><th>Ngày</th></> : money ? <><th>Số chứng từ</th><th>Ngày</th></> : trip ? <><th>Số đăng ký</th><th>Ngày gửi</th></> : <th>Ngày gửi</th>}
                  <th>{loa ? "Người trình" : "Người đề nghị"}</th>
                  {loa ? <><th>Tiêu đề</th><th className="r">Số tiền</th></>
                    : money ? <><th>Nội dung</th><th>Đơn vị nhận</th><th className="r">Tiền đề nghị</th></>
                    : trip ? <><th>Người đi</th><th>Nơi công tác</th><th>Kế hoạch</th><th>Nội dung</th><th className="r">Dự trù</th><th>Thực tế</th><th className="r">Chi phí TT</th><th>Nhân sự XN</th></>
                    : <><th>Thời gian</th><th>Lý do</th></>}
                  <th>Trạng thái</th><th>Đang chờ</th>
                </tr>
              </thead>
              <tbody>
                {paging.slice.map((r) => {
                  const cs = curStep(r);
                  return (
                    <tr key={r.id} className={r.id === selId ? "sel" : ""} onClick={() => setSelId(r.id)}>
                      <td className="acts-cell" onClick={(e) => e.stopPropagation()}>
                        <div className="acts">
                          <Link className="ico-btn" to={`/van-phong/${r.id}`} aria-label="Xem" title="Xem chi tiết">{Icon.eye}</Link>
                          {canEdit(r)
                            ? <Link className="ico-btn" to={editUrl(r)} aria-label="Sửa" title={`Sửa ${noun}`}>{Icon.edit}</Link>
                            : <button type="button" className="ico-btn" disabled aria-label="Sửa (không khả dụng)" title={lockTip(r, "sửa")}>{Icon.edit}</button>}
                          <button type="button" className="ico-btn no" disabled={!canDel(r)} aria-label="Xoá" title={canDel(r) ? `Xoá ${noun}` : lockTip(r, "xoá")} onClick={() => setDelReq(r)}>{Icon.trash}</button>
                        </div>
                      </td>
                      {loa ? <>
                        <td data-label="Số LOA" className="num"><Link to={`/van-phong/${r.id}`} className="dt-link">{r.doc_no ?? "Bản nháp"}</Link></td>
                        <td data-label="Ngày" className="num">{ddmmyyyy(r.doc_date ?? vnDate(r.created_at))}</td>
                      </> : money ? <>
                        <td data-label="Số chứng từ" className="num"><Link to={`/van-phong/${r.id}`} className="dt-link">{r.doc_no ?? "—"}</Link></td>
                        <td data-label="Ngày" className="num">{ddmmyyyy(r.doc_date ?? r.created_at)}</td>
                      </> : trip ? <>
                        <td data-label="Số đăng ký" className="num"><Link to={`/van-phong/${r.id}`} className="dt-link">{r.doc_no ?? "—"}</Link></td>
                        <td data-label="Ngày gửi" className="num">{ddmmyyyy(vnDate(r.created_at))}</td>
                      </> : <td data-label="Ngày gửi" className="num">{ddmmyyyy(vnDate(r.created_at))}</td>}
                      <td data-label={loa ? "Người trình" : "Người đề nghị"}>{name(r.requester_id)}</td>
                      {loa ? <>
                        <td data-label="Tiêu đề"><div className="clip">{r.reason}</div></td>
                        <td data-label="Số tiền" className="r">{r.amount ? moneyCur(r.amount, r.currency) : "—"}</td>
                      </> : money ? <>
                        <td data-label="Nội dung"><div className="clip">{r.reason}</div></td>
                        <td data-label="Đơn vị nhận">{r.payee ?? "—"}</td>
                        <td data-label="Tiền đề nghị" className="r">{vnd(r.amount)}</td>
                      </> : trip ? <>
                        <td data-label="Người đi">{name(r.traveler_id ?? r.requester_id)}</td>
                        <td data-label="Nơi công tác">{r.location}</td>
                        <td data-label="Kế hoạch" className="num">{dateRange(r)}</td>
                        <td data-label="Nội dung"><div className="clip">{r.reason}</div></td>
                        <td data-label="Dự trù" className="r">{r.amount ? vnd(r.amount) : "—"}</td>
                        <td data-label="Thực tế" className="num">{r.actual_start ? `${ddmmyyyy(r.actual_start)}${r.actual_end && r.actual_end !== r.actual_start ? " – " + ddmmyyyy(r.actual_end) : ""}` : ""}</td>
                        <td data-label="Chi phí TT" className="r">{r.actual_cost != null ? vnd(r.actual_cost) : ""}</td>
                        <td data-label="Nhân sự XN">{r.hr_confirmed_at ? <span className="ok-text">{Icon.check} Đã XN</span> : r.status === "hoan_tat" ? <span className="t2">Chờ XN</span> : ""}</td>
                      </> : <>
                        <td data-label="Thời gian" className="num"><Link to={`/van-phong/${r.id}`} className="dt-link">{dateRange(r)}</Link></td>
                        <td data-label="Lý do"><div className="clip">{r.reason}</div></td>
                      </>}
                      <td data-label="Trạng thái">
                        <span className={`rq-pill ${r.status}`}>{statusLabel(r)}</span>
                        {(r.status === "tra_lai" || r.status === "tu_choi") && r.decision_note ? <div className="t2 clip">{r.decision_note}</div> : null}
                      </td>
                      <td data-label="Đang chờ" className="t2">{cs ? `${DUTY_LABEL[cs.duty]}${cs.approver_id ? " · " + name(cs.approver_id) : ""}` : ""}</td>
                    </tr>
                  );
                })}
              </tbody>
              {money ? <tfoot><tr><td colSpan={6} style={{ textAlign: "right" }}>Tổng cộng ({shown.length} phiếu)</td><td className="r num">{vnd(total)}</td><td colSpan={2} /></tr></tfoot> : null}
              {trip ? <tfoot><tr><td colSpan={8} style={{ textAlign: "right" }}>Tổng cộng ({shown.length} phiếu)</td><td className="r num">{vnd(total)}</td><td /><td className="r num">{vnd(shown.reduce((t, r) => t + Number(r.actual_cost ?? 0), 0))}</td><td colSpan={3} /></tr></tfoot> : null}
              {loa ? <tfoot><tr><td colSpan={5} style={{ textAlign: "right" }}>Tổng cộng VND ({shown.length} tờ trình)</td><td className="r num">{vnd(shown.reduce((t, r) => t + (r.currency === "VND" ? Number(r.amount ?? 0) : 0), 0))}</td><td colSpan={2} /></tr></tfoot> : null}
            </table>
          </div>
        )}
        {shown.length ? <Pager p={paging} /> : null}
      </section>

      {sel ? (
        <section className="pg-card" aria-label="Chi tiết dòng đang chọn">
          <div className="sub-tabs" role="tablist">
            {hasPanel ? <button role="tab" aria-selected={panel === "ct"} onClick={() => setPanel("ct")}>{loa ? "Dự toán ngân sách" : trip ? (tripData?.act ? "Lộ trình thực tế" : "Kế hoạch công tác") : "Chi tiết hoá đơn"}</button> : null}
            {trip ? <button role="tab" aria-selected={panel === "cp"} onClick={() => setPanel("cp")}>{tripData?.act ? "Bảng kê thanh toán" : "Thông tin chi phí"}</button> : null}
            <button role="tab" aria-selected={panel === "duyet" || (!hasPanel && panel !== "lk")} onClick={() => setPanel("duyet")}>Luồng duyệt</button>
            <button role="tab" aria-selected={panel === "lk"} onClick={() => setPanel("lk")}>Liên quan</button>
            <span className="grow" />
            <Link to={`/van-phong/${sel.id}`} className="dt-link" style={{ alignSelf: "center" }}>Mở {noun} →</Link>
          </div>
          {panel === "lk" ? <RelatedPanel key={sel.id} type="request" id={sel.id} title="Mục liên quan" bare />
            : trip && panel === "ct" ? (tripData ? <LegTable legs={tripData.legs} people={people} actual={tripData.act} /> : <div className="dt-empty">Đang tải…</div>)
            : trip && panel === "cp" ? (tripData ? <CostTable costs={tripData.costs} /> : <div className="dt-empty">Đang tải…</div>) : (
          <div className="dt-wrap">
            {loa && panel === "ct" ? (
              <table className="dt">
                <thead><tr><th>#</th><th>Nội dung</th><th>ĐVT</th><th className="r">SL</th><th className="r">Đơn giá</th><th className="r">Thành tiền</th><th>Ghi chú</th></tr></thead>
                <tbody>
                  {loaLines.length ? loaLines.map((l) => (
                    <tr key={l.id}>
                      <td className="num">{l.line_no}</td><td>{l.description}</td><td>{l.unit}</td>
                      <td className="r">{String(l.quantity).replace(".", ",")}</td><td className="r">{moneyCur(l.unit_price, sel.currency)}</td>
                      <td className="r">{moneyCur(l.amount, sel.currency)}</td><td>{l.note}</td>
                    </tr>
                  )) : <tr><td colSpan={7} className="dt-empty">Chưa có dòng dự toán.</td></tr>}
                </tbody>
              </table>
            ) : kind === "thanh_toan" && panel === "ct" ? (
              <table className="dt">
                <thead><tr><th>Số serial</th><th>Số hoá đơn</th><th>Ngày hoá đơn</th><th>Tên người bán</th><th>MST người bán</th><th>Nội dung</th><th className="r">Tiền trước VAT</th><th className="r">SL</th><th className="r">% VAT</th><th className="r">Tiền VAT</th><th className="r">Tổng</th><th>Cost center</th></tr></thead>
                <tbody>
                  {lines.length ? lines.map((l) => (
                    <tr key={l.id ?? l.line_no}>
                      <td>{l.invoice_serial}</td><td>{l.invoice_no}</td><td className="num">{l.invoice_date ? ddmmyyyy(l.invoice_date) : ""}</td>
                      <td>{l.seller_name}</td><td className="num">{l.seller_tax}</td><td>{l.description}</td>
                      <td className="r">{vnd(l.amount_pre_vat)}</td><td className="r">{l.quantity ?? ""}</td><td className="r">{l.vat_pct}%</td>
                      <td className="r">{vnd(l.vat_amount)}</td><td className="r">{vnd(l.total)}</td><td>{l.cost_center}</td>
                    </tr>
                  )) : <tr><td colSpan={12} className="dt-empty">Chưa có dòng hoá đơn.</td></tr>}
                </tbody>
              </table>
            ) : (
              <table className="dt">
                <thead><tr><th>Cấp duyệt</th><th>Người duyệt</th><th>Trạng thái</th><th>Thời gian</th><th>Ghi chú</th></tr></thead>
                <tbody>
                  {(steps[sel.id] ?? []).length ? (steps[sel.id] ?? []).map((s) => (
                    <tr key={s.id}>
                      <td>{DUTY_LABEL[s.duty]}</td>
                      <td>{name(s.decided_by ?? s.approver_id)}</td>
                      <td>{s.status === "cho" ? "Chờ duyệt" : s.status === "da_duyet" ? "Đã phê duyệt" : s.status === "tu_choi" ? "Từ chối" : s.status === "tra_lai" ? "Trả lại" : "Bỏ qua"}</td>
                      <td className="num">{s.decided_at ? new Date(s.decided_at).toLocaleString("vi-VN", { timeZone: "Asia/Ho_Chi_Minh", day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit" }) : ""}</td>
                      <td>{s.status === "bo_qua" ? s.skip_reason : s.note}</td>
                    </tr>
                  )) : <tr><td colSpan={5} className="dt-empty">Chưa có luồng duyệt.</td></tr>}
                </tbody>
              </table>
            )}
          </div>
          )}
        </section>
      ) : null}

      <DecideSheet req={decide ? sel : null} mode={decide} onClose={() => setDecide(null)} onDone={() => { setDecide(null); load(); refreshUnread(); }} />

      <Sheet open={!!delReq} onClose={() => setDelReq(null)} title={`Xoá ${noun}?`}>
        <p className="muted" style={{ marginTop: 0 }}>
          {delReq ? `${kindLabel(delReq)}${delReq.doc_no ? ` · ${delReq.doc_no}` : ""} · ${summary(delReq)}. ` : ""}Xoá hẳn {noun} cùng tệp đính kèm, không khôi phục được.
        </p>
        <div className="row">
          <button className="btn secondary" style={{ flex: 1 }} onClick={() => setDelReq(null)}>Giữ lại</button>
          <button className="btn danger" style={{ flex: 1 }} disabled={busy} onClick={doDelete}>{busy ? "Đang xoá…" : "Xoá"}</button>
        </div>
      </Sheet>

      <Sheet open={help} onClose={() => setHelp(false)} title={`Hướng dẫn · ${label}`}>
        <div className="stack">
          <p style={{ margin: 0 }}><b>Luồng duyệt:</b> {FLOW_TEXT[kind]}. Bước chưa có người giữ tự bỏ qua; một người đứng nhiều bước chỉ duyệt một lần.</p>
          <p style={{ margin: 0 }}><b>Cấp duyệt có 3 lựa chọn:</b> Duyệt (sang cấp tiếp theo), Từ chối (kết thúc, phải ghi lý do), Trả lại (về người lập sửa, phải ghi lý do; gửi lại thì duyệt lại từ cấp đầu).</p>
          <p style={{ margin: 0 }}><b>Sửa / Xoá:</b> chỉ dùng được khi đề nghị bị trả lại, bị từ chối hoặc đã rút. Đang chờ duyệt hoặc đã duyệt xong thì hai nút bị khoá. Còn chờ duyệt mà muốn sửa: mở đề nghị, bấm “Rút lại”, rồi sửa và gửi lại.</p>
          <p style={{ margin: 0 }}><b>Thêm nhanh:</b> bấm “+ Thêm” hoặc phím F2. Bấm vào một dòng để xem {loa ? "dự toán" : "chi tiết hoá đơn"} và luồng duyệt ngay bên dưới.</p>
          {loa ? <p style={{ margin: 0 }}><b>Bản nháp:</b> tờ trình lưu nháp nhiều lần được, chỉ người lập và người cùng soạn nhìn thấy. Bấm “Trình duyệt” thì hệ thống cấp số LOA và bắt đầu luồng duyệt. LOA đã duyệt xong thì khoá.</p> : null}
          {loa ? <p style={{ margin: 0 }}><b>Dùng LOA:</b> đề nghị tạm ứng và đề nghị thanh toán có thể chọn một LOA chi tiền đã duyệt để tham chiếu và theo dõi dự toán (không bắt buộc). Người lập, người cùng soạn, người và phòng ban được xem của LOA đó mới chọn được.</p> : null}
          {trip ? <p style={{ margin: 0 }}><b>Đi công tác:</b> lập phiếu với kế hoạch và chi phí dự trù, gửi duyệt. Duyệt xong thì in phiếu yêu cầu, kế hoạch, giấy đi đường; cần tiền trước thì lập đề nghị tạm ứng ngay trong phiếu. Về thì bấm “Nhập thực tế công tác”, nhập lộ trình và bảng kê chứng từ. Nhân sự xác nhận ngày đi, ngày về để tính công. Từ bảng kê bấm “Lập đề nghị thanh toán”.</p> : null}
          {money ? <p style={{ margin: 0 }}><b>Tờ trình (LOA):</b> không bắt buộc. Khoản chi thuộc một LOA đã duyệt thì chọn LOA đó để theo dõi dự toán.</p> : null}
        </div>
      </Sheet>
    </main>
  );
}
