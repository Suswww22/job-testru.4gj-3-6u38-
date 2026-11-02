// 工程師求職 Agent 頁面：組條件 → 呼叫 /api/agent → 列出職缺，展開看薪資福利、經驗、評價連結與條件變動。

import { COUNTIES, LEVELS, REMOTE, ROLES, type AgentJob, type AgentResponse, type Level, type RoleId } from "../shared/agent.js";
import { formatSalary, monthlyMin } from "../shared/matcher.js";
import { $, h } from "./dom.js";

const state = {
  roles: new Set<RoleId>(),
  counties: new Set<string>(),
  levels: new Set<Level>(),
  results: [] as readonly AgentJob[],
};

function chip<T>(label: string, set: Set<T>, value: T, title?: string): HTMLButtonElement {
  const b = h("button", { type: "button", class: "chip", "aria-pressed": "false", title }, label);
  b.addEventListener("click", () => {
    if (set.has(value)) set.delete(value);
    else set.add(value);
    b.classList.toggle("is-active", set.has(value));
    b.setAttribute("aria-pressed", String(set.has(value)));
  });
  return b;
}

$("#role-chips").append(...ROLES.map((r) => chip(r.name, state.roles, r.id)));
$("#level-chips").append(...LEVELS.map((l) => chip(`${l.name}・${l.hint}`, state.levels, l.id)));

const areas = [...new Set(COUNTIES.map((c) => c.area))];
$("#county-groups").append(
  ...areas.map((area) => h("div", { class: "county-group" },
    h("span", { class: "county-group__name" }, area),
    h("div", { class: "chips" }, ...COUNTIES.filter((c) => c.area === area).map((c) => chip(c.name, state.counties, c.name))))),
  h("div", { class: "county-group" },
    h("span", { class: "county-group__name" }, "其他"),
    h("div", { class: "chips" }, chip(REMOTE, state.counties, REMOTE))),
);

// ---------- 卡片 ----------

const roleName = (id: RoleId): string => ROLES.find((r) => r.id === id)?.name ?? id;
const levelName = (l: AgentJob["level"]): string =>
  l === "unknown" ? "資歷未標明" : LEVELS.find((x) => x.id === l)?.name ?? l;

function reviewLinks(company: string): HTMLElement {
  const q = encodeURIComponent(company.replace(/股份有限公司|有限公司/g, "").trim() || company);
  const links: readonly (readonly [string, string])[] = [
    ["求職天眼通", `https://www.qollie.com/search?keyword=${q}&kind=company`],
    ["GoodJob 職場透明化", `https://www.goodjob.life/search?q=${q}`],
    ["面試趣", `https://interview.tw/search?q=${q}`],
  ];
  return h("div", { class: "agent-links" },
    ...links.map(([name, url]) => h("a", { href: url, target: "_blank", rel: "noopener noreferrer" }, name)));
}

function changesBlock(a: AgentJob): HTMLElement {
  if (a.changes.length === 0) {
    return h("p", { class: "muted" }, `自 ${a.firstSeen} 起未偵測到變動`);
  }
  return h("ul", { class: "changes" }, ...[...a.changes].reverse().map((c) =>
    h("li", {},
      h("span", { class: "changes__head" }, `${c.date}・${c.field}`),
      h("del", {}, c.before || "（空白）"),
      h("ins", {}, c.after || "（空白）"))));
}

function section(title: string, ...body: (Node | string)[]): HTMLElement {
  return h("div", { class: "agent-sec" }, h("h4", {}, title), ...body);
}

