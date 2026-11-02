// 追蹤器命令列入口：
//   node --use-system-ca build/server/tracker/main.js [--config tracker-config.json] [--location taoyuan,remote] ...
// 條件預設讀 tracker-config.json（相當於表單），命令列參數可覆寫個別欄位。
// 產出 tracker-data/reports/<日期>.md、<日期>.json，更新 latest.json（下次比對基準）與 metrics-history.json（趨勢）。

import { mkdir, readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { formatSalary, monthlyMin } from "../../shared/matcher.js";
import type { Job } from "../../shared/types.js";
import { mapLimit } from "../http.js";
import { TAOYUAN_ZIPS, loadByZips, taiwanJobs } from "../sources/taiwanjobs.js";
import { yourator } from "../sources/yourator.js";
import { diffJob, recheck } from "./compare.js";
import { loadInputs, wantsCodeSource } from "./config.js";
import { aiTerms, inferSeniority, locationBucket, searchTerms, seniorityAccepted } from "./filters.js";
import { renderReport } from "./report.js";
import type {
  FieldChange, LocationBucket, MetricsRecord, RunResult, Snapshot, TrackedJob, TrackerInputs,
} from "./types.js";

const ROOT = resolve(fileURLToPath(new URL("../../..", import.meta.url)));
const DATA_DIR = resolve(ROOT, "tracker-data");
const LATEST = resolve(DATA_DIR, "latest.json");
const HISTORY = resolve(DATA_DIR, "metrics-history.json");

function configPath(): string {
  const i = process.argv.indexOf("--config");
  return resolve(ROOT, i >= 0 ? process.argv[i + 1] ?? "" : "tracker-config.json");
}

// ---------- 取資料 ----------

async function collect(inputs: TrackerInputs, notes: string[]): Promise<Job[]> {
  const jobs: Job[] = [];
  const wantTaiwan = inputs.locations.includes("taiwan");

  if (wantsCodeSource(inputs, "taiwanjobs")) {
    try {
      const tj = wantTaiwan
        ? await taiwanJobs.search({ categoryId: null, subIds: new Set(), regions: new Set(), keyword: "" })
        : await loadByZips(TAOYUAN_ZIPS, 500);
      jobs.push(...tj);
      notes.push(`台灣就業通（開放資料 API）：取得 ${tj.length} 筆${wantTaiwan ? "全台" : "桃園市各區"}職缺後篩選`);
    } catch (err: unknown) {
      notes.push(`台灣就業通：無法取得（${err instanceof Error ? err.message : "未知錯誤"}）`);
    }
  } else {
    notes.push("台灣就業通：未在 sites 指定，略過");
  }

  if (wantsCodeSource(inputs, "yourator")) {
    const terms = searchTerms(inputs.keywords);
    const settled = await mapLimit(terms, 2, (term) =>
      yourator.search({ categoryId: null, subIds: new Set(), regions: new Set(), keyword: term }));
    const yo = settled.flatMap((s) => (s.status === "fulfilled" ? s.value : []));
    const failedTerms = settled.filter((s) => s.status === "rejected").length;
    jobs.push(...yo);
    notes.push(`Yourator（站內搜尋 ${terms.length} 組關鍵字）：取得 ${yo.length} 筆${failedTerms > 0 ? `，${failedTerms} 組失敗` : ""}`);
  } else {
    notes.push("Yourator：未在 sites 指定，略過");
  }

  if (inputs.locations.some((l) => l === "us" || l === "global")) {
    notes.push("us／global：程式來源僅涵蓋台灣，海外職缺需靠網路搜尋補充");
  }
  notes.push("104、1111、CakeResume、LinkedIn、Indeed、Glassdoor 會阻擋程式存取，程式未抓取；由網路搜尋摘要補充，資料可能不完整");
  return [...new Map(jobs.map((j) => [j.id, j])).values()];
}

/** Yourator 列表只有摘要；對通過初篩的職缺補抓詳情，失敗就保留摘要 */
async function withDetails(jobs: readonly Job[]): Promise<Job[]> {
  const settled = await mapLimit(jobs, 3, async (j) =>
    j.detailLoaded || !j.sourceUrl || !yourator.detail ? j : { ...(await yourator.detail(j.sourceUrl)), tags: j.tags });
  return settled.map((s, i) => (s.status === "fulfilled" ? s.value : jobs[i] as Job));
}

function bucketWanted(bucket: LocationBucket, inputs: TrackerInputs): boolean {
  switch (bucket) {
    case "taoyuan": return inputs.locations.includes("taoyuan") || inputs.locations.includes("taiwan");
    case "remote": return inputs.locations.includes("remote");
    case "taiwan": return inputs.locations.includes("taiwan");
    case "unconfirmed": return true; // 一律列入「地點待確認」，但不計入桃園
  }
}

type Exclusion = "company" | "salary" | null;

/** 使用者條件：排除公司、月薪下限。薪資未標明數字的職缺不排除（無從比較），報告中會註明。 */
function excludedBy(job: Job, inputs: TrackerInputs): Exclusion {
  if (inputs.excludeCompanies.some((c) => c.trim() !== "" && job.company.includes(c.trim()))) return "company";
  const floor = inputs.minMonthlySalary;
  if (floor !== null && job.salary.min !== null && monthlyMin(job) < floor) return "salary";
  return null;
}

function toTracked(job: Job, terms: readonly string[], today: string): TrackedJob {
  const deadline = /應徵截止：(\d{4}-\d{2}-\d{2})/.exec(job.requirements.others.join(" "))?.[1] ?? "";
  return {
    key: job.id,
    source: job.source,
    url: job.sourceUrl ?? "",
    company: job.company,
    title: job.title,
    location: job.address,
    bucket: locationBucket(job),
    postedAt: job.postedAt,
    deadline,
    salary: formatSalary(job),
    summary: job.duties.slice(0, 4).join(" ").slice(0, 240),
    skills: job.requirements.skills,
    seniority: inferSeniority(job),
    matchedKeywords: terms,
    complete: job.detailLoaded,
    status: "open",
    statusEvidence: `本次搜尋仍出現在 ${job.source === "yourator" ? "Yourator" : "台灣就業通"}`,
    firstSeen: today,
    lastSeen: today,
  };
}

// ---------- 讀寫紀錄 ----------

async function readJson(path: string): Promise<unknown | null> {
  let text: string;
  try {
    text = await readFile(path, "utf8");
  } catch (err: unknown) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw err;
  }
  return JSON.parse(text.replace(/^﻿/, "")) as unknown; // 去掉部分編輯器加的 BOM
}

