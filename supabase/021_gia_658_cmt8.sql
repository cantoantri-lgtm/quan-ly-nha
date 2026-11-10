-- 658 CMT8: giá niêm yết và loại phòng theo bảng chủ nhà gửi (18 phòng).
-- Giữ nguyên tình trạng phòng; chỉ đổi giá và nhóm phòng. Nhóm tạm "Phòng đã có khách (chưa rõ loại)" được dọn đi khi không còn phòng nào.
do $$
declare
  b uuid; t_win uuid; t_bal uuid; t_old uuid; furn text; n int;
begin
  select id into b from public.buildings where name = '658 CMT8';
  if b is null then raise exception 'Không thấy toà 658 CMT8'; end if;

  select id, furniture into t_win, furn from public.room_types where building_id = b and name = 'Studio' limit 1;
  select id into t_old from public.room_types where building_id = b and name like 'Phòng đã có khách%' limit 1;
  if t_win is null then
    insert into public.room_types(building_id, name, rent_mode, list_price, sort, color)
    values (b, 'Studio cửa sổ', 'thang', 6000000, 0, 'kem') returning id into t_win;
  else
    update public.room_types set name = 'Studio cửa sổ', list_price = 6000000, color = 'kem', sort = 0 where id = t_win;
  end if;
  insert into public.room_types(building_id, name, rent_mode, list_price, sort, color, furniture, max_occupants)
  select b, 'Studio ban công', 'thang', 7800000, 1, 'xam_xanh', furn, max_occupants from public.room_types where id = t_win
  on conflict do nothing;
  select id into t_bal from public.room_types where building_id = b and name = 'Studio ban công' limit 1;

  update public.rooms r set list_price = v.price,
         room_type_id = case when v.bal then t_bal else t_win end,
         room_type = case when v.bal then 'Studio ban công' else 'Studio cửa sổ' end
  from (values
    ('G01',6500000,false),('G02',6500000,false),('G03',6000000,false),('G04',6000000,false),('G05',6500000,false),('G06',6500000,false),
    ('101',7800000,true),('102',7500000,true),('103',5800000,false),('104',5800000,false),('105',6000000,false),('106',8000000,true),
    ('201',7800000,true),('202',7200000,true),('203',5500000,false),('204',5500000,false),('205',5800000,false),('206',7500000,false)
  ) as v(code, price, bal)
  where r.building_id = b and r.code = v.code;
  get diagnostics n = row_count;
  if n <> 18 then raise exception 'Cần cập nhật 18 phòng, thực tế %', n; end if;

  if t_old is not null and not exists (select 1 from public.rooms where room_type_id = t_old)
     and not exists (select 1 from public.files where room_type_id = t_old) then
    delete from public.room_types where id = t_old;
  end if;
end $$;
