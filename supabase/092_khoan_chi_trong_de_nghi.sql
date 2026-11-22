-- 092: Người xem được đề nghị (người duyệt, kế toán) xem các khoản chi toà gắn kèm (SQL 091)
create or replace function public.request_expenses(p_request uuid)
returns table (id uuid, building_code text, spent_on date, category text, amount numeric, note text, paid_by_name text,
               settle_status text, settle_note text)
language plpgsql stable security definer set search_path = public as $$
begin
  if not public.can_see_request(p_request) then raise exception 'Không có quyền xem đề nghị này'; end if;
  return query
    select e.id, b.code, e.spent_on, e.category, e.amount, e.note, p.full_name, e.settle_status, e.settle_note
      from public.building_expenses e
      join public.buildings b on b.id = e.building_id
      left join public.profiles p on p.id = e.paid_by
     where e.request_id = p_request
     order by e.spent_on, b.code;
end $$;
revoke execute on function public.request_expenses(uuid) from public, anon;
grant execute on function public.request_expenses(uuid) to authenticated;
