// 外部職缺搜尋的共用部分：匯入頁（/api/import/search）與每週週報都用這裡。

import { DISTRICTS, districtOf, isCounty, zipsOf, type CountyId } from "../../../src/shared/districts.js";
import { filterJobs } from "../../../src/shared/matcher.js";
import type { Job, RegionId } from "../../../src/shared/types.js";
import { ADAPTERS } from "../../../src/server/sources/index.js";

export const IMPORT_SOURCES = ["taiwanjobs", "yourator"] as const;
export type ImportSource = (typeof IMPORT_SOURCES)[number];
export const SOURCE_NAMES: Readonly<Record<ImportSource, string>> = { taiwanjobs: "台灣就業通", yourator: "Yourator" };

/** 搜尋範圍：整個縣市（含遠端工作），或某縣市裡的部分鄉鎮市區；兩者皆空代表全台 */
export interface Area {
  readonly regions: readonly RegionId[];
  readonly districts: readonly { readonly region: CountyId; readonly name: string }[];
}

/** 搜尋單一來源。連不上時丟出帶來源名稱的錯誤，呼叫端決定要回 502 還是記在週報裡 */
export async function searchSource(source: ImportSource, keyword: string, area: Area = { regions: [], districts: [] }): Promise<Job[]> {
  const adapter = ADAPTERS.get(source);
  if (!adapter) throw new Error(`不支援的來源：${source}`);
  // 只勾部分區的縣市 → 該縣市勾了哪些區
  const partial = new Map<RegionId, Set<string>>();
  for (const d of area.districts) partial.set(d.region, (partial.get(d.region) ?? new Set()).add(d.name));
  const zips = new Set([
    ...area.regions.filter(isCounty).flatMap(zipsOf),
    ...area.districts.flatMap((d) => DISTRICTS[d.region].filter((x) => x.name === d.name).map((x) => x.zip)),
  ]);
  const query = {
    categoryId: null,
    subIds: new Set<string>(),
    regions: new Set<RegionId>([...area.regions, ...partial.keys()]),
    ...(partial.size > 0 ? { zips } : {}),
    keyword,
  };
  let found: Job[];
  try {
    found = await adapter.search(query);
  } catch (err) {
    throw new Error(`${SOURCE_NAMES[source]}暫時無法連線：${err instanceof Error ? err.message : "未知錯誤"}`);
  }
  // 來源本身不支援關鍵字時（台灣就業通），在這裡用標題、技能、內文過濾；地區兩邊都再過濾一次
  return filterJobs(found, adapter.handlesKeyword ? { ...query, keyword: "" } : query)
    .filter((j) => inDistricts(j, partial));
}

/** 只勾部分區的縣市，職缺地址要落在勾選的區裡；地址沒寫到區（例如只寫「台北市」）就留著，寧可多給也不要漏 */
function inDistricts(job: Job, partial: ReadonlyMap<RegionId, ReadonlySet<string>>): boolean {
  if (job.region === null || !isCounty(job.region)) return true;
  const names = partial.get(job.region);
  if (!names) return true;
  const d = districtOf(job.region, job.address);
  return d === null || names.has(d);
}

/** 爬蟲的 Job 轉成 POST /api/jobs 接受的欄位 */
export function toJobInput(j: Job) {
  return {
    source: j.source,
    externalId: j.id,
    sourceUrl: j.sourceUrl,
    title: j.title.slice(0, 200),
    company: (j.company.trim() || "未提供").slice(0, 200),
    region: j.region,
    address: j.address.slice(0, 300),
    nature: j.nature,
    salaryKind: j.salary.kind,
    salaryMin: j.salary.min,
    // 少數來源的上限比下限小（多半是解析錯誤），只保留下限，避免匯入時被驗證擋下
    salaryMax: j.salary.max !== null && j.salary.min !== null && j.salary.max < j.salary.min ? null : j.salary.max,
    salaryNote: j.salary.note.slice(0, 300),
    skills: [...j.requirements.skills].slice(0, 50),
    tags: j.tags.filter((t) => t.trim() !== "").map((t) => t.slice(0, 50)).slice(0, 50),
    description: [...j.duties, ...j.requirements.others].join("\n").slice(0, 20000),
    postedAt: /^\d{4}-\d{2}-\d{2}$/.test(j.postedAt) ? j.postedAt : null,
  };
}
