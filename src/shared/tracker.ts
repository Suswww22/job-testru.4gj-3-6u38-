// AI 工程師職缺追蹤器的資料結構（伺服器與儀表板網頁共用）。快照會存成 JSON，下次執行時拿來比對。

import type { SourceId } from "./types.js";

export type LocationScope = "taoyuan" | "taiwan" | "remote" | "us" | "global";
export type Seniority = "any" | "junior" | "mid" | "senior" | "lead";
export type KeywordGroup = "ml" | "dl" | "llm" | "cv" | "data";

export interface TrackerInputs {
  readonly locations: readonly LocationScope[];
  readonly seniority: Seniority;
  readonly keywords: readonly KeywordGroup[];
  /** 指定求職網站；空陣列代表全部主流平台 */
  readonly sites: readonly string[];
  /** 月薪下限（年薪、時薪會先換算成月薪）；null 代表不限 */
  readonly minMonthlySalary: number | null;
  /** 公司名稱含有任一字串即排除 */
  readonly excludeCompanies: readonly string[];
  /** 無法結構化的其他要求，只列在報告上 */
  readonly notes: string;
}

/** taoyuan：確定在桃園市；remote：完全遠端；taiwan：桃園以外的台灣縣市；unconfirmed：無法判定縣市 */
export type LocationBucket = "taoyuan" | "remote" | "taiwan" | "unconfirmed";

export type JobStatus = "open" | "closed" | "unknown";

export interface TrackedJob {
  readonly key: string;
  readonly source: SourceId;
  readonly url: string;
  readonly company: string;
  readonly title: string;
  readonly location: string;
  readonly bucket: LocationBucket;
  readonly postedAt: string;
  /** 應徵截止日（來源有提供時） */
  readonly deadline: string;
  readonly salary: string;
  readonly summary: string;
  readonly skills: readonly string[];
  readonly seniority: Exclude<Seniority, "any"> | "unknown";
  readonly matchedKeywords: readonly string[];
  /** false 代表只有列表摘要（詳情抓取失敗），空白欄位不能當成「被刪除」 */
  readonly complete: boolean;
  readonly status: JobStatus;
  readonly statusEvidence: string;
  readonly firstSeen: string;
  readonly lastSeen: string;
}

export interface Snapshot {
  readonly runAt: string;
  readonly inputs: TrackerInputs;
  readonly jobs: readonly TrackedJob[];
  /** 本次比對所用的基準（前一天以前的快照）。同一天重跑時沿用它，而不是拿當天稍早的結果比對 */
  readonly baseline?: Snapshot | null;
}

/** 內容變更比對的欄位 */
export type DiffField = "title" | "salary" | "location" | "summary" | "skills" | "postedAt";

export interface FieldChange {
  readonly field: DiffField;
  readonly before: string;
  readonly after: string;
}

export interface Metrics {
  readonly total_openings: number;
  readonly new_openings: number;
  readonly closed_openings: number;
  readonly changed_postings: number;
  /** 程式無法取得評價，由排程中的 Claude 以網路搜尋後填入 */
  readonly new_reviews_count: number | null;
}

export interface MetricsRecord {
  readonly date: string;
  readonly metrics: Metrics;
}

export interface RunResult {
  readonly snapshot: Snapshot;
  readonly previousRunAt: string | null;
  readonly newKeys: readonly string[];
  readonly closedKeys: readonly string[];
  readonly changes: ReadonlyMap<string, readonly FieldChange[]>;
  readonly metrics: Metrics;
  /** 含本週，依日期由舊到新 */
  readonly history: readonly MetricsRecord[];
  readonly sourceNotes: readonly string[];
}

// ---------- 儀表板 API ----------

/** tracker-config.json 的格式（表單欄位）；與 TrackerInputs 的差別是地區欄位叫 location */
export interface TrackerConfig {
  readonly location: readonly LocationScope[];
  readonly seniority: Seniority;
  readonly keywords: readonly KeywordGroup[];
  readonly sites: readonly string[];
  readonly minMonthlySalary: number | null;
  readonly excludeCompanies: readonly string[];
  readonly notes: string;
}

/** 排程中的 Claude 寫入 reviews-seen.json 的評價 */
export interface SeenReview {
  readonly source: string;
  readonly company: string;
  readonly rating: number | null;
  readonly date: string;
  readonly title: string;
  readonly url: string;
}

/** 排程中的 Claude 寫入 leads.json 的主流網站線索（搜尋摘要，未確認） */
export interface Lead {
  readonly company: string;
  readonly title: string;
  readonly location: string;
  readonly source: string;
  readonly url: string;
  readonly snippetDate: string;
  readonly firstSeen: string;
  readonly lastSeen: string;
  readonly missedWeeks: number;
}

export type MetricKey = keyof Metrics;

/** 記憶欄位的彙總：total_openings 取平均，其餘取加總；count 為有資料的週數 */
export interface Aggregation {
  readonly avg?: number;
  readonly sum?: number;
  readonly count: number;
}

export interface TrackerDashboard {
  readonly config: TrackerConfig;
  readonly report: {
    readonly date: string;
    readonly previousRunAt: string | null;
    readonly jobs: readonly TrackedJob[];
    readonly newKeys: readonly string[];
    readonly closedKeys: readonly string[];
    readonly changes: Readonly<Record<string, readonly FieldChange[]>>;
    readonly sourceNotes: readonly string[];
  } | null;
  readonly history: readonly MetricsRecord[];
  readonly aggregations: Readonly<Record<MetricKey, Aggregation>>;
  readonly reviews: readonly SeenReview[];
  readonly reviewsLastRun: string | null;
  readonly leads: readonly Lead[];
}
