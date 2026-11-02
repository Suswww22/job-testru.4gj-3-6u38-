// 工程師求職 Agent：依職類、縣市、資歷、職稱關鍵字，從台灣就業通與 Yourator 取回真實職缺，
// 並記住每筆職缺第一次看到時的條件，之後再搜尋到時比對有沒有被改過。

import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { COUNTIES, REMOTE, type AgentJob, type AgentQuery, type AgentResponse, type Change, type Level, type RoleId } from "../shared/agent.js";
import { containsTerm, formatSalary } from "../shared/matcher.js";
import type { Job } from "../shared/types.js";
import { mapLimit } from "./http.js";
import { loadByZips } from "./sources/taiwanjobs.js";
import { yourator } from "./sources/yourator.js";
import { aiTerms, inferSeniority, isTechRole } from "./tracker/filters.js";

const SEEN_FILE = resolve(fileURLToPath(new URL("../../tracker-data/agent-seen.json", import.meta.url)));
/** 台灣就業通職務代碼 08 = 資訊軟體類 */
const IT_JOBNO = "08";
const PER_ZIP = 200;
const MAX_DETAILS = 60;

// ---------- 職類判定 ----------

const ROLE_TITLE: Readonly<Record<Exclude<RoleId, "ai">, RegExp>> = {
  fe: /前端|front-?end|網頁(設計|開發|程式)?工程|web\s*(工程|developer|engineer)|react|vue|angular|ui\s*工程/i,
  be: /後端|back-?end|伺服器|server|api|java\b|golang|\bgo\b|php|\.net|c#|node\.?js|python\s*(工程|developer|engineer)/i,
  fs: /全端|full-?\s?stack/i,
};

const ROLE_SUB: Readonly<Record<RoleId, string>> = { ai: "ds", fe: "frontend", be: "backend", fs: "fullstack" };

/** 職稱優先；職稱看不出來時（例如「軟體工程師」）才用內文分類結果 */
function rolesOf(job: Job): RoleId[] {
  if (!isTechRole(job)) return [];
  const roles: RoleId[] = (["fe", "be", "fs"] as const).filter((id) => ROLE_TITLE[id].test(job.title));
  const ai = aiTerms(job, ["ml", "dl", "llm", "cv", "data"]);
  // 職稱已看得出職類時，只有職稱本身帶 AI 字眼才算；否則「前端工程師」會因內文提到 LLM 被歸成 AI
  const title = job.title.toLowerCase();
  if (roles.length > 0 ? ai.some((t) => containsTerm(title, t)) : ai.length > 0) roles.unshift("ai");
  if (roles.length > 0) return roles;
  const bySub = (Object.keys(ROLE_SUB) as RoleId[]).find((id) => ROLE_SUB[id] === job.subId);
  return bySub ? [bySub] : [];
}

const YOURATOR_TERMS: Readonly<Record<RoleId, readonly string[]>> = {
  ai: ["AI Engineer", "機器學習", "LLM"],
  fe: ["前端", "Frontend"],
  be: ["後端", "Backend"],
  fs: ["全端", "Full Stack"],
};

// ---------- 地點 ----------

function countyOf(job: Job): string {
  const addr = job.address.replace(/臺/g, "台");
  if (job.region === "remote" || /遠端|remote|wfh/i.test(addr)) return REMOTE;
  // 先比完整名稱，再比簡稱；否則「新竹縣竹北市」會因含「新竹」被當成新竹市
  return COUNTIES.find((c) => addr.includes(c.name))?.name
    ?? COUNTIES.find((c) => addr.includes(c.name.slice(0, 2)))?.name ?? "";
}

function zipsOf(counties: readonly string[]): string[] {
  const picked = counties.length === 0 ? COUNTIES : COUNTIES.filter((c) => counties.includes(c.name));
  return picked.flatMap((c) => c.zips.flatMap(([a, b]) =>
    Array.from({ length: b - a + 1 }, (_, i) => String(a + i))));
}

// ---------- 條件變動紀錄 ----------

/** 比對的欄位；值是「看起來」的文字，只要文字變了就算變動 */
function snapshotFields(job: Job): Record<string, string> {
  return {
    職稱: job.title,
    薪資: formatSalary(job),
    工作經驗: job.requirements.minYears > 0 ? `${job.requirements.minYears} 年以上` : "不拘",
    地點: job.address,
    福利: [...job.salary.perks, ...job.otherBenefits].join("、"),
    工作內容: job.duties.slice(0, 6).join(" ").slice(0, 300),
  };
}

interface SeenEntry {
  readonly firstSeen: string;
  readonly fields: Record<string, string>;
  readonly changes: Change[];
}

type SeenStore = Record<string, SeenEntry>;

async function readSeen(): Promise<SeenStore> {
  try {
    return JSON.parse(await readFile(SEEN_FILE, "utf8")) as SeenStore;
  } catch (err: unknown) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return {};
    throw err;
  }
}

// 同時有兩個搜尋時依序寫檔，避免互相覆蓋
let writing: Promise<void> = Promise.resolve();

