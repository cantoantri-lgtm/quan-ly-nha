-- 066: Trình chiếu đầu trang website (nhiều ảnh / clip, tự chuyển)
-- Kho riêng 'web-media' công khai (nội dung để khách xem), tối đa 50 MB / tệp, chỉ ảnh và video.
-- Chỉ Quản lý tải lên / xoá, đường dẫn cố định dạng hero/<uuid>.<đuôi>.
-- web_settings.data thêm hero_media (tối đa 12 mục) và hero_interval (3–15 giây, mặc định 5).

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('web-media', 'web-media', true, 52428800,
        array['image/jpeg', 'image/png', 'image/webp', 'video/mp4', 'video/webm'])
on conflict (id) do update set public = true, file_size_limit = 52428800,
  allowed_mime_types = array['image/jpeg', 'image/png', 'image/webp', 'video/mp4', 'video/webm'];

drop policy if exists web_media_insert on storage.objects;
create policy web_media_insert on storage.objects for insert to authenticated
  with check (bucket_id = 'web-media' and public.is_manager()
              and name ~ '^hero/[0-9a-f-]{36}\.(jpg|png|webp|mp4|webm)$');
drop policy if exists web_media_select on storage.objects;
create policy web_media_select on storage.objects for select to authenticated
  using (bucket_id = 'web-media' and public.is_manager());
drop policy if exists web_media_delete on storage.objects;
create policy web_media_delete on storage.objects for delete to authenticated
  using (bucket_id = 'web-media' and public.is_manager());

-- Làm sạch cài đặt: như 065, thêm hero_media và hero_interval
create or replace function public.web_settings_clean(p jsonb) returns jsonb
language plpgsql immutable set search_path = public as $$
declare
  o jsonb := '{}'::jsonb;
  k text; v text; lim int;
  texts constant jsonb := '{"eyebrow":60,"title1":60,"title2":60,"subtitle":200,"notice":160,"address":200,"hours":100,
                            "seo_title":70,"seo_desc":160,"footer_note":200}';
  flags constant text[] := array['notice_on','show_features','show_buildings','show_app','show_brands'];
  x jsonb;
  n int;
begin
  if p is null or jsonb_typeof(p) <> 'object' then raise exception 'Dữ liệu cài đặt không hợp lệ'; end if;
  for k, lim in select key, value::int from jsonb_each_text(texts) loop
    if p ? k and jsonb_typeof(p->k) <> 'null' then
      v := btrim(p->>k);
      if char_length(v) > lim then raise exception 'Mục "%" dài quá % ký tự', k, lim; end if;
      if v <> '' then o := o || jsonb_build_object(k, v); end if;
    end if;
  end loop;
  foreach k in array flags loop
    if p ? k then
      if jsonb_typeof(p->k) <> 'boolean' then raise exception 'Mục "%" phải là bật / tắt', k; end if;
      o := o || jsonb_build_object(k, p->k);
    end if;
  end loop;
  v := btrim(coalesce(p->>'hotline', ''));
  if v <> '' then
    if v !~ '^\+?[0-9 .]{8,16}$' then raise exception 'Hotline chỉ gồm số, dấu cách hoặc dấu chấm (8–16 ký tự)'; end if;
    o := o || jsonb_build_object('hotline', v);
  end if;
  v := regexp_replace(coalesce(p->>'zalo', ''), '\D', '', 'g');
  if v <> '' then
    if v !~ '^0[0-9]{9}$' then raise exception 'Số Zalo phải là số điện thoại 10 chữ số, bắt đầu bằng 0'; end if;
    o := o || jsonb_build_object('zalo', v);
  end if;
  v := lower(btrim(coalesce(p->>'email', '')));
  if v <> '' then
    if v !~ '^[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}$' or char_length(v) > 120 then raise exception 'Email chưa đúng định dạng'; end if;
    o := o || jsonb_build_object('email', v);
  end if;
  if coalesce(p->>'hero_building', '') <> '' then
    if p->>'hero_building' !~ '^[0-9a-f-]{36}$' then raise exception 'Toà làm ảnh đầu trang không hợp lệ'; end if;
    o := o || jsonb_build_object('hero_building', p->>'hero_building');
  end if;
  foreach k in array array['hidden_buildings','hidden_rooms'] loop
    x := coalesce(p->k, '[]'::jsonb);
    if jsonb_typeof(x) <> 'array' or jsonb_array_length(x) > 2000
       or exists (select 1 from jsonb_array_elements(x) e where jsonb_typeof(e) <> 'string' or e #>> '{}' !~ '^[0-9a-f-]{36}$') then
      raise exception 'Danh sách ẩn không hợp lệ';
    end if;
    o := o || jsonb_build_object(k, (select coalesce(jsonb_agg(distinct e), '[]'::jsonb) from jsonb_array_elements(x) e));
  end loop;
  -- Trình chiếu đầu trang
  x := coalesce(p->'hero_media', '[]'::jsonb);
  if jsonb_typeof(x) <> 'array' or jsonb_array_length(x) > 12 then raise exception 'Trình chiếu đầu trang tối đa 12 ảnh / clip'; end if;
  if exists (select 1 from jsonb_array_elements(x) e
              where jsonb_typeof(e) <> 'object'
                 or coalesce(e->>'path', '') !~ '^hero/[0-9a-f-]{36}\.(jpg|png|webp|mp4|webm)$'
                 or coalesce(e->>'kind', '') not in ('image', 'video')
                 or (e->>'kind' = 'video') <> (e->>'path' ~ '\.(mp4|webm)$')) then
    raise exception 'Ảnh / clip đầu trang không hợp lệ';
  end if;
  o := o || jsonb_build_object('hero_media',
         (select coalesce(jsonb_agg(jsonb_build_object('path', e->>'path', 'kind', e->>'kind') order by i), '[]'::jsonb)
            from jsonb_array_elements(x) with ordinality t(e, i)));
  if p ? 'hero_interval' and jsonb_typeof(p->'hero_interval') <> 'null' then
    if jsonb_typeof(p->'hero_interval') <> 'number' then raise exception 'Thời gian chuyển ảnh phải là số giây'; end if;
    n := (p->>'hero_interval')::numeric::int;
    if n < 3 or n > 15 then raise exception 'Thời gian chuyển ảnh từ 3 đến 15 giây'; end if;
    o := o || jsonb_build_object('hero_interval', n);
  end if;
  return o;
end $$;
revoke execute on function public.web_settings_clean(jsonb) from public, anon, authenticated;
