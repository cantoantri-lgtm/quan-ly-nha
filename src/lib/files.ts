import { supabase } from "./supabase";

export const BUCKET = "kho-tai-lieu";
export type FileKind = "cccd" | "hop_dong" | "anh_phong" | "anh_loai_phong" | "anh_toa" | "dinh_kem_de_nghi";

export type StoredFile = {
  id: string; kind: FileKind; path: string; file_name: string | null; mime_type: string | null; size_bytes: number | null;
  building_id: string | null; tenant_id: string | null; contract_id: string | null; room_id: string | null; room_type_id: string | null; request_id: string | null;
  label: string | null; is_cover: boolean; created_by: string | null; created_at: string;
  /** Tệp nằm ở đâu: kho Supabase (tệp cũ) hay Cloudflare R2 (tệp mới) */
  store: "supabase" | "r2";
  /** Có ảnh nhỏ <đường dẫn>_t.jpg để hiện danh sách nhanh */
  thumb: boolean;
};

/** Thư mục gốc trong kho theo loại tệp. Mã chủ = mã toà (hoặc mã đề nghị với đính kèm đề nghị). */
const FOLDER: Record<FileKind, string> = { cccd: "cccd", hop_dong: "hop-dong", anh_phong: "anh-phong", anh_loai_phong: "anh-phong", anh_toa: "anh-toa", dinh_kem_de_nghi: "de-nghi" };

/** Liên kết của tệp với đối tượng */
export type FileOwner =
  | { kind: "cccd"; buildingId: string; tenantId: string }
  | { kind: "hop_dong"; buildingId: string; contractId: string }
  | { kind: "anh_phong"; buildingId: string; roomId: string }
  | { kind: "anh_loai_phong"; buildingId: string; roomTypeId: string }
  | { kind: "anh_toa"; buildingId: string }
  | { kind: "dinh_kem_de_nghi"; requestId: string };

const ownerFolder = (o: FileOwner) => (o.kind === "dinh_kem_de_nghi" ? o.requestId : o.buildingId);
const ownerColumn = (o: FileOwner): Record<string, string> =>
  o.kind === "cccd" ? { tenant_id: o.tenantId } : o.kind === "hop_dong" ? { contract_id: o.contractId }
  : o.kind === "anh_phong" ? { room_id: o.roomId } : o.kind === "anh_loai_phong" ? { room_type_id: o.roomTypeId } : o.kind === "anh_toa" ? { building_id: o.buildingId } : { request_id: o.requestId };

export const MAX_BYTES = 10 * 1024 * 1024;
const THUMB_EDGE = 480;

/** Vẽ ảnh về JPEG với cạnh dài tối đa `maxEdge` */
async function renderJpeg(file: Blob, maxEdge: number, quality: number): Promise<Blob | null> {
  const bmp = await createImageBitmap(file, { imageOrientation: "from-image" });
  const scale = Math.min(1, maxEdge / Math.max(bmp.width, bmp.height));
  const w = Math.round(bmp.width * scale), h = Math.round(bmp.height * scale);
  const canvas = document.createElement("canvas");
  canvas.width = w; canvas.height = h;
  canvas.getContext("2d")!.drawImage(bmp, 0, 0, w, h);
  bmp.close?.();
  return new Promise((res) => canvas.toBlob(res, "image/jpeg", quality));
}

/** Thu nhỏ ảnh chụp từ điện thoại (thường 3–8 MB) xuống cạnh dài 1800px, JPEG 0,82. PDF giữ nguyên. */
export async function prepareFile(file: File): Promise<File> {
  if (file.type === "application/pdf") return file;
  if (!file.type.startsWith("image/")) throw new Error("Chỉ nhận ảnh (JPG, PNG, WebP) hoặc PDF.");
  try {
    const blob = await renderJpeg(file, 1800, 0.82);
    if (blob && blob.size < file.size) return new File([blob], file.name.replace(/\.\w+$/, "") + ".jpg", { type: "image/jpeg" });
  } catch { /* trình duyệt không đọc được định dạng (VD HEIC) → gửi nguyên bản nếu đủ nhẹ */ }
  if (!/^image\/(jpeg|png|webp)$/.test(file.type)) throw new Error("Định dạng ảnh này chưa hỗ trợ. Hãy chụp lại ở chế độ JPG hoặc chụp ảnh màn hình.");
  return file;
}

