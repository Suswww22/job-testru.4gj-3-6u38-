// 防暴力破解。存在記憶體裡，重啟就歸零；之後如果開多台 API，要換成 Redis 之類的共用 store。
// 上限可用環境變數調整，測試時不用等 15 分鐘。

import type { Request } from "express";
import { rateLimit, type Options } from "express-rate-limit";

const FIFTEEN_MIN = 15 * 60 * 1000;
const ONE_HOUR = 60 * 60 * 1000;

const envInt = (name: string, fallback: number) => {
  const n = Number(process.env[name]);
  return Number.isInteger(n) && n > 0 ? n : fallback;
};

const common: Partial<Options> = {
  standardHeaders: "draft-7", // 回 RateLimit 與 Retry-After 標頭
  legacyHeaders: false,
  handler: (_req, res, _next, options) => {
    res.status(options.statusCode).json({ error: { message: "嘗試次數過多，請稍後再試" } });
  },
};

/** 同一個 IP 的登入請求（不論成功失敗） */
export const loginIpLimiter = rateLimit({
  ...common,
  windowMs: FIFTEEN_MIN,
  limit: envInt("LOGIN_LIMIT_PER_IP", 50),
});

/** 同一個 email 連續失敗：猜某個帳號的密碼時，就算換 IP 也擋得住；登入成功不計 */
export const loginEmailLimiter = rateLimit({
  ...common,
  windowMs: FIFTEEN_MIN,
  limit: envInt("LOGIN_FAILURES_PER_EMAIL", 5),
  skipSuccessfulRequests: true,
  keyGenerator: (req: Request) => {
    const email: unknown = req.body?.email;
    return `email:${typeof email === "string" ? email.trim().toLowerCase() : ""}`;
  },
});

/** 同一個 IP 註冊帳號 */
export const registerLimiter = rateLimit({
  ...common,
  windowMs: ONE_HOUR,
  limit: envInt("REGISTER_LIMIT_PER_IP", 20),
});
