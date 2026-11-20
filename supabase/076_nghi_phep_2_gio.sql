-- 076: Nghỉ phép 2 giờ: 2 giờ đầu buổi sáng (dau_gio) và 2 giờ cuối buổi chiều (cuoi_gio), trừ 0,25 ngày.
-- Khối văn phòng (Nội quy Điều 5): 08:00–10:00 và 15:00–17:00. Khối kinh doanh tính theo ca đã phân.

alter table public.requests drop constraint if exists req_shape;
alter table public.requests add constraint req_shape check (
  case kind
    when 'nghi_phep'::request_kind then (sub_type = any (array['phep_nam', 'khong_luong'])
                                        and span = any (array['ca_ngay', 'sang', 'chieu', 'dau_gio', 'cuoi_gio']))
    when 'ra_ngoai'::request_kind then (sub_type = any (array['khong_den_cty', 'co_quay_lai', 'khong_quay_lai']))
    when 'cong_tac'::request_kind then ((end_date is not null) and (coalesce(btrim(location), '') <> ''))
    when 'loa'::request_kind then true
    else (amount is not null)
  end);

-- Chỉ đổi đúng dòng tính số ngày trong tg_requests_guard (giữ nguyên phần còn lại của hàm)
do $$
declare d text;
begin
  d := pg_get_functiondef('public.tg_requests_guard()'::regprocedure);
  if position('else 0.5 end;' in d) = 0 then raise exception 'tg_requests_guard đã khác bản 047, kiểm tra lại trước khi sửa'; end if;
  d := replace(d, 'else 0.5 end;', 'when new.span in (''dau_gio'', ''cuoi_gio'') then 0.25 else 0.5 end;');
  execute d;
end $$;
