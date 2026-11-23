import { useEffect, useMemo, useState, type FormEvent } from "react";
import { Link, useParams } from "react-router-dom";
import { supabase } from "../lib/supabase";
import { useSession } from "../lib/session";
import { addDaysISO, ddmm, todayVN } from "../lib/dates";
import { vnd } from "../lib/money";
import { dataText, dateText, dow, money, useLang, useT, webPath, type Lang } from "./i18n";
import { copyText } from "../components/ui";
import { currentRef, feeOf, floorText, perText, shortAddr, usePhotoUrls, type WebRoomDetail } from "./webApi";
import { WebFooter, WebHeader, WebIcon, zaloHref } from "./WebShell";

const SLOTS: ["sang" | "chieu" | "toi", "slot_sang" | "slot_chieu" | "slot_toi"][] = [["sang", "slot_sang"], ["chieu", "slot_chieu"], ["toi", "slot_toi"]];

/** 3 ngày xem gần nhất, bỏ Chủ nhật (công ty nghỉ) */
function nextDays(): string[] {
  const out: string[] = [];
  for (let i = 0; out.length < 3 && i < 7; i++) {
    const d = addDaysISO(todayVN(), i);
    if (new Date(d + "T00:00:00Z").getUTCDay() !== 0) out.push(d);
  }
  return out;
}

