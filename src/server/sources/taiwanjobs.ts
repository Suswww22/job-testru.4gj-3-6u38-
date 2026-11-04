// 台灣就業通（勞動部勞動力發展署）開放資料。
// 資料集：https://data.gov.tw/dataset/44062，授權：政府資料開放授權條款第 1 版。
// API 每次最多 1000 筆，僅支援郵遞區號（zipno）與職業代碼（jobno）篩選，關鍵字需自行過濾。

import { isCounty, zipsOf } from "../../shared/districts.js";
import type { Job, SearchQuery } from "../../shared/types.js";
import { classify, detectRegions, extractSkills, lowestEducation } from "../../shared/matcher.js";
import { MINUTE, fetchText, mapLimit } from "../http.js";
import {
  findBenefits, findHours, findLeave, findPerks, mapNature, mapShift, normalizeDate,
  parseMinYears, parseSalaryText, toLines,
} from "../text.js";
import type { JobSourceAdapter } from "./source.js";

const ENDPOINT = "https://free.taiwanjobs.gov.tw/webservice_taipei/Webservice.ashx";
const CACHE_TTL = 30 * MINUTE;
const PER_ZIP = 60;
const CONCURRENCY = 4;


type RawRow = Readonly<Partial<Record<string, string>>>;

/** 欄位標籤長得像 <OCCU_DESC（職務名稱）><![CDATA[...]]></OCCU_DESC（職務名稱）> */
function parseXml(xml: string): RawRow[] {
  const records: RawRow[] = [];
  for (const block of xml.matchAll(/<Data>([\s\S]*?)<\/Data>/g)) {
    const rec: Record<string, string> = {};
    const body = block[1] ?? "";
    for (const f of body.matchAll(/<([A-Z0-9_]+)（[^>]*>(?:<!\[CDATA\[([\s\S]*?)\]\]>)?<\/\1（[^>]*>/g)) {
      const key = f[1];
      if (key !== undefined) rec[key] = (f[2] ?? "").trim();
    }
    records.push(rec);
  }
  return records;
}

function toJob(r: RawRow): Job | null {
  const url = r.URL_QUERY ?? "";
  const hireId = /HIRE_ID=(\d+)/.exec(url)?.[1];
  const title = r.OCCU_DESC ?? "";
  if (!hireId || title === "") return null;

  const detail = toLines(r.JOB_DETAIL ?? "");
  const cat1 = r.CJOB_NAME1 ?? "";
  const cat2 = r.CJOB_NAME2 ?? "";
  const cls = classify(title, `${cat2} ${cat1} ${detail.join(" ")}`);
  const salaryCd = r.SALARYCD ?? "";
  const lo = r.NT_L ?? "-";
  const hi = r.NT_U ?? "-";
  const salary = /^\d+$/.test(lo)
    ? parseSalaryText(`${salaryCd} ${lo}${/^\d+$/.test(hi) ? ` - ${hi}` : ""}`)
    : parseSalaryText(salaryCd);
  const wktime = r.WKTIME ?? "";
  const stop = normalizeDate(r.STOP_DATE ?? "");

  return {
    id: `taiwanjobs:${hireId}`,
    source: "taiwanjobs",
    sourceUrl: url,
    detailLoaded: true,
    title,
    company: r.COMPNAME ?? "",
    companyIntro: "",
    categoryId: cls?.categoryId ?? null,
    subId: cls?.subId ?? null,
    region: detectRegions(r.CITYNAME ?? "")[0] ?? null,
    address: r.CITYNAME ?? "",
    nature: mapNature(r.WK_TYPE ?? ""),
    shift: mapShift(wktime),
    hours: findHours(detail) || wktime,
    leave: findLeave(detail),
    salary: { ...salary, perks: findPerks(detail) },
    duties: detail.slice(0, 60),
    requirements: {
      minYears: parseMinYears(r.EXPERIENCE ?? ""),
      education: lowestEducation(r.EDGRDESC ?? ""),
      skills: extractSkills(`${title}\n${detail.join("\n")}`),
      others: [
        r.EXPERIENCE ? `工作經驗：${r.EXPERIENCE}` : "",
        r.JOB_PERSON ? `需求人數：${r.JOB_PERSON} 人` : "",
        stop ? `應徵截止：${stop}` : "",
      ].filter((s) => s !== ""),
    },
    tags: [cat1, cat2].filter((s) => s !== ""),
    otherBenefits: findBenefits(detail),
    reviews: [],
    postedAt: normalizeDate(r.TRANDATE ?? ""),
  };
}

async function load(params: string): Promise<Job[]> {
  const xml = await fetchText(`${ENDPOINT}?${params}`, CACHE_TTL);
  return parseXml(xml).map(toJob).filter((j): j is Job => j !== null);
}

/**
 * 依郵遞區號逐區抓取；不同區號可能回傳同一筆職缺，會去除重複。
 * jobno：職務代碼前綴（例如 08 = 資訊軟體類）。不帶區號時 API 只回傳部分樣本，所以要搭配區號。
 */
export async function loadByZips(zips: readonly string[], perZip: number, jobno = ""): Promise<Job[]> {
  const extra = jobno ? `&jobno=${jobno}` : "";
  const settled = await mapLimit(zips, CONCURRENCY, (z) => load(`zipno=${z}&count=${perZip}${extra}`));
  const ok = settled.flatMap((s) => (s.status === "fulfilled" ? s.value : []));
  const failed = settled.find((s): s is PromiseRejectedResult => s.status === "rejected");
  if (ok.length === 0 && failed) {
    throw failed.reason instanceof Error ? failed.reason : new Error("暫時無法連線");
  }
  return [...new Map(ok.map((j) => [j.id, j])).values()];
}

export const TAOYUAN_ZIPS = zipsOf("taoyuan");

export const taiwanJobs: JobSourceAdapter = {
  id: "taiwanjobs",
  handlesKeyword: false,
  async search(query: SearchQuery): Promise<Job[]> {
    // 有指定區號（只勾了部分鄉鎮市區）就照區號查，否則查所選縣市的全部區號
    const zips = query.zips ? [...query.zips] : [...query.regions].filter(isCounty).flatMap(zipsOf);
    if (query.regions.size > 0 && zips.length === 0) return []; // 只選了遠端工作
    if (zips.length === 0) return load("count=1000");
    return loadByZips(zips, PER_ZIP);
  },
};
