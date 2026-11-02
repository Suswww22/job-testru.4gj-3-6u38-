# job-tracker-api

求職追蹤平台的後端：Express 5 + TypeScript + Prisma + PostgreSQL。驗證規則的列舉值（地區、來源、工作性質、薪資類型）直接取自 `../src/shared`，所以前端、爬蟲和 API 用的是同一套定義。

## 啟動

```bash
npm install
cp .env.example .env
npm run db        # 啟動開發用 Postgres（port 5433），背景執行
npm run migrate   # 套用 prisma/migrations
npm run dev       # API：http://localhost:3001/api
npm run smoke     # curl 冒煙測試（42 項）：登入、token 輪替、次數限制、CRUD、資料隔離、改密碼、刪帳號
npm run db:stop
```

`npm run db` 用的是 `embedded-postgres` 套件附的 Postgres 執行檔，不用另外安裝。在 Windows 上有兩個地方要特別處理：

- initdb 不接受含中文的路徑，所以執行檔和資料都放在 `%LOCALAPPDATA%\job-tracker`。
- postgres 不能用系統管理員權限的帳號直接執行，所以改由 `pg_ctl` 降低權限後再啟動。

## 資料表

| 表 | 用途 |
| --- | --- |
| `User` | 使用者；密碼只存 bcrypt 雜湊 |
| `RefreshToken` | 登入階段；只存 refresh token 的 SHA-256，輪替時用 `familyId` 串起同一次登入 |
| `Job` | 職缺，攤平自 `shared/types.ts` 的 `Job`；`(userId, externalId)` 唯一，爬蟲匯入時用來去重 |
| `Application` | 投遞狀態：SAVED → APPLIED → INTERVIEW → OFFER / REJECTED，一個職缺一筆 |
| `Note` | 投遞筆記 |

## API

| 方法 | 路徑 | 說明 |
| --- | --- | --- |
| GET | `/api/health` | 健康檢查 |
| POST | `/api/auth/register` | 註冊：`email`、`password`（至少 8 字元、最多 72 bytes）、`name?`；成功後直接是登入狀態 |
| POST | `/api/auth/login` | 登入，設定 cookie，回傳 `{ user }` |
| POST | `/api/auth/refresh` | 用 refresh cookie 換一組新的 token |
| POST | `/api/auth/logout` | 登出：作廢這次登入，清掉 cookie |
| GET | `/api/auth/me` | 目前登入的使用者 |
| PATCH | `/api/auth/password` | 改密碼：`currentPassword`、`newPassword`；其他裝置一併登出 |
| DELETE | `/api/auth/me` | 刪帳號：`password`；職缺、投遞、筆記一起刪除 |
| GET | `/api/jobs?q=&region=&source=&limit=&offset=` | 列表：搜尋標題、公司、技能，分頁 |
| GET | `/api/jobs/:id` | 單筆 |
| POST | `/api/jobs` | 新增：`title`、`company` 必填，其他欄位有預設值 |
| PATCH | `/api/jobs/:id` | 部分更新 |
| DELETE | `/api/jobs/:id` | 刪除 |

`/api/jobs` 底下的路由都需要登入（`access_token` cookie），而且只看得到自己的資料。別人的職缺一律回 404，不讓人分辨出「存在但不是你的」。

## 驗證設計

- **Cookie**：access token 和 refresh token 都放在 httpOnly cookie，前端 JS 讀不到，就算網頁被 XSS 攻擊也偷不走。設定 `SameSite=Strict`，別的網站發出的請求不會帶上 cookie，以此擋 CSRF；正式環境（`NODE_ENV=production`）會再加上 `Secure`。refresh cookie 的 Path 是 `/api/auth`，只會送到驗證相關的 API。
- **Access token**：JWT HS256，只放 `sub`（userId），15 分鐘到期。過期時 API 回 401，前端呼叫 `/refresh` 換新的再重試。`JWT_SECRET` 至少 32 字元，沒設定的話伺服器拒絕啟動。
- **Refresh token**：32 bytes 隨機字串，30 天到期，資料庫只存 SHA-256。每次換發都作廢舊的、發新的（輪替）。已作廢的 token 又被拿來用，代表可能外洩，同一次登入（同一個 `familyId`）衍生的 token 全部作廢。
- **權衡**：access token 是無狀態的，所以改密碼或登出後，已發出的 access token 最多還能用 15 分鐘；refresh token 則是立即失效。帳號刪除後，殘留的 access token 查不到資料（回 404），新增資料會因為外鍵不存在而回 401。
- **密碼**：bcrypt（cost 12）。bcrypt 只取前 72 bytes，所以上限是 72 bytes（中文約 24 字），以 UTF-8 byte 數檢查。
- **登入失敗**：不區分「帳號不存在」和「密碼錯」；帳號不存在時也跑一次 bcrypt，讓回應時間差不多，避免有人藉此探測哪些 email 註冊過。
- **次數限制**（`express-rate-limit`，429 會帶 `Retry-After`）：
  - 同一 IP 每 15 分鐘最多登入 50 次
  - 同一 email 每 15 分鐘最多失敗 5 次（換 IP 也擋得住）
  - 同一 IP 每小時最多註冊 20 次

  上限可以用環境變數調整。計數存在記憶體裡，重啟就歸零；之後如果開多台 API，要換成 Redis 這類共用的 store。
- email 一律先轉成小寫再存，所以大小寫不同的同一個 email 不能重複註冊。

錯誤格式統一是 `{ "error": { "message", "details?" } }`：輸入驗證失敗回 400，沒登入或 token 無效回 401，密碼確認失敗回 403，找不到回 404，資料重複回 409，次數過多回 429。
