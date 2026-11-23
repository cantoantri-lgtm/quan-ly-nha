// Song ngữ cho website phòng trống: /phong (tiếng Việt) và /en/phong (tiếng Anh).
// Chữ giao diện dịch sẵn ở đây. Dữ liệu phòng do nhân viên nhập (loại phòng, nội thất, tiện ích, tên phí) dịch theo
// từ điển cụm từ thường gặp (PHRASES); cụm nào chưa có thì giữ nguyên tiếng Việt. Thêm cụm mới vào PHRASES khi cần.
import { useLocation } from "react-router-dom";

export type Lang = "vi" | "en";
export const langOf = (path: string): Lang => (path === "/en" || path.startsWith("/en/") ? "en" : "vi");
export function useLang(): Lang { return langOf(useLocation().pathname); }
/** Đường dẫn website theo ngôn ngữ: "/phong/abc" → "/en/phong/abc" */
export const webPath = (lang: Lang, p: string) => (lang === "en" ? `/en${p}` : p);
/** Cùng trang ở ngôn ngữ kia (cho nút VI / EN) */
export const otherLangPath = (path: string, search = "", hash = ""): string =>
  (langOf(path) === "en" ? path.replace(/^\/en/, "") || "/phong" : `/en${path}`) + search + hash;

const VI = {
  nav_rooms: "Phòng trống", nav_buildings: "Toà nhà", nav_brands: "Hệ thương hiệu", nav_app: "App người thuê", nav_menu: "Menu chính",
  call: "Gọi", enter_app: "Vào app", login: "Đăng nhập", home_aria: "Next Living, trang chủ", switch_lang: "English", switch_lang_aria: "Xem bản tiếng Anh",
  foot_rent: "Thuê phòng", foot_policy: "Chính sách", foot_privacy: "Dữ liệu cá nhân", foot_contact: "Liên hệ",
  foot_zalo: "Chat Zalo", foot_brand: "Next Living là thương hiệu cho thuê phòng của Next Vision.",
  search_aria: "Tìm phòng", where: "Bạn muốn ở đâu?", all_buildings: "Tất cả toà nhà", room_type: "Loại phòng", all: "Tất cả",
  budget: "Ngân sách / tháng", rent_by: "Thuê theo", month_or_night: "Tháng hoặc đêm", by_month: "Theo tháng", by_night: "Theo đêm", find: "Tìm phòng",
  price_any: "Mọi mức giá", price_lt7: "Dưới 7 triệu", price_7_10: "7 – 10 triệu", price_gt10: "Trên 10 triệu",
  load_err: "Chưa tải được danh sách phòng. Thử tải lại trang.",
  feat_eyebrow: "Gợi ý từ phòng đang trống", feat_title: "Khám phá mới", feat_cheap: "Giá tốt", feat_many: "Nhiều lựa chọn", feat_balcony: "Có ban công", feat_window: "Có cửa sổ",
  from: "từ", rooms_vacant: "{n} phòng đang trống",
  bld_eyebrow: "Toà nhà", bld_title: "Chọn nơi bạn muốn ở", bld_all: "Xem tất cả toà",
  vac_eyebrow: "Trống ngay", vac_title: "Phòng đang trống", vac_count: "{n} phòng", vac_of: " (trong {t})", vac_live: " · sale đổi trạng thái trong app là trang này đổi theo.", loading: "Đang tải…",
  sort: "Sắp xếp", sort_price: "Giá thấp đến cao", sort_building: "Theo toà", filter_type: "Lọc loại phòng",
  empty_filter: "Chưa có phòng hợp bộ lọc này. Thử bỏ bớt điều kiện", empty_zalo: ", hoặc nhắn Zalo để sale tìm giúp", vacant_now: "Trống ngay",
  app_eyebrow: "App người thuê Next Living", app_title: "Thuê xong là có tài khoản app.", app_1: "Xem hoá đơn, số điện, tiền nước từng tháng",
  app_2: "Đăng ký người ở cùng", app_3: "Gửi phản ánh, sự cố cho quản lý toà", app_login: "Đăng nhập app",
  brand_title: "Hệ thương hiệu", brand_living: "Phòng ở, căn hộ dịch vụ thuê theo tháng.", brand_hub: "Văn phòng cho thuê, phòng livestream.", brand_stay: "Khách sạn, lưu trú ngắn ngày.",
  room_loading: "Đang tải phòng…", room_404: "Không tìm thấy phòng này.", room_404_link: "Xem các phòng đang trống", crumb: "Đường dẫn",
  photo_n: "Ảnh {n} của phòng, mở cỡ lớn", no_photo: "Phòng chưa có ảnh", taken: "Phòng này vừa có người thuê. Mời anh chị xem các phòng khác bên dưới.",
  max_people: "Tối đa {n} người", incl_vat: "đã gồm VAT", monthly_cost: "Chi phí hằng tháng", rent: "Tiền phòng",
  estimate: "Ước tính 1 người{xe}, dùng 100 kWh điện", estimate_xe: ", 1 xe", per_month_sum: "/tháng",
  furniture: "Nội thất trong phòng", amenities: "Tiện ích toà nhà", deposit: "Đặt cọc và hợp đồng", id_note: "Mỗi người ở cần CCCD. Khách nước ngoài dùng hộ chiếu.",
  location: "Vị trí", maps: "Xem trên Google Maps", book_aria: "Đặt lịch xem phòng", others: "Phòng khác đang trống ở {b}",
  each_month: "mỗi tháng", each_night: "mỗi đêm", book_short: "Đặt lịch xem",
  book_title: "Đặt lịch xem phòng", name: "Họ tên", phone: "Số điện thoại", phone_ph: "VD: 0901 234 567", day: "Ngày muốn xem", today: "Hôm nay",
  other_day: "Hoặc chọn ngày khác", slot: "Khung giờ", slot_sang: "Sáng", slot_chieu: "Chiều", slot_toi: "Tối",
  note: "Ghi chú (không bắt buộc)", note_ph: "VD: ở 2 người, có 1 xe máy",
  consent_1: "Tôi đồng ý cho Next Living dùng số điện thoại này để liên hệ hẹn xem phòng, theo ", consent_link: "chính sách dữ liệu cá nhân", consent_2: ".",
  err_name: "Nhập họ tên.", err_phone: "Số điện thoại cần 10 số, bắt đầu bằng 0.", err_slot: "Chọn khung giờ xem.", err_consent: "Cần tích đồng ý cho Next Living liên hệ.",
  err_send: "Chưa gửi được. Thử lại sau ít phút.", sending: "Đang gửi…", send: "Gửi lịch hẹn", ask_zalo: "Hỏi nhanh qua Zalo",
  book_foot: "Sale phụ trách toà nhận lịch hẹn trong app và gọi lại để xác nhận giờ xem.",
  done_title: "Đã gửi lịch hẹn", done_body: "Sale phụ trách {b} sẽ gọi số {p} để xác nhận giờ xem.", done_room: "Phòng", done_day: "Ngày xem", done_slot: "Khung giờ",
  done_zalo: "Nhắn Zalo cho sale", done_more: "Xem thêm phòng khác",
  ref_title: "Link giới thiệu của bạn", ref_copy: "Copy link", ref_copy_post: "Copy tin đăng", ref_copied: "Đã copy link.", ref_copied_post: "Đã copy tin đăng",
  ref_note: "Khách đặt lịch qua link này sẽ ghi bạn là người giới thiệu.",
  floor: "Tầng {n}", ground: "Tầng trệt", per_month: "/tháng", per_night: "/đêm", million: "triệu",
  dow: "Chủ nhật,Thứ hai,Thứ ba,Thứ tư,Thứ năm,Thứ sáu,Thứ bảy",
  pol_title: "Chính sách dữ liệu cá nhân",
  pol_1: "Khi anh chị đặt lịch xem phòng trên trang này, Next Living (Công ty Next Vision) nhận họ tên, số điện thoại, ngày giờ muốn xem và ghi chú anh chị nhập.",
  pol_2: "Chúng tôi chỉ dùng các thông tin đó để gọi điện, nhắn tin hẹn giờ xem phòng và tư vấn phòng phù hợp. Chỉ nhân viên phụ trách toà nhà và quản lý công ty xem được. Chúng tôi không bán hay chia sẻ thông tin này cho bên khác.",
  pol_3: "Anh chị có thể yêu cầu xem, sửa hoặc xoá thông tin của mình bằng cách liên hệ nhân viên đã gọi cho anh chị.",
  pol_4: "Căn cứ Nghị định 13/2023/NĐ-CP về bảo vệ dữ liệu cá nhân.", pol_back: "← Về trang phòng trống",
  slide_pause: "Tạm dừng trình chiếu", slide_play: "Tiếp tục trình chiếu", slide_n: "Ảnh {n} / {t}",
  grp_duplex: "Duplex", grp_1pn: "1 phòng ngủ", grp_studio: "Studio", grp_mb: "Mặt bằng", grp_std: "Phòng tiêu chuẩn", grp_other: "Khác",
};
type Key = keyof typeof VI;

