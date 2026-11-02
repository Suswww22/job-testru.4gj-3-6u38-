// 搜尋過濾、文字辨識（技能／分類／地區／學歷）、履歷解析與匹配評分。
// 全部是純函式，不碰 DOM 也不碰網路，前端與伺服器共用。

import { CATEGORIES, REGIONS, SKILL_ALIASES, type SkillName } from "./data.js";
import type {
  Education, Job, MatchResult, RegionId, ResumeProfile, SearchQuery, SortKey,
} from "./types.js";

// ---------- 搜尋 ----------

export function filterJobs(jobs: readonly Job[], q: SearchQuery): Job[] {
  const words = q.keyword.trim().toLowerCase().split(/\s+/).filter((w) => w !== "");
  return jobs.filter((job) => {
    if (q.categoryId !== null && job.categoryId !== q.categoryId) return false;
    if (q.subIds.size > 0 && (job.subId === null || !q.subIds.has(job.subId))) return false;
    if (q.regions.size > 0 && (job.region === null || !q.regions.has(job.region))) return false;
    if (words.length === 0) return true;
    const haystack = [
      job.title, job.company, ...job.tags, ...job.duties,
      ...job.requirements.skills, ...job.requirements.others,
    ].join(" ").toLowerCase();
    // 多個關鍵字以空白分隔，全部命中才算
    return words.every((word) => haystack.includes(word));
  });
}

// ---------- 薪資與評價的數值化 ----------

/** 統一換算成「月薪下限」以便排序；無數字者排最後 */
export function monthlyMin(job: Job): number {
  const { kind, min } = job.salary;
  if (min === null) return 0;
  switch (kind) {
    case "月薪": return min;
    case "年薪": return Math.round(min / 12);
    case "時薪": return min * 176;
    case "日薪": return min * 22;
    case "面議": return min;
  }
}

export function averageRating(job: Job): number | null {
  if (job.reviews.length === 0) return null;
  const sum = job.reviews.reduce((acc, r) => acc + r.rating, 0);
  return Math.round((sum / job.reviews.length) * 10) / 10;
}

export function formatSalary(job: Job): string {
  const { kind, min, max, note } = job.salary;
  if (kind === "面議" || min === null) return note !== "" ? note : "薪資面議";
  const fmt = (n: number): string =>
    kind === "年薪" ? `${(n / 10000).toLocaleString("zh-TW")} 萬` : n.toLocaleString("zh-TW");
  const unit = kind === "年薪" ? "" : " 元";
  const range = max === null || max === min ? `${fmt(min)}${unit}${max === null ? "以上" : ""}` : `${fmt(min)}–${fmt(max)}${unit}`;
  return `${kind} ${range}`;
}

// ---------- 文字辨識 ----------

const EDU_RANK: Readonly<Record<Education, number>> = {
  "不拘": 0, "高中職": 1, "專科": 2, "大學": 3, "碩士": 4,
};

const EDU_PATTERNS: ReadonlyArray<readonly [Education, RegExp]> = [
  ["碩士", /碩士|研究所|博士|master|m\.s\./i],
  ["大學", /大學|學士|bachelor|b\.s\./i],
  ["專科", /專科|二專|五專|二技|四技/],
  ["高中職", /高中|高職/],
];

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** 英數詞需要前後不是英數字才算命中（避免 "ts" 命中 "assets"）；中文詞直接比對子字串 */
export function containsTerm(text: string, term: string): boolean {
  if (/^[\x00-\x7f]+$/.test(term)) {
    return new RegExp(`(?<![a-z0-9])${escapeRegExp(term)}(?![a-z0-9])`, "i").test(text);
  }
  return text.includes(term);
}

export function extractSkills(raw: string): SkillName[] {
  const text = raw.toLowerCase();
  return (Object.keys(SKILL_ALIASES) as SkillName[])
    .filter((name) => SKILL_ALIASES[name].some((a: string) => containsTerm(text, a)));
}

/** 回傳文字中出現的最高學歷；用於履歷 */
export function highestEducation(raw: string): Education | null {
  for (const [edu, re] of EDU_PATTERNS) {
    if (re.test(raw)) return edu; // 依高到低排列，第一個命中即最高
  }
  return null;
}

