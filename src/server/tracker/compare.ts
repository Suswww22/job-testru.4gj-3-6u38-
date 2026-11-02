// 與上次快照比對：內容變更、職缺狀態。

import { fetchText, MINUTE } from "../http.js";
import { yourator } from "../sources/yourator.js";
import type { DiffField, FieldChange, JobStatus, TrackedJob } from "./types.js";

const FIELDS: readonly DiffField[] = ["title", "salary", "location", "summary", "skills", "postedAt"];

function fieldText(job: TrackedJob, field: DiffField): string {
  return field === "skills" ? [...job.skills].sort().join("、") : job[field];
}

/** 首次出現的職缺不比對，避免把「沒有基準」誤報成變更 */
export function diffJob(before: TrackedJob, after: TrackedJob): FieldChange[] {
  return FIELDS
    .map((field) => ({ field, before: fieldText(before, field), after: fieldText(after, field) }))
    // 資料不完整時（詳情抓取失敗）空白欄位不算變更；資料完整時，欄位變空就是真的被刪除
    .filter((c) => c.before !== c.after && (after.complete || c.after !== ""));
}

export interface StatusCheck {
  readonly status: JobStatus;
  readonly evidence: string;
}

function isNotFound(err: unknown): boolean {
  return err instanceof Error && /HTTP 404|HTTP 410/.test(err.message);
}

/**
 * 本次搜尋沒再出現的舊職缺，重新造訪職缺頁判斷狀態。
 * 判斷不了時回報 unknown 並寫明原因，不猜測。
 */
export async function recheck(job: TrackedJob, today: string): Promise<StatusCheck> {
  if (job.deadline !== "" && job.deadline < today) {
    return { status: "closed", evidence: `應徵截止日 ${job.deadline} 已過` };
  }
  try {
    if (job.source === "yourator") {
      await yourator.detail?.(job.url);
      return { status: "open", evidence: "職缺頁仍存在且有職缺結構化資料（本次搜尋未命中，可能是條件或排序變動）" };
    }
    const html = await fetchText(job.url, 30 * MINUTE);
    return html.includes(job.title)
      ? { status: "open", evidence: "職缺頁仍顯示此職稱" }
      : { status: "unknown", evidence: "職缺頁可開啟但已找不到此職稱，可能已下架" };
  } catch (err: unknown) {
    if (isNotFound(err)) return { status: "closed", evidence: "職缺頁回應 404／410（已下架）" };
    if (err instanceof Error && /沒有結構化資料/.test(err.message)) {
      return { status: "closed", evidence: "職缺頁已無職缺資料（已下架）" };
    }
    return { status: "unknown", evidence: `無法開啟職缺頁：${err instanceof Error ? err.message : "未知錯誤"}` };
  }
}
