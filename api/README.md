# job-tracker-api

求職追蹤平台的後端：Express 5 + TypeScript + Prisma + PostgreSQL。驗證規則的列舉值（地區、來源、工作性質、薪資類型）直接取自 `../src/shared`，所以前端、爬蟲和 API 用的是同一套定義。

## 啟動

```bash
npm install
cp .env.example .env
npm run db        # 啟動開發用 Postgres（port 5433），背景執行
npm run migrate   # 套用 prisma/migrations
npm run dev       # API：http://localhost:3001/api
npm run smoke     # curl 冒煙測試：CRUD＋錯誤情境
npm run db:stop
```

`npm run db` 用的是 `embedded-postgres` 套件附的 Postgres 執行檔，不用另外安裝。在 Windows 上有兩個地方要特別處理：

- initdb 不接受含中文的路徑，所以執行檔和資料都放在 `%LOCALAPPDATA%\job-tracker`。
- postgres 不能用系統管理員權限的帳號直接執行，所以改由 `pg_ctl` 降低權限後再啟動。

## 資料表

| 表 | 用途 |
| --- | --- |
| `User` | 使用者；登入功能完成前，所有請求都當成 demo 使用者 |
| `Job` | 職缺，攤平自 `shared/types.ts` 的 `Job`；`(userId, externalId)` 唯一，爬蟲匯入時用來去重 |
| `Application` | 投遞狀態：SAVED → APPLIED → INTERVIEW → OFFER / REJECTED，一個職缺一筆 |
| `Note` | 投遞筆記 |

## API

| 方法 | 路徑 | 說明 |
| --- | --- | --- |
| GET | `/api/health` | 健康檢查 |
| GET | `/api/jobs?q=&region=&source=&limit=&offset=` | 列表：搜尋標題、公司、技能，分頁 |
| GET | `/api/jobs/:id` | 單筆 |
| POST | `/api/jobs` | 新增：`title`、`company` 必填，其他欄位有預設值 |
| PATCH | `/api/jobs/:id` | 部分更新 |
| DELETE | `/api/jobs/:id` | 刪除 |

錯誤格式統一是 `{ "error": { "message", "details?" } }`：輸入驗證失敗回 400，找不到回 404，`externalId` 重複回 409。
