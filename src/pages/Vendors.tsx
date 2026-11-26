import { useCallback, useEffect, useMemo, useState } from "react";
import { useSession } from "../lib/session";
import { loadVendors, type Vendor } from "../lib/purchase";
import { Avatar, Empty, TopBar } from "../components/ui";
import { VendorSheet } from "../components/VendorSheet";

/** Danh bạ nhà cung cấp (SQL 108). Nhân sự xem được; Quản lý, Mua hàng, Kế toán thêm / sửa (CSDL kiểm tra). */
export default function Vendors() {
  const { isManager, myStaff, toast } = useSession();
  const canEdit = isManager || myStaff?.duty === "mua_hang" || myStaff?.duty === "ke_toan";
  const [list, setList] = useState<Vendor[] | null>(null);
  const [q, setQ] = useState("");
  const [showOff, setShowOff] = useState(false);
  const [open, setOpen] = useState<Vendor | "new" | null>(null);

  const load = useCallback(async () => setList(await loadVendors()), []);
  useEffect(() => { load(); }, [load]);

  const all = list ?? [];
  const shown = useMemo(() => {
    const k = q.trim().toLowerCase();
    return all.filter((v) => (showOff || v.is_active) && (!k || [v.name, v.tax_code, v.goods, v.contact_name, v.phone].some((x) => (x ?? "").toLowerCase().includes(k))));
  }, [all, q, showOff]);
  const offCount = all.filter((v) => !v.is_active).length;

  return (
    <>
      <TopBar title="Nhà cung cấp" back="/van-phong"
        action={canEdit ? <button className="tb-action" onClick={() => setOpen("new")}>+ Thêm</button> : undefined} />
      <main className="main stack">
        <input className="input" placeholder="Tìm theo tên, MST, mặt hàng, SĐT" value={q} onChange={(e) => setQ(e.target.value)} />
        {offCount ? (
          <div className="chips">
            <button className="chip" aria-pressed={!showOff} onClick={() => setShowOff(false)}>Đang giao dịch<span className="n">{all.length - offCount}</span></button>
            <button className="chip" aria-pressed={showOff} onClick={() => setShowOff(true)}>Tất cả<span className="n">{all.length}</span></button>
          </div>
        ) : null}
        {list === null ? <p className="muted">Đang tải…</p> : !shown.length ? (
          <Empty title={all.length ? "Không có nhà cung cấp khớp" : "Chưa có nhà cung cấp"}>
            {all.length ? "Thử từ khoá khác." : canEdit ? "Bấm + Thêm để lưu nhà cung cấp đầu tiên. Lần sau chọn lại khi nhập báo giá." : "Người mua hàng sẽ thêm khi lấy báo giá."}
          </Empty>
        ) : (
          <div className="card">
            {shown.map((v) => (
              <div key={v.id} className="list-row" role="button" tabIndex={0} onClick={() => setOpen(v)} onKeyDown={(e) => e.key === "Enter" && setOpen(v)}>
                <Avatar name={v.name} />
                <div className="grow">
                  <div className="name">{v.name}{v.is_active ? "" : " · ngừng giao dịch"}</div>
                  <div className="sub">{[v.goods, v.tax_code ? `MST ${v.tax_code}` : null].filter(Boolean).join(" · ") || "—"}</div>
                  {v.contact_name || v.phone ? <div className="sub">{[v.contact_name, v.phone].filter(Boolean).join(" · ")}</div> : null}
                </div>
                <span className="muted" aria-hidden>›</span>
              </div>
            ))}
          </div>
        )}
      </main>
      <VendorSheet open={open !== null} vendor={open === "new" ? null : open} readOnly={!canEdit}
        onClose={() => setOpen(null)} onSaved={() => { setOpen(null); toast("Đã lưu nhà cung cấp"); load(); }} />
    </>
  );
}
