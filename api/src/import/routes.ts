// 從外部求職網站搜尋職缺：/api/import/search。直接沿用 src/server/sources 的爬蟲轉接器（台灣就業通、Yourator）。
// 這支只回傳「預覽」，不寫入資料庫；使用者按「加入」時，前端把同一筆資料交給 POST /api/jobs，
// externalId（`${source}:編號`）的唯一限制會擋掉重複匯入。

import { Router } from "express";
import rateLimit from "express-rate-limit";
import { z } from "zod";

import { REGIONS } from "../../../src/shared/data.js";
import { DISTRICTS, type CountyId } from "../../../src/shared/districts.js";
import type { RegionId } from "../../../src/shared/types.js";
import { requireAuth, userIdOf } from "../auth/middleware.js";
import { prisma } from "../db.js";
import { HttpError } from "../errors.js";
import { IMPORT_SOURCES, searchSource, toJobInput } from "./search.js";

export const importRouter = Router();
importRouter.use(requireAuth);

const MAX_RESULTS = 50;
const REGION_IDS = REGIONS.map((r) => r.id) as [RegionId, ...RegionId[]];
/** 鄉鎮市區以「縣市代號:區名」表示，例如 hsinchu:東區（新竹市與嘉義市都有東區） */
const DISTRICT_KEYS = new Set(Object.entries(DISTRICTS).flatMap(([region, list]) => list.map((d) => `${region}:${d.name}`)));

/** 逗號分隔的查詢參數 → 陣列 */
const csv = z.string().default("").transform((s) => s.split(",").map((x) => x.trim()).filter((x) => x !== ""));

const searchSchema = z.object({
  source: z.enum(IMPORT_SOURCES),
  keyword: z.string().trim().max(100).default(""),
  regions: csv.pipe(z.array(z.enum(REGION_IDS)).max(REGION_IDS.length)),
  districts: csv
    .pipe(z.array(z.string().refine((k) => DISTRICT_KEYS.has(k), "不認得的鄉鎮市區")).max(DISTRICT_KEYS.size))
    .transform((keys) => keys.map((k) => {
      const [region, name] = k.split(":") as [CountyId, string];
      return { region, name };
    })),
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

importRouter.get("/search", searchLimiter, async (req, res) => {
  const { source, keyword, regions, districts } = searchSchema.parse(req.query);
  let matched;
  try {
    matched = await searchSource(source, keyword, { regions, districts });
  } catch (err) {
    throw new HttpError(502, err instanceof Error ? err.message : "外部網站暫時無法連線");
  }
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
