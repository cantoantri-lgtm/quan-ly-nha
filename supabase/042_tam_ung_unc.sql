-- Đề nghị tạm ứng cũng phải đính kèm UNC (hoặc phiếu chi nếu chi tiền mặt) trước khi Kết thúc, như DNTT.
create or replace function public.mark_paid(p_request uuid) returns void
language plpgsql security definer set search_path = public as $$
declare r public.requests;
begin
  if public.app_role() is null then raise exception 'Cần đăng nhập'; end if;
  select * into r from public.requests where id = p_request for update;
  if not found then raise exception 'Không tìm thấy đề nghị'; end if;
  if r.kind not in ('thanh_toan','tam_ung') or r.status <> 'da_duyet' then raise exception 'Đề nghị này chưa thể kết thúc'; end if;
  if not public.is_payer() then raise exception 'Chỉ Quản lý hoặc Kế toán kết thúc đề nghị'; end if;
  if not exists (select 1 from public.files f where f.request_id = r.id and f.kind = 'dinh_kem_de_nghi' and f.label = 'unc') then
    raise exception 'Cần đính kèm Uỷ nhiệm chi (UNC) trước khi kết thúc đề nghị %',
      case r.kind when 'thanh_toan' then 'thanh toán' else 'tạm ứng' end;
  end if;
  perform set_config('app.step_flow', 'on', true);
  update public.requests set status = 'hoan_tat' where id = p_request;
  perform set_config('app.step_flow', 'off', true);
end $$;
revoke execute on function public.mark_paid(uuid) from public, anon;
grant execute on function public.mark_paid(uuid) to authenticated;
