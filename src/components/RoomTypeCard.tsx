import { useEffect, useState } from "react";
import { fileUrls, listFiles, type StoredFile } from "../lib/files";
import { furnitureList, type RoomType } from "../lib/roomTypes";
import { vnd } from "../lib/money";
import FileGallery from "./FileGallery";
import "../roomtype.css";

/** Thông tin loại phòng: ảnh đại diện, diện tích, nội thất, giá. Hiện khi mở một phòng. */
export default function RoomTypeCard({ type }: { type: RoomType }) {
  const [hero, setHero] = useState<string | null>(null);
  const [count, setCount] = useState(0);

  useEffect(() => {
    let off = false;
    setHero(null);
    listFiles("anh_loai_phong", "room_type_id", type.id).then(async (list) => {
      if (off) return;
      const imgs = list.filter((f: StoredFile) => f.mime_type?.startsWith("image/"));
      setCount(imgs.length);
      const first = imgs.find((f) => f.is_cover) ?? imgs[0];
      if (!first) return;
      const m = await fileUrls([first], "thumb");
      if (!off) setHero(m[first.id] ?? null);
    });
    return () => { off = true; };
  }, [type.id]);

  const items = furnitureList(type.furniture);
  return (
    <section className="rtc" aria-label={`Loại phòng ${type.name}`}>
      {hero ? <img className="rtc-hero" src={hero} alt={`Ảnh đại diện loại ${type.name}`} decoding="async" />
        : <div className="rtc-hero rtc-none">Loại này chưa có ảnh</div>}
      <div className="rtc-body">
        <div className="rtc-head">
          <b>{type.name}</b>
          <span className="rtc-price num">{type.list_price != null ? vnd(type.list_price) : "Chưa có giá"}{type.rent_mode === "dem" ? "/đêm" : "/tháng"}</span>
        </div>
        <div className="rtc-specs small">
          {type.area_m2 != null ? <span>{String(type.area_m2).replace(".", ",")} m²</span> : null}
          {type.max_occupants ? <span>Tối đa {type.max_occupants} người</span> : null}
        </div>
        {items.length ? <ul className="rtc-chips" aria-label="Nội thất">{items.map((x, i) => <li key={i}>{x}</li>)}</ul> : <p className="muted small" style={{ margin: 0 }}>Chưa ghi nội thất.</p>}
        {type.description ? <p className="small" style={{ margin: 0 }}>{type.description}</p> : null}
        {count > 1 ? (
          <details className="rtc-more">
            <summary>Xem tất cả {count} ảnh</summary>
            <FileGallery owner={{ kind: "anh_loai_phong", buildingId: type.building_id, roomTypeId: type.id }} title="Ảnh loại phòng" pdf={false} canUpload={false} canDelete={false} />
          </details>
        ) : null}
      </div>
    </section>
  );
}