/** Ảnh nhỏ (cạnh dài 480px, ~30–60 KB) cho danh sách; null nếu không tạo được */
async function makeThumb(file: File): Promise<Blob | null> {
  if (!file.type.startsWith("image/")) return null;
  try { return await renderJpeg(file, THUMB_EDGE, 0.7); } catch { return null; }
}

const thumbPath = (path: string) => path.replace(/\.[a-z]+$/, "_t.jpg");

// ---------- Đóng dấu ngày giờ + vị trí lên ảnh chụp ----------
export type Geo = { lat: number; lng: number; accuracy: number } | null;

/** Lấy vị trí hiện tại (cần người dùng cho phép); null nếu không lấy được */
export function getGeo(timeoutMs = 10000): Promise<Geo> {
  return new Promise((res) => {
    if (typeof navigator === "undefined" || !navigator.geolocation) { res(null); return; }
    navigator.geolocation.getCurrentPosition(
      (p) => res({ lat: p.coords.latitude, lng: p.coords.longitude, accuracy: Math.round(p.coords.accuracy) }),
      () => res(null),
      { enableHighAccuracy: true, timeout: timeoutMs, maximumAge: 30000 },
    );
  });
}

const stampTime = (d: Date) => d.toLocaleString("vi-VN", { timeZone: "Asia/Ho_Chi_Minh", hour12: false, day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit" });

/** Vẽ dải chữ "ngày giờ · vị trí" ở đáy ảnh và trả JPEG (cạnh dài tối đa 1800px). Dấu nằm trong chính ảnh nên không bỏ đi được. */
export async function stampPhoto(raw: File, geo: Geo, at: Date = new Date()): Promise<File> {
  const bmp = await createImageBitmap(raw, { imageOrientation: "from-image" });
  const scale = Math.min(1, 1800 / Math.max(bmp.width, bmp.height));
  const w = Math.round(bmp.width * scale), h = Math.round(bmp.height * scale);
  const canvas = document.createElement("canvas");
  canvas.width = w; canvas.height = h;
  const ctx = canvas.getContext("2d")!;
  ctx.drawImage(bmp, 0, 0, w, h);
  bmp.close?.();
  const fs = Math.max(14, Math.round(w / 38));
  const lines = [
    stampTime(at) + " (GMT+7)",
    geo ? `Vị trí: ${geo.lat.toFixed(6)}, ${geo.lng.toFixed(6)} (±${geo.accuracy} m)` : "Vị trí: không lấy được",
  ];
  const pad = Math.round(fs * 0.5), boxH = lines.length * fs * 1.25 + pad * 2;
  ctx.fillStyle = "rgba(0,0,0,0.55)";
  ctx.fillRect(0, h - boxH, w, boxH);
  ctx.fillStyle = "#fff";
  ctx.font = `600 ${fs}px system-ui, -apple-system, "Segoe UI", sans-serif`;
  ctx.textBaseline = "top";
  lines.forEach((t, i) => ctx.fillText(t, pad, h - boxH + pad + i * fs * 1.25, w - pad * 2));
  const blob: Blob | null = await new Promise((r) => canvas.toBlob(r, "image/jpeg", 0.85));
  if (!blob) throw new Error("Không xử lý được ảnh.");
  return new File([blob], raw.name.replace(/\.\w+$/, "") + ".jpg", { type: "image/jpeg" });
}

// ---------- Cloudflare R2 (qua Edge Function kho-anh) ----------
type R2Config = { enabled: boolean; publicBase: string | null };
let r2cache: R2Config | null = null;

/** Kho R2 đã được cấu hình chưa. Chỉ nhớ kết quả khi hỏi thành công, để cấu hình xong là dùng ngay. */
export async function r2Config(): Promise<R2Config> {
  if (r2cache) return r2cache;
  try {
    const { data, error } = await supabase.functions.invoke("kho-anh", { body: { action: "config" } });
    if (!error && data) { r2cache = data as R2Config; return r2cache; }
  } catch { /* bỏ qua */ }
  return { enabled: false, publicBase: null };
}

async function fnError(error: unknown, fallback: string): Promise<string> {
  try {
    const ctx = (error as { context?: Response }).context;
    if (ctx && typeof ctx.json === "function") { const j = await ctx.json(); if (j?.error) return String(j.error); }
  } catch { /* bỏ qua */ }
  return fallback;
}

async function r2Call<T>(body: Record<string, unknown>): Promise<T> {
  const { data, error } = await supabase.functions.invoke("kho-anh", { body });
  if (error) throw new Error(await fnError(error, "Không kết nối được kho ảnh"));
  return data as T;
}

async function r2Delete(paths: string[]): Promise<void> {
  try { await r2Call({ action: "delete", paths }); } catch { /* tệp mồ côi nhỏ, không chặn thao tác */ }
}

async function uploadR2(owner: FileOwner, raw: File, file: File, extra: { label?: string; is_cover?: boolean }): Promise<StoredFile> {
  const ext = file.type === "application/pdf" ? "pdf" : file.type === "image/png" ? "png" : file.type === "image/webp" ? "webp" : "jpg";
  const path = `${FOLDER[owner.kind]}/${ownerFolder(owner)}/${crypto.randomUUID()}.${ext}`;
  const thumb = await makeThumb(file);
  const tPath = thumbPath(path);
  const items = [{ path, contentType: file.type }, ...(thumb ? [{ path: tPath, contentType: "image/jpeg" }] : [])];

  // 1) xin link tải lên (một lần gọi cho cả ảnh và ảnh nhỏ) 2) tải THẲNG lên R2, song song
  const { urls } = await r2Call<{ urls: Record<string, { url: string; headers: Record<string, string> }> }>({ action: "put", items });
  await Promise.all(items.map(async (it) => {
    const u = urls[it.path];
    const res = await fetch(u.url, { method: "PUT", headers: u.headers, body: it.path === path ? file : thumb! });
    if (!res.ok) throw new Error(`R2 từ chối tải lên (${res.status})`);
  }));

  const { data, error } = await supabase.from("files").insert({
    kind: owner.kind, path, file_name: raw.name.slice(0, 120), mime_type: file.type, size_bytes: file.size,
    store: "r2", thumb: !!thumb, ...ownerColumn(owner), ...extra,
  }).select("*").single();
  if (error) {
    await r2Delete(items.map((i) => i.path));   // không để tệp mồ côi
    throw new Error(error.message);
  }
  return data as StoredFile;
}

async function uploadSupabase(owner: FileOwner, raw: File, file: File, extra: { label?: string; is_cover?: boolean }): Promise<StoredFile> {
  const ext = file.type === "application/pdf" ? "pdf" : file.type === "image/png" ? "png" : file.type === "image/webp" ? "webp" : "jpg";
  const path = `${FOLDER[owner.kind]}/${ownerFolder(owner)}/${crypto.randomUUID()}.${ext}`;
  const up = await supabase.storage.from(BUCKET).upload(path, file, { contentType: file.type, upsert: false });
  if (up.error) throw new Error(/row-level security|not authorized|policy/i.test(up.error.message) ? "Bạn không có quyền tải tệp này lên." : up.error.message);
  const { data, error } = await supabase.from("files").insert({
    kind: owner.kind, path, file_name: raw.name.slice(0, 120), mime_type: file.type, size_bytes: file.size, ...ownerColumn(owner), ...extra,
  }).select("*").single();
  if (error) {
    await supabase.storage.from(BUCKET).remove([path]);   // không để tệp mồ côi
    throw new Error(error.message);
  }
  return data as StoredFile;
}

export async function uploadFile(owner: FileOwner, raw: File, extra: { label?: string; is_cover?: boolean } = {}): Promise<StoredFile> {
  const file = await prepareFile(raw);
  if (file.size > MAX_BYTES) throw new Error("Tệp lớn hơn 10 MB. Hãy chụp lại hoặc nén nhỏ hơn.");
  const cfg = await r2Config();
  if (cfg.enabled) {
    try { return await uploadR2(owner, raw, file, extra); }
    catch (e) {
      // Không có quyền thì dừng; lỗi mạng / R2 thì dự phòng bằng kho Supabase để việc nhập liệu không bị gián đoạn
      if (e instanceof Error && /quyền/.test(e.message)) throw e;
      console.warn("Tải lên R2 lỗi, dùng kho Supabase:", e);
    }
  }
  return uploadSupabase(owner, raw, file, extra);
}

export async function listFiles(kind: FileKind, column: "building_id" | "tenant_id" | "contract_id" | "room_id" | "room_type_id" | "request_id", id: string): Promise<StoredFile[]> {
  const { data } = await supabase.from("files").select("*").eq("kind", kind).eq(column, id).order("created_at");
  return (data as StoredFile[]) ?? [];
}

/** Đường dẫn xem tạm của kho Supabase (hết hạn sau 10 phút) */
export async function signedUrls(paths: string[]): Promise<Record<string, string>> {
  if (!paths.length) return {};
  const { data } = await supabase.storage.from(BUCKET).createSignedUrls(paths, 600);
  const m: Record<string, string> = {};
  (data ?? []).forEach((d) => { if (d.path && d.signedUrl) m[d.path] = d.signedUrl; });
  return m;
}

/**
 * Link xem cho một nhóm tệp, khoá theo mã tệp.
 *  - Ảnh phòng / ảnh toà trên R2: địa chỉ công khai (qua mạng Cloudflare, không cần gọi máy chủ).
 *  - Tệp riêng tư trên R2: link ký tạm 10 phút, ký cả nhóm trong MỘT lần gọi.
 *  - Tệp cũ ở Supabase: link ký tạm như trước.
 * size "thumb" dùng ảnh nhỏ nếu có (danh sách), "full" dùng ảnh gốc (xem to).
 */
export async function fileUrls(files: StoredFile[], size: "thumb" | "full"): Promise<Record<string, string>> {
  const out: Record<string, string> = {};
  const old = files.filter((f) => f.store !== "r2");
  const r2 = files.filter((f) => f.store === "r2");

  const jobs: Promise<void>[] = [];
  if (old.length) {
    jobs.push(signedUrls(old.map((f) => f.path)).then((m) => { old.forEach((f) => { if (m[f.path]) out[f.id] = m[f.path]; }); }));
  }
  if (r2.length) {
    jobs.push((async () => {
      const cfg = await r2Config();
      const toSign: { f: StoredFile; key: string }[] = [];
      for (const f of r2) {
        const key = size === "thumb" && f.thumb ? thumbPath(f.path) : f.path;
        if ((key.startsWith("anh-phong/") || key.startsWith("anh-toa/")) && cfg.publicBase) out[f.id] = `${cfg.publicBase}/${key}`;
        else toSign.push({ f, key });
      }
      for (let i = 0; i < toSign.length; i += 100) {
        const chunk = toSign.slice(i, i + 100);
        const { urls } = await r2Call<{ urls: Record<string, string> }>({ action: "get", paths: chunk.map((c) => c.key) });
        chunk.forEach((c) => { if (urls[c.key]) out[c.f.id] = urls[c.key]; });
      }
    })().catch(() => { /* không lấy được link thì ảnh hiện khung trống, không làm hỏng cả trang */ }));
  }
  await Promise.all(jobs);
  return out;
}

export async function removeFile(f: StoredFile): Promise<void> {
  const { error } = await supabase.from("files").delete().eq("id", f.id);
  if (error) throw new Error(error.message);
  if (f.store === "r2") await r2Delete([f.path, ...(f.thumb ? [thumbPath(f.path)] : [])]);
  else await supabase.storage.from(BUCKET).remove([f.path]);
}

// ---------- Ảnh đính kèm phản ánh (khách hàng / CTV / nhân sự) ----------
export type FeedbackAttachment = {
  id: string; thread_id: string; message_id: string; path: string; file_name: string | null; mime_type: string | null;
  store: "supabase" | "r2"; thumb: boolean;
};
export const MAX_FEEDBACK_IMAGES = 4;

/** Tải một ảnh lên kho (R2, dự phòng Supabase) cho phản ánh rồi gắn vào tin nhắn. Quyền do Postgres quyết định. */
export async function attachFeedbackImage(threadId: string, messageId: string, raw: File): Promise<void> {
  if (!raw.type.startsWith("image/")) throw new Error("Chỉ đính kèm ảnh.");
  const file = await stampPhoto(raw, await getGeo());
  if (file.size > MAX_BYTES) throw new Error("Ảnh lớn hơn 10 MB.");
  const ext = file.type === "image/png" ? "png" : file.type === "image/webp" ? "webp" : "jpg";
  const path = `phan-anh/${threadId}/${crypto.randomUUID()}.${ext}`;
  let store: "r2" | "supabase" = "supabase";
  let thumbOk = false;
  const cfg = await r2Config();
  if (cfg.enabled) {
    try {
      const thumb = await makeThumb(file);
      const items = [{ path, contentType: file.type }, ...(thumb ? [{ path: thumbPath(path), contentType: "image/jpeg" }] : [])];
      const { urls } = await r2Call<{ urls: Record<string, { url: string; headers: Record<string, string> }> }>({ action: "put", items });
      await Promise.all(items.map(async (it) => {
        const u = urls[it.path];
        const res = await fetch(u.url, { method: "PUT", headers: u.headers, body: it.path === path ? file : thumb! });
        if (!res.ok) throw new Error(`R2 từ chối tải lên (${res.status})`);
      }));
      store = "r2"; thumbOk = !!thumb;
    } catch (e) {
      if (e instanceof Error && /quyền/.test(e.message)) throw e;
      console.warn("Tải ảnh phản ánh lên R2 lỗi, dùng kho Supabase:", e);
    }
  }
  if (store === "supabase") {
    const up = await supabase.storage.from(BUCKET).upload(path, file, { contentType: file.type, upsert: false });
    if (up.error) throw new Error(/row-level security|not authorized|policy/i.test(up.error.message) ? "Bạn không có quyền tải ảnh này lên." : up.error.message);
  }
  const { error } = await supabase.rpc("feedback_attach", {
    p_message: messageId, p_path: path, p_name: raw.name, p_mime: file.type, p_size: file.size, p_store: store, p_thumb: thumbOk,
  });
  if (error) throw new Error(error.message);
}

/** Link xem ảnh đính kèm, khoá theo mã đính kèm */
export function attachmentUrls(list: FeedbackAttachment[], size: "thumb" | "full"): Promise<Record<string, string>> {
  return fileUrls(list.map((a) => ({ id: a.id, path: a.path, store: a.store, thumb: a.thumb } as StoredFile)), size);
}

// ---------- Ảnh đồng hồ điện nước của khách (dong-ho/<mã khách>/...) ----------
export type MeterPhoto = { path: string; store: "r2" | "supabase"; thumb: boolean; mime: string; base64: string; geo: Geo; takenAt: string };

/** Thu nhỏ ảnh, tải lên kho (R2, dự phòng Supabase) và trả lại ảnh dạng base64 nhỏ để đọc số tự động. Quyền do Postgres quyết định. */
export async function uploadMeterPhoto(customerId: string, raw: File): Promise<MeterPhoto> {
  if (!raw.type.startsWith("image/")) throw new Error("Chỉ nhận ảnh.");
  const geo = await getGeo();
  if (!geo) throw new Error("Không lấy được vị trí. Hãy cho phép định vị (GPS) cho trang web rồi chụp lại.");
  const takenAt = new Date();
  const file = await stampPhoto(raw, geo, takenAt);
  if (file.size > MAX_BYTES) throw new Error("Ảnh lớn hơn 10 MB.");
  const ext = "jpg";
  const path = `dong-ho/${customerId}/${crypto.randomUUID()}.${ext}`;
  let store: "r2" | "supabase" = "supabase";
  let thumbOk = false;
  const cfg = await r2Config();
  if (cfg.enabled) {
    try {
      const thumb = await makeThumb(file);
      const items = [{ path, contentType: file.type }, ...(thumb ? [{ path: thumbPath(path), contentType: "image/jpeg" }] : [])];
      const { urls } = await r2Call<{ urls: Record<string, { url: string; headers: Record<string, string> }> }>({ action: "put", items });
      await Promise.all(items.map(async (it) => {
        const u = urls[it.path];
        const res = await fetch(u.url, { method: "PUT", headers: u.headers, body: it.path === path ? file : thumb! });
        if (!res.ok) throw new Error(`R2 từ chối tải lên (${res.status})`);
      }));
      store = "r2"; thumbOk = !!thumb;
    } catch (e) {
      if (e instanceof Error && /quyền/.test(e.message)) throw e;
      console.warn("Tải ảnh đồng hồ lên R2 lỗi, dùng kho Supabase:", e);
    }
  }
  if (store === "supabase") {
    const up = await supabase.storage.from(BUCKET).upload(path, file, { contentType: file.type, upsert: false });
    if (up.error) throw new Error(/row-level security|not authorized|policy/i.test(up.error.message) ? "Bạn không có quyền tải ảnh này lên." : up.error.message);
  }
  // Ảnh nhỏ (cạnh dài 1280px) để gửi đọc số, nhẹ hơn ảnh gốc
  const small = await renderJpeg(file, 1280, 0.8).catch(() => null);
  const blob: Blob = small ?? file;
  const base64: string = await new Promise((res, rej) => {
    const fr = new FileReader();
    fr.onload = () => res(String(fr.result).split(",")[1] ?? "");
    fr.onerror = () => rej(fr.error);
    fr.readAsDataURL(blob);
  });
  return { path, store, thumb: thumbOk, mime: small ? "image/jpeg" : file.type, base64, geo, takenAt: takenAt.toISOString() };
}

export type MeterReading = {
  id: string; customer_id: string; kind: "dien" | "nuoc"; reading: number; read_on: string;
  photo_path: string; photo_store: "r2" | "supabase"; photo_thumb: boolean; source: "khach" | "nhan_vien";
  ocr_value: number | null; note: string | null; statement_bill_id: string | null; created_at: string;
  lat: number | null; lng: number | null; geo_accuracy: number | null; taken_at: string | null;
};
export function meterPhotoUrls(list: MeterReading[], size: "thumb" | "full"): Promise<Record<string, string>> {
  // Dữ liệu mẫu không có ảnh thật (đường dẫn không nằm trong dong-ho/)
  return fileUrls(list.filter((m) => m.photo_path.startsWith("dong-ho/")).map((m) => ({ id: m.id, path: m.photo_path, store: m.photo_store, thumb: m.photo_thumb } as StoredFile)), size);
}