export default function WebRoom() {
  const { id } = useParams();
  const lang = useLang(), t = useT();
  const dt = (x: string) => dataText(lang, x);
  const home = webPath(lang, "/phong");
  const [room, setRoom] = useState<WebRoomDetail | null | undefined>(undefined);
  useEffect(() => {
    setRoom(undefined);
    supabase.rpc("web_room", { p_room: id }).then(({ data, error }) => setRoom(error ? null : ((data as WebRoomDetail | null) ?? null)));
    window.scrollTo(0, 0);
  }, [id]);

  const photos = usePhotoUrls(room ? room.photos : null, "full");
  const others = usePhotoUrls(room ? room.others.map((o) => o.photo) : null, "thumb");
  const zalo = zaloHref();

  if (room === undefined) return <div className="web"><div className="web-bar"><WebHeader /></div><p className="web-wrap web-sec web-muted">{t("room_loading")}</p></div>;
  if (!room) {
    return (
      <div className="web">
        <div className="web-bar"><WebHeader /></div>
        <div className="web-wrap web-sec"><div className="web-empty">{t("room_404")} <Link to={home}>{t("room_404_link")}</Link></div></div>
        <WebFooter />
      </div>
    );
  }
  const vacant = room.status === "trong";
  const title = `${dt(room.type_name)}${room.floor != null ? ` · ${floorText(room.floor, lang)}` : ""}`;
  const dien = feeOf(room.fees, "dien"), nuoc = feeOf(room.fees, "nuoc"), dv = feeOf(room.fees, "dich_vu"), xe = feeOf(room.fees, "xe");
  const monthly = room.rent_mode === "thang";
  const estimate = monthly && dien != null && nuoc != null ? room.list_price + dien * 100 + nuoc + (dv ?? 0) + (xe ?? 0) : null;
  // Nội thất riêng của phòng (mỗi dòng một món) nếu có, không thì dùng danh sách chung của toà
  const own = (room.room_furniture ?? "").split(/\n|,/).map((x) => x.trim()).filter(Boolean);
  const furniture = own.length ? own : room.furniture;
  const shots = room.photos.length ? room.photos.slice(0, 5) : [];

  return (
    <div className="web web-room-page">
      <div className="web-bar"><WebHeader /></div>
      <main className="web-wrap">
        <nav className="web-crumb" aria-label={t("crumb")}>
          <Link to={`${home}${window.location.search}`}>{t("nav_rooms")}</Link><span aria-hidden="true">/</span>
          <span>{room.building.name}</span><span aria-hidden="true">/</span><span>{title}</span>
        </nav>

        <div className="web-gallery">
          {shots.length ? shots.map((p, i) => (
            <a key={p.path} href={photos[i] ?? undefined} target="_blank" rel="noopener" className="web-ph" aria-label={t("photo_n", { n: i + 1 })}>
              {photos[i] ? <img src={photos[i]!} alt="" /> : WebIcon.photo(36)}
            </a>
          )) : <div className="web-ph" style={{ gridColumn: "1 / -1", gridRow: "1 / -1" }}>{WebIcon.photo(56)}<span className="sr">{t("no_photo")}</span></div>}
        </div>

        <div className="web-cols">
          <div className="web-main">
            <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
              <div className="web-chips">
                {vacant ? <span className="web-chip" style={{ display: "inline-flex", alignItems: "center", background: "var(--web-tag)", borderColor: "transparent", color: "var(--web-title)" }}>{t("vacant_now")}</span>
                  : <span className="web-err">{t("taken")}</span>}
                {room.area_m2 ? <span className="web-chip" style={{ display: "inline-flex", alignItems: "center" }}>{room.area_m2} m²</span> : null}
                {room.max_occupants ? <span className="web-chip" style={{ display: "inline-flex", alignItems: "center" }}>{t("max_people", { n: room.max_occupants })}</span> : null}
              </div>
              <span className="web-eyebrow">{room.building.name}</span>
              <h1 style={{ fontSize: "clamp(36px, 5vw, 56px)", color: "var(--web-title)" }}>{title}</h1>
              <p className="web-muted" style={{ margin: 0 }}>{room.building.address ?? room.building.name}</p>
              <p className="web-price" style={{ margin: "8px 0 0", fontSize: 28 }}>{money(lang, room.list_price)}<small>{perText(room.rent_mode, lang)} · {t("incl_vat")}</small></p>
            </div>

            {room.fees.length ? (
              <section style={{ display: "flex", flexDirection: "column", gap: 12 }}>
                <h2>{t("monthly_cost")}</h2>
                <div className="web-table">
                  <div><span>{t("rent")}</span><strong>{money(lang, room.list_price)}</strong></div>
                  {room.fees.map((x) => <div key={x.label}><span>{dt(x.label)}</span><strong>{money(lang, Number(x.amount))}{x.unit ? `/${dt(x.unit)}` : ""}</strong></div>)}
                  {estimate != null ? <div className="sum"><span>{t("estimate", { xe: xe != null ? t("estimate_xe") : "" })}</span><strong>{money(lang, estimate)}{t("per_month_sum")}</strong></div> : null}
                </div>
              </section>
            ) : null}

            {furniture.length ? (
              <section style={{ display: "flex", flexDirection: "column", gap: 12 }}>
                <h2>{t("furniture")}</h2>
                <div className="web-chips web-tags">{furniture.map((x) => <span key={x}>{dt(x)}</span>)}</div>
              </section>
            ) : null}

            {room.amenities.length ? (
              <section style={{ display: "flex", flexDirection: "column", gap: 12 }}>
                <h2>{t("amenities")}</h2>
                <div className="web-chips web-tags soft">{room.amenities.map((x) => <span key={x}>{dt(x)}</span>)}</div>
              </section>
            ) : null}

            <section style={{ display: "flex", flexDirection: "column", gap: 12 }}>
              <h2>{t("deposit")}</h2>
              <ul style={{ margin: 0, paddingLeft: 22, lineHeight: 1.9 }} lang={lang === "en" ? "vi" : undefined}>
                {room.deposit_lines.map((x) => <li key={x}>{x}</li>)}
                <li lang={lang}>{t("id_note")}</li>
              </ul>
            </section>

            <section style={{ display: "flex", flexDirection: "column", gap: 12 }}>
              <h2>{t("location")}</h2>
              <p style={{ margin: 0 }}>{room.building.address ?? room.building.name}</p>
              {room.building.note ? <p className="web-muted" style={{ margin: 0 }}>{room.building.note}</p> : null}
              {room.building.lat != null && room.building.lng != null ? (
                <a className="web-pill" style={{ alignSelf: "flex-start" }} href={`https://www.google.com/maps?q=${room.building.lat},${room.building.lng}`} target="_blank" rel="noopener">{t("maps")}</a>
              ) : null}
            </section>
          </div>

          <aside className="web-side" id="dat-lich" aria-label={t("book_aria")}>
            {vacant ? <BookForm room={room} title={title} lang={lang} /> : null}
            <CtvBox room={room} title={title} />
          </aside>
        </div>

        {room.others.length ? (
          <section className="web-sec">
            <h2>{t("others", { b: room.building.name })}</h2>
            <div className="web-grid sm">
              {room.others.map((o, i) => (
                <Link key={o.room_id} className="web-room" to={`${webPath(lang, `/phong/${o.room_id}`)}${window.location.search}`}>
                  <div className="web-ph">{others[i] ? <img src={others[i]!} alt="" loading="lazy" /> : WebIcon.photo(32)}</div>
                  <div className="body">
                    <h3>{dt(o.type_name)}</h3>
                    <span className="web-muted" style={{ fontSize: 14 }}>{floorText(o.floor, lang)}</span>
                    <span className="web-price">{money(lang, Number(o.list_price))}</span>
                  </div>
                </Link>
              ))}
            </div>
          </section>
        ) : null}
      </main>
      <WebFooter />

      {vacant ? (
        <div className="web-sticky">
          <div style={{ flex: 1, display: "flex", flexDirection: "column" }}>
            <strong style={{ color: "var(--web-green)", fontSize: 17, fontWeight: 500 }}>{money(lang, room.list_price)}</strong>
            <span className="web-muted" style={{ fontSize: 12 }}>{monthly ? t("each_month") : t("each_night")}</span>
          </div>
          {zalo ? <a className="web-pill" href={zalo} target="_blank" rel="noopener" aria-label="Chat Zalo" style={{ width: 48, padding: 0 }}>{WebIcon.chat}</a> : null}
          <a className="web-pill solid" href="#dat-lich">{t("book_short")}</a>
        </div>
      ) : null}
    </div>
  );
}

