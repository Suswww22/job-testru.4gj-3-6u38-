// 從外部求職網站搜尋職缺：/api/import/search。直接沿用 src/server/sources 的爬蟲轉接器（台灣就業通、Yourator）。
// 這支只回傳「預覽」，不寫入資料庫；使用者按「加入」時，前端把同一筆資料交給 POST /api/jobs，
// externalId（`${source}:編號`）的唯一限制會擋掉重複匯入。

import { Router } from "express";
import rateLimit from "express-rate-limit";
import { z } from "zod";

import { REGIONS } from "../../../src/shared/data.js";
import { filterJobs } from "../../../src/shared/matcher.js";
import type { Job, RegionId } from "../../../src/shared/types.js";
import { ADAPTERS } from "../../../src/server/sources/index.js";
import { requireAuth, userIdOf } from "../auth/middleware.js";
import { prisma } from "../db.js";
import { HttpError } from "../errors.js";

export const importRouter = Router();
importRouter.use(requireAuth);

const MAX_RESULTS = 50;
const REGION_IDS = REGIONS.map((r) => r.id) as [RegionId, ...RegionId[]];

const searchSchema = z.object({
  source: z.enum(["taiwanjobs", "yourator"]),
  keyword: z.string().trim().max(100).default(""),
  region: z.enum(REGION_IDS).optional(),
});

// 每次搜尋都會讓伺服器去抓外部網站；依帳號限制次數，避免平台被當成爬蟲中繼站
const searchLimiter = rateLimit({
  windowMs: 10 * 60 * 1000,
  limit: Number(process.env["IMPORT_LIMIT_PER_USER"] ?? 20),
  keyGenerator: (req) => userIdOf(req),
  standardHeaders: "draft-7",
  legacyHeaders: false,
  handler: (_req, res) => {
    res.status(429).json({ error: { message: "搜尋太頻繁，請 10 分鐘後再試" } });
  },
});

/** 爬蟲的 Job 轉成 POST /api/jobs 接受的欄位 */
function toJobInput(j: Job) {
  const description = [...j.duties, ...j.requirements.others].join("\n").slice(0, 20000);
  return {
    source: j.source,
    externalId: j.id,
    sourceUrl: j.sourceUrl,
    title: j.title.slice(0, 200),
    company: (j.company || "未提供").slice(0, 200),
    region: j.region,
    address: j.address.slice(0, 300),
    nature: j.nature,
    salaryKind: j.salary.kind,
    salaryMin: j.salary.min,
    // 少數來源的上限比下限小（多半是解析錯誤），只保留下限，避免匯入時被驗證擋下
    salaryMax: j.salary.max !== null && j.salary.min !== null && j.salary.max < j.salary.min ? null : j.salary.max,
    salaryNote: j.salary.note.slice(0, 300),
    skills: [...j.requirements.skills].slice(0, 50),
    tags: j.tags.filter((t) => t.trim() !== "").map((t) => t.slice(0, 50)).slice(0, 50),
    description,
    postedAt: /^\d{4}-\d{2}-\d{2}$/.test(j.postedAt) ? j.postedAt : null,
  };
}

importRouter.get("/search", searchLimiter, async (req, res) => {
  const { source, keyword, region } = searchSchema.parse(req.query);
  const adapter = ADAPTERS.get(source);
  if (!adapter) throw new HttpError(400, "不支援的來源");

  const query = { categoryId: null, subIds: new Set<string>(), regions: new Set(region ? [region] : []), keyword };
  let found: Job[];
  try {
    found = await adapter.search(query);
  } catch (err) {
    const reason = err instanceof Error ? err.message : "未知錯誤";
    throw new HttpError(502, `${source === "taiwanjobs" ? "台灣就業通" : "Yourator"}暫時無法連線：${reason}`);
  }
  // 來源本身不支援關鍵字時（台灣就業通），在這裡用標題、技能、內文過濾；地區兩邊都再過濾一次
  const matched = filterJobs(found, adapter.handlesKeyword ? { ...query, keyword: "" } : query);
  const jobs = matched.slice(0, MAX_RESULTS);

  const saved = await prisma.job.findMany({
    where: { userId: userIdOf(req), externalId: { in: jobs.map((j) => j.id) } },
    select: { externalId: true },
  });
  const savedIds = new Set(saved.map((s) => s.externalId));
  res.json({
    total: matched.length,
    items: jobs.map((j) => ({ ...toJobInput(j), saved: savedIds.has(j.id) })),
  });
});
