/// <reference types="google.maps" />
// Tải Google Maps JavaScript API một lần cho cả app.
// Khoá (VITE_GOOGLE_MAPS_KEY) là khoá trình duyệt, chỉ chạy trên các địa chỉ đã khai trong Google Cloud
// (Application restrictions → Websites) và chỉ bật Maps JavaScript API. Khác khoá Gemini: khoá này được phép nằm ở trình duyệt.

export const GOOGLE_MAPS_KEY: string = (import.meta.env.VITE_GOOGLE_MAPS_KEY ?? "").trim();

let loading: Promise<typeof google.maps> | null = null;
let authFailed = false;
const authListeners = new Set<() => void>();

/** Google gọi hàm này khi khoá sai, chưa bật API, hoặc địa chỉ trang chưa được cho phép */
(window as unknown as { gm_authFailure: () => void }).gm_authFailure = () => {
  authFailed = true;
  authListeners.forEach((f) => f());
};

export function onMapsAuthFailure(f: () => void): () => void {
  if (authFailed) f();
  authListeners.add(f);
  return () => { authListeners.delete(f); };
}

export function loadGoogleMaps(): Promise<typeof google.maps> {
  if (!GOOGLE_MAPS_KEY) return Promise.reject(new Error("Chưa cấu hình khoá Google Maps (VITE_GOOGLE_MAPS_KEY)."));
  if (window.google?.maps?.OverlayView) return Promise.resolve(window.google.maps);
  if (loading) return loading;
  loading = new Promise((resolve, reject) => {
    const cb = "__neoGoogleMapsReady";
    (window as unknown as Record<string, () => void>)[cb] = () => resolve(window.google.maps);
    const s = document.createElement("script");
    s.src = `https://maps.googleapis.com/maps/api/js?key=${encodeURIComponent(GOOGLE_MAPS_KEY)}`
      + `&callback=${cb}&loading=async&v=weekly&language=vi&region=VN`;
    s.async = true;
    s.onerror = () => { loading = null; s.remove(); reject(new Error("Không tải được Google Maps. Kiểm tra mạng rồi thử lại.")); };
    document.head.append(s);
  });
  return loading;
}
