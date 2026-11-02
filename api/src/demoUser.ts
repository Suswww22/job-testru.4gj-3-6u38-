// 登入功能完成前，所有請求都當成這位 demo 使用者。加上 JWT 後改從 token 取得 userId。

import { prisma } from "./db.js";

export const DEMO_EMAIL = "demo@job-tracker.local";

let cachedId: string | null = null;

export async function currentUserId(): Promise<string> {
  if (cachedId) return cachedId;
  const user = await prisma.user.upsert({
    where: { email: DEMO_EMAIL },
    update: {},
    create: { email: DEMO_EMAIL, passwordHash: "!", name: "Demo" },
  });
  cachedId = user.id;
  return cachedId;
}
