-- =====================================================================
-- Neo Nestly · TÀI KHOẢN NGÂN HÀNG THEO TOÀ  (chạy sau 014)
--   Mỗi toà có thể có tài khoản nhận tiền riêng (để tạo QR thu tiền thuê + tiền cọc theo hợp đồng).
--   Ai làm ở toà (hoặc Quản lý) xem được để hiện QR; chỉ Quản lý sửa. Cộng tác viên không xem được (app_role() = NULL).
--   Toà chưa cài thì app dùng tài khoản chung ở bảng payment_settings.
-- =====================================================================
create table public.building_bank_accounts (
  building_id  uuid primary key references public.buildings(id) on delete cascade,
  bank_bin     text not null check (bank_bin ~ '^[0-9]{6}$'),
  bank_name    text not null,
  account_no   text not null check (account_no ~ '^[0-9]{6,19}$'),
  account_name text not null,
  updated_by   uuid references public.profiles(id) on delete set null,
  updated_at   timestamptz not null default now()
);
create index on public.building_bank_accounts(updated_by);
alter table public.building_bank_accounts enable row level security;
create policy bba_select on public.building_bank_accounts for select to authenticated
  using (public.can_access_building(building_id));
create policy bba_insert on public.building_bank_accounts for insert to authenticated with check (public.is_manager());
create policy bba_update on public.building_bank_accounts for update to authenticated
  using (public.is_manager()) with check (public.is_manager());
create policy bba_delete on public.building_bank_accounts for delete to authenticated using (public.is_manager());
revoke all on public.building_bank_accounts from anon;
grant select, insert, update, delete on public.building_bank_accounts to authenticated;

create or replace function public.tg_bba_before() returns trigger
language plpgsql security definer set search_path = public as $$
begin new.updated_at := now(); new.updated_by := coalesce(auth.uid(), new.updated_by); return new; end $$;
create trigger bba_before before insert or update on public.building_bank_accounts
  for each row execute function public.tg_bba_before();
revoke execute on function public.tg_bba_before() from public, anon, authenticated;
