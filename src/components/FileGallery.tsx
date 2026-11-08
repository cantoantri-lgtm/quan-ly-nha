import { useCallback, useEffect, useRef, useState } from "react";
import { friendlyError, supabase } from "../lib/supabase";
import { useSession } from "../lib/session";
import { fileUrls, listFiles, removeFile, uploadFile, type FileOwner, type StoredFile } from "../lib/files";
import { Sheet } from "./ui";
import "../files.css";

type Column = "tenant_id" | "contract_id" | "room_id" | "room_type_id" | "request_id";
const COLUMN: Record<FileOwner["kind"], Column> = { cccd: "tenant_id", hop_dong: "contract_id", anh_phong: "room_id", anh_loai_phong: "room_type_id", dinh_kem_de_nghi: "request_id" };
const ownerId = (o: FileOwner) => (o.kind === "cccd" ? o.tenantId : o.kind === "hop_dong" ? o.contractId : o.kind === "anh_phong" ? o.roomId : o.kind === "anh_loai_phong" ? o.roomTypeId : o.requestId);

/** Kho ảnh/tệp gắn với một đối tượng (khách, hợp đồng, phòng, đề nghị). Danh sách hiện ảnh nhỏ cho nhanh, bấm vào mới tải ảnh to. Tệp riêng tư mở bằng link tạm. */
export default function FileGallery({ owner, title, hint, canUpload, canDelete, slots, cover, pdf = true, onChange }: {
  owner: FileOwner; title: string; hint?: string; canUpload: boolean; canDelete: boolean;
  slots?: { label: string; text: string }[];   // VD CCCD: mặt trước / mặt sau
  cover?: boolean;                             // cho phép chọn ảnh đại diện (phòng)
  pdf?: boolean; onChange?: () => void;
}) {
  const { toast } = useSession();
  const [files, setFiles] = useState<StoredFile[]>([]);
  const [urls, setUrls] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const [view, setView] = useState<StoredFile | null>(null);
  const [full, setFull] = useState<string | null>(null);
  const [confirmDel, setConfirmDel] = useState(false);
  const input = useRef<HTMLInputElement>(null);
  const pendingLabel = useRef<string | undefined>(undefined);
  const id = ownerId(owner);

  const load = useCallback(async () => {
    const list = await listFiles(owner.kind, COLUMN[owner.kind], id);
    setFiles(list);
    setUrls(await fileUrls(list.filter((f) => f.mime_type?.startsWith("image/")), "thumb"));
  }, [owner.kind, id]);
  useEffect(() => { load(); }, [load]);

  // Mở xem to: lúc đó mới lấy ảnh gốc (danh sách chỉ tải ảnh nhỏ)
  useEffect(() => {
    setFull(null);
    if (view && view.mime_type?.startsWith("image/")) fileUrls([view], "full").then((m) => setFull(m[view.id] ?? urls[view.id] ?? null));
  }, [view]); // eslint-disable-line react-hooks/exhaustive-deps

  async function onPick(list: FileList | null) {
    const picked = [...(list ?? [])];
    if (input.current) input.current.value = "";
    if (!picked.length) return;
    setBusy(true);
    let ok = 0, lastErr = "";
    const label = pendingLabel.current;
    const one = async (f: File) => {
      try {
        // Khe CCCD chỉ giữ một ảnh: ảnh mới thay ảnh cũ
        if (label && slots) {
          const old = files.filter((x) => x.label === label);
          for (const o of old) await removeFile(o);
        }
        await uploadFile(owner, f, { label });
        ok++;
      } catch (e) { lastErr = friendlyError(e); }
    };
    // Nhiều ảnh: tải 3 ảnh cùng lúc cho nhanh
    let next = 0;
    await Promise.all(Array.from({ length: Math.min(3, picked.length) }, async () => {
      while (next < picked.length) await one(picked[next++]);
    }));
    setBusy(false);
    if (lastErr) toast(lastErr);
    else if (ok) toast(ok === 1 ? "Đã tải ảnh lên." : `Đã tải ${ok} tệp lên.`);
    await load(); onChange?.();
  }
  const pick = (label?: string) => { pendingLabel.current = label; input.current?.click(); };

  async function setCover(f: StoredFile) {
    setBusy(true);
    const col = f.room_type_id ? "room_type_id" : "room_id";
    await supabase.from("files").update({ is_cover: false }).eq(col, (f.room_type_id ?? f.room_id)!).eq("is_cover", true);
    const { error } = await supabase.from("files").update({ is_cover: true }).eq("id", f.id);
    setBusy(false);
    if (error) toast(friendlyError(error));
    setView(null); await load(); onChange?.();
  }
  async function remove(f: StoredFile) {
    setBusy(true);
    try { await removeFile(f); toast("Đã xoá tệp."); } catch (e) { toast(friendlyError(e)); }
    setBusy(false); setView(null); setConfirmDel(false); await load(); onChange?.();
  }

  const thumb = (f: StoredFile) => (
    <button key={f.id} type="button" className={`fg-thumb${f.is_cover ? " cover" : ""}`} onClick={() => setView(f)}
      aria-label={f.file_name ?? "Tệp đính kèm"}>
      {urls[f.id] ? <img src={urls[f.id]} alt="" loading="lazy" decoding="async" /> : <span className="fg-doc">{f.mime_type === "application/pdf" ? "PDF" : "…"}</span>}
      {f.is_cover ? <i className="fg-badge">Đại diện</i> : null}
    </button>
  );

  return (
    <section className="fg">
      <div className="fg-head">
        <b>{title}</b>
        {canUpload && !slots ? <button type="button" className="btn secondary sm" disabled={busy} onClick={() => pick()}>{busy ? "Đang tải…" : "+ Thêm"}</button> : null}
      </div>
      {hint ? <p className="muted small" style={{ margin: 0 }}>{hint}</p> : null}
      <input ref={input} type="file" hidden multiple={!slots} accept={pdf ? "image/*,application/pdf" : "image/*"} onChange={(e) => onPick(e.target.files)} />
      {slots ? (
        <div className="fg-slots">
          {slots.map((s) => {
            const f = files.find((x) => x.label === s.label);
            return (
              <div key={s.label} className="fg-slot">
                <span className="small muted">{s.text}</span>
                {f ? thumb(f) : <div className="fg-empty">Chưa có</div>}
                {canUpload ? <button type="button" className="btn ghost sm" disabled={busy} onClick={() => pick(s.label)}>{f ? "Chụp lại" : "Chụp / chọn ảnh"}</button> : null}
              </div>
            );
          })}
        </div>
      ) : files.length ? (
        <div className="fg-grid">{files.map(thumb)}</div>
      ) : <p className="muted small" style={{ margin: 0 }}>Chưa có tệp nào.</p>}

      <Sheet open={!!view} onClose={() => { setView(null); setConfirmDel(false); }} title={view?.file_name ?? "Tệp"}>
        {view ? (
          <div className="stack">
            {view.mime_type === "application/pdf" ? (
              <PdfOpen file={view} />
            ) : full ? <img className="fg-full" src={full} alt={view.file_name ?? ""} /> : <div className="loading">Đang tải ảnh…</div>}
            <div className="row">
              {cover && (view.room_id || view.room_type_id) && !view.is_cover && canUpload ? <button className="btn secondary sm" disabled={busy} onClick={() => setCover(view)}>Đặt làm ảnh đại diện</button> : null}
              {canDelete ? (
                confirmDel ? (
                  <>
                    <span className="small">Xoá hẳn tệp này?</span>
                    <button className="btn secondary sm" onClick={() => setConfirmDel(false)}>Giữ lại</button>
                    <button className="btn danger sm" disabled={busy} onClick={() => remove(view)}>Xoá</button>
                  </>
                ) : <button className="btn ghost sm" style={{ color: "var(--danger)" }} onClick={() => setConfirmDel(true)}>Xoá tệp</button>
              ) : null}
            </div>
          </div>
        ) : null}
      </Sheet>
    </section>
  );
}

function PdfOpen({ file }: { file: StoredFile }) {
  const [url, setUrl] = useState<string | null>(null);
  useEffect(() => { fileUrls([file], "full").then((m) => setUrl(m[file.id] ?? null)); }, [file]);
  return url ? <a className="btn block" href={url} target="_blank" rel="noopener">Mở tệp PDF</a> : <div className="loading">Đang tạo liên kết…</div>;
}
