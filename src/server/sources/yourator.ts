// Yourator：列表用網站前端使用的公開 JSON，詳情用職缺頁內嵌的 JobPosting 結構化資料。
// robots.txt 只禁止 /r/*，列表與職缺頁皆允許抓取。

import type { Job, SearchQuery } from "../../shared/types.js";
import { classify, detectRegions, extractSkills } from "../../shared/matcher.js";
import { MINUTE, fetchText } from "../http.js";
import { findJobPosting, jobFromPosting } from "../jsonld.js";
import { parseSalaryText } from "../text.js";
import type { JobSourceAdapter } from "./source.js";

const ORIGIN = "https://www.yourator.co";
const MAX_PAGES = 3;
const URL_RE = /^https:\/\/www\.yourator\.co\/companies\/[\w-]+\/jobs\/(\d+)$/;

interface ListJob {
  readonly id: number;
  readonly name: string;
  readonly path: string;
  readonly salary: string;
  readonly location: string;
  readonly tags: readonly string[];
  readonly company: { readonly brand: string };
}

interface ListResponse {
  readonly payload: { readonly hasMore: boolean; readonly jobs: readonly ListJob[] };
}

/** 只信任需要的欄位，其餘丟棄；格式不符就當成沒有資料 */
function isListResponse(v: unknown): v is ListResponse {
  if (typeof v !== "object" || v === null) return false;
  const payload = (v as { payload?: unknown }).payload;
  return typeof payload === "object" && payload !== null && Array.isArray((payload as { jobs?: unknown }).jobs);
}

function isListJob(v: unknown): v is ListJob {
  if (typeof v !== "object" || v === null) return false;
  const j = v as Record<string, unknown>;
  return typeof j["id"] === "number" && typeof j["name"] === "string" && typeof j["path"] === "string"
    && typeof j["location"] === "string" && Array.isArray(j["tags"]);
}

function toSummary(j: ListJob): Job {
  const tags = j.tags.filter((t): t is string => typeof t === "string");
  const cls = classify(j.name, tags.join(" "));
  return {
    id: `yourator:${j.id}`,
    source: "yourator",
    sourceUrl: `${ORIGIN}${j.path}`,
    detailLoaded: false,
    title: j.name,
    company: typeof j.company?.brand === "string" ? j.company.brand : "",
    companyIntro: "",
    categoryId: cls?.categoryId ?? null,
    subId: cls?.subId ?? null,
    region: detectRegions(j.location)[0] ?? null,
    address: j.location,
    nature: "其他",
    shift: "未提供",
    hours: "",
    leave: null,
    salary: parseSalaryText(typeof j.salary === "string" ? j.salary : ""),
    duties: [],
    requirements: { minYears: 0, education: "不拘", skills: extractSkills(`${j.name} ${tags.join(" ")}`), others: [] },
    tags,
    otherBenefits: [],
    reviews: [],
    postedAt: "",
  };
}

export const yourator: JobSourceAdapter = {
  id: "yourator",
  handlesKeyword: true,

  async search(query: SearchQuery): Promise<Job[]> {
    const jobs: Job[] = [];
    for (let page = 1; page <= MAX_PAGES; page++) {
      const params = new URLSearchParams({ page: String(page) });
      for (const word of query.keyword.trim().split(/\s+/).filter((w) => w !== "")) {
        params.append("term[]", word);
      }
      const raw: unknown = JSON.parse(await fetchText(`${ORIGIN}/api/v4/jobs?${params}`, 10 * MINUTE));
      if (!isListResponse(raw)) throw new Error("Yourator 回傳格式改變");
      jobs.push(...raw.payload.jobs.filter(isListJob).map(toSummary));
      if (!raw.payload.hasMore) break;
    }
    return jobs;
  },

  acceptsUrl: (url: string): boolean => URL_RE.test(url),

  async detail(url: string): Promise<Job> {
    const id = URL_RE.exec(url)?.[1];
    if (!id) throw new Error("不是 Yourator 職缺網址");
    const posting = findJobPosting(await fetchText(url, 30 * MINUTE));
    if (!posting) throw new Error("職缺頁沒有結構化資料，可能已下架");
    return jobFromPosting(posting, { source: "yourator", sourceId: id, url });
  },
};
