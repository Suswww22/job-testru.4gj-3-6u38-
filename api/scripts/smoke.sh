#!/usr/bin/env bash
# 職缺 CRUD 冒煙測試：用 curl 打一輪新增 → 查詢 → 修改 → 刪除，以及幾個錯誤情境。
# 用法：先 npm run db 與 npm start，再執行 bash scripts/smoke.sh

set -euo pipefail
API="${API:-http://localhost:3001/api}"
pass=0

check() { # check <說明> <預期狀態碼> <實際狀態碼>
  if [[ "$2" == "$3" ]]; then echo "✔ $1 ($3)"; pass=$((pass + 1)); else echo "✘ $1：預期 $2，實際 $3"; exit 1; fi
}
req() { # req <method> <path> [json] → body 存在 $body，狀態碼存在 $status
  local out
  # JSON 從 stdin 送：Windows 上把中文當命令列參數傳給 curl 會被轉成系統碼頁而變亂碼
  out=$(printf '%s' "${3:-}" | curl -s -w '\n%{http_code}' -X "$1" "$API$2" -H 'Content-Type: application/json' ${3:+--data-binary @-})
  status="${out##*$'\n'}"
  body="${out%$'\n'*}"
}

req GET /health
check "健康檢查" 200 "$status"

req POST /jobs '{"title":"全端工程師","company":"範例科技","region":"taoyuan","salaryKind":"月薪","salaryMin":55000,"salaryMax":75000,"skills":["React","Node.js","PostgreSQL"]}'
check "新增職缺" 201 "$status"
id=$(node -e 'process.stdout.write(JSON.parse(process.argv[1]).id)' "$body")

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

req POST /jobs '{"title":"x","company":"y","hacker":true}'
check "未知欄位 → 400" 400 "$status"

req POST /jobs '{"title":"重複","company":"y","externalId":"yourator:dup-'"$id"'"}'
check "帶 externalId 新增" 201 "$status"
dup=$(node -e 'process.stdout.write(JSON.parse(process.argv[1]).id)' "$body")
req POST /jobs '{"title":"重複","company":"y","externalId":"yourator:dup-'"$id"'"}'
check "同一 externalId 再新增 → 409" 409 "$status"

req DELETE "/jobs/$id"
check "刪除" 204 "$status"
req DELETE "/jobs/$dup"
req GET "/jobs/$id"
check "刪除後查不到 → 404" 404 "$status"

echo "全部通過：$pass 項"
