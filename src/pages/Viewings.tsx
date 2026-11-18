import { useCallback, useEffect, useMemo, useState } from "react";
import { friendlyError, supabase } from "../lib/supabase";
import { useSession } from "../lib/session";
import { ddmm, dow, timeAgo, todayVN } from "../lib/dates";
import { copyText, Empty, TopBar } from "../components/ui";

type V = {
  id: string; room_id: string; building_id: string; full_name: string; phone: string; visit_date: string; slot: string; note: string | null;
  status: string; staff_note: string | null; created_at: string;
  rooms: { code: string; room_type: string | null } | null; buildings: { code: string; name: string } | null;
  referrer: { full_name: string } | null;
};
export const VIEW_STATUS: Record<string, string> = { moi: "Mới", da_goi: "Đã gọi hẹn", da_xem: "Đã xem", khong_den: "Không đến", da_thue: "Đã thuê", huy: "Huỷ" };
const SLOT: Record<string, string> = { sang: "sáng", chieu: "chiều", toi: "tối" };
const TONE: Record<string, string> = { moi: "dang_lam", da_goi: "chua_lam", da_xem: "xong", khong_den: "vuong", da_thue: "xong", huy: "chua_lam" };

/** Lịch hẹn xem phòng khách đặt trên website /phong. Sale của toà và quản lý thấy (RLS can_access_building). */
export default function Viewings() {
  const { toast, buildings } = useSession();
  const [rows, setRows] = useState<V[] | null>(null);
  const [tab, setTab] = useState<"mo" | "tat_ca">("mo");
  const [bld, setBld] = useState("");
  const [busy, setBusy] = useState<string | null>(null);

  const load = useCallback(async () => {
    const { data, error } = await supabase.from("viewing_requests")
      .select("id,room_id,building_id,full_name,phone,visit_date,slot,note,status,staff_note,created_at,rooms(code,room_type),buildings(code,name),referrer:profiles!referrer_id(full_name)")
      .order("visit_date", { ascending: true }).order("created_at", { ascending: false }).limit(300);
    if (error) toast(friendlyError(error));
    setRows((data as unknown as V[]) ?? []);
  }, [toast]);
  useEffect(() => { load(); }, [load]);

  const list = useMemo(() => (rows ?? []).filter((r) => (!bld || r.building_id === bld) && (tab === "tat_ca" || r.status === "moi" || r.status === "da_goi")), [rows, tab, bld]);
  const today = todayVN();

  async function setStatus(v: V, status: string) {
    setBusy(v.id);
    const { error } = await supabase.rpc("viewing_update", { p_id: v.id, p_status: status, p_note: v.staff_note ?? "" });
    setBusy(null);
    if (error) { toast(friendlyError(error)); return; }
    toast(`Đã chuyển sang "${VIEW_STATUS[status]}".`); load();
  }
  async function editNote(v: V) {
    const note = window.prompt("Ghi chú cho lịch hẹn này", v.staff_note ?? "");
    if (note === null) return;
    const { error } = await supabase.rpc("viewing_update", { p_id: v.id, p_status: v.status, p_note: note });
    if (error) toast(friendlyError(error)); else load();
  }

  return (
    <>
      <TopBar title="Lịch hẹn xem phòng" back="/" action={<a className="btn ghost sm" href="/phong" target="_blank" rel="noopener">Mở website</a>} />
      <main className="main stack">
        <p className="muted small" style={{ margin: 0 }}>Khách đặt lịch trên website phòng trống. Gọi cho khách, rồi cập nhật trạng thái để quản lý theo dõi.</p>
        <div className="row" style={{ gap: 8, flexWrap: "wrap" }}>
          <div className="seg" style={{ gridTemplateColumns: "1fr 1fr", flex: "1 1 220px" }} role="group" aria-label="Lọc trạng thái">
            <button type="button" aria-pressed={tab === "mo"} onClick={() => setTab("mo")}>Cần xử lý</button>
            <button type="button" aria-pressed={tab === "tat_ca"} onClick={() => setTab("tat_ca")}>Tất cả</button>
          </div>
          {buildings.length > 1 ? (
            <select className="input" style={{ flex: "1 1 180px" }} value={bld} onChange={(e) => setBld(e.target.value)} aria-label="Lọc theo toà">
              <option value="">Tất cả toà</option>
              {buildings.map((b) => <option key={b.id} value={b.id}>{b.code} · {b.name}</option>)}
            </select>
          ) : null}
        </div>
        {rows === null ? <p className="muted">Đang tải…</p> : !list.length ? <Empty title={tab === "mo" ? "Không có lịch hẹn cần xử lý" : "Chưa có lịch hẹn nào"} /> : null}
        {list.map((v) => (
          <article key={v.id} className="card stack" style={{ padding: 14, gap: 8 }}>
            <div className="row" style={{ justifyContent: "space-between", alignItems: "flex-start", gap: 8, flexWrap: "nowrap" }}>
              <div style={{ minWidth: 0 }}>
                <b>{v.full_name}</b>
                <div className="muted small">{v.buildings?.code} · P.{v.rooms?.code}{v.rooms?.room_type ? ` · ${v.rooms.room_type}` : ""}</div>
              </div>
              <span className={`pill ${TONE[v.status] ?? "chua_lam"}`}>{VIEW_STATUS[v.status] ?? v.status}</span>
            </div>
            <div className="row" style={{ gap: 6, flexWrap: "wrap", fontSize: 14 }}>
              <span className={v.visit_date < today && (v.status === "moi" || v.status === "da_goi") ? "due late" : v.visit_date === today ? "due today" : "due"}>
                Xem {dow(v.visit_date)} {ddmm(v.visit_date)}, buổi {SLOT[v.slot] ?? v.slot}
              </span>
              <span className="muted">· đặt {timeAgo(v.created_at)}</span>
              {v.referrer ? <span className="muted">· giới thiệu: {v.referrer.full_name}</span> : null}
            </div>
            {v.note ? <p style={{ margin: 0, whiteSpace: "pre-wrap" }}>Khách ghi: {v.note}</p> : null}
            {v.staff_note ? <p className="muted small" style={{ margin: 0, whiteSpace: "pre-wrap" }}>Ghi chú: {v.staff_note}</p> : null}
            <div className="row" style={{ gap: 6, flexWrap: "wrap" }}>
              <a className="btn sm" href={`tel:${v.phone}`}>Gọi {v.phone}</a>
              <button type="button" className="btn ghost sm" onClick={async () => { if (await copyText(v.phone)) toast("Đã copy số điện thoại."); }}>Copy số</button>
              <button type="button" className="btn ghost sm" onClick={() => editNote(v)}>Ghi chú</button>
            </div>
            <label className="field" style={{ margin: 0 }}>
              <select className="input" value={v.status} disabled={busy === v.id} onChange={(e) => setStatus(v, e.target.value)} aria-label={`Trạng thái lịch hẹn của ${v.full_name}`}>
                {Object.entries(VIEW_STATUS).map(([k, l]) => <option key={k} value={k}>{l}</option>)}
              </select>
            </label>
          </article>
        ))}
      </main>
    </>
  );
}
