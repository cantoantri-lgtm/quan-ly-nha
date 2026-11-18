import { supabase } from "./supabase";

/** Liên kết qua lại giữa các chức năng (bảng entity_links + hàm related_items, migration 064). */
export type LinkType = "building" | "room" | "task" | "request" | "feedback" | "contract" | "tenant" | "viewing";

export type Related = {
  rel_type: LinkType; rel_id: string; title: string; sub: string | null; status: string | null; parent: string | null;
  at: string | null; auto: boolean; link_id: string | null; link_by: string | null; can_unlink: boolean;
};

export const LINK_LABEL: Record<LinkType, string> = {
  building: "Toà nhà", room: "Phòng", task: "Công việc", request: "Văn phòng số", feedback: "Phản ánh",
  contract: "Hợp đồng", tenant: "Khách thuê", viewing: "Lịch xem phòng",
};

/** Các loại cho phép gắn tay trong hộp "Gắn liên kết" */
export const LINKABLE: LinkType[] = ["task", "request", "feedback", "room", "contract", "tenant", "building"];

/** Đường dẫn mở một mục liên quan */
export function linkHref(t: LinkType, id: string, parent: string | null): string {
  switch (t) {
    case "building": return `/toa/${id}`;
    case "room": return parent ? `/toa/${parent}?phong=${id}` : "/toa-nha";
    case "task": return `/viec/${id}`;
    case "request": return `/van-phong/${id}`;
    case "feedback": return `/phan-anh/${id}`;
    case "contract": return parent ? `/toa/${parent}/hop-dong` : "/toa-nha";
    case "tenant": return `/khach/${id}`;
    case "viewing": return "/lich-xem-phong";
  }
}

export async function addLink(aType: LinkType, aId: string, bType: LinkType, bId: string): Promise<string | null> {
  const { error } = await supabase.from("entity_links").insert({ a_type: aType, a_id: aId, b_type: bType, b_id: bId });
  if (!error) return null;
  if (error.code === "23505") return null; // đã gắn từ trước
  return error.message;
}

/** Đọc tham số ?lk=loai:id (mở form từ một mục khác) */
export function parseLk(v: string | null): { type: LinkType; id: string } | null {
  const m = v?.match(/^(building|room|task|request|feedback|contract|tenant|viewing):([0-9a-f-]{36})$/i);
  return m ? { type: m[1] as LinkType, id: m[2] } : null;
}