function track(store: SeenStore, job: Job, today: string): SeenEntry {
  const now = snapshotFields(job);
  const prev = store[job.id];
  if (!prev) return (store[job.id] = { firstSeen: today, fields: now, changes: [] });
  // 只有摘要（詳情抓取失敗）時不比對，避免把缺資料誤判成條件被刪除
  if (!job.detailLoaded) return prev;
  const changes = Object.keys(now)
    .filter((f) => (prev.fields[f] ?? "") !== now[f])
    .map((field) => ({ field, before: prev.fields[field] ?? "", after: now[field] ?? "", date: today }));
  if (changes.length === 0) return prev;
  return (store[job.id] = { firstSeen: prev.firstSeen, fields: now, changes: [...prev.changes, ...changes] });
}

// ---------- 主流程 ----------

async function collect(q: AgentQuery, notes: string[]): Promise<Job[]> {
  const jobs: Job[] = [];
  const onlyRemote = q.counties.length > 0 && q.counties.every((c) => c === REMOTE);

  if (!onlyRemote) {
    const zips = zipsOf(q.counties.filter((c) => c !== REMOTE));
    try {
      const tj = await loadByZips(zips, PER_ZIP, IT_JOBNO);
      jobs.push(...tj);
      notes.push(`台灣就業通：查詢 ${zips.length} 個郵遞區號的資訊軟體類職缺，取得 ${tj.length} 筆`);
    } catch (err: unknown) {
      notes.push(`台灣就業通：無法取得（${err instanceof Error ? err.message : "未知錯誤"}）`);
    }
  }

  const roles = q.roles.length > 0 ? q.roles : (["ai", "fe", "be", "fs"] as const);
  const terms = [...new Set(roles.flatMap((r) => YOURATOR_TERMS[r]))];
  const settled = await mapLimit(terms, 2, (term) =>
    yourator.search({ categoryId: null, subIds: new Set(), regions: new Set(), keyword: term }));
  const yo = settled.flatMap((s) => (s.status === "fulfilled" ? s.value : []));
  const failed = settled.filter((s) => s.status === "rejected").length;
  jobs.push(...yo);
  notes.push(`Yourator：站內搜尋 ${terms.length} 組關鍵字，取得 ${yo.length} 筆${failed > 0 ? `（${failed} 組失敗）` : ""}`);

  return [...new Map(jobs.map((j) => [j.id, j])).values()];
}

/** Yourator 列表只有摘要，對通過初篩的職缺補抓詳情；失敗就保留摘要 */
async function withDetails(jobs: readonly Job[], notes: string[]): Promise<Job[]> {
  const need = jobs.filter((j) => !j.detailLoaded).slice(0, MAX_DETAILS);
  const settled = await mapLimit(need, 3, async (j): Promise<Job> => {
    if (!j.sourceUrl || !yourator.detail) return j;
    const d = await yourator.detail(j.sourceUrl);
    // 詳情頁的結構化資料常缺薪資，改用列表上的薪資文字
    const salary = d.salary.min === null && j.salary.note ? { ...j.salary, perks: d.salary.perks } : d.salary;
    return { ...d, salary, tags: j.tags };
  });
  const full = new Map(settled.flatMap((s) => (s.status === "fulfilled" ? [[s.value.id, s.value] as const] : [])));
  const skipped = jobs.filter((j) => !j.detailLoaded).length - full.size;
  if (skipped > 0) notes.push(`Yourator：${skipped} 筆只取得摘要，薪資福利與經驗可能不完整`);
  return jobs.map((j) => full.get(j.id) ?? j);
}

function matchesBasic(job: Job, roles: readonly RoleId[], q: AgentQuery): boolean {
  if (roles.length === 0) return false;
  if (q.roles.length > 0 && !roles.some((r) => q.roles.includes(r))) return false;
  const words = q.keyword.trim().toLowerCase().split(/\s+/).filter((w) => w !== "");
  return words.every((w) => containsTerm(job.title.toLowerCase(), w));
}

/** 資歷未標明的職缺保留，介面上會標示，避免漏掉可能符合的職缺 */
function levelAccepted(level: Level | "unknown", wanted: readonly Level[]): boolean {
  return wanted.length === 0 || level === "unknown" || wanted.includes(level);
}

export async function searchAgent(q: AgentQuery): Promise<AgentResponse> {
  const notes: string[] = [];
  const raw = await collect(q, notes);
  const basic = raw.filter((j) => matchesBasic(j, rolesOf(j), q));
  const detailed = await withDetails(basic, notes);

  const today = new Date().toLocaleDateString("sv-SE", { timeZone: "Asia/Taipei" });
  const store = await readSeen();
  const jobs: AgentJob[] = [];
  for (const job of detailed) {
    const roles = rolesOf(job);
    const county = countyOf(job);
    const level = inferSeniority(job);
    if (!matchesBasic(job, roles, q)) continue; // 詳情可能改變職稱或分類
    if (q.counties.length > 0 && !q.counties.includes(county)) continue;
    if (!levelAccepted(level, q.levels)) continue;
    const seen = track(store, job, today);
    jobs.push({ job, roles, county, level, firstSeen: seen.firstSeen, changes: seen.changes });
  }

  writing = writing.then(async () => {
    await mkdir(dirname(SEEN_FILE), { recursive: true });
    await writeFile(SEEN_FILE, JSON.stringify(store), "utf8");
  }).catch((err: unknown) => console.error("[agent] 無法寫入紀錄", err));
  await writing;

  notes.push("員工評價：沒有可合法自動取得的公開資料來源，請用各職缺的評價連結查詢");
  return { jobs, notes };
}
