import { useEffect, useState } from "react";
import { supabase } from "./supabase";

/** Danh bạ nội bộ (migration 072): phòng ban, bộ phận, vị trí của từng tài khoản */
export type DirEntry = { profile_id: string; department: string | null; team: string | null; job_title: string; dept_sort: number };
let cache: Map<string, DirEntry> | null = null;
let pending: Promise<Map<string, DirEntry>> | null = null;

function fetchDir() {
  pending ??= Promise.resolve(supabase.rpc("staff_directory")).then(({ data }) => {
    cache = new Map(((data ?? []) as DirEntry[]).map((d) => [d.profile_id, d]));
    return cache;
  }).finally(() => { pending = null; });
  return pending;
}

export function useDirectory() {
  const [dir, setDir] = useState<Map<string, DirEntry>>(() => cache ?? new Map());
  useEffect(() => { fetchDir().then(setDir); }, []);
  return dir;
}

/** "Phòng Kinh doanh · KD toà nhà · Nhân viên kinh doanh" */
export function dirLine(d: DirEntry | undefined) {
  if (!d) return "";
  return [d.department, d.team, d.job_title].filter(Boolean).join(" · ");
}