const EN: Record<Key, string> = {
  nav_rooms: "Available rooms", nav_buildings: "Buildings", nav_brands: "Our brands", nav_app: "Tenant app", nav_menu: "Main menu",
  call: "Call", enter_app: "Open app", login: "Log in", home_aria: "Next Living, home", switch_lang: "Tiếng Việt", switch_lang_aria: "Xem bản tiếng Việt",
  foot_rent: "Rent a room", foot_policy: "Policies", foot_privacy: "Personal data", foot_contact: "Contact",
  foot_zalo: "Chat on Zalo", foot_brand: "Next Living is the room rental brand of Next Vision.",
  search_aria: "Find a room", where: "Where do you want to live?", all_buildings: "All buildings", room_type: "Room type", all: "All",
  budget: "Budget / month", rent_by: "Rent by", month_or_night: "Month or night", by_month: "Monthly", by_night: "Nightly", find: "Search",
  price_any: "Any price", price_lt7: "Under 7 million VND", price_7_10: "7 – 10 million VND", price_gt10: "Over 10 million VND",
  load_err: "Could not load the room list. Please reload the page.",
  feat_eyebrow: "Picked from available rooms", feat_title: "Discover", feat_cheap: "Best price", feat_many: "Most choice", feat_balcony: "With balcony", feat_window: "With window",
  from: "from", rooms_vacant: "{n} rooms available",
  bld_eyebrow: "Buildings", bld_title: "Choose where you want to live", bld_all: "Show all buildings",
  vac_eyebrow: "Move in now", vac_title: "Available rooms", vac_count: "{n} rooms", vac_of: " (of {t})", vac_live: " · updated live from our sales team.", loading: "Loading…",
  sort: "Sort", sort_price: "Price, low to high", sort_building: "By building", filter_type: "Filter by room type",
  empty_filter: "No rooms match these filters. Try removing some", empty_zalo: ", or message us on Zalo and we will find one for you", vacant_now: "Available now",
  app_eyebrow: "Next Living tenant app", app_title: "Every tenant gets an app account.", app_1: "See monthly bills, electricity and water usage",
  app_2: "Register people living with you", app_3: "Report issues to the building manager", app_login: "Log in to the app",
  brand_title: "Our brands", brand_living: "Rooms and serviced apartments, monthly rent.", brand_hub: "Office rental, livestream rooms.", brand_stay: "Hotels and short stays.",
  room_loading: "Loading room…", room_404: "This room was not found.", room_404_link: "See available rooms", crumb: "Breadcrumb",
  photo_n: "Room photo {n}, open full size", no_photo: "No photos yet", taken: "This room has just been rented. Please see other rooms below.",
  max_people: "Up to {n} people", incl_vat: "VAT included", monthly_cost: "Monthly costs", rent: "Rent",
  estimate: "Estimate for 1 person{xe}, 100 kWh of electricity", estimate_xe: ", 1 motorbike", per_month_sum: "/month",
  furniture: "Furniture in the room", amenities: "Building amenities", deposit: "Deposit and contract", id_note: "Every resident needs an ID card. Foreign guests use a passport.",
  location: "Location", maps: "Open in Google Maps", book_aria: "Book a viewing", others: "Other available rooms at {b}",
  each_month: "per month", each_night: "per night", book_short: "Book a viewing",
  book_title: "Book a viewing", name: "Full name", phone: "Phone number", phone_ph: "e.g. 0901 234 567", day: "Viewing date", today: "Today",
  other_day: "Or pick another date", slot: "Time", slot_sang: "Morning", slot_chieu: "Afternoon", slot_toi: "Evening",
  note: "Note (optional)", note_ph: "e.g. 2 people, 1 motorbike",
  consent_1: "I agree that Next Living may use this phone number to arrange the viewing, under the ", consent_link: "personal data policy", consent_2: ".",
  err_name: "Please enter your name.", err_phone: "Please enter a 10-digit Vietnamese phone number starting with 0.", err_slot: "Please choose a time.", err_consent: "Please tick the box so we can contact you.",
  err_send: "Could not send. Please try again in a few minutes.", sending: "Sending…", send: "Send booking", ask_zalo: "Ask quickly on Zalo",
  book_foot: "The building's sales staff receive your booking in the app and will call to confirm.",
  done_title: "Booking sent", done_body: "Our sales staff at {b} will call {p} to confirm the time.", done_room: "Room", done_day: "Date", done_slot: "Time",
  done_zalo: "Message sales on Zalo", done_more: "See more rooms",
  ref_title: "Your referral link", ref_copy: "Copy link", ref_copy_post: "Copy listing", ref_copied: "Link copied.", ref_copied_post: "Listing copied",
  ref_note: "Guests who book through this link are credited to you.",
  floor: "Floor {n}", ground: "Ground floor", per_month: "/month", per_night: "/night", million: "million VND",
  dow: "Sunday,Monday,Tuesday,Wednesday,Thursday,Friday,Saturday",
  pol_title: "Personal data policy",
  pol_1: "When you book a viewing on this site, Next Living (Next Vision Company) receives your name, phone number, preferred date and time, and any note you enter.",
  pol_2: "We use this information only to call or message you about the viewing and to suggest suitable rooms. Only the building's staff and company managers can see it. We do not sell or share it with anyone else.",
  pol_3: "You can ask to see, correct or delete your information by contacting the staff member who called you.",
  pol_4: "Under Decree 13/2023/ND-CP on personal data protection.", pol_back: "← Back to available rooms",
  slide_pause: "Pause slideshow", slide_play: "Play slideshow", slide_n: "Photo {n} of {t}",
  grp_duplex: "Duplex", grp_1pn: "1 bedroom", grp_studio: "Studio", grp_mb: "Commercial space", grp_std: "Standard room", grp_other: "Other",
};

