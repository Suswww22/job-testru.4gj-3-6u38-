// 週報：
//   /api/digest/settings  設定（開關、關鍵字、地區）
//   /api/digests          自己的週報列表；POST 立即產生一份
//   /api/cron/weekly-digest  排程用（GitHub Actions 每週呼叫），用 CRON_SECRET 驗證，不吃登入 cookie

import { timingSafeEqual } from "node:crypto";

import { Router, type Request } from "express";
import rateLimit from "express-rate-limit";
import { z } from "zod";

import { REGIONS } from "../../../src/shared/data.js";
import type { RegionId } from "../../../src/shared/types.js";
import { requireAuth, userIdOf } from "../auth/middleware.js";
import { prisma } from "../db.js";
import { HttpError } from "../errors.js";
import { generateDigest } from "./generate.js";
import { mailEnabled } from "./mail.js";

const REGION_IDS = REGIONS.map((r) => r.id) as [RegionId, ...RegionId[]];
/** 排程重跑（手動重試、GitHub 延遲）時，6 天內已產生過的使用者跳過，不會一週收到兩份 */
const MIN_INTERVAL_MS = 6 * 24 * 60 * 60 * 1000;

const settingsSchema = z.object({
  enabled: z.boolean(),
  keywords: z.array(z.string().trim().min(1).max(30)).max(3),
  region: z.enum(REGION_IDS).nullable(),
  // 選填：沒帶就維持原本的設定
  email: z.boolean().optional(),
}).strict();

// ---------- 使用者自己的週報 ----------

// 掛在 /api/digest 與 /api/digests 兩個路徑，router.use(requireAuth) 只會攔到這兩個路徑底下的請求
export const digestSettingsRouter = Router();
digestSettingsRouter.use(requireAuth);
export const digestsRouter = Router();
digestsRouter.use(requireAuth);

/** mailAvailable：伺服器有沒有設定寄信，沒有的話前端把 Email 開關停用並說明 */
const view = (s: { enabled: boolean; keywords: string[]; region: string | null; email: boolean } | null) => ({
  ...(s ? { enabled: s.enabled, keywords: s.keywords, region: s.region, email: s.email } : { enabled: false, keywords: [] as string[], region: null, email: false }),
  mailAvailable: mailEnabled(),
});

digestSettingsRouter.get("/settings", async (req, res) => {
  const s = await prisma.digestSetting.findUnique({ where: { userId: userIdOf(req) } });
  res.json(view(s));
});

digestSettingsRouter.put("/settings", async (req, res) => {
  const data = settingsSchema.parse(req.body);
  const userId = userIdOf(req);
  const keywords = [...new Set(data.keywords)];
  const s = await prisma.digestSetting.upsert({
    where: { userId },
    create: { userId, ...data, keywords },
    update: { ...data, keywords },
  });
  res.json(view(s));
});

digestsRouter.get("/", async (req, res) => {
  const items = await prisma.digest.findMany({
    where: { userId: userIdOf(req) },
    orderBy: { createdAt: "desc" },
    take: 8,
  });
  res.json({ items });
});

// 立即產生會去抓外部網站，限制次數
const generateLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  limit: Number(process.env["DIGEST_LIMIT_PER_USER"] ?? 5),
  keyGenerator: (req) => userIdOf(req),
  standardHeaders: "draft-7",
  legacyHeaders: false,
  handler: (_req, res) => {
    res.status(429).json({ error: { message: "產生太頻繁，請一小時後再試" } });
  },
});

digestsRouter.post("/", generateLimiter, async (req, res) => {
  res.status(201).json(await generateDigest(userIdOf(req)));
});

// ---------- 排程 ----------

export const cronRouter = Router();

/** 比對 Authorization: Bearer <CRON_SECRET>；用固定時間比較，避免從回應時間猜出密鑰 */
function authorized(req: Request): boolean {
  const secret = process.env["CRON_SECRET"] ?? "";
  const given = req.get("authorization")?.replace(/^Bearer\s+/i, "") ?? "";
  const a = Buffer.from(given);
  const b = Buffer.from(secret);
  return a.length === b.length && timingSafeEqual(a, b);
}

cronRouter.post("/weekly-digest", async (req, res) => {
  if ((process.env["CRON_SECRET"] ?? "").length < 32) throw new HttpError(503, "排程未設定（CRON_SECRET 至少 32 字元）");
  if (!authorized(req)) throw new HttpError(401, "排程密鑰錯誤");

  const now = new Date();
  const users = await prisma.digestSetting.findMany({
    where: { enabled: true },
    select: { userId: true, user: { select: { digests: { orderBy: { createdAt: "desc" }, take: 1, select: { createdAt: true } } } } },
  });
  const result = { generated: 0, skipped: 0, failed: 0 };
  // 逐一產生：同時打太多外部請求對資料來源不禮貌，使用者也不多
  for (const u of users) {
    const last = u.user.digests[0]?.createdAt;
    if (last && now.getTime() - last.getTime() < MIN_INTERVAL_MS) {
      result.skipped++;
      continue;
    }
    try {
      await generateDigest(u.userId, now);
      result.generated++;
    } catch (err) {
      result.failed++;
      console.error(`[weekly-digest] ${u.userId} 失敗：`, err);
    }
  }
  res.json(result);
});
