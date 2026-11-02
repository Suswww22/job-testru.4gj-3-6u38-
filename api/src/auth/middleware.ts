// 驗證 access_token cookie，通過後把 userId 放到 req.userId，路由一律用它過濾資料。
// access token 過期時回 401，前端收到後呼叫 /api/auth/refresh 換新的再重試。

import type { RequestHandler } from "express";

import { HttpError } from "../errors.js";
import { ACCESS_COOKIE } from "./session.js";
import { verifyAccessToken } from "./token.js";

declare global {
  namespace Express {
    interface Request {
      userId?: string;
    }
  }
}

export const requireAuth: RequestHandler = (req, _res, next) => {
  const token: unknown = req.cookies?.[ACCESS_COOKIE];
  const userId = typeof token === "string" ? verifyAccessToken(token) : null;
  if (!userId) throw new HttpError(401, "請先登入");
  req.userId = userId;
  next();
};

/** 只能用在 requireAuth 之後的路由 */
export function userIdOf(req: { userId?: string }): string {
  if (!req.userId) throw new HttpError(401, "請先登入");
  return req.userId;
}
