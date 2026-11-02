-- Xoá toàn bộ dữ liệu thử nghiệm do seed.sql tạo (tài khoản 090000000x + Toà thử nghiệm).
-- Không đụng tới dữ liệu thật.
do $$
declare ids uuid[]; b uuid;
begin
  select array_agg(id) into ids from auth.users
   where email in ('0900000001@neonestly.app','0900000002@neonestly.app','0900000003@neonestly.app');
  select id into b from public.buildings where code = 'TEST';

  if b is not null then
    delete from storage.objects where bucket_id = 'kho-tai-lieu' and name like '%/' || b || '/%';   -- ảnh CCCD, hợp đồng, ảnh phòng của toà thử
    delete from public.bank_transactions where invoice_id in (select id from public.invoices where building_id = b);
    delete from public.invoices where building_id = b;
    delete from public.contracts where building_id = b;   -- người ở, tệp xoá theo cascade
    delete from public.tenants where building_id = b;
    delete from public.nightly_revenues where building_id = b;
    delete from public.tasks where building_id = b;   -- bước con, cập nhật xoá theo cascade
    delete from public.buildings where id = b;        -- phòng, thành viên xoá theo cascade
  end if;

  if ids is not null then
    delete from public.notifications where user_id = any(ids);
    delete from public.task_updates where author_id = any(ids);
    delete from public.tasks where created_by = any(ids) or assignee_id = any(ids);
    delete from public.requests where requester_id = any(ids);
    -- thông báo gửi cho Quản lý thật về đề nghị của tài khoản thử
    delete from public.notifications where entity_type = 'request'
      and entity_id not in (select id from public.requests);
    delete from auth.users where id = any(ids);       -- hồ sơ xoá theo cascade
  end if;
end $$;
