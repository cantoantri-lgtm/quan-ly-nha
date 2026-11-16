-- LOA (Tờ trình phê duyệt), phần 2: bảng và quyền. Chạy sau 045_loa_enum.sql; tiếp theo là 047 (luồng duyệt) và 048 (RPC).
--  * LOA là một loại đề nghị (requests.kind = 'loa') nên dùng chung luồng duyệt, thông báo, tệp đính kèm, bản in.
--    Luồng duyệt: Leader → Trưởng phòng → Kế toán → Giám đốc (như đề nghị tiền).
--  * Có trạng thái Nháp ('nhap'): chỉ người lập và người cùng soạn thấy. Số LOA (LOA-YYYY-NNNN) cấp khi trình duyệt lần đầu.
--  * Mọi thao tác ghi LOA đi qua RPC loa_save (lập, sửa, dự toán, người cùng soạn, người được xem, trình duyệt).
--  * Đề nghị thanh toán và tạm ứng BẮT BUỘC gắn một LOA chi tiền đã duyệt (requests.loa_id) khi loa_settings.require_for_payments = true.
--    Đề nghị cũ đang chờ duyệt không bị chặn; nếu bị trả lại / rút rồi gửi lại thì phải gắn LOA.
--  * Vượt dự toán LOA: không chặn, giao diện cảnh báo cho người lập và các cấp duyệt (loa_brief / loa_pickable trả số đã dùng).

create sequence if not exists public.loa_doc_seq;

alter table public.requests add column if not exists loa_id uuid references public.requests(id) on delete set null;
create index if not exists requests_loa_id_idx on public.requests(loa_id);

alter table public.requests drop constraint if exists req_amount;
alter table public.requests add constraint req_amount check (amount is null or amount > 0 or (kind = 'loa' and amount = 0));
alter table public.requests drop constraint if exists req_shape;
alter table public.requests add constraint req_shape check (
  case kind
    when 'nghi_phep' then (sub_type in ('phep_nam','khong_luong') and span in ('ca_ngay','sang','chieu'))
    when 'ra_ngoai' then (sub_type in ('khong_den_cty','co_quay_lai','khong_quay_lai'))
    when 'cong_tac' then (end_date is not null and coalesce(btrim(location), '') <> '')
    when 'loa' then true
    else (amount is not null)
  end);

create table public.loa_details (
  request_id    uuid primary key references public.requests(id) on delete cascade,
  subject       text not null check (char_length(btrim(subject)) between 1 and 200),
  category      text check (category in ('van_hanh','marketing','kinh_doanh','dau_tu_mua_sam','he_thong','nhan_su','ke_toan','phap_ly','chung')),
  propose_dept  uuid references public.departments(id) on delete set null,
  sbu           text[] not null default '{}' check (sbu <@ array['tat_ca','cho_thue','khach_san','phap_ly_pccc','xay_dung','khong_ap_dung']),
  background    text check (background is null or char_length(background) <= 4000),
  seek_approval text check (seek_approval is null or char_length(seek_approval) <= 4000),
  pay_receive   text not null default 'chi' check (pay_receive in ('chi','thu')),
  tax           text not null default 'chua_gom' check (tax in ('chua_gom','da_gom')),
  budget_status text not null default 'trong' check (budget_status in ('trong','ngoai')),
  budget_item_no text check (budget_item_no is null or char_length(budget_item_no) <= 60),
  details       text check (details is null or char_length(details) <= 8000),
  autosum       boolean not null default false,
  ref_loa_id    uuid references public.requests(id) on delete set null,
  report_due    date,
  submitted_at  timestamptz,
  updated_by    uuid references public.profiles(id) on delete set null,
  updated_at    timestamptz not null default now()
);
create index on public.loa_details(propose_dept);
create index on public.loa_details(ref_loa_id);
create index on public.loa_details(updated_by);

