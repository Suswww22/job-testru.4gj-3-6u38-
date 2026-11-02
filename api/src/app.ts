// 組裝 Express app（與 listen 分開，之後 Vitest + supertest 可以直接拿 app 測試，不用真的開 port）。

import cookieParser from "cookie-parser";
import express from "express";

import { applicationsRouter } from "./applications/routes.js";
import { authRouter } from "./auth/routes.js";
import { errorHandler } from "./errors.js";
import { jobsRouter } from "./jobs/routes.js";

export function createApp() {
  const app = express();
  // 放在反向代理（nginx）後面時，要相信它帶來的 X-Forwarded-For，否則所有人的 IP 都是代理的 IP，登入次數限制會變成全站共用。
  // 值是「中間隔了幾層代理」；沒設定就不信任，避免直連時被偽造標頭繞過限制
  const hops = Number(process.env["TRUST_PROXY"] ?? 0);
  if (hops > 0) app.set("trust proxy", hops);
  app.use(express.json({ limit: "1mb" }));
  app.use(cookieParser());

  app.get("/api/health", (_req, res) => {
    res.json({ ok: true });
  });
  app.use("/api/auth", authRouter);
  app.use("/api/jobs", jobsRouter);
  app.use("/api/applications", applicationsRouter);
  app.use("/api", (_req, res) => {
    res.status(404).json({ error: { message: "找不到這個 API" } });
  });

  app.use(errorHandler);
  return app;
}
