// 組裝 Express app（與 listen 分開，之後 Vitest + supertest 可以直接拿 app 測試，不用真的開 port）。

import path from "node:path";

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

  app.get("/api/health", (req, res) => {
    // 暫時：確認部署平台前面有幾層代理，確認完就移除
    res.json({ ok: true, ip: req.ip, xff: req.headers["x-forwarded-for"] ?? null });
  });
  app.use("/api/auth", authRouter);
  app.use("/api/jobs", jobsRouter);
  app.use("/api/applications", applicationsRouter);
  app.use("/api", (_req, res) => {
    res.status(404).json({ error: { message: "找不到這個 API" } });
  });

  // 單一容器部署（Render）時由 API 一併送出前端，前後端同一個網址，SameSite=Strict 的 cookie 才帶得上。
  // docker compose 由 nginx 送前端，不設 WEB_DIST
  if (process.env["WEB_DIST"]) {
    const webDist = path.resolve(process.env["WEB_DIST"]);
    // 檔名帶雜湊，內容變了檔名就變，可以長期快取
    app.use("/assets", express.static(path.join(webDist, "assets"), { immutable: true, maxAge: "1y" }));
    app.use(express.static(webDist, { index: false }));
    // 其餘路徑（/board、/applications/:id…）都回 index.html 交給 React Router；不快取，部署新版才會立刻生效
    app.get(/.*/, (_req, res) => {
      res.setHeader("Cache-Control", "no-cache");
      // 用 root＋相對檔名：sendFile 預設拒絕路徑裡有「.」開頭的資料夾，用 root 時只檢查 root 之後的部分
      res.sendFile("index.html", { root: webDist });
    });
  }

  app.use(errorHandler);
  return app;
}
