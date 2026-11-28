import { useEffect, useMemo, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { useSession } from "../lib/session";
import { Combo, Empty, TopBar } from "../components/ui";
import RoomUtilities from "./RoomUtilities";

const KEY = "ghi-dien-toa";
const remembered = () => { try { return localStorage.getItem(KEY) ?? ""; } catch { return ""; } };

/** Ghi số điện phòng từ menu: chọn toà rồi ghi số từng phòng (dùng lại bảng của trang toà). */
export default function ElecEntry() {
  const { buildings, myBuildingIds } = useSession();
  const [params, setParams] = useSearchParams();
  const options = useMemo(() => buildings.map((b) => [b.id, `${b.code} · ${b.name}`] as const), [buildings]);
  const pick = params.get("toa") ?? "";
  const valid = (id: string) => buildings.some((b) => b.id === id);

  // Mở lần đầu: toà đã chọn lần trước, nếu không thì toà mình phụ trách (khi chỉ có một), hoặc toà duy nhất
  const [id, setId] = useState("");
  useEffect(() => {
    if (!buildings.length) return;
    const mine = buildings.filter((b) => myBuildingIds.includes(b.id));
    const first = [pick, remembered()].find(valid)
      ?? (mine.length === 1 ? mine[0].id : buildings.length === 1 ? buildings[0].id : "");
    setId(first);
  }, [buildings]); // eslint-disable-line react-hooks/exhaustive-deps

  function choose(v: string) {
    setId(v);
    try { localStorage.setItem(KEY, v); } catch { /* bỏ qua */ }
    setParams({ toa: v }, { replace: true });
  }

  return (
    <>
      <TopBar title="Ghi số điện phòng" />
      <main className="main stack">
        <label className="field"><span>Toà nhà</span>
          <Combo id="gd-toa" value={id} options={options} onChange={choose} label="Toà nhà" placeholder="— Chọn toà —" />
        </label>
        {!buildings.length ? <Empty title="Chưa có toà nào">Bạn chưa được giao toà nào.</Empty>
          : id ? <RoomUtilities key={id} buildingId={id} embedded />
          : <p className="muted small" style={{ margin: 0 }}>Chọn toà để hiện danh sách phòng và ô ghi số đồng hồ điện.</p>}
      </main>
    </>
  );
}
