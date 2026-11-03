#!/usr/bin/env bash
# API 冒煙測試：用 curl 跑一輪註冊登入（cookie）→ token 輪替 → 次數限制 → 職缺 CRUD → 資料隔離 → 改密碼 → 刪帳號。
# 用法：先 npm run db 與 npm start，再執行 bash scripts/smoke.sh
# 每個「瀏覽器」是一個 cookie jar 檔；切換 $JAR 就等於換一台裝置。

set -euo pipefail
API="${API:-http://localhost:3001/api}"
TMP=$(mktemp -d)
trap 'rm -rf "$TMP"' EXIT
jar() { local f="$TMP/$1.txt"; touch "$f"; command -v cygpath >/dev/null && cygpath -m "$f" || echo "$f"; }
JAR=""
pass=0

check() { # check <說明> <預期狀態碼> <實際狀態碼>
  if [[ "$2" == "$3" ]]; then echo "✔ $1 ($3)"; pass=$((pass + 1)); else echo "✘ $1：預期 $2，實際 $3 $body"; exit 1; fi
}
fail() { echo "✘ $1"; exit 1; }
req() { # req <method> <path> [json] → body 存在 $body，狀態碼存在 $status，回應標頭存在 $headers
  local out cookies=()
  [[ -n "$JAR" ]] && cookies=(-b "$JAR" -c "$JAR")
  # JSON 從 stdin 送：Windows 上把中文當命令列參數傳給 curl 會被轉成系統碼頁而變亂碼
  out=$(printf '%s' "${3:-}" | curl -s -D "$TMP/headers" -w '\n%{http_code}' -X "$1" "$API$2" \
    -H 'Content-Type: application/json' "${cookies[@]}" ${3:+--data-binary @-})
  status="${out##*$'\n'}"
  body="${out%$'\n'*}"
  headers=$(cat "$TMP/headers")
}
field() { node -e 'process.stdout.write(String(JSON.parse(process.argv[1])[process.argv[2]]))' "$body" "$1"; }

req GET /health
check "健康檢查" 200 "$status"

run=$(date +%s%N)
alice="alice-$run@example.com"
bob="bob-$run@example.com"

# ---------- 註冊登入 ----------
JAR=$(jar alice)
req POST /auth/register '{"email":"'"$alice"'","password":"short"}'
check "密碼太短 → 400" 400 "$status"

req POST /auth/register '{"email":"'"$alice"'","password":"correct-horse-1","name":"Alice"}'
check "註冊 Alice" 201 "$status"
[[ "$body" != *passwordHash* && "$body" != *token* ]] || fail "回應 body 不該有 passwordHash 或 token"
[[ "$headers" == *"access_token="*HttpOnly*SameSite=Strict* ]] || fail "access_token cookie 缺 HttpOnly 或 SameSite=Strict"
[[ "$headers" == *"refresh_token="*"Path=/api/auth"* ]] || fail "refresh_token cookie 的 Path 應該是 /api/auth"

req GET /auth/me
check "註冊後直接是登入狀態" 200 "$status"

req POST /auth/register '{"email":"'"${alice^^}"'","password":"another-pass-1"}'
check "同 email（大小寫不同）重複註冊 → 409" 409 "$status"

JAR=$(jar anon)
req GET /jobs
check "沒帶 cookie → 401" 401 "$status"
req GET "/import/search?source=yourator"
check "沒登入搜尋外部職缺 → 401" 401 "$status"
req GET /resume
check "沒登入讀履歷 → 401" 401 "$status"
req GET /digests
check "沒登入讀週報 → 401" 401 "$status"
req GET /nope
check "不存在的 API → 404（不是 401）" 404 "$status"

req POST /auth/login '{"email":"'"$alice"'","password":"wrong-password"}'
check "密碼錯誤 → 401" 401 "$status"

req POST /auth/login '{"email":"nobody-'"$run"'@example.com","password":"whatever-123"}'
check "帳號不存在 → 401" 401 "$status"

# ---------- 次數限制：同一個 email 連續失敗 5 次，第 6 次被擋 ----------
victim="victim-$run@example.com"
for i in 1 2 3 4 5; do req POST /auth/login '{"email":"'"$victim"'","password":"guess-'"$i"'"}'; done
check "連續失敗第 5 次仍是 401" 401 "$status"
req POST /auth/login '{"email":"'"$victim"'","password":"guess-6"}'
check "第 6 次 → 429" 429 "$status"
[[ "$headers" == *[Rr]etry-[Aa]fter* ]] || fail "429 應該帶 Retry-After 標頭"

