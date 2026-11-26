import { useCallback, useEffect, useMemo, useState, type FormEvent } from "react";
import { friendlyError, supabase } from "../lib/supabase";
import { useSession } from "../lib/session";
import { ddmmyyyy, todayVN } from "../lib/dates";
import { LEVEL_SHORT, STATUS_LABEL } from "../lib/org";
import { saveWorkbook } from "../lib/xlsx";
import { Avatar, Empty, Sheet } from "../components/ui";

/** Một dòng từ hr_staff_list(): nhân sự đang làm theo Sơ đồ công ty, kèm ngày sinh và CCCD. Không có lương. */
export type StaffRec = {
  staff_id: string; staff_code: string | null; profile_id: string | null; full_name: string | null; job_title: string | null; department: string | null; team: string | null;
  level: number | null; rank: number | null; status: string; duty: string | null; is_leader: boolean; trial_end: string | null;
  phone: string | null; has_account: boolean; account_active: boolean;
  birth_date: string | null; id_number: string | null; personal_updated_at: string | null;
};

const DUTY_SHORT: Record<string, string> = { giam_doc: "Giám đốc", ke_toan: "Kế toán", nhan_su: "Nhân sự" };

function age(birth: string | null): number | null {
  if (!birth) return null;
  const [y, m, d] = birth.split("-").map(Number);
  const [ty, tm, td] = todayVN().split("-").map(Number);
  return ty - y - (tm < m || (tm === m && td < d) ? 1 : 0);
}
const maskId = (s: string | null) => (s ? `•••${s.slice(-4)}` : "");
const missing = (r: StaffRec) => !r.staff_code || !r.birth_date || !r.id_number;

/** Một dòng sheet "TÀI KHOẢN APP" (chỉ Quản lý) */
export type AccountRow = { code: string; name: string; phone: string; role: string; buildings: string; leave: number | null; active: boolean };

const OLIVE = "FF6B7A2F";
function headRow(ws: import("exceljs").Worksheet, head: string[]) {
  const h = ws.addRow(head);
  h.eachCell((c) => {
    c.font = { bold: true, color: { argb: "FFFFFFFF" } };
    c.fill = { type: "pattern", pattern: "solid", fgColor: { argb: OLIVE } };
    c.alignment = { vertical: "middle", wrapText: true };
  });
  ws.views = [{ state: "frozen", ySplit: h.number }];
  ws.autoFilter = { from: { row: h.number, column: 1 }, to: { row: h.number, column: head.length } };
}
const byCode = (a: string | null, b: string | null) => (a && b ? a.localeCompare(b, "vi", { numeric: true }) : a ? -1 : b ? 1 : 0);

/** Tải Excel trang Nhân sự: sheet HỒ SƠ NHÂN SỰ (Quản lý, Nhân sự) và TÀI KHOẢN APP (chỉ Quản lý). Không có lương. */
export async function exportStaff(rows: StaffRec[], accounts?: AccountRow[]) {
  const { Workbook } = await import("exceljs");
  const wb = new Workbook();
  const today = todayVN();
  const yellow = { type: "pattern" as const, pattern: "solid" as const, fgColor: { argb: "FFFFF2CC" } };

  const ws = wb.addWorksheet("HỒ SƠ NHÂN SỰ");
  ws.addRow([`DANH SÁCH NHÂN SỰ NEXT VISION · NGÀY ${ddmmyyyy(today)}`]).font = { bold: true, size: 13 };
  ws.addRow(["CONFIDENTIAL: có ngày sinh và số CCCD (dữ liệu cá nhân theo Nghị định 13/2023). Chỉ dùng cho bộ phận Nhân sự."]).font = { italic: true, color: { argb: "FFC00000" } };
  ws.addRow([]);
  const head = ["STT", "Mã NV", "Họ tên", "Phòng", "Bộ phận", "Vị trí", "Cấp", "Rank", "Tình trạng", "Hết thử việc", "Nhiệm vụ", "Số điện thoại", "Ngày sinh", "Tuổi", "Số CCCD", "Tài khoản app"];
  headRow(ws, head);
  rows.forEach((r, i) => {
    const row = ws.addRow([
      i + 1, r.staff_code ?? "", r.full_name ?? "(chưa có tên)", r.department ?? "", r.team ?? "", r.job_title ?? "",
      r.level ? LEVEL_SHORT[r.level] ?? `L${r.level}` : "", r.rank ?? "", STATUS_LABEL[r.status] ?? r.status,
      r.trial_end ? ddmmyyyy(r.trial_end) : "", [r.is_leader ? "Leader" : "", r.duty ? DUTY_SHORT[r.duty] ?? r.duty : ""].filter(Boolean).join(", "),
      r.phone ?? "", r.birth_date ? new Date(`${r.birth_date}T00:00:00Z`) : "", age(r.birth_date) ?? "",
      r.id_number ?? "", r.has_account ? (r.account_active ? "Có" : "Đã khoá") : "Chưa có",
    ]);
    row.getCell(13).numFmt = "dd/mm/yyyy";
    row.getCell(15).numFmt = "@";
    if (!r.staff_code) row.getCell(2).fill = yellow;
    if (!r.birth_date) row.getCell(13).fill = yellow;
    if (!r.id_number) row.getCell(15).fill = yellow;
  });
  [6, 9, 26, 18, 16, 24, 13, 7, 12, 12, 14, 14, 12, 7, 15, 13].forEach((w, i) => { ws.getColumn(i + 1).width = w; });

  if (accounts) {
    const wa = wb.addWorksheet("TÀI KHOẢN APP");
    wa.addRow([`TÀI KHOẢN APP NEXT LIVING · NGÀY ${ddmmyyyy(today)}`]).font = { bold: true, size: 13 };
    wa.addRow([]);
    headRow(wa, ["STT", "Mã NV", "Họ tên", "SĐT đăng nhập", "Vai trò", "Toà phụ trách", "Phép năm (ngày)", "Trạng thái"]);
    [...accounts].sort((a, b) => byCode(a.code || null, b.code || null) || a.name.localeCompare(b.name, "vi")).forEach((a, i) => {
      wa.addRow([i + 1, a.code, a.name, a.phone, a.role, a.buildings, a.leave ?? "", a.active ? "Đang hoạt động" : "Đã khoá"]);
    });
    [6, 9, 26, 14, 14, 30, 10, 15].forEach((w, i) => { wa.getColumn(i + 1).width = w; });
  }
  await saveWorkbook(wb, `Nhan-su_${today}.xlsx`);
}

