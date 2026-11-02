// access token（JWT）簽發與驗證。只放 userId（sub），15 分鐘到期；過期後由 refresh token 換新的（見 session.ts）。

import jwt from "jsonwebtoken";

export const ACCESS_TTL_SECONDS = 15 * 60;

function secret(): string {
  const s = process.env["JWT_SECRET"];
  if (!s || s.length < 32) throw new Error("JWT_SECRET 未設定或太短（至少 32 字元），請檢查 .env");
  return s;
}

export function signAccessToken(userId: string): string {
  return jwt.sign({}, secret(), { subject: userId, expiresIn: ACCESS_TTL_SECONDS, algorithm: "HS256" });
}

/** 驗證失敗（簽章錯、過期、格式錯）回傳 null */
export function verifyAccessToken(token: string): string | null {
  try {
    const payload = jwt.verify(token, secret(), { algorithms: ["HS256"] });
    return typeof payload === "object" && typeof payload.sub === "string" ? payload.sub : null;
  } catch {
    return null;
  }
}

/** 啟動時就檢查，避免第一個請求才發現沒設定 */
export function assertJwtConfigured(): void {
  secret();
}
