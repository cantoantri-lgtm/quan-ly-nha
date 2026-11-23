import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { friendlyError, supabase } from "../lib/supabase";
import { useSession } from "../lib/session";
import { copyText, Icon } from "../components/ui";
import { WEB_DEFAULTS, WEB_DEFAULTS_EN, type WebConfig } from "../web/webApi";
import { heroMediaUrl, removeHeroMedia, uploadHeroMedia, type HeroMedia } from "../lib/files";
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
  { k: "zalo", label: "Số Zalo", max: 13, ph: "0909123456", hint: "Hiện nút “Liên hệ Zalo” trong khung Liên hệ." },
  { k: "email", label: "Email", max: 120, ph: "lienhe@…" },
  { k: "address", label: "Địa chỉ văn phòng", max: 200 },
  { k: "hours", label: "Giờ làm việc", max: 100, ph: "8:00 – 18:00, thứ Hai đến thứ Bảy" },
  { k: "footer_note", label: "Câu giới thiệu cuối trang", max: 200, ph: WEB_DEFAULTS.footer_note },
];
const CHAT: TextField[] = [
  { k: "contact_title", label: "Tiêu đề khung", max: 60, ph: "Liên hệ để được tư vấn" },
  { k: "contact_hours", label: "Giờ tư vấn (hiện sau mỗi nút)", max: 40, ph: "8h - 21h30" },
  { k: "messenger", label: "Facebook Messenger", max: 120, ph: "Link fanpage hoặc m.me/ten-trang", hint: "Dán link Fanpage, app tự lấy tên trang." },
  { k: "hotline_label", label: "Tên nút gọi Hotline", max: 40, ph: "Gọi thuê phòng" },
  { k: "hotline2", label: "Số gọi thứ hai", max: 16, ph: "0909 765 432" },
  { k: "hotline2_label", label: "Tên nút gọi số thứ hai", max: 40, ph: "Gọi hỗ trợ khách thuê" },
  { k: "chat_greeting", label: "Lời chào trong khung nhắn tin", max: 160, area: true, ph: "Chào bạn! Để lại số điện thoại và tin nhắn, Next Living sẽ trả lời ở đây và gọi lại cho bạn." },
];
const EN: TextField[] = [
  { k: "eyebrow_en", label: "Dòng chữ nhỏ trên tiêu đề", max: 60, ph: WEB_DEFAULTS_EN.eyebrow },
  { k: "title1_en", label: "Tiêu đề, dòng 1", max: 60, ph: WEB_DEFAULTS_EN.title1 },
  { k: "title2_en", label: "Tiêu đề, dòng 2 (chữ nghiêng)", max: 60, ph: WEB_DEFAULTS_EN.title2 },
  { k: "subtitle_en", label: "Câu giới thiệu", max: 200, area: true, ph: WEB_DEFAULTS_EN.subtitle },
  { k: "notice_en", label: "Thông báo đầu trang (hiện khi bật thông báo)", max: 160, area: true, hint: "Để trống thì bản tiếng Anh không hiện thông báo." },
  { k: "footer_note_en", label: "Câu giới thiệu cuối trang", max: 200, ph: WEB_DEFAULTS_EN.footer_note },
  { k: "seo_title_en", label: "Tiêu đề tab trình duyệt", max: 70, ph: WEB_DEFAULTS_EN.seo_title },
  { k: "seo_desc_en", label: "Mô tả khi tìm Google / chia sẻ link", max: 160, area: true, ph: WEB_DEFAULTS_EN.seo_desc },
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
  const [pvLang, setPvLang] = useState<"vi" | "en">("vi");
  const frame = useRef<HTMLIFrameElement>(null);
  const [upl, setUpl] = useState<{ done: number; total: number } | null>(null);
  const [uplErr, setUplErr] = useState<string[]>([]);

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
    const keep = new Set((cfg.hero_media ?? []).map((m) => m.path));
    removeHeroMedia((saved?.hero_media ?? []).map((m) => m.path).filter((p) => !keep.has(p))).catch(() => {});
    toast("Đã lưu. Website đổi ngay cho khách.");
    await load();
    setFrameKey((n) => n + 1);   // tải lại khung xem trước để áp dụng toà / phòng bị ẩn
  }

  async function addMedia(files: FileList | null) {
    const list = [...(files ?? [])];
    if (!list.length) return;
    const room = 12 - (cfg.hero_media?.length ?? 0);
    const take = list.slice(0, Math.max(0, room));
    const errs: string[] = list.length > take.length ? [`Tối đa 12 ảnh / clip, bỏ qua ${list.length - take.length} tệp.`] : [];
    setUplErr([]); setUpl({ done: 0, total: take.length });
    const added: HeroMedia[] = [];
    for (const f of take) {
      try { added.push(await uploadHeroMedia(f)); } catch (e) { errs.push(e instanceof Error ? e.message : String(e)); }
      setUpl((u) => (u ? { ...u, done: u.done + 1 } : u));
    }
    setUpl(null); setUplErr(errs);
    if (added.length) setCfg((c) => ({ ...c, hero_media: [...(c.hero_media ?? []), ...added] }));
  }
  const moveMedia = (k: number, d: -1 | 1) => setCfg((c) => {
    const a = [...(c.hero_media ?? [])]; const j = k + d;
    if (j < 0 || j >= a.length) return c;
    [a[k], a[j]] = [a[j], a[k]]; return { ...c, hero_media: a };
  });
  const dropMedia = (k: number) => setCfg((c) => ({ ...c, hero_media: (c.hero_media ?? []).filter((_, x) => x !== k) }));

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
          : <input className="input" maxLength={f.max} value={v} placeholder={f.ph} inputMode={f.k === "hotline" || f.k === "hotline2" || f.k === "zalo" ? "tel" : f.k === "email" ? "email" : undefined}
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
            <label className="field"><span>Ảnh toà dùng khi chưa có trình chiếu</span>
              <select className="input" value={cfg.hero_building ?? ""} onChange={(e) => set("hero_building", e.target.value || undefined)}>
                <option value="">Tự chọn (toà có ảnh và nhiều phòng trống nhất)</option>
                {buildings.map((b) => <option key={b.id} value={b.id}>Ảnh toà {b.code} · {b.name}</option>)}
              </select>
              <small className="muted">Dùng ảnh toà đã tải lên trong màn Toà nhà. Toà chưa có ảnh thì website tự chọn toà khác.</small>
            </label>
          </section>

          <section className="card ws-sec">
            <h3>Ảnh và clip đầu trang (trình chiếu)</h3>
            <p className="muted small" style={{ margin: 0 }}>Thêm nhiều ảnh hoặc clip, website tự chuyển lần lượt. Nên dùng ảnh ngang từ 1920px; clip ngắn 10–20 giây, không cần tiếng, dưới 50 MB (MP4). Chưa có ảnh nào thì dùng ảnh toà bên dưới.</p>
            {cfg.hero_media?.length ? (
              <ul className="ws-media">
                {cfg.hero_media.map((m, k) => (
                  <li key={m.path}>
                    {m.kind === "video"
                      ? <video src={heroMediaUrl(m.path)} muted playsInline preload="metadata" aria-label={`Clip ${k + 1}`} />
                      : <img src={heroMediaUrl(m.path)} alt={`Ảnh ${k + 1}`} loading="lazy" />}
                    <span className="ws-media-n">{k + 1}{m.kind === "video" ? " · Clip" : ""}</span>
                    <div className="ws-media-acts">
                      <button type="button" className="ico-btn" aria-label="Đưa lên trước" disabled={k === 0} onClick={() => moveMedia(k, -1)}>{Icon.back}</button>
                      <button type="button" className="ico-btn" aria-label="Đưa ra sau" disabled={k === cfg.hero_media!.length - 1} onClick={() => moveMedia(k, 1)}><span style={{ display: "inline-flex", transform: "rotate(180deg)" }}>{Icon.back}</span></button>
                      <button type="button" className="ico-btn no" aria-label="Bỏ khỏi trình chiếu" onClick={() => dropMedia(k)}>{Icon.trash}</button>
                    </div>
                  </li>
                ))}
              </ul>
            ) : null}
            <div className="row">
              <label className={`btn secondary sm${upl ? " disabled" : ""}`} aria-disabled={!!upl}>
                {Icon.plus}{upl ? `Đang tải ${upl.done}/${upl.total}…` : "Thêm ảnh / clip"}
                <input type="file" multiple hidden disabled={!!upl} accept="image/jpeg,image/png,image/webp,image/heic,video/mp4,video/webm"
                  onChange={(e) => { addMedia(e.target.files); e.target.value = ""; }} />
              </label>
              <label className="row small" style={{ gap: 6 }}>Chuyển sau
                <select className="input" style={{ width: 96, minHeight: 36, padding: "4px 8px" }} value={cfg.hero_interval ?? 5}
                  onChange={(e) => set("hero_interval", Number(e.target.value))}>
                  {[3, 4, 5, 6, 8, 10, 15].map((x) => <option key={x} value={x}>{x} giây</option>)}
                </select>
              </label>
            </div>
            {uplErr.length ? <div className="error-box">{uplErr.map((m) => <div key={m}>{m}</div>)}</div> : null}
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
            <h3>Nút Liên hệ và nhắn tin</h3>
            <p className="muted small" style={{ margin: 0 }}>Nút “Liên hệ” nổi ở góc phải website. Khung gồm: nhắn tin (khách phải nhập số điện thoại trước khi gửi, tin vào mục Phản ánh & tin nhắn dạng “SĐT: tin nhắn”), Messenger, Zalo, Hotline, số gọi thứ hai. Mục nào để trống thì không hiện.</p>
            <label className="loa-switch ws-switch">
              <span>Hiện nút Liên hệ<small className="muted">Tắt thì website không có nút Liên hệ</small></span>
              <input type="checkbox" role="switch" checked={cfg.contact_on !== false} onChange={(e) => set("contact_on", e.target.checked)} />
            </label>
            <label className="loa-switch ws-switch">
              <span>Cho khách nhắn tin trong khung<small className="muted">Tắt thì chỉ còn các nút Messenger, Zalo, gọi điện</small></span>
              <input type="checkbox" role="switch" checked={cfg.chat_on !== false} onChange={(e) => set("chat_on", e.target.checked)} />
            </label>
            {CHAT.map(textInput)}
            <div className="field">
              <span>Gắn vào website công ty</span>
              <code className="ws-code">{`<script src="${window.location.origin}/lien-he.js" charset="utf-8" defer></script>`}</code>
              <small className="muted">Dán dòng này trước thẻ đóng &lt;/body&gt; của website công ty (WordPress: Giao diện → Theme File Editor hoặc plugin chèn mã cuối trang). Nút Liên hệ và nội dung giống hệt trang phòng trống; đổi ở đây là website công ty đổi theo.</small>
              <button type="button" className="btn secondary sm" style={{ alignSelf: "flex-start" }} onClick={() => copyText(`<script src="${window.location.origin}/lien-he.js" charset="utf-8" defer></script>`).then(() => toast("Đã chép mã nhúng."))}>Chép mã</button>
            </div>
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

          <section className="card ws-sec">
            <h3>Bản tiếng Anh (English)</h3>
            <p className="muted small" style={{ margin: 0 }}>
              Website tiếng Anh ở địa chỉ <b>{window.location.origin}/en/phong</b>, có nút VI / EN ở đầu trang. Chữ giao diện đã dịch sẵn.
              Loại phòng, nội thất, tiện ích, tên phí tự dịch các cụm thường gặp; nội dung đặt cọc và địa chỉ giữ nguyên tiếng Việt.
              Ô nào để trống thì dùng câu mặc định bằng tiếng Anh (chữ mờ trong ô).
            </p>
            {EN.map(textInput)}
            <button type="button" className="btn secondary sm" style={{ alignSelf: "flex-start" }} onClick={() => setPvLang(pvLang === "en" ? "vi" : "en")}>
              {pvLang === "en" ? "Xem trước bản tiếng Việt" : "Xem trước bản tiếng Anh"}
            </button>
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
            <iframe key={`${frameKey}-${pvLang}`} ref={frame} title="Xem trước website" src={pvLang === "en" ? "/en/phong?xem=thu" : "/phong?xem=thu"} onLoad={push} />
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
