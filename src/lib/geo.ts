// Toạ độ toà nhà: đọc toạ độ người dùng dán vào, tạo link Google Maps.

export type LatLng = { lat: number; lng: number };

/** Trung tâm TP.HCM — dùng khi chưa toà nào có vị trí */
export const DEFAULT_CENTER: LatLng = { lat: 10.7769, lng: 106.7009 };

const valid = (lat: number, lng: number) =>
  Number.isFinite(lat) && Number.isFinite(lng) && Math.abs(lat) <= 90 && Math.abs(lng) <= 180;

/**
 * Đọc toạ độ từ: "10.7769, 106.7009", "10,7769 106,7009",
 * hoặc link Google Maps dạng dài (…/@10.77,106.70,17z, …!3d10.77!4d106.70, …?q=10.77,106.70).
 * Link rút gọn (maps.app.goo.gl) không đọc được trong trình duyệt → trả lỗi hướng dẫn.
 */
export function parseLatLng(input: string): LatLng | { error: string } | null {
  const s = (input ?? "").trim();
  if (!s) return null;
  if (/goo\.gl\//i.test(s)) {
    return { error: "Link rút gọn không đọc được. Mở link trên Google Maps, chạm giữ vào vị trí toà rồi copy dãy toạ độ (VD: 10.7769, 106.7009)." };
  }
  const num = (x: string) => parseFloat(x.replace(",", "."));
  const pats = [
    /!3d(-?\d+\.\d+)!4d(-?\d+\.\d+)/,
    /[?&](?:q|query|ll|destination|center)=(-?\d+\.\d+)(?:,|%2C)\s*(-?\d+\.\d+)/i,
    /@(-?\d+\.\d+),(-?\d+\.\d+)/,
    /^(-?\d+(?:\.\d+)?)\s*[,;]\s*(-?\d+(?:\.\d+)?)$/,
    /^(-?\d+(?:[.,]\d+)?)\s+(-?\d+(?:[.,]\d+)?)$/,
  ];
  for (const p of pats) {
    const m = s.match(p);
    if (!m) continue;
    let lat = num(m[1]), lng = num(m[2]);
    if (Math.abs(lat) > 90 && Math.abs(lng) <= 90) [lat, lng] = [lng, lat]; // dán ngược thứ tự
    if (valid(lat, lng)) return { lat: round6(lat), lng: round6(lng) };
  }
  return { error: "Chưa đọc được toạ độ. Dán dạng 10.7769, 106.7009 hoặc link Google Maps đầy đủ." };
}

export const round6 = (n: number) => Math.round(n * 1e6) / 1e6;

export const fmtLatLng = (p: LatLng) => `${p.lat.toFixed(6)}, ${p.lng.toFixed(6)}`;

/** Mở chỉ đường trên Google Maps (app trên điện thoại, web trên máy tính) */
export const googleDirections = (p: LatLng) =>
  `https://www.google.com/maps/dir/?api=1&destination=${p.lat},${p.lng}`;

export const googlePlace = (p: LatLng) =>
  `https://www.google.com/maps/search/?api=1&query=${p.lat},${p.lng}`;

/** Lấy vị trí hiện tại của điện thoại (khi đang đứng tại toà) */
export function currentPosition(): Promise<LatLng> {
  return new Promise((resolve, reject) => {
    if (!navigator.geolocation) { reject(new Error("Máy này không hỗ trợ lấy vị trí.")); return; }
    navigator.geolocation.getCurrentPosition(
      (pos) => resolve({ lat: round6(pos.coords.latitude), lng: round6(pos.coords.longitude) }),
      (e) => reject(new Error(e.code === e.PERMISSION_DENIED
        ? "Chưa được phép lấy vị trí. Bấm biểu tượng ổ khoá trên thanh địa chỉ, cho phép Vị trí, rồi thử lại."
        : "Không lấy được vị trí. Ra chỗ thoáng hoặc bật GPS rồi thử lại.")),
      { enableHighAccuracy: true, timeout: 15000, maximumAge: 0 },
    );
  });
}