# ---------- refresh token 輪替與重複使用偵測 ----------
JAR=$(jar alice)
cp "$JAR" "$(jar alice-old)"
req POST /auth/refresh
check "換發 token" 204 "$status"
req GET /auth/me
check "換發後仍是登入狀態" 200 "$status"

JAR=$(jar alice-old)
req POST /auth/refresh
check "拿已作廢的舊 refresh token 再換 → 401" 401 "$status"
JAR=$(jar alice)
req POST /auth/refresh
check "偵測到重複使用，同一次登入的新 token 也作廢 → 401" 401 "$status"

req POST /auth/login '{"email":"'"$alice"'","password":"correct-horse-1"}'
check "重新登入 Alice" 200 "$status"

# ---------- 職缺 CRUD（以 Alice 身分） ----------
req POST /jobs '{"title":"全端工程師","company":"範例科技","region":"taoyuan","salaryKind":"月薪","salaryMin":55000,"salaryMax":75000,"skills":["React","Node.js","PostgreSQL"]}'
check "新增職缺" 201 "$status"
id=$(field id)

req GET "/import/search?source=104"
check "不支援的外部來源 → 400" 400 "$status"

req GET "/jobs?q=React&region=taoyuan"
check "搜尋（技能＋地區）" 200 "$status"
[[ "$body" == *"$id"* ]] || fail "搜尋結果沒有剛新增的職缺"

req PATCH "/jobs/$id" '{"salaryMax":80000,"tags":["遠端可議"]}'
check "部分更新" 200 "$status"
[[ "$body" == *'"salaryMax":80000'* && "$body" == *'"title":"全端工程師"'* && "$body" == *'"salaryMin":55000'* ]] \
  || fail "PATCH 後其他欄位被改動：$body"

req PATCH "/jobs/$id" '{"salaryMin":90000}'
check "薪資下限大於資料庫裡的上限 → 400" 400 "$status"

req POST /jobs '{"title":"x","company":"y","userId":"someone-else"}'
check "想自己指定 userId → 400" 400 "$status"
req POST /jobs '{"title":"x","company":"y","sourceUrl":"javascript:alert(1)"}'
check "職缺網址是 javascript: → 400" 400 "$status"
req POST /jobs '{"title":"網址測試","company":"y","sourceUrl":"https://example.com/jobs/1"}'
check "職缺網址是 https → 201" 201 "$status"

req POST /jobs '{"title":"重複","company":"y","externalId":"yourator:dup-'"$run"'"}'
check "帶 externalId 新增" 201 "$status"
req POST /jobs '{"title":"重複","company":"y","externalId":"yourator:dup-'"$run"'"}'
check "同一 externalId 再新增 → 409" 409 "$status"

# ---------- 資料隔離：Bob 看不到也動不了 Alice 的職缺 ----------
JAR=$(jar bob)
req POST /auth/register '{"email":"'"$bob"'","password":"battery-staple-2"}'
check "註冊 Bob" 201 "$status"

req GET /jobs
[[ "$(field total)" == "0" ]] || fail "Bob 看到了別人的職缺：$body"
req GET "/jobs/$id"
check "Bob 讀 Alice 的職缺 → 404" 404 "$status"
req PATCH "/jobs/$id" '{"title":"被改了"}'
check "Bob 改 Alice 的職缺 → 404" 404 "$status"
req DELETE "/jobs/$id"
check "Bob 刪 Alice 的職缺 → 404" 404 "$status"

# ---------- 投遞追蹤（以 Alice 身分） ----------
JAR=$(jar alice)
req POST /applications '{"jobId":"'"$id"'"}'
check "替職缺建立投遞（預設 SAVED）" 201 "$status"
app=$(field id)
[[ "$body" == *'"status":"SAVED"'* && "$body" == *'"appliedAt":null'* ]] || fail "新投遞應該是 SAVED 且沒有投遞日：$body"

req POST /applications '{"jobId":"'"$id"'"}'
check "同一個職缺再建一筆 → 409" 409 "$status"
req POST /applications '{"jobId":"no-such-job"}'
check "職缺不存在 → 404" 404 "$status"
req POST /applications '{"jobId":"'"$id"'","status":"HIRED"}'
check "不存在的狀態 → 400" 400 "$status"

req GET "/jobs/$id"
[[ "$body" == *'"application":{"id":"'"$app"'","status":"SAVED"}'* ]] || fail "職缺沒有帶上投遞狀態：$body"

req PATCH "/applications/$app" '{"status":"APPLIED"}'
check "改成已投" 200 "$status"
[[ "$body" != *'"appliedAt":null'* ]] || fail "改成 APPLIED 應該自動補上投遞日：$body"
req PATCH "/applications/$app" '{"status":"APPLIED"}'
check "狀態沒變（不該多一筆歷程）" 200 "$status"
req PATCH "/applications/$app" '{"status":"INTERVIEW"}'
check "改成面試" 200 "$status"

