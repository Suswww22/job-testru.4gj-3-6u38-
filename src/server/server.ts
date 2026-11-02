// 本機伺服器：提供網頁靜態檔，以及向各求職網站取資料的 API。
// 瀏覽器因為跨網域限制（CORS）無法直接抓別的網站，所以由這裡代為取得並統一格式。

import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { readFile } from "node:fs/promises";
import { extname, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

import { DEMO_JOBS, REGIONS, SOURCES } from "../shared/data.js";
import { filterJobs } from "../shared/matcher.js";
import type { Job, RegionId, SearchQuery, SearchResponse, SourceId } from "../shared/types.js";
import { ADAPTERS } from "./sources/index.js";
import { loadDashboard, saveConfig } from "./tracker/dashboard.js";

const PORT = Number(process.env["PORT"] ?? 8742);
const WWW = resolve(fileURLToPath(new URL("../../www", import.meta.url)));
const MAX_RESULTS = 400;

const MIME: Readonly<Record<string, string>> = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".ico": "image/x-icon",
};

const SOURCE_IDS = new Set<SourceId>(SOURCES.map((s) => s.id));
const REGION_IDS = new Set<RegionId>(REGIONS.map((r) => r.id));

function isSourceId(v: string): v is SourceId {
  return (SOURCE_IDS as ReadonlySet<string>).has(v);
}

function isRegionId(v: string): v is RegionId {
  return (REGION_IDS as ReadonlySet<string>).has(v);
}

function list(params: URLSearchParams, key: string): string[] {
  return (params.get(key) ?? "").split(",").map((s) => s.trim()).filter((s) => s !== "");
}

function sendJson(res: ServerResponse, status: number, body: unknown): void {
  res.writeHead(status, { "Content-Type": MIME[".json"], "Cache-Control": "no-store" });
  res.end(JSON.stringify(body));
}

function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : "未知錯誤";
}

async function handleSearch(params: URLSearchParams, res: ServerResponse): Promise<void> {
  const query: SearchQuery = {
    categoryId: params.get("cat") || null,
    subIds: new Set(list(params, "subs")),
    regions: new Set(list(params, "regions").filter(isRegionId)),
    keyword: (params.get("q") ?? "").slice(0, 100),
  };
  const sources = list(params, "sources").filter(isSourceId);

  const tasks = sources.map(async (id): Promise<Job[]> => {
    if (id === "demo") return filterJobs(DEMO_JOBS, query);
    const adapter = ADAPTERS.get(id);
    if (!adapter) return [];
    const found = await adapter.search(query);
    return filterJobs(found, adapter.handlesKeyword ? { ...query, keyword: "" } : query);
  });
  const settled = await Promise.allSettled(tasks);

  const perSource: Job[][] = [];
  const errors: { source: SourceId; message: string }[] = [];
  settled.forEach((s, i) => {
    const source = sources[i];
    if (source === undefined) return;
    if (s.status === "fulfilled") perSource.push(s.value);
    else errors.push({ source, message: errorMessage(s.reason) });
  });

  const body: SearchResponse = { jobs: interleave(perSource, MAX_RESULTS), errors };
  sendJson(res, 200, body);
}

/** 各來源輪流取一筆，避免職缺量大的來源把其他來源擠出上限 */
function interleave(lists: readonly (readonly Job[])[], limit: number): Job[] {
  const out: Job[] = [];
  for (let i = 0; out.length < limit && lists.some((l) => i < l.length); i++) {
    for (const l of lists) {
      const job = l[i];
      if (job !== undefined && out.length < limit) out.push(job);
    }
  }
  return out;
}

async function handleDetail(params: URLSearchParams, res: ServerResponse): Promise<void> {
  const source = params.get("source") ?? "";
  const url = params.get("url") ?? "";
  const adapter = isSourceId(source) ? ADAPTERS.get(source) : undefined;
  if (!adapter?.detail || !adapter.acceptsUrl?.(url)) {
    sendJson(res, 400, { message: "不支援的來源或網址" });
    return;
  }
  try {
    sendJson(res, 200, await adapter.detail(url));
  } catch (err: unknown) {
    sendJson(res, 502, { message: errorMessage(err) });
  }
}

async function serveStatic(pathname: string, res: ServerResponse): Promise<void> {
  const file = resolve(WWW, `.${decodeURIComponent(pathname === "/" ? "/index.html" : pathname)}`);
  // 防止 ../ 跳出網站資料夾
  if (file !== WWW && !file.startsWith(WWW + sep)) {
    res.writeHead(403).end();
    return;
  }
  try {
    const data = await readFile(file);
    res.writeHead(200, { "Content-Type": MIME[extname(file)] ?? "application/octet-stream" });
    res.end(data);
  } catch {
    res.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" }).end("找不到檔案");
  }
}

const MAX_BODY = 16 * 1024;

async function readBody(req: IncomingMessage): Promise<unknown> {
  let size = 0;
  const chunks: Buffer[] = [];
  for await (const chunk of req as AsyncIterable<Buffer>) {
    size += chunk.length;
    if (size > MAX_BODY) throw new Error("內容過大");
    chunks.push(chunk);
  }
  return JSON.parse(Buffer.concat(chunks).toString("utf8")) as unknown;
}

async function handleSaveConfig(req: IncomingMessage, res: ServerResponse): Promise<void> {
  // 只收 application/json：其他網站的網頁無法不經 CORS 預檢就送出這種請求，避免被跨站改設定
  if (!req.headers["content-type"]?.startsWith("application/json")) {
    sendJson(res, 415, { errors: ["只接受 application/json"] });
    return;
  }
  let body: unknown;
  try {
    body = await readBody(req);
  } catch (err: unknown) {
    sendJson(res, 400, { errors: [errorMessage(err)] });
    return;
  }
  const result = await saveConfig(body);
  sendJson(res, "errors" in result ? 400 : 200, result);
}

async function route(req: IncomingMessage, res: ServerResponse): Promise<void> {
  const url = new URL(req.url ?? "/", "http://localhost");
  if (req.method === "POST" && url.pathname === "/api/tracker/config") return handleSaveConfig(req, res);
  if (req.method !== "GET") {
    res.writeHead(405).end();
    return;
  }
  switch (url.pathname) {
    case "/api/sources": return sendJson(res, 200, SOURCES);
    case "/api/jobs": return handleSearch(url.searchParams, res);
    case "/api/job": return handleDetail(url.searchParams, res);
    case "/api/tracker": return sendJson(res, 200, await loadDashboard());
    default: return serveStatic(url.pathname, res);
  }
}

createServer((req, res) => {
  route(req, res).catch((err: unknown) => {
    console.error(err);
    if (!res.headersSent) sendJson(res, 500, { message: "伺服器錯誤" });
  });
}).listen(PORT, "127.0.0.1", () => {
  console.log(`職缺雷達已啟動：http://localhost:${PORT}`);
});
