-- 116: Số điện lúc khách nhận phòng (lưu trên hợp đồng) và số đầu kỳ tính theo số này. Luật bắt buộc nằm ở 117.
-- Số này là số đầu kỳ của kỳ ghi điện đầu tiên của khách (thay cho số cuối kỳ cũ của phòng nếu số nhận phòng ghi sau).

alter table public.contracts
  add column if not exists elec_start numeric check (elec_start is null or elec_start >= 0),
  add column if not exists elec_start_photo_path text,
  add column if not exists elec_start_photo_store text check (elec_start_photo_store in ('r2', 'supabase')),
  add column if not exists elec_start_photo_thumb boolean not null default false,
  add column if not exists elec_start_lat double precision,
  add column if not exists elec_start_lng double precision,
  add column if not exists elec_start_accuracy double precision,
  add column if not exists elec_start_taken_at timestamptz,
  add column if not exists elec_start_at timestamptz;

-- Số đầu kỳ đúng của một phòng trong một kỳ: số mới nhất giữa số cuối kỳ trước và số lúc khách hiện tại nhận phòng
create or replace function public.room_elec_expected_start(p_room uuid, p_period date) returns numeric
language sql stable security definer set search_path = public as $$
  with per as (select date_trunc('month', p_period)::date d),
  prev as (select x.end_reading, x.updated_at from public.room_elec_readings x, per where x.room_id = p_room and x.period < per.d order by x.period desc limit 1),
  ct as (select c.elec_start, coalesce(c.elec_start_at, c.elec_start_taken_at, c.created_at) elec_start_at from public.contracts c, per
         where c.room_id = p_room and c.status = 'hieu_luc' and c.elec_start is not null
           and date_trunc('month', c.start_date)::date <= per.d limit 1)
  select case when ct.elec_start is not null and (prev.updated_at is null or ct.elec_start_at > prev.updated_at) then ct.elec_start
              else prev.end_reading end
  from (select 1) one left join prev on true left join ct on true
$$;
revoke all on function public.room_elec_expected_start(uuid, date) from public, anon;
grant execute on function public.room_elec_expected_start(uuid, date) to authenticated;

-- Bảng ghi điện và hàm lưu số dùng cùng số đầu kỳ này
do $$
declare d text; a text; b text;
begin
  d := pg_get_functiondef('public.room_utility_month(uuid,date)'::regprocedure);
  a := '(select x.end_reading from public.room_elec_readings x, per where x.room_id = r.id and x.period < per.d order by x.period desc limit 1)';
  if position(a in d) = 0 then raise exception 'room_utility_month: không thấy đoạn số cuối kỳ trước'; end if;
  execute replace(d, a, 'public.room_elec_expected_start(r.id, per.d)');

  d := pg_get_functiondef('public.room_elec_save(uuid,date,numeric,numeric,text,text,text,boolean,double precision,double precision,double precision,timestamptz)'::regprocedure);
  a := 'select x.end_reading into prev from public.room_elec_readings x where x.room_id = p_room and x.period < per order by x.period desc limit 1;';
  b := 'prev := public.room_elec_expected_start(p_room, per);';
  if position(a in d) = 0 then raise exception 'room_elec_save: không thấy đoạn số cuối kỳ trước'; end if;
  d := replace(d, a, b);
  d := replace(d, 'số đầu kỳ phải bằng số cuối tháng trước (%)', 'số đầu kỳ phải bằng số cuối tháng trước hoặc số lúc khách nhận phòng (%)');
  execute d;
end $$;
