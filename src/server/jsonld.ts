// 通用的 schema.org JobPosting 解析器。
// 多數求職網站會在職缺頁內嵌這份結構化資料給搜尋引擎，所以新增來源時多半能直接沿用。

import type { Job, Salary, SourceId } from "../shared/types.js";
import { classify, detectRegions, extractSkills, lowestEducation } from "../shared/matcher.js";
import {
  findBenefits, findHours, findLeave, findPerks, htmlToLines, mapNature, mapShift, normalizeDate,
  parseMinYears, parseSalaryText,
} from "./text.js";

type Json = string | number | boolean | null | Json[] | { [k: string]: Json };
type JsonObject = { [k: string]: Json };

function isObject(v: Json | undefined): v is JsonObject {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

function str(v: Json | undefined): string {
  if (typeof v === "string") return v;
  if (typeof v === "number") return String(v);
  return "";
}

function num(v: Json | undefined): number | null {
  return typeof v === "number" && Number.isFinite(v) && v > 0 ? v : null;
}

/** 從 HTML 中找出 @type 為 JobPosting 的 JSON-LD 物件 */
export function findJobPosting(html: string): JsonObject | null {
  for (const m of html.matchAll(/<script[^>]*application\/ld\+json[^>]*>([\s\S]*?)<\/script>/gi)) {
    let parsed: Json;
    try {
      parsed = JSON.parse(m[1] ?? "") as Json;
    } catch {
      continue;
    }
    const candidates: Json[] = Array.isArray(parsed)
      ? parsed
      : isObject(parsed) && Array.isArray(parsed["@graph"]) ? parsed["@graph"] : [parsed];
    const found = candidates.find((c) => isObject(c) && c["@type"] === "JobPosting");
    if (isObject(found)) return found;
  }
  return null;
}

const UNIT_TO_KIND: Readonly<Record<string, Salary["kind"]>> = {
  HOUR: "時薪", DAY: "日薪", MONTH: "月薪", YEAR: "年薪",
};

function parseBaseSalary(v: Json | undefined, fallbackText: string): Salary {
  const value = isObject(v) ? v["value"] : undefined;
  if (isObject(value)) {
    const kind = UNIT_TO_KIND[str(value["unitText"]).toUpperCase()];
    const min = num(value["minValue"]) ?? num(value["value"]);
    if (kind && min !== null) {
      return { kind, min, max: num(value["maxValue"]), note: "", perks: [] };
    }
  }
  return parseSalaryText(fallbackText);
}

function parseAddress(v: Json | undefined): string {
  const place = Array.isArray(v) ? v[0] : v;
  const addr = isObject(place) ? place["address"] : undefined;
  if (!isObject(addr)) return "";
  const street = str(addr["streetAddress"]);
  const locality = str(addr["addressLocality"]);
  return street.startsWith(locality) ? street : `${locality}${street}`;
}

function parseExperience(v: Json | undefined): number {
  if (isObject(v)) {
    const months = num(v["monthsOfExperience"]);
    if (months !== null) return Math.floor(months / 12);
  }
  return parseMinYears(str(v));
}

/**
 * 把 JobPosting 轉成本站 Job。
 * salaryText：當結構化資料沒有薪資數字時，用頁面上的薪資文字補。
 */
export function jobFromPosting(
  posting: JsonObject,
  meta: { readonly source: SourceId; readonly sourceId: string; readonly url: string; readonly salaryText?: string },
): Job {
  const title = decode(str(posting["title"]));
  const org = posting["hiringOrganization"];
  const company = isObject(org) ? decode(str(org["name"])) : "";
  const companyIntro = isObject(org) ? decode(str(org["description"])) : "";
  const lines = htmlToLines(str(posting["description"]));
  const text = lines.join("\n");
  const address = parseAddress(posting["jobLocation"]);
  const remote = str(posting["jobLocationType"]) === "TELECOMMUTE";
  const cls = classify(title, text);
  const salary = parseBaseSalary(posting["baseSalary"], meta.salaryText ?? "");
  const employment = Array.isArray(posting["employmentType"])
    ? posting["employmentType"].map(str).join(" ")
    : str(posting["employmentType"]);

  return {
    id: `${meta.source}:${meta.sourceId}`,
    source: meta.source,
    sourceUrl: meta.url,
    detailLoaded: true,
    title,
    company,
    companyIntro,
    categoryId: cls?.categoryId ?? null,
    subId: cls?.subId ?? null,
    region: remote ? "remote" : detectRegions(`${address} ${text.slice(0, 300)}`)[0] ?? null,
    address: remote ? "遠端工作" : address,
    nature: mapNature(employment.replace("FULL_TIME", "全職").replace("PART_TIME", "兼職")
      .replace("CONTRACTOR", "約聘").replace("TEMPORARY", "約聘").replace("INTERN", "實習")),
    shift: mapShift(text),
    hours: findHours(lines),
    leave: findLeave(lines),
    salary: { ...salary, perks: findPerks(lines) },
    duties: lines.slice(0, 60),
    requirements: {
      minYears: parseExperience(posting["experienceRequirements"]),
      education: lowestEducation(str(posting["educationRequirements"]) ||
        (isObject(posting["educationRequirements"]) ? str(posting["educationRequirements"]["credentialCategory"]) : "")),
      skills: extractSkills(`${title}\n${text}`),
      others: [],
    },
    tags: [],
    otherBenefits: findBenefits(lines),
    reviews: [],
    postedAt: normalizeDate(str(posting["datePosted"])),
  };
}

function decode(s: string): string {
  return htmlToLines(s).join(" ");
}
