-- 095: Tuỳ chỉnh màn hình chính (23/11/2026)
--  Mỗi người tự chọn các ô báo cáo hiện ở màn hình chính và thứ tự của chúng.
--  Lưu theo tài khoản (dùng chung điện thoại và máy tính). Chỉ đọc, ghi dòng của chính mình.
--  Bảng này chỉ lưu tên ô; quyền xem số liệu vẫn do từng hàm báo cáo kiểm tra.
create table public.home_layouts (
  user_id    uuid primary key references public.profiles(id) on delete cascade default auth.uid(),
  widgets    text[] not null default '{}',
  updated_at timestamptz not null default now(),
  check (cardinality(widgets) <= 20),
  check (array_to_string(widgets, ',') ~ '^([a-z_]{2,30}(,[a-z_]{2,30})*)?$')
);
alter table public.home_layouts enable row level security;
create policy home_layouts_select on public.home_layouts for select to authenticated using (user_id = auth.uid());
create policy home_layouts_insert on public.home_layouts for insert to authenticated with check (user_id = auth.uid() and public.app_role() is not null);
create policy home_layouts_update on public.home_layouts for update to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());
create policy home_layouts_delete on public.home_layouts for delete to authenticated using (user_id = auth.uid());
revoke all on public.home_layouts from anon, authenticated;
grant select, insert, update, delete on public.home_layouts to authenticated;

create or replace function public.tg_home_layouts_touch() returns trigger
language plpgsql set search_path = public as $$
begin new.updated_at := now(); return new; end $$;
create trigger home_layouts_touch before update on public.home_layouts for each row execute function public.tg_home_layouts_touch();