-- Dự toán ngân sách
create table public.loa_lines (
  id          uuid primary key default gen_random_uuid(),
  request_id  uuid not null references public.requests(id) on delete cascade,
  line_no     int not null,
  description text not null check (char_length(btrim(description)) between 1 and 300),
  unit        text check (unit is null or char_length(unit) <= 20),
  quantity    numeric(14,2) not null default 1 check (quantity > 0),
  unit_price  bigint not null check (unit_price >= 0),
  amount      bigint not null check (amount >= 0),
  note        text check (note is null or char_length(note) <= 300),
  unique (request_id, line_no)
);

-- Người cùng soạn ('soan': sửa được khi còn nháp / bị trả lại) và cá nhân được xem ('xem')
create table public.loa_members (
  request_id uuid not null references public.requests(id) on delete cascade,
  user_id    uuid not null references public.profiles(id) on delete cascade,
  role       text not null check (role in ('soan','xem')),
  primary key (request_id, user_id)
);
create index on public.loa_members(user_id);

-- Đơn vị (phòng ban) được xem
create table public.loa_viewer_depts (
  request_id    uuid not null references public.requests(id) on delete cascade,
  department_id uuid not null references public.departments(id) on delete cascade,
  primary key (request_id, department_id)
);
create index on public.loa_viewer_depts(department_id);

