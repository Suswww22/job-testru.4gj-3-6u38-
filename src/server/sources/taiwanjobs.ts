// 台灣就業通（勞動部勞動力發展署）開放資料。
// 資料集：https://data.gov.tw/dataset/44062，授權：政府資料開放授權條款第 1 版。
// API 每次最多 1000 筆，僅支援郵遞區號（zipno）與職業代碼（jobno）篩選，關鍵字需自行過濾。

import type { Job, RegionId, SearchQuery } from "../../shared/types.js";
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

/** 各地區的三碼郵遞區號（遠端工作無對應） */
const ZIPS: Readonly<Record<Exclude<RegionId, "remote">, readonly string[]>> = {
  taipei: ["100", "103", "104", "105", "106", "108", "110", "111", "112", "114", "115", "116"],
  newtaipei: ["207", "208", "220", "221", "222", "223", "224", "226", "227", "228", "231", "232", "233",
    "234", "235", "236", "237", "238", "239", "241", "242", "243", "244", "247", "248", "249", "251", "252", "253"],
  taoyuan: ["320", "324", "325", "326", "327", "328", "330", "333", "334", "335", "336", "337", "338"],
  hsinchu: ["300", "302", "303", "304", "305", "306", "307", "308", "310", "311", "312", "313", "314", "315"],
  taichung: ["400", "401", "402", "403", "404", "406", "407", "408", "411", "412", "413", "414", "420", "421",
    "422", "423", "424", "426", "427", "428", "429", "432", "433", "434", "435", "436", "437", "438", "439"],
  tainan: ["700", "701", "702", "704", "708", "709", "710", "711", "712", "713", "714", "715", "716", "717",
    "718", "719", "720", "721", "722", "723", "724", "725", "726", "727", "730", "731", "732", "733", "734",
    "735", "736", "737", "741", "742", "743", "744", "745"],
  kaohsiung: ["800", "801", "802", "803", "804", "805", "806", "807", "811", "812", "813", "814", "815", "820",
    "821", "822", "823", "824", "825", "826", "827", "828", "829", "830", "831", "832", "833", "840", "842",
    "843", "844", "845", "846", "847", "848", "849", "851", "852"],
};

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

/** 依郵遞區號逐區抓取；不同區號可能回傳同一筆職缺，會去除重複 */
export async function loadByZips(zips: readonly string[], perZip: number): Promise<Job[]> {
  const settled = await mapLimit(zips, CONCURRENCY, (z) => load(`zipno=${z}&count=${perZip}`));
  const ok = settled.flatMap((s) => (s.status === "fulfilled" ? s.value : []));
  const failed = settled.find((s): s is PromiseRejectedResult => s.status === "rejected");
  if (ok.length === 0 && failed) {
    throw failed.reason instanceof Error ? failed.reason : new Error("暫時無法連線");
  }
  return [...new Map(ok.map((j) => [j.id, j])).values()];
}

export const TAOYUAN_ZIPS = ZIPS.taoyuan;

export const taiwanJobs: JobSourceAdapter = {
  id: "taiwanjobs",
  handlesKeyword: false,
  async search(query: SearchQuery): Promise<Job[]> {
    const zips = [...query.regions].flatMap((r) => (r === "remote" ? [] : ZIPS[r]));
    if (query.regions.size > 0 && zips.length === 0) return []; // 只選了遠端工作
    if (zips.length === 0) return load("count=1000");
    return loadByZips(zips, PER_ZIP);
  },
};