/** Gọi hr_staff_list (chỉ Quản lý, Nhân sự). */
export function useStaffRecs(enabled: boolean) {
  const [rows, setRows] = useState<StaffRec[] | null>(null);
  const [err, setErr] = useState("");
  const load = useCallback(async () => {
    if (!enabled) { setRows([]); return; }
    const { data, error } = await supabase.rpc("hr_staff_list");
    if (error) { setErr(friendlyError(error)); setRows([]); return; }
    setErr(""); setRows((data ?? []) as StaffRec[]);
  }, [enabled]);
  useEffect(() => { load(); }, [load]);
  return { rows, err, load };
}

/** Tab "Hồ sơ" trong trang Nhân sự */
export function StaffRecordsPanel({ rows, err, reload }: { rows: StaffRec[] | null; err: string; reload: () => Promise<void> }) {
  const { toast } = useSession();
  const [q, setQ] = useState("");
  const [onlyMissing, setOnlyMissing] = useState(false);
  const [editing, setEditing] = useState<StaffRec | null>(null);

  const all = rows ?? [];
  const nMissing = all.filter(missing).length;
  const nextCode = useMemo(() => {
    const max = all.reduce((m, r) => Math.max(m, Number(r.staff_code?.slice(2) ?? 0) || 0), 0);
    return `NV${String(max + 1).padStart(2, "0")}`;
  }, [all]);
  const shown = useMemo(() => {
    const k = q.trim().toLowerCase(); const digits = q.replace(/\D/g, "");
    return all.filter((r) => (!onlyMissing || missing(r)) && (!k ||
      (r.full_name ?? "").toLowerCase().includes(k) || (r.job_title ?? "").toLowerCase().includes(k) ||
      (r.staff_code ?? "").toLowerCase().includes(k) || (r.department ?? "").toLowerCase().includes(k) ||
      (digits.length >= 3 && ((r.phone ?? "").includes(digits) || (r.id_number ?? "").includes(digits)))));
  }, [all, q, onlyMissing]);
  const groups = useMemo(() => {
    const m = new Map<string, StaffRec[]>();
    shown.forEach((r) => { const d = r.department ?? "Chưa xếp phòng"; m.set(d, [...(m.get(d) ?? []), r]); });
    return [...m.entries()];
  }, [shown]);

  return (
    <>
      <input className="input" placeholder="Tìm theo mã NV, tên, vị trí, phòng, SĐT, CCCD" value={q} onChange={(e) => setQ(e.target.value)} />
      <div className="chips">
        <button className="chip" aria-pressed={!onlyMissing} onClick={() => setOnlyMissing(false)}>Tất cả<span className="n">{all.length}</span></button>
        <button className="chip" aria-pressed={onlyMissing} onClick={() => setOnlyMissing(true)}>Thiếu mã / ngày sinh / CCCD<span className="n">{nMissing}</span></button>
      </div>
      {err && <div className="card" style={{ padding: 12, color: "var(--danger)" }}>{err}</div>}
      {rows === null ? <p className="muted">Đang tải…</p> : shown.length === 0 ? (
        <Empty title={onlyMissing ? "Hồ sơ đã đủ" : "Không có ai khớp"}>{onlyMissing ? "Mọi nhân sự đều đã có mã, ngày sinh và CCCD." : "Thử từ khoá khác."}</Empty>
      ) : groups.map(([dept, list]) => (
        <section key={dept}>
          <div className="section-title">{dept} · {list.length}</div>
          <div className="card">
            {list.map((r) => {
              const a = age(r.birth_date);
              return (
                <div key={r.staff_id} className="list-row" role="button" tabIndex={0}
                  onClick={() => setEditing(r)} onKeyDown={(e) => e.key === "Enter" && setEditing(r)}>
                  <Avatar name={r.full_name ?? "?"} />
                  <div className="grow">
                    <div className="name">{r.staff_code ? <span className="staff-code">{r.staff_code}</span> : null}{r.full_name ?? "(chưa có tên)"}</div>
                    <div className="sub">{[r.job_title, STATUS_LABEL[r.status], r.phone].filter(Boolean).join(" · ")}</div>
                    <div className="sub" style={missing(r) ? { color: "var(--soon)" } : undefined}>
                      {[!r.staff_code && "Thiếu mã NV",
                        r.birth_date ? `${ddmmyyyy(r.birth_date)}${a != null ? ` · ${a} tuổi` : ""}` : "Thiếu ngày sinh",
                        r.id_number ? `CCCD ${maskId(r.id_number)}` : "Thiếu CCCD"].filter(Boolean).join(" · ")}
                    </div>
                  </div>
                  <span className="muted" aria-hidden>›</span>
                </div>
              );
            })}
          </div>
        </section>
      ))}
      <PersonalSheet rec={editing} nextCode={nextCode} onClose={() => setEditing(null)} onSaved={async () => { setEditing(null); await reload(); toast("Đã lưu hồ sơ"); }} />
    </>
  );
}

