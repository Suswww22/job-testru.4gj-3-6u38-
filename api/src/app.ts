// 組裝 Express app（與 listen 分開，之後 Vitest + supertest 可以直接拿 app 測試，不用真的開 port）。

import express from "express";

import { errorHandler } from "./errors.js";
import { jobsRouter } from "./jobs/routes.js";

export function createApp() {
  const app = express();
  app.use(express.json({ limit: "1mb" }));

  app.get("/api/health", (_req, res) => {
    res.json({ ok: true });
  });
  app.use("/api/jobs", jobsRouter);
  app.use("/api", (_req, res) => {
    res.status(404).json({ error: { message: "找不到這個 API" } });
  });

  app.use(errorHandler);
  return app;
}
