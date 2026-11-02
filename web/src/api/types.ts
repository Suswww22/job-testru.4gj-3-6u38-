// API 回應的型別。列舉值沿用 src/shared，與後端驗證規則同一份來源。

import type { JobNature, RegionId, ResumeProfile, Salary } from "../../../src/shared/types";

export type ApplicationStatus = "SAVED" | "APPLIED" | "INTERVIEW" | "OFFER" | "REJECTED";

export const STATUSES: readonly { id: ApplicationStatus; label: string }[] = [
  { id: "SAVED", label: "收藏" },
  { id: "APPLIED", label: "已投" },
  { id: "INTERVIEW", label: "面試" },
  { id: "OFFER", label: "錄取" },
  { id: "REJECTED", label: "拒絕" },
];

export interface User {
  id: string;
  email: string;
  name: string | null;
  createdAt: string;
}

export interface Job {
  id: string;
  source: string;
  externalId: string | null;
  sourceUrl: string | null;
  title: string;
  company: string;
  region: RegionId | null;
  address: string;
  nature: JobNature;
  salaryKind: Salary["kind"];
  salaryMin: number | null;
  salaryMax: number | null;
  salaryNote: string;
  skills: string[];
  tags: string[];
  description: string;
  postedAt: string | null;
  createdAt: string;
  updatedAt: string;
  application: { id: string; status: ApplicationStatus } | null;
}

export type JobInput = Partial<Omit<Job, "id" | "createdAt" | "updatedAt" | "application">> & Pick<Job, "title" | "company">;

/** 外部網站搜尋結果：已轉成 POST /api/jobs 的欄位，saved 表示已在自己的清單裡 */
export type ImportItem = JobInput & { externalId: string; saved: boolean };
export type ImportSource = "taiwanjobs" | "yourator";

export interface Page<T> {
  items: T[];
  total: number;
  limit: number;
  offset: number;
}

export interface Application {
  id: string;
  jobId: string;
  status: ApplicationStatus;
  appliedAt: string | null;
  createdAt: string;
  updatedAt: string;
  job: Pick<Job, "id" | "title" | "company" | "region" | "sourceUrl">;
  _count?: { notes: number };
}

export interface Note {
  id: string;
  content: string;
  createdAt: string;
  updatedAt: string;
}

export interface ApplicationEvent {
  id: string;
  fromStatus: ApplicationStatus | null;
  toStatus: ApplicationStatus;
  createdAt: string;
}

export interface ApplicationDetail extends Omit<Application, "job" | "_count"> {
  job: Job;
  notes: Note[];
  events: ApplicationEvent[];
}

export interface Resume {
  content: string;
  updatedAt: string | null;
  profile: ResumeProfile | null;
}

export interface MatchItem {
  job: Pick<Job, "id" | "title" | "company" | "region" | "sourceUrl" | "salaryKind" | "salaryMin" | "salaryMax" | "application">;
  /** 0–100 */
  score: number;
  matchedSkills: string[];
  missingSkills: string[];
  reasons: string[];
}

export interface DigestSettings {
  enabled: boolean;
  keywords: string[];
  region: RegionId | null;
}

export interface DigestData {
  progress: {
    newTracked: number;
    changes: { title: string; company: string; from: ApplicationStatus | null; to: ApplicationStatus; at: string }[];
  };
  followUps: { applicationId: string; title: string; company: string; appliedAt: string | null; idleDays: number }[];
  topJobs: (JobInput & { externalId: string; score: number; matchedSkills: string[]; missingSkills: string[]; reasons: string[] })[];
  notes: string[];
}

export interface Digest {
  id: string;
  periodStart: string;
  periodEnd: string;
  createdAt: string;
  data: DigestData;
}

export interface ApplicationStats {
  total: number;
  byStatus: Record<ApplicationStatus, number>;
  /** 曾經走到該關的投遞數（從狀態歷程算） */
  funnel: { tracked: number; applied: number; interview: number; offer: number };
}
