import { useCallback, useEffect, useState, type FormEvent } from "react";
import { friendlyError, supabase } from "../lib/supabase";
import { useSession } from "../lib/session";
import { vnd } from "../lib/money";
import { ddmmyyyy } from "../lib/dates";
import type { ReqAdvance, ReqLine, ReqLink } from "../lib/office";

/** Chi tiết thanh toán, tạm ứng và link đính kèm của một đề nghị thanh toán */
export default function DnttView({ requestId, refreshKey, canAddLink, canDeleteLink }: {
  requestId: string; refreshKey: string; canAddLink: boolean; canDeleteLink: boolean;
}) {
  const { toast } = useSession();
  const [lines, setLines] = useState<ReqLine[]>([]);
  const [advs, setAdvs] = useState<ReqAdvance[]>([]);
  const [links, setLinks] = useState<ReqLink[]>([]);
  const [url, setUrl] = useState("");
  const [title, setTitle] = useState("");
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    const [l, a, k] = await Promise.all([
      supabase.from("request_lines").select("*").eq("request_id", requestId).order("line_no"),
      supabase.from("request_advances").select("*").eq("request_id", requestId).order("created_at"),
      supabase.from("request_links").select("*").eq("request_id", requestId).order("created_at"),
    ]);
    setLines((l.data ?? []) as ReqLine[]); setAdvs((a.data ?? []) as ReqAdvance[]); setLinks((k.data ?? []) as ReqLink[]);
  }, [requestId]);
  useEffect(() => { load(); }, [load, refreshKey]);

  async function addLink(e: FormEvent) {
    e.preventDefault();
    const u = url.trim();
    if (!/^https?:\/\/\S+$/i.test(u)) { toast("Link phải bắt đầu bằng http:// hoặc https://"); return; }
    setBusy(true);
    const { error } = await supabase.from("request_links").insert({ request_id: requestId, url: u, title: title.trim() || null });
    setBusy(false);
    if (error) { toast(friendlyError(error)); return; }
    setUrl(""); setTitle(""); load();
  }
  async function delLink(id: string) {
    const { error } = await supabase.from("request_links").delete().eq("id", id);
    if (error) { toast(friendlyError(error)); return; }
    load();
  }

  const gross = lines.reduce((s, l) => s + Number(l.total), 0);
  const adv = advs.reduce((s, a) => s + Number(a.amount), 0);

  return (
    <>
      {lines.length ? (
        <>
          <div className="section-title">Chi tiết thanh toán</div>
          <div className="card dn-grid">
            <table>
              <thead><tr><th>#</th><th>Hoá đơn</th><th>Người bán</th><th className="r">Trước VAT</th><th className="r">VAT</th><th className="r">Tổng</th><th>Cost Center</th></tr></thead>
              <tbody>
                {lines.map((l) => (
                  <tr key={l.id ?? l.line_no}>
                    <td className="num">{l.line_no}</td>
                    <td>{[l.invoice_serial, l.invoice_no].filter(Boolean).join(" · ") || "—"}{l.invoice_date ? <><br /><span className="muted">{ddmmyyyy(l.invoice_date)}</span></> : null}
                      {l.description ? <><br /><span className="muted">{l.description}</span></> : null}</td>
                    <td>{l.seller_name || "—"}{l.seller_tax ? <><br /><span className="muted num">MST {l.seller_tax}</span></> : null}</td>
                    <td className="r num">{vnd(l.amount_pre_vat)}{l.quantity != null ? <><br /><span className="muted">SL {l.quantity}</span></> : null}</td>
                    <td className="r num">{vnd(l.vat_amount)}<br /><span className="muted">{l.vat_pct}%</span></td>
                    <td className="r num"><b>{vnd(l.total)}</b></td>
                    <td>{l.cost_center}{l.object_ref ? <><br /><span className="muted">{l.object_ref}</span></> : null}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {advs.length ? (
            <>
              <div className="section-title">Chi tiết tạm ứng</div>
              <div className="card dn-grid">
                <table>
                  <thead><tr><th>Diễn giải</th><th className="r">Tiền (VNĐ)</th></tr></thead>
                  <tbody>{advs.map((a) => <tr key={a.id}><td>{a.description || "—"}</td><td className="r num">{vnd(a.amount)}</td></tr>)}</tbody>
                </table>
              </div>
            </>
          ) : null}
          <dl className="card kv dn-total">
            <dt>Tổng thanh toán</dt><dd className="num">{vnd(gross)}</dd>
            {adv ? (<><dt>Trừ tạm ứng</dt><dd className="num">− {vnd(adv)}</dd></>) : null}
            <dt><b>Tổng tiền VNĐ</b></dt><dd className="num"><b>{vnd(gross - adv)}</b></dd>
          </dl>
        </>
      ) : null}

      {links.length || canAddLink ? (
        <>
          <div className="section-title">Link đính kèm</div>
          <div className="card dn-attach">
            {links.length ? (
              <ul className="dn-list">
                {links.map((k) => (
                  <li key={k.id}>
                    <a href={k.url} target="_blank" rel="noopener noreferrer">{k.title || k.url}</a>
                    {canDeleteLink ? <button type="button" className="btn ghost" onClick={() => delLink(k.id)}>Xoá</button> : null}
                  </li>
                ))}
              </ul>
            ) : <p className="muted small" style={{ margin: 0 }}>Chưa có link nào.</p>}
            {canAddLink ? (
              <form className="stack" onSubmit={addLink}>
                <label className="field"><span>Thêm link</span>
                  <input className="input" inputMode="url" value={url} onChange={(e) => setUrl(e.target.value)} placeholder="https://…" /></label>
                <label className="field"><span>Tên link (không bắt buộc)</span>
                  <input className="input" value={title} onChange={(e) => setTitle(e.target.value)} /></label>
                <button className="btn secondary block" disabled={busy || !url.trim()}>+ Thêm link</button>
              </form>
            ) : null}
          </div>
        </>
      ) : null}
    </>
  );
}