/** 回傳文字中出現的最低學歷；用於職缺的「最低學歷要求」，如「大學、碩士」取大學 */
export function lowestEducation(raw: string): Education {
  if (raw.trim() === "" || /不拘/.test(raw)) return "不拘";
  let found: Education = "不拘";
  for (const [edu, re] of EDU_PATTERNS) {
    if (re.test(raw)) found = edu;
  }
  return found;
}

export function detectRegions(raw: string): RegionId[] {
  const text = raw.toLowerCase();
  return REGIONS
    .filter((r) => r.aliases.some((a) => containsTerm(text, a.toLowerCase())))
    .map((r) => r.id);
}

/** 依職稱與描述猜最接近的本站分類；職稱命中的權重高於描述 */
export function classify(title: string, extra: string): { categoryId: string; subId: string } | null {
  const t = title.toLowerCase();
  const e = extra.toLowerCase();
  let best: { categoryId: string; subId: string; score: number } | null = null;
  for (const cat of CATEGORIES) {
    for (const sub of cat.subs) {
      const terms = [sub.name.toLowerCase(), ...sub.keywords];
      const score = terms.reduce((acc, term) =>
        acc + (containsTerm(t, term) ? 3 : 0) + (containsTerm(e, term) ? 1 : 0), 0);
      if (score > 0 && (best === null || score > best.score)) {
        best = { categoryId: cat.id, subId: sub.id, score };
      }
    }
  }
  return best && { categoryId: best.categoryId, subId: best.subId };
}

export function parseYears(raw: string): number | null {
  const patterns: readonly RegExp[] = [
    // 「4 年前端開發經驗」「3 年 React、Node.js 開發經驗」：年與經驗之間可以夾技能清單（到句號或換行為止）。
    // (?<!\d) 避免「2024年…經驗」被讀成 24 年；「年前」後面不是「端」時是「3 年前離職」這類時間，不是年資
    /(?<!\d)(\d{1,2})\s*(?:\+|多)?\s*年(?:以上)?(?!前(?!端))[^\d\n。;；]{0,30}?經[驗歷]/g,
    /經[驗歷]\s*[:：]?\s*(\d{1,2})\s*年/g,
    /(?<!\d)(\d{1,2})\+?\s*years?/gi,
  ];
  let best: number | null = null;
  for (const re of patterns) {
    for (const m of raw.matchAll(re)) {
      const n = Number(m[1]);
      if (Number.isFinite(n) && n <= 45 && (best === null || n > best)) best = n;
    }
  }
  return best;
}

function sumWorkPeriods(raw: string): number | null {
  // 從「2019 – 2024」或「2021.03 – 至今」之類的期間加總
  const thisYear = new Date().getFullYear();
  let total = 0;
  const rangeRe = /(20\d{2}|19\d{2})(?:[./年]\s*\d{1,2}月?)?\s*[-–~～至]\s*(20\d{2}|19\d{2}|至今|現在|present)/gi;
  for (const m of raw.matchAll(rangeRe)) {
    const start = Number(m[1]);
    const endRaw = m[2] ?? "";
    const end = /^\d+$/.test(endRaw) ? Number(endRaw) : thisYear;
    if (end >= start) total += end - start;
  }
  return total > 0 ? Math.min(total, 45) : null;
}

// ---------- 履歷解析 ----------

export function parseResume(raw: string): ResumeProfile {
  const text = raw.toLowerCase();
  const subIds = CATEGORIES
    .flatMap((c) => c.subs)
    .filter((s) => containsTerm(text, s.name.toLowerCase()) || s.keywords.some((k) => containsTerm(text, k)))
    .map((s) => s.id);

  return {
    skills: extractSkills(raw),
    years: parseYears(raw) ?? sumWorkPeriods(raw),
    education: highestEducation(raw),
    regions: detectRegions(raw),
    subIds,
  };
}

// ---------- 匹配評分 ----------

