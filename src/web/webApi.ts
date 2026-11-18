// Dữ liệu cho website phòng trống công khai (/phong). Chỉ gọi các hàm SQL web_* (xem supabase/062_web_phong_trong.sql):
// người chưa đăng nhập không đọc thẳng bảng nào.
import { useEffect, useState } from "react";
import { supabase } from "../lib/supabase";
import { BUCKET } from "../lib/files";

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

/** Liên hệ hiện trên web. Để trống thì không hiện nút đó. Sửa ở đây khi công ty có số hotline / Zalo / email. */
export const CONTACT = { hotline: "", zalo: "", email: "" };

export function useWebRooms() {
  const [rooms, setRooms] = useState<WebRoomRow[] | null>(null);
  const [err, setErr] = useState<string | null>(null);
  useEffect(() => {
    supabase.rpc("web_rooms").then(({ data, error }) => {
      if (error) setErr("Chưa tải được danh sách phòng. Thử tải lại trang.");
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
export const floorText = (f: number | null) => (f == null ? "" : f <= 0 ? "Tầng trệt" : `Tầng ${f}`);
export const perText = (m: "thang" | "dem") => (m === "dem" ? "/đêm" : "/tháng");
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