export function tr(lang: Lang, k: Key, vars?: Record<string, string | number>): string {
  let s = (lang === "en" ? EN : VI)[k];
  if (vars) for (const [a, b] of Object.entries(vars)) s = s.split(`{${a}}`).join(String(b));
  return s;
}
/** Hook tiện dùng trong component: const t = useT(); t("find") */
export function useT() {
  const lang = useLang();
  return (k: Key, vars?: Record<string, string | number>) => tr(lang, k, vars);
}

/** Tiền: "6.500.000 đ" (vi) hoặc "6,500,000 VND" (en) */
export const money = (lang: Lang, n: number) =>
  lang === "en" ? `${Math.round(n).toLocaleString("en-US")} VND` : `${Math.round(n).toLocaleString("vi-VN")} đ`;
export const millions = (lang: Lang, n: number) =>
  (n / 1_000_000).toLocaleString(lang === "en" ? "en-US" : "vi-VN", { maximumFractionDigits: 1 }) + " " + tr(lang, "million");
export const dateText = (lang: Lang, iso: string) => (lang === "en"
  ? new Date(iso + "T00:00:00Z").toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" })
  : iso.split("-").reverse().join("/"));
export const dow = (lang: Lang, iso: string) => tr(lang, "dow").split(",")[new Date(iso + "T00:00:00Z").getUTCDay()];

