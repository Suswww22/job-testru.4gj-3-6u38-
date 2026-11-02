#!/usr/bin/env bash
# API 冒煙測試：用 curl 跑一輪註冊登入 → 職缺 CRUD → 兩個使用者的資料隔離，以及幾個錯誤情境。
# 用法：先 npm run db 與 npm start，再執行 bash scripts/smoke.sh

set -euo pipefail
API="${API:-http://localhost:3001/api}"
TOKEN=""
pass=0

check() { # check <說明> <預期狀態碼> <實際狀態碼>
  if [[ "$2" == "$3" ]]; then echo "✔ $1 ($3)"; pass=$((pass + 1)); else echo "✘ $1：預期 $2，實際 $3 $body"; exit 1; fi
}
req() { # req <method> <path> [json] → body 存在 $body，狀態碼存在 $status；有 $TOKEN 就帶上
  local out auth=()
  [[ -n "$TOKEN" ]] && auth=(-H "Authorization: Bearer $TOKEN")
  # JSON 從 stdin 送：Windows 上把中文當命令列參數傳給 curl 會被轉成系統碼頁而變亂碼
  out=$(printf '%s' "${3:-}" | curl -s -w '\n%{http_code}' -X "$1" "$API$2" -H 'Content-Type: application/json' \
    "${auth[@]}" ${3:+--data-binary @-})
  status="${out##*$'\n'}"
  body="${out%$'\n'*}"
}
field() { node -e 'process.stdout.write(String(JSON.parse(process.argv[1])[process.argv[2]]))' "$body" "$1"; }

req GET /health
check "健康檢查" 200 "$status"

# ---------- 註冊登入 ----------
run=$(date +%s%N)
alice="alice-$run@example.com"
bob="bob-$run@example.com"

req POST /auth/register '{"email":"'"$alice"'","password":"short"}'
check "密碼太短 → 400" 400 "$status"

req POST /auth/register '{"email":"'"$alice"'","password":"correct-horse-1","name":"Alice"}'
check "註冊 Alice" 201 "$status"
[[ "$body" != *passwordHash* ]] || { echo "✘ 回應洩漏 passwordHash"; exit 1; }

req POST /auth/register '{"email":"'"${alice^^}"'","password":"another-pass-1"}'
check "同 email（大小寫不同）重複註冊 → 409" 409 "$status"

req POST /auth/login '{"email":"'"$alice"'","password":"wrong-password"}'
check "密碼錯誤 → 401" 401 "$status"

req POST /auth/login '{"email":"nobody-'"$run"'@example.com","password":"whatever-123"}'
check "帳號不存在 → 401" 401 "$status"

req POST /auth/login '{"email":"'"$alice"'","password":"correct-horse-1"}'
check "登入 Alice" 200 "$status"
alice_token=$(field token)

req GET /jobs
check "沒帶 token → 401" 401 "$status"

TOKEN="not.a.jwt"
req GET /jobs
check "亂寫的 token → 401" 401 "$status"

TOKEN="$alice_token"
req GET /auth/me
check "查詢自己" 200 "$status"
[[ "$body" == *"$alice"* ]] || { echo "✘ /auth/me 不是 Alice"; exit 1; }

# ---------- 職缺 CRUD（以 Alice 身分） ----------
req POST /jobs '{"title":"全端工程師","company":"範例科技","region":"taoyuan","salaryKind":"月薪","salaryMin":55000,"salaryMax":75000,"skills":["React","Node.js","PostgreSQL"]}'
check "新增職缺" 201 "$status"
id=$(field id)

req GET "/jobs/$id"
check "取得單筆" 200 "$status"

req GET "/jobs?q=React&region=taoyuan"
check "搜尋（技能＋地區）" 200 "$status"
[[ "$body" == *"$id"* ]] || { echo "✘ 搜尋結果沒有剛新增的職缺"; exit 1; }

req PATCH "/jobs/$id" '{"salaryMax":80000,"tags":["遠端可議"]}'
check "部分更新" 200 "$status"
[[ "$body" == *'"salaryMax":80000'* && "$body" == *'"title":"全端工程師"'* && "$body" == *'"salaryMin":55000'* ]] \
  || { echo "✘ PATCH 後其他欄位被改動：$body"; exit 1; }

req PATCH "/jobs/$id" '{"salaryMin":90000}'
check "薪資下限大於資料庫裡的上限 → 400" 400 "$status"

req POST /jobs '{"company":"缺標題"}'
check "缺必填欄位 → 400" 400 "$status"

req POST /jobs '{"title":"x","company":"y","userId":"someone-else"}'
check "想自己指定 userId → 400" 400 "$status"

req POST /jobs '{"title":"重複","company":"y","externalId":"yourator:dup-'"$run"'"}'
check "帶 externalId 新增" 201 "$status"
dup=$(field id)
req POST /jobs '{"title":"重複","company":"y","externalId":"yourator:dup-'"$run"'"}'
check "同一 externalId 再新增 → 409" 409 "$status"

# ---------- 資料隔離：Bob 看不到也動不了 Alice 的職缺 ----------
TOKEN=""
req POST /auth/register '{"email":"'"$bob"'","password":"battery-staple-2"}'
check "註冊 Bob" 201 "$status"
TOKEN=$(field token)

req GET /jobs
check "Bob 的列表" 200 "$status"
[[ "$(field total)" == "0" ]] || { echo "✘ Bob 看到了別人的職缺：$body"; exit 1; }

req GET "/jobs/$id"
check "Bob 讀 Alice 的職缺 → 404" 404 "$status"
req PATCH "/jobs/$id" '{"title":"被改了"}'
check "Bob 改 Alice 的職缺 → 404" 404 "$status"
req DELETE "/jobs/$id"
check "Bob 刪 Alice 的職缺 → 404" 404 "$status"

req POST /jobs '{"title":"重複","company":"y","externalId":"yourator:dup-'"$run"'"}'
check "Bob 用同一 externalId 新增（各自獨立）" 201 "$status"
req DELETE "/jobs/$(field id)"

# ---------- 收尾（以 Alice 身分） ----------
TOKEN="$alice_token"
req GET "/jobs/$id"
[[ "$body" == *'"title":"全端工程師"'* ]] || { echo "✘ Alice 的職缺被 Bob 改到了"; exit 1; }

req DELETE "/jobs/$id"
check "刪除" 204 "$status"
req DELETE "/jobs/$dup"
req GET "/jobs/$id"
check "刪除後查不到 → 404" 404 "$status"

echo "全部通過：$pass 項"
