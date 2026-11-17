-- Số điện / nước của TỪNG PHÒNG mỗi tháng (17/11/2026).
-- Khác meter_readings (gắn tài khoản khách hàng trên app): bảng này gắn phòng, dùng cho mọi phòng kể cả khách không có tài khoản.
-- Mỗi phòng mỗi loại một số cho mỗi tháng (period = ngày 1); ghi lại trong tháng thì thay số cũ.
-- Ghi / xoá: Quản lý, Giám sát toà, sale phòng Kinh doanh phụ trách toà (can_edit_building). Xem: nhân sự của toà.
-- Tiêu thụ = số tháng này - số tháng trước. Đơn giá lấy từ chính sách toà (building_policy.fees, dòng "Điện" / "Nước").

create table public.room_meter_readings (
  id uuid primary key default gen_random_uuid(),
  room_id uuid not null references public.rooms(id) on delete cascade,
  building_id uuid not null references public.buildings(id) on delete cascade,
  kind text not null check (kind in ('dien','nuoc')),
  period date not null check (period = date_trunc('month', period)::date),
  reading numeric(12,1) not null check (reading >= 0),
  note text check (note is null or char_length(note) <= 200),
  created_by uuid references public.profiles(id) on delete set null default auth.uid(),
  created_at timestamptz not null default now(),
  updated_by uuid references public.profiles(id) on delete set null,
  updated_at timestamptz not null default now(),
  unique (room_id, kind, period)
);
create index on public.room_meter_readings(building_id, kind, period);
create index on public.room_meter_readings(created_by);
create index on public.room_meter_readings(updated_by);
alter table public.room_meter_readings enable row level security;
create policy rmeter_select on public.room_meter_readings for select to authenticated
  using (public.app_role() is not null and public.can_access_building(building_id));
revoke all on public.room_meter_readings from anon, authenticated;
grant select on public.room_meter_readings to authenticated;

-- Lưu nhiều phòng một lần. p_rows: [{room_id, reading, note}]; reading rỗng = xoá số tháng đó.
-- Số mới không được nhỏ hơn số tháng trước (trừ khi ghi chú "thay đồng hồ").
create or replace function public.room_meter_save(p_building uuid, p_kind text, p_period date, p_rows jsonb) returns integer
language plpgsql security definer set search_path = public as $$
declare
  per date := date_trunc('month', p_period)::date;
  x jsonb; rid uuid; val numeric; nt text; prev numeric; code text; n int := 0;
begin
  if not public.can_edit_building(p_building) then
    raise exception 'Chỉ sale phụ trách toà, Giám sát hoặc Quản lý ghi được số điện nước phòng';
  end if;
  if p_kind not in ('dien','nuoc') then raise exception 'Loại đồng hồ không hợp lệ'; end if;
  if per > date_trunc('month', (now() at time zone 'Asia/Ho_Chi_Minh'))::date then raise exception 'Chưa tới tháng này'; end if;
  for x in select * from jsonb_array_elements(coalesce(p_rows, '[]'::jsonb)) loop
    rid := nullif(x->>'room_id', '')::uuid;
    select r.code into code from public.rooms r where r.id = rid and r.building_id = p_building;
    if code is null then raise exception 'Phòng không thuộc toà này'; end if;
    nt := nullif(btrim(coalesce(x->>'note', '')), '');
    if nullif(btrim(coalesce(x->>'reading', '')), '') is null then
      delete from public.room_meter_readings where room_id = rid and kind = p_kind and period = per;
      continue;
    end if;
    val := (x->>'reading')::numeric;
    if val < 0 then raise exception 'Phòng %: số không hợp lệ', code; end if;
    select m.reading into prev from public.room_meter_readings m
      where m.room_id = rid and m.kind = p_kind and m.period < per order by m.period desc limit 1;
    if prev is not null and val < prev and coalesce(nt, '') !~* 'thay' then
      raise exception 'Phòng %: số mới (%) nhỏ hơn tháng trước (%). Nếu đã thay đồng hồ, ghi chú "thay đồng hồ"', code, val, prev;
    end if;
    insert into public.room_meter_readings (room_id, building_id, kind, period, reading, note, created_by, updated_by)
    values (rid, p_building, p_kind, per, val, left(nt, 200), auth.uid(), auth.uid())
    on conflict (room_id, kind, period) do update
      set reading = excluded.reading, note = excluded.note, updated_by = auth.uid(), updated_at = now();
    n := n + 1;
  end loop;
  return n;
end $$;

revoke execute on function public.room_meter_save(uuid, text, date, jsonb) from public, anon;
grant execute on function public.room_meter_save(uuid, text, date, jsonb) to authenticated;
