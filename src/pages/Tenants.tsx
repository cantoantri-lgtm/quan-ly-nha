import { useCallback, useEffect, useMemo, useState, type FormEvent } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { friendlyError, supabase } from "../lib/supabase";
import { useSession } from "../lib/session";
import { useCanEditBuilding } from "../lib/useCanEdit";
import { ddmmyyyy } from "../lib/dates";
import { vnd } from "../lib/money";
import { Empty, Sheet, TopBar } from "../components/ui";
import FileGallery from "../components/FileGallery";
import { ID_NAME, ID_PHOTOS, ID_TYPES, idError, normId, type IdType } from "../lib/idDoc";
import "../files.css";

export type Tenant = {
  id: string; building_id: string; full_name: string; phone: string | null; date_of_birth: string | null; hometown: string | null;
  note: string | null; flag: "luu_y" | "quen" | null; flag_note: string | null;
  cccd_consent_at: string | null; cccd_consent_by: string | null; cccd_consent_note: string | null; created_at: string;
  id_type: IdType; nationality: string | null;
};
export const TENANT_COLS = "id,building_id,full_name,phone,date_of_birth,hometown,note,flag,flag_note,cccd_consent_at,cccd_consent_by,cccd_consent_note,created_at,id_type,nationality";
export const FLAG_LABEL = { luu_y: "Cần lưu ý", quen: "Khách quen" } as const;
const CONSENT_NOTES = ["Khách đồng ý trực tiếp", "Khách đồng ý qua Zalo / tin nhắn", "Đã ghi trong hợp đồng"];

// Sửa khách thuê, CCCD: Quản lý, Giám sát toà, sale phòng Kinh doanh phụ trách toà (khớp can_edit_building)
const useCanManage = (buildingId?: string) => useCanEditBuilding(buildingId);

/* ---------- Danh sách khách thuê của một toà ---------- */
export default function Tenants() {
  const { id } = useParams();
  const { buildings } = useSession();
  const building = buildings.find((b) => b.id === id);
  const canManage = useCanManage(id);
  const nav = useNavigate();
  const [list, setList] = useState<Tenant[]>([]);
  const [rooms, setRooms] = useState<Record<string, string>>({});   // tenant_id → phòng đang thuê
  const [hasId, setHasId] = useState<Set<string>>(new Set());
  const [q, setQ] = useState("");
  const [filter, setFilter] = useState<"" | "dang_thue" | "luu_y" | "quen">("");
  const [adding, setAdding] = useState(false);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    const [t, c, f] = await Promise.all([
      supabase.from("tenants").select(TENANT_COLS).eq("building_id", id!).order("full_name"),
      supabase.from("contracts").select("tenant_id, rooms(code)").eq("building_id", id!).eq("status", "hieu_luc"),
      canManage ? supabase.from("files").select("tenant_id").eq("kind", "cccd").eq("building_id", id!) : Promise.resolve({ data: [] }),
    ]);
    setList((t.data as Tenant[]) ?? []);
    const m: Record<string, string> = {};
    ((c.data as unknown as { tenant_id: string; rooms: { code: string } | null }[]) ?? []).forEach((x) => { if (x.rooms) m[x.tenant_id] = x.rooms.code; });
    setRooms(m);
    setHasId(new Set(((f.data as { tenant_id: string }[]) ?? []).map((x) => x.tenant_id)));
    setLoading(false);
  }, [id, canManage]);
  useEffect(() => { load(); }, [load]);

  const shown = useMemo(() => {
    const s = q.trim().toLowerCase();
    return list.filter((t) =>
      (!s || t.full_name.toLowerCase().includes(s) || (t.phone ?? "").includes(s)) &&
      (!filter || (filter === "dang_thue" ? !!rooms[t.id] : t.flag === filter)));
  }, [list, q, filter, rooms]);

  if (!building) return (<><TopBar title="Khách thuê" back /><main className="main"><Empty title="Không tìm thấy toà này" /></main></>);
  const count = (f: typeof filter) => list.filter((t) => (f === "dang_thue" ? !!rooms[t.id] : t.flag === f)).length;

  return (
    <>
      <TopBar title={`Khách thuê · ${building.code}`} back={`/toa/${building.id}`}
        action={canManage ? <button className="tb-action" onClick={() => setAdding(true)}>+ Thêm</button> : null} />
      <main className="main stack">
        <input className="input" id="t-search" type="search" placeholder="Tìm theo tên hoặc số điện thoại" value={q} onChange={(e) => setQ(e.target.value)} />
        <div className="chips" role="group" aria-label="Lọc khách">
          {([["", "Tất cả", list.length], ["dang_thue", "Đang thuê", count("dang_thue")], ["luu_y", "Cần lưu ý", count("luu_y")], ["quen", "Khách quen", count("quen")]] as ["" | "dang_thue" | "luu_y" | "quen", string, number][])
            .map(([k, l, n]) => <button key={k} className="chip" aria-pressed={filter === k} onClick={() => setFilter(k)}>{l}<span className="n">{n}</span></button>)}
        </div>
        {loading ? <div className="loading">Đang tải…</div> : shown.length === 0 ? (
          <Empty title={list.length ? "Không có khách phù hợp" : "Toà này chưa có khách thuê"}>
            {canManage && !list.length ? "Bấm \"+ Thêm\" để nhập khách và đính ảnh CCCD / hộ chiếu." : undefined}
          </Empty>
        ) : (
          <section className="card">
            {shown.map((t) => (
              <div key={t.id} className="list-row" role="button" tabIndex={0} onClick={() => nav(`/khach/${t.id}`)} onKeyDown={(e) => e.key === "Enter" && nav(`/khach/${t.id}`)}>
                <div className="grow">
                  <div className="name">{t.full_name}</div>
                  <div className="sub">{[t.phone, rooms[t.id] ? `Phòng ${rooms[t.id]}` : "Chưa thuê phòng"].filter(Boolean).join(" · ")}</div>
                </div>
                <div className="row" style={{ gap: 6, flexWrap: "nowrap" }}>
                  {t.flag ? <span className={`tag flag-${t.flag}`}>{FLAG_LABEL[t.flag]}</span> : null}
                  {canManage ? <span className="tag" title={hasId.has(t.id) ? `Đã có ảnh ${ID_NAME[t.id_type ?? "cccd"]}` : `Chưa có ảnh ${ID_NAME[t.id_type ?? "cccd"]}`}>{hasId.has(t.id) ? `Có ${ID_NAME[t.id_type ?? "cccd"]}` : `Thiếu ${ID_NAME[t.id_type ?? "cccd"]}`}</span> : null}
                </div>
              </div>
            ))}
          </section>
        )}
      </main>
      {adding ? <TenantSheet buildingId={building.id} onClose={() => setAdding(false)} onSaved={(tid) => { setAdding(false); nav(`/khach/${tid}`); }} /> : null}
    </>
  );
}

