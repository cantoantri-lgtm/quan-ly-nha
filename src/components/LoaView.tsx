import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { supabase } from "../lib/supabase";
import { useSession } from "../lib/session";
import { clock } from "../lib/dates";
import { vnd } from "../lib/money";
import { LOA_BUDGET, LOA_CATEGORY, LOA_PAY, LOA_SBU, LOA_TAX, fullDate, kindLabel, loaLeft, moneyCur, statusLabel,
  type LoaBrief, type LoaDept, type LoaDetails, type LoaLine, type LoaLinked, type LoaMember, type Req } from "../lib/office";

/** Thanh ngân sách của một LOA: dự toán, đã duyệt chi, đang chờ duyệt, còn lại */
function BudgetBar({ b }: { b: LoaBrief }) {
  const total = Number(b.amount ?? 0);
  const left = loaLeft(b);
  const pct = (n: number) => (total > 0 ? Math.min(100, (n / total) * 100) : 0);
  return (
    <div className="loa-budget">
      <div className="loa-track" role="img" aria-label={`Đã duyệt chi ${vnd(b.used)}, đang chờ duyệt ${vnd(b.pending)} trên dự toán ${vnd(total)}`}>
        <span className="used" style={{ width: `${pct(b.used)}%` }} />
        <span className="pend" style={{ width: `${Math.min(100 - pct(b.used), pct(b.pending))}%` }} />
      </div>
      <dl className="loa-nums num">
        <div><dt>Dự toán</dt><dd>{vnd(total)}</dd></div>
        <div><dt><i className="dot used" />Đã duyệt chi</dt><dd>{vnd(b.used)}</dd></div>
        <div><dt><i className="dot pend" />Đang chờ duyệt</dt><dd>{vnd(b.pending)}</dd></div>
        <div className={left < 0 ? "over" : ""}><dt>{left < 0 ? "Vượt dự toán" : "Còn lại"}</dt><dd>{vnd(Math.abs(left))}</dd></div>
      </dl>
    </div>
  );
}

/** Thẻ LOA trên trang đề nghị thanh toán / tạm ứng: LOA nào, dự toán còn bao nhiêu, có vượt không */
export function LoaBudget({ loaId, loaNo, refreshKey }: { loaId: string | null; loaNo: string | null; refreshKey?: string }) {
  const [b, setB] = useState<LoaBrief | null | undefined>(undefined);
  useEffect(() => {
    if (!loaId) { setB(null); return; }
    let live = true;
    supabase.rpc("loa_brief", { p_loa: loaId }).then(({ data }) => { if (live) setB(((data ?? []) as LoaBrief[])[0] ?? null); });
    return () => { live = false; };
  }, [loaId, refreshKey]);

  if (!loaId) {
    return (
      <section className="card loa-card missing">
        <b>Chưa gắn Tờ trình (LOA)</b>
        <p className="muted small" style={{ margin: 0 }}>{loaNo ? `Số LOA ghi tay: ${loaNo}. ` : ""}Đề nghị này lập trước khi có quy định gắn LOA. Nếu bị trả lại hoặc rút để sửa, cần chọn một LOA đã duyệt mới gửi lại được.</p>
      </section>
    );
  }
  if (b === undefined) return null;
  if (!b) return <section className="card loa-card"><b>Tờ trình (LOA) {loaNo ?? ""}</b><p className="muted small" style={{ margin: 0 }}>Bạn không có quyền xem chi tiết LOA này.</p></section>;
  const left = loaLeft(b);
  return (
    <section className="card loa-card k-loa">
      <div className="row" style={{ justifyContent: "space-between", gap: 8 }}>
        <b>Tờ trình (LOA) <span className="num">{b.doc_no}</span></b>
        <Link to={`/van-phong/${b.id}`} className="dt-link">Mở LOA →</Link>
      </div>
      <p style={{ margin: 0 }}>{b.subject}</p>
      <BudgetBar b={b} />
      {left < 0 ? <div className="error-box"><b>Vượt dự toán LOA {vnd(-left)}.</b> Tổng tạm ứng và thanh toán (kể cả đề nghị đang chờ duyệt) lớn hơn dự toán đã duyệt. Cấp duyệt cân nhắc trước khi duyệt, hoặc yêu cầu lập LOA bổ sung.</div> : null}
    </section>
  );
}

