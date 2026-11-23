import { useCallback, useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { friendlyError, supabase } from "../lib/supabase";
import { useSession } from "../lib/session";
import { addDaysISO, ddmmyyyy, dueInfo, dueLevel, SOON_DAYS, todayVN } from "../lib/dates";
import { PRIORITY_LABEL, STATUS_LABEL, type Priority, type TaskStatus } from "../lib/labels";
import { KINDS, kindLabel, summary, type Req, type ReqKind } from "../lib/office";
import { Icon } from "../components/ui";
import DecideSheet, { type DecideMode } from "../components/DecideSheet";
import { Pager, usePaging } from "../components/Pager";
import { KIND_ICON } from "./Office";
import MonthCloseCard from "../components/MonthCloseCard";
import "../office.css";
import "../table.css";

type TaskLite = { id: string; title: string; due_date: string | null; assignee_id: string | null; created_by: string | null;
  status: TaskStatus; priority: Priority; building_id: string | null };

/** Trang chủ: danh sách phiếu chờ tôi duyệt (bảng) + Bàn làm việc + lịch */
export default function Home() {
  const { profile, people, unread, isManager } = useSession();
  const [rows, setRows] = useState<Req[]>([]);
  const [phases, setPhases] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);
  const [kind, setKind] = useState<ReqKind | "">("");
  const [phase, setPhase] = useState<"" | "duyet" | "chi">("");
  const [pos, setPos] = useState<Record<string, string>>({});
  const [decide, setDecide] = useState<{ req: Req; mode: DecideMode } | null>(null);
  const [fixN, setFixN] = useState(0);
  const [tasks, setTasks] = useState<TaskLite[]>([]);        // việc được giao cho tôi (phụ trách chính hoặc cùng làm)
  const [given, setGiven] = useState<TaskLite[]>([]);        // việc tôi giao cho người khác, chưa xong

  const load = useCallback(async () => {
    if (!profile) return;
    setErr(null);
    const { data: queue, error: qe } = await supabase.rpc("my_approval_queue");
    if (qe) setErr(friendlyError(qe));
    const items = (queue ?? []) as { request_id: string; phase: string }[];
    setPhases(Object.fromEntries(items.map((i) => [i.request_id, i.phase])));
    if (items.length) {
      const { data } = await supabase.from("requests").select("*").in("id", items.map((i) => i.request_id)).order("created_at");
      setRows((data as Req[]) ?? []);
    } else setRows([]);
    setLoading(false);
    // Việc của tôi: đề nghị bị trả lại / từ chối cần sửa, và công việc đang làm
    const [fx, tk, gv] = await Promise.all([
      supabase.from("requests").select("id", { count: "exact", head: true }).eq("requester_id", profile.id).in("status", ["tra_lai", "tu_choi"]),
      (async () => {
        const mine = (((await supabase.from("task_assignees").select("task_id").eq("user_id", profile.id)).data ?? []) as { task_id: string }[]).map((x) => x.task_id);
        const q = supabase.from("tasks").select("id,title,due_date,assignee_id,created_by,status,priority,building_id").is("parent_id", null).neq("status", "xong").limit(300);
        return mine.length ? q.or(`assignee_id.eq.${profile.id},id.in.(${mine.join(",")})`) : q.eq("assignee_id", profile.id);
      })(),
      supabase.from("tasks").select("id,title,due_date,assignee_id,created_by,status,priority,building_id").is("parent_id", null).neq("status", "xong")
        .eq("created_by", profile.id).or(`assignee_id.is.null,assignee_id.neq.${profile.id}`).limit(300),
    ]);
    setFixN(fx.count ?? 0);
    const mineList = (tk.data as TaskLite[]) ?? [];
    setTasks(mineList);
    const mineIds = new Set(mineList.map((t) => t.id));
    setGiven(((gv.data as TaskLite[]) ?? []).filter((t) => !mineIds.has(t.id)));
  }, [profile]);

  useEffect(() => { load(); }, [load]);
  useEffect(() => {
    const h = () => load();
    window.addEventListener("neo:notification", h);
    window.addEventListener("focus", h);
    return () => { window.removeEventListener("neo:notification", h); window.removeEventListener("focus", h); };
  }, [load]);
  // Chức danh người đề nghị (nếu được phép xem cơ cấu tổ chức)
  useEffect(() => {
    supabase.from("org_staff").select("profile_id,position").not("profile_id", "is", null).then(({ data }) => {
      setPos(Object.fromEntries(((data ?? []) as { profile_id: string; position: string }[]).map((s) => [s.profile_id, s.position])));
    });
  }, []);

  const counts = useMemo(() => {
    const m: Partial<Record<ReqKind, number>> = {};
    rows.forEach((r) => { m[r.kind] = (m[r.kind] ?? 0) + 1; });
    return m;
  }, [rows]);
  const shown = useMemo(() => rows.filter((r) => (!kind || r.kind === kind) && (!phase || phases[r.id] === phase)), [rows, kind, phase, phases]);
  const paging = usePaging(shown);
  useEffect(() => { paging.setPage(1); }, [kind, phase]); // eslint-disable-line react-hooks/exhaustive-deps

  const name = (id: string) => people.find((p) => p.id === id)?.full_name ?? "—";
  const overdue = tasks.filter((t) => t.due_date && t.due_date < todayVN()).length;
  const nearDue = tasks.filter((t) => { const l = dueLevel(t.due_date, false); return l === "today" || l === "soon"; }).length;

  return (
    <>
      <main className="main main-full">
        <div className="home-grid">
          <div className="stack home-main">
          {!isManager ? <MonthCloseCard /> : null}
          <section className="pg-card" aria-label="Chờ bạn duyệt">
            <div className="pg-head">
              <span className="pg-ico">{Icon.bell}</span>
              <div className="grow"><h2>Chờ bạn duyệt</h2><p>Danh sách phiếu chờ bạn duyệt</p></div>
              <select className="input" aria-label="Lọc trạng thái" value={phase} onChange={(e) => setPhase(e.target.value as typeof phase)}>
                <option value="">Tất cả trạng thái</option>
                <option value="duyet">Chờ duyệt</option>
                <option value="chi">Chờ chi tiền</option>
              </select>
            </div>
            <div className="tiles" role="group" aria-label="Lọc theo nghiệp vụ">
              <button className="tile" aria-pressed={!kind} onClick={() => setKind("")}><b>{rows.length}</b> Tất cả</button>
              {KINDS.filter((k) => counts[k.kind]).map((k) => (
                <button key={k.kind} className="tile" aria-pressed={kind === k.kind} onClick={() => setKind(kind === k.kind ? "" : k.kind)}>
                  <b>{counts[k.kind]}</b> {k.label.replace(/^(Xin |Đề nghị )/, "").replace(/^./, (c) => c.toUpperCase())}
                </button>
              ))}
            </div>
            {err ? <div className="error-box" style={{ margin: "0 16px 12px" }}>{err}</div> : null}
            {loading ? <div className="dt-empty">Đang tải…</div> : shown.length === 0 ? (
              <div className="dt-empty"><b>Không có phiếu nào chờ bạn</b><br />Phiếu đến lượt bạn duyệt hoặc chờ bạn chi tiền sẽ hiện ở đây.</div>
            ) : (
              <div className="dt-wrap">
                <table className="dt cards">
                  <thead><tr><th>Nghiệp vụ</th><th>Phiếu</th><th>Nội dung</th><th>Người đề nghị</th><th>Trạng thái</th><th>Thao tác</th></tr></thead>
                  <tbody>
                    {paging.slice.map((r) => {
                      const canDecide = phases[r.id] === "duyet";
                      return (
                        <tr key={r.id}>
                          <td data-label="Nghiệp vụ"><span className={`kcell k-${r.kind}`}><span className="rq-ico">{KIND_ICON[r.kind]}</span>{kindLabel(r)}</span></td>
                          <td data-label="Phiếu"><div className="t1 num">{ddmmyyyy(r.doc_date ?? r.created_at)}</div><div className="t2 num">{r.doc_no ?? ""}</div></td>
                          <td data-label="Nội dung"><Link to={`/van-phong/${r.id}`} className="dt-link num">{summary(r)}</Link><div className="t2 clip">{r.reason}</div></td>
                          <td data-label="Người đề nghị"><div className="t1">{name(r.requester_id)}</div><div className="t2">{pos[r.requester_id] ?? ""}</div></td>
                          <td data-label="Trạng thái"><span className={`rq-pill ${canDecide ? "cho_duyet" : "da_duyet"}`}>{canDecide ? "Chờ bạn duyệt" : "Chờ chi tiền"}</span></td>
                          <td className="acts-cell" data-label="Thao tác">
                            <div className="acts">
                              <Link className="ico-btn" to={`/van-phong/${r.id}`} aria-label="Xem chi tiết" title="Xem chi tiết">{Icon.eye}</Link>
                              {canDecide ? (<>
                                <button className="ico-btn ok" title="Duyệt" aria-label="Duyệt" onClick={() => setDecide({ req: r, mode: "da_duyet" })}>{Icon.check}</button>
                                <button className="ico-btn back" title="Trả lại để sửa" aria-label="Trả lại" onClick={() => setDecide({ req: r, mode: "tra_lai" })}>{Icon.undo}</button>
                                <button className="ico-btn no" title="Từ chối" aria-label="Từ chối" onClick={() => setDecide({ req: r, mode: "tu_choi" })}>{Icon.x}</button>
                              </>) : null}
                            </div>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
            {shown.length ? <Pager p={paging} /> : null}
          </section>
          {isManager ? <MonthCloseCard /> : null}
          <TodoCard mine={tasks} given={given} name={name} />
          </div>

          <aside className="bench" aria-label="Bàn làm việc">
            <section className="card">
              <h3>{Icon.tasks}Bàn làm việc</h3>
              <div className="grp">Thông báo</div>
              <Link to="/thong-bao" className="it">Thông báo chưa xem{unread ? <span className="cnt num">{unread}</span> : <span className="cnt soft num">0</span>}</Link>
              <div className="grp">Văn phòng số</div>
              {KINDS.filter((k) => counts[k.kind]).map((k) => (
                <Link key={k.kind} to={`/van-phong/ds/${k.kind}`} className="it">{k.label}<span className="cnt num">{counts[k.kind]}</span></Link>
              ))}
              {!rows.length ? <span className="it muted">Không có phiếu chờ duyệt</span> : null}
              {fixN ? <Link to="/van-phong" className="it">Đề nghị của bạn cần sửa<span className="cnt num">{fixN}</span></Link> : null}
              <div className="grp">Công việc</div>
              <Link to="/viec" className="it">Việc đang làm của bạn<span className={`cnt num${tasks.length ? "" : " soft"}`}>{tasks.length}</span></Link>
              {overdue ? <Link to="/viec" className="it">Việc trễ hạn<span className="cnt num">{overdue}</span></Link> : null}
              {nearDue ? <Link to="/viec" className="it">Việc sắp đến hạn ({SOON_DAYS + 1} ngày)<span className="cnt near num">{nearDue}</span></Link> : null}
              {given.length ? <Link to="/viec" className="it">Việc bạn đã giao, chưa xong<span className="cnt soft num">{given.length}</span></Link> : null}
            </section>
            <Calendar tasks={tasks} given={given} name={name} />
          </aside>
        </div>
      </main>
      <DecideSheet req={decide?.req ?? null} mode={decide?.mode ?? null} onClose={() => setDecide(null)} onDone={() => { setDecide(null); load(); }} />
    </>
  );
}

const DOW = ["T2", "T3", "T4", "T5", "T6", "T7", "CN"];
const WEEKDAY_FULL = ["Chủ nhật", "Thứ hai", "Thứ ba", "Thứ tư", "Thứ năm", "Thứ sáu", "Thứ bảy"];
const iso = (y: number, m: number, d: number) => `${y}-${String(m + 1).padStart(2, "0")}-${String(d).padStart(2, "0")}`;

/** Lịch tháng theo hạn chót: chấm đỏ = việc được giao cho tôi, chấm xanh = việc tôi giao cho người khác */
function Calendar({ tasks, given, name }: { tasks: TaskLite[]; given: TaskLite[]; name: (id: string) => string }) {
  const today = todayVN();
  const [ty, tm] = today.split("-").map(Number);
  const [view, setView] = useState({ y: ty, m: tm - 1 });
  const [sel, setSel] = useState(today);
  const first = new Date(Date.UTC(view.y, view.m, 1));
  const lead = (first.getUTCDay() + 6) % 7;                      // tuần bắt đầu từ Thứ hai
  const dim = new Date(Date.UTC(view.y, view.m + 1, 0)).getUTCDate();
  const cells: { date: string; d: number; out: boolean }[] = [];
  for (let i = lead; i > 0; i--) { const dt = new Date(Date.UTC(view.y, view.m, 1 - i)); cells.push({ date: iso(dt.getUTCFullYear(), dt.getUTCMonth(), dt.getUTCDate()), d: dt.getUTCDate(), out: true }); }
  for (let d = 1; d <= dim; d++) cells.push({ date: iso(view.y, view.m, d), d, out: false });
  while (cells.length % 7) { const k = cells.length - lead - dim + 1; const dt = new Date(Date.UTC(view.y, view.m + 1, k)); cells.push({ date: iso(dt.getUTCFullYear(), dt.getUTCMonth(), dt.getUTCDate()), d: dt.getUTCDate(), out: true }); }
  const byDate = useMemo(() => {
    const m: Record<string, TaskLite[]> = {};
    tasks.forEach((t) => { if (t.due_date) (m[t.due_date] ??= []).push(t); });
    return m;
  }, [tasks]);
  const givenByDate = useMemo(() => {
    const m: Record<string, TaskLite[]> = {};
    given.forEach((t) => { if (t.due_date) (m[t.due_date] ??= []).push(t); });
    return m;
  }, [given]);
  const nearEnd = addDaysISO(today, SOON_DAYS);
  const near = (d: string) => d >= today && d <= nearEnd && !!(byDate[d] || givenByDate[d]);
  const move = (n: number) => setView(({ y, m }) => { const dt = new Date(Date.UTC(y, m + n, 1)); return { y: dt.getUTCFullYear(), m: dt.getUTCMonth() }; });
  const selWd = WEEKDAY_FULL[new Date(sel + "T00:00:00Z").getUTCDay()];
  const evs = byDate[sel] ?? [];
  const gEvs = givenByDate[sel] ?? [];
  return (
    <section className="card" aria-label="Lịch">
      <div className="cal-head">
        <b>Tháng {view.m + 1}/{view.y}</b>
        <span>
          <button type="button" onClick={() => move(-1)} aria-label="Tháng trước">◀</button>
          <button type="button" onClick={() => { setView({ y: ty, m: tm - 1 }); setSel(today); }}>Hôm nay</button>
          <button type="button" onClick={() => move(1)} aria-label="Tháng sau">▶</button>
        </span>
      </div>
      <div className="cal-grid">
        {DOW.map((d) => <span key={d} className="dow">{d}</span>)}
        {cells.map((c) => (
          <button key={c.date} type="button" className={`${c.out ? "out" : ""}${c.date === today ? " today" : ""}${c.date === sel ? " sel" : ""}${byDate[c.date] ? " ev" : ""}${givenByDate[c.date] ? " gv" : ""}${near(c.date) ? " near" : ""}`}
            onClick={() => setSel(c.date)}
            aria-label={`${ddmmyyyy(c.date)}${near(c.date) ? ", sắp đến hạn" : ""}${byDate[c.date] ? `, ${byDate[c.date].length} việc được giao` : ""}${givenByDate[c.date] ? `, ${givenByDate[c.date].length} việc đã giao` : ""}`}>{c.d}</button>
        ))}
      </div>
      <div className="cal-day">
        <div className="d"><div>{selWd}</div><b className="num">{sel.slice(8)} / {sel.slice(5, 7)}</b></div>
        <div className="ev-list">
          {evs.map((t) => <Link key={t.id} to={`/viec/${t.id}`} className="ev-in"><small>Được giao{t.created_by && t.created_by !== t.assignee_id ? ` · từ ${name(t.created_by)}` : ""}</small>{t.title}</Link>)}
          {gEvs.map((t) => <Link key={t.id} to={`/viec/${t.id}`} className="ev-out"><small>Đã giao · {t.assignee_id ? name(t.assignee_id) : "chưa có người"}</small>{t.title}</Link>)}
          {!evs.length && !gEvs.length ? <span className="muted">Không có việc đến hạn</span> : null}
        </div>
      </div>
      <div className="cal-legend"><span><i className="in" />Việc được giao</span><span><i className="out" />Việc đã giao</span><span><i className="near" />Sắp đến hạn</span></div>
    </section>
  );
}

type TodoFilter = "" | "chua_lam" | "dang_lam" | "vuong" | "gap" | "sap" | "tre";
const PRIO_RANK: Record<Priority, number> = { gap: 0, cao: 1, binh_thuong: 2, thap: 3 };

/** Việc chưa xong ngay trên Trang chủ: chưa làm, đang làm, vướng, gấp, trễ hạn. Gấp và trễ hạn lên đầu. */
function TodoCard({ mine, given, name }: { mine: TaskLite[]; given: TaskLite[]; name: (id: string) => string }) {
  const { buildings } = useSession();
  const [who, setWho] = useState<"mine" | "given">("mine");
  const [f, setF] = useState<TodoFilter>("");
  const today = todayVN();
  const list = who === "mine" ? mine : given;
  const late = (t: TaskLite) => !!t.due_date && t.due_date < today;
  const lv = (t: TaskLite) => dueLevel(t.due_date, false);
  const isNear = (t: TaskLite) => { const l = lv(t); return l === "today" || l === "soon"; };
  const count = (k: TodoFilter) => list.filter((t) => match(t, k)).length;
  function match(t: TaskLite, k: TodoFilter) {
    if (!k) return true;
    if (k === "gap") return t.priority === "gap" || t.priority === "cao";
    if (k === "tre") return late(t);
    if (k === "sap") return isNear(t);
    return t.status === k;
  }
  const rows = useMemo(() => list.filter((t) => match(t, f)).sort((a, b) =>
    Number(late(b)) - Number(late(a)) || Number(isNear(b)) - Number(isNear(a))
    || (isNear(a) ? (a.due_date ?? "").localeCompare(b.due_date ?? "") : 0) || PRIO_RANK[a.priority] - PRIO_RANK[b.priority]
    || (a.due_date ?? "9999").localeCompare(b.due_date ?? "9999")), [list, f]); // eslint-disable-line react-hooks/exhaustive-deps
  const paging = usePaging(rows, 10);
  useEffect(() => { paging.setPage(1); }, [f, who]); // eslint-disable-line react-hooks/exhaustive-deps
  const code = (id: string | null) => buildings.find((b) => b.id === id)?.code;
  const chips: [TodoFilter, string][] = [["", "Tất cả"], ["chua_lam", "Chưa làm"], ["dang_lam", "Đang làm"], ["vuong", "Vướng"], ["gap", "Gấp, cao"], ["sap", "Sắp đến hạn"], ["tre", "Trễ hạn"]];
  return (
    <section className="pg-card" aria-label="Việc cần làm">
      <div className="pg-head">
        <span className="pg-ico">{Icon.tasks}</span>
        <div className="grow"><h2>Việc cần làm</h2><p>Việc chưa xong: trễ hạn, sắp đến hạn ({SOON_DAYS + 1} ngày) xếp lên đầu và tô màu</p></div>
        <select className="input" aria-label="Việc của ai" value={who} onChange={(e) => setWho(e.target.value as "mine" | "given")}>
          <option value="mine">Việc được giao cho tôi</option>
          <option value="given">Việc tôi đã giao</option>
        </select>
      </div>
      <div className="tiles" role="group" aria-label="Lọc việc">
        {chips.map(([k, l]) => (
          <button key={k} className={`tile${k === "sap" && count(k) ? " tile-near" : ""}${k === "tre" && count(k) ? " tile-late" : ""}`} aria-pressed={f === k} onClick={() => setF(f === k ? "" : k)}><b>{count(k)}</b> {l}</button>
        ))}
      </div>
      {rows.length === 0 ? (
        <div className="dt-empty"><b>{list.length ? "Không có việc nào ở mục này" : who === "mine" ? "Bạn không còn việc nào chưa xong" : "Không có việc bạn giao còn dang dở"}</b></div>
      ) : (
        <div className="dt-wrap">
          <table className="dt cards">
            <thead><tr><th>Việc</th><th>Hạn</th><th>Trạng thái</th><th>Ưu tiên</th><th>{who === "mine" ? "Người giao" : "Người làm"}</th></tr></thead>
            <tbody>
              {paging.slice.map((t) => {
                const d = dueInfo(t.due_date, false);
                const b = code(t.building_id);
                return (
                  <tr key={t.id} className={lv(t) ? `todo-${lv(t)}` : undefined}>
                    <td data-label="Việc"><Link to={`/viec/${t.id}`} className="dt-link">{t.title}</Link>{b ? <div className="t2">{b}</div> : null}</td>
                    <td data-label="Hạn">{d ? <span className={`due ${d.tone}${lv(t) ? " due-hl" : ""}`}>{d.text}</span> : <span className="muted">Không hạn</span>}</td>
                    <td data-label="Trạng thái"><span className={`pill ${t.status}`}>{STATUS_LABEL[t.status]}</span></td>
                    <td data-label="Ưu tiên">{t.priority === "gap" || t.priority === "cao" ? <span className="prio">{PRIORITY_LABEL[t.priority]}</span> : <span className="muted">{PRIORITY_LABEL[t.priority]}</span>}</td>
                    <td data-label={who === "mine" ? "Người giao" : "Người làm"}>{who === "mine" ? (t.created_by ? name(t.created_by) : "—") : (t.assignee_id ? name(t.assignee_id) : "Chưa có người")}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
      {rows.length ? <Pager p={paging} /> : null}
    </section>
  );
}
