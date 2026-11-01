import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import type { Session } from "@supabase/supabase-js";
import { supabase } from "./supabase";
import type { Building, Profile } from "./labels";

type Ctx = {
  session: Session | null;
  profile: Profile | null;
  buildings: Building[];
  people: Profile[];
  myBuildingIds: string[];
  loading: boolean;
  unread: number;
  pendingApprovals: number;
  refreshUnread: () => void;
  reloadBase: () => Promise<void>;
  toast: (msg: string) => void;
  toastMsg: string | null;
  isManager: boolean;
  isSupervisor: boolean;
};

const SessionContext = createContext<Ctx | null>(null);

export function SessionProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(null);
  const [profile, setProfile] = useState<Profile | null>(null);
  const [buildings, setBuildings] = useState<Building[]>([]);
  const [people, setPeople] = useState<Profile[]>([]);
  const [myBuildingIds, setMyBuildingIds] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);
  const [unread, setUnread] = useState(0);
  const [pendingApprovals, setPending] = useState(0);
  const [toastMsg, setToastMsg] = useState<string | null>(null);
  const toastTimer = useRef<number>();

  const toast = useCallback((msg: string) => {
    setToastMsg(msg);
    window.clearTimeout(toastTimer.current);
    toastTimer.current = window.setTimeout(() => setToastMsg(null), 4000);
  }, []);

  const refreshUnread = useCallback(async () => {
    const { count } = await supabase.from("notifications").select("id", { count: "exact", head: true }).is("read_at", null);
    setUnread(count ?? 0);
    // Quản lý: số đề nghị đang chờ duyệt (hiện trên nút Văn phòng)
    const uid = (await supabase.auth.getSession()).data.session?.user.id;
    const { data: p } = uid ? await supabase.from("profiles").select("role").eq("id", uid).maybeSingle() : { data: null };
    if (p?.role === "quan_ly") {
      const { count: c } = await supabase.from("requests").select("id", { count: "exact", head: true }).eq("status", "cho_duyet");
      setPending(c ?? 0);
    } else setPending(0);
  }, []);

  const loadBase = useCallback(async (uid: string) => {
    const [p, b, ppl, mem] = await Promise.all([
      supabase.from("profiles").select("id,full_name,phone,role,is_active,annual_leave_days").eq("id", uid).maybeSingle(),
      supabase.from("buildings").select("*").order("code"),
      supabase.from("profiles").select("id,full_name,phone,role,is_active,annual_leave_days").order("full_name"),
      supabase.from("building_members").select("building_id").eq("user_id", uid),
    ]);
    setProfile((p.data as Profile) ?? null);
    setBuildings((b.data as Building[]) ?? []);
    setPeople((ppl.data as Profile[]) ?? []);
    setMyBuildingIds(((mem.data as { building_id: string }[]) ?? []).map((m) => m.building_id));
  }, []);

  const reloadBase = useCallback(async () => {
    if (session?.user) await loadBase(session.user.id);
  }, [session, loadBase]);

  useEffect(() => {
    supabase.auth.getSession().then(async ({ data }) => {
      setSession(data.session);
      if (data.session) await loadBase(data.session.user.id);
      setLoading(false);
    });
    const { data: sub } = supabase.auth.onAuthStateChange((event, s) => {
      setSession(s);
      if (event === "SIGNED_IN" && s) {
        setLoading(true);
        loadBase(s.user.id).finally(() => setLoading(false));
      }
      if (event === "SIGNED_OUT") {
        setProfile(null); setBuildings([]); setPeople([]); setMyBuildingIds([]); setUnread(0); setPending(0);
      }
    });
    return () => sub.subscription.unsubscribe();
  }, [loadBase]);

  // Thông báo mới hiện ngay (Realtime)
  useEffect(() => {
    if (!session?.user || !profile?.is_active) return;
    refreshUnread();
    const ch = supabase
      .channel("notif-" + session.user.id)
      .on("postgres_changes",
        { event: "INSERT", schema: "public", table: "notifications", filter: `user_id=eq.${session.user.id}` },
        (payload) => {
          const n = payload.new as { title: string; body: string | null };
          setUnread((u) => u + 1);
          toast(n.body ? `${n.title}: ${n.body}` : n.title);
          window.dispatchEvent(new CustomEvent("neo:notification"));
        })
      .subscribe();
    const onFocus = () => refreshUnread();
    window.addEventListener("focus", onFocus);
    return () => { supabase.removeChannel(ch); window.removeEventListener("focus", onFocus); };
  }, [session?.user?.id, profile?.is_active, refreshUnread, toast]);

  const value = useMemo<Ctx>(() => ({
    session, profile, buildings, people, myBuildingIds, loading, unread, pendingApprovals, refreshUnread, reloadBase, toast, toastMsg,
    isManager: profile?.role === "quan_ly",
    isSupervisor: profile?.role === "giam_sat",
  }), [session, profile, buildings, people, myBuildingIds, loading, unread, pendingApprovals, refreshUnread, reloadBase, toast, toastMsg]);

  return <SessionContext.Provider value={value}>{children}</SessionContext.Provider>;
}

export function useSession() {
  const c = useContext(SessionContext);
  if (!c) throw new Error("useSession must be inside SessionProvider");
  return c;
}