req POST "/applications/$app/notes" '{"content":"一面：React 狀態管理、SQL JOIN"}'
check "新增筆記" 201 "$status"
note=$(field id)
req POST "/applications/$app/notes" '{"content":"   "}'
check "空白筆記 → 400" 400 "$status"
req PATCH "/applications/$app/notes/$note" '{"content":"一面：React 狀態管理、SQL JOIN、Docker"}'
check "編輯筆記" 200 "$status"

req GET "/applications/$app"
check "投遞詳情" 200 "$status"
events=$(node -e 'const a=JSON.parse(process.argv[1]);process.stdout.write(a.events.map(e=>`${e.fromStatus}>${e.toStatus}`).join(","))' "$body")
[[ "$events" == "null>SAVED,SAVED>APPLIED,APPLIED>INTERVIEW" ]] || fail "狀態歷程不對：$events"
[[ "$body" == *"Docker"* ]] || fail "詳情沒有帶出筆記"

req GET "/applications?status=INTERVIEW"
check "依狀態篩選" 200 "$status"
[[ "$body" == *"$app"* && "$body" == *'"title":"全端工程師"'* ]] || fail "篩選結果不對：$body"
req GET "/applications?status=OFFER"
[[ "$body" == '{"items":[]}' ]] || fail "OFFER 應該沒有資料：$body"

req GET /applications/stats
check "各狀態統計" 200 "$status"
[[ "$body" == '{"total":1,"byStatus":{"SAVED":0,"APPLIED":0,"INTERVIEW":1,"OFFER":0,"REJECTED":0},"funnel":{"tracked":1,"applied":1,"interview":1,"offer":0}}' ]] || fail "統計不對：$body"
req PATCH "/applications/$app" '{"status":"REJECTED"}'
req GET /applications/stats
[[ "$body" == *'"REJECTED":1'* && "$body" == *'"interview":1'* ]] || fail "面試後被拒仍要算進漏斗的面試關：$body"

req PUT /resume '{"content":"全端工程師，3 年 React、Node.js 與 PostgreSQL 開發經驗，住桃園"}'
check "儲存履歷" 200 "$status"
[[ "$body" == *'"React"'* && "$body" == *'"years":3'* && "$body" == *'"taoyuan"'* ]] || fail "履歷沒有解析出技能、年資或地區：$body"
req GET /match
check "履歷匹配" 200 "$status"
[[ "$body" == *"\"id\":\"$id\""* && "$body" == *'"score":'* && "$body" == *'"React"'* ]] || fail "匹配結果沒有 Alice 的職缺或符合的技能：$body"
req PUT /resume '{"content":"","extra":1}'
check "履歷帶多餘欄位 → 400" 400 "$status"

# 週報：不設關鍵字，產生時不會連外部網站
req PUT /digest/settings '{"enabled":true,"keywords":["a","b","c","d"],"region":null}'
check "週報關鍵字超過 3 個 → 400" 400 "$status"
req PUT /digest/settings '{"enabled":true,"keywords":[],"region":"taoyuan","email":"yes"}'
check "週報 Email 開關不是布林 → 400" 400 "$status"
req PUT /digest/settings '{"enabled":true,"keywords":[],"region":"taoyuan","email":true}'
check "開啟週報 Email" 200 "$status"
req PUT /digest/settings '{"enabled":true,"keywords":[],"region":"taoyuan"}'
check "儲存週報設定" 200 "$status"
[[ "$(field email)" == "true" ]] || fail "沒帶 email 欄位卻把 Email 開關改掉了：$body"
# 關掉 Email 再產生，smoke 的假信箱不會真的寄信
req PUT /digest/settings '{"enabled":true,"keywords":[],"region":"taoyuan","email":false}'
check "關閉週報 Email" 200 "$status"
req POST /digests
check "立即產生週報" 201 "$status"
[[ "$body" == *'"followUps":'* && "$body" == *'"changes":[{'* && "$body" == *'沒有推薦職缺'* ]] \
  || fail "週報缺少進度、跟進或沒有推薦的原因：$body"
req POST /cron/weekly-digest
check "排程沒帶密鑰 → 401" 401 "$status"

