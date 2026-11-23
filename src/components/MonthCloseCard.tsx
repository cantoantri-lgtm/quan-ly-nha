import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { friendlyError } from "../lib/supabase";
import { mmyyyy, todayVN } from "../lib/dates";
import { groupByBuilding, loadMonthClose, mcIs, MC_LABEL, notClosedWhy, type MCKey, type MCRow } from "../lib/monthClose";
import { Icon } from "./ui";

const HOME_KEYS: MCKey[] = ["chua_dien", "chua_chot", "chua_thu", "chua_hd", "thieu_cccd"];

/** Đường dẫn để xử lý từng loại việc của một toà */
export function mcLink(buildingId: string, k: MCKey, r?: MCRow): string {
  if (k === "chua_dien") return `/toa/${buildingId}/dien-phong`;
  if (k === "chua_hd") return `/toa/${buildingId}/hop-dong`;
  if (k === "thieu_cccd") return r?.contract_id ? `/toa/${buildingId}/hop-dong?mo=${r.contract_id}` : `/toa/${buildingId}/hop-dong`;
  return `/toa/${buildingId}/hoa-don`;
}

/** Trang chủ: việc chốt tháng theo toà. Ghi điện ngày 28 đến cuối tháng, thu tiền nhà ngày 1 đến ngày 3. */
export default function MonthCloseCard() {
  const [rows, setRows] = useState<MCRow[] | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const day = Number(todayVN().slice(8, 10));
  const [f, setF] = useState<MCKey | null>(null);

  useEffect(() => {
    loadMonthClose().then(({ rows, error }) => {
      if (error) setErr(friendlyError(error));
      setRows(rows);
    });
  }, []);

  const groups = useMemo(() => groupByBuilding(rows ?? []), [rows]);
  const total = (k: MCKey) => groups.reduce((t, g) => t + g.count[k], 0);
  // Mặc định: từ ngày 28 xem phòng chưa ghi điện, các ngày khác xem phòng chưa thu tiền
  const key: MCKey = f ?? (day >= 28 ? "chua_dien" : total("chua_thu") ? "chua_thu" : total("chua_chot") ? "chua_chot" : "chua_dien");

  if (rows === null && !err) return null;
  if (!err && rows && rows.length === 0) return null;   // không phụ trách toà nào có phòng thuê tháng
  const meterP = rows?.[0]?.meter_period, rentP = rows?.[0]?.rent_period;
  const hint = day >= 28 ? `Kỳ ghi điện tháng ${meterP ? mmyyyy(meterP) : ""}: ghi số đồng hồ từ ngày 28 đến cuối tháng.`
    : day <= 3 ? `Kỳ thu tiền nhà tháng ${rentP ? mmyyyy(rentP) : ""}: thu từ ngày 1 đến ngày 3.`
    : `Tiền nhà tháng ${rentP ? mmyyyy(rentP) : ""}, số điện tháng ${meterP ? mmyyyy(meterP) : ""}.`;
  const list = groups.filter((g) => g.count[key] > 0);

  return (
    <section className="pg-card" aria-label="Chốt tháng theo toà">
      <div className="pg-head">
        <span className="pg-ico">{Icon.building}</span>
        <div className="grow"><h2>Chốt tháng</h2><p>{hint}</p></div>
        <Link to="/bao-cao?tab=chot_thang" className="btn ghost sm">Xem báo cáo</Link>
      </div>
      {err ? <div className="error-box" style={{ margin: "12px 16px" }}>{err}</div> : null}
      <div className="tiles" role="group" aria-label="Lọc việc chốt tháng">
        {HOME_KEYS.map((k) => (
          <button key={k} className={`tile${total(k) && k !== "thieu_cccd" && k !== "chua_hd" ? " tile-late" : ""}`} aria-pressed={key === k} onClick={() => setF(k)}>
            <b>{total(k)}</b> {MC_LABEL[k]}
          </button>
        ))}
      </div>
      {list.length === 0 ? (
        <div className="dt-empty"><b>Không còn phòng nào ở mục “{MC_LABEL[key]}”</b></div>
      ) : (
        <div className="dt-wrap">
          <table className="dt cards">
            <thead><tr><th>Toà</th><th>Phòng</th><th>Thao tác</th></tr></thead>
            <tbody>
              {list.map((g) => {
                const rs = g.rows.filter((r) => mcIs(r, key));
                return (
                  <tr key={g.id}>
                    <td data-label="Toà"><div className="t1">{g.code}</div><div className="t2 num">{rs.length}/{g.rooms} phòng</div></td>
                    <td data-label="Phòng">
                      <div className="mc-rooms">
                        {rs.map((r) => (
                          <span key={r.room_id} className="mc-room" title={roomTip(r, key)}>
                            <b className="num">{r.room_code}</b>{roomNote(r, key) ? <small> {roomNote(r, key)}</small> : null}
                          </span>
                        ))}
                      </div>
                    </td>
                    <td data-label="Thao tác"><Link className="dt-link" to={mcLink(g.id, key, rs[0])}>{ACTION[key]}</Link></td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}

const ACTION: Record<MCKey, string> = {
  chua_dien: "Ghi số điện", chua_chot: "Mở hoá đơn", chua_thu: "Thu tiền", chua_hd: "Lập hợp đồng", thieu_cccd: "Bổ sung CCCD", da_thu: "Xem hoá đơn",
};

function roomNote(r: MCRow, k: MCKey): string {
  if (k === "chua_chot") return notClosedWhy(r);
  if (k === "thieu_cccd") return `${r.cccd_missing}/${r.occupants} người`;
  return "";
}
function roomTip(r: MCRow, k: MCKey): string {
  return [r.tenant_name, roomNote(r, k)].filter(Boolean).join(" · ");
}
