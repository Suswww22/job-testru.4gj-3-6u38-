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

# ---------- 登出 ----------
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
