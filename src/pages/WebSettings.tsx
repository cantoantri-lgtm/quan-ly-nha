import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { friendlyError, supabase } from "../lib/supabase";
import { useSession } from "../lib/session";
import { Icon } from "../components/ui";
import { WEB_DEFAULTS, type WebConfig } from "../web/webApi";
import "../table.css";
import "../office.css";
import "../websettings.css";

/** Quản trị › Cài đặt website: Quản lý sửa nội dung trang /phong. Quyền kiểm tra ở web_settings_save (migration 065). */

type TextField = { k: keyof WebConfig; label: string; max: number; hint?: string; area?: boolean; ph?: string };
const HERO: TextField[] = [
  { k: "eyebrow", label: "Dòng chữ nhỏ trên tiêu đề", max: 60, ph: WEB_DEFAULTS.eyebrow },
  { k: "title1", label: "Tiêu đề, dòng 1", max: 60, ph: WEB_DEFAULTS.title1 },
  { k: "title2", label: "Tiêu đề, dòng 2 (chữ nghiêng)", max: 60, ph: WEB_DEFAULTS.title2 },
  { k: "subtitle", label: "Câu giới thiệu", max: 200, area: true, ph: WEB_DEFAULTS.subtitle },
];
const CONTACT: TextField[] = [
  { k: "hotline", label: "Hotline", max: 16, ph: "0909 123 456", hint: "Hiện nút “Gọi” ở đầu trang và cuối trang." },
  { k: "zalo", label: "Số Zalo", max: 13, ph: "0909123456", hint: "Hiện nút chat Zalo nổi ở góc màn hình." },
  { k: "email", label: "Email", max: 120, ph: "lienhe@…" },
  { k: "address", label: "Địa chỉ văn phòng", max: 200 },
  { k: "hours", label: "Giờ làm việc", max: 100, ph: "8:00 – 18:00, thứ Hai đến thứ Bảy" },
  { k: "footer_note", label: "Câu giới thiệu cuối trang", max: 200, ph: WEB_DEFAULTS.footer_note },
];
const SEO: TextField[] = [
  { k: "seo_title", label: "Tiêu đề tab trình duyệt", max: 70, ph: WEB_DEFAULTS.seo_title },
  { k: "seo_desc", label: "Mô tả khi tìm Google / chia sẻ link", max: 160, area: true, ph: WEB_DEFAULTS.seo_desc },
];
const BLOCKS: { k: "show_features" | "show_buildings" | "show_app" | "show_brands"; label: string; hint: string }[] = [
  { k: "show_features", label: "Khám phá mới", hint: "3 gợi ý tự lấy từ phòng trống: giá tốt, nhiều lựa chọn, có ban công" },
  { k: "show_buildings", label: "Toà nhà", hint: "Thẻ từng toà, bấm để lọc phòng của toà" },
  { k: "show_app", label: "App người thuê", hint: "Giới thiệu tài khoản app cho khách sau khi thuê" },
  { k: "show_brands", label: "Hệ thương hiệu", hint: "Next Vision, Next Living và các thương hiệu khác" },
];

type RoomLite = { id: string; code: string; building_id: string; floor: number | null };

