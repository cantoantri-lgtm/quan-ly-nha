-- 113: Số tài khoản định danh (VietinBank, BIDV…) có cả chữ, ví dụ 07M2F4K89CMT8.
-- Cho phép chữ in hoa và số, 6–19 ký tự (giới hạn trường số tài khoản của VietQR).
alter table public.building_bank_accounts drop constraint if exists building_bank_accounts_account_no_check;
alter table public.building_bank_accounts add constraint building_bank_accounts_account_no_check
  check (account_no ~ '^[0-9A-Z]{6,19}$');

alter table public.customer_pay_account drop constraint if exists customer_pay_account_account_no_check;
alter table public.customer_pay_account add constraint customer_pay_account_account_no_check
  check (account_no ~ '^[0-9A-Z]{6,19}$');
