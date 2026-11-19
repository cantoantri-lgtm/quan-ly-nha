-- 074: Số liệu 4 thẻ trang Báo cáo AI theo kỳ: ngay | tuan | thang | quy (tính đến hôm nay).
-- So sánh với cùng số ngày của kỳ trước. Lấp đầy, công nợ, dự án là số hiện tại.
create or replace function public.ai_kpis(p_period text default 'thang') returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare
  t date := public.ai_today();
  s date; ps date; pe date; n int;
begin
  perform public.ai_guard();
  s := case p_period
         when 'ngay' then t
         when 'tuan' then date_trunc('week', t)::date
         when 'quy'  then date_trunc('quarter', t)::date
         else date_trunc('month', t)::date end;
  n := t - s;
  ps := case p_period
          when 'ngay' then t - 1
          when 'tuan' then s - 7
          when 'quy'  then (s - interval '3 month')::date
          else (s - interval '1 month')::date end;
  pe := ps + n;
  return jsonb_build_object(
    'as_of', t, 'period', p_period, 'from', s, 'to', t, 'prev_from', ps, 'prev_to', pe,
    'revenue', jsonb_build_object(
      'collected', (select coalesce(sum(coalesce(i.paid_amount, i.amount)), 0) from public.invoices i
                     where i.status = 'da_thu' and i.collected_at between s and t),
      'collected_prev', (select coalesce(sum(coalesce(i.paid_amount, i.amount)), 0) from public.invoices i
                     where i.status = 'da_thu' and i.collected_at between ps and pe),
      'invoiced', (select coalesce(sum(i.amount), 0) from public.invoices i
                     where i.status <> 'huy' and i.period between date_trunc('month', s)::date and t)),
    'occupancy', (select jsonb_build_object('rooms', count(*), 'occupied', count(*) filter (where status = 'dang_o'),
        'vacant', count(*) filter (where status = 'trong'),
        'expiring_30d', (select count(*) from public.contracts c where c.status = 'hieu_luc' and c.end_date between t and t + 30),
        'new_contracts', (select count(*) from public.contracts c where c.status <> 'da_huy' and c.start_date between s and t))
      from public.rooms),
    'debt', (select jsonb_build_object('amount', coalesce(sum(i.amount - coalesce(i.paid_amount, 0)), 0), 'invoices', count(*),
        'over_15_days', coalesce(sum(i.amount - coalesce(i.paid_amount, 0)) filter (where t - i.due_date > 15), 0))
      from public.invoices i where i.status = 'chua_thu' and i.due_date < t),
    'costs', jsonb_build_object(
      'amount', (select coalesce(sum(q.amount), 0) from public.requests q where q.kind in ('thanh_toan', 'tam_ung')
                  and q.status in ('da_duyet', 'hoan_tat') and coalesce(q.doc_date, q.created_at::date) between s and t),
      'amount_prev', (select coalesce(sum(q.amount), 0) from public.requests q where q.kind in ('thanh_toan', 'tam_ung')
                  and q.status in ('da_duyet', 'hoan_tat') and coalesce(q.doc_date, q.created_at::date) between ps and pe),
      'pending', (select coalesce(sum(amount), 0) from public.requests where kind in ('thanh_toan', 'tam_ung') and status = 'cho_duyet')),
    'projects', (select jsonb_build_object('running', count(*),
        'late', count(*) filter (where ((public.ai_project_progress(p.id)->>'planned_pct')::int - (public.ai_project_progress(p.id)->>'actual_pct')::int) >= 5))
      from public.projects p where p.status in ('ke_hoach', 'dang_thuc_hien')),
    'tasks', (select jsonb_build_object('open', count(*) filter (where status <> 'xong'),
        'overdue', count(*) filter (where status <> 'xong' and due_date < t),
        'done', count(*) filter (where status = 'xong' and (completed_at at time zone 'Asia/Ho_Chi_Minh')::date between s and t))
      from public.tasks where parent_id is null)
  );
end $$;
revoke execute on function public.ai_kpis(text) from public, anon;
grant execute on function public.ai_kpis(text) to authenticated;
