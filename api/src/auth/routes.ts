// /api/auth：註冊、登入、查詢自己。密碼用 bcrypt 雜湊，資料庫只存雜湊值。

import bcrypt from "bcryptjs";
import { Router } from "express";
import { z } from "zod";

import { prisma } from "../db.js";
import { HttpError } from "../errors.js";
import { requireAuth, userIdOf } from "./middleware.js";
import { signToken } from "./token.js";

export const authRouter = Router();

const BCRYPT_ROUNDS = 12;
// 登入時帳號不存在也要跑一次 bcrypt，讓回應時間一致，避免被用來探測哪些 email 已註冊
const DUMMY_HASH = bcrypt.hashSync("dummy-password", BCRYPT_ROUNDS);

const email = z.string().trim().toLowerCase().email().max(254);

const registerSchema = z.object({
  email,
  // bcrypt 只取前 72 bytes，超過的部分不會影響雜湊；中文一字 3 bytes，所以用 byte 數檢查
  password: z.string().min(8, "密碼至少 8 個字元")
    .refine((p) => Buffer.byteLength(p, "utf8") <= 72, "密碼太長（上限 72 bytes，約 24 個中文字）"),
  name: z.string().trim().min(1).max(50).optional(),
}).strict();

const loginSchema = z.object({
  email,
  password: z.string().min(1).max(72),
}).strict();

const publicUser = { id: true, email: true, name: true, createdAt: true } as const;

authRouter.post("/register", async (req, res) => {
  const { email, password, name } = registerSchema.parse(req.body);
  const exists = await prisma.user.findUnique({ where: { email }, select: { id: true } });
  if (exists) throw new HttpError(409, "這個 email 已經註冊過");
  const user = await prisma.user.create({
    data: { email, name: name ?? null, passwordHash: await bcrypt.hash(password, BCRYPT_ROUNDS) },
    select: publicUser,
  });
  res.status(201).json({ token: signToken(user.id), user });
});

authRouter.post("/login", async (req, res) => {
  const { email, password } = loginSchema.parse(req.body);
  const user = await prisma.user.findUnique({ where: { email } });
  const ok = await bcrypt.compare(password, user?.passwordHash ?? DUMMY_HASH);
  // 不區分「帳號不存在」與「密碼錯」，同樣只回一句
  if (!user || !ok) throw new HttpError(401, "email 或密碼錯誤");
  const { id, name, createdAt } = user;
  res.json({ token: signToken(id), user: { id, email: user.email, name, createdAt } });
});

authRouter.get("/me", requireAuth, async (req, res) => {
  const user = await prisma.user.findUnique({ where: { id: userIdOf(req) }, select: publicUser });
  // token 有效但使用者已被刪除
  if (!user) throw new HttpError(401, "請重新登入");
  res.json({ user });
});
