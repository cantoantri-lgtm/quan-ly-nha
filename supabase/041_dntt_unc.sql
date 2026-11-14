-- Bước cuối của Đề nghị thanh toán (DNTT): Quản lý hoặc Kế toán đính kèm Uỷ nhiệm chi (UNC) rồi bấm "Kết thúc".
--  * Tệp UNC là tệp đính kèm đề nghị (kind dinh_kem_de_nghi) có label = 'unc'.
--  * Chỉ người chi tiền (Quản lý, Kế toán) thêm/xoá UNC, và chỉ khi đề nghị đang "Đã duyệt, chờ chi".
--  * Sau khi Kết thúc (hoan_tat) UNC bị khoá, không ai xoá hay đổi nhãn được.
--  * DNTT bắt buộc có ít nhất 1 UNC mới Kết thúc được. Tạm ứng: UNC không bắt buộc (giữ như cũ).
--  * Kế toán (không phải Quản lý, không nằm trong luồng duyệt) trước đây không mở được đề nghị chờ chi: nay xem được
--    đề nghị tiền đã duyệt / đã hoàn tất, cùng luồng duyệt, dòng chi tiết và tệp đính kèm.

create or replace function public.is_payer() returns boolean
language sql stable security definer set search_path = public as $$
  select public.app_role() is not null and (public.is_manager() or public.is_duty('ke_toan'))
$$;

