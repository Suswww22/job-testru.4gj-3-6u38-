# 單一容器版（部署到 Render 用）：API 同時送出前端，整個網站只有一個網址。
# 本機用 docker compose 跑的是拆開的版本（api/Dockerfile、web/Dockerfile＋nginx）。
# 啟動時先套用資料庫遷移再開 API；免費方案沒有獨立的部署前步驟，所以放在啟動指令裡。

FROM node:22-bookworm-slim AS base
# Prisma 的查詢引擎需要 openssl
RUN apt-get update && apt-get install -y --no-install-recommends openssl && rm -rf /var/lib/apt/lists/*
COPY tsconfig.base.json /app/
COPY src/shared /app/src/shared

FROM base AS web
WORKDIR /app/web
COPY web/package.json web/package-lock.json ./
RUN npm ci
COPY web/ ./
RUN npm run build

FROM base AS api
WORKDIR /app/api
COPY api/package.json api/package-lock.json ./
RUN npm ci
COPY api/ ./
RUN npx prisma generate && npm run build

FROM node:22-bookworm-slim AS runtime
RUN apt-get update && apt-get install -y --no-install-recommends openssl && rm -rf /var/lib/apt/lists/*
ENV NODE_ENV=production WEB_DIST=/app/web/dist
WORKDIR /app/api
COPY api/package.json api/package-lock.json ./
RUN npm ci --omit=dev && npm cache clean --force
# Prisma client 是 generate 出來的程式碼，不在 npm 套件裡，從 api 階段帶過來
COPY --from=api /app/api/node_modules/.prisma ./node_modules/.prisma
COPY --from=api /app/api/dist ./dist
COPY api/prisma ./prisma
COPY --from=web /app/web/dist /app/web/dist
USER node
EXPOSE 3001
CMD ["sh", "-c", "npx prisma migrate deploy && exec node dist/api/src/index.js"]
