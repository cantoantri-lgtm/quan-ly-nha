-- Tạm ngưng từng loại đề nghị với nhân viên (16/11/2026: chủ DN ngưng LOA, tạm ứng, thanh toán để kiểm tra trước khi triển khai).
-- Quản lý (role quan_ly) luôn lập được. Nhân viên, Giám sát (kể cả Kế toán, Leader) không lập mới, không gửi lại được loại đang ngưng.
-- Đề nghị đã gửi trước đó vẫn duyệt, chi tiền, kết thúc bình thường.
create table public.request_kind_settings (
  kind          public.request_kind primary key,
  staff_enabled boolean not null default true,
  updated_at    timestamptz not null default now(),
  updated_by    uuid references public.profiles(id) on delete set null
);
create index on public.request_kind_settings(updated_by);
insert into public.request_kind_settings (kind, staff_enabled) values ('loa', false), ('tam_ung', false), ('thanh_toan', false);
alter table public.request_kind_settings enable row level security;
create policy request_kind_settings_select on public.request_kind_settings for select to authenticated using (public.app_role() is not null);
revoke all on public.request_kind_settings from anon, authenticated;
grant select on public.request_kind_settings to authenticated;

create or replace function public.request_kind_open(p_kind public.request_kind) returns boolean
language sql stable security definer set search_path = public as $$
  select public.is_manager() or coalesce((select s.staff_enabled from public.request_kind_settings s where s.kind = p_kind), true)
$$;

-- Quản lý bật / ngưng một loại đề nghị với nhân viên
create or replace function public.request_kind_set(p_kind public.request_kind, p_enabled boolean) returns void
language plpgsql security definer set search_path = public as $$
begin
  if not public.is_manager() then raise exception 'Chỉ Quản lý mới bật / ngưng chức năng'; end if;
  insert into public.request_kind_settings (kind, staff_enabled, updated_at, updated_by)
  values (p_kind, p_enabled, now(), auth.uid())
  on conflict (kind) do update set staff_enabled = excluded.staff_enabled, updated_at = now(), updated_by = auth.uid();
end $$;

-- Chặn lập mới / gửi lại loại đang ngưng (chạy sau requests_doc, requests_guard theo thứ tự tên)
create or replace function public.tg_requests_pause() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is not null and not public.request_kind_open(new.kind)
     and (tg_op = 'INSERT' or (new.status = 'cho_duyet' and old.status is distinct from 'cho_duyet')) then
    raise exception '% đang tạm ngưng với nhân viên. Liên hệ Quản lý.', public.request_label(new.kind, new.sub_type);
  end if;
  return new;
end $$;
create trigger requests_pause before insert or update on public.requests
  for each row execute function public.tg_requests_pause();

revoke execute on function public.request_kind_open(public.request_kind), public.request_kind_set(public.request_kind, boolean), public.tg_requests_pause() from public, anon;
grant execute on function public.request_kind_open(public.request_kind), public.request_kind_set(public.request_kind, boolean) to authenticated;
