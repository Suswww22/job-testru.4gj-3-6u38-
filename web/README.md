# job-tracker-web

求職追蹤平台的前端：React 19 + Vite + TypeScript，資料層用 TanStack Query，拖拉用 dnd-kit。

## 啟動

先依 `../api/README.md` 啟動 Postgres 和 API（port 3001），再執行：

```bash
npm install
npm run dev      # http://localhost:5173，/api 由 Vite 轉發到 3001
npm run build    # 型別檢查＋正式版建置，輸出到 dist/
```

## 頁面

| 路徑 | 內容 |
| --- | --- |
| 未登入 | 登入、註冊 |
| `/jobs` | 職缺列表：搜尋、新增職缺、加入追蹤、刪除 |
| `/board` | 投遞看板：五個狀態欄位，把卡片拖到另一欄就改狀態 |

## 設計重點

- **同網站 cookie**：開發時由 Vite 把 `/api` 轉發到後端，對瀏覽器來說前後端是同一個網站，所以 `SameSite=Strict` 的 httpOnly cookie 會自動帶上，前端程式完全碰不到 token。
- **自動換發**（`src/api/client.ts`）：收到 401 時先呼叫 `/auth/refresh` 換新的 token，再把原請求重試一次。同時有多個請求過期時，只會換發一次；因為 refresh token 會輪替，重複換發會被後端當成外洩，整個登入就被作廢了。換發也失敗時，會把登入狀態清空，畫面回到登入頁。
- **樂觀更新**：卡片拖到新欄位時，先直接改畫面，API 失敗再還原，拖拉起來才不會卡。
- **換帳號時清掉上一個人的資料**：只清掉「我是誰」以外的快取。如果整個快取一起清掉，正在觀察登入狀態的元件會收不到更新。
- **無障礙**：看板支援鍵盤拖拉（空白鍵拿起、方向鍵移動、空白鍵放下）；螢幕閱讀器會用中文念出職缺名稱和欄位名稱。
- 地區選項直接取自 `../src/shared/data.ts`，和 API 的驗證規則是同一份資料。
