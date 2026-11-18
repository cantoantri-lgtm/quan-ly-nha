import { useCallback, useEffect, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { friendlyError, supabase } from "../lib/supabase";
import { useSession } from "../lib/session";
import { addLink, LINKABLE, LINK_LABEL, linkHref, parseLk, type LinkType, type Related } from "../lib/links";
import { Icon, Sheet } from "./ui";
import "../links.css";

const TYPE_ICON: Record<LinkType, JSX.Element> = {
  building: Icon.building, room: Icon.building, task: Icon.tasks, request: Icon.office, feedback: Icon.help,
  contract: Icon.money, tenant: Icon.user, viewing: Icon.map,
};

const STATUS_TEXT: Record<string, string> = {
  chua_lam: "Chưa làm", dang_lam: "Đang làm", vuong: "Vướng", xong: "Xong",
  nhap: "Nháp", cho_duyet: "Chờ duyệt", da_duyet: "Đã duyệt", hoan_tat: "Hoàn tất", tu_choi: "Từ chối", tra_lai: "Trả lại",
  cho_cong_ty: "Chờ công ty", cho_khach: "Chờ khách", dong: "Đã đóng",
  trong: "Trống", dang_o: "Đang cho thuê", dang_sua: "Đang sửa", giu_cho: "Giữ chỗ",
  hieu_luc: "Hiệu lực", da_ket_thuc: "Đã kết thúc",
  moi: "Mới", da_goi: "Đã gọi", da_xem: "Đã xem", khong_den: "Không đến", da_thue: "Đã thuê", huy: "Huỷ",
};
function statusText(t: LinkType, s: string | null): string {
  if (!s) return "";
  if (s === "da_huy") return t === "request" ? "Đã rút" : "Đã huỷ";
  return STATUS_TEXT[s] ?? s.replace(/_/g, " ");
}

type Hit = { id: string; title: string; sub: string | null; status: string | null };

/**
 * Khung "Liên quan": các mục nối với mục đang xem, gồm liên kết tự động (theo dữ liệu sẵn có)
 * và liên kết gắn tay. Bấm để mở; gắn thêm hoặc gỡ liên kết; tạo việc / đề nghị đã gắn sẵn.
 * Quyền xem và gắn do CSDL kiểm tra (RLS entity_links + related_items chạy theo quyền người dùng).
 */
export function RelatedPanel({ type, id, title = "Liên quan", bare }: { type: LinkType; id: string; title?: string; bare?: boolean }) {
  const { isCustomer, isCollaborator, isManager, isSupervisor, toast } = useSession();
  const [items, setItems] = useState<Related[] | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);

  const load = useCallback(async () => {
    const { data, error } = await supabase.rpc("related_items", { p_type: type, p_id: id });
    if (error) { setErr(friendlyError(error)); setItems([]); return; }
    setErr(null); setItems((data ?? []) as Related[]);
  }, [type, id]);
  useEffect(() => { load(); }, [load]);

  if (isCustomer || isCollaborator) return null;

  async function unlink(r: Related) {
    if (!r.link_id) return;
    setBusy(r.link_id);
    const { error } = await supabase.from("entity_links").delete().eq("id", r.link_id);
    setBusy(null);
    if (error) { toast(friendlyError(error)); return; }
    toast(`Đã gỡ liên kết với ${LINK_LABEL[r.rel_type].toLowerCase()}.`);
    load();
  }

  const lk = `${type}:${id}`;
  const body = (
    <>
      <div className="rel-head">
        <h3>{title}{items?.length ? <span className="muted num"> · {items.length}</span> : null}</h3>
        <div className="rel-acts">
          {isManager || isSupervisor ? <Link className="btn ghost sm" to={`/viec/moi?lk=${lk}`}>{Icon.plus}Tạo việc</Link> : null}
          {type !== "request" ? <Link className="btn ghost sm" to={`/van-phong/moi/thanh_toan?lk=${lk}`}>{Icon.plus}Đề nghị thanh toán</Link> : null}
          <button type="button" className="btn secondary sm" onClick={() => setOpen(true)}>{Icon.plus}Gắn liên kết</button>
        </div>
      </div>
      {err ? <div className="error-box">{err}</div> : null}
      {items === null ? <div className="muted small" style={{ padding: "8px 2px" }}>Đang tải…</div>
        : items.length === 0 ? <div className="muted small" style={{ padding: "8px 2px" }}>Chưa có mục liên quan. Bấm “Gắn liên kết” để nối với công việc, đề nghị, phản ánh, phòng hoặc hợp đồng.</div>
        : (
          <ul className="rel-list">
            {items.map((r) => (
              <li key={`${r.rel_type}:${r.rel_id}`}>
                <Link to={linkHref(r.rel_type, r.rel_id, r.parent)} className="rel-row">
                  <span className={`rel-ico t-${r.rel_type}`} aria-hidden="true">{TYPE_ICON[r.rel_type]}</span>
                  <span className="rel-txt">
                    <span className="rel-kind">{LINK_LABEL[r.rel_type]}{r.auto ? " · tự động" : ""}</span>
                    <span className="rel-title">{r.title}</span>
                    {r.sub ? <span className="rel-sub">{r.sub}</span> : null}
                  </span>
                  {r.status ? <span className="rel-st">{statusText(r.rel_type, r.status)}</span> : null}
                </Link>
                {r.can_unlink ? (
                  <button type="button" className="ico-btn no" aria-label={`Gỡ liên kết ${r.title}`} title="Gỡ liên kết" disabled={busy === r.link_id} onClick={() => unlink(r)}>{Icon.x}</button>
                ) : null}
              </li>
            ))}
          </ul>
        )}
      <LinkPicker open={open} onClose={() => setOpen(false)} fromType={type} fromId={id} onLinked={(msg) => { setOpen(false); toast(msg); load(); }} />
    </>
  );
  return bare ? <div className="rel-panel">{body}</div> : <section className="card rel-panel" aria-label={title}>{body}</section>;
}