/* ---------- Thêm / sửa khách ---------- */
export function TenantSheet({ buildingId, tenant, onClose, onSaved }: {
  buildingId: string; tenant?: Tenant; onClose: () => void; onSaved: (id: string) => void;
}) {
  const { toast } = useSession();
  const [name, setName] = useState(tenant?.full_name ?? "");
  const [phone, setPhone] = useState(tenant?.phone ?? "");
  const [idType, setIdType] = useState<IdType>(tenant?.id_type ?? "cccd");
  const [nation, setNation] = useState(tenant?.nationality ?? "");
  const [idNo, setIdNo] = useState("");
  const [idDate, setIdDate] = useState("");
  const [idPlace, setIdPlace] = useState("");
  const [idAddr, setIdAddr] = useState("");
  const [dob, setDob] = useState(tenant?.date_of_birth ?? "");
  const [home, setHome] = useState(tenant?.hometown ?? "");
  const [note, setNote] = useState(tenant?.note ?? "");
  const [flag, setFlag] = useState<Tenant["flag"]>(tenant?.flag ?? null);
  const [flagNote, setFlagNote] = useState(tenant?.flag_note ?? "");
  const [consent, setConsent] = useState(!!tenant?.cccd_consent_at);
  const [consentNote, setConsentNote] = useState(tenant?.cccd_consent_note ?? CONSENT_NOTES[0]);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    if (!tenant) return;
    supabase.rpc("tenant_private", { p_id: tenant.id }).then(({ data }) => {
      const r = (Array.isArray(data) ? data[0] : data) as { id_number: string | null; id_issued_date: string | null; id_issued_place: string | null; id_address: string | null } | undefined;
      if (r) { setIdNo(r.id_number ?? ""); setIdDate(r.id_issued_date ?? ""); setIdPlace(r.id_issued_place ?? ""); setIdAddr(r.id_address ?? ""); }
    });
  }, [tenant]);

  async function submit(e: FormEvent) {
    e.preventDefault(); setErr(null);
    const digits = normId(idType, idNo);
    const bad = digits ? idError(idType, digits) : null;
    if (bad) { setErr(bad.charAt(0).toUpperCase() + bad.slice(1) + ". Kiểm tra lại."); return; }
    if (idType === "passport" && !nation.trim()) { setErr("Khách dùng hộ chiếu: nhập quốc tịch."); return; }
    setBusy(true);
    const row = {
      building_id: buildingId, full_name: name.trim(), phone: phone.trim() || null, id_number: digits || null,
      id_type: idType, nationality: idType === "passport" ? nation.trim() || null : null,
      id_issued_date: idDate || null, id_issued_place: idPlace.trim() || null, id_address: idAddr.trim() || null, date_of_birth: dob || null, hometown: home.trim() || null,
      note: note.trim() || null, flag, flag_note: flag ? flagNote.trim() || null : null,
      cccd_consent_at: consent ? (tenant?.cccd_consent_at ?? new Date().toISOString()) : null,
      cccd_consent_note: consent ? consentNote : null,
    };
    const res = tenant
      ? await supabase.from("tenants").update(row).eq("id", tenant.id).select("id").single()
      : await supabase.from("tenants").insert(row).select("id").single();
    setBusy(false);
    if (res.error) { setErr(friendlyError(res.error)); return; }
    toast(tenant ? "Đã lưu thông tin khách." : "Đã thêm khách thuê.");
    onSaved(res.data.id);
  }

  return (
    <Sheet open onClose={onClose} title={tenant ? "Sửa thông tin khách" : "Thêm khách thuê"}>
      <form className="stack" onSubmit={submit}>
        <label className="field"><span>Họ tên *</span><input id="t-name" className="input" value={name} onChange={(e) => setName(e.target.value)} required /></label>
        <div className="row" style={{ alignItems: "flex-start" }}>
          <label className="field" style={{ flex: "1 1 150px" }}><span>Số điện thoại</span><input id="t-phone" className="input" inputMode="tel" value={phone} onChange={(e) => setPhone(e.target.value)} /></label>
          <label className="field" style={{ flex: "1 1 150px" }}><span>Ngày sinh</span><input id="t-dob" className="input" type="date" value={dob} onChange={(e) => setDob(e.target.value)} /></label>
        </div>
        <div className="field"><span>Giấy tờ</span>
          <div className="seg" style={{ gridTemplateColumns: "1fr 1fr" }} role="group" aria-label="Loại giấy tờ">
            {ID_TYPES.map(([k, l]) => <button type="button" key={k} aria-pressed={idType === k} onClick={() => setIdType(k)}>{l}</button>)}
          </div>
          {tenant && tenant.id_type !== idType ? <small style={{ color: "var(--today)" }}>Đổi loại giấy tờ: nhớ tải lại ảnh đúng loại ở hồ sơ khách.</small> : null}</div>
        {idType === "passport" ? <label className="field"><span>Quốc tịch *</span><input id="t-nation" className="input" value={nation} onChange={(e) => setNation(e.target.value)} placeholder="VD: Hàn Quốc" /></label> : null}
        <label className="field"><span>Số {ID_NAME[idType]}</span><input id="t-id" className="input num" inputMode={idType === "passport" ? "text" : "numeric"} autoCapitalize="characters" value={idNo}
          onChange={(e) => setIdNo(idType === "passport" ? e.target.value.toUpperCase() : e.target.value.replace(/[^\d\s]/g, ""))} placeholder={idType === "passport" ? "VD: M12345678" : "12 chữ số"} /></label>
        <div className="row" style={{ alignItems: "flex-start" }}>
          <label className="field" style={{ flex: "1 1 150px" }}><span>Ngày cấp</span><input id="t-iddate" className="input" type="date" value={idDate} onChange={(e) => setIdDate(e.target.value)} /></label>
          <label className="field" style={{ flex: "1 1 150px" }}><span>Nơi cấp</span><input id="t-idplace" className="input" value={idPlace} onChange={(e) => setIdPlace(e.target.value)} placeholder="VD: Cục CSQLHC về TTXH" /></label>
        </div>
        <label className="field"><span>{idType === "passport" ? "Địa chỉ (nơi ở / địa chỉ nước ngoài, để xuất hoá đơn)" : "Địa chỉ trên CCCD (để xuất hoá đơn)"}</span><input id="t-idaddr" className="input" value={idAddr} onChange={(e) => setIdAddr(e.target.value)} placeholder={idType === "passport" ? "VD: địa chỉ phòng đang thuê" : "Nơi thường trú ghi trên CCCD"} /></label>
        <label className="field"><span>Quê quán / thường trú</span><input id="t-home" className="input" value={home} onChange={(e) => setHome(e.target.value)} /></label>

        <div className="field"><span>Đánh dấu khách</span>
          <div className="seg" style={{ gridTemplateColumns: "repeat(3, 1fr)" }} role="group">
            {([[null, "Không"], ["quen", "Khách quen"], ["luu_y", "Cần lưu ý"]] as [Tenant["flag"], string][]).map(([k, l]) => (
              <button type="button" key={String(k)} aria-pressed={flag === k} onClick={() => setFlag(k)}>{l}</button>
            ))}
          </div>
          {flag ? <input id="t-flagnote" className="input" value={flagNote} onChange={(e) => setFlagNote(e.target.value)} placeholder={flag === "luu_y" ? "VD: hay trả tiền trễ, ồn ào" : "VD: thuê lại lần 3"} /> : null}
        </div>

        <div className="field"><span>Đồng ý lưu {ID_NAME[idType]}</span>
          <label className="row" style={{ flexWrap: "nowrap", alignItems: "flex-start" }}>
            <input id="t-consent" type="checkbox" checked={consent} onChange={(e) => setConsent(e.target.checked)} style={{ marginTop: 4 }} />
            <span className="small">Khách đã được thông báo và đồng ý để công ty lưu số và ảnh {ID_NAME[idType]} nhằm quản lý lưu trú, khai báo tạm trú, lập hợp đồng. Dữ liệu chỉ Quản lý và Giám sát của toà xem được.</span>
          </label>
          {consent ? (
            <select id="t-consentnote" className="input" value={consentNote} onChange={(e) => setConsentNote(e.target.value)}>
              {CONSENT_NOTES.map((c) => <option key={c}>{c}</option>)}
            </select>
          ) : <small className="muted">Chưa tích thì chưa tải được ảnh {ID_NAME[idType]} lên.</small>}
        </div>

        <label className="field"><span>Ghi chú</span><textarea id="t-note" className="input" style={{ minHeight: 56 }} value={note} onChange={(e) => setNote(e.target.value)} /></label>
        {err ? <div className="error-box" role="alert">{err}</div> : null}
        <button className="btn block" disabled={busy}>{busy ? "Đang lưu…" : "Lưu"}</button>
      </form>
    </Sheet>
  );
}