// 分數 = 適配度（0–100）× 資格係數（0.5–1）
// 適配度看「會不會做這份工作」：技能 65 分 + 職務領域 35 分。
// 資格係數看「符不符合門檻」：年資、學歷、地區不符時打折，符合時不加分——
// 這三項幾乎每份工作都符合，若當成加分項，會讓毫不相關的職缺也拿到高分。
const FIT = { skills: 65, role: 35 } as const;
/** 「你的專長被用到多少」以前幾項技能為準，避免技能列很長的履歷被稀釋 */
const CORE_SKILLS = 4;
/** 通用技能幾乎任何職缺都可能要求，權重打折，避免「會英文」就與所有職缺高度匹配 */
const GENERIC_SKILLS: ReadonlySet<SkillName> = new Set<SkillName>(["英文", "日文", "Office", "Excel", "客戶服務", "急救"]);
const GENERIC_WEIGHT = 0.3;

const skillWeight = (s: SkillName): number => (GENERIC_SKILLS.has(s) ? GENERIC_WEIGHT : 1);
const sumWeights = (skills: readonly SkillName[]): number => skills.reduce((acc, s) => acc + skillWeight(s), 0);

export function matchJob(job: Job, p: ResumeProfile): MatchResult {
  const req = job.requirements;
  const owned = new Set(p.skills);
  const matchedSkills = req.skills.filter((s) => owned.has(s));
  const missingSkills = req.skills.filter((s) => !owned.has(s));
  const reasons: string[] = [];

  // coverage：職缺要求的技能你會幾成；relevance：你的專長在這份工作用得上幾成。
  // 職缺沒列出可辨識的技能時兩者各給一半，避免資訊少的職缺被過度高估或低估。
  const matchedW = sumWeights(matchedSkills);
  const coverage = req.skills.length === 0 ? 0.5 : matchedW / sumWeights(req.skills);
  const relevance = req.skills.length === 0 || p.skills.length === 0
    ? 0.5
    : Math.min(1, matchedW / Math.min(p.skills.length, CORE_SKILLS));
  let fit = FIT.skills * (0.4 * coverage + 0.6 * relevance);
  if (matchedSkills.length > 0) reasons.push(`具備 ${matchedSkills.length}/${req.skills.length} 項指定技能`);

  const resumeCats = new Set(
    CATEGORIES.filter((c) => c.subs.some((s) => p.subIds.includes(s.id))).map((c) => c.id),
  );
  if (p.subIds.length === 0) {
    fit += FIT.role * 0.5;
  } else if (job.subId !== null && p.subIds.includes(job.subId)) {
    fit += FIT.role;
    reasons.push("與過往職務相同");
  } else if (job.categoryId !== null && resumeCats.has(job.categoryId)) {
    fit += FIT.role * 0.6;
    reasons.push("與過往職務同領域");
  }

  let factor = 1;
  if (p.years !== null && p.years < req.minYears) {
    factor *= 0.7 + 0.3 * (p.years / req.minYears);
    reasons.push(`年資差 ${req.minYears - p.years} 年`);
  } else if (p.years !== null && req.minYears > 0) {
    reasons.push(`年資 ${p.years} 年，符合 ${req.minYears} 年以上要求`);
  }
  if (p.education !== null && EDU_RANK[p.education] < EDU_RANK[req.education]) {
    factor *= 0.8;
    reasons.push(`學歷要求${req.education}以上`);
  }
  if (p.regions.length > 0) {
    if (job.region !== null && (p.regions.includes(job.region) || job.region === "remote")) {
      reasons.push("地點符合偏好");
    } else {
      factor *= 0.8;
      reasons.push("地點不在偏好地區");
    }
  }

  return { job, score: Math.round(fit * factor), matchedSkills, missingSkills, reasons };
}
// ---------- 排序 ----------

export function sortResults(
  jobs: readonly Job[],
  key: SortKey,
  matches: ReadonlyMap<string, MatchResult>,
): Job[] {
  const copy = [...jobs];
  const by = (f: (j: Job) => number) => (a: Job, b: Job): number => f(b) - f(a);
  switch (key) {
    case "match": return copy.sort(by((j) => matches.get(j.id)?.score ?? -1));
    case "latest": return copy.sort(by((j) => Date.parse(j.postedAt) || 0));
    case "salary": return copy.sort(by(monthlyMin));
    case "rating": return copy.sort(by((j) => averageRating(j) ?? 0));
  }
}
