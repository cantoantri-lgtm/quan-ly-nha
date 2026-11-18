import { useCallback, useEffect, useMemo, useState } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { friendlyError, supabase } from "../lib/supabase";
import { useSession } from "../lib/session";
import { ddmmyyyy, todayVN } from "../lib/dates";
import { vnd } from "../lib/money";
import { PROJECT_STATUS, buildTree, projectProgress, type PItem, type Project } from "../lib/project";
import { Avatar, Bar } from "../components/ProjectUI";
import { Empty, Icon, TopBar } from "../components/ui";
import "../projects.css";

type Tab = "tat_ca" | "dang_chay" | "cua_toi" | "cham" | "xong";
type Sum = { project_id: string; spent: number; pending: number; items: number; done_items: number };

/** Danh sách dự án. Chuyển qua lại với Công việc. */
export default function Projects() {
  const { profile, people, isManager, isSupervisor } = useSession();
  const canCreate = isManager || isSupervisor;
  const nav = useNavigate();
  const [params, setParams] = useSearchParams();
  const tab = (params.get("loc") as Tab) || "dang_chay";
  const [rows, setRows] = useState<Project[] | null>(null);
  const [items, setItems] = useState<PItem[]>([]);
  const [sums, setSums] = useState<Record<string, Sum>>({});
  const [mine, setMine] = useState<Set<string>>(new Set());
  const [err, setErr] = useState<string | null>(null);
  const [q, setQ] = useState("");

  const load = useCallback(async () => {
    if (!profile) return;
    const [p, it, s, m, im] = await Promise.all([
      supabase.from("projects").select("*").order("start_date", { ascending: false }),
      supabase.from("project_items").select("id,project_id,parent_id,level,sort,name,start_date,end_date,progress,status,pic_id,budget,note,updated_at,updated_by"),
      supabase.rpc("project_summary"),
      supabase.from("project_members").select("project_id").eq("user_id", profile.id),
      supabase.from("project_item_members").select("item_id").eq("user_id", profile.id),
    ]);
    if (p.error) { setErr(friendlyError(p.error)); setRows([]); return; }
    const list = (p.data ?? []).map((x) => ({ ...x, budget: Number(x.budget) })) as Project[];
    const its = (it.data ?? []) as PItem[];
    const mineSet = new Set<string>(((m.data ?? []) as { project_id: string }[]).map((x) => x.project_id));
    const imSet = new Set(((im.data ?? []) as { item_id: string }[]).map((x) => x.item_id));
    its.forEach((x) => { if (x.pic_id === profile.id || imSet.has(x.id)) mineSet.add(x.project_id); });
    list.forEach((x) => { if (x.pic_id === profile.id || x.created_by === profile.id) mineSet.add(x.id); });
    setRows(list); setItems(its); setMine(mineSet);
    setSums(Object.fromEntries(((s.data ?? []) as Sum[]).map((x) => [x.project_id, { ...x, spent: Number(x.spent), pending: Number(x.pending) }])));
  }, [profile]);
  useEffect(() => { load(); }, [load]);
  useEffect(() => {
    const h = () => load();
    window.addEventListener("neo:notification", h);
    return () => window.removeEventListener("neo:notification", h);
  }, [load]);

  const today = todayVN();
  const prog = useMemo(() => {
    const out: Record<string, { act: number; plan: number }> = {};
    (rows ?? []).forEach((p) => { out[p.id] = projectProgress(buildTree(items.filter((i) => i.project_id === p.id), [], today), today); });
    return out;
  }, [rows, items, today]);
  const running = (p: Project) => p.status === "ke_hoach" || p.status === "dang_thuc_hien" || p.status === "tam_dung";
  const isLate = (p: Project) => running(p) && (prog[p.id]?.plan ?? 0) - (prog[p.id]?.act ?? 0) >= 5;
  const inTab = (p: Project, t: Tab) => t === "tat_ca" ? true : t === "dang_chay" ? running(p) : t === "cua_toi" ? mine.has(p.id) : t === "cham" ? isLate(p) : p.status === "hoan_thanh";
  const kw = q.trim().toLowerCase();
  const base = (rows ?? []).filter((p) => !kw || `${p.code} ${p.name}`.toLowerCase().includes(kw));
  const shown = base.filter((p) => inTab(p, tab));
  const name = (id: string) => people.find((p) => p.id === id)?.full_name ?? "—";
  const tiles: [Tab, string][] = [["dang_chay", "Đang chạy"], ["cua_toi", "Tôi tham gia"], ["cham", "Chậm tiến độ"], ["xong", "Đã xong"], ["tat_ca", "Tất cả"]];

  return (
    <>
      <TopBar title="Dự án" />
      <main className="main main-wide stack">
        <div className="row" style={{ justifyContent: "space-between", flexWrap: "wrap" }}>
          <nav className="pj-switch" aria-label="Giao việc">
            <Link to="/viec">Công việc</Link>
            <Link to="/du-an" aria-current="page">Dự án</Link>
          </nav>
          <input className="input" style={{ flex: "1 1 220px", maxWidth: 360 }} placeholder="Tìm mã, tên dự án…" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Tìm dự án" />
        </div>
        <div className="chips" role="group" aria-label="Lọc dự án">
          {tiles.map(([k, l]) => (
            <button key={k} className="chip" aria-pressed={tab === k} onClick={() => { const p = new URLSearchParams(params); if (k === "dang_chay") p.delete("loc"); else p.set("loc", k); setParams(p, { replace: true }); }}>
              {l}<span className="n">{base.filter((p) => inTab(p, k)).length}</span>
            </button>
          ))}
        </div>
        {err ? <div className="error-box">{err}</div> : null}
        {rows == null ? <div className="loading">Đang tải…</div> : shown.length === 0 ? (
          <Empty title="Không có dự án nào">{canCreate ? "Bấm “Dự án mới” để lập dự án đầu tiên." : "Dự án bạn phụ trách hoặc hỗ trợ sẽ hiện ở đây kèm thông báo."}</Empty>
        ) : (
          <div className="pj-list">
            {shown.map((p) => {
              const pr = prog[p.id] ?? { act: 0, plan: 0 };
              const s = sums[p.id];
              const used = p.budget ? Math.round(((s?.spent ?? 0) / p.budget) * 100) : 0;
              const late = isLate(p);
              return (
                <Link key={p.id} to={`/du-an/${p.id}`} className="card pj-card">
                  <div className="stack" style={{ gap: 4, minWidth: 0 }}>
                    <span className="pj-code"><b>{p.code}</b>
                      <span className={`pj-chip${p.status === "hoan_thanh" ? " done" : p.status === "huy" || p.status === "tam_dung" ? " stop" : " run"}`}>{PROJECT_STATUS[p.status]}</span>
                      {late ? <span className="pj-chip late">Chậm {pr.plan - pr.act}%</span> : null}
                    </span>
                    <h3>{p.name}</h3>
                    <span className="pj-meta"><span><Avatar name={name(p.pic_id)} size={20} />PIC {name(p.pic_id)}</span><span className="num">{ddmmyyyy(p.start_date)} – {ddmmyyyy(p.end_date)}</span></span>
                  </div>
                  <div className="pj-card-row">
                    <span>Tiến độ <b style={{ color: late ? "var(--today)" : "var(--ink)" }}>{pr.act}%</b> / KH {pr.plan}%<Bar pct={pr.act} plan={pr.plan} late={late} h={6} /></span>
                    <span>Ngân sách <b style={{ color: "var(--ink)" }}>{vnd(s?.spent ?? 0)}</b> / {p.budget ? vnd(p.budget) : "chưa đặt"}<Bar pct={used} h={6} /></span>
                  </div>
                </Link>
              );
            })}
          </div>
        )}
      </main>
      {canCreate ? <div className="fab-group"><button className="fab" onClick={() => nav("/du-an/moi")}>{Icon.plus}Dự án mới</button></div> : null}
    </>
  );
}
