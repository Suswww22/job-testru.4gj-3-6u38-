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
  keelung: ["200", "201", "202", "203", "204", "205", "206"],
  taoyuan: ["320", "324", "325", "326", "327", "328", "330", "333", "334", "335", "336", "337", "338"],
  hsinchu: ["300"],
  hsinchucounty: ["302", "303", "304", "305", "306", "307", "308", "310", "311", "312", "313", "314", "315"],
  miaoli: ["350", "351", "352", "353", "354", "356", "357", "358", "360", "361", "362", "363", "364", "365",
    "366", "367", "368", "369"],
  changhua: ["500", "502", "503", "504", "505", "506", "507", "508", "509", "510", "511", "512", "513", "514",
    "515", "516", "520", "521", "522", "523", "524", "525", "526", "527", "528", "530"],
  nantou: ["540", "541", "542", "544", "545", "546", "551", "552", "553", "555", "556", "557", "558"],
  yunlin: ["630", "631", "632", "633", "634", "635", "636", "637", "638", "640", "643", "646", "647", "648",
    "649", "651", "652", "653", "654", "655"],
  chiayi: ["600"],
  chiayicounty: ["602", "603", "604", "605", "606", "607", "608", "611", "612", "613", "614", "615", "616",
    "621", "622", "623", "624", "625"],
  pingtung: ["900", "901", "902", "903", "904", "905", "906", "907", "908", "909", "911", "912", "913", "920",
    "921", "922", "923", "924", "925", "926", "927", "928", "929", "931", "932", "940", "941", "942", "943",
    "944", "945", "946", "947"],
  yilan: ["260", "261", "262", "263", "264", "265", "266", "267", "268", "269", "270", "272"],
  hualien: ["970", "971", "972", "973", "974", "975", "976", "977", "978", "979", "981", "982", "983"],
  taitung: ["950", "951", "952", "953", "954", "955", "956", "957", "958", "959", "961", "962", "963", "964",
    "965", "966"],
  penghu: ["880", "881", "882", "883", "884", "885"],
  kinmen: ["890", "891", "892", "893", "894", "896"],
  lienchiang: ["209", "210", "211", "212"],
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
