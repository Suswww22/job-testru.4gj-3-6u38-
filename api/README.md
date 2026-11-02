# job-tracker-api

求職追蹤平台的後端：Express 5 + TypeScript + Prisma + PostgreSQL。驗證規則的列舉值（地區、來源、工作性質、薪資類型）直接取自 `../src/shared`，所以前端、爬蟲和 API 用的是同一套定義。

## 啟動

```bash
npm install
cp .env.example .env
npm run db        # 啟動開發用 Postgres（port 5433），背景執行
npm run migrate   # 套用 prisma/migrations
npm run dev       # API：http://localhost:3001/api
npm run smoke     # curl 冒煙測試（79 項）：登入、token 輪替、次數限制、職缺、投遞、筆記、資料隔離、改密碼、刪帳號
npm run db:stop
```

`npm run db` 用的是 `embedded-postgres` 套件附的 Postgres 執行檔，不用另外安裝。在 Windows 上有兩個地方要特別處理：

- initdb 不接受含中文的路徑，所以執行檔和資料都放在 `%LOCALAPPDATA%\job-tracker`。
- postgres 不能用系統管理員權限的帳號直接執行，所以改由 `pg_ctl` 降低權限後再啟動。

## 用 Docker 跑整套（資料庫＋API＋前端）

在 `job-finder/` 執行：

```bash
cp .env.example .env   # 填入 POSTGRES_PASSWORD 與 JWT_SECRET（openssl rand -hex 32）
docker compose up --build -d
```

打開 http://localhost:8080。`compose.yaml` 有四個服務，依序啟動：

| 服務 | 內容 |
| --- | --- |
| `db` | Postgres 17，資料存在 `db-data` volume，不對外開 port |
| `migrate` | 跑一次 `prisma migrate deploy` 就結束 |
| `api` | 編譯好的 JS（`npm run build` → `dist/`），不帶 TypeScript、tsx 與開發依賴，以非 root 使用者執行 |
| `web` | nginx：送出前端靜態檔，並把 `/api` 轉給 `api`，瀏覽器看到的是同一個網站，cookie 才帶得上 |

放在 nginx 後面要注意的兩個環境變數：

- `TRUST_PROXY=1`：請求都經過 nginx，不設的話 API 看到的 IP 全是 nginx 的，登入次數限制會變成全站共用一份額度。設了之後以 nginx 接在 `X-Forwarded-For` 最後面的真實 IP 為準，使用者在前面偽造的值不影響。
- `COOKIE_SECURE`：正式模式預設只在 HTTPS 送 cookie；本機用 http 跑時 compose 預設成 `false`，部署到 HTTPS 時改成 `true`。

不用 Docker 也能跑正式版：`npm run build && npm run start:prod`。

## 部署到 Render（＋ Neon 資料庫）

線上版：https://job-tracker-95kk.onrender.com（免費方案閒置後會休眠，第一次開啟要等約一分鐘）

用 `job-finder/Dockerfile`（單一容器版）：API 同時送出前端靜態檔（環境變數 `WEB_DIST`），整個網站只有一個網址。不拆成前端、後端兩個服務的原因是 `*.onrender.com` 的每個子網域對瀏覽器來說都是不同網站，`SameSite=Strict` 的 cookie 不會跨過去，登入會失效。

容器啟動時先跑 `prisma migrate deploy` 再開 API（免費方案沒有獨立的部署前步驟），所以 `prisma` CLI 放在正式依賴。

1. 在 Neon 建立專案（區域選 Singapore），複製**非 pooled** 的連線網址（結尾有 `?sslmode=require`）。
2. 在 Render 選 New → Blueprint，指向 repo，它會照 `render.yaml` 建立服務；`DATABASE_URL` 貼上 Neon 的網址，`JWT_SECRET` 由 Render 自動產生。
3. 之後推到 main 就會自動重新部署。

免費方案閒置 15 分鐘會休眠，下一次開啟要等大約一分鐘。

`TRUST_PROXY` 是實測出來的：Render 前面還有 Cloudflare，API 收到的 `X-Forwarded-For` 是「使用者, Cloudflare, Render 內部」，所以設 3。設成 1 的時候，API 把 Render 內部位址當成使用者 IP，登入次數限制等於全站共用一份額度。換平台時要重新量一次。

## 資料表

