// /api/auth：註冊、登入、換發、登出、查詢自己、改密碼、刪帳號。
// 密碼用 bcrypt 雜湊；token 只放在 httpOnly cookie（見 session.ts），回應 body 不含 token。

import bcrypt from "bcryptjs";
import { Router } from "express";
import { z } from "zod";

import { prisma } from "../db.js";
import { HttpError } from "../errors.js";
import { requireAuth, userIdOf } from "./middleware.js";
import { loginEmailLimiter, loginIpLimiter, registerLimiter } from "./rateLimit.js";
import { clearSession, endSession, revokeAllSessions, rotateSession, startSession } from "./session.js";

export const authRouter = Router();

const BCRYPT_ROUNDS = 12;
// 登入時帳號不存在也要跑一次 bcrypt，讓回應時間一致，避免被用來探測哪些 email 已註冊
const DUMMY_HASH = bcrypt.hashSync("dummy-password", BCRYPT_ROUNDS);

const email = z.string().trim().toLowerCase().email().max(254);
// bcrypt 只取前 72 bytes，超過的部分不會影響雜湊；中文一字 3 bytes，所以用 byte 數檢查
const newPassword = z.string().min(8, "密碼至少 8 個字元")
  .refine((p) => Buffer.byteLength(p, "utf8") <= 72, "密碼太長（上限 72 bytes，約 24 個中文字）");
const anyPassword = z.string().min(1).max(200);

const registerSchema = z.object({ email, password: newPassword, name: z.string().trim().min(1).max(50).optional() }).strict();
const loginSchema = z.object({ email, password: anyPassword }).strict();
const changePasswordSchema = z.object({ currentPassword: anyPassword, newPassword }).strict();
const deleteAccountSchema = z.object({ password: anyPassword }).strict();

const publicUser = { id: true, email: true, name: true, createdAt: true } as const;

/** 確認密碼正確；帳號已不存在也當成未登入 */
async function verifyPassword(userId: string, password: string): Promise<void> {
  const user = await prisma.user.findUnique({ where: { id: userId }, select: { passwordHash: true } });
  if (!user) throw new HttpError(401, "請重新登入");
  if (!(await bcrypt.compare(password, user.passwordHash))) throw new HttpError(403, "密碼錯誤");
}

authRouter.post("/register", registerLimiter, async (req, res) => {
  const { email, password, name } = registerSchema.parse(req.body);
  const exists = await prisma.user.findUnique({ where: { email }, select: { id: true } });
  if (exists) throw new HttpError(409, "這個 email 已經註冊過");
  const user = await prisma.user.create({
    data: { email, name: name ?? null, passwordHash: await bcrypt.hash(password, BCRYPT_ROUNDS) },
    select: publicUser,
  });
  await startSession(res, user.id);
  res.status(201).json({ user });
});

authRouter.post("/login", loginIpLimiter, loginEmailLimiter, async (req, res) => {
  const { email, password } = loginSchema.parse(req.body);
  const user = await prisma.user.findUnique({ where: { email } });
  const ok = await bcrypt.compare(password, user?.passwordHash ?? DUMMY_HASH);
  // 不區分「帳號不存在」與「密碼錯」，同樣只回一句
  if (!user || !ok) throw new HttpError(401, "email 或密碼錯誤");
  await startSession(res, user.id);
  const { id, name, createdAt } = user;
  res.json({ user: { id, email: user.email, name, createdAt } });
});

authRouter.post("/refresh", async (req, res) => {
  await rotateSession(req, res);
  res.status(204).end();
});

authRouter.post("/logout", async (req, res) => {
  await endSession(req, res);
  res.status(204).end();
});

authRouter.get("/me", requireAuth, async (req, res) => {
  const user = await prisma.user.findUnique({ where: { id: userIdOf(req) }, select: publicUser });
  // token 有效但使用者已被刪除
  if (!user) throw new HttpError(401, "請重新登入");
  res.json({ user });
});

/** 改密碼：所有裝置的登入一起作廢，再幫目前這台發新的 */
authRouter.patch("/password", requireAuth, async (req, res) => {
  const { currentPassword, newPassword } = changePasswordSchema.parse(req.body);
  const userId = userIdOf(req);
  await verifyPassword(userId, currentPassword);
  await prisma.user.update({ where: { id: userId }, data: { passwordHash: await bcrypt.hash(newPassword, BCRYPT_ROUNDS) } });
  await revokeAllSessions(userId);
  await startSession(res, userId);
  res.status(204).end();
});

/** 刪帳號：職缺、投遞、筆記、登入紀錄都由資料庫 ON DELETE CASCADE 一起刪掉 */
authRouter.delete("/me", requireAuth, async (req, res) => {
  const { password } = deleteAccountSchema.parse(req.body);
  const userId = userIdOf(req);
  await verifyPassword(userId, password);
  await prisma.user.delete({ where: { id: userId } });
  clearSession(res);
  res.status(204).end();
});