/* ---------- Hồ sơ một khách ---------- */
export function TenantDetail() {
  const { id } = useParams();
  const { buildings } = useSession();
  const [t, setT] = useState<Tenant | null>(null);
  const [priv, setPriv] = useState<{ id_number: string | null; id_issued_date: string | null; id_issued_place: string | null; id_address: string | null } | null>(null);
  const [contracts, setContracts] = useState<{ id: string; code: string | null; start_date: string; end_date: string | null; rent_amount: number; status: string; rooms: { code: string } | null }[]>([]);
  const [editing, setEditing] = useState(false);
  const [missing, setMissing] = useState(false);
  const [showId, setShowId] = useState(false);
  const canManage = useCanManage(t?.building_id);

  const load = useCallback(async () => {
    const { data } = await supabase.from("tenants").select(TENANT_COLS).eq("id", id!).maybeSingle();
    if (!data) { setMissing(true); return; }
    setT(data as Tenant);
    const c = await supabase.from("contracts").select("id,code,start_date,end_date,rent_amount,status,rooms(code)").eq("tenant_id", id!).order("start_date", { ascending: false });
    setContracts((c.data as unknown as typeof contracts) ?? []);
    const p = await supabase.rpc("tenant_private", { p_id: id });
    setPriv(((Array.isArray(p.data) ? p.data[0] : p.data) as typeof priv) ?? null);
  }, [id]);
  useEffect(() => { load(); }, [load]);

  if (missing) return (<><TopBar title="Khách thuê" back /><main className="main"><Empty title="Không tìm thấy khách này">Có thể bạn không có quyền xem toà của khách.</Empty></main></>);
  if (!t) return (<><TopBar title="Khách thuê" back /><div className="loading">Đang tải…</div></>);
  const building = buildings.find((b) => b.id === t.building_id);
  const maskId = (s: string) => (showId ? s : s.replace(/[A-Za-z0-9](?=[A-Za-z0-9]{3})/g, "•"));

  return (
    <>
      <TopBar title={t.full_name} back={`/toa/${t.building_id}/khach`} action={canManage ? <button className="tb-action" onClick={() => setEditing(true)}>Sửa</button> : null} />
      <main className="main stack">
        <section className="card" style={{ padding: "14px 16px" }}>
          <div className="row" style={{ gap: 6 }}>
            {t.flag ? <span className={`tag flag-${t.flag}`}>{FLAG_LABEL[t.flag]}</span> : null}
            {contracts.some((c) => c.status === "hieu_luc") ? <span className="tag st-ok">Đang thuê</span> : <span className="tag">Chưa thuê phòng</span>}
            <span className="tag">{building?.code}</span>
          </div>
          {t.flag_note ? <p className="small" style={{ margin: "8px 0 0" }}>{t.flag_note}</p> : null}
          <dl className="kv">
            {t.phone ? <><dt>Điện thoại</dt><dd><a href={`tel:${t.phone}`}>{t.phone}</a></dd></> : null}
            {t.date_of_birth ? <><dt>Ngày sinh</dt><dd>{ddmmyyyy(t.date_of_birth)}</dd></> : null}
            {t.hometown ? <><dt>Quê quán</dt><dd>{t.hometown}</dd></> : null}
            {t.id_type === "passport" ? <><dt>Quốc tịch</dt><dd>{t.nationality ?? "—"} <span className="tag">Khách nước ngoài</span></dd></> : null}
            {canManage && priv?.id_number ? (
              <><dt>Số {ID_NAME[t.id_type ?? "cccd"]}</dt><dd className="num">{maskId(priv.id_number)} <button className="btn ghost sm" onClick={() => setShowId(!showId)}>{showId ? "Ẩn" : "Hiện"}</button></dd></>
            ) : null}
            {canManage && priv?.id_issued_date ? <><dt>Ngày cấp</dt><dd>{ddmmyyyy(priv.id_issued_date)}{priv.id_issued_place ? ` · ${priv.id_issued_place}` : ""}</dd></> : null}
            {canManage && priv?.id_address ? <><dt>{t.id_type === "passport" ? "Địa chỉ" : "Địa chỉ CCCD"}</dt><dd>{priv.id_address}</dd></> : null}
            {t.note ? <><dt>Ghi chú</dt><dd>{t.note}</dd></> : null}
          </dl>
        </section>

        {canManage ? (
          t.cccd_consent_at ? (
            <>
              <FileGallery owner={{ kind: "cccd", buildingId: t.building_id, tenantId: t.id }} title={`Ảnh ${ID_NAME[t.id_type ?? "cccd"]}`} canUpload canDelete pdf={false}
                slots={ID_PHOTOS[t.id_type ?? "cccd"].map((p) => ({ label: p.label, text: p.required ? p.text : `${p.text} (nếu có)` }))}
                hint={`Khách đồng ý lưu ngày ${ddmmyyyy(t.cccd_consent_at)}${t.cccd_consent_note ? ` · ${t.cccd_consent_note}` : ""}. Chỉ Quản lý và Giám sát toà này xem được.`} />
            </>
          ) : (
            <section className="card" style={{ padding: "14px 16px" }}>
              <b>Ảnh {ID_NAME[t.id_type ?? "cccd"]}</b>
              <p className="muted small">Cần ghi nhận khách đồng ý cho lưu {ID_NAME[t.id_type ?? "cccd"]} trước khi tải ảnh lên (quy định bảo vệ dữ liệu cá nhân).</p>
              <button className="btn secondary sm" onClick={() => setEditing(true)}>Ghi nhận đồng ý</button>
            </section>
          )
        ) : null}

        <div className="section-title">Hợp đồng</div>
        {contracts.length === 0 ? <p className="muted small" style={{ margin: 0 }}>Khách chưa có hợp đồng.</p> : (
          <section className="card">
            {contracts.map((c) => (
              <Link key={c.id} className="list-row" to={`/toa/${t.building_id}/hop-dong?mo=${c.id}`} style={{ color: "inherit" }}>
                <div className="grow">
                  <div className="name">Phòng {c.rooms?.code ?? "?"}{c.code ? ` · ${c.code}` : ""}</div>
                  <div className="sub">{ddmmyyyy(c.start_date)} → {c.end_date ? ddmmyyyy(c.end_date) : "không thời hạn"} · {vnd(c.rent_amount)}/tháng</div>
                </div>
                <span className={`tag ${c.status === "hieu_luc" ? "st-ok" : ""}`}>{c.status === "hieu_luc" ? "Hiệu lực" : c.status === "da_ket_thuc" ? "Đã kết thúc" : "Đã huỷ"}</span>
              </Link>
            ))}
          </section>
        )}
      </main>
      {editing ? <TenantSheet buildingId={t.building_id} tenant={t} onClose={() => setEditing(false)} onSaved={() => { setEditing(false); load(); }} /> : null}
    </>
  );
}
