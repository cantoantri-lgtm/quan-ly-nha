-- 075: cố định search_path cho ai_today (cảnh báo bảo mật của Supabase)
alter function public.ai_today() set search_path = public;
