// 所有資料結構集中定義；前端與伺服器共用，雙方對資料格式的認知由編譯器保證一致。

import type { SkillName } from "./data.js";

export type RegionId =
  | "taipei" | "newtaipei" | "taoyuan" | "hsinchu"
  | "taichung" | "tainan" | "kaohsiung" | "remote";

export interface Region {
  readonly id: RegionId;
  readonly name: string;
  /** 文字中出現這些字時，視為此地區 */
  readonly aliases: readonly string[];
}

export interface SubCategory {
  readonly id: string;
  readonly name: string;
  /** 文字中出現這些字時，視為此職務 */
  readonly keywords: readonly string[];
}

export interface Category {
  readonly id: string;
  readonly name: string;
  readonly subs: readonly SubCategory[];
}

export type SourceId = "taiwanjobs" | "yourator" | "demo";

export interface SourceInfo {
  readonly id: SourceId;
  readonly name: string;
  readonly homepage: string;
}

export type JobNature = "全職" | "兼職" | "約聘" | "實習" | "其他";
export type Shift = "日班" | "晚班" | "輪班" | "彈性工時" | "未提供";
export type ReviewerType = "新進" | "離職" | "資深";
export type Education = "不拘" | "高中職" | "專科" | "大學" | "碩士";

export interface Salary {
  readonly kind: "月薪" | "年薪" | "時薪" | "日薪" | "面議";
  /** null 代表來源未提供數字 */
  readonly min: number | null;
  /** null 代表「以上」或未提供 */
  readonly max: number | null;
  /** 來源的原始薪資描述 */
  readonly note: string;
  /** 薪資相關福利，如年終、績效獎金 */
  readonly perks: readonly string[];
}

export interface Requirements {
  readonly minYears: number;
  readonly education: Education;
  readonly skills: readonly SkillName[];
  readonly others: readonly string[];
}

export interface Review {
  readonly type: ReviewerType;
  readonly tenure: string;
  /** 1–5 */
  readonly rating: 1 | 2 | 3 | 4 | 5;
  readonly date: string;
  readonly pros: string;
  readonly cons: string;
}

export interface Job {
  /** 全域唯一：`${source}:${來源內編號}` */
  readonly id: string;
  readonly source: SourceId;
  /** 原始職缺頁面 */
  readonly sourceUrl: string | null;
  /** false 代表目前只有列表摘要，需再向伺服器取詳情 */
  readonly detailLoaded: boolean;
  readonly title: string;
  readonly company: string;
  readonly companyIntro: string;
  /** null 代表無法對應到本站分類 */
  readonly categoryId: string | null;
  readonly subId: string | null;
  readonly region: RegionId | null;
  readonly address: string;
  readonly nature: JobNature;
  readonly shift: Shift;
  readonly hours: string;
  /** null 代表來源未提供 */
  readonly leave: string | null;
  readonly salary: Salary;
  readonly duties: readonly string[];
  readonly requirements: Requirements;
  readonly tags: readonly string[];
  readonly otherBenefits: readonly string[];
  readonly reviews: readonly Review[];
  /** YYYY-MM-DD；來源未提供時為空字串 */
  readonly postedAt: string;
}

export interface SearchQuery {
  readonly categoryId: string | null;
  readonly subIds: ReadonlySet<string>;
  readonly regions: ReadonlySet<RegionId>;
  readonly keyword: string;
}

export interface SearchResponse {
  readonly jobs: readonly Job[];
  readonly errors: readonly { readonly source: SourceId; readonly message: string }[];
}

export interface ResumeProfile {
  readonly skills: readonly string[];
  readonly years: number | null;
  readonly education: Education | null;
  readonly regions: readonly RegionId[];
  readonly subIds: readonly string[];
}

export interface MatchResult {
  readonly job: Job;
  /** 0–100 */
  readonly score: number;
  readonly matchedSkills: readonly string[];
  readonly missingSkills: readonly string[];
  readonly reasons: readonly string[];
}

export type SortKey = "match" | "latest" | "salary" | "rating";
