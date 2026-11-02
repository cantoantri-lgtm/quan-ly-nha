import { useEffect, useState } from "react";
import { useParams } from "react-router-dom";
import { supabase } from "../lib/supabase";
import { vnd } from "../lib/money";
import PayQR from "../components/PayQR";
import type { PaySettings } from "../lib/vietqr";
import "../files.css";

type Info = { pay_code: string; amount: number; status: string; period: string; due_date: string; room: string; building: string } & Partial<PaySettings>;

/** Trang công khai cho khách thuê: xem số tiền và quét QR. Không cần đăng nhập, không hiện tên khách. */
export default function PayPage() {
  const { code } = useParams();
  const [info, setInfo] = useState<Info | null | undefined>(undefined);

  useEffect(() => {
    let stop = false;
    const load = async () => {
      const { data } = await supabase.rpc("invoice_pay_info", { p_code: code });
      if (!stop) setInfo((data as Info) ?? null);
    };
    load();
    const t = window.setInterval(load, 10000);   // tự cập nhật khi tiền đã về
    return () => { stop = true; window.clearInterval(t); };
  }, [code]);

  return (
    <div className="auth-wrap">
      <div className="auth-card" style={{ gap: 14 }}>
        <h2 style={{ fontSize: 20 }}>Thanh toán tiền phòng</h2>
        {info === undefined ? <div className="loading">Đang tải…</div> : info === null ? (
          <p className="muted" style={{ margin: 0 }}>Không tìm thấy hoá đơn. Kiểm tra lại đường dẫn hoặc liên hệ quản lý toà.</p>
        ) : (
          <>
            <p style={{ margin: 0 }}><b>{info.building}</b> · Phòng <b>{info.room}</b><br /><span className="muted small">Tháng {Number(info.period.slice(5, 7))}/{info.period.slice(0, 4)}</span></p>
            {info.status === "da_thu" ? (
              <div className="stack" style={{ justifyItems: "center", textAlign: "center" }}>
                <span className="paid-stamp">Đã nhận {vnd(info.amount)}</span>
                <p className="muted small" style={{ margin: 0 }}>Cảm ơn bạn. Hoá đơn này đã được thanh toán.</p>
              </div>
            ) : info.account_no && info.bank_bin ? (
              <PayQR bank={info as PaySettings} amount={info.amount} code={info.pay_code} toast={() => undefined} />
            ) : <p className="muted" style={{ margin: 0 }}>Số tiền cần đóng: <b>{vnd(info.amount)}</b>. Vui lòng liên hệ quản lý toà để nhận thông tin chuyển khoản.</p>}
          </>
        )}
      </div>
    </div>
  );
}
