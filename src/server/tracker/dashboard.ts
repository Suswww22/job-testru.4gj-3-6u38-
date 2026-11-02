// 追蹤器儀表板的資料：把 tracker-data/ 裡的報告、趨勢、評價與線索整理成一份給網頁用，
// 並處理表單送出的新設定。追蹤本身仍由每週排程執行（npm run track ＋ RUNBOOK）。

import { readdir, readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { parseInputs, toConfig } from "./config.js";
import type {
  Aggregation, FieldChange, Lead, MetricKey, MetricsRecord, SeenReview, TrackedJob, TrackerConfig, TrackerDashboard,
} from "./types.js";

const ROOT = resolve(fileURLToPath(new URL("../../..", import.meta.url)));
const DATA_DIR = resolve(ROOT, "tracker-data");
const CONFIG = resolve(ROOT, "tracker-config.json");

async function readJson(path: string): Promise<unknown> {
  try {
    return JSON.parse((await readFile(path, "utf8")).replace(/^﻿/, "")) as unknown;
  } catch (err: unknown) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw err;
  }
}

function field<T>(obj: unknown, key: string): T | undefined {
  return typeof obj === "object" && obj !== null ? (obj as Record<string, T>)[key] : undefined;
}

/** 依記憶設定：total_openings 取 avg，其餘取 sum；new_reviews_count 尚未補上（null）的週不計入 */
function aggregate(history: readonly MetricsRecord[]): Record<MetricKey, Aggregation> {
  const values = (k: MetricKey): number[] =>
    history.map((h) => h.metrics[k]).filter((v): v is number => typeof v === "number");
  const sum = (k: MetricKey): Aggregation => {
    const v = values(k);
    return { sum: v.reduce((a, b) => a + b, 0), count: v.length };
  };
  const open = values("total_openings");
  return {
    total_openings: {
      avg: open.length > 0 ? Math.round((open.reduce((a, b) => a + b, 0) / open.length) * 10) / 10 : 0,
      count: open.length,
    },
    new_openings: sum("new_openings"),
    closed_openings: sum("closed_openings"),
    changed_postings: sum("changed_postings"),
    new_reviews_count: sum("new_reviews_count"),
  };
}

/** 最新一份程式報告（檔名為 YYYY-MM-DD.json） */
async function latestReport(): Promise<TrackerDashboard["report"]> {
  let names: string[];
  try {
    names = await readdir(resolve(DATA_DIR, "reports"));
  } catch {
    return null;
  }
  const latest = names.filter((n) => /^\d{4}-\d{2}-\d{2}\.json$/.test(n)).sort().at(-1);
  if (!latest) return null;
  const r = await readJson(resolve(DATA_DIR, "reports", latest));
  const snapshot = field<unknown>(r, "snapshot");
  return {
    date: latest.slice(0, 10),
    previousRunAt: field<string | null>(r, "previousRunAt") ?? null,
    jobs: field<TrackedJob[]>(snapshot, "jobs") ?? [],
    newKeys: field<string[]>(r, "newKeys") ?? [],
    closedKeys: field<string[]>(r, "closedKeys") ?? [],
    changes: field<Record<string, FieldChange[]>>(r, "changes") ?? {},
    sourceNotes: field<string[]>(r, "sourceNotes") ?? [],
  };
}

export async function loadDashboard(): Promise<TrackerDashboard> {
  const [configRaw, report, historyRaw, seen, leads] = await Promise.all([
    readJson(CONFIG),
    latestReport(),
    readJson(resolve(DATA_DIR, "metrics-history.json")),
    readJson(resolve(DATA_DIR, "reviews-seen.json")),
    readJson(resolve(DATA_DIR, "leads.json")),
  ]);
  const history = Array.isArray(historyRaw) ? (historyRaw as MetricsRecord[]) : [];
  return {
    config: toConfig(parseInputs((configRaw ?? {}) as Record<string, unknown>).inputs),
    report,
    history,
    aggregations: aggregate(history),
    reviews: field<SeenReview[]>(seen, "reviews") ?? [],
    reviewsLastRun: field<string>(seen, "lastRun") ?? null,
    leads: field<Lead[]>(leads, "leads") ?? [],
  };
}

/** 驗證表單內容後寫回 tracker-config.json；有錯就不寫，回傳全部錯誤 */
export async function saveConfig(body: unknown): Promise<{ config: TrackerConfig } | { errors: string[] }> {
  if (typeof body !== "object" || body === null || Array.isArray(body)) return { errors: ["格式不正確"] };
  const { inputs, errors } = parseInputs(body as Record<string, unknown>);
  if (errors.length > 0) return { errors };
  const config = toConfig(inputs);
  await writeFile(CONFIG, `${JSON.stringify(config, null, 2)}\n`, "utf8");
  return { config };
}
