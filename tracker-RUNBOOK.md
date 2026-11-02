# AI 工程師職缺追蹤器：每週執行指引（第二階段）

規格來源：`tracker-SKILL.md`。本文件是每週三排程執行時要照做的步驟。
程式（第一階段）負責抓資料、篩選、比對、狀態判定；本指引負責程式做不到的部分：主流網站線索與公司評價。

## 不可違反的規則

1. **不捏造**：每一筆職缺線索與評價都要附來源網址與日期；查不到就寫「查無資料」並列出試過的來源。
2. **不繞過封鎖**：104、1111、CakeResume、LinkedIn、Indeed、Glassdoor 會阻擋程式存取，**不要用 WebFetch 開它們的頁面**，只能用 WebSearch 的搜尋結果摘要。
3. **桃園範圍從嚴**：線索必須在搜尋摘要中明確寫出桃園市或桃園的行政區（桃園、中壢、平鎮、八德、楊梅、蘆竹、大園、龜山、龍潭、大溪、觀音、新屋、復興）才列入；多地點職缺（例如「新竹、台中或桃園」）放「地點待確認」。
4. **線索不計入指標**：搜尋摘要無法確認職缺是否仍開放，一律列為「線索（未確認）」，不加進 total_openings 等指標。摘要顯示的截止日已過、或刊登日早於 60 天前的，直接捨棄。
5. **公司名稱要完全一致**：評價必須屬於報告上同一家公司（含「股份有限公司」「台灣分公司」等全名）。名稱相近的不同公司（例如「鴻運科股份有限公司台灣分公司」與「鴻運科技有限公司」、「鴻佰科技」）不可混用。
6. **只算新的評價**：「本週新評價」只計算發表日期晚於 `tracker-data/reviews-seen.json` 中 `lastRun` 的評價，且未出現在該檔的 `reviews` 清單中。沒有日期的評價不計入新評價數。

## 步驟

### 0. 讀取條件
先讀 `tracker-config.json`（相當於表單；使用者可在 `npm start` 後的 `http://localhost:8742/tracker.html` 用「追蹤條件」表單修改），之後所有步驟都依它的值：

| 欄位 | 意義 |
|---|---|
| `location` | taoyuan / taiwan / remote / us / global，可多選 |
| `seniority` | any / junior / mid（2–5 年）/ senior / lead |
| `keywords` | ml / dl / llm / cv / data，可多選 |
| `sites` | 指定網站名稱；空陣列代表全部主流平台 |
| `minMonthlySalary` | 月薪下限（數字）或 null |
| `excludeCompanies` | 公司名稱含有任一字串就排除 |
| `notes` | 其他文字要求，程式不會套用，由你在線索與報告中盡量遵守並說明 |

### 1. 執行程式
在 `E:\Claude作品集\job-finder` 執行：

```
npm run build
npm run track
```

程式會自動讀 `tracker-config.json`，不要另外帶條件參數。輸出最後會印出 `report`、`json`、`history` 路徑。設定有誤時程式會列出錯誤並中止：停止並回報錯誤內容，不要自行改設定檔。程式若失敗，不要用舊資料冒充本週結果。

### 2. 主流網站線索（WebSearch）
依 `location` 選查詢，只讀搜尋結果摘要。`sites` 有指定時，只跑指定網站的查詢。

taoyuan：
- `site:104.com.tw 桃園 AI工程師`
- `site:104.com.tw 桃園 機器學習 OR 影像辨識 OR LLM`
- `site:1111.com.tw 桃園 AI 工程師`
- `site:cake.me Taoyuan machine learning engineer`
- `AI Engineer Taoyuan LinkedIn`
- `AI 工程師 桃園 Indeed`
- `中壢 AI 工程師 徵才`

remote（另加）：`AI 工程師 遠端 台灣`、`remote AI engineer Taiwan`
taiwan（另加）：`AI 工程師 職缺 台灣 104`、`machine learning engineer Taiwan`
us／global（另加）：`AI engineer jobs <United States 或 remote worldwide> <本週月份>`；海外職缺的地點規則改為「職缺明確寫出所在國家／遠端」，不適用桃園規則 3。