-- Người chi tiền được xem / xử lý đề nghị tiền đã duyệt hoặc đã hoàn tất
create or replace function public.can_pay_request(p_request uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select public.is_payer() and exists (select 1 from public.requests r where r.id = p_request
    and r.kind in ('thanh_toan','tam_ung') and r.status in ('da_duyet','hoan_tat'))
$$;

create or replace function public.can_see_request(p_request uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select public.app_role() is not null and exists (
    select 1 from public.requests r where r.id = p_request
      and (r.requester_id = auth.uid() or public.is_manager() or public.is_request_approver(r.id)
           or (public.is_duty('ke_toan') and r.kind in ('thanh_toan','tam_ung') and r.status in ('da_duyet','hoan_tat'))))
$$;

drop policy if exists requests_select on public.requests;
create policy requests_select on public.requests for select to authenticated using (
  requester_id = (select auth.uid()) or public.is_manager() or public.is_request_approver(id)
  or (public.is_duty('ke_toan') and kind in ('thanh_toan','tam_ung') and status in ('da_duyet','hoan_tat')));

-- Tệp UNC theo đường dẫn (cả ảnh nhỏ _t). null nếu đường dẫn không phải tệp UNC.
create or replace function public.unc_file_status(p_path text) returns text
language sql stable security definer set search_path = public as $$
  select r.status::text from public.files f join public.requests r on r.id = f.request_id
  where f.label = 'unc' and f.kind = 'dinh_kem_de_nghi'
    and f.path like regexp_replace(p_path, '(_t)?\.[a-z]+$', '') || '.%'
  limit 1
$$;

create or replace function public.storage_path_ok(p_name text, p_write boolean) returns boolean
language plpgsql stable security definer set search_path = public as $$
declare
  parts text[] := string_to_array(coalesce(p_name, ''), '/');
  o uuid;
  st text;
begin
  if array_length(parts, 1) is null or array_length(parts, 1) < 3 then return false; end if;
  begin o := parts[2]::uuid; exception when others then return false; end;
  if parts[1] = 'phan-anh' then
    return public.is_active_user() and exists (
      select 1 from public.feedback_threads f
      where f.id = o and (f.customer_id = auth.uid() or public.feedback_can_handle(f.id))
        and (not p_write or f.status <> 'dong'));
  end if;
  if parts[1] = 'dong-ho' then
    return public.is_active_user() and (public.customer_access_ok(o)
      or (public.app_role() is not null and public.can_access_building(o)));
  end if;
  if not p_write and parts[1] in ('anh-toa', 'anh-phong') and public.is_active_user() then return true; end if;
  if public.app_role() is null then return false; end if;
  if parts[1] = 'de-nghi' then
    if p_write then
      st := public.unc_file_status(p_name);
      if st is not null then   -- tệp UNC đã có: chỉ người chi tiền, và chỉ khi chưa Kết thúc
        return public.is_payer() and st = 'da_duyet';
      end if;
      return exists (select 1 from public.requests r where r.id = o
        and (r.requester_id = auth.uid() or public.is_manager()
             or (public.is_payer() and r.kind in ('thanh_toan','tam_ung') and r.status = 'da_duyet')));
    end if;
    return exists (select 1 from public.requests r where r.id = o
      and (r.requester_id = auth.uid() or public.is_manager() or public.is_request_approver(r.id)))
      or public.can_pay_request(o);
  end if;
  return case parts[1]
    when 'cccd'      then public.can_manage_building(o)
    when 'hop-dong'  then case when p_write then public.can_manage_building(o) else public.can_access_building(o) end
    when 'anh-phong' then public.can_access_building(o)
    when 'anh-toa'   then case when p_write then public.can_manage_building(o) else public.can_access_building(o) end
    else false end;
end $$;
revoke execute on function public.storage_path_ok(text, boolean) from public, anon;
grant execute on function public.storage_path_ok(text, boolean) to authenticated;

-- Giữ UNC đúng luật khi thêm, đổi nhãn, xoá
create or replace function public.tg_files_unc() returns trigger
language plpgsql security definer set search_path = public as $$
declare st public.request_status; k public.request_kind; rid uuid := coalesce(new.request_id, old.request_id);
begin
  if tg_op = 'UPDATE' and (new.label is not distinct from old.label) then return new; end if;
  if (tg_op = 'INSERT' and new.label is distinct from 'unc') or (tg_op = 'DELETE' and old.label is distinct from 'unc')
     or (tg_op = 'UPDATE' and new.label is distinct from 'unc' and old.label is distinct from 'unc') then
    return coalesce(new, old);
  end if;
  if auth.uid() is null then return coalesce(new, old); end if;   -- việc hệ thống
  select status, kind into st, k from public.requests where id = rid;
  if not found then return coalesce(new, old); end if;           -- đề nghị đang bị xoá kèm tệp
  if st = 'hoan_tat' then raise exception 'Đề nghị đã kết thúc, UNC đã khoá'; end if;
  if k not in ('thanh_toan','tam_ung') or st <> 'da_duyet' then raise exception 'Chỉ đính kèm UNC khi đề nghị đã duyệt, đang chờ chi'; end if;
  if not public.is_payer() then raise exception 'Chỉ Quản lý hoặc Kế toán đính kèm UNC'; end if;
  return coalesce(new, old);
end $$;
drop trigger if exists files_unc on public.files;
create trigger files_unc before insert or update or delete on public.files
  for each row execute function public.tg_files_unc();

-- Kết thúc: DNTT bắt buộc có UNC
create or replace function public.mark_paid(p_request uuid) returns void
language plpgsql security definer set search_path = public as $$
declare r public.requests;
begin
  if public.app_role() is null then raise exception 'Cần đăng nhập'; end if;
  select * into r from public.requests where id = p_request for update;
  if not found then raise exception 'Không tìm thấy đề nghị'; end if;
  if r.kind not in ('thanh_toan','tam_ung') or r.status <> 'da_duyet' then raise exception 'Đề nghị này chưa thể kết thúc'; end if;
  if not public.is_payer() then raise exception 'Chỉ Quản lý hoặc Kế toán kết thúc đề nghị'; end if;
  if r.kind = 'thanh_toan' and not exists (select 1 from public.files f where f.request_id = r.id and f.kind = 'dinh_kem_de_nghi' and f.label = 'unc') then
    raise exception 'Cần đính kèm Uỷ nhiệm chi (UNC) trước khi kết thúc đề nghị thanh toán';
  end if;
  perform set_config('app.step_flow', 'on', true);
  update public.requests set status = 'hoan_tat' where id = p_request;
  perform set_config('app.step_flow', 'off', true);
end $$;

revoke execute on function public.is_payer(), public.can_pay_request(uuid), public.unc_file_status(text), public.mark_paid(uuid) from public, anon;
grant execute on function public.is_payer(), public.can_pay_request(uuid), public.unc_file_status(text), public.mark_paid(uuid) to authenticated;