JAR=$(jar bob)
req GET /resume
[[ "$(field content)" == "" ]] || fail "Bob 讀到別人的履歷：$body"
req GET /match
[[ "$body" == '{"profile":null,"items":[]}' ]] || fail "Bob 的匹配結果有別人的資料：$body"
req GET /digests
[[ "$body" == '{"items":[]}' ]] || fail "Bob 看到別人的週報：$body"
req GET /digest/settings
[[ "$body" == '{"enabled":false,"keywords":[],"region":null,"email":false,'* ]] || fail "Bob 讀到別人的週報設定：$body"
req GET "/applications/$app"
check "Bob 讀 Alice 的投遞 → 404" 404 "$status"
req PATCH "/applications/$app" '{"status":"REJECTED"}'
check "Bob 改 Alice 的投遞狀態 → 404" 404 "$status"
req POST "/applications/$app/notes" '{"content":"偷看"}'
check "Bob 在 Alice 的投遞加筆記 → 404" 404 "$status"
req DELETE "/applications/$app/notes/$note"
check "Bob 刪 Alice 的筆記 → 404" 404 "$status"
req POST /applications '{"jobId":"'"$id"'"}'
check "Bob 替 Alice 的職缺建投遞 → 404" 404 "$status"
req GET /applications/stats
[[ "$(field total)" == "0" ]] || fail "Bob 的統計算到別人的投遞：$body"

JAR=$(jar alice)
req DELETE "/applications/$app/notes/$note"
check "刪除筆記" 204 "$status"
req POST /jobs '{"title":"後端工程師","company":"另一家"}'
job2=$(field id)
req POST /applications '{"jobId":"'"$job2"'","status":"APPLIED","appliedAt":"2026-10-01"}'
check "建立時直接指定已投與投遞日" 201 "$status"
app2=$(field id)
[[ "$body" == *'"appliedAt":"2026-10-01T00:00:00.000Z"'* ]] || fail "指定的投遞日被覆蓋：$body"
req DELETE "/jobs/$job2"
req GET "/applications/$app2"
check "刪除職缺時投遞一起刪除 → 404" 404 "$status"
req DELETE "/applications/$app"
check "刪除投遞" 204 "$status"
req GET "/jobs/$id"
[[ "$body" == *'"application":null'* ]] || fail "刪除投遞後職缺仍帶著投遞：$body"

# ---------- 登出 ----------
JAR=$(jar bob)
req POST /auth/logout
check "Bob 登出" 204 "$status"
req GET /auth/me
check "登出後 → 401" 401 "$status"
req POST /auth/refresh
check "登出後換發 → 401" 401 "$status"

# ---------- 改密碼：其他裝置一起登出 ----------
JAR=$(jar alice-phone)
req POST /auth/login '{"email":"'"$alice"'","password":"correct-horse-1"}'
check "Alice 在第二台裝置登入" 200 "$status"

JAR=$(jar alice)
req PATCH /auth/password '{"currentPassword":"wrong-password","newPassword":"new-horse-123"}'
check "改密碼時舊密碼打錯 → 403" 403 "$status"
req PATCH /auth/password '{"currentPassword":"correct-horse-1","newPassword":"new-horse-123"}'
check "改密碼" 204 "$status"
req GET /auth/me
check "改密碼的這台仍是登入狀態" 200 "$status"

JAR=$(jar alice-phone)
req POST /auth/refresh
check "另一台裝置的登入被作廢 → 401" 401 "$status"

JAR=$(jar anon)
req POST /auth/login '{"email":"'"$alice"'","password":"correct-horse-1"}'
check "舊密碼登入 → 401" 401 "$status"
req POST /auth/login '{"email":"'"$alice"'","password":"new-horse-123"}'
check "新密碼登入" 200 "$status"

# ---------- 刪帳號：職缺一起刪除 ----------
JAR=$(jar alice)
req DELETE /auth/me '{"password":"wrong-password"}'
check "刪帳號時密碼打錯 → 403" 403 "$status"
cp "$JAR" "$(jar alice-before-delete)"
req DELETE /auth/me '{"password":"new-horse-123"}'
check "刪除 Alice 的帳號" 204 "$status"

JAR=$(jar alice-before-delete)
req GET "/jobs/$id"
check "刪帳號後職缺跟著刪除（access token 未過期也查不到）→ 404" 404 "$status"
req POST /jobs '{"title":"x","company":"y"}'
check "刪帳號後用未過期的 access token 新增 → 401" 401 "$status"

JAR=$(jar anon)
req POST /auth/login '{"email":"'"$alice"'","password":"new-horse-123"}'
check "已刪除的帳號無法登入 → 401" 401 "$status"

JAR=$(jar bob)
req POST /auth/login '{"email":"'"$bob"'","password":"battery-staple-2"}'
req DELETE /auth/me '{"password":"battery-staple-2"}'
check "清掉 Bob 的帳號" 204 "$status"

echo "全部通過：$pass 項"
