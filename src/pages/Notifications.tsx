import { useCallback, useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { supabase } from "../lib/supabase";
import { useSession } from "../lib/session";
import { timeAgo } from "../lib/dates";
import { Empty, TopBar } from "../components/ui";

type N = { id: string; type: string; title: string; body: string | null; entity_type: string | null; entity_id: string | null; read_at: string | null; created_at: string };

export default function Notifications() {
  const { refreshUnread } = useSession();
  const [items, setItems] = useState<N[]>([]);
  const [loading, setLoading] = useState(true);
  const nav = useNavigate();

  const load = useCallback(async () => {
    const { data } = await supabase.from("notifications").select("*").order("created_at", { ascending: false }).limit(100);
    setItems((data as N[]) ?? []);
    setLoading(false);
  }, []);
  useEffect(() => { load(); }, [load]);
  useEffect(() => {
    const h = () => load();
    window.addEventListener("neo:notification", h);
    return () => window.removeEventListener("neo:notification", h);
  }, [load]);

  async function open(n: N) {
    if (!n.read_at) {
      await supabase.from("notifications").update({ read_at: new Date().toISOString() }).eq("id", n.id);
      refreshUnread();
    }
    if (n.entity_type === "task" && n.entity_id) nav(`/viec/${n.entity_id}`);
    else if (n.entity_type === "request" && n.entity_id) nav(`/van-phong/${n.entity_id}`);
    else load();
  }

  async function readAll() {
    await supabase.from("notifications").update({ read_at: new Date().toISOString() }).is("read_at", null);
    refreshUnread();
    load();
  }

  const unread = items.filter((n) => !n.read_at).length;

  return (
    <>
      <TopBar title="Thông báo" action={unread ? <button className="tb-action" onClick={readAll}>Đã đọc hết</button> : null} />
      <main className="main">
        {loading ? <div className="loading">Đang tải…</div> : items.length === 0 ? (
          <Empty title="Chưa có thông báo">Bạn sẽ nhận thông báo khi được giao việc, khi việc sắp đến hạn hoặc trễ hạn.</Empty>
        ) : (
          <section className="card">
            {items.map((n) => (
              <div key={n.id} className={`notif${n.read_at ? "" : " unread"}`} role="button" tabIndex={0}
                onClick={() => open(n)} onKeyDown={(e) => e.key === "Enter" && open(n)}>
                <span className="dot" aria-hidden="true" />
                <div>
                  <div className="nt">{n.title}</div>
                  {n.body ? <div className="nb">{n.body}</div> : null}
                  <div className="nw">{timeAgo(n.created_at)}</div>
                </div>
              </div>
            ))}
          </section>
        )}
      </main>
    </>
  );
}