function isSnapshot(v: unknown): v is Snapshot {
  return typeof v === "object" && v !== null
    && typeof (v as { runAt?: unknown }).runAt === "string"
    && Array.isArray((v as { jobs?: unknown }).jobs);
}

/**
 * 只有「檔案不存在」才視為第一次執行。
 * 檔案存在卻讀不懂時直接中止——若默默當成首次執行，會用空基準覆蓋掉真正的歷史紀錄。
 */
async function readPrevious(): Promise<Snapshot | null> {
  const parsed = await readJson(LATEST);
  if (parsed === null) return null;
  if (!isSnapshot(parsed)) throw new Error(`${LATEST} 格式不正確，已中止以保護比對基準`);
  return parsed;
}

async function readHistory(): Promise<MetricsRecord[]> {
  const parsed = await readJson(HISTORY);
  if (parsed === null) return [];
  if (!Array.isArray(parsed)) throw new Error(`${HISTORY} 格式不正確，已中止以保護趨勢紀錄`);
  return parsed as MetricsRecord[];
}

// ---------- 主流程 ----------

async function run(): Promise<void> {
  const inputs = await loadInputs(configPath());
  const runAt = new Date().toISOString();
  const today = runAt.slice(0, 10);
  const notes: string[] = [];
  // 同一天重跑：沿用當天第一次執行時的基準，否則新增數會變 0、變更也比不出來
  const stored = await readPrevious();
  const previous = stored && stored.runAt.slice(0, 10) === today ? stored.baseline ?? null : stored;
  const history = await readHistory();
  const prevByKey = new Map((previous?.jobs ?? []).map((j) => [j.key, j]));

  // 1. 取資料 → 2. AI 關鍵字與地點初篩 → 3. 補詳情後再篩一次（詳情可能修正地點與年資）
  const raw = await collect(inputs, notes);
  const firstPass = raw.filter((j) => aiTerms(j, inputs.keywords).length > 0 && bucketWanted(locationBucket(j), inputs));
  const detailed = await withDetails(firstPass);

  const current: TrackedJob[] = [];
  const excluded = { company: 0, salary: 0 };
  let salaryUnknown = 0;
  for (const job of detailed) {
    const terms = aiTerms(job, inputs.keywords);
    if (terms.length === 0 || !bucketWanted(locationBucket(job), inputs)) continue;
    if (!seniorityAccepted(inputs.seniority, inferSeniority(job))) continue;
    const reason = excludedBy(job, inputs);
    if (reason !== null) {
      excluded[reason]++;
      continue;
    }
    if (inputs.minMonthlySalary !== null && job.salary.min === null) salaryUnknown++;
    const tracked = toTracked(job, terms, today);
    const prev = prevByKey.get(tracked.key);
    current.push(prev ? { ...tracked, firstSeen: prev.firstSeen } : tracked);
  }
  if (inputs.excludeCompanies.length > 0) notes.push(`排除公司（${inputs.excludeCompanies.join("、")}）：排除 ${excluded.company} 筆`);
  if (inputs.minMonthlySalary !== null) {
    notes.push(`月薪下限 ${inputs.minMonthlySalary.toLocaleString("zh-TW")} 元：排除 ${excluded.salary} 筆；`
      + `另有 ${salaryUnknown} 筆薪資未標明數字，無法比較而保留`);
  }
  const currentKeys = new Set(current.map((j) => j.key));

  // 4. 內容變更
  const changes = new Map<string, readonly FieldChange[]>();
  for (const job of current) {
    const prev = prevByKey.get(job.key);
    const diff = prev ? diffJob(prev, job) : [];
    if (diff.length > 0) changes.set(job.key, diff);
  }

  // 5. 上次追蹤中、這次不在清單的職缺分兩種：
  //    來源仍列著但不符合條件（例如改了設定、被排除）→ 移出追蹤，不算關閉；
  //    來源已找不到 → 重新造訪職缺頁判斷狀態。
  const rawKeys = new Set(raw.map((j) => j.id));
  const prevOpen = (previous?.jobs ?? []).filter((j) => !currentKeys.has(j.key) && j.status !== "closed");
  const outOfScope = prevOpen.filter((j) => rawKeys.has(j.key));
  if (outOfScope.length > 0) {
    notes.push(`不再符合條件而移出追蹤（來源仍刊登，不計為關閉）：${outOfScope.map((j) => `${j.company}｜${j.title}`).join("、")}`);
  }
  const missing = prevOpen.filter((j) => !rawKeys.has(j.key));
  const rechecked = await mapLimit(missing, 3, (j) => recheck(j, today));
  const carried: TrackedJob[] = missing.map((j, i) => {
    const r = rechecked[i];
    const check = r?.status === "fulfilled" ? r.value : { status: "unknown" as const, evidence: "重新檢查失敗" };
    return { ...j, status: check.status, statusEvidence: check.evidence };
  });
  // 已關閉的舊職缺保留在快照中一次，之後不再追蹤
  const closedKeys = carried.filter((j) => j.status === "closed").map((j) => j.key);

  const all = [...current, ...carried];
  const counted = all.filter((j) => j.bucket !== "unconfirmed");
  const newKeys = previous ? current.filter((j) => !prevByKey.has(j.key)).map((j) => j.key) : current.map((j) => j.key);

  const metrics = {
    total_openings: counted.filter((j) => j.status === "open").length,
    new_openings: newKeys.filter((k) => all.find((j) => j.key === k)?.bucket !== "unconfirmed").length,
    closed_openings: closedKeys.length,
    changed_postings: changes.size,
    // 評價數由排程中的 Claude 補上；同一天重跑時保留，不要清回 null
    new_reviews_count: history.find((h) => h.date === today)?.metrics.new_reviews_count ?? null,
  };
  // 同一天重跑時覆蓋當天紀錄，避免趨勢重複計算
  const nextHistory = [...history.filter((h) => h.date !== today), { date: today, metrics }]
    .sort((a, b) => a.date.localeCompare(b.date));

  // 基準只留一層，避免快照越存越大
  const baseline = previous ? { runAt: previous.runAt, inputs: previous.inputs, jobs: previous.jobs } : null;
  const snapshot: Snapshot = { runAt, inputs, jobs: all, baseline };
  const result: RunResult = {
    snapshot,
    previousRunAt: previous?.runAt ?? null,
    newKeys,
    closedKeys,
    changes,
    metrics,
    history: nextHistory,
    sourceNotes: notes,
  };

  await mkdir(resolve(DATA_DIR, "reports"), { recursive: true });
  const reportPath = resolve(DATA_DIR, "reports", `${today}.md`);
  const jsonPath = resolve(DATA_DIR, "reports", `${today}.json`);
  await writeFile(reportPath, renderReport(result), "utf8");
  await writeFile(jsonPath, JSON.stringify({ ...result, changes: Object.fromEntries(changes) }, null, 2), "utf8");
  await writeFile(LATEST, JSON.stringify(snapshot, null, 2), "utf8");
  await writeFile(HISTORY, JSON.stringify(nextHistory, null, 2), "utf8");

  console.log(JSON.stringify({ report: reportPath, json: jsonPath, history: HISTORY, metrics }, null, 2));
}

run().catch((err: unknown) => {
  console.error(err instanceof Error ? err.message : err);
  process.exitCode = 1;
});
