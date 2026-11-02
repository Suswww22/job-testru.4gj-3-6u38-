# 求職追蹤 API。build context 是 job-finder/（要用到 src/shared）。
# build 階段：裝完整依賴、產生 Prisma client、把 TypeScript 編成 JS；compose 的 migrate 服務也用這個階段跑 prisma migrate deploy。
# runtime 階段：只裝正式依賴，用 node 直接跑編好的 JS，不帶 TypeScript 與 tsx。

FROM node:22-bookworm-slim AS base
# Prisma 的查詢引擎需要 openssl
RUN apt-get update && apt-get install -y --no-install-recommends openssl && rm -rf /var/lib/apt/lists/*
WORKDIR /app/api

FROM base AS build
COPY api/package.json api/package-lock.json ./
RUN npm ci
# 根目錄的 package.json 寫著 "type": "module"：少了它，tsc 會把 src/shared 編成 CommonJS，API 啟動時 import 不到
COPY package.json tsconfig.base.json /app/
COPY src/shared /app/src/shared
COPY src/server /app/src/server
COPY api/ ./
RUN npx prisma generate && npm run build

FROM base AS runtime
ENV NODE_ENV=production
COPY api/package.json api/package-lock.json ./
RUN npm ci --omit=dev && npm cache clean --force
# Prisma client 是 generate 出來的程式碼，不在 npm 套件裡，從 build 階段帶過來
COPY --from=build /app/api/node_modules/.prisma ./node_modules/.prisma
COPY --from=build /app/api/dist ./dist
USER node
EXPOSE 3001
CMD ["node", "dist/api/src/index.js"]