export default function WebSettings() {
  const { buildings, toast } = useSession();
  const [saved, setSaved] = useState<WebConfig | null>(null);
  const [cfg, setCfg] = useState<WebConfig>({});
  const [meta, setMeta] = useState<{ at: string | null; by: string | null }>({ at: null, by: null });
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [rooms, setRooms] = useState<RoomLite[]>([]);
  const [openB, setOpenB] = useState<string | null>(null);
  const [device, setDevice] = useState<"pc" | "dt">("pc");
  const [frameKey, setFrameKey] = useState(0);
  const frame = useRef<HTMLIFrameElement>(null);

  const load = useCallback(async () => {
    setErr(null);
    const [{ data, error }, r] = await Promise.all([
      supabase.rpc("web_settings_get"),
      supabase.from("rooms").select("id,code,building_id,floor").eq("status", "trong").order("code"),
    ]);
    if (error) { setErr(friendlyError(error)); return; }
    const row = (Array.isArray(data) ? data[0] : data) as { data: WebConfig; updated_at: string; updated_by_name: string | null } | null;
    const d = row?.data ?? {};
    setSaved(d); setCfg(d); setMeta({ at: row?.updated_at ?? null, by: row?.updated_by_name ?? null });
    setRooms((r.data ?? []) as RoomLite[]);
  }, []);
  useEffect(() => { load(); }, [load]);

  const dirty = useMemo(() => saved !== null && JSON.stringify(norm(saved)) !== JSON.stringify(norm(cfg)), [saved, cfg]);

  // Gửi bản nháp sang khung xem trước (cùng nguồn) mỗi khi sửa
  const push = useCallback(() => {
    const w = frame.current?.contentWindow;
    if (w) { const { hidden_buildings: _a, hidden_rooms: _b, ...pub } = cfg; w.postMessage({ type: "nl-web-preview", cfg: pub }, location.origin); }
  }, [cfg]);
  useEffect(() => { const t = setTimeout(push, 150); return () => clearTimeout(t); }, [push]);
  useEffect(() => {
    const onMsg = (e: MessageEvent) => { if (e.origin === location.origin && (e.data as { type?: string })?.type === "nl-web-ready") push(); };
    window.addEventListener("message", onMsg);
    return () => window.removeEventListener("message", onMsg);
  }, [push]);
  // Rời trang khi còn thay đổi chưa lưu
  useEffect(() => {
    if (!dirty) return;
    const h = (e: BeforeUnloadEvent) => { e.preventDefault(); e.returnValue = ""; };
    window.addEventListener("beforeunload", h);
    return () => window.removeEventListener("beforeunload", h);
  }, [dirty]);

  const set = <K extends keyof WebConfig>(k: K, v: WebConfig[K]) => setCfg((c) => ({ ...c, [k]: v }));
  const hiddenB = new Set(cfg.hidden_buildings ?? []);
  const hiddenR = new Set(cfg.hidden_rooms ?? []);
  const toggleList = (k: "hidden_buildings" | "hidden_rooms", id: string, hide: boolean) => setCfg((c) => {
    const s = new Set(c[k] ?? []); if (hide) s.add(id); else s.delete(id);
    return { ...c, [k]: [...s] };
  });

  async function save() {
    setBusy(true); setErr(null);
    const { error } = await supabase.rpc("web_settings_save", { p_data: cfg });
    setBusy(false);
    if (error) { setErr(friendlyError(error)); return; }
    toast("Đã lưu. Website đổi ngay cho khách.");
    await load();
    setFrameKey((n) => n + 1);   // tải lại khung xem trước để áp dụng toà / phòng bị ẩn
  }

  const byBuilding = useMemo(() => {
    const m = new Map<string, RoomLite[]>();
    rooms.forEach((r) => { const a = m.get(r.building_id) ?? []; a.push(r); m.set(r.building_id, a); });
    return m;
  }, [rooms]);

  const textInput = (f: TextField) => {
    const v = (cfg[f.k] as string | undefined) ?? "";
    return (
      <label key={f.k} className="field">
        <span>{f.label} <small className="muted num">{v.length}/{f.max}</small></span>
        {f.area
          ? <textarea className="input" rows={2} maxLength={f.max} value={v} placeholder={f.ph} onChange={(e) => set(f.k, e.target.value as never)} />
          : <input className="input" maxLength={f.max} value={v} placeholder={f.ph} inputMode={f.k === "hotline" || f.k === "zalo" ? "tel" : f.k === "email" ? "email" : undefined}
              onChange={(e) => set(f.k, e.target.value as never)} />}
        {f.hint ? <small className="muted">{f.hint}</small> : null}
      </label>
    );
  };

  if (saved === null) return <main className="main"><div className="loading">{err ?? "Đang tải…"}</div></main>;

  return (
    <main className="main main-full stack" style={{ gap: 14 }}>
      <section className="pg-card">
        <div className="pg-head">
          <span className="pg-ico">{Icon.map}</span>
          <div className="grow">
            <h2>Cài đặt website</h2>
            <p>Sửa nội dung trang phòng trống công khai. Bấm Lưu là khách thấy ngay.
              {meta.at ? ` Lưu lần cuối ${new Date(meta.at).toLocaleString("vi-VN", { timeZone: "Asia/Ho_Chi_Minh", day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" })}${meta.by ? ` · ${meta.by}` : ""}.` : ""}</p>
          </div>
          {dirty ? <span className="ws-dirty">Có thay đổi chưa lưu</span> : null}
        </div>
        <div className="toolbar ribbon" role="toolbar" aria-label="Thao tác">
          <button type="button" className="rb rb-main" disabled={!dirty || busy} onClick={save}>{Icon.check}{busy ? "Đang lưu…" : "Lưu"}</button>
          <button type="button" className="rb" disabled={!dirty || busy} onClick={() => setCfg(saved)}>{Icon.undo}Bỏ thay đổi</button>
          <span className="rb-sep" aria-hidden="true" />
          <a className="rb" href="/phong" target="_blank" rel="noopener">{Icon.eye}Mở website</a>
          <button type="button" className="rb" onClick={() => setFrameKey((n) => n + 1)}>{Icon.refresh}Tải lại xem trước</button>
        </div>
        {err ? <div className="error-box" style={{ margin: 12 }}>{err}</div> : null}
      </section>

      <div className="ws-grid">
        <div className="stack ws-form">
          <section className="card ws-sec">
            <h3>Đầu trang chủ</h3>
            {HERO.map(textInput)}
            <label className="field"><span>Ảnh nền đầu trang</span>
              <select className="input" value={cfg.hero_building ?? ""} onChange={(e) => set("hero_building", e.target.value || undefined)}>
                <option value="">Tự chọn (toà có ảnh và nhiều phòng trống nhất)</option>
                {buildings.map((b) => <option key={b.id} value={b.id}>Ảnh toà {b.code} · {b.name}</option>)}
              </select>
              <small className="muted">Dùng ảnh toà đã tải lên trong màn Toà nhà. Toà chưa có ảnh thì website tự chọn toà khác.</small>
            </label>
          </section>

          <section className="card ws-sec">
            <h3>Thông báo đầu trang</h3>
            <label className="loa-switch ws-switch">
              <span>Hiện dải thông báo trên cùng<small className="muted">Ví dụ: ưu đãi tháng, lịch nghỉ lễ</small></span>
              <input type="checkbox" role="switch" checked={!!cfg.notice_on} onChange={(e) => set("notice_on", e.target.checked)} />
            </label>
            {textInput({ k: "notice", label: "Nội dung thông báo", max: 160, ph: "Giảm 50% tiền phòng tháng đầu cho hợp đồng 12 tháng" })}
          </section>

          <section className="card ws-sec">
            <h3>Liên hệ</h3>
            {CONTACT.map(textInput)}
          </section>

          <section className="card ws-sec">
            <h3>Các khối trên trang chủ</h3>
            {BLOCKS.map((b) => (
              <label key={b.k} className="loa-switch ws-switch">
                <span>{b.label}<small className="muted">{b.hint}</small></span>
                <input type="checkbox" role="switch" checked={cfg[b.k] !== false} onChange={(e) => set(b.k, e.target.checked)} />
              </label>
            ))}
          </section>

          <section className="card ws-sec">
            <h3>Toà và phòng hiện trên website</h3>
            <p className="muted small" style={{ margin: 0 }}>Website chỉ hiện phòng đang trống và có giá. Tắt một toà hoặc một phòng để giấu khỏi website (vẫn dùng bình thường trong app). Thay đổi áp dụng sau khi bấm Lưu.</p>
            <ul className="ws-blist">
              {buildings.map((b) => {
                const list = byBuilding.get(b.id) ?? [];
                const offR = list.filter((r) => hiddenR.has(r.id)).length;
                const open = openB === b.id;
                return (
                  <li key={b.id}>
                    <div className="ws-brow">
                      <label className="ws-chk">
                        <input type="checkbox" checked={!hiddenB.has(b.id)} onChange={(e) => toggleList("hidden_buildings", b.id, !e.target.checked)} />
                        <span><b>{b.code}</b> · {b.name}</span>
                      </label>
                      <button type="button" className="btn ghost sm" aria-expanded={open} disabled={!list.length || hiddenB.has(b.id)} onClick={() => setOpenB(open ? null : b.id)}>
                        {list.length} phòng trống{offR ? ` · ẩn ${offR}` : ""}{list.length ? Icon.chev : null}
                      </button>
                    </div>
                    {open ? (
                      <div className="ws-rooms">
                        {list.map((r) => (
                          <label key={r.id} className="ws-chk">
                            <input type="checkbox" checked={!hiddenR.has(r.id)} onChange={(e) => toggleList("hidden_rooms", r.id, !e.target.checked)} />
                            <span>Phòng {r.code}</span>
                          </label>
                        ))}
                      </div>
                    ) : null}
                  </li>
                );
              })}
            </ul>
          </section>

          <section className="card ws-sec">
            <h3>Google và chia sẻ link</h3>
            {SEO.map(textInput)}
          </section>
        </div>

        <aside className="ws-preview" aria-label="Xem trước website">
          <div className="ws-pv-head">
            <b>Xem trước</b>
            <div className="tabs" role="tablist" style={{ width: 220 }}>
              <button role="tab" aria-selected={device === "pc"} onClick={() => setDevice("pc")}>Máy tính</button>
              <button role="tab" aria-selected={device === "dt"} onClick={() => setDevice("dt")}>Điện thoại</button>
            </div>
          </div>
          <div className={`ws-frame ${device}`}>
            <iframe key={frameKey} ref={frame} title="Xem trước website" src="/phong?xem=thu" onLoad={push} />
          </div>
          <small className="muted">Chữ, liên hệ và các khối đổi ngay khi gõ. Toà / phòng bị ẩn chỉ đổi sau khi Lưu.</small>
        </aside>
      </div>
    </main>
  );
}

/** So sánh bản nháp với bản đã lưu: bỏ chuỗi rỗng, sắp xếp danh sách */
function norm(c: WebConfig) {
  const o: Record<string, unknown> = {};
  Object.keys(c).sort().forEach((k) => {
    const v = (c as Record<string, unknown>)[k];
    if (v === "" || v === undefined || v === null) return;
    if (Array.isArray(v)) { if (v.length) o[k] = [...v].sort(); return; }
    o[k] = typeof v === "string" ? v.trim() : v;
  });
  return o;
}
