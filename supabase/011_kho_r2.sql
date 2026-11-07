-- =====================================================================
-- Neo Nestly · KHO ẢNH TRÊN CLOUDFLARE R2  (chạy sau 010)
--   Tệp mới có thể nằm ở Cloudflare R2 thay vì Supabase Storage. Cơ sở dữ liệu chỉ giữ đường dẫn (cột path) và
--   cho biết tệp nằm ở đâu (cột store). Tệp cũ vẫn ở Supabase cho tới khi được chuyển sang.
--   Quyền xem / tải lên vẫn do storage_path_ok quyết định; Edge Function `kho-anh` hỏi lại hàm này trước khi ký link R2.
-- =====================================================================

alter table public.files
  add column if not exists store text not null default 'supabase' check (store in ('supabase', 'r2')),
  add column if not exists thumb boolean not null default false;   -- có ảnh nhỏ <đường dẫn>_t.jpg để hiện danh sách nhanh

-- Người dùng chỉ đổi được nhãn / ảnh đại diện; việc chuyển kho (store, thumb) do dịch vụ phía máy chủ làm (không có auth.uid())
create or replace function public.tg_files_before() returns trigger
language plpgsql security definer set search_path = public as $$
declare owner uuid := (string_to_array(new.path, '/'))[2]::uuid; b uuid; consent timestamptz;
begin
  if tg_op = 'UPDATE' then
    if auth.uid() is not null
       and to_jsonb(new) - 'is_cover' - 'label' is distinct from to_jsonb(old) - 'is_cover' - 'label' then
      raise exception 'Chỉ được đổi nhãn hoặc ảnh đại diện của tệp';
    end if;
    return new;
  end if;
  if new.kind = 'cccd' then
    select building_id, cccd_consent_at into b, consent from public.tenants where id = new.tenant_id;
    if consent is null then raise exception 'Cần ghi nhận khách đã đồng ý cho lưu ảnh CCCD trước khi tải ảnh lên'; end if;
  elsif new.kind = 'hop_dong' then
    select building_id into b from public.contracts where id = new.contract_id;
  elsif new.kind = 'anh_phong' then
    select building_id into b from public.rooms where id = new.room_id;
  else
    select building_id into b from public.requests where id = new.request_id;
    if owner is distinct from new.request_id then raise exception 'Đường dẫn tệp không khớp đề nghị'; end if;
    new.building_id := b;
    return new;
  end if;
  if b is null or owner is distinct from b then raise exception 'Đường dẫn tệp không khớp toà'; end if;
  new.building_id := b;
  return new;
end $$;
revoke execute on function public.tg_files_before() from public, anon, authenticated;

-- Hỏi quyền cho nhiều đường dẫn một lần (Edge Function dùng): trả về những đường dẫn được phép
create or replace function public.storage_paths_ok(p_paths text[], p_write boolean) returns text[]
language sql stable security definer set search_path = public as $$
  select coalesce(array_agg(p), '{}'::text[])
  from unnest(case when coalesce(array_length(p_paths, 1), 0) <= 200 then p_paths else '{}'::text[] end) as p
  where public.storage_path_ok(p, p_write)
$$;
revoke execute on function public.storage_paths_ok(text[], boolean) from public, anon;
grant execute on function public.storage_paths_ok(text[], boolean) to authenticated;
