# 求職追蹤前端。build context 是 job-finder/（型別與地區資料取自 src/shared）。
# 先用 node 打包成靜態檔，再交給 nginx：nginx 同時把 /api 轉給後端，瀏覽器看到的是同一個網站，cookie 才帶得上。

FROM node:22-bookworm-slim AS build
WORKDIR /app/web
COPY web/package.json web/package-lock.json ./
RUN npm ci
COPY tsconfig.base.json /app/
COPY src/shared /app/src/shared
COPY web/ ./
RUN npm run build

FROM nginx:1.27-alpine
COPY web/nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /app/web/dist /usr/share/nginx/html
