// 產生 Markdown 報告。章節依 SKILL.md 的 Output 要求排列。

import { SOURCES } from "../../shared/data.js";
import type { DiffField, Metrics, MetricsRecord, RunResult, TrackedJob } from "./types.js";

const FIELD_LABEL: Readonly<Record<DiffField, string>> = {
  title: "職稱", salary: "薪資", location: "地點", summary: "工作內容", skills: "必備技能", postedAt: "張貼／更新日期",
};
const STATUS_LABEL = { open: "🟢 仍在招募", closed: "🔴 已關閉", unknown: "⚪ 無法判定" } as const;
const SENIORITY_LABEL = { junior: "初階", mid: "中階", senior: "資深", lead: "主管／技術領導", unknown: "資歷未標明" } as const;

const sourceName = new Map(SOURCES.map((s) => [s.id, s.name]));

/** 表格內容不可含換行與直線符號 */
function cell(s: string): string {
  return s.replace(/\|/g, "／").replace(/\s+/g, " ").trim() || "—";
}

function jobLink(j: TrackedJob): string {
  return `[${cell(j.title)}](${j.url})`;
}

function jobTable(jobs: readonly TrackedJob[]): string[] {
  if (jobs.length === 0) return ["查無資料。", ""];
  return [
    "| 公司 | 職稱 | 地點 | 薪資 | 資歷 | 命中關鍵字 | 來源 | 更新日期 |",
    "|---|---|---|---|---|---|---|---|",
    ...jobs.map((j) => `| ${cell(j.company)} | ${jobLink(j)} | ${cell(j.location)} | ${cell(j.salary)} | ${SENIORITY_LABEL[j.seniority]} | ${cell(j.matchedKeywords.join("、"))} | ${sourceName.get(j.source) ?? j.source} | ${cell(j.postedAt)} |`),
    "",
  ];
}

const TREND_WEEKS = 8;

/** 近 8 週明細＋全期彙總（開啟數取平均，其餘取加總）；new_reviews_count 尚未補上的週不計入評價彙總 */
function trendSection(history: readonly MetricsRecord[]): string[] {
  if (history.length < 2) return ["### 趨勢", "", "累積兩週以上的紀錄後才會顯示趨勢。", ""];
  const recent = history.slice(-TREND_WEEKS);
  const sum = (f: (m: Metrics) => number): number => history.reduce((acc, h) => acc + f(h.metrics), 0);
  const reviewed = history.filter((h) => h.metrics.new_reviews_count !== null);
  const avgOpen = Math.round((sum((m) => m.total_openings) / history.length) * 10) / 10;
  return [
    "### 趨勢",
    "",
    "| 週 | 開啟 | 新增 | 關閉 | 變更 | 新評價 |",
    "|---|---|---|---|---|---|",
    ...recent.map((h) => {
      const m = h.metrics;
      return `| ${h.date} | ${m.total_openings} | ${m.new_openings} | ${m.closed_openings} | ${m.changed_postings} | ${m.new_reviews_count ?? "待補"} |`;
    }),
    "",
    `全期 ${history.length} 週：平均開啟 ${avgOpen} 筆；累計新增 ${sum((m) => m.new_openings)}、`
      + `關閉 ${sum((m) => m.closed_openings)}、變更 ${sum((m) => m.changed_postings)}；`
      + `累計新評價 ${reviewed.reduce((acc, h) => acc + (h.metrics.new_reviews_count ?? 0), 0)}（${reviewed.length} 週有資料）。`,
    "",
  ];
}

export function renderReport(r: RunResult): string {
  const { snapshot: s, metrics: m } = r;
  const date = s.runAt.slice(0, 10);
  const byKey = new Map(s.jobs.map((j) => [j.key, j]));
  const tracked = s.jobs.filter((j) => j.bucket !== "unconfirmed");
  const unconfirmed = s.jobs.filter((j) => j.bucket === "unconfirmed");
  const newJobs = r.newKeys.map((k) => byKey.get(k)).filter((j): j is TrackedJob => j !== undefined);

  const out: string[] = [
    `# AI 工程師職缺追蹤報告（${date}）`,
    "",
    `- 地區：${s.inputs.locations.join("、")}　資歷：${s.inputs.seniority}　關鍵字：${s.inputs.keywords.join("、")}`,
    `- 求職網站：${s.inputs.sites.length > 0 ? s.inputs.sites.join("、") : "全部主流平台"}`,
    s.inputs.minMonthlySalary !== null ? `- 月薪下限：${s.inputs.minMonthlySalary.toLocaleString("zh-TW")} 元` : "",
    s.inputs.excludeCompanies.length > 0 ? `- 排除公司：${s.inputs.excludeCompanies.join("、")}` : "",
    s.inputs.notes ? `- 其他要求（未自動套用）：${s.inputs.notes}` : "",
    r.previousRunAt ? `- 比對基準：${r.previousRunAt.slice(0, 10)} 的快照` : "- 比對基準：無（首次執行，所有職缺標記為新增，不判定內容變更）",
    "",
    "## 總覽指標",
    "",
    "| 指標 | 數值 |",
    "|---|---|",
    `| total_openings（目前開啟） | ${m.total_openings} |`,
    `| new_openings（本週新增） | ${m.new_openings} |`,
    `| closed_openings（本週關閉） | ${m.closed_openings} |`,
    `| changed_postings（內容有變更） | ${m.changed_postings} |`,
    `| new_reviews_count（本週新評價） | ${m.new_reviews_count ?? "待補（網路搜尋）"} |`,
    "",
    ...trendSection(r.history),
    "## 1. 內容變更",
    "",
  ];

  if (!r.previousRunAt) {
    out.push("首次執行，沒有比對基準。", "");
  } else if (r.changes.size === 0) {
    out.push("本週沒有職缺內容變更。", "");
  } else {
    for (const [key, changes] of r.changes) {
      const j = byKey.get(key);
      if (!j) continue;
      out.push(`### ${cell(j.company)}｜${jobLink(j)}`, "", "| 欄位 | 變更前 | 變更後 |", "|---|---|---|");
      out.push(...changes.map((c) => `| ${FIELD_LABEL[c.field]} | ${cell(c.before)} | ${cell(c.after)} |`), "");
    }
  }

  out.push("## 2. 公司評價", "", "<!-- REVIEWS -->", "程式無法取得評價網站資料，此區由排程中的 Claude 以網路搜尋補上。", "");

  out.push("## 3. 職缺狀態", "");
  if (tracked.length === 0) {
    out.push("查無資料。", "");
  } else {
    out.push("| 狀態 | 公司 | 職稱 | 判定依據 |", "|---|---|---|---|");
    const order = { open: 0, unknown: 1, closed: 2 } as const;
    for (const j of [...tracked].sort((a, b) => order[a.status] - order[b.status])) {
      const isNew = r.newKeys.includes(j.key) ? "（新增）" : "";
      out.push(`| ${STATUS_LABEL[j.status]}${isNew} | ${cell(j.company)} | ${jobLink(j)} | ${cell(j.statusEvidence)} |`);
    }
    out.push("");
  }

  out.push("### 本週新增職缺", "", ...jobTable(newJobs));
  out.push("## 4. 地點待確認", "", "以下職缺未標明縣市，未計入桃園市清單。", "", ...jobTable(unconfirmed));
  out.push("## 資料來源與限制", "", ...r.sourceNotes.map((n) => `- ${n}`), "", "<!-- SEARCH-SOURCES -->", "");

  return out.filter((line, i, arr) => !(line === "" && arr[i - 1] === "")).join("\n");
}