function PersonalSheet({ rec, nextCode, onClose, onSaved }: { rec: StaffRec | null; nextCode: string; onClose: () => void; onSaved: () => void }) {
  const [code, setCode] = useState("");
  const [birth, setBirth] = useState("");
  const [idn, setIdn] = useState("");
  const [err, setErr] = useState("");
  const [saving, setSaving] = useState(false);
  useEffect(() => { setCode(rec?.staff_code ?? ""); setBirth(rec?.birth_date ?? ""); setIdn(rec?.id_number ?? ""); setErr(""); }, [rec]);

  const today = todayVN();
  const maxBirth = `${Number(today.slice(0, 4)) - 15}${today.slice(4, 7)}-${today.slice(5, 7) === "02" && today.slice(8) === "29" ? "28" : today.slice(8)}`;
  const digits = idn.replace(/\D/g, "");
  const idBad = digits.length > 0 && digits.length !== 12 && digits.length !== 9;
  const codeN = code.trim().toUpperCase();
  const codeBad = codeN !== "" && !/^NV\d{2,4}$/.test(codeN);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (!rec || idBad || codeBad) return;
    setSaving(true); setErr("");
    const { error } = await supabase.rpc("staff_personal_save", { p_staff: rec.staff_id, p_code: codeN || null, p_birth: birth || null, p_id_number: digits || null });
    setSaving(false);
    if (error) { setErr(friendlyError(error)); return; }
    onSaved();
  };

  return (
    <Sheet open={!!rec} onClose={onClose} title={rec?.full_name ?? "Hồ sơ nhân sự"}>
      {rec && (
        <form className="stack" onSubmit={submit}>
          <div className="muted" style={{ fontSize: 13.5 }}>
            {[rec.job_title, rec.department, rec.team, STATUS_LABEL[rec.status]].filter(Boolean).join(" · ")}
            {rec.trial_end ? ` · hết thử việc ${ddmmyyyy(rec.trial_end)}` : ""}
          </div>
          <label className="field"><span>Mã nhân viên</span>
            <div className="row" style={{ flexWrap: "nowrap" }}>
              <input className="input mono" autoComplete="off" placeholder={nextCode} maxLength={6} style={{ maxWidth: 140 }}
                value={code} onChange={(e) => setCode(e.target.value.toUpperCase())} />
              {!code && <button type="button" className="btn secondary sm" onClick={() => setCode(nextCode)}>Dùng {nextCode}</button>}
            </div>
            {codeBad && <small style={{ color: "var(--danger)" }}>Mã dạng NV kèm số, ví dụ {nextCode}.</small>}
          </label>
          <label className="field"><span>Ngày sinh</span>
            <input className="input" type="date" min="1940-01-01" max={maxBirth} value={birth} onChange={(e) => setBirth(e.target.value)} />
          </label>
          <label className="field"><span>Số CCCD</span>
            <input className="input" inputMode="numeric" autoComplete="off" placeholder="12 chữ số" maxLength={15}
              value={idn} onChange={(e) => setIdn(e.target.value.replace(/[^\d ]/g, ""))} />
            {idBad && <small style={{ color: "var(--danger)" }}>CCCD gồm 12 chữ số (CMND cũ 9 chữ số). Đang có {digits.length}.</small>}
          </label>
          {rec.personal_updated_at && <small className="muted">Cập nhật lần cuối {ddmmyyyy(rec.personal_updated_at.slice(0, 10))}</small>}
          {err && <div style={{ color: "var(--danger)", fontSize: 14 }}>{err}</div>}
          <button className="btn block" disabled={saving || idBad || codeBad}>{saving ? "Đang lưu…" : "Lưu"}</button>
        </form>
      )}
    </Sheet>
  );
}