function BookForm({ room, title, lang }: { room: WebRoomDetail; title: string; lang: Lang }) {
  const t = useT();
  const days = useMemo(nextDays, []);
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [date, setDate] = useState(days[0]);
  const [slot, setSlot] = useState("");
  const [note, setNote] = useState("");
  const [consent, setConsent] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [done, setDone] = useState(false);
  const zalo = zaloHref();
  const maxDate = addDaysISO(todayVN(), 30);

  async function submit(e: FormEvent) {
    e.preventDefault(); setErr(null);
    if (name.trim().length < 2) { setErr(t("err_name")); return; }
    if (!/^0\d{9}$/.test(phone.replace(/[^\d]/g, "").replace(/^84/, "0"))) { setErr(t("err_phone")); return; }
    if (!slot) { setErr(t("err_slot")); return; }
    if (!consent) { setErr(t("err_consent")); return; }
    setBusy(true);
    const { error } = await supabase.rpc("web_book_viewing", { p_room: room.room_id, p_name: name, p_phone: phone, p_date: date, p_slot: slot, p_note: note, p_consent: consent, p_ref: currentRef() });
    setBusy(false);
    // Lỗi từ máy chủ viết bằng tiếng Việt: bản tiếng Anh báo câu chung
    if (error) { setErr(lang === "en" ? t("err_send") : error.message || t("err_send")); return; }
    setDone(true);
  }

  if (done) {
    return (
      <div className="web-card web-ok" role="status">
        <span className="tick">{WebIcon.check}</span>
        <h2 style={{ color: "var(--web-title)" }}>{t("done_title")}</h2>
        <p style={{ margin: 0 }}>{t("done_body", { b: room.building.name, p: phone })}</p>
        <div className="web-table" style={{ alignSelf: "stretch", textAlign: "left" }}>
          <div><span>{t("done_room")}</span><strong>{title}</strong></div>
          <div><span>{t("done_day")}</span><strong>{dow(lang, date)} {dateText(lang, date)}</strong></div>
          <div><span>{t("done_slot")}</span><strong>{t(SLOTS.find((s) => s[0] === slot)?.[1] ?? "slot_sang")}</strong></div>
        </div>
        {zalo ? <a className="web-pill solid" href={zalo} target="_blank" rel="noopener" style={{ alignSelf: "stretch" }}>{t("done_zalo")}</a> : null}
        <Link to={webPath(lang, "/phong")}>{t("done_more")}</Link>
      </div>
    );
  }

  return (
    <form className="web-card" onSubmit={submit} noValidate>
      <h2 style={{ color: "var(--web-title)" }}>{t("book_title")}</h2>
      <label className="web-field">{t("name")}<input autoComplete="name" value={name} onChange={(e) => setName(e.target.value)} maxLength={100} /></label>
      <label className="web-field">{t("phone")}<input type="tel" inputMode="tel" autoComplete="tel" value={phone} onChange={(e) => setPhone(e.target.value)} placeholder={t("phone_ph")} /></label>
      <fieldset style={{ border: 0, margin: 0, padding: 0 }}>
        <legend className="web-field" style={{ marginBottom: 8 }}>{t("day")}</legend>
        <div className="web-days">
          {days.map((d, i) => (
            <button key={d} type="button" aria-pressed={date === d} onClick={() => setDate(d)}>
              <small>{i === 0 && d === todayVN() ? t("today") : dow(lang, d)}</small><strong>{ddmm(d)}</strong>
            </button>
          ))}
        </div>
        <label className="web-field" style={{ marginTop: 8, fontWeight: 600, fontSize: 13 }}>{t("other_day")}
          <input type="date" min={todayVN()} max={maxDate} value={date} onChange={(e) => e.target.value && setDate(e.target.value)} />
        </label>
      </fieldset>
      <fieldset style={{ border: 0, margin: 0, padding: 0 }}>
        <legend className="web-field" style={{ marginBottom: 8 }}>{t("slot")}</legend>
        <div className="web-days">
          {SLOTS.map(([k, l]) => <button key={k} type="button" aria-pressed={slot === k} onClick={() => setSlot(k)} style={{ minHeight: 44 }}><strong>{t(l)}</strong></button>)}
        </div>
      </fieldset>
      <label className="web-field">{t("note")}<textarea rows={2} value={note} onChange={(e) => setNote(e.target.value)} maxLength={500} placeholder={t("note_ph")} /></label>
      <label className="web-consent">
        <input type="checkbox" checked={consent} onChange={(e) => setConsent(e.target.checked)} />
        <span>{t("consent_1")}<Link to={webPath(lang, "/phong/chinh-sach-du-lieu")} target="_blank">{t("consent_link")}</Link>{t("consent_2")}</span>
      </label>
      {err ? <div className="web-err" role="alert">{err}</div> : null}
      <button className="web-pill solid" disabled={busy} style={{ height: 56, fontSize: 16 }}>{busy ? t("sending") : t("send")}</button>
      {zalo ? <a className="web-pill" href={zalo} target="_blank" rel="noopener">{t("ask_zalo")}</a> : null}
      <p className="web-muted" style={{ margin: 0, fontSize: 13 }}>{t("book_foot")}</p>
    </form>
  );
}

