import { useEffect, useState } from "react";
import { supabase } from "./supabase";
import { useSession } from "./session";

/** Sửa được dữ liệu toà (phòng, khách thuê, CCCD, hợp đồng): Quản lý, Giám sát toà, hoặc sale phòng Kinh doanh phụ trách toà.
 *  Hỏi CSDL (can_edit_building) để khớp quyền thật. */
export function useCanEditBuilding(buildingId?: string | null) {
  const { isManager, isSupervisor, myBuildingIds } = useSession();
  const mine = !!buildingId && myBuildingIds.includes(buildingId);
  const quick = isManager || (isSupervisor && mine);
  const [sale, setSale] = useState(false);
  useEffect(() => {
    if (!buildingId || quick || !mine) { setSale(false); return; }
    let live = true;
    supabase.rpc("can_edit_building", { b: buildingId }).then(({ data }) => { if (live) setSale(!!data); });
    return () => { live = false; };
  }, [buildingId, quick, mine]);
  return quick || sale;
}
