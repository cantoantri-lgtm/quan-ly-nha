import { supabase } from "./supabase";

export const BUCKET = "kho-tai-lieu";
export type FileKind = "cccd" | "hop_dong" | "anh_phong" | "dinh_kem_de_nghi";

export type StoredFile = {
  id: string; kind: FileKind; path: string; file_name: string | null; mime_type: string | null; size_bytes: number | null;
  building_id: string | null; tenant_id: string | null; contract_id: string | null; room_id: string | null; request_id: string | null;
  label: string | null; is_cover: boolean; created_by: string | null; created_at: string;
};

/** Thư mục gốc trong kho theo loại tệp. Mã chủ = mã toà (hoặc mã đề nghị với đính kèm đề nghị). */
const FOLDER: Record<FileKind, string> = { cccd: "cccd", hop_dong: "hop-dong", anh_phong: "anh-phong", dinh_kem_de_nghi: "de-nghi" };

/** Liên kết của tệp với đối tượng */
export type FileOwner =
  | { kind: "cccd"; buildingId: string; tenantId: string }
  | { kind: "hop_dong"; buildingId: string; contractId: string }
  | { kind: "anh_phong"; buildingId: string; roomId: string }
  | { kind: "dinh_kem_de_nghi"; requestId: string };

const ownerFolder = (o: FileOwner) => (o.kind === "dinh_kem_de_nghi" ? o.requestId : o.buildingId);
const ownerColumn = (o: FileOwner): Record<string, string> =>
  o.kind === "cccd" ? { tenant_id: o.tenantId } : o.kind === "hop_dong" ? { contract_id: o.contractId }
  : o.kind === "anh_phong" ? { room_id: o.roomId } : { request_id: o.requestId };

export const MAX_BYTES = 10 * 1024 * 1024;

/** Thu nhỏ ảnh chụp từ điện thoại (thường 3–8 MB) xuống cạnh dài 1800px, JPEG 0,82. PDF giữ nguyên. */
export async function prepareFile(file: File): Promise<File> {
  if (file.type === "application/pdf") return file;
  if (!file.type.startsWith("image/")) throw new Error("Chỉ nhận ảnh (JPG, PNG, WebP) hoặc PDF.");
  try {
    const bmp = await createImageBitmap(file, { imageOrientation: "from-image" });
    const scale = Math.min(1, 1800 / Math.max(bmp.width, bmp.height));
    const w = Math.round(bmp.width * scale), h = Math.round(bmp.height * scale);
    const canvas = document.createElement("canvas");
    canvas.width = w; canvas.height = h;
    canvas.getContext("2d")!.drawImage(bmp, 0, 0, w, h);
    bmp.close?.();
    const blob: Blob | null = await new Promise((res) => canvas.toBlob(res, "image/jpeg", 0.82));
    if (blob && blob.size < file.size) return new File([blob], file.name.replace(/\.\w+$/, "") + ".jpg", { type: "image/jpeg" });
  } catch { /* trình duyệt không đọc được định dạng (VD HEIC) → gửi nguyên bản nếu đủ nhẹ */ }
  if (!/^image\/(jpeg|png|webp)$/.test(file.type)) throw new Error("Định dạng ảnh này chưa hỗ trợ. Hãy chụp lại ở chế độ JPG hoặc chụp ảnh màn hình.");
  return file;
}

export async function uploadFile(owner: FileOwner, raw: File, extra: { label?: string; is_cover?: boolean } = {}): Promise<StoredFile> {
  const file = await prepareFile(raw);
  if (file.size > MAX_BYTES) throw new Error("Tệp lớn hơn 10 MB. Hãy chụp lại hoặc nén nhỏ hơn.");
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

export async function listFiles(kind: FileKind, column: "tenant_id" | "contract_id" | "room_id" | "request_id", id: string): Promise<StoredFile[]> {
  const { data } = await supabase.from("files").select("*").eq("kind", kind).eq(column, id).order("created_at");
  return (data as StoredFile[]) ?? [];
}

/** Đường dẫn xem tạm (hết hạn sau 10 phút) — kho là riêng tư, không có link công khai */
export async function signedUrls(paths: string[]): Promise<Record<string, string>> {
  if (!paths.length) return {};
  const { data } = await supabase.storage.from(BUCKET).createSignedUrls(paths, 600);
  const m: Record<string, string> = {};
  (data ?? []).forEach((d) => { if (d.path && d.signedUrl) m[d.path] = d.signedUrl; });
  return m;
}

export async function removeFile(f: StoredFile): Promise<void> {
  const { error } = await supabase.from("files").delete().eq("id", f.id);
  if (error) throw new Error(error.message);
  await supabase.storage.from(BUCKET).remove([f.path]);
}
