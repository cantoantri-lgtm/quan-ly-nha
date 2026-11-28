-- 115: Ghi số điện phòng bắt buộc kèm ảnh đồng hồ MỚI (cả khung phòng và bảng ghi điện cả toà).
-- Áp dụng cùng lúc với bản giao diện có nút chụp ảnh ở cả hai nơi (bản cũ không gửi ảnh sẽ bị chặn).
do $$
declare d text := pg_get_functiondef('public.room_elec_save(uuid,date,numeric,numeric,text,text,text,boolean,double precision,double precision,double precision,timestamptz)'::regprocedure);
  a text := $a$  if p_path is not null then
    if p_path not like$a$;
  b text := $b$  if p_path is null then raise exception 'Cần chụp ảnh đồng hồ điện phòng % mới lưu được số', rm.code; end if;
  if exists (select 1 from public.room_elec_readings x where x.room_id = p_room and x.period = per and x.photo_path = p_path) then
    raise exception 'Phòng %: cần chụp ảnh đồng hồ mới cho lần lưu này', rm.code;
  end if;
  if p_path is not null then
    if p_path not like$b$;
begin
  if position(a in d) = 0 then raise exception 'Không tìm thấy đoạn cần sửa trong room_elec_save'; end if;
  execute replace(d, a, b);
end $$;
