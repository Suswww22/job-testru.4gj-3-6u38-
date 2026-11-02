// 追蹤器儀表板：顯示最新一週的報告（指標、內容變更、公司評價、職缺狀態、地點待確認、線索），
// 並提供表單編輯 tracker-config.json。資料本身由每週排程產生，這頁只負責閱讀與設定。

import type {
  KeywordGroup, LocationScope, MetricKey, MetricsRecord, SeenReview, Seniority, TrackedJob, TrackerConfig,
  TrackerDashboard,
} from "../shared/tracker.js";
import { $, h } from "./dom.js";

const LOCATION_OPTIONS: readonly [LocationScope, string][] = [
  ["taoyuan", "桃園市"], ["taiwan", "台灣"], ["remote", "遠端 / Remote"], ["us", "美國"], ["global", "全球"],
];
const SENIORITY_OPTIONS: readonly [Seniority, string][] = [
  ["any", "不拘"], ["junior", "初階 / 新鮮人"], ["mid", "中階（2-5 年）"], ["senior", "資深 / Senior"], ["lead", "主管 / Lead / Manager"],
];
const KEYWORD_OPTIONS: readonly [KeywordGroup, string][] = [
  ["ml", "機器學習 / ML Engineer"], ["dl", "深度學習 / Deep Learning"], ["llm", "LLM / NLP / 生成式 AI"],
  ["cv", "電腦視覺 / Computer Vision"], ["data", "資料科學家 / Data Scientist"],
];

const METRICS: readonly { key: MetricKey; label: string; agg: "avg" | "sum" }[] = [
  { key: "total_openings", label: "目前開啟", agg: "avg" },
  { key: "new_openings", label: "本週新增", agg: "sum" },
  { key: "closed_openings", label: "本週關閉", agg: "sum" },
  { key: "changed_postings", label: "內容變更", agg: "sum" },
  { key: "new_reviews_count", label: "本週新評價", agg: "sum" },
];

const FIELD_LABEL: Readonly<Record<string, string>> = {
  title: "職稱", salary: "薪資", location: "地點", summary: "工作內容", skills: "必備技能", postedAt: "張貼／更新日期",
};
const STATUS = {
  open: { label: "仍在招募", cls: "pill--open" },
  unknown: { label: "無法判定", cls: "pill--unknown" },
  closed: { label: "已關閉", cls: "pill--closed" },
} as const;

let config: TrackerConfig | null = null;

// ---------- 共用 ----------

function section(title: string, count: number | null, ...body: (Node | string)[]): HTMLElement {
  return h("section", { class: "panel t-section" },
    h("h2", {}, title, count !== null ? h("span", { class: "t-count" }, count) : null),
    ...body);
}

function empty(text = "查無資料"): HTMLElement {
  return h("p", { class: "empty" }, text);
}

function link(text: string, url: string): Node {
  return url ? h("a", { href: url, target: "_blank", rel: "noopener noreferrer" }, text) : document.createTextNode(text);
}

function table(head: readonly string[], rows: readonly (readonly (Node | string)[])[]): HTMLElement {
  return h("div", { class: "t-scroll" },
    h("table", { class: "t-table" },
      h("thead", {}, h("tr", {}, head.map((c) => h("th", {}, c)))),
      h("tbody", {}, rows.map((r) => h("tr", {}, r.map((c) => h("td", {}, c)))))));
}

// ---------- 指標 ----------

function metricTiles(d: TrackerDashboard): HTMLElement {
  const latest = d.history.at(-1);
  const prev = d.history.at(-2);
  return h("div", { class: "kpis" }, METRICS.map((m) => {
    const value = latest?.metrics[m.key] ?? null;
    const before = prev?.metrics[m.key] ?? null;
    const delta = value !== null && before !== null ? value - before : null;
    const a = d.aggregations[m.key];
    const aggText = m.agg === "avg" ? `平均 ${a.avg ?? 0}` : `累計 ${a.sum ?? 0}`;
    return h("div", { class: "kpi" },
      h("span", { class: "kpi__label" }, m.label),
      h("strong", { class: "kpi__value" }, value ?? "—"),
      delta !== null && delta !== 0
        ? h("span", { class: delta > 0 ? "kpi__delta is-up" : "kpi__delta is-down" }, `${delta > 0 ? "▲" : "▼"} ${Math.abs(delta)}`)
        : null,
      h("span", { class: "kpi__agg" }, `${aggText}・${a.count} 週`));
  }));
}

function trend(history: readonly MetricsRecord[]): HTMLElement | null {
  if (history.length < 2) return null;
  const rows = [...history].reverse().slice(0, 12).map((r) => [
    r.date, ...METRICS.map((m) => String(r.metrics[m.key] ?? "待補")),
  ]);
  return section("每週趨勢", null, table(["週", ...METRICS.map((m) => m.label)], rows));
}

// ---------- 四大區塊 ----------

