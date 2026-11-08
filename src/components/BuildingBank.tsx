import { useEffect, useState, type FormEvent } from "react";
import { friendlyError, supabase } from "../lib/supabase";
import { useSession } from "../lib/session";
import { BANKS, type PaySettings } from "../lib/vietqr";

/** Tài khoản nhận tiền riêng của từng toà (Quản lý cài). Dùng để tạo QR thu tiền thuê + cọc. */
export default function BuildingBank({ buildingId }: { buildingId: string }) {
  const { toast } = useSession();
  const [bin, setBin] = useState(BANKS[0].bin);
  const [customBin, setCustomBin] = useState("");
  const [customName, setCustomName] = useState("");
  const [acct, setAcct] = useState("");
  const [holder, setHolder] = useState("");
  const [has, setHas] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    supabase.from("building_bank_accounts").select("*").eq("building_id", buildingId).maybeSingle().then(({ data }) => {
      const d = data as (PaySettings & { building_id: string }) | null;
      if (d) {
        const known = BANKS.some((b) => b.bin === d.bank_bin);
        setBin(known ? d.bank_bin : "khac");
        if (!known) { setCustomBin(d.bank_bin); setCustomName(d.bank_name); }
        setAcct(d.account_no); setHolder(d.account_name); setHas(true);
      }
      setLoaded(true);
    });
  }, [buildingId]);

  async function save(e: FormEvent) {
    e.preventDefault(); setErr(null);
    const finalBin = bin === "khac" ? customBin.trim() : bin;
    const bankName = bin === "khac" ? customName.trim() : BANKS.find((b) => b.bin === bin)!.name;
    const acc = acct.replace(/\s/g, "");
    if (!/^\d{6}$/.test(finalBin)) { setErr("Mã BIN ngân hàng gồm 6 chữ số."); return; }
    if (!/^\d{6,19}$/.test(acc)) { setErr("Số tài khoản gồm 6–19 chữ số."); return; }
    if (!bankName) { setErr("Nhập tên ngân hàng."); return; }
    if (!holder.trim()) { setErr("Nhập tên chủ tài khoản."); return; }
    setBusy(true);
    const { error } = await supabase.from("building_bank_accounts").upsert({ building_id: buildingId, bank_bin: finalBin, bank_name: bankName, account_no: acc, account_name: holder.trim().toUpperCase() });
    setBusy(false);
    if (error) { setErr(friendlyError(error)); return; }
    setHas(true); toast("Đã lưu tài khoản nhận tiền của toà.");
  }

  async function clear() {
    setBusy(true);
    const { error } = await supabase.from("building_bank_accounts").delete().eq("building_id", buildingId);
    setBusy(false);
    if (error) { setErr(friendlyError(error)); return; }
    setHas(false); setAcct(""); setHolder(""); toast("Đã xoá. Toà này sẽ dùng tài khoản chung.");
  }

  return (
    <section className="stack bbank" style={{ borderTop: "1px solid var(--line)", paddingTop: 14, marginTop: 6 }}>
      <b>Tài khoản nhận tiền của toà</b>
      <p className="muted small" style={{ margin: 0 }}>Dùng để tạo mã QR thu tiền thuê và tiền cọc trong hợp đồng. Để trống thì dùng tài khoản chung (Quản trị → Thu tiền).</p>
      {!loaded ? <div className="loading">Đang tải…</div> : (
        <form className="stack" onSubmit={save}>
          <label className="field"><span>Ngân hàng</span>
            <select id="bb-bank" className="input" value={bin} onChange={(e) => setBin(e.target.value)}>
              {BANKS.map((b) => <option key={b.bin} value={b.bin}>{b.name}</option>)}
              <option value="khac">Ngân hàng khác…</option>
            </select></label>
          {bin === "khac" ? (
            <div className="row" style={{ alignItems: "flex-start" }}>
              <label className="field" style={{ flex: "1 1 120px" }}><span>Mã BIN (6 số)</span><input id="bb-bin" className="input num" inputMode="numeric" value={customBin} onChange={(e) => setCustomBin(e.target.value.replace(/\D/g, ""))} /></label>
              <label className="field" style={{ flex: "1 1 160px" }}><span>Tên ngân hàng</span><input id="bb-bname" className="input" value={customName} onChange={(e) => setCustomName(e.target.value)} /></label>
            </div>
          ) : null}
          <label className="field"><span>Số tài khoản</span><input id="bb-acct" className="input num" inputMode="numeric" value={acct} onChange={(e) => setAcct(e.target.value)} /></label>
          <label className="field"><span>Tên chủ tài khoản (không dấu)</span><input id="bb-holder" className="input" value={holder} onChange={(e) => setHolder(e.target.value)} placeholder="CONG TY ..." /></label>
          {err ? <div className="error-box" role="alert">{err}</div> : null}
          <div className="row">
            <button className="btn" disabled={busy} style={{ flex: 1 }}>{busy ? "Đang lưu…" : "Lưu tài khoản toà"}</button>
            {has ? <button type="button" className="btn ghost" disabled={busy} onClick={clear}>Xoá</button> : null}
          </div>
        </form>
      )}
    </section>
  );
}
