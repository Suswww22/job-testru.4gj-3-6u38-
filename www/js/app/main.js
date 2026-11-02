// 進入點：管理畫面狀態，向本機伺服器取職缺，並渲染到頁面上。
import { CATEGORIES, REGIONS, SOURCES } from "../shared/data.js";
import { averageRating, formatSalary, matchJob, parseResume, sortResults, } from "../shared/matcher.js";
import { $, h } from "./dom.js";
import { readResumeFile } from "./resumeReader.js";
const state = {
    sources: new Set(["taiwanjobs", "yourator"]),
    categoryId: null,
    subIds: new Set(),
    regions: new Set(),
    keyword: "",
    sort: "latest",
    searched: false,
    loading: false,
    jobs: [],
    errors: [],
    profile: null,
    matches: new Map(),
};
const regionName = new Map(REGIONS.map((r) => [r.id, r.name]));
const subName = new Map(CATEGORIES.flatMap((c) => c.subs).map((s) => [s.id, s.name]));
const sourceName = new Map(SOURCES.map((s) => [s.id, s.name]));
// ---------- 共用小元件 ----------
function stars(rating) {
    const full = Math.round(rating);
    return "★".repeat(full) + "☆".repeat(5 - full);
}
function chip(label, active, onClick) {
    return h("button", {
        type: "button",
        class: active ? "chip is-active" : "chip",
        "aria-pressed": String(active),
        onclick: onClick,
    }, label);
}
function scoreClass(score) {
    if (score >= 75)
        return "score score--high";
    if (score >= 50)
        return "score score--mid";
    return "score score--low";
}
function toggle(set, value) {
    if (set.has(value))
        set.delete(value);
    else
        set.add(value);
}
// ---------- 搜尋條件 ----------
function renderFilters() {
    $("#source-chips").replaceChildren(...SOURCES.map((s) => chip(s.name, state.sources.has(s.id), () => {
        toggle(state.sources, s.id);
        onFilterChange();
    })));
    $("#cat-chips").replaceChildren(chip("全部", state.categoryId === null, () => selectCategory(null)), ...CATEGORIES.map((c) => chip(c.name, state.categoryId === c.id, () => selectCategory(c.id))));
    const cat = CATEGORIES.find((c) => c.id === state.categoryId);
    $("#sub-row").hidden = !cat;
    $("#sub-chips").replaceChildren(...(cat?.subs ?? []).map((s) => chip(s.name, state.subIds.has(s.id), () => {
        toggle(state.subIds, s.id);
        onFilterChange();
    })));
    $("#region-chips").replaceChildren(...REGIONS.map((r) => chip(r.name, state.regions.has(r.id), () => {
        toggle(state.regions, r.id);
        onFilterChange();
    })));
}
function selectCategory(id) {
    state.categoryId = id;
    state.subIds.clear();
    onFilterChange();
}
let refetchTimer;
function onFilterChange() {
    renderFilters();
    if (!state.searched)
        return;
    // 連續點選時只送最後一次請求
    window.clearTimeout(refetchTimer);
    refetchTimer = window.setTimeout(() => void search(), 350);
}
// ---------- 取資料 ----------
function isSearchResponse(v) {
    return typeof v === "object" && v !== null
        && Array.isArray(v.jobs)
        && Array.isArray(v.errors);
}
let searchSeq = 0;
async function search() {
    const seq = ++searchSeq;
    state.searched = true;
    state.loading = true;
    renderResults();
    const params = new URLSearchParams({
        sources: [...state.sources].join(","),
        regions: [...state.regions].join(","),
        subs: [...state.subIds].join(","),
        q: state.keyword,
    });
    if (state.categoryId !== null)
        params.set("cat", state.categoryId);
    try {
        const res = await fetch(`/api/jobs?${params}`);
        const data = await res.json();
        if (!res.ok || !isSearchResponse(data))
            throw new Error("伺服器回應格式錯誤");
        if (seq !== searchSeq)
            return; // 已有更新的搜尋
        state.jobs = [...data.jobs];
        state.errors = data.errors;
    }
    catch (err) {
        if (seq !== searchSeq)
            return;
        state.jobs = [];
        state.errors = [...state.sources].map((source) => ({
            source,
            message: err instanceof Error ? err.message : "連線失敗",
        }));
    }
    state.loading = false;
    recomputeMatches();
    renderResults();
}
async function loadDetail(job) {
    if (job.detailLoaded || job.sourceUrl === null)
        return job;
    const params = new URLSearchParams({ source: job.source, url: job.sourceUrl });
    const res = await fetch(`/api/job?${params}`);
    const data = await res.json();
    if (!res.ok) {
        const msg = typeof data === "object" && data !== null && "message" in data ? String(data.message) : "讀取失敗";
        throw new Error(msg);
    }
    const full = data;
    // 詳情頁沒有的欄位（如標籤）沿用列表摘要
    const merged = { ...full, tags: full.tags.length > 0 ? full.tags : job.tags };
    state.jobs = state.jobs.map((j) => (j.id === job.id ? merged : j));
    if (state.profile)
        state.matches.set(merged.id, matchJob(merged, state.profile));
    return merged;
}
// ---------- 結果列表 ----------
function renderResults() {
    $("#results").hidden = false;
    const list = $("#job-list");
    const notice = $("#source-errors");
    notice.replaceChildren(...state.errors.map((e) => h("p", {}, `${sourceName.get(e.source) ?? e.source}：${e.message}`)));
    notice.hidden = state.errors.length === 0;
    if (state.loading) {
        $("#result-count").textContent = "搜尋中…";
        list.replaceChildren(h("p", { class: "empty" }, "正在向各求職網站取得職缺…"));
        return;
    }
    const sorted = sortResults(state.jobs, state.sort, state.matches);
    $("#result-count").textContent = `共 ${sorted.length} 筆職缺`;
    if (sorted.length === 0) {
        list.replaceChildren(h("p", { class: "empty" }, "沒有符合條件的職缺，試著放寬地區、移除關鍵字或多選幾個來源。"));
        return;
    }
    list.replaceChildren(...sorted.map(jobCard));
}
function jobCard(job) {
    const rating = averageRating(job);
    const match = state.matches.get(job.id);
    const years = job.requirements.minYears;
    return h("article", { class: "job-card" }, h("button", { type: "button", class: "job-card__hit", "aria-label": `查看 ${job.title}`, onclick: () => void openDetail(job) }), h("div", { class: "job-card__main" }, h("h3", {}, job.title), h("p", { class: "job-card__company" }, job.company, rating !== null && h("span", { class: "rating" }, ` ${stars(rating)} ${rating}`)), h("p", { class: "job-card__meta" }, h("span", { class: `source source--${job.source}` }, sourceName.get(job.source) ?? job.source), h("span", {}, job.address || (job.region ? regionName.get(job.region) : "") || "地點未提供"), job.nature !== "其他" && h("span", {}, job.nature), job.shift !== "未提供" && h("span", {}, job.shift), job.detailLoaded && h("span", {}, years === 0 ? "經驗不拘" : `${years} 年以上`), job.postedAt !== "" && h("span", {}, `${job.postedAt} 更新`)), h("p", { class: "job-card__salary" }, formatSalary(job)), h("div", { class: "tags" }, job.tags.slice(0, 5).map((t) => h("span", { class: "tag" }, t)))), match && h("div", { class: scoreClass(match.score), title: "AI 匹配度" }, h("strong", {}, match.score), h("small", {}, "匹配度")));
}
// ---------- 職缺詳情 ----------
function section(title, ...body) {
    return h("section", { class: "detail-section" }, h("h3", {}, title), ...body);
}
function infoGrid(rows) {
    return h("dl", { class: "info-grid" }, rows.flatMap(([k, v]) => [h("dt", {}, k), h("dd", {}, v)]));
}
function bulletList(items, empty = "來源未提供") {
    if (items.length === 0)
        return h("p", { class: "muted" }, empty);
    return h("ul", { class: "bullets" }, items.map((i) => h("li", {}, i)));
}
const REVIEW_FILTERS = ["全部", "新進", "離職", "資深"];
function reviewCard(r) {
    return h("article", { class: `review review--${r.type}` }, h("header", {}, h("span", { class: "review__badge" }, r.type === "新進" ? "最近入職" : r.type === "離職" ? "最近離職" : "資深員工"), h("span", { class: "muted" }, r.tenure), h("span", { class: "rating" }, stars(r.rating)), h("time", { class: "muted", datetime: r.date }, r.date)), h("p", {}, h("b", {}, "優點　"), r.pros), h("p", {}, h("b", {}, "缺點　"), r.cons));
}
function reviewsBlock(job) {
    if (job.reviews.length === 0) {
        return section("員工評價", h("p", { class: "muted" }, "此來源沒有員工評價資料。"));
    }
    const sorted = [...job.reviews].sort((a, b) => Date.parse(b.date) - Date.parse(a.date));
    const listEl = h("div", { class: "reviews" });
    const tabs = h("div", { class: "chips", role: "tablist" });
    const show = (filter) => {
        const items = filter === "全部" ? sorted : sorted.filter((r) => r.type === filter);
        listEl.replaceChildren(...(items.length > 0
            ? items.map(reviewCard)
            : [h("p", { class: "empty" }, "目前沒有這類評價。")]));
        tabs.replaceChildren(...REVIEW_FILTERS.map((f) => {
            const count = f === "全部" ? sorted.length : sorted.filter((r) => r.type === f).length;
            return chip(`${f} ${count}`, f === filter, () => show(f));
        }));
    };
    show("全部");
    const avg = averageRating(job);
    return section("員工評價", avg !== null && h("p", { class: "review-summary" }, h("span", { class: "review-summary__num" }, avg.toFixed(1)), h("span", { class: "rating" }, stars(avg))), tabs, listEl);
}
function matchBlock(m) {
    return section("AI 匹配分析", h("div", { class: "match-box" }, h("div", { class: scoreClass(m.score) }, h("strong", {}, m.score), h("small", {}, "匹配度")), h("div", {}, m.reasons.length > 0 && bulletList(m.reasons), m.matchedSkills.length > 0 && h("div", { class: "tags" }, m.matchedSkills.map((s) => h("span", { class: "tag tag--ok" }, `✓ ${s}`))), m.missingSkills.length > 0 && h("div", { class: "tags" }, m.missingSkills.map((s) => h("span", { class: "tag tag--miss" }, `待補強 ${s}`))))));
}
function detailHead(job) {
    return h("header", { class: "detail-head" }, h("p", { class: "muted" }, h("span", { class: `source source--${job.source}` }, sourceName.get(job.source) ?? job.source), job.postedAt !== "" ? `　${job.postedAt} 更新` : ""), h("h2", { id: "dialog-title" }, job.title), h("p", { class: "detail-head__company" }, job.company), job.companyIntro !== "" && h("p", { class: "muted" }, job.companyIntro), h("p", { class: "detail-head__salary" }, formatSalary(job)), job.sourceUrl !== null && h("a", {
        class: "btn btn--primary detail-head__link", href: job.sourceUrl, target: "_blank", rel: "noopener noreferrer",
    }, "前往原始職缺應徵 ↗"));
}
function renderDetail(job, error) {
    const req = job.requirements;
    const match = state.matches.get(job.id);
    const subLabel = job.subId !== null ? subName.get(job.subId) : undefined;
    $("#dialog-body").replaceChildren(detailHead(job), error !== null ? h("p", { class: "status is-error" }, `無法載入完整內容：${error}`) : "", match !== undefined ? matchBlock(match) : "", section("工作內容", bulletList(job.duties, "列表未附內文，請點「前往原始職缺」查看。")), section("條件要求", infoGrid([
        ["工作經歷", req.minYears === 0 ? "不拘" : `${req.minYears} 年以上`],
        ["學歷要求", req.education === "不拘" ? "不拘" : `${req.education}以上`],
        ["擅長工具", req.skills.length > 0 ? req.skills.join("、") : "未偵測到"],
    ]), req.others.length > 0 ? bulletList(req.others) : ""), section("職務類別", h("div", { class: "tags" }, subLabel !== undefined && h("span", { class: "tag tag--primary" }, subLabel), job.tags.map((t) => h("span", { class: "tag" }, t)))), section("薪資福利", h("p", { class: "detail-head__salary" }, formatSalary(job)), bulletList(job.salary.perks)), section("工作條件", infoGrid([
        ["工作性質", job.nature === "其他" ? "來源未提供" : job.nature],
        ["上班時段", [job.shift === "未提供" ? "" : job.shift, job.hours].filter((s) => s !== "").join("｜") || "來源未提供"],
        ["上班地點", job.address || "來源未提供"],
        ["休假制度", job.leave ?? "來源未提供"],
    ])), section("其他福利", bulletList(job.otherBenefits)), reviewsBlock(job));
}
async function openDetail(job) {
    const dialog = $("#job-dialog");
    renderDetail(job, null);
    if (!dialog.open)
        dialog.showModal();
    $("#dialog-body").scrollTop = 0;
    if (job.detailLoaded)
        return;
    $("#dialog-body").prepend(h("p", { class: "status", id: "detail-loading" }, "正在讀取完整職缺內容…"));
    try {
        const full = await loadDetail(job);
        if (dialog.open)
            renderDetail(full, null);
        renderResults();
    }
    catch (err) {
        if (dialog.open)
            renderDetail(job, err instanceof Error ? err.message : "讀取失敗");
    }
}
// ---------- 履歷匹配 ----------
function renderProfile(p) {
    const row = (label, values) => h("div", { class: "profile-row" }, h("span", { class: "profile-row__label" }, label), values.length > 0
        ? h("div", { class: "tags" }, values.map((v) => h("span", { class: "tag" }, v)))
        : h("span", { class: "muted" }, "未偵測到"));
    $("#resume-profile").replaceChildren(row("技能", p.skills), row("年資", p.years === null ? [] : [`${p.years} 年`]), row("學歷", p.education === null ? [] : [p.education]), row("地區", p.regions.map((r) => regionName.get(r) ?? r)), row("相關職務", p.subIds.map((s) => subName.get(s) ?? s)));
    $("#resume-profile").hidden = false;
    $("#resume-clear").hidden = false;
}
function setStatus(msg, isError = false) {
    const el = $("#resume-status");
    el.textContent = msg;
    el.classList.toggle("is-error", isError);
}
function recomputeMatches() {
    const p = state.profile;
    state.matches = p ? new Map(state.jobs.map((j) => [j.id, matchJob(j, p)])) : new Map();
}
async function runMatch(text) {
    if (text.trim().length < 20) {
        setStatus("履歷內容太少，請上傳檔案或貼上至少幾行經歷。", true);
        return;
    }
    const profile = parseResume(text);
    state.profile = profile;
    state.sort = "match";
    const sortSel = $("#sort-select");
    $('option[value="match"]', sortSel).disabled = false;
    sortSel.value = "match";
    renderProfile(profile);
    // 履歷裡有地區偏好、且使用者還沒選地區時，直接帶入
    if (state.regions.size === 0)
        profile.regions.forEach((r) => state.regions.add(r));
    renderFilters();
    setStatus("正在搜尋並比對職缺…");
    await search();
    const top = [...state.matches.values()].sort((a, b) => b.score - a.score)[0];
    setStatus(top
        ? `分析完成，最適合你的是「${top.job.company}｜${top.job.title}」（${top.score} 分）`
        : "分析完成，但目前條件下沒有職缺");
    $("#results").scrollIntoView({ behavior: "smooth", block: "start" });
}
function clearResume() {
    state.profile = null;
    state.matches.clear();
    if (state.sort === "match")
        state.sort = "latest";
    const sortSel = $("#sort-select");
    sortSel.value = state.sort;
    $('option[value="match"]', sortSel).disabled = true;
    $("#resume-text").value = "";
    $("#resume-file").value = "";
    $("#resume-profile").hidden = true;
    $("#resume-clear").hidden = true;
    setStatus("");
    if (state.searched)
        renderResults();
}
async function handleFile(file) {
    setStatus(`正在讀取 ${file.name}…`);
    try {
        const text = await readResumeFile(file);
        $("#resume-text").value = text;
        await runMatch(text);
    }
    catch (err) {
        setStatus(err instanceof Error ? err.message : "讀取失敗", true);
    }
}
// ---------- 事件綁定 ----------
function isSortKey(v) {
    return v === "match" || v === "latest" || v === "salary" || v === "rating";
}
function bind() {
    $("#search-form").addEventListener("submit", (e) => {
        e.preventDefault();
        state.keyword = $("#keyword").value;
        void search().then(() => $("#results").scrollIntoView({ behavior: "smooth", block: "start" }));
    });
    $("#sort-select").addEventListener("change", (e) => {
        const v = e.currentTarget.value;
        if (isSortKey(v)) {
            state.sort = v;
            renderResults();
        }
    });
    const fileInput = $("#resume-file");
    fileInput.addEventListener("change", () => {
        const f = fileInput.files?.[0];
        if (f)
            void handleFile(f);
    });
    const drop = $("#resume-drop");
    drop.addEventListener("dragover", (e) => { e.preventDefault(); drop.classList.add("is-over"); });
    drop.addEventListener("dragleave", () => drop.classList.remove("is-over"));
    drop.addEventListener("drop", (e) => {
        e.preventDefault();
        drop.classList.remove("is-over");
        const f = e.dataTransfer?.files[0];
        if (f)
            void handleFile(f);
    });
    $("#resume-run").addEventListener("click", () => void runMatch($("#resume-text").value));
    $("#resume-clear").addEventListener("click", clearResume);
    const dialog = $("#job-dialog");
    $("#dialog-close").addEventListener("click", () => dialog.close());
    // 點背景遮罩關閉
    dialog.addEventListener("click", (e) => { if (e.target === dialog)
        dialog.close(); });
}
renderFilters();
bind();
