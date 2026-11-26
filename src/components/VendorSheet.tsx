import { useEffect, useState, type FormEvent } from "react";
import { friendlyError, supabase } from "../lib/supabase";
import type { Vendor } from "../lib/purchase";
import { Combo, Sheet } from "./ui";

type Draft = Omit<Vendor, "id" | "is_active"> & { is_active: "1" | "0" };
const EMPTY: Draft = {
  name: "", tax_code: "", contact_name: "", phone: "", email: "", address: "", goods: "",
  bank_name: "", bank_account: "", bank_holder: "", note: "", is_active: "1",
};
const nz = (s: string | null) => (s ?? "").trim() || null;

/** Thêm / sửa nhà cung cấp trong danh bạ (SQL 108). CSDL chỉ cho Quản lý, Mua hàng, Kế toán ghi. */
export function VendorSheet({ open, vendor, readOnly, onClose, onSaved }: {
  open: boolean; vendor: Vendor | null; readOnly?: boolean; onClose: () => void; onSaved: (v: Vendor) => void;
}) {
  const [d, setD] = useState<Draft>(EMPTY);
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    if (!open) return;
    setErr("");
    setD(vendor ? {
      name: vendor.name, tax_code: vendor.tax_code ?? "", contact_name: vendor.contact_name ?? "", phone: vendor.phone ?? "",
      email: vendor.email ?? "", address: vendor.address ?? "", goods: vendor.goods ?? "", bank_name: vendor.bank_name ?? "",
      bank_account: vendor.bank_account ?? "", bank_holder: vendor.bank_holder ?? "", note: vendor.note ?? "", is_active: vendor.is_active ? "1" : "0",
    } : EMPTY);
  }, [open, vendor]);

  const set = (k: keyof Draft) => (e: { target: { value: string } }) => setD((x) => ({ ...x, [k]: e.target.value }));
  const tax = (d.tax_code ?? "").replace(/\s/g, "");
  const taxBad = !!tax && !/^\d{10}(\d{3})?$|^\d{10}-\d{3}$/.test(tax);

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (readOnly) return;
    if (d.name.trim().length < 2) { setErr("Nhập tên nhà cung cấp."); return; }
    if (taxBad) { setErr("Mã số thuế gồm 10 số, hoặc 13 số với chi nhánh."); return; }
    setBusy(true); setErr("");
    const row = {
      name: d.name.trim(), tax_code: nz(tax), contact_name: nz(d.contact_name), phone: nz(d.phone), email: nz(d.email),
      address: nz(d.address), goods: nz(d.goods), bank_name: nz(d.bank_name), bank_account: nz(d.bank_account),
      bank_holder: nz(d.bank_holder), note: nz(d.note), is_active: d.is_active === "1",
    };
    const q = vendor
      ? await supabase.from("purchase_vendors").update(row).eq("id", vendor.id).select("*").single()
      : await supabase.from("purchase_vendors").insert(row).select("*").single();
    setBusy(false);
    if (q.error) {
      setErr(q.error.code === "23505" ? "Đã có nhà cung cấp trùng tên hoặc mã số thuế trong danh bạ." : friendlyError(q.error));
      return;
    }
    onSaved(q.data as Vendor);
  }

  return (
    <Sheet open={open} onClose={onClose} title={vendor ? vendor.name : "Thêm nhà cung cấp"}>
      <form className="stack" onSubmit={submit}>
        <fieldset disabled={readOnly || busy} className="stack" style={{ border: 0, padding: 0, margin: 0, minWidth: 0 }}>
          <label className="field"><span>Tên nhà cung cấp</span><input className="input" value={d.name} onChange={set("name")} maxLength={200} required /></label>
          <label className="field"><span>Mã số thuế</span><input className="input" inputMode="numeric" value={d.tax_code ?? ""} onChange={set("tax_code")} maxLength={14} />
            {taxBad ? <small style={{ color: "var(--danger)" }}>10 số, hoặc 13 số với chi nhánh.</small> : null}</label>
          <label className="field"><span>Mặt hàng cung cấp</span><input className="input" placeholder="VD: thiết bị PCCC, điện nước" value={d.goods ?? ""} onChange={set("goods")} maxLength={300} /></label>
          <div className="row" style={{ gap: 8, flexWrap: "nowrap" }}>
            <label className="field" style={{ flex: 1 }}><span>Người liên hệ</span><input className="input" value={d.contact_name ?? ""} onChange={set("contact_name")} maxLength={100} /></label>
            <label className="field" style={{ flex: 1 }}><span>Số điện thoại</span><input className="input" inputMode="tel" value={d.phone ?? ""} onChange={set("phone")} maxLength={30} /></label>
          </div>
          <label className="field"><span>Email</span><input className="input" type="email" value={d.email ?? ""} onChange={set("email")} maxLength={120} /></label>
          <label className="field"><span>Địa chỉ</span><input className="input" value={d.address ?? ""} onChange={set("address")} maxLength={300} /></label>
          <div className="section-title" style={{ margin: "4px 0 0" }}>Tài khoản nhận tiền</div>
          <label className="field"><span>Ngân hàng</span><input className="input" value={d.bank_name ?? ""} onChange={set("bank_name")} maxLength={120} /></label>
          <div className="row" style={{ gap: 8, flexWrap: "nowrap" }}>
            <label className="field" style={{ flex: 1 }}><span>Số tài khoản</span><input className="input" inputMode="numeric" value={d.bank_account ?? ""} onChange={set("bank_account")} maxLength={40} /></label>
            <label className="field" style={{ flex: 1 }}><span>Chủ tài khoản</span><input className="input" value={d.bank_holder ?? ""} onChange={set("bank_holder")} maxLength={120} /></label>
          </div>
          <label className="field"><span>Ghi chú</span><textarea className="input" rows={2} value={d.note ?? ""} onChange={set("note")} maxLength={500} /></label>
          {vendor ? (
            <label className="field"><span>Tình trạng</span>
              <Combo value={d.is_active} options={[["1", "Đang giao dịch"], ["0", "Ngừng giao dịch"]] as const} onChange={(v) => setD((x) => ({ ...x, is_active: v }))} /></label>
          ) : null}
          {err ? <div className="error-box" role="alert">{err}</div> : null}
          {readOnly ? null : <button className="btn block">{busy ? "Đang lưu…" : "Lưu nhà cung cấp"}</button>}
        </fieldset>
      </form>
    </Sheet>
  );
}
