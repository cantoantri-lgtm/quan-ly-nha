-- Màu cho nhóm phòng (loại phòng): quản lý chọn một trong 8 màu có sẵn để phân biệt trên lưới phòng.
-- Khoá màu chỉ là chữ; mã màu thật nằm ở :root của src/styles.css (có chế độ tối).

alter table public.room_types add column if not exists color text;
alter table public.room_types drop constraint if exists room_types_color_ck;
alter table public.room_types add constraint room_types_color_ck
  check (color is null or color in ('xam_xanh','kem','cam','xanh_la','xanh_duong','tim','hong','vang'));

-- 139D Nguyễn Đình Chính: màu theo sơ đồ chủ nhà gửi
update public.room_types t set color = case t.name
    when 'Studio ban công'            then 'xam_xanh'
    when 'Studio cửa sổ trời'         then 'kem'
    when 'Duplex cửa sổ trời'         then 'cam'
    when '1PN tách bếp, cửa sổ trời'  then 'xanh_la'
    when 'Studio'                     then 'xanh_duong'
  end
from public.buildings b
where b.id = t.building_id and b.name like '139D%' and t.color is null;

-- Các nhóm còn lại chưa có màu: gán lần lượt theo thứ tự trong từng toà (quản lý đổi được)
with ranked as (
  select id, (row_number() over (partition by building_id order by sort, name) - 1) % 8 as n
  from public.room_types where color is null
)
update public.room_types t set color = (array['xam_xanh','kem','cam','xanh_la','xanh_duong','tim','hong','vang'])[r.n + 1]
from ranked r where r.id = t.id;
