-- 119: Sửa lỗi bảo mật sau đợt rà soát 28/11/2026.
-- 1. Link đính kèm đề nghị chỉ nhận http(s): chặn link "javascript:..." ghi thẳng qua API (XSS khi người duyệt bấm link).
alter table public.request_links drop constraint if exists request_links_url_http;
alter table public.request_links add constraint request_links_url_http check (url ~* '^https?://[^[:space:]]+$' and char_length(url) <= 2000);

-- 2. Cố định search_path cho hàm default_flow (cảnh báo function_search_path_mutable).
alter function public.default_flow set search_path = public;

-- 3. Người chưa đăng nhập (anon) không gọi được các hàm nội bộ. Website công khai chỉ dùng web_* và invoice_pay_info.
do $$
declare f record;
begin
  for f in
    select p.oid::regprocedure sig from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.prosecdef
      and has_function_privilege('anon', p.oid, 'execute')
      and p.proname not in ('web_book_viewing', 'web_chat_get', 'web_chat_send', 'web_config', 'web_room', 'web_rooms', 'invoice_pay_info')
  loop
    execute format('revoke execute on function %s from public, anon', f.sig);
    execute format('grant execute on function %s to authenticated, service_role', f.sig);
  end loop;
end $$;