查詢裡的關鍵字依 `keywords` 調整（例如只選 cv 時，以「影像辨識」「電腦視覺」為主）。
線索同樣套用 `excludeCompanies` 與 `minMonthlySalary`（摘要有寫出薪資數字時才比較；沒寫的保留並註明）。

依規則 3、4 篩選後，與 `tracker-data/leads.json` 比對：
- 新出現的線索 → 標「本週新線索」
- 上週有、這週仍搜得到 → 更新 `lastSeen`
- 上週有、這週搜不到 → 標「本週未再出現（狀態未確認）」，連續 3 週沒出現就從檔案移除

### 3. 公司評價
對象：報告中位於桃園且狀態為「仍在招募」或「無法判定」的職缺公司，以及步驟 2 的線索公司。

每家公司依序嘗試：
1. GoodJob 工作經驗：WebFetch `https://www.goodjob.life/companies/<公司全名>/work-experiences`
2. GoodJob 面試經驗：WebFetch `https://www.goodjob.life/companies/<公司全名>/interview-experiences`
3. 面試趣：WebSearch `interview.tw <公司全名>`，可 WebFetch 搜到的 `interview.tw/c/...` 公司頁
4. 求職天眼通：WebSearch `求職天眼通 <公司全名>`
5. 比薪水：WebSearch `比薪水 <公司全名>`
6. PTT／Dcard：WebSearch `<公司簡稱> 離職 OR 入職 PTT OR Dcard`

第 4、5 項只讀搜尋摘要；若要 WebFetch 它們的頁面，先讀該網站的 robots.txt，確認允許才開啟。Glassdoor、Blind 會阻擋程式存取，只用搜尋摘要。

GoodJob 頁面 404 時，再用 WebSearch `site:goodjob.life <公司簡稱>` 找正確的公司頁名稱，並依規則 5 確認是同一家公司。

每則評價記錄：來源、網址、發表日期、職稱、評分、是否註明在職／離職／新進、重點摘要（30 字內，自行改寫，不要整段照抄）。
評價未註明在職或離職時，寫「未註明在職／離職」，不要自行推測。

### 4. 寫回檔案
- 更新 `tracker-data/reviews-seen.json`：把本週讀到的評價加入 `reviews`（以「網址＋日期＋職稱」去重），`lastRun` 設為今天。
- 更新 `tracker-data/leads.json`。
- 以程式產生的報告為底，產出 `tracker-data/reports/<日期>-final.md`：
  - 「## 2. 公司評價」：把 `<!-- REVIEWS -->` 與其下方的說明文字，換成各公司的評價小節。每家公司先列「本週新評價」，再列「評分概況」（總評分、評價數），最後列「已嘗試的來源」。
  - 總覽指標表中 `待補（網路搜尋）` 換成本週新評價數；「### 趨勢」表中本週那一列的 `待補` 也換成同一個數字，並重算表下方的「累計新評價」。
- 更新 `tracker-data/metrics-history.json`：把今天那筆的 `new_reviews_count` 從 null 改成本週新評價數（其他欄位不要動）。
  - 「## 資料來源與限制」的 `<!-- SEARCH-SOURCES -->` 換成「主流網站線索（未確認）」表格，欄位為：公司、職稱、地點、來源、摘要日期、狀態（本週新線索／持續出現／本週未再出現）、網址，以及本週實際執行的搜尋查詢清單。

### 5. 發布
在 Craft 新增文件，標題為 `AI 工程師職缺追蹤報告 <YYYY-MM-DD>`，內容為 final 報告全文（第一行標題除外）。完成後回報五項總覽指標與 Craft 連結。

Craft 操作注意：`documents create --title` 遇到空白會截斷標題，建立後要用 `blocks update --id <rootBlockId> --markdown "<完整標題>"` 改回完整標題；內文用 `blocks add --id <rootBlockId> --markdown "..."`，內文不可含半形雙引號。

## 首次執行（沒有 reviews-seen.json）
沒有上次報告可比，評價以「近 12 個月」為範圍列出並標示「首次執行，無上次報告基準」，new_reviews_count 為近 12 個月內有日期的評價數。
