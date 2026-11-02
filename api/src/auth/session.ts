// 登入階段：access token 與 refresh token 都放在 httpOnly cookie，前端 JS 讀不到，XSS 偷不走。
// SameSite=Strict 讓別的網站發出的請求不會帶上 cookie，藉此擋 CSRF。
//
// refresh token 是隨機字串，資料庫只存 SHA-256；每次 /refresh 都作廢舊的、發新的（輪替）。
// 已作廢的 token 又被拿來用，代表有人拿到舊 token，整個 family（同一次登入衍生的所有 token）一起作廢。

import { createHash, randomBytes, randomUUID } from "node:crypto";

import type { CookieOptions, Request, Response } from "express";

import { prisma } from "../db.js";
import { HttpError } from "../errors.js";
import { ACCESS_TTL_SECONDS, signAccessToken } from "./token.js";

export const ACCESS_COOKIE = "access_token";
const REFRESH_COOKIE = "refresh_token";
const REFRESH_TTL_MS = 30 * 24 * 60 * 60 * 1000;

function cookieOptions(path: string): CookieOptions {
  return { httpOnly: true, secure: process.env["NODE_ENV"] === "production", sameSite: "strict", path };
}
// refresh cookie 只送到 /api/auth，一般 API 請求不會帶著它到處跑
const ACCESS_PATH = "/api";
const REFRESH_PATH = "/api/auth";

const sha256 = (s: string) => createHash("sha256").update(s).digest("hex");

/** 發一組新的 access + refresh token；familyId 沿用表示是同一次登入的輪替 */
export async function startSession(res: Response, userId: string, familyId: string = randomUUID()): Promise<void> {
  const raw = randomBytes(32).toString("base64url");
  await prisma.refreshToken.create({
    data: { userId, familyId, tokenHash: sha256(raw), expiresAt: new Date(Date.now() + REFRESH_TTL_MS) },
  });
  res.cookie(ACCESS_COOKIE, signAccessToken(userId), { ...cookieOptions(ACCESS_PATH), maxAge: ACCESS_TTL_SECONDS * 1000 });
  res.cookie(REFRESH_COOKIE, raw, { ...cookieOptions(REFRESH_PATH), maxAge: REFRESH_TTL_MS });
}

export function clearSession(res: Response): void {
  res.clearCookie(ACCESS_COOKIE, cookieOptions(ACCESS_PATH));
  res.clearCookie(REFRESH_COOKIE, cookieOptions(REFRESH_PATH));
}

function readRefreshCookie(req: Request): string | null {
  const raw: unknown = req.cookies?.[REFRESH_COOKIE];
  return typeof raw === "string" && raw !== "" ? raw : null;
}

const revokeFamily = (familyId: string) =>
  prisma.refreshToken.updateMany({ where: { familyId, revokedAt: null }, data: { revokedAt: new Date() } });

/** 用 refresh cookie 換一組新的 token，回傳 userId */
export async function rotateSession(req: Request, res: Response): Promise<string> {
  const raw = readRefreshCookie(req);
  const found = raw ? await prisma.refreshToken.findUnique({ where: { tokenHash: sha256(raw) } }) : null;
  if (!found) {
    clearSession(res);
    throw new HttpError(401, "請重新登入");
  }
  if (found.revokedAt) {
    await revokeFamily(found.familyId);
    clearSession(res);
    throw new HttpError(401, "登入狀態已失效，請重新登入");
  }
  // 加上 revokedAt: null 條件：兩個請求同時拿同一個 token 來換，只有一個會成功
  const { count } = await prisma.refreshToken.updateMany({
    where: { id: found.id, revokedAt: null, expiresAt: { gt: new Date() } },
    data: { revokedAt: new Date() },
  });
  if (count === 0) {
    clearSession(res);
    throw new HttpError(401, "請重新登入");
  }
  await startSession(res, found.userId, found.familyId);
  return found.userId;
}

/** 登出：作廢目前這次登入的所有 refresh token，清掉 cookie */
export async function endSession(req: Request, res: Response): Promise<void> {
  const raw = readRefreshCookie(req);
  if (raw) {
    const found = await prisma.refreshToken.findUnique({ where: { tokenHash: sha256(raw) }, select: { familyId: true } });
    if (found) await revokeFamily(found.familyId);
  }
  clearSession(res);
}

/** 所有裝置一起登出（改密碼時用） */
export async function revokeAllSessions(userId: string): Promise<void> {
  await prisma.refreshToken.updateMany({ where: { userId, revokedAt: null }, data: { revokedAt: new Date() } });
}
