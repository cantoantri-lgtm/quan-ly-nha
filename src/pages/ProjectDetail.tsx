import { useCallback, useEffect, useMemo, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { friendlyError, supabase } from "../lib/supabase";
import { useSession } from "../lib/session";
import { daysBetween, ddmmyyyy, todayVN } from "../lib/dates";
import { parseMoney, vnd } from "../lib/money";
import {
  ITEM_STATUS, PROJECT_STATUS, allNodes, buildTree, flatten, loadProject, projectProgress, setMembers,
  type BudgetRow, type Node, type PItem, type PLog, type PReq, type Project,
} from "../lib/project";
import { Avatar, Avatars, Bar, Gantt, ItemPane, ItemSheet, useIsWide, type ItemDraft, type Zoom } from "../components/ProjectUI";
import { DeadlineList, ExtendSheet } from "../components/Deadline";
import { loadDeadlines, type DlReq, type DlTarget } from "../lib/deadline";
import { ReassignSheet } from "../components/Reassign";
import { changeProjectPic } from "../lib/reassign";
import { Empty, Icon, Sheet, TopBar } from "../components/ui";
import "../projects.css";

type Tab = "gantt" | "ngan_sach" | "thanh_vien" | "de_nghi" | "nhat_ky";
type ItemMode = { kind: "new"; parent: Node | null } | { kind: "edit"; node: Node } | null;
const emptyDraft = (start: string, end: string): ItemDraft => ({ name: "", start, end, pic: "", members: [], budget: "", note: "" });
const csvCell = (v: string | number | null | undefined) => `"${String(v ?? "").replace(/"/g, '""')}"`;

export default function ProjectDetail() {
  const { id } = useParams();
  const nav = useNavigate();
  const { profile, people, isManager, toast } = useSession();
  const wide = useIsWide(1100);
  const [p, setP] = useState<Project | null>(null);
  const [missing, setMissing] = useState(false);
  const [items, setItems] = useState<PItem[]>([]);
  const [itemMembers, setItemMembers] = useState<{ item_id: string; user_id: string }[]>([]);
  const [supporters, setSupporters] = useState<string[]>([]);
  const [canEdit, setCanEdit] = useState(false);
  const [logs, setLogs] = useState<PLog[]>([]);
  const [budget, setBudget] = useState<BudgetRow[]>([]);
  const [reqs, setReqs] = useState<PReq[]>([]);
  const [loa, setLoa] = useState<{ id: string; doc_no: string | null; reason: string; amount: number; can_open: boolean } | null>(null);
  const [tab, setTab] = useState<Tab>("gantt");
  const [zoom, setZoom] = useState<Zoom>("tuan");
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const [selId, setSelId] = useState<string | null>(null);
  const [paneOpen, setPaneOpen] = useState(false);
  const [mineOnly, setMineOnly] = useState(false);
  const [mode, setMode] = useState<ItemMode>(null);
  const [draft, setDraft] = useState<ItemDraft>(emptyDraft(todayVN(), todayVN()));
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [delItem, setDelItem] = useState<Node | null>(null);
  const [delProject, setDelProject] = useState(false);
  const [scrollKey, setScrollKey] = useState(0);
  const [dls, setDls] = useState<DlReq[]>([]);
  const [ext, setExt] = useState<{ target: DlTarget; id: string; title: string; due: string } | null>(null);
  const [picSheet, setPicSheet] = useState(false);

  const load = useCallback(async () => {
    const d = await loadProject(id!);
    if (!d.project) { setMissing(true); return; }
    setP(d.project); setItems(d.items); setItemMembers(d.itemMembers); setSupporters(d.supporters);
    const [ce, lg, bd, rq, lo, dl] = await Promise.all([
      supabase.rpc("project_can_edit", { p_project: id! }),
      supabase.from("project_logs").select("*").eq("project_id", id!).order("at", { ascending: false }).limit(300),
      supabase.rpc("project_budget", { p_project: id! }),
      supabase.rpc("project_requests", { p_project: id! }),
      supabase.rpc("project_loa", { p_project: id! }),
      loadDeadlines({ project: id! }),
    ]);
    setDls(dl);
    setCanEdit(ce.data === true);
    setLogs((lg.data ?? []) as PLog[]);
    setBudget(((bd.data ?? []) as BudgetRow[]).map((r) => ({ ...r, budget: r.budget == null ? null : Number(r.budget), spent: Number(r.spent), pending: Number(r.pending) })));
    setReqs(((rq.data ?? []) as PReq[]).map((r) => ({ ...r, amount: Number(r.amount) })));
    const l = ((lo.data ?? []) as { id: string; doc_no: string | null; reason: string; amount: number; can_open: boolean }[])[0];
    setLoa(l ? { ...l, amount: Number(l.amount) } : null);
  }, [id]);
  useEffect(() => { load(); }, [load]);
  useEffect(() => {
    const h = () => load();
    window.addEventListener("neo:notification", h);
    return () => window.removeEventListener("neo:notification", h);
  }, [load]);

  const today = todayVN();
  const tree = useMemo(() => buildTree(items, itemMembers, today), [items, itemMembers, today]);
  const all = useMemo(() => allNodes(tree), [tree]);
  const byId = useMemo(() => new Map(all.map((n) => [n.id, n])), [all]);
  const me = profile?.id ?? "";
  /** PIC / người hỗ trợ của hạng mục hoặc hạng mục cha */
  const mineNode = useCallback((n: Node) => {
    for (let c: Node | undefined = n; c; c = c.parent_id ? byId.get(c.parent_id) : undefined) {
      if (c.pic_id === me || c.members.includes(me)) return true;
    }
    return false;
  }, [byId, me]);
  const myItems = all.filter((n) => !n.hasKids && n.calc < 100 && mineNode(n));
  const rows = useMemo(() => {
    const flat = flatten(tree, collapsed);
    if (!mineOnly) return flat;
    const keep = new Set<string>();
    all.filter((n) => mineNode(n) && (n.pic_id === me || n.members.includes(me))).forEach((n) => {
      for (let c: Node | undefined = n; c; c = c.parent_id ? byId.get(c.parent_id) : undefined) keep.add(c.id);
      allNodes(n.children).forEach((k) => keep.add(k.id));
    });
    return flat.filter((n) => keep.has(n.id));
  }, [tree, collapsed, mineOnly, all, mineNode, byId, me]);

  if (missing) return (<><TopBar title="Dự án" back="/du-an" /><main className="main"><Empty title="Không tìm thấy dự án">Có thể bạn không thuộc dự án này.</Empty></main></>);
  if (!p || !profile) return (<><TopBar title="Dự án" back="/du-an" /><div className="loading">Đang tải…</div></>);

  const name = (uid: string | null) => people.find((x) => x.id === uid)?.full_name ?? "—";
  const staff = people.filter((x) => x.is_active);
  const prog = projectProgress(tree, today);
  const behind = prog.plan - prog.act;
  const spent = budget.reduce((t, r) => t + r.spent, 0);
  const pending = budget.reduce((t, r) => t + r.pending, 0);
  const allocated = tree.reduce((t, n) => t + (n.budget ?? 0), 0);
  const leaves = all.filter((n) => !n.hasKids);
  const lateN = all.filter((n) => n.late).length;
  const doneN = leaves.filter((n) => n.calc >= 100).length;
  const runN = leaves.filter((n) => n.calc > 0 && n.calc < 100).length;
  const totalDays = daysBetween(p.start_date, p.end_date) + 1;
  const passed = Math.max(0, Math.min(totalDays, daysBetween(p.start_date, today) + 1));
  const left = Math.max(0, daysBetween(today, p.end_date));
  const sel = selId ? byId.get(selId) ?? null : null;
  const canProgress = (n: Node) => canEdit || mineNode(n);
  const minDate = all.reduce((m, n) => (n.start_date < m ? n.start_date : m), p.start_date);
  const maxDate = all.reduce((m, n) => (n.end_date > m ? n.end_date : m), p.end_date);
  const canDeleteProject = isManager || p.created_by === me;

  function select(nid: string) { setSelId(nid); if (!wide) setPaneOpen(true); }
  function openNew(parent: Node | null) {
    setErr(null);
    setDraft({ ...emptyDraft(parent?.start_date ?? p!.start_date, parent?.end_date ?? p!.end_date), pic: parent?.pic_id ?? "" });
    setMode({ kind: "new", parent });
  }
  function openEdit(n: Node) {
    setErr(null);
    setDraft({ name: n.name, start: n.start_date, end: n.end_date, pic: n.pic_id ?? "", members: n.members, budget: n.budget ? new Intl.NumberFormat("vi-VN").format(n.budget) : "", note: n.note ?? "" });
    setMode({ kind: "edit", node: n });
  }
  async function saveItem() {
    if (!mode) return;
    const level = mode.kind === "edit" ? mode.node.level : (mode.parent?.level ?? 0) + 1;
    if (!draft.name.trim()) { setErr("Nhập tên hạng mục."); return; }
    if (draft.end < draft.start) { setErr("Ngày kết thúc phải sau ngày bắt đầu."); return; }
    const b = level === 1 && draft.budget ? parseMoney(draft.budget) : null;
    if (level === 1 && draft.budget && b == null) { setErr("Ngân sách chưa đúng định dạng."); return; }
    setBusy(true); setErr(null);
    const row = { name: draft.name.trim(), start_date: draft.start, end_date: draft.end, pic_id: draft.pic || null, budget: level === 1 ? b : null, note: draft.note.trim() || null };
    let itemId: string;
    if (mode.kind === "edit") {
      const r = await supabase.from("project_items").update(row).eq("id", mode.node.id);
      if (r.error) { setBusy(false); setErr(friendlyError(r.error)); return; }
      itemId = mode.node.id;
    } else {
      const siblings = items.filter((x) => x.parent_id === (mode.parent?.id ?? null));
      const r = await supabase.from("project_items").insert({ ...row, project_id: p!.id, parent_id: mode.parent?.id ?? null, sort: siblings.reduce((m, x) => Math.max(m, x.sort), 0) + 1 }).select("id").single();
      if (r.error) { setBusy(false); setErr(friendlyError(r.error)); return; }
      itemId = r.data.id as string;
      if (mode.parent) setCollapsed((c) => { const s = new Set(c); s.delete(mode.parent!.id); return s; });
    }
    const me2 = await setMembers("project_item_members", "item_id", itemId, draft.members.filter((u) => u !== draft.pic));
    setBusy(false);
    if (me2) toast(`Đã lưu hạng mục, chưa lưu được người hỗ trợ: ${friendlyError({ message: me2 })}`);
    else toast(mode.kind === "edit" ? "Đã lưu hạng mục." : "Đã thêm hạng mục.");
    setMode(null); setSelId(itemId); await load();
  }
  async function saveProgress(n: Node, pct: number, note: string, done?: boolean) {
    setBusy(true);
    const r = await supabase.from("project_items").update({ progress: pct, note: note.trim() || null, ...(done ? { status: "hoan_thanh" } : pct < 100 && n.status === "hoan_thanh" ? { status: "dang_lam" } : {}) }).eq("id", n.id).select("id");
    setBusy(false);
    if (r.error) { toast(friendlyError(r.error)); return; }
    if (!r.data?.length) { toast("Bạn không có quyền cập nhật hạng mục này."); return; }
    toast(done || pct >= 100 ? "Đã đánh dấu hoàn thành." : `Đã cập nhật ${pct}%.`); load();
  }
  async function removeItem() {
    if (!delItem) return;
    setBusy(true);
    const r = await supabase.from("project_items").delete().eq("id", delItem.id);
    setBusy(false);
    if (r.error) { toast(friendlyError(r.error)); return; }
    toast("Đã xoá hạng mục."); setDelItem(null); setSelId(null); setPaneOpen(false); load();
  }
  async function removeProject() {
    setBusy(true);
    const r = await supabase.from("projects").delete().eq("id", p!.id);
    setBusy(false);
    if (r.error) { toast(friendlyError(r.error)); return; }
    toast("Đã xoá dự án."); nav("/du-an", { replace: true });
  }
  function exportCsv() {
    const head = ["STT", "Hạng mục", "Cấp", "PIC", "Hỗ trợ", "Bắt đầu", "Kết thúc", "Số ngày", "Tiến độ %", "Kế hoạch đến hôm nay %", "Trạng thái", "Ngân sách", "Ghi chú"];
    const lines = all.map((n) => [n.wbs, n.name, n.level, n.pic_id ? name(n.pic_id) : "", n.members.map(name).join(", "), ddmmyyyy(n.start_date), ddmmyyyy(n.end_date),
      daysBetween(n.start_date, n.end_date) + 1, n.calc, n.planPct, n.late ? "Chậm tiến độ" : ITEM_STATUS[n.status], n.budget ?? "", n.note ?? ""]);
    const csv = "﻿" + [head, ...lines].map((l) => l.map(csvCell).join(",")).join("\r\n");
    const a = document.createElement("a");
    a.href = URL.createObjectURL(new Blob([csv], { type: "text/csv;charset=utf-8" }));
    a.download = `${p!.code ?? "du-an"}_gantt.csv`; a.click(); URL.revokeObjectURL(a.href);
  }
  const toggle = (nid: string) => setCollapsed((c) => { const s = new Set(c); if (s.has(nid)) s.delete(nid); else s.add(nid); return s; });
  const allOpen = collapsed.size === 0;
  const parentOf = (n: Node | null) => (n?.parent_id ? byId.get(n.parent_id) ?? null : null);
  const open = p.status !== "hoan_thanh" && p.status !== "huy";
  // Xin gia hạn: PIC / hỗ trợ hạng mục (không quản lý dự án) xin cho hạng mục; PIC dự án xin cho cả dự án
  const pendingOf = (itemId: string | null) => dls.find((r) => r.status === "cho_duyet" && (itemId ? r.item_id === itemId : r.target === "project"));
  const canExtendProject = open && p.pic_id === me && p.created_by !== me && !isManager && !pendingOf(null);
  // Chỉ người giao dự án (hoặc Quản lý) đổi PIC: SQL 082 project_change_pic
  const canChangePic = open && (isManager || p.created_by === me);
  const itemExtra = (n: Node) => {
    const mine = dls.filter((r) => r.item_id === n.id);
    const can = open && !canEdit && canProgress(n) && !n.hasKids && n.calc < 100 && !pendingOf(n.id);
    if (!mine.length && !can) return null;
    return (
      <div className="stack" style={{ gap: 8 }}>
        <DeadlineList list={mine} onChanged={load} />
        {can ? <button type="button" className="btn secondary sm" style={{ justifySelf: "start" }}
          onClick={() => setExt({ target: "item", id: n.id, title: `Hạng mục ${n.wbs}. ${n.name}`, due: n.end_date })}>Báo cáo vướng mắc, xin gia hạn</button> : null}
      </div>
    );
  };
  const pane = (n: Node, close?: () => void) => (
    <ItemPane n={n} parent={parentOf(n)} people={people} canProgress={canProgress(n)} canEdit={canEdit} logs={logs} busy={busy} extra={itemExtra(n)}
      onSave={(pct, note, done) => saveProgress(n, pct, note, done)} onEdit={() => openEdit(n)} onAddChild={() => openNew(n)} onDelete={() => setDelItem(n)} onClose={close} />
  );
  const tabs: [Tab, string][] = [["gantt", "Tiến độ (Gantt)"], ["ngan_sach", "Ngân sách"], ["thanh_vien", "Thành viên"], ["de_nghi", `Đề nghị chi (${reqs.length})`], ["nhat_ky", "Nhật ký"]];
  const statusCls = p.status === "hoan_thanh" ? " done" : p.status === "huy" || p.status === "tam_dung" ? " stop" : " run";

  // Người tham gia: PIC dự án, hỗ trợ dự án, PIC và hỗ trợ hạng mục
  const people2 = new Map<string, { roles: Set<string>; items: number }>();
  const add = (u: string | null, role: string, item = false) => { if (!u) return; const x = people2.get(u) ?? { roles: new Set(), items: 0 }; x.roles.add(role); if (item) x.items++; people2.set(u, x); };
  add(p.pic_id, "PIC dự án"); supporters.forEach((u) => add(u, "Hỗ trợ dự án"));
  all.forEach((n) => { add(n.pic_id, n.level === 1 ? `PIC ${n.wbs}. ${n.name}` : "PIC hạng mục", true); n.members.forEach((u) => add(u, "Hỗ trợ hạng mục", true)); });

  return (
    <>
      <TopBar title={p.code ?? "Dự án"} back="/du-an" />
      <main className="main main-full stack" style={{ gap: 12 }}>
        <section className="card pj-head">
          <div className="pj-head-top">
            <div className="stack" style={{ gap: 6, flex: "1 1 420px", minWidth: 0 }}>
              <span className="pj-code"><b>{p.code}</b><span className={`pj-chip${statusCls}`}>{PROJECT_STATUS[p.status]}</span>
                {open && behind >= 5 ? <span className="pj-chip late">Chậm {behind}%</span> : null}</span>
              <h1>{p.name}</h1>
              <div className="pj-meta">
                <span><Avatar name={name(p.pic_id)} size={22} />PIC <b style={{ color: "var(--ink)" }}>{name(p.pic_id)}</b></span>
                {supporters.length ? <span>Hỗ trợ <Avatars names={supporters.map(name)} /></span> : null}
                <span className="num">{ddmmyyyy(p.start_date)} – {ddmmyyyy(p.end_date)}</span>
                {loa ? (loa.can_open
                  ? <Link to={`/van-phong/${loa.id}`}>{Icon.office}{loa.doc_no} · đã duyệt {vnd(loa.amount)}</Link>
                  : <span>{Icon.office}{loa.doc_no} · đã duyệt {vnd(loa.amount)}</span>) : null}
              </div>
            </div>
            <div className="row">
              {canEdit ? <Link className="btn secondary sm" to={`/du-an/${p.id}/sua`}>{Icon.edit}Sửa dự án</Link> : null}
              {canChangePic ? <button type="button" className="btn secondary sm" onClick={() => setPicSheet(true)}>Đổi PIC</button> : null}
              {canExtendProject ? <button type="button" className="btn secondary sm" onClick={() => setExt({ target: "project", id: p.id, title: `Dự án ${p.code} · ${p.name}`, due: p.end_date })}>Xin gia hạn dự án</button> : null}
              {open ? <Link className="btn sm" to={`/van-phong/moi/thanh_toan?project=${p.id}`}>{Icon.money}Lập đề nghị thanh toán</Link> : null}
            </div>
          </div>
          {p.description ? <p className="muted" style={{ margin: 0, whiteSpace: "pre-wrap" }}>{p.description}</p> : null}
          <div className="pj-tabs" role="tablist" aria-label="Nội dung dự án">
            {tabs.map(([k, l]) => <button key={k} role="tab" aria-selected={tab === k} onClick={() => setTab(k)}>{l}</button>)}
          </div>
        </section>

        <div className="pj-kpis">
          <section className="card pj-kpi"><span>Tiến độ thực tế</span><b>{prog.act}%</b><Bar pct={prog.act} plan={prog.plan} late={behind >= 5} h={8} />
            <span>Kế hoạch đến hôm nay {prog.plan}%{behind > 0 ? ` · chậm ${behind}%` : behind < 0 ? ` · nhanh ${-behind}%` : ""}</span></section>
          <section className="card pj-kpi"><span>Ngân sách đã dùng</span><b>{vnd(spent)}</b><Bar pct={p.budget ? Math.round(spent / p.budget * 100) : 0} plan={p.budget ? Math.min(100, Math.round((spent + pending) / p.budget * 100)) : undefined} h={8} />
            <span>/ {p.budget ? vnd(p.budget) : "chưa đặt ngân sách"}{pending ? ` · chờ duyệt ${vnd(pending)}` : ""}</span></section>
          <section className="card pj-kpi"><span>Thời gian</span><b>{today > p.end_date ? `Quá hạn ${daysBetween(p.end_date, today)} ngày` : `${left} ngày còn lại`}</b><Bar pct={Math.round(passed / totalDays * 100)} h={8} />
            <span>đã qua {passed}/{totalDays} ngày</span></section>
          <section className="card pj-kpi"><span>Hạng mục</span><b>{doneN} / {leaves.length} xong</b>
            <span className="row" style={{ gap: 6 }}>{lateN ? <span className="pj-chip late">{lateN} chậm</span> : null}{runN ? <span className="pj-chip run">{runN} đang làm</span> : null}</span>
            <span>{lateN ? `${lateN} hạng mục chậm tiến độ` : "Không có hạng mục chậm"}</span></section>
        </div>

        {dls.some((r) => r.status === "cho_duyet") || dls.some((r) => r.target === "project") ? (
          <DeadlineList list={dls.filter((r) => r.status === "cho_duyet" || r.target === "project")} onChanged={load} showItem />
        ) : null}

        {tab === "gantt" ? (
          <section className="card stack" style={{ padding: 14 }}>
            <div className="pj-tools" role="toolbar" aria-label="Thao tác Gantt">
              {canEdit ? <button type="button" className="btn sm" onClick={() => openNew(null)}>{Icon.plus}Hạng mục chính</button> : null}
              {canEdit ? <button type="button" className="btn ghost sm" disabled={!sel || sel.level >= 4} title={!sel ? "Chọn một hạng mục trước" : sel.level >= 4 ? "Đã đủ 3 cấp con" : `Thêm cấp con cho ${sel.wbs}`} onClick={() => sel && openNew(sel)}>{Icon.plus}Thêm cấp con</button> : null}
              {myItems.length ? <button type="button" className="btn ghost sm" aria-pressed={mineOnly} onClick={() => setMineOnly(!mineOnly)}>{Icon.check}{mineOnly ? "Xem tất cả" : `Việc của tôi (${myItems.length})`}</button> : null}
              <span className="sep" aria-hidden="true" />
              <span className="pj-seg" role="group" aria-label="Thang thời gian">
                {([["ngay", "Ngày"], ["tuan", "Tuần"], ["thang", "Tháng"]] as [Zoom, string][]).map(([k, l]) => <button key={k} type="button" aria-pressed={zoom === k} onClick={() => setZoom(k)}>{l}</button>)}
              </span>
              <button type="button" className="btn ghost sm" onClick={() => setCollapsed(allOpen ? new Set(all.filter((n) => n.hasKids).map((n) => n.id)) : new Set())}>{Icon.chev}{allOpen ? "Thu gọn" : "Mở hết"}</button>
              <button type="button" className="btn ghost sm" onClick={() => setScrollKey((k) => k + 1)}>Hôm nay</button>
              <span className="grow" />
              <button type="button" className="btn ghost sm" onClick={() => window.print()}>{Icon.print}In</button>
              <button type="button" className="btn ghost sm" onClick={exportCsv} disabled={!all.length}>{Icon.download}Xuất Excel</button>
            </div>
            <div className={`pj-work${wide && sel ? " with-pane" : ""}`}>
              <Gantt key={scrollKey} rows={rows} collapsed={collapsed} onToggle={toggle} selId={selId} onSelect={select} onOpen={(nid) => { const n = byId.get(nid); if (n && canEdit) openEdit(n); }}
                zoom={zoom} from={minDate} to={maxDate} people={people} compact={!wide} />
              {wide && sel ? pane(sel, () => setSelId(null)) : null}
            </div>
            <p className="pj-legend">Thanh xanh: phần đã làm. Thanh cam: chậm so với kế hoạch đến hôm nay (thiếu từ 15%). Thanh đậm có móc: hạng mục có cấp con, tiến độ tự tính theo số ngày. Vạch đỏ: hôm nay. Bấm một dòng để xem và cập nhật{canEdit ? ", bấm đúp để sửa" : ""}.</p>
          </section>
        ) : null}

        {tab === "ngan_sach" ? (
          <section className="card stack" style={{ padding: 16 }}>
            <div className="row" style={{ justifyContent: "space-between" }}>
              <h2 className="section-title" style={{ margin: 0 }}>Ngân sách theo hạng mục chính</h2>
              <span className="muted small">Xanh: đã duyệt chi (tạm ứng + thanh toán) · cam nhạt: đang chờ duyệt</span>
            </div>
            {allocated > p.budget && p.budget ? <div className="pj-warn">Tổng ngân sách các hạng mục chính {vnd(allocated)} vượt ngân sách dự án {vnd(p.budget)} là {vnd(allocated - p.budget)}.</div> : null}
            {loa && p.budget > loa.amount ? <div className="pj-warn">Ngân sách dự án vượt LOA {loa.doc_no} ({vnd(loa.amount)}).</div> : null}
            <div>
              {budget.length === 0 ? <p className="muted">Chưa có hạng mục chính.</p> : budget.map((r) => {
                const b = r.budget ?? 0;
                const sp = b ? Math.round(r.spent / b * 100) : r.spent ? 100 : 0;
                const pp = b ? Math.round((r.spent + r.pending) / b * 100) : 0;
                const it = r.item_id ? byId.get(r.item_id) : null;
                return (
                  <div key={r.item_id ?? "none"} className="pj-budget-row">
                    <span className="title">{it ? `${it.wbs}. ` : ""}{r.name}</span>
                    <span className={`pj-stack${b && r.spent > b ? " over" : ""}`} role="img" aria-label={`Đã chi ${sp}% ngân sách`}>
                      <span className="pend" style={{ width: `${Math.min(100, pp)}%` }} /><span className="spent" style={{ width: `${Math.min(100, sp)}%` }} />
                    </span>
                    <span className="amt"><b>{vnd(r.spent)}</b> / {r.budget != null ? vnd(r.budget) : "chưa đặt"}{r.pending ? ` · chờ ${vnd(r.pending)}` : ""}
                      {b ? <span className={r.spent + r.pending > b ? " err-text" : " muted"}> · còn {vnd(b - r.spent - r.pending)}</span> : null}
                      {open && r.item_id ? <> · <Link to={`/van-phong/moi/thanh_toan?project=${p.id}&item=${r.item_id}`}>Lập đề nghị</Link></> : null}</span>
                  </div>
                );
              })}
            </div>
            <div className="pj-total">
              <b>Tổng đã chi {vnd(spent)}{pending ? ` · chờ duyệt ${vnd(pending)}` : ""}</b>
              <b>{p.budget ? `Ngân sách ${vnd(p.budget)} · còn ${vnd(p.budget - spent - pending)}` : "Dự án chưa đặt ngân sách tổng"}</b>
            </div>
            <p className="muted small" style={{ margin: 0 }}>Chi phí thực tế lấy từ đề nghị tạm ứng và đề nghị thanh toán gắn dự án (đã duyệt hoặc đã chi). Đề nghị thanh toán đã trừ phần tạm ứng nên không bị cộng trùng.</p>
            {open ? (
              <div className="row">
                <Link className="btn secondary sm" to={`/van-phong/moi/tam_ung?project=${p.id}`}>{Icon.plus}Lập đề nghị tạm ứng</Link>
                <Link className="btn sm" to={`/van-phong/moi/thanh_toan?project=${p.id}`}>{Icon.plus}Lập đề nghị thanh toán</Link>
              </div>
            ) : null}
          </section>
        ) : null}

        {tab === "thanh_vien" ? (
          <section className="card stack" style={{ padding: 16 }}>
            <ul className="pj-members">
              {[...people2.entries()].map(([u, x]) => (
                <li key={u}><Avatar name={name(u)} size={32} /><span><b>{name(u)}</b><br /><span className="muted small">{[...x.roles].slice(0, 2).join(" · ")}</span></span>
                  {x.items ? <span className="muted small">{x.items} hạng mục</span> : null}</li>
              ))}
            </ul>
          </section>
        ) : null}

        {tab === "de_nghi" ? (
          <section className="card" style={{ padding: 0 }}>
            {reqs.length === 0 ? <div className="dt-empty">Chưa có đề nghị tạm ứng / thanh toán gắn dự án này.</div> : (
              <div className="dt-wrap">
                <table className="dt">
                  <thead><tr><th>Số</th><th>Loại</th><th>Hạng mục</th><th>Nội dung</th><th>Người lập</th><th className="r">Số tiền</th><th>Trạng thái</th></tr></thead>
                  <tbody>
                    {reqs.map((r) => {
                      const it = r.item_id ? byId.get(r.item_id) : null;
                      const st = r.status === "hoan_tat" ? ["done", "Đã chi"] : r.status === "da_duyet" ? ["run", "Đã duyệt"] : r.status === "cho_duyet" ? ["late", "Chờ duyệt"] : ["stop", { tu_choi: "Từ chối", tra_lai: "Trả lại", da_huy: "Đã rút" }[r.status] ?? r.status];
                      return (
                        <tr key={r.id}>
                          <td className="num">{r.can_open ? <Link className="dt-link" to={`/van-phong/${r.id}`}>{r.doc_no ?? "—"}</Link> : r.doc_no}</td>
                          <td>{r.kind === "tam_ung" ? "Tạm ứng" : "Thanh toán"}</td>
                          <td>{it ? `${it.wbs}. ${it.name}` : "—"}</td>
                          <td><div className="clip">{r.reason ?? "—"}</div></td>
                          <td>{r.requester_name}</td>
                          <td className="r">{vnd(r.amount)}</td>
                          <td><span className={`pj-chip ${st[0]}`}>{st[1]}</span></td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </section>
        ) : null}

        {tab === "nhat_ky" ? (
          <section className="card" style={{ padding: 16 }}>
            {logs.length === 0 ? <p className="muted">Chưa có cập nhật.</p> : (
              <ul className="pj-log">
                {logs.map((l) => {
                  const it = l.item_id ? byId.get(l.item_id) : null;
                  return (
                    <li key={l.id}><Avatar name={name(l.by_id)} size={24} />
                      <span><b>{name(l.by_id)}</b> <span className="muted">{new Date(l.at).toLocaleString("vi-VN", { timeZone: "Asia/Ho_Chi_Minh", day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit" })}</span><br />
                        {it ? <b>{it.wbs}. {it.name}</b> : null}{l.progress != null ? ` · ${l.progress}%` : ""}{l.status ? ` · ${ITEM_STATUS[l.status] ?? l.status}` : ""}{l.note ? ` · ${l.note}` : ""}</span></li>
                  );
                })}
              </ul>
            )}
          </section>
        ) : null}

        {canDeleteProject ? <button type="button" className="btn ghost" style={{ color: "var(--danger)", alignSelf: "flex-start" }} onClick={() => setDelProject(true)}>{Icon.trash}Xoá dự án</button> : null}
        {!wide && tab === "gantt" && myItems.length && !mineOnly ? (
          <div className="pj-mobile-bar"><button type="button" className="btn block" onClick={() => setMineOnly(true)}>{Icon.check}Cập nhật tiến độ việc của tôi ({myItems.length})</button></div>
        ) : null}
      </main>

      {!wide && sel ? (
        <Sheet open={paneOpen} onClose={() => setPaneOpen(false)} title={`${sel.wbs}. ${sel.name}`}>{pane(sel)}</Sheet>
      ) : null}

      {ext ? <ExtendSheet open onClose={() => setExt(null)} target={ext.target} id={ext.id} title={ext.title} due={ext.due} onDone={load} /> : null}
      {canChangePic ? (
        <ReassignSheet open={picSheet} onClose={() => setPicSheet(false)} title="Đổi người phụ trách (PIC) dự án" what={`${p.code} · ${p.name}`}
          current={p.pic_id} currentName={name(p.pic_id)}
          candidates={staff.filter((u) => u.role === "quan_ly" || u.role === "giam_sat" || u.role === "nhan_vien")}
          keepLabel={`Giữ ${name(p.pic_id)} lại làm người hỗ trợ`}
          onSave={(u, keep, n) => changeProjectPic(p.id, u, keep, n)} onDone={load} />
      ) : null}
      <ItemSheet open={!!mode} onClose={() => setMode(null)} busy={busy} err={err} people={staff} draft={draft} setDraft={setDraft} onSubmit={saveItem}
        title={mode?.kind === "edit" ? `Sửa hạng mục ${mode.node.wbs}` : mode?.parent ? `Thêm cấp con của ${mode.parent.wbs}. ${mode.parent.name}` : "Thêm hạng mục chính"}
        level={mode?.kind === "edit" ? mode.node.level : (mode?.kind === "new" ? (mode.parent?.level ?? 0) + 1 : 1)}
        parentRange={mode?.kind === "new" && mode.parent ? { start: mode.parent.start_date, end: mode.parent.end_date, name: mode.parent.name }
          : mode?.kind === "edit" && parentOf(mode.node) ? { start: parentOf(mode.node)!.start_date, end: parentOf(mode.node)!.end_date, name: parentOf(mode.node)!.name } : null} />

      <Sheet open={!!delItem} onClose={() => setDelItem(null)} title="Xoá hạng mục?">
        <p className="muted" style={{ marginTop: 0 }}>{delItem ? `${delItem.wbs}. ${delItem.name}` : ""}{delItem?.hasKids ? ` cùng ${allNodes(delItem.children).length} hạng mục con` : ""} và nhật ký sẽ bị xoá, không khôi phục được. Đề nghị chi đã gắn hạng mục này chuyển sang “chưa gắn hạng mục”.</p>
        <div className="row"><button className="btn secondary" style={{ flex: 1 }} onClick={() => setDelItem(null)}>Giữ lại</button>
          <button className="btn danger" style={{ flex: 1 }} disabled={busy} onClick={removeItem}>{busy ? "Đang xoá…" : "Xoá"}</button></div>
      </Sheet>
      <Sheet open={delProject} onClose={() => setDelProject(false)} title="Xoá dự án?">
        <p className="muted" style={{ marginTop: 0 }}>{p.code} · {p.name}: toàn bộ hạng mục, thành viên và nhật ký sẽ bị xoá, không khôi phục được. Đề nghị chi đã gắn dự án vẫn giữ nhưng bỏ liên kết. Muốn giữ lịch sử thì sửa trạng thái thành “Đã huỷ”.</p>
        <div className="row"><button className="btn secondary" style={{ flex: 1 }} onClick={() => setDelProject(false)}>Giữ lại</button>
          <button className="btn danger" style={{ flex: 1 }} disabled={busy} onClick={removeProject}>{busy ? "Đang xoá…" : "Xoá dự án"}</button></div>
      </Sheet>
    </>
  );
}
