// 端對端測試：開真的瀏覽器，從註冊一路操作到看板拖曳。
// 跟正式環境一樣，先 vite build，再由 API 同時送前端與 /api（同一個網站，cookie 才帶得上）。
// 不用 vite dev：dev server 每個模組都即時轉譯，幾個瀏覽器同時冷啟動時，在 Windows 上會慢到逾時。
// 需要 Postgres（api 的 npm run db，或 CI 的 service container）；用 3101 port，不影響開發中的 3001。

import path from "node:path";

import { defineConfig, devices } from "@playwright/test";

const CI = !!process.env["CI"];
const PORT = 3101;

export default defineConfig({
  testDir: "e2e",
  // 每個測試自己註冊一個帳號，彼此不共用資料，可以平行跑
  fullyParallel: true,
  // 在這台 Windows 開發機上 4 個以上的瀏覽器同時跑會卡住（原因不明，2 個穩定），CI 機器也只有 2 核
  workers: 2,
  forbidOnly: CI,
  retries: CI ? 1 : 0,
  // CI 上用 github reporter：失敗原因會變成 GitHub 的 annotation，不用下載 log 就看得到
  reporter: CI ? [["list"], ["github"], ["html", { open: "never" }]] : "list",
  use: {
    baseURL: `http://localhost:${PORT}`,
    locale: "zh-TW",
    timezoneId: "Asia/Taipei",
    trace: "retain-on-failure",
  },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
  webServer: {
    command: "npm run build && npm --prefix ../api start",
    url: `http://localhost:${PORT}/api/health`,
    reuseExistingServer: !CI,
    timeout: 120_000,
    env: {
      PORT: String(PORT),
      WEB_DIST: path.resolve(import.meta.dirname, "dist"),
      // 每個測試都會註冊帳號，放寬同一 IP 的註冊與登入次數
      REGISTER_LIMIT_PER_IP: "1000",
      LOGIN_LIMIT_PER_IP: "1000",
    },
  },
});