function card(a: AgentJob, today: string): HTMLElement {
  const j = a.job;
  const exp = j.requirements.minYears > 0 ? `${j.requirements.minYears} 年以上` : "經驗不拘";
  const welfare = [...j.salary.perks, ...j.otherBenefits];
  const status = a.changes.length > 0
    ? h("span", { class: "tag tag--miss" }, `條件更動 ${a.changes.length} 項`)
    : a.firstSeen === today ? h("span", { class: "tag tag--ok" }, "本次新發現") : null;

  return h("details", { class: "job-card agent-card" },
    h("summary", {},
      h("div", { class: "job-card__main" },
        h("h3", {}, j.title),
        h("p", { class: "job-card__company" }, j.company),
        h("p", { class: "job-card__meta" },
          h("span", {}, a.county || j.address || "地點未提供"),
          h("span", {}, exp),
          h("span", {}, levelName(a.level)),
          h("span", {}, j.source === "yourator" ? "Yourator" : "台灣就業通")),
        h("p", { class: "job-card__salary" }, formatSalary(j)),
        h("div", { class: "tags" },
          ...a.roles.map((r) => h("span", { class: "tag tag--primary" }, roleName(r))), status))),
    h("div", { class: "agent-detail" },
      section("薪資福利",
        h("p", {}, j.salary.note || formatSalary(j)),
        welfare.length > 0
          ? h("ul", {}, ...welfare.map((w) => h("li", {}, w)))
          : h("p", { class: "muted" }, j.detailLoaded ? "職缺內文未列出福利" : "只取得摘要，福利未知")),
      section("工作經驗",
        h("p", {}, exp),
        ...j.requirements.others.map((o) => h("p", { class: "muted" }, o))),
      section("工作內容",
        j.duties.length > 0
          ? h("ul", {}, ...j.duties.slice(0, 8).map((d) => h("li", {}, d)))
          : h("p", { class: "muted" }, "未提供")),
      section("入職／離職員工評價",
        h("p", { class: "muted" }, "自動抓取不到合法公開的評價資料，點下列網站查詢："),
        reviewLinks(j.company)),
      section("條件變動", changesBlock(a)),
      j.sourceUrl ? h("a", { class: "btn", href: j.sourceUrl, target: "_blank", rel: "noopener noreferrer" }, "查看原始職缺") : ""));
}

// ---------- 搜尋與排序 ----------

function sorted(list: readonly AgentJob[], key: string): AgentJob[] {
  const by: Record<string, (a: AgentJob, b: AgentJob) => number> = {
    changed: (a, b) => b.changes.length - a.changes.length || b.job.postedAt.localeCompare(a.job.postedAt),
    latest: (a, b) => b.job.postedAt.localeCompare(a.job.postedAt),
    salary: (a, b) => monthlyMin(b.job) - monthlyMin(a.job),
  };
  return [...list].sort(by[key] ?? by["changed"]);
}

function render(): void {
  const today = new Date().toLocaleDateString("sv-SE", { timeZone: "Asia/Taipei" });
  const list = sorted(state.results, $<HTMLSelectElement>("#sort-select").value);
  const changed = list.filter((a) => a.changes.length > 0).length;
  $("#result-count").textContent = `共 ${list.length} 筆${changed > 0 ? `，${changed} 筆條件有更動` : ""}`;
  $("#job-list").replaceChildren(...(list.length > 0
    ? list.map((a) => card(a, today))
    : [h("p", { class: "empty" }, "沒有符合條件的職缺，試著放寬地區或資歷")]));
}

async function run(): Promise<void> {
  const btn = $<HTMLButtonElement>("#agent-run");
  const params = new URLSearchParams({
    roles: [...state.roles].join(","),
    counties: [...state.counties].join(","),
    levels: [...state.levels].join(","),
    q: $<HTMLInputElement>("#keyword").value.trim(),
  });
  btn.disabled = true;
  btn.textContent = state.counties.size === 0 ? "搜尋全台中…" : "搜尋中…";
  $("#results").hidden = false;
  $("#result-count").textContent = "正在向求職網站取資料";
  $("#job-list").replaceChildren();
  $("#agent-notes").replaceChildren();
  try {
    const res = await fetch(`/api/agent?${params}`);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = (await res.json()) as AgentResponse;
    state.results = data.jobs;
    $("#agent-notes").replaceChildren(...data.notes.map((n) => h("li", {}, n)));
    render();
  } catch (err: unknown) {
    $("#result-count").textContent = `搜尋失敗：${err instanceof Error ? err.message : "未知錯誤"}`;
  } finally {
    btn.disabled = false;
    btn.textContent = "開始搜尋";
  }
}

$("#agent-form").addEventListener("submit", (e) => {
  e.preventDefault();
  void run();
});
$("#sort-select").addEventListener("change", render);
