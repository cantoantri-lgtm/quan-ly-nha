import { useEffect, useMemo, useState } from "react";
import { useParams } from "react-router-dom";
import { friendlyError, supabase } from "../lib/supabase";
import { useSession } from "../lib/session";
import { ddmmyyyy, todayVN } from "../lib/dates";
import { naturalCompare, vnd } from "../lib/money";
import { Empty, TopBar } from "../components/ui";
import { vehicleText, type VehicleKind } from "../lib/vehicles";
import { saveWorkbook } from "../lib/xlsx";

/** Danh sách khách ở theo toà: mỗi phòng một dòng (người đứng tên, người ở cùng, SĐT, xe, hợp đồng). SQL 090: building_roster */
type Person = { name: string; phone: string | null };
type Veh = { kind: VehicleKind; model: string | null; plate: string | null };
type Row = {
  contract_id: string; room_code: string; floor: number | null; contract_code: string | null; start_date: string; end_date: string | null;
  rent: number; deposit: number; holder_name: string; holder_phone: string | null; occupants: Person[]; vehicles: Veh[];
};
type RoomLite = { id: string; code: string; floor: number | null; status: string };

export default function Roster() {
  const { id = "" } = useParams();
  const { buildings, toast } = useSession();
  const b = buildings.find((x: { id: string }) => x.id === id);
  const [rows, setRows] = useState<Row[] | null>(null);
  const [rooms, setRooms] = useState<RoomLite[]>([]);
  const [err, setErr] = useState("");
  const [q, setQ] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    Promise.all([
      supabase.rpc("building_roster", { p_building: id }),
      supabase.from("rooms").select("id,code,floor,status").eq("building_id", id),
    ]).then(([r, m]) => {
      if (r.error) setErr(friendlyError(r.error)); else setRows((r.data as Row[]) ?? []);
      setRooms((m.data as RoomLite[]) ?? []);
    });
  }, [id]);

  // Phòng đang thuê + phòng trống, xếp theo tầng rồi mã phòng
  const list = useMemo(() => {
    const taken = new Set((rows ?? []).map((r) => r.room_code));
    const empty = rooms.filter((r) => !taken.has(r.code)).map((r) => ({ kind: "empty" as const, room_code: r.code, floor: r.floor, status: r.status }));
    const all = [...(rows ?? []).map((r) => ({ kind: "rent" as const, ...r })), ...empty];
    all.sort((a, b2) => (a.floor ?? 999) - (b2.floor ?? 999) || naturalCompare(a.room_code, b2.room_code));
    const k = q.trim().toLowerCase();
    if (!k) return all;
    return all.filter((r) => r.kind === "rent" && [r.room_code, r.holder_name, r.holder_phone, ...r.occupants.flatMap((o) => [o.name, o.phone]), ...r.vehicles.map((v) => v.plate)]
      .some((x) => (x ?? "").toLowerCase().includes(k)));
  }, [rows, rooms, q]);

  const stat = useMemo(() => {
    const r = rows ?? [];
    return { rooms: r.length, people: r.reduce((n, x) => n + 1 + x.occupants.length, 0), veh: r.reduce((n, x) => n + x.vehicles.length, 0) };
  }, [rows]);

  async function download() {
    if (!rows) return;
    setBusy(true);
    try {
      const { Workbook } = await import("exceljs");
      const wb = new Workbook();
      const ws = wb.addWorksheet("Khách ở");
      ws.columns = [
        { header: "STT", width: 6 }, { header: "Phòng", width: 8 }, { header: "Người đứng tên", width: 24 },
        { header: "SĐT", width: 14, style: { numFmt: "@" } }, { header: "Người ở cùng (SĐT)", width: 40 },
        { header: "Xe đăng ký (biển số · dòng xe · loại)", width: 44 }, { header: "Số HĐ", width: 14 },
        { header: "Ngày ký HĐ", width: 12 }, { header: "Ngày kết thúc HĐ", width: 14 },
        { header: "Tiền phòng", width: 14, style: { numFmt: "#,##0" } }, { header: "Tiền cọc", width: 14, style: { numFmt: "#,##0" } }, { header: "Ghi chú", width: 12 },
      ];
      ws.getRow(1).font = { bold: true };
      list.forEach((r, i) => {
        if (r.kind === "empty") { ws.addRow([i + 1, r.room_code, "", "", "", "", "", "", "", null, null, "trống"]); return; }
        ws.addRow([i + 1, r.room_code, r.holder_name, r.holder_phone ?? "",
          r.occupants.map((o) => o.phone ? `${o.name} (${o.phone})` : o.name).join(", "),
          r.vehicles.map(vehicleText).join("; "), r.contract_code ?? "",
          ddmmyyyy(r.start_date), r.end_date ? ddmmyyyy(r.end_date) : "", Number(r.rent), Number(r.deposit), ""]);
      });
      ws.views = [{ state: "frozen", ySplit: 1 }];
      await saveWorkbook(wb, `Khach-o_${b?.code ?? "toa"}_${todayVN()}.xlsx`);
    } catch (e) { toast((e as Error).message); }
    setBusy(false);
  }

  return (
    <>
      <TopBar title={`Khách ở · ${b?.code ?? ""}`} back />
      <main className="main stack">
        {err ? <div className="error-box" role="alert">{err}</div> : null}
        {rows === null && !err ? <div className="loading">Đang tải…</div> : null}
        {rows ? (
          <>
            <p className="muted small" style={{ margin: 0 }}>
              {stat.rooms} phòng đang thuê · {stat.people} người ở · {stat.veh} xe đăng ký. Thêm người ở và xe trong từng hợp đồng.
            </p>
            <div className="row" style={{ flexWrap: "nowrap", gap: 8 }}>
              <input className="input" style={{ flex: 1 }} placeholder="Tìm phòng, tên, SĐT, biển số" value={q} onChange={(e) => setQ(e.target.value)} />
              <button className="btn secondary sm" disabled={busy || !list.length} onClick={download}>{busy ? "Đang tạo…" : "Tải Excel"}</button>
            </div>
            {list.length === 0 ? <Empty title="Không có phòng nào khớp." /> : null}
            {list.map((r) => r.kind === "empty" ? (
              <div key={`e-${r.room_code}`} className="card" style={{ padding: "8px 12px" }}>
                <b>P.{r.room_code}</b> <span className="muted small">· {r.status === "trong" ? "trống" : "chưa có hợp đồng"}</span>
              </div>
            ) : (
              <div key={r.contract_id} className="card stack" style={{ padding: 12, gap: 4 }}>
                <div className="row" style={{ justifyContent: "space-between", flexWrap: "nowrap" }}>
                  <b>P.{r.room_code}</b>
                  <span className="num small">{vnd(r.rent)}/tháng</span>
                </div>
                <div className="small"><b>{r.holder_name}</b>{r.holder_phone ? <> · <a href={`tel:${r.holder_phone}`}>{r.holder_phone}</a></> : <span style={{ color: "var(--danger)" }}> · chưa có SĐT</span>}</div>
                {r.occupants.length ? <div className="small muted">Ở cùng: {r.occupants.map((o) => o.phone ? `${o.name} (${o.phone})` : o.name).join(", ")}</div> : null}
                <div className="small">{r.vehicles.length ? `Xe: ${r.vehicles.map(vehicleText).join("; ")}` : <span className="muted">Chưa đăng ký xe</span>}</div>
                <div className="small muted">HĐ {r.contract_code ?? ""} · {ddmmyyyy(r.start_date)} → {r.end_date ? ddmmyyyy(r.end_date) : "chưa có ngày kết thúc"} · cọc {vnd(r.deposit)}</div>
              </div>
            ))}
          </>
        ) : null}
      </main>
    </>
  );
}
