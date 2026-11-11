import { useSession } from "../lib/session";
import { useEffect, useState } from "react";
import { supabase } from "../lib/supabase";
import { ddmmyyyy } from "../lib/dates";
import { vnd } from "../lib/money";
import { Empty } from "./ui";
import PolicyEditSheet from "./PolicyEditSheet";
import "../policy.css";

export type Fee = { label: string; amount: number; unit: string };
export type Term = { months: number; pct: number };
export type Policy = {
  building_id: string; code: string; name: string; address: string | null;
  fees: Fee[]; amenities: string[]; furniture: string[]; deposit_lines: string[]; commission_terms: Term[];
  forfeit_min: number | null; forfeit_pct: number | null; note: string | null; updated_at: string | null;
};

export const hasData = (p: Policy) => p.fees.length > 0 || p.amenities.length > 0 || p.furniture.length > 0 || p.deposit_lines.length > 0 || p.commission_terms.length > 0 || p.forfeit_pct != null;
const pctText = (n: number) => String(n).replace(".", ",");


export function PolicyView({ p, isManager, guest, onEdit }: { p: Policy; isManager: boolean; guest: boolean; onEdit: () => void }) {
  if (!hasData(p)) {
    return (
      <Empty title={`${p.code} chưa có chính sách`}>
        {isManager ? <button className="btn" onClick={onEdit}>Nhập chính sách cho toà này</button> : "Quản lý sẽ cập nhật dịch vụ và chính sách cho toà này."}
      </Empty>
    );
  }
  return (
    <div className="stack pl">
      <section className="card pl-head">
        <h2>{p.name}</h2>
        <p className="muted small">{p.code}{p.address ? ` · ${p.address}` : ""}</p>
      </section>

      {p.fees.length ? (
        <section className="card pl-sec">
          <h3>Phí dịch vụ</h3>
          <dl className="pl-fees">
            {p.fees.map((f, i) => (
              <div key={i}><dt>{f.label}</dt><dd className="num">{vnd(f.amount)}{f.unit ? `/${f.unit}` : ""}</dd></div>
            ))}
          </dl>
        </section>
      ) : null}

      {p.amenities.length ? (
        <section className="card pl-sec">
          <h3>Tiện ích</h3>
          <ul className="pl-chips-list">{p.amenities.map((a, i) => <li key={i}>{a}</li>)}</ul>
        </section>
      ) : null}

      {p.furniture.length ? (
        <section className="card pl-sec">
          <h3>Danh mục nội thất</h3>
          <ul className="pl-chips-list">{p.furniture.map((a, i) => <li key={i}>{a}</li>)}</ul>
        </section>
      ) : null}

      {guest ? null : p.deposit_lines.length ? (
        <section className="card pl-sec">
          <h3>Ký hợp đồng <span className="pl-tag">Chỉ Sale và CTV</span></h3>
          <ul className="pl-lines">{p.deposit_lines.map((a, i) => <li key={i}>{a}</li>)}</ul>
        </section>
      ) : null}

      {guest ? null : p.commission_terms.length || p.forfeit_pct != null ? (
        <section className="card pl-sec pl-comm">
          <h3>Hoa hồng Cộng tác viên <span className="pl-tag">Chỉ Sale và CTV</span></h3>
          {p.commission_terms.length ? (
            <>
              <p className="muted small" style={{ margin: 0 }}>Hợp đồng thành công, tính trên tiền thuê tháng đầu:</p>
              <div className="pl-terms">
                {p.commission_terms.slice().sort((a, b) => a.months - b.months).map((t, i) => (
                  <div key={i} className="pl-term"><span className="muted small">Hợp đồng {t.months} tháng</span><b className="num">{pctText(t.pct)}%</b></div>
                ))}
              </div>
            </>
          ) : null}
          {p.forfeit_pct != null ? (
            <div className="pl-forfeit">
              <b>Khách bỏ cọc</b>
              <p className="small" style={{ margin: 0 }}>
                {p.forfeit_min != null && p.forfeit_min > 0
                  ? <>Tiền cọc công ty giữ lại dưới <b className="num">{vnd(p.forfeit_min)}</b>: <b>không chi</b> hoa hồng. Từ <b className="num">{vnd(p.forfeit_min)}</b> trở lên: hoa hồng <b className="num">{pctText(p.forfeit_pct)}%</b> số tiền cọc đó.</>
                  : <>Hoa hồng <b className="num">{pctText(p.forfeit_pct)}%</b> số tiền cọc công ty giữ lại.</>}
              </p>
            </div>
          ) : null}
        </section>
      ) : null}

      {!guest && p.note ? <section className="card pl-sec"><h3>Ghi chú</h3><p className="small" style={{ margin: 0, whiteSpace: "pre-line" }}>{p.note}</p></section> : null}
      {p.updated_at ? <p className="muted small" style={{ margin: 0 }}>Cập nhật {ddmmyyyy(p.updated_at)}.{guest ? "" : " Mức hoa hồng cuối cùng do Quản lý xác nhận."}</p> : null}
    </div>
  );
}


/** Chính sách một toà, tự tải; dùng trong trang toà và cửa sổ nhỏ ở Phòng trống. Có công tắc Khách xem. canEdit (Quản lý): nút Sửa ngay tại đây. */
export function PolicyPanel({ buildingId, canEdit = false }: { buildingId: string; canEdit?: boolean }) {
  const [p, setP] = useState<Policy | null | undefined>(undefined);
  const { isCustomer } = useSession();
  const [guestToggle, setGuest] = useState(false);
  const guest = isCustomer || guestToggle; // khách hàng luôn ở chế độ khách (máy chủ cũng đã bỏ hoa hồng)
  const [editing, setEditing] = useState(false);
  const [tick, setTick] = useState(0);
  useEffect(() => {
    let off = false;
    supabase.rpc("building_policies").then(({ data, error }) => {
      if (off) return;
      setP(error ? null : ((data as Policy[]) ?? []).find((r) => r.building_id === buildingId) ?? null);
    });
    return () => { off = true; };
  }, [buildingId, tick]);
  if (p === undefined) return <div className="loading">Đang tải…</div>;
  if (p === null) return <p className="muted small">Không tải được chính sách. Thử lại sau.</p>;
  return (
    <div className="stack">
      {hasData(p) && !isCustomer ? (
        <div className="pl-tools">
          <label className="pl-guest">
            <input type="checkbox" checked={guestToggle} onChange={(e) => setGuest(e.target.checked)} />
            <span><b>Chế độ khách xem</b><small className="muted"> Ẩn phần ký hợp đồng và hoa hồng, dùng khi đưa màn hình cho khách.</small></span>
          </label>
          {canEdit ? <button type="button" className="btn secondary sm" onClick={() => setEditing(true)}>Sửa chính sách</button> : null}
        </div>
      ) : null}
      <PolicyView p={p} isManager={canEdit} guest={guest} onEdit={() => setEditing(true)} />
      {editing ? <PolicyEditSheet p={p} onClose={() => setEditing(false)} onSaved={() => { setEditing(false); setTick((n) => n + 1); }} /> : null}
    </div>
  );
}
