// Dữ liệu cho website phòng trống công khai (/phong). Chỉ gọi các hàm SQL web_* (xem supabase/062_web_phong_trong.sql):
// người chưa đăng nhập không đọc thẳng bảng nào.
import { useEffect, useState } from "react";
import { supabase } from "../lib/supabase";
import { BUCKET } from "../lib/files";
import { tr, type Lang } from "./i18n";

export type WebPhoto = { path: string; store: "supabase" | "r2"; thumb: boolean } | null;
export type WebRoomRow = {
  room_id: string; building_id: string; building_name: string; address: string | null; type_name: string; floor: number | null;
  rent_mode: "thang" | "dem"; list_price: number; max_occupants: number | null; area_m2: number | null; photo: WebPhoto; building_photo: WebPhoto;
};
export type WebFee = { label: string; amount: number; unit: string };
export type WebRoomDetail = {
  room_id: string; status: string; type_name: string; floor: number | null; rent_mode: "thang" | "dem"; list_price: number;
  max_occupants: number | null; area_m2: number | null; room_furniture: string | null;
  building: { id: string; name: string; address: string | null; note: string | null; lat: number | null; lng: number | null };
  fees: WebFee[]; amenities: string[]; furniture: string[]; deposit_lines: string[];
  photos: NonNullable<WebPhoto>[];
  others: { room_id: string; type_name: string; floor: number | null; list_price: number; photo: WebPhoto }[];
};

// ---------- Nội dung website do Quản lý sửa trong app (Quản trị › Cài đặt website, migration 065) ----------
export type WebConfig = {
  eyebrow?: string; title1?: string; title2?: string; subtitle?: string; hero_building?: string;
  hero_media?: { path: string; kind: "image" | "video" }[]; hero_interval?: number;   // trình chiếu đầu trang
  notice_on?: boolean; notice?: string;
  hotline?: string; zalo?: string; email?: string; address?: string; hours?: string; footer_note?: string;
  // Nút Liên hệ và khung nhắn tin (public/lien-he.js, migration 096)
  contact_on?: boolean; chat_on?: boolean; contact_title?: string; contact_hours?: string; chat_greeting?: string;
  messenger?: string; hotline_label?: string; hotline2?: string; hotline2_label?: string;
  show_features?: boolean; show_buildings?: boolean; show_app?: boolean; show_brands?: boolean;
  seo_title?: string; seo_desc?: string;
  // Bản tiếng Anh (/en/phong, migration 098): để trống thì dùng chữ mặc định tiếng Anh
  eyebrow_en?: string; title1_en?: string; title2_en?: string; subtitle_en?: string; notice_en?: string; footer_note_en?: string; seo_title_en?: string; seo_desc_en?: string;
  hidden_buildings?: string[]; hidden_rooms?: string[];   // chỉ có ở trang cài đặt, web công khai không nhận
};
/** Chữ mặc định khi Quản lý để trống */
export const WEB_DEFAULTS = {
  eyebrow: "Căn hộ dịch vụ · TP.HCM",
  title1: "Sống tiện nghi,",
  title2: "dọn vào là ở.",
  subtitle: "Phòng và căn hộ dịch vụ ở trung tâm TP.HCM. Trống thật, cập nhật theo giờ.",
  footer_note: "Phòng và căn hộ dịch vụ ở trung tâm TP.HCM.",
  seo_title: "Next Living · Phòng và căn hộ dịch vụ TP.HCM",
  seo_desc: "Xem phòng trống, giá thuê, ảnh phòng và đặt lịch xem phòng Next Living tại TP.HCM.",
};
export const WEB_DEFAULTS_EN: Record<keyof typeof WEB_DEFAULTS, string> = {
  eyebrow: "Serviced apartments · Ho Chi Minh City",
  title1: "Comfortable living,",
  title2: "ready to move in.",
  subtitle: "Rooms and serviced apartments in central Ho Chi Minh City. Truly available, updated hourly.",
  footer_note: "Rooms and serviced apartments in central Ho Chi Minh City.",
  seo_title: "Next Living · Rooms and serviced apartments in Ho Chi Minh City",
  seo_desc: "See available rooms, prices and photos, and book a viewing with Next Living in Ho Chi Minh City.",
};
type TextKey = keyof typeof WEB_DEFAULTS;