-- ---------- Quyền ----------
-- Được dùng LOA (xem, gắn vào đề nghị tiền): người lập, người cùng soạn, người / đơn vị được xem, Quản lý. Bản nháp: chỉ người lập và người cùng soạn.
create or replace function public.loa_can_use(p_loa uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select public.app_role() is not null and exists (
    select 1 from public.requests r where r.id = p_loa and r.kind = 'loa' and (
      r.requester_id = auth.uid()
      or exists (select 1 from public.loa_members m where m.request_id = r.id and m.user_id = auth.uid()
                 and (m.role = 'soan' or r.status <> 'nhap'))
      or (r.status <> 'nhap' and (public.is_manager()
          or exists (select 1 from public.loa_viewer_depts v join public.org_staff o on o.department_id = v.department_id
                     where v.request_id = r.id and o.profile_id = auth.uid())))))
$$;

-- Người lập hoặc người cùng soạn, khi tờ trình không đang trong quá trình duyệt
create or replace function public.loa_can_edit(p_loa uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select public.app_role() is not null and exists (
    select 1 from public.requests r where r.id = p_loa and r.kind = 'loa' and r.status in ('nhap','tra_lai','tu_choi','da_huy')
      and (r.requester_id = auth.uid()
           or exists (select 1 from public.loa_members m where m.request_id = r.id and m.user_id = auth.uid() and m.role = 'soan')))
$$;

-- Người lập / người duyệt / Kế toán chi của một đề nghị tiền có gắn LOA này cũng xem được LOA (để đối chiếu dự toán)
create or replace function public.loa_linked_visible(p_loa uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select public.app_role() is not null and exists (
    select 1 from public.requests l join public.requests p on p.loa_id = l.id and p.kind in ('thanh_toan','tam_ung')
    where l.id = p_loa and l.kind = 'loa' and l.status <> 'nhap'
      and (p.requester_id = auth.uid() or public.is_request_approver(p.id)
           or (public.is_duty('ke_toan') and p.status in ('da_duyet','hoan_tat'))))
$$;

create or replace function public.request_editable(p_request uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.requests r where r.id = p_request and r.status in ('nhap','tra_lai','tu_choi','da_huy'))
$$;

create or replace function public.can_see_request(p_request uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select public.app_role() is not null and exists (
    select 1 from public.requests r where r.id = p_request and (
      r.requester_id = auth.uid()
      or (r.status <> 'nhap' and (public.is_manager() or public.is_request_approver(r.id)
           or (public.is_duty('ke_toan') and r.kind in ('thanh_toan','tam_ung') and r.status in ('da_duyet','hoan_tat'))))
      or (r.kind = 'loa' and (public.loa_can_use(r.id) or public.loa_linked_visible(r.id)))))
$$;

drop policy if exists requests_select on public.requests;
create policy requests_select on public.requests for select to authenticated using (
  requester_id = (select auth.uid())
  or (status <> 'nhap' and (public.is_manager() or public.is_request_approver(id)
       or (public.is_duty('ke_toan') and kind in ('thanh_toan','tam_ung') and status in ('da_duyet','hoan_tat'))))
  or (kind = 'loa' and (public.loa_can_use(id) or public.loa_linked_visible(id))));

drop policy if exists requests_delete on public.requests;
create policy requests_delete on public.requests for delete to authenticated using (
  (requester_id = (select auth.uid()) or public.is_manager()) and status in ('nhap','tra_lai','tu_choi','da_huy'));

alter table public.loa_details enable row level security;
alter table public.loa_lines enable row level security;
alter table public.loa_members enable row level security;
alter table public.loa_viewer_depts enable row level security;
create policy loa_details_select on public.loa_details for select to authenticated using (public.can_see_request(request_id));
create policy loa_lines_select on public.loa_lines for select to authenticated using (public.can_see_request(request_id));
create policy loa_members_select on public.loa_members for select to authenticated using (public.can_see_request(request_id));
create policy loa_viewer_depts_select on public.loa_viewer_depts for select to authenticated using (public.can_see_request(request_id));
revoke all on public.loa_details, public.loa_lines, public.loa_members, public.loa_viewer_depts from anon, authenticated;
grant select on public.loa_details, public.loa_lines, public.loa_members, public.loa_viewer_depts to authenticated;

-- Tệp đính kèm: LOA đã duyệt xong thì khoá tệp; người cùng soạn tải được khi còn sửa được
create or replace function public.storage_path_ok(p_name text, p_write boolean) returns boolean
language plpgsql stable security definer set search_path = public as $$
declare
  parts text[] := string_to_array(coalesce(p_name, ''), '/');
  o uuid;
  st text;
  rq public.requests;
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
      select * into rq from public.requests where id = o;
      if not found then return false; end if;
      if rq.kind = 'loa' then
        return rq.status not in ('da_duyet','hoan_tat')
          and (rq.requester_id = auth.uid() or public.loa_can_edit(o) or (public.is_manager() and rq.status <> 'nhap'));
      end if;
      st := public.unc_file_status(p_name);
      if st is not null then
        return public.is_payer() and st = 'da_duyet';
      end if;
      return rq.requester_id = auth.uid() or public.is_manager()
        or (public.is_payer() and rq.kind in ('thanh_toan','tam_ung') and rq.status = 'da_duyet');
    end if;
    return public.can_see_request(o) or public.can_pay_request(o);
  end if;
  return case parts[1]
    when 'cccd'      then public.can_manage_building(o)
    when 'hop-dong'  then case when p_write then public.can_manage_building(o) else public.can_access_building(o) end
    when 'anh-phong' then public.can_access_building(o)
    when 'anh-toa'   then case when p_write then public.can_manage_building(o) else public.can_access_building(o) end
    else false end;
end $$;

-- Công tắc "bắt buộc gắn LOA cho đề nghị thanh toán / tạm ứng". Tắt lúc đầu để bản giao diện cũ (chưa có ô chọn LOA) vẫn lập được đề nghị;
-- bật (update public.loa_settings set require_for_payments = true) ngay sau khi đưa giao diện mới lên bản chính thức.
create table public.loa_settings (
  id boolean primary key default true check (id),
  require_for_payments boolean not null default false,
  updated_at timestamptz not null default now()
);
insert into public.loa_settings (id) values (true);
alter table public.loa_settings enable row level security;
create policy loa_settings_select on public.loa_settings for select to authenticated using (public.app_role() is not null);
revoke all on public.loa_settings from anon, authenticated;
grant select on public.loa_settings to authenticated;

revoke execute on function public.loa_can_use(uuid), public.loa_can_edit(uuid), public.loa_linked_visible(uuid), public.storage_path_ok(text, boolean) from public, anon;
grant execute on function public.loa_can_use(uuid), public.loa_can_edit(uuid), public.loa_linked_visible(uuid), public.storage_path_ok(text, boolean) to authenticated;
