// 統一的錯誤回應格式：{ error: { message, details? } }

import { Prisma } from "@prisma/client";
import type { ErrorRequestHandler } from "express";
import { z, ZodError } from "zod";

export class HttpError extends Error {
  constructor(readonly status: number, message: string) {
    super(message);
  }
}

export const errorHandler: ErrorRequestHandler = (err: unknown, _req, res, _next) => {
  if (err instanceof HttpError) {
    res.status(err.status).json({ error: { message: err.message } });
  } else if (err instanceof ZodError) {
    res.status(400).json({ error: { message: "輸入格式錯誤", details: z.flattenError(err) } });
  } else if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002") {
    res.status(409).json({ error: { message: "資料重複", details: err.meta } });
  } else if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2003") {
    // 外鍵不存在：access token 還沒過期，但帳號已經刪除
    res.status(401).json({ error: { message: "請重新登入" } });
  } else if (err instanceof SyntaxError && "body" in err) {
    res.status(400).json({ error: { message: "JSON 格式錯誤" } });
  } else {
    console.error(err);
    res.status(500).json({ error: { message: "伺服器錯誤" } });
  }
};