let cfg: WebConfig = {};
let loaded: Promise<void> | null = null;
const subs = new Set<() => void>();
const emit = () => subs.forEach((f) => f());
/** Đọc nội dung hiện tại (dùng trong component con; WebApp gọi useWebConfig để vẽ lại khi đổi) */
export const webCfg = () => cfg;
export const webText = (k: TextKey, lang: Lang = "vi") =>
  lang === "en" ? (cfg[`${k}_en` as keyof WebConfig] as string | undefined) || WEB_DEFAULTS_EN[k] : cfg[k] || WEB_DEFAULTS[k];
/** Thông báo đầu trang theo ngôn ngữ (bản tiếng Anh không có thì không hiện) */
export const webNotice = (lang: Lang) => (cfg.notice_on ? (lang === "en" ? cfg.notice_en : cfg.notice) || null : null);
export const webShow = (k: "show_features" | "show_buildings" | "show_app" | "show_brands") => cfg[k] !== false;

/** Tải nội dung website một lần. Trong khung xem trước của trang cài đặt (?xem=thu), nhận bản nháp từ trang cha. */
export function useWebConfig(): WebConfig {
  const [, force] = useState(0);
  useEffect(() => {
    const f = () => force((n) => n + 1);
    subs.add(f);
    loaded ??= Promise.resolve(supabase.rpc("web_config")).then(({ data }) => {
      if (data && typeof data === "object" && !Object.keys(cfg).length) { cfg = data as WebConfig; emit(); }
    }).catch(() => {});
    const preview = window.parent !== window && new URLSearchParams(location.search).get("xem") === "thu";
    const onMsg = (e: MessageEvent) => {
      if (e.origin !== location.origin || e.source !== window.parent) return;
      const d = e.data as { type?: string; cfg?: WebConfig };
      if (d?.type === "nl-web-preview" && d.cfg && typeof d.cfg === "object") { cfg = d.cfg; emit(); }
    };
    if (preview) { window.addEventListener("message", onMsg); window.parent.postMessage({ type: "nl-web-ready" }, location.origin); }
    return () => { subs.delete(f); if (preview) window.removeEventListener("message", onMsg); };
  }, []);
  return cfg;
}

export function useWebRooms() {
  const [rooms, setRooms] = useState<WebRoomRow[] | null>(null);
  const [err, setErr] = useState<string | null>(null);
  useEffect(() => {
    supabase.rpc("web_rooms").then(({ data, error }) => {
      if (error) setErr("load_err");
      else setRooms(((data ?? []) as WebRoomRow[]).map((r) => ({ ...r, list_price: Number(r.list_price) })));
    });
  }, []);
  return { rooms, err };
}

// ---------- Ảnh ----------
let r2Base: Promise<string | null> | null = null;
function publicBase(): Promise<string | null> {
  r2Base ??= supabase.functions.invoke("web-cau-hinh", { method: "GET" })
    .then(({ data }) => (data as { publicBase?: string | null } | null)?.publicBase ?? null)
    .catch(() => null);
  return r2Base;
}
const thumbOf = (p: string) => p.replace(/\.[a-z0-9]+$/i, "") + "_t.jpg";

/** Link xem cho danh sách ảnh (giữ thứ tự). Ảnh ở kho Supabase: link ký 1 giờ; ảnh ở R2: địa chỉ công khai. */
export async function photoUrls(list: WebPhoto[], size: "thumb" | "full"): Promise<(string | null)[]> {
  const out: (string | null)[] = list.map(() => null);
  const sb = list.map((p, i) => ({ p, i })).filter((x) => x.p && x.p.store !== "r2");
  const r2 = list.map((p, i) => ({ p, i })).filter((x) => x.p && x.p.store === "r2");
  if (sb.length) {
    const { data } = await supabase.storage.from(BUCKET).createSignedUrls(sb.map((x) => x.p!.path), 3600);
    (data ?? []).forEach((d, k) => { if (d.signedUrl) out[sb[k].i] = d.signedUrl; });
  }
  if (r2.length) {
    const base = await publicBase();
    if (base) r2.forEach((x) => { const key = size === "thumb" && x.p!.thumb ? thumbOf(x.p!.path) : x.p!.path; out[x.i] = `${base}/${key}`; });
  }
  return out;
}

