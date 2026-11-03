// 每個測試一個全新帳號：在瀏覽器裡走一次註冊流程，測試結束後用 API 刪掉帳號（連同職缺、投遞一起刪）。

import { test as base, expect, type Page } from "@playwright/test";

export const PASSWORD = "e2e-password-123";

export async function register(page: Page, email: string) {
  await page.goto("/");
  await page.getByRole("tab", { name: "註冊" }).click();
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("名字（選填）").fill("E2E");
  await page.getByLabel("密碼").fill(PASSWORD);
  await page.getByRole("button", { name: "建立帳號" }).click();
  await expect(page.getByRole("button", { name: "登出" })).toBeVisible();
}

export const test = base.extend<{ email: string }>({
  email: async ({ page }, use, testInfo) => {
    const email = `e2e-${Date.now()}-${testInfo.workerIndex}-${Math.random().toString(36).slice(2, 8)}@example.test`;
    await use(email);
    // 測試中途失敗也要清掉帳號；page.request 會帶著瀏覽器的登入 cookie
    await page.request.delete("/api/auth/me", { data: { password: PASSWORD } }).catch(() => {});
  },
});

export { expect };