// ---------- Dữ liệu do nhân viên nhập: dịch cụm thường gặp ----------
// Cụm dài đặt trước cụm ngắn. So khớp không phân biệt hoa thường.
const PHRASES: [string, string][] = [
  ["bộ bàn ghế", "Table and chairs"], ["bàn ghế", "Table and chairs"], ["bàn trà", "Coffee table"], ["giường nệm", "Bed and mattress"],
  ["wifi mỗi tầng", "Wi-Fi on every floor"], ["wifi tốc độ cao", "High-speed Wi-Fi"], ["cho nuôi pet nhỏ", "Small pets allowed"], ["cho nuôi thú cưng", "Pets allowed"],
  ["khu giặt - sấy", "Laundry area"], ["khu giặt – sấy", "Laundry area"], ["khu giặt sấy", "Laundry area"], ["khu giặt", "Laundry area"],
  ["vệ sinh hành lang", "Hallway cleaning"], ["hành lang", "hallway"], ["mỗi tầng", "on every floor"], ["thú cưng", "pets"],
  ["phòng tiêu chuẩn", "Standard room"], ["phòng trọ", "Room"], ["mặt bằng", "Commercial space"], ["căn hộ dịch vụ", "Serviced apartment"], ["căn hộ", "Apartment"],
  ["1 phòng ngủ", "1 bedroom"], ["2 phòng ngủ", "2 bedrooms"], ["1pn", "1BR"], ["2pn", "2BR"], ["phòng ngủ", "bedroom"],
  ["ban công", "balcony"], ["cửa sổ trời", "skylight"], ["cửa sổ", "window"], ["gác lửng", "mezzanine"], ["gác", "loft"],
  ["máy lạnh", "Air conditioner"], ["điều hoà", "Air conditioner"], ["tủ lạnh", "Fridge"], ["máy giặt sấy", "Washer-dryer"], ["máy giặt", "Washing machine"],
  ["máy sấy", "Dryer"], ["máy nước nóng", "Water heater"], ["bình nóng lạnh", "Water heater"], ["nóng lạnh", "Water heater"], ["lò vi sóng", "Microwave"],
  ["bếp từ", "Induction hob"], ["bếp điện", "Electric hob"], ["kệ bếp", "Kitchen counter"], ["tủ bếp", "Kitchen cabinet"], ["bếp", "Kitchen"],
  ["tủ quần áo", "Wardrobe"], ["tủ đồ", "Wardrobe"], ["giường", "Bed"], ["nệm", "Mattress"], ["rèm cửa", "Curtains"], ["rèm", "Curtains"],
  ["bàn làm việc", "Desk"], ["bàn ăn", "Dining table"], ["bàn trang điểm", "Dressing table"], ["bàn", "Table"], ["ghế", "Chair"], ["sofa", "Sofa"],
  ["tivi", "TV"], ["smart tv", "Smart TV"], ["kệ giày", "Shoe rack"], ["gương", "Mirror"], ["đèn", "Lights"],
  ["thang máy", "Elevator"], ["bảo vệ 24/7", "24/7 security"], ["bảo vệ", "Security"], ["camera an ninh", "Security cameras"], ["camera", "CCTV"],
  ["khoá vân tay", "Fingerprint lock"], ["khóa vân tay", "Fingerprint lock"], ["vân tay", "Fingerprint access"], ["thẻ từ", "Key card"],
  ["giờ giấc tự do", "No curfew"], ["tự do giờ giấc", "No curfew"], ["không chung chủ", "No live-in landlord"],
  ["chỗ để xe", "Parking"], ["bãi xe", "Parking"], ["hầm xe", "Basement parking"], ["để xe", "Parking"],
  ["dọn vệ sinh", "Cleaning service"], ["dọn phòng", "Room cleaning"], ["vệ sinh", "Cleaning"], ["giặt sấy", "Laundry"], ["giặt ủi", "Laundry"],
  ["phòng cháy chữa cháy", "Fire safety"], ["pccc", "Fire safety"], ["sân thượng", "Rooftop"], ["phòng gym", "Gym"], ["hồ bơi", "Swimming pool"],
  ["wc riêng", "Private bathroom"], ["toilet riêng", "Private bathroom"], ["nhà vệ sinh riêng", "Private bathroom"], ["nhà vệ sinh", "Bathroom"],
  ["tiền điện", "Electricity"], ["tiền nước", "Water"], ["phí dịch vụ", "Service fee"], ["dịch vụ", "Service fee"], ["phí xe", "Parking fee"],
  ["xe máy", "Motorbike"], ["xe điện", "E-bike"], ["xe đạp", "Bicycle"], ["internet", "Internet"], ["wifi", "Wi-Fi"], ["rác", "Rubbish"],
  ["điện", "Electricity"], ["nước", "Water"], ["xe", "Parking"],
  ["người", "person"], ["tháng", "month"], ["chiếc", "vehicle"], ["phòng", "room"], ["đêm", "night"], ["số", "kWh"],
];
const esc = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const RX = new RegExp(`(^|[^\\p{L}])(${PHRASES.map(([v]) => esc(v)).join("|")})(?=$|[^\\p{L}])`, "giu");
const MAP = new Map(PHRASES.map(([v, e]) => [v, e]));
/** Dịch cụm thường gặp trong dữ liệu (loại phòng, nội thất, tiện ích, tên phí, đơn vị). Bản tiếng Việt giữ nguyên. */
// Còn chữ tiếng Việt có dấu sau khi dịch = mới dịch được một phần: giữ nguyên tiếng Việt cho dễ đọc
const VN_MARK = /[àáạảãâầấậẩẫăằắặẳẵèéẹẻẽêềếệểễìíịỉĩòóọỏõôồốộổỗơờớợởỡùúụủũưừứựửữỳýỵỷỹđ]/i;
export function dataText(lang: Lang, s: string): string {
  if (lang !== "en" || !s) return s;
  const out = s.replace(RX, (_m, pre: string, w: string) => pre + (MAP.get(w.toLowerCase()) ?? w));
  return VN_MARK.test(out) ? s : out;
}