function changesSection(r: NonNullable<TrackerDashboard["report"]>, byKey: Map<string, TrackedJob>): HTMLElement {
  const entries = Object.entries(r.changes);
  if (!r.previousRunAt) return section("內容變更", 0, empty("首次執行，沒有比對基準"));
  if (entries.length === 0) return section("內容變更", 0, empty("本週沒有職缺內容變更"));
  return section("內容變更", entries.length, ...entries.map(([key, changes]) => {
    const j = byKey.get(key);
    return h("div", { class: "change" },
      h("h3", {}, j ? link(`${j.company}｜${j.title}`, j.url) : key),
      table(["欄位", "變更前", "變更後"], changes.map((c) => [
        FIELD_LABEL[c.field] ?? c.field,
        h("span", { class: "diff-before" }, c.before || "—"),
        h("span", { class: "diff-after" }, c.after || "—"),
      ])));
  }));
}

function reviewsSection(d: TrackerDashboard, jobs: readonly TrackedJob[]): HTMLElement {
  const companies = [...new Set([
    ...jobs.filter((j) => j.bucket !== "unconfirmed" && j.status !== "closed").map((j) => j.company),
    ...d.reviews.map((rv) => rv.company),
  ])];
  const byCompany = new Map<string, SeenReview[]>();
  for (const rv of d.reviews) byCompany.set(rv.company, [...(byCompany.get(rv.company) ?? []), rv]);

  if (companies.length === 0) return section("公司評價", 0, empty());
  return section("公司評價", d.reviews.length, ...companies.map((company) => {
    const list = (byCompany.get(company) ?? []).slice().sort((a, b) => b.date.localeCompare(a.date));
    const rated = list.filter((rv) => rv.rating !== null);
    const avg = rated.length > 0 ? rated.reduce((s, rv) => s + (rv.rating ?? 0), 0) / rated.length : null;
    return h("details", { class: "company", open: list.length > 0 },
      h("summary", {},
        h("span", { class: "company__name" }, company),
        avg !== null ? h("span", { class: "company__avg" }, `★ ${avg.toFixed(1)}`) : null,
        h("span", { class: "muted" }, list.length > 0 ? `${list.length} 則` : "查無資料")),
      list.length > 0
        ? table(["日期", "職稱", "評分", "來源"], list.map((rv) => [
          rv.date, rv.title, rv.rating !== null ? `★ ${rv.rating}` : "—", link(rv.source, rv.url),
        ]))
        : null);
  }), d.reviewsLastRun ? h("p", { class: "t-foot muted" }, `評價更新於 ${d.reviewsLastRun}`) : "");
}

function statusSection(r: NonNullable<TrackerDashboard["report"]>, jobs: readonly TrackedJob[]): HTMLElement {
  const order = { open: 0, unknown: 1, closed: 2 } as const;
  const sorted = [...jobs].sort((a, b) => order[a.status] - order[b.status]);
  if (sorted.length === 0) return section("職缺狀態", 0, empty());
  return section("職缺狀態", sorted.length, h("div", { class: "jobs" }, sorted.map((j) =>
    h("article", { class: "t-job" },
      h("div", { class: "t-job__top" },
        h("span", { class: `pill ${STATUS[j.status].cls}` }, STATUS[j.status].label),
        r.newKeys.includes(j.key) ? h("span", { class: "pill pill--new" }, "新增") : null,
        r.changes[j.key] ? h("span", { class: "pill pill--changed" }, "有變更") : null),
      h("h3", {}, link(j.title, j.url)),
      h("p", { class: "t-job__company" }, j.company),
      h("p", { class: "t-job__meta" }, j.location, j.salary ? ` ・ ${j.salary}` : "", j.postedAt ? ` ・ 更新 ${j.postedAt}` : ""),
      j.matchedKeywords.length > 0 ? h("div", { class: "tags" }, j.matchedKeywords.map((k) => h("span", { class: "tag" }, k))) : null,
      h("p", { class: "t-job__evidence muted" }, j.statusEvidence)))));
}

function unconfirmedSection(jobs: readonly TrackedJob[]): HTMLElement {
  return section("地點待確認", jobs.length, jobs.length === 0 ? empty() : table(
    ["公司", "職稱", "地點", "更新日期"],
    jobs.map((j) => [j.company, link(j.title, j.url), j.location || "—", j.postedAt || "—"])));
}

function leadsSection(d: TrackerDashboard): HTMLElement {
  return section("主流網站線索", d.leads.length, d.leads.length === 0 ? empty() : table(
    ["公司", "職稱", "地點", "來源", "最後出現"],
    d.leads.map((l) => [l.company, link(l.title, l.url), l.location, l.source, l.lastSeen])));
}

function notesSection(notes: readonly string[]): HTMLElement {
  return h("details", { class: "panel t-section t-notes" },
    h("summary", {}, "資料來源"),
    h("ul", { class: "bullets" }, notes.map((n) => h("li", {}, n))));
}

// ---------- 主畫面 ----------