| 表 | 用途 |
| --- | --- |
| `User` | 使用者；密碼只存 bcrypt 雜湊 |
| `RefreshToken` | 登入階段；只存 refresh token 的 SHA-256，輪替時用 `familyId` 串起同一次登入 |
| `Job` | 職缺，攤平自 `shared/types.ts` 的 `Job`；`(userId, externalId)` 唯一，爬蟲匯入時用來去重 |
| `Application` | 投遞狀態：SAVED → APPLIED → INTERVIEW → OFFER / REJECTED，一個職缺一筆 |
| `ApplicationEvent` | 狀態歷程：每次狀態改變記一筆（from → to、時間），統計從這裡算 |
| `Note` | 投遞筆記（面試心得、聯絡人…） |
| `Resume` | 履歷純文字，每人一份；匹配時才解析，刪帳號時一起刪除 |
| `DigestSetting` | 週報設定：開關、推薦職缺的搜尋關鍵字（最多 3 個）、地區、是否寄 Email |
| `Digest` | 每週一份週報，內容存成 JSON 快照，之後職缺被刪或狀態改變也不影響已產生的週報；`emailedAt` 記錄寄出時間 |

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
| DELETE | `/api/jobs/:id` | 刪除（投遞與筆記一起刪除） |
| GET | `/api/applications?status=` | 投遞列表，附職缺摘要與筆記數 |
| GET | `/api/applications/stats` | `{ total, byStatus, funnel }`：各狀態目前數量（沒有資料也回 0），以及從狀態歷程算出「曾經走到」追蹤／投遞／面試／錄取的數量 |
| GET | `/api/applications/:id` | 詳情：職缺、筆記、狀態歷程 |
| POST | `/api/applications` | 建立：`jobId` 必填，`status?`、`appliedAt?`；一個職缺只能一筆 |
| PATCH | `/api/applications/:id` | 改狀態或投遞日；狀態有變才記歷程 |
| DELETE | `/api/applications/:id` | 刪除 |
| POST | `/api/applications/:id/notes` | 新增筆記 |
| PATCH | `/api/applications/:id/notes/:noteId` | 編輯筆記 |
| DELETE | `/api/applications/:id/notes/:noteId` | 刪除筆記 |
| GET | `/api/import/search?source=taiwanjobs\|yourator&keyword=&region=` | 搜尋外部網站的職缺（沿用 `../src/server/sources` 的爬蟲），回傳已轉成 `POST /api/jobs` 欄位的預覽與 `saved`；不寫入資料庫。每個帳號 10 分鐘 20 次 |

| GET | `/api/resume` | `{ content, updatedAt, profile }`；profile 是系統從履歷辨識出的技能、年資、學歷、地區、職務領域 |
| PUT | `/api/resume` | 儲存履歷（`content`，最多 20000 字） |
| GET／PUT | `/api/digest/settings` | 週報設定 `{ enabled, keywords, region, email }`；回應另有唯讀的 `mailAvailable`（伺服器是否設定寄信） |
| GET | `/api/digests` | 最近 8 份週報，新的在前 |
| POST | `/api/digests` | 立即產生一份（每個帳號每小時 5 次） |
| POST | `/api/cron/weekly-digest` | 排程用：`Authorization: Bearer <CRON_SECRET>`，替所有開啟週報的使用者產生；6 天內產生過的跳過 |
| GET | `/api/match` | 自己每筆職缺的匹配結果，分數高到低：`score`（0–100）、`matchedSkills`、`missingSkills`、`reasons` |

匯入時前端把預覽交給 `POST /api/jobs`。`externalId` 是 `${source}:編號`，`(userId, externalId)` 有唯一限制，所以同一筆重複匯入會回 409。

匹配沿用 `../src/shared/matcher.ts` 的規則式評分：分數 = 適配度（技能 65 ＋ 職務領域 35）× 資格係數（年資、學歷、地區不符時打折，符合時不加分）。資料表沒有年資、學歷、職務分類欄位，匹配時用同一套函式從職稱與描述解析；技能也用字典重新辨識，手動輸入的「react」才對得上履歷裡的「React」。

`/api/jobs` 與 `/api/applications` 底下的路由都需要登入（`access_token` cookie），而且只看得到自己的資料。別人的資料一律回 404，不讓人分辨出「存在但不是你的」。職缺的回應會附上 `application: { id, status } | null`。

投遞狀態：`SAVED`（收藏）→ `APPLIED`（已投）→ `INTERVIEW`（面試）→ `OFFER`（錄取）／`REJECTED`（拒絕）。狀態可以任意切換，因為現實中也會被拒後又被找回去面試，歷程會如實記錄。第一次離開 `SAVED` 時，如果沒有投遞日，會自動補上當下時間。

## 每週週報

週報有三區：本週進度（從狀態歷程算）、已投遞超過 7 天沒有進展的投遞、新的推薦職缺（用設定的關鍵字搜尋台灣就業通與 Yourator，以履歷評分，40 分以上取前 5 筆；已在清單裡或最近 4 份週報推薦過的不再列出）。沒有推薦時會寫出原因，例如還沒填履歷。

Render 免費方案沒有排程，改由 GitHub Actions（`.github/workflows/weekly-digest.yml`）每週一台灣時間 08:00 先叫醒服務，再帶著 `CRON_SECRET` 呼叫 `/api/cron/weekly-digest`。`CRON_SECRET` 由 Render 產生（`render.yaml` 的 `generateValue`），要複製到 GitHub repo 的 Actions secret。沒設定或少於 32 字元時，排程端點回 503。

設定裡開啟 Email 後，每次產生週報（排程或手動）會用 [Resend](https://resend.com) 的 HTTP API 寄到帳號信箱，HTML 與純文字各一份。職缺標題等外部資料一律跳脫，只輸出 http(s) 連結。寄信失敗不影響週報本身，只是 `emailedAt` 留空。伺服器沒設 `RESEND_API_KEY` 時不寄信，前端的 Email 開關會停用。沒有自己的網域時用 Resend 的測試寄件者，只能寄給註冊 Resend 的那個信箱。

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