export function usePhotoUrls(list: WebPhoto[] | null, size: "thumb" | "full") {
  const [urls, setUrls] = useState<(string | null)[]>([]);
  const key = (list ?? []).map((p) => p?.path ?? "").join("|");
  useEffect(() => {
    if (!list) return;
    let alive = true;
    photoUrls(list, size).then((u) => { if (alive) setUrls(u); }).catch(() => { /* ảnh lỗi thì hiện khung trống */ });
    return () => { alive = false; };
  }, [key, size]); // eslint-disable-line react-hooks/exhaustive-deps
  return urls;
}

// ---------- Mã giới thiệu CTV (?ctv=ABC123) ----------
const REF_KEY = "nl_ref";
/** Đọc ?ctv= trên địa chỉ và nhớ 30 ngày, để khách quay lại đặt lịch vẫn ghi đúng người giới thiệu. */
export function currentRef(): string | null {
  try {
    const q = new URLSearchParams(window.location.search).get("ctv");
    if (q && /^[A-Za-z0-9]{6}$/.test(q)) {
      localStorage.setItem(REF_KEY, JSON.stringify({ code: q.toUpperCase(), at: Date.now() }));
      return q.toUpperCase();
    }
    const saved = JSON.parse(localStorage.getItem(REF_KEY) ?? "null") as { code: string; at: number } | null;
    if (saved && Date.now() - saved.at < 30 * 86400000) return saved.code;
  } catch { /* trình duyệt chặn lưu trữ: bỏ qua */ }
  return null;
}

// ---------- Hiển thị ----------
export const floorText = (f: number | null, lang: Lang = "vi") => (f == null ? "" : f <= 0 ? tr(lang, "ground") : tr(lang, "floor", { n: f }));
export const perText = (m: "thang" | "dem", lang: Lang = "vi") => tr(lang, m === "dem" ? "per_night" : "per_month");
/** Nhóm loại phòng để lọc: Studio, 1 phòng ngủ, Duplex, Phòng tiêu chuẩn, Mặt bằng, Khác */
export function typeGroup(name: string): string {
  const s = name.toLowerCase();
  if (s.includes("duplex")) return "Duplex";
  if (s.includes("1pn") || s.includes("1 pn") || s.includes("phòng ngủ")) return "1 phòng ngủ";
  if (s.includes("studio")) return "Studio";
  if (s.includes("mặt bằng")) return "Mặt bằng";
  if (s.includes("tiêu chuẩn") || s.includes("phòng trọ")) return "Phòng tiêu chuẩn";
  return "Khác";
}
const GROUP_KEY = { "Duplex": "grp_duplex", "1 phòng ngủ": "grp_1pn", "Studio": "grp_studio", "Mặt bằng": "grp_mb", "Phòng tiêu chuẩn": "grp_std", "Khác": "grp_other" } as const;
/** Tên nhóm loại phòng theo ngôn ngữ (khoá lọc vẫn là tên tiếng Việt) */
export const groupLabel = (g: string, lang: Lang) => tr(lang, GROUP_KEY[g as keyof typeof GROUP_KEY] ?? "grp_other");
/** Địa chỉ ngắn trên thẻ: bỏ phần trong ngoặc */
export const shortAddr = (a: string | null) => (a ?? "").replace(/\s*\(.*?\)\s*/g, " ").trim();

/** Giá theo đơn vị trong chính sách toà: điện / kWh, nước / người, dịch vụ / tháng, xe / chiếc */
export function feeOf(fees: WebFee[], kind: "dien" | "nuoc" | "dich_vu" | "xe"): number | null {
  const f = fees.find((x) => {
    const l = (x.label ?? "").toLowerCase(), u = (x.unit ?? "").toLowerCase();
    if (kind === "dien") return l.startsWith("điện") && ["kwh", "kw", "số"].includes(u);
    if (kind === "nuoc") return l.startsWith("nước") && ["người", "nguoi"].includes(u);
    if (kind === "dich_vu") return l.startsWith("dịch vụ") && ["tháng", "thang", "phòng"].includes(u);
    return l.startsWith("xe") && ["chiếc", "xe", "chiec"].includes(u);
  });
  return f ? Number(f.amount) : null;
}