/** Nội dung một Tờ trình (LOA) trên trang chi tiết */
export default function LoaView({ r, d }: { r: Req; d: LoaDetails }) {
  const { people, buildings } = useSession();
  const [lines, setLines] = useState<LoaLine[]>([]);
  const [members, setMembers] = useState<LoaMember[]>([]);
  const [viewDepts, setViewDepts] = useState<string[]>([]);
  const [depts, setDepts] = useState<LoaDept[]>([]);
  const [brief, setBrief] = useState<LoaBrief | null>(null);
  const [linked, setLinked] = useState<LoaLinked[]>([]);
  const [ref, setRef] = useState<LoaBrief | null>(null);

  useEffect(() => {
    let live = true;
    (async () => {
      const [l, m, vd, dp, b, lk, rf] = await Promise.all([
        supabase.from("loa_lines").select("*").eq("request_id", r.id).order("line_no"),
        supabase.from("loa_members").select("*").eq("request_id", r.id),
        supabase.from("loa_viewer_depts").select("department_id").eq("request_id", r.id),
        supabase.rpc("loa_departments"),
        supabase.rpc("loa_brief", { p_loa: r.id }),
        supabase.rpc("loa_linked", { p_loa: r.id }),
        d.ref_loa_id ? supabase.rpc("loa_brief", { p_loa: d.ref_loa_id }) : Promise.resolve({ data: [] }),
      ]);
      if (!live) return;
      setLines((l.data ?? []) as LoaLine[]); setMembers((m.data ?? []) as LoaMember[]);
      setViewDepts(((vd.data ?? []) as { department_id: string }[]).map((x) => x.department_id));
      setDepts((dp.data ?? []) as LoaDept[]);
      setBrief(((b.data ?? []) as LoaBrief[])[0] ?? null);
      setLinked((lk.data ?? []) as LoaLinked[]);
      setRef(((rf.data ?? []) as LoaBrief[])[0] ?? null);
    })();
    return () => { live = false; };
  }, [r.id, r.updated_at, d.ref_loa_id, d.updated_at]);

  const name = (uid: string | null) => people.find((p) => p.id === uid)?.full_name ?? "—";
  const deptName = (id: string | null) => depts.find((x) => x.id === id)?.name ?? "—";
  const building = buildings.find((b) => b.id === r.building_id);
  const co = members.filter((m) => m.role === "soan");
  const vw = members.filter((m) => m.role === "xem");
  const total = lines.reduce((s, l) => s + Number(l.amount), 0);
  const showBudget = d.pay_receive === "chi" && r.currency === "VND" && Number(r.amount ?? 0) > 0 && r.status === "da_duyet" && brief;

  return (
    <>
      <dl className="card kv">
        <dt>Tiêu đề</dt><dd><b>{d.subject}</b></dd>
        <dt>Số LOA</dt><dd className="num">{r.doc_no ?? "Chưa cấp (bản nháp)"}</dd>
        {d.submitted_at ? (<><dt>Ngày trình</dt><dd className="num">{clock(d.submitted_at)}</dd></>) : null}
        <dt>Người trình</dt><dd>{name(r.requester_id)}</dd>
        {d.updated_by && d.updated_by !== r.requester_id ? (<><dt>Người soạn</dt><dd>{name(d.updated_by)}</dd></>) : null}
        <dt>Phân loại</dt><dd>{d.category ? LOA_CATEGORY[d.category] : "—"}</dd>
        <dt>Đơn vị đề xuất</dt><dd>{deptName(d.propose_dept)}</dd>
        <dt>Mảng kinh doanh</dt><dd>{d.sbu.length ? d.sbu.map((k) => LOA_SBU[k] ?? k).join(", ") : "—"}</dd>
        <dt>Số tiền</dt><dd className="num">{r.amount == null ? "—" : r.amount === 0 ? "Không phát sinh tiền" : <><b>{moneyCur(r.amount, r.currency)}</b> · {LOA_PAY[d.pay_receive]} · {LOA_TAX[d.tax]}</>}</dd>
        <dt>Ngân sách</dt><dd>{LOA_BUDGET[d.budget_status]}{d.budget_item_no ? ` · mã ${d.budget_item_no}` : ""}</dd>
        <dt>Ngày bắt đầu</dt><dd className="num">{fullDate(r.start_date)}</dd>
        <dt>Hạn báo cáo</dt><dd className="num">{fullDate(d.report_due)}</dd>
        {d.ref_loa_id ? (<><dt>LOA tham chiếu</dt><dd>{ref ? <Link to={`/van-phong/${ref.id}`} className="dt-link">{ref.doc_no ?? "LOA"} · {ref.subject}</Link> : "—"}</dd></>) : null}
        {building ? (<><dt>Toà nhà</dt><dd>{building.code} · {building.name}</dd></>) : null}
      </dl>

      <div className="section-title">Nội dung đề xuất</div>
      <section className="card loa-text">
        <h3>Bối cảnh</h3><p>{d.background || "—"}</p>
        <h3>Nội dung xin phê duyệt</h3><p>{d.seek_approval || "—"}</p>
        {d.details ? (<><h3>Chi tiết</h3><p>{d.details}</p></>) : null}
      </section>

      {lines.length ? (
        <>
          <div className="section-title">Dự toán ngân sách</div>
          <section className="card dn-grid">
            <table>
              <thead><tr><th>#</th><th>Nội dung</th><th>ĐVT</th><th className="r">SL</th><th className="r">Đơn giá</th><th className="r">Thành tiền</th><th>Ghi chú</th></tr></thead>
              <tbody>
                {lines.map((l) => (
                  <tr key={l.id}>
                    <td className="num">{l.line_no}</td><td>{l.description}</td><td>{l.unit}</td>
                    <td className="r num">{String(l.quantity).replace(".", ",")}</td><td className="r num">{moneyCur(l.unit_price, r.currency)}</td>
                    <td className="r num">{moneyCur(l.amount, r.currency)}</td><td>{l.note}</td>
                  </tr>
                ))}
                <tr><td colSpan={5} className="r"><b>Tổng dự toán</b></td><td className="r num"><b>{moneyCur(total, r.currency)}</b></td><td /></tr>
              </tbody>
            </table>
          </section>
          {r.amount != null && total !== Number(r.amount) ? <p className="muted small" style={{ margin: 0 }}>Số tiền xin duyệt ({moneyCur(r.amount, r.currency)}) khác tổng dự toán ({moneyCur(total, r.currency)}).</p> : null}
        </>
      ) : null}

      {showBudget && brief ? (
        <>
          <div className="section-title">Sử dụng ngân sách</div>
          <section className="card loa-card">
            <BudgetBar b={brief} />
            {loaLeft(brief) < 0 ? <div className="error-box"><b>Đã vượt dự toán {vnd(-loaLeft(brief))}.</b> Cần lập LOA bổ sung cho phần vượt.</div> : null}
            {linked.length ? (
              <ul className="dn-list">
                {linked.map((x) => (
                  <li key={x.id}>
                    <span>{x.can_open ? <Link to={`/van-phong/${x.id}`} className="dt-link">{kindLabel({ kind: x.kind, sub_type: null })} {x.doc_no ?? ""}</Link> : <>{kindLabel({ kind: x.kind, sub_type: null })} {x.doc_no ?? ""}</>}
                      <br /><small className="muted">{x.requester_name ?? "—"} · {statusLabel(x)}{x.kind === "mua_hang" ? " · tham khảo, không trừ dự toán" : ""}</small></span>
                    <b className="num">{vnd(x.amount)}</b>
                  </li>
                ))}
              </ul>
            ) : <p className="muted small" style={{ margin: 0 }}>Chưa có đề nghị mua hàng, tạm ứng hay thanh toán nào dùng LOA này.</p>}
          </section>
        </>
      ) : null}

      {co.length || vw.length || viewDepts.length ? (
        <>
          <div className="section-title">Cùng soạn và được xem</div>
          <dl className="card kv">
            {co.length ? (<><dt>Cùng soạn</dt><dd>{co.map((m) => name(m.user_id)).join(", ")}</dd></>) : null}
            {viewDepts.length ? (<><dt>Đơn vị được xem</dt><dd>{viewDepts.map(deptName).join(", ")}</dd></>) : null}
            {vw.length ? (<><dt>Cá nhân được xem</dt><dd>{vw.map((m) => name(m.user_id)).join(", ")}</dd></>) : null}
          </dl>
        </>
      ) : null}
    </>
  );
}
