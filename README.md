# 尋職測試：求職追蹤平台

[![測試](https://github.com/Suswww22/job-tracker/actions/workflows/test.yml/badge.svg)](https://github.com/Suswww22/job-tracker/actions/workflows/test.yml)

**線上版：https://job-tracker-95kk.onrender.com**（免費方案，閒置後第一次開啟要等約 1 分鐘）

把求職過程集中在一個地方：從求職網站匯入職缺、用履歷評分排序、在看板上追蹤每一份投遞，每週一收到一份週報。

## 功能

- **職缺匯入**：搜尋台灣就業通、Yourator，一鍵加入自己的清單；也可以手動新增。
- **履歷匹配**：貼上履歷，依技能、職務、年資、學歷、地區替職缺評分，列出符合與缺少的技能。
- **投遞看板**：收藏、已投、面試、錄取、拒絕五欄，滑鼠或鍵盤拖曳換狀態；詳情頁有狀態歷程與筆記。
- **統計**：各狀態數量與投遞漏斗。
- **每週週報**：本週進度、超過 7 天沒消息該跟進的投遞、依履歷推薦的新職缺；站內查看，也可以寄到信箱。

## 技術

| | |
|---|---|
| 前端 | React 19、Vite、TypeScript、TanStack Query、dnd-kit |
| 後端 | Express 5、Prisma 6、PostgreSQL、zod |
| 驗證 | JWT 放 httpOnly cookie、refresh token 輪替、登入與註冊次數限制 |
| 部署 | Docker，Render（單一容器同時送前端與 API）＋ Neon Postgres |
| 排程與通知 | GitHub Actions 每週觸發週報，Resend 寄信 |
| 測試 | Vitest 單元測試 38 項、curl smoke 81 項、Playwright 端對端 5 項，每次 push 由 GitHub Actions 執行 |

## 目錄

| 路徑 | 內容 |
|---|---|
| [`api/`](api/README.md) | 後端：API、資料表、驗證設計、週報、部署說明 |
| [`web/`](web/README.md) | 前端：頁面、設計重點、端對端測試 |
| `src/shared/` | 前後端共用：地區與技能資料、履歷匹配規則 |
| `src/server/` | 求職網站的爬蟲 |
| `www/` | 最初的單頁版本（`npm start`），平台版由此延伸 |
| `compose.yaml` | 用 Docker 在本機跑整套（資料庫＋API＋前端） |

## 本機啟動

```bash
cd api && npm install && cp .env.example .env
npm run db && npm run migrate && npm run dev
```

```bash
cd web && npm install && npm run dev
```

打開 http://localhost:5173 。