function render(d: TrackerDashboard): void {
  const root = $("#dashboard");
  const r = d.report;
  if (!r) {
    $("#report-meta").textContent = "";
    root.replaceChildren(h("div", { class: "panel" }, empty("尚未執行過追蹤")));
    return;
  }
  const byKey = new Map(r.jobs.map((j) => [j.key, j]));
  const counted = r.jobs.filter((j) => j.bucket !== "unconfirmed");
  const loc = d.config.location.map((v) => LOCATION_OPTIONS.find(([id]) => id === v)?.[1] ?? v).join("、");
  $("#report-meta").textContent = `${r.date} ・ ${loc}`
    + (r.previousRunAt ? ` ・ 比對 ${r.previousRunAt.slice(0, 10)}` : " ・ 首次執行");

  root.replaceChildren(
    metricTiles(d),
    trend(d.history) ?? "",
    h("div", { class: "t-grid" },
      changesSection(r, byKey),
      reviewsSection(d, counted)),
    statusSection(r, counted),
    h("div", { class: "t-grid" },
      unconfirmedSection(r.jobs.filter((j) => j.bucket === "unconfirmed")),
      leadsSection(d)),
    notesSection(r.sourceNotes),
  );
}

async function load(): Promise<void> {
  const err = $("#load-error");
  try {
    const res = await fetch("/api/tracker");
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const d = (await res.json()) as TrackerDashboard;
    config = d.config;
    err.hidden = true;
    render(d);
  } catch (e: unknown) {
    err.textContent = `無法讀取追蹤資料：${e instanceof Error ? e.message : "未知錯誤"}`;
    err.hidden = false;
  }
}

// ---------- 追蹤條件表單 ----------

const form = {
  location: new Set<LocationScope>(),
  seniority: "any" as Seniority,
  keywords: new Set<KeywordGroup>(),
};

function chip(label: string, active: boolean, onClick: () => void): HTMLButtonElement {
  return h("button", {
    type: "button", class: active ? "chip is-active" : "chip", "aria-pressed": String(active), onclick: onClick,
  }, label);
}

function renderChips(): void {
  const toggle = <T>(set: Set<T>, v: T): void => {
    if (set.has(v)) set.delete(v);
    else set.add(v);
    renderChips();
  };
  $("#cfg-location").replaceChildren(...LOCATION_OPTIONS.map(([id, label]) =>
    chip(label, form.location.has(id), () => toggle(form.location, id))));
  $("#cfg-seniority").replaceChildren(...SENIORITY_OPTIONS.map(([id, label]) =>
    chip(label, form.seniority === id, () => { form.seniority = id; renderChips(); })));
  $("#cfg-keywords").replaceChildren(...KEYWORD_OPTIONS.map(([id, label]) =>
    chip(label, form.keywords.has(id), () => toggle(form.keywords, id))));
}

function csv(v: string): string[] {
  return v.split(/[,，、]/).map((s) => s.trim()).filter((s) => s !== "");
}

function openConfig(): void {
  if (!config) return;
  form.location = new Set(config.location);
  form.seniority = config.seniority;
  form.keywords = new Set(config.keywords);
  renderChips();
  $<HTMLInputElement>("#cfg-sites").value = config.sites.join(", ");
  $<HTMLInputElement>("#cfg-salary").value = config.minMonthlySalary === null ? "" : String(config.minMonthlySalary);
  $<HTMLInputElement>("#cfg-exclude").value = config.excludeCompanies.join(", ");
  $<HTMLTextAreaElement>("#cfg-notes").value = config.notes;
  const status = $("#cfg-status");
  status.textContent = "";
  status.classList.remove("is-error");
  $<HTMLDialogElement>("#config-dialog").showModal();
}

async function saveConfig(e: Event): Promise<void> {
  e.preventDefault();
  const status = $("#cfg-status");
  const salary = $<HTMLInputElement>("#cfg-salary").value.trim();
  const body = {
    location: [...form.location],
    seniority: form.seniority,
    keywords: [...form.keywords],
    sites: csv($<HTMLInputElement>("#cfg-sites").value),
    minMonthlySalary: salary === "" ? null : Number(salary),
    excludeCompanies: csv($<HTMLInputElement>("#cfg-exclude").value),
    notes: $<HTMLTextAreaElement>("#cfg-notes").value.trim(),
  };
  try {
    const res = await fetch("/api/tracker/config", {
      method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body),
    });
    const result = (await res.json()) as { config?: TrackerConfig; errors?: string[] };
    if (!res.ok || !result.config) throw new Error((result.errors ?? [`HTTP ${res.status}`]).join("；"));
    config = result.config;
    status.classList.remove("is-error");
    status.textContent = "已儲存，下次執行時套用";
  } catch (err: unknown) {
    status.classList.add("is-error");
    status.textContent = err instanceof Error ? err.message : "儲存失敗";
  }
}

$("#open-config").addEventListener("click", openConfig);
$("#config-close").addEventListener("click", () => $<HTMLDialogElement>("#config-dialog").close());
$("#config-form").addEventListener("submit", (e) => void saveConfig(e));
void load();
