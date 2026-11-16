import { useCallback, useEffect, useMemo, useState } from "react";
import { Link, Navigate, useNavigate, useParams, useSearchParams } from "react-router-dom";
import { friendlyError, supabase } from "../lib/supabase";
import { useSession } from "../lib/session";
import { ddmmyyyy, todayVN } from "../lib/dates";
import { vnd } from "../lib/money";
import { DUTY_LABEL, EDIT_LOCK_TIP, FLOW_TEXT, KINDS, deleteRequest, isEditableStatus, isFinished, kindLabel, moneyCur, statusLabel, summary, vnDate,
  type LoaLine, type Req, type ReqKind, type ReqLine, type ReqStep } from "../lib/office";
import { Icon, Sheet } from "../components/ui";
import { Pager, usePaging } from "../components/Pager";
import "../office.css";
import "../table.css";

type Tab = "tat_ca" | "duyet" | "xu_ly" | "can_sua" | "hoan_tat";

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
  const noun = loa ? "tờ trình" : "đề nghị";
  const newUrl = loa ? "/van-phong/loa/moi" : `/van-phong/moi/${kind}`;
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
  const hasPanel = kind === "thanh_toan" || loa;
  const [panel, setPanel] = useState<"ct" | "duyet">(hasPanel ? "ct" : "duyet");
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
    const onKey = (e: KeyboardEvent) => { if (e.key === "F2") { e.preventDefault(); nav(newUrl); } };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [nav, newUrl]);

  const name = (id: string | null) => people.find((p) => p.id === id)?.full_name ?? "—";

  // Lọc theo tháng + từ khoá (các thẻ đếm tính trên kết quả này)
  const base = useMemo(() => {
    const kw = applied.trim().toLowerCase();
    return rows.filter((r) => {
      const m = (r.doc_date ?? vnDate(r.created_at)).slice(0, 7);
      if (from && m < from) return false;
      if (to && m > to) return false;
      if (!kw) return true;
      return [r.doc_no, r.reason, r.payee, r.location, name(r.requester_id)].some((v) => (v ?? "").toLowerCase().includes(kw));
    });
  }, [rows, from, to, applied, people]); // eslint-disable-line react-hooks/exhaustive-deps

  const inTab = useCallback((r: Req, t: Tab) =>
    t === "tat_ca" ? true
    : t === "duyet" ? queue.has(r.id)
    : t === "xu_ly" ? (r.status === "cho_duyet" || (r.status === "da_duyet" && !isFinished(r))) || r.status === "tra_lai"
    : t === "can_sua" ? isEditableStatus(r.status) && r.status !== "da_huy"
    : isFinished(r), [queue]);
  const shown = useMemo(() => base.filter((r) => inTab(r, tab)), [base, tab, inTab]);
  const n = (t: Tab) => base.filter((r) => inTab(r, t)).length;
  const paging = usePaging(shown);
  useEffect(() => { paging.setPage(1); }, [tab, from, to, applied]); // eslint-disable-line react-hooks/exhaustive-deps

  const setTab = (t: Tab) => { const p = new URLSearchParams(params); if (t === "tat_ca") p.delete("tab"); else p.set("tab", t); setParams(p, { replace: true }); };
  const total = shown.reduce((s, r) => s + Number(r.amount ?? 0), 0);

  // Chi tiết dòng đang chọn
  const sel = rows.find((r) => r.id === selId) ?? null;
  useEffect(() => {
    setLines([]); setLoaLines([]);
    if (!sel) return;
    if (kind === "thanh_toan") supabase.from("request_lines").select("*").eq("request_id", sel.id).order("line_no").then(({ data }) => setLines((data ?? []) as ReqLine[]));
    if (kind === "loa") supabase.from("loa_lines").select("*").eq("request_id", sel.id).order("line_no").then(({ data }) => setLoaLines((data ?? []) as LoaLine[]));
  }, [sel?.id, kind]); // eslint-disable-line react-hooks/exhaustive-deps

  const curStep = (r: Req) => (r.status === "cho_duyet" ? (steps[r.id] ?? []).find((s) => s.status === "cho") : undefined);

  function exportCsv() {
    const head = loa ? ["Số LOA", "Ngày", "Người trình", "Tiêu đề", "Số tiền", "Loại tiền", "Trạng thái"]
      : money
      ? ["Số chứng từ", "Ngày", "Người đề nghị", "Nội dung", "Đơn vị nhận", "Số tiền", "Trạng thái"]
      : ["Ngày gửi", "Người đề nghị", "Thời gian", "Lý do", "Trạng thái"];
    const lines = shown.map((r) => loa
      ? [r.doc_no, ddmmyyyy(r.doc_date ?? vnDate(r.created_at)), name(r.requester_id), r.reason, r.amount, r.currency, statusLabel(r)]
      : money
      ? [r.doc_no, ddmmyyyy(r.doc_date ?? r.created_at), name(r.requester_id), r.reason, r.payee, r.amount, statusLabel(r)]
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

  const tiles: [Tab, string][] = [["tat_ca", "Tất cả"], ["duyet", "Chờ bạn duyệt"], ["xu_ly", "Đang xử lý"], ["can_sua", loa ? "Nháp / cần sửa" : "Cần sửa"], ["hoan_tat", "Đã hoàn tất"]];
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
        <div className="toolbar">
          <Link to={newUrl} className="btn sm" title={`Thêm ${noun} mới (F2)`}>+ Thêm (F2)</Link>
          <button type="button" className="ico-btn" title="In danh sách" aria-label="In danh sách" onClick={() => window.print()}>{Icon.print}</button>
          <button type="button" className="ico-btn" title="Xuất CSV" aria-label="Xuất CSV" disabled={!shown.length} onClick={exportCsv}>{Icon.download}</button>
          <span className="tl-title">{label}</span>
        </div>

        {err ? <div className="error-box" style={{ margin: 12 }}>{err}</div> : null}
        {loading ? <div className="dt-empty">Đang tải…</div> : shown.length === 0 ? (
          <div className="dt-empty"><b>Không có {noun} nào</b><br />Đổi tháng / bộ lọc hoặc bấm “+ Thêm” để lập {noun} mới.</div>
        ) : (
          <div className="dt-wrap">
            <table className="dt cards">
              <thead>
                <tr>
                  <th>Thao tác</th>
                  {loa ? <><th>Số LOA</th><th>Ngày</th></> : money ? <><th>Số chứng từ</th><th>Ngày</th></> : <th>Ngày gửi</th>}
                  <th>{loa ? "Người trình" : "Người đề nghị"}</th>
                  {loa ? <><th>Tiêu đề</th><th className="r">Số tiền</th></>
                    : money ? <><th>Nội dung</th><th>Đơn vị nhận</th><th className="r">Tiền đề nghị</th></> : <><th>Thời gian</th><th>Lý do</th></>}
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
                      </> : <td data-label="Ngày gửi" className="num">{ddmmyyyy(vnDate(r.created_at))}</td>}
                      <td data-label={loa ? "Người trình" : "Người đề nghị"}>{name(r.requester_id)}</td>
                      {loa ? <>
                        <td data-label="Tiêu đề"><div className="clip">{r.reason}</div></td>
                        <td data-label="Số tiền" className="r">{r.amount ? moneyCur(r.amount, r.currency) : "—"}</td>
                      </> : money ? <>
                        <td data-label="Nội dung"><div className="clip">{r.reason}</div></td>
                        <td data-label="Đơn vị nhận">{r.payee ?? "—"}</td>
                        <td data-label="Tiền đề nghị" className="r">{vnd(r.amount)}</td>
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
              {loa ? <tfoot><tr><td colSpan={5} style={{ textAlign: "right" }}>Tổng cộng VND ({shown.length} tờ trình)</td><td className="r num">{vnd(shown.reduce((t, r) => t + (r.currency === "VND" ? Number(r.amount ?? 0) : 0), 0))}</td><td colSpan={2} /></tr></tfoot> : null}
            </table>
          </div>
        )}
        {shown.length ? <Pager p={paging} /> : null}
      </section>

      {sel ? (
        <section className="pg-card" aria-label="Chi tiết dòng đang chọn">
          <div className="sub-tabs" role="tablist">
            {hasPanel ? <button role="tab" aria-selected={panel === "ct"} onClick={() => setPanel("ct")}>{loa ? "Dự toán ngân sách" : "Chi tiết hoá đơn"}</button> : null}
            <button role="tab" aria-selected={panel === "duyet" || !hasPanel} onClick={() => setPanel("duyet")}>Luồng duyệt</button>
            <span className="grow" />
            <Link to={`/van-phong/${sel.id}`} className="dt-link" style={{ alignSelf: "center" }}>Mở {noun} →</Link>
          </div>
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
        </section>
      ) : null}

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
          {loa ? <p style={{ margin: 0 }}><b>Dùng LOA:</b> đề nghị tạm ứng và đề nghị thanh toán phải chọn một LOA chi tiền đã duyệt. Người lập, người cùng soạn, người và phòng ban được xem của LOA đó mới chọn được.</p> : null}
          {money ? <p style={{ margin: 0 }}><b>Tờ trình (LOA):</b> mỗi đề nghị phải gắn một LOA chi tiền đã duyệt. Chưa có thì lập ở Văn phòng số → Tờ trình (LOA) và chờ duyệt xong.</p> : null}
        </div>
      </Sheet>
    </main>
  );
}