function LinkPicker({ open, onClose, fromType, fromId, onLinked }: { open: boolean; onClose: () => void; fromType: LinkType; fromId: string; onLinked: (msg: string) => void }) {
  const [t, setT] = useState<LinkType>(fromType === "task" ? "request" : "task");
  const [q, setQ] = useState("");
  const [hits, setHits] = useState<Hit[] | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!open) return;
    let alive = true;
    const h = setTimeout(async () => {
      const { data, error } = await supabase.rpc("link_search", { p_type: t, p_q: q });
      if (!alive) return;
      if (error) { setErr(friendlyError(error)); setHits([]); return; }
      setErr(null);
      setHits(((data ?? []) as Hit[]).filter((x) => !(t === fromType && x.id === fromId)));
    }, 250);
    return () => { alive = false; clearTimeout(h); };
  }, [open, t, q, fromType, fromId]);

  async function pick(h: Hit) {
    setBusy(true);
    const e = await addLink(fromType, fromId, t, h.id);
    setBusy(false);
    if (e) { setErr(friendlyError({ message: e })); return; }
    onLinked(`Đã gắn ${LINK_LABEL[t].toLowerCase()}: ${h.title}`);
  }

  return (
    <Sheet open={open} onClose={onClose} title="Gắn liên kết">
      <div className="stack">
        <div className="chips" role="group" aria-label="Loại mục">
          {LINKABLE.map((x) => (
            <button key={x} type="button" className="chip" aria-pressed={t === x} onClick={() => { setT(x); setHits(null); }}>{LINK_LABEL[x]}</button>
          ))}
        </div>
        <input className="input" placeholder={`Tìm ${LINK_LABEL[t].toLowerCase()}…`} value={q} onChange={(e) => setQ(e.target.value)} aria-label="Từ khoá" autoFocus />
        {err ? <div className="error-box">{err}</div> : null}
        {hits === null ? <div className="muted small">Đang tìm…</div>
          : hits.length === 0 ? <div className="muted small">Không thấy mục nào bạn được xem. Thử từ khoá khác.</div>
          : (
            <ul className="rel-list pick">
              {hits.map((h) => (
                <li key={h.id}>
                  <button type="button" className="rel-row" disabled={busy} onClick={() => pick(h)}>
                    <span className={`rel-ico t-${t}`} aria-hidden="true">{TYPE_ICON[t]}</span>
                    <span className="rel-txt"><span className="rel-title">{h.title}</span>{h.sub ? <span className="rel-sub">{h.sub}</span> : null}</span>
                    {h.status ? <span className="rel-st">{statusText(t, h.status)}</span> : null}
                  </button>
                </li>
              ))}
            </ul>
          )}
        <p className="muted small" style={{ margin: 0 }}>Liên kết hiện ở cả hai phía. Chỉ người thấy được cả hai mục mới thấy liên kết.</p>
      </div>
    </Sheet>
  );
}

/** Form tạo mới mở từ một mục khác (?lk=loai:id): đọc mục nguồn để ghi chú và gắn liên kết sau khi lưu. */
export function useLinkFrom(enabled = true) {
  const [params] = useSearchParams();
  const from = enabled ? parseLk(params.get("lk")) : null;
  const key = from ? `${from.type}:${from.id}` : "";
  const [info, setInfo] = useState<{ title: string; parent: string | null } | null>(null);
  useEffect(() => {
    if (!from) { setInfo(null); return; }
    let alive = true;
    supabase.rpc("link_describe", { p_type: from.type, p_id: from.id }).then(({ data }) => {
      const d = (Array.isArray(data) ? data[0] : data) as { title: string | null; parent: string | null } | null;
      if (alive) setInfo(d?.title ? { title: d.title, parent: d.parent } : null);
    });
    return () => { alive = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);
  return { from, info };
}

export function LinkFromNote({ from, info }: { from: { type: LinkType } | null; info: { title: string } | null }) {
  if (!from) return null;
  return <p className="ok-box" style={{ margin: 0 }}>Sẽ gắn liên kết với {LINK_LABEL[from.type].toLowerCase()}: <b>{info?.title ?? "…"}</b></p>;
}