/** Nhân sự đã đăng nhập: link giới thiệu riêng và tin đăng copy sẵn. Khách và người chưa đăng nhập không thấy. */
function CtvBox({ room, title }: { room: WebRoomDetail; title: string }) {
  const { session, isCustomer, toast } = useSession();
  const lang = useLang(), t = useT();
  const [code, setCode] = useState<string | null>(null);
  useEffect(() => {
    if (!session || isCustomer) return;
    supabase.rpc("my_ref_code").then(({ data }) => setCode((data as string | null) ?? null));
  }, [session, isCustomer]);
  if (!code) return null;
  const link = `${window.location.origin}${webPath(lang, `/phong/${room.room_id}`)}?ctv=${code}`;
  const post = [
    `${title} · ${room.building.name}`,
    `Giá ${vnd(room.list_price)}${perText(room.rent_mode)}`,
    shortAddr(room.building.address),
    room.amenities.length ? `Tiện ích: ${room.amenities.join(", ")}` : "",
    `Xem ảnh và đặt lịch xem: ${link}`,
  ].filter(Boolean).join("\n");
  return (
    <div className="web-ctv" style={{ marginTop: 16 }}>
      <b>{t("ref_title")}</b>
      <code>{link}</code>
      <div className="web-chips">
        <button type="button" className="web-chip" onClick={async () => { if (await copyText(link)) toast(t("ref_copied")); }}>{t("ref_copy")}</button>
        <button type="button" className="web-chip" onClick={async () => { if (await copyText(post)) toast(t("ref_copied_post")); }}>{t("ref_copy_post")}</button>
      </div>
      <span className="web-muted" style={{ fontSize: 13 }}>{t("ref_note")}</span>
    </div>
  );
}
