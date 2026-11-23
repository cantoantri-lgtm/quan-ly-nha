-- 098: Website bản tiếng Anh (/en/phong) (23/11/2026)
--  Thêm các ô chữ tiếng Anh vào Cài đặt website: đầu trang, thông báo, cuối trang, tiêu đề / mô tả Google.
--  Để trống thì website dùng câu mặc định tiếng Anh trong mã nguồn (src/web/webApi.ts, WEB_DEFAULTS_EN).
do $$
declare def text := pg_get_functiondef('public.web_settings_clean(jsonb)'::regprocedure);
  old_txt text := '"chat_greeting":160}';
begin
  if position(old_txt in def) = 0 then raise exception 'web_settings_clean: không tìm thấy đoạn cần sửa'; end if;
  execute replace(def, old_txt, '"chat_greeting":160,"eyebrow_en":60,"title1_en":60,"title2_en":60,"subtitle_en":200,'
    || '"notice_en":160,"footer_note_en":200,"seo_title_en":70,"seo_desc_en":160}');
end $$;
