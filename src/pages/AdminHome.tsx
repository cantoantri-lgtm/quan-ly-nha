import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { supabase } from "../lib/supabase";
import { useSession } from "../lib/session";
import { todayVN } from "../lib/dates";
import { ROLE_LABEL } from "../lib/labels";
import { TopBar } from "../components/ui";

type Load = { id: string; open: number; late: number; block: number };

export default function AdminHome() {
  const { people, buildings } = useSession();
  const [load, setLoad] = useState<Load[]>([]);

  useEffect(() => {
    const today = todayVN();
    // Khối lượng việc mỗi người: tính cả việc phụ trách chính và việc cùng làm
    supabase.from("tasks").select("assignee_id,status,due_date,members:task_assignees(user_id)").is("parent_id", null).neq("status", "xong").then(({ data }) => {
      const m: Record<string, Load> = {};
      (data ?? []).forEach((t: { assignee_id: string | null; status: string; due_date: string | null; members: { user_id: string }[] | null }) => {
        const who = [...(t.assignee_id ? [t.assignee_id] : []), ...(t.members ?? []).map((x) => x.user_id)];
        for (const u of who) {
          m[u] ??= { id: u, open: 0, late: 0, block: 0 };
          m[u].open++;
          if (t.due_date && t.due_date < today) m[u].late++;
          if (t.status === "vuong") m[u].block++;
        }
      });
      setLoad(Object.values(m).sort((a, b) => b.late - a.late || b.open - a.open));
    });
  }, []);

  const name = (id: string) => people.find((p) => p.id === id);
  const active = people.filter((p) => p.is_active);

  return (
    <>
      <TopBar title="Quản trị" />
      <main className="main stack">
        <section className="card">
          <Link className="list-row" to="/nhan-su" style={{ color: "inherit" }}>
            <div className="grow"><div className="name">Nhân sự & tài khoản</div>
              <div className="sub">{active.length} người đang hoạt động · cấp tài khoản, gán toà, cấp lại mật khẩu</div></div>›
          </Link>
          <Link className="list-row" to="/to-chuc" style={{ color: "inherit" }}>
            <div className="grow"><div className="name">Sơ đồ công ty</div><div className="sub">Phòng ban, chức danh, người duyệt đề nghị</div></div>›
          </Link>
          <Link className="list-row" to="/bao-cao" style={{ color: "inherit" }}>
            <div className="grow"><div className="name">Báo cáo</div><div className="sub">Thu chi, lấp đầy, phản ánh, lợi nhuận · {buildings.length} toà</div></div>›
          </Link>
        </section>

        <div className="section-title">Việc đang mở theo người</div>
        <section className="card">
          {load.length === 0 ? <p className="muted small" style={{ padding: "12px 16px", margin: 0 }}>Chưa có việc nào đang mở.</p> : load.map((l) => {
            const p = name(l.id);
            return (
              <div key={l.id} className="list-row" style={{ cursor: "default" }}>
                <div className="grow">
                  <div className="name">{p?.full_name ?? "?"}</div>
                  <div className="sub">{p ? ROLE_LABEL[p.role] : ""}</div>
                </div>
                <div className="row small num" style={{ gap: 12 }}>
                  <span>{l.open} mở</span>
                  {l.block ? <span style={{ color: "var(--s-block)" }}>{l.block} vướng</span> : null}
                  {l.late ? <span style={{ color: "var(--late)", fontWeight: 700 }}>{l.late} trễ</span> : null}
                </div>
              </div>
            );
          })}
        </section>
      </main>
    </>
  );
}
