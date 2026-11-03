// 主要流程：註冊 → 手動新增職缺 → 加入追蹤 → 在看板上移動（滑鼠與鍵盤）→ 詳情頁看到狀態歷程 → 統計

import type { Page } from "@playwright/test";

import { expect, register, test } from "./fixtures";

/** 上方選單的連結；頁面內文也可能有同名連結（例如看板空白時的「職缺」） */
const nav = (page: Page, name: string) => page.getByRole("navigation").getByRole("link", { name, exact: true });

async function addTrackedJob(page: Page, title: string) {
  await nav(page, "職缺").click();
  await page.getByRole("tab", { name: "手動新增" }).click();
  await page.getByLabel("職稱").fill(title);
  await page.getByLabel("公司").fill("E2E 公司");
  await page.getByLabel("技能").fill("React, TypeScript");
  await page.getByRole("button", { name: "新增職缺" }).click();
  const row = page.locator("li.job", { hasText: title });
  await expect(row).toBeVisible();
  await row.getByRole("button", { name: "加入追蹤" }).click();
  await expect(row.getByRole("button", { name: "加入追蹤" })).toHaveCount(0);
}

/**
 * 用空白鍵拿起卡片。dnd-kit 處理這次按鍵時用 setTimeout(0) 才開始監聽方向鍵，
 * 太快按下一個鍵會被吞掉（CI 機器上偶爾發生）。看到播報後在頁面裡再排一個 setTimeout(0)，
 * 計時器依序執行，它跑完時 dnd-kit 一定已經在監聽了。
 */
async function pickUp(page: Page, title: string) {
  await page.getByRole("button", { name: `移動「${title}」` }).focus();
  await page.keyboard.press("Space");
  await expect(page.getByRole("status")).toContainText(`「${title}」移到收藏`);
  await page.evaluate(() => new Promise((r) => setTimeout(r, 0)));
}

const column = (page: Page, label: string) =>
  page.locator(".column").filter({ has: page.getByRole("heading", { name: new RegExp(`^${label}`) }) });

test("註冊後新增職缺並加入追蹤，看板上出現在「收藏」", async ({ page, email }) => {
  await register(page, email);
  await addTrackedJob(page, "E2E 前端工程師");

  await nav(page, "投遞看板").click();
  await expect(column(page, "收藏").getByText("E2E 前端工程師")).toBeVisible();
});

test("用滑鼠把卡片拖到「已投」，重新整理後仍在", async ({ page, email }) => {
  await register(page, email);
  await addTrackedJob(page, "E2E 滑鼠拖曳");
  await nav(page, "投遞看板").click();

  const card = column(page, "收藏").locator(".card.kanban", { hasText: "E2E 滑鼠拖曳" });
  const target = column(page, "已投");
  // 分段移動：dnd-kit 要移動超過 5px 才算開始拖曳
  const from = (await card.boundingBox())!;
  const to = (await target.boundingBox())!;
  await page.mouse.move(from.x + 20, from.y + from.height / 2);
  await page.mouse.down();
  await page.mouse.move(from.x + 40, from.y + from.height / 2, { steps: 5 });
  await page.mouse.move(to.x + to.width / 2, to.y + 60, { steps: 10 });
  await page.mouse.up();

  await expect(target.getByText("E2E 滑鼠拖曳")).toBeVisible();
  await page.reload();
  await expect(column(page, "已投").getByText("E2E 滑鼠拖曳")).toBeVisible();
});

test("只用鍵盤把卡片移到「已投」", async ({ page, email }) => {
  await register(page, email);
  await addTrackedJob(page, "E2E 鍵盤拖曳");
  await nav(page, "投遞看板").click();

  // 每按一次方向鍵跳一欄：收藏 → 已投 → 面試 → 已投；每一步確認螢幕閱讀器的播報
  await pickUp(page, "E2E 鍵盤拖曳");
  const status = page.getByRole("status");
  await page.keyboard.press("ArrowRight");
  await expect(status).toContainText("移到已投");
  await page.keyboard.press("ArrowRight");
  await expect(status).toContainText("移到面試");
  await page.keyboard.press("ArrowLeft");
  await expect(status).toContainText("移到已投");
  await page.keyboard.press("Space");
  await expect(status).toContainText("「E2E 鍵盤拖曳」放到已投");

  await expect(column(page, "已投").getByText("E2E 鍵盤拖曳")).toBeVisible();
  await page.reload();
  await expect(column(page, "已投").getByText("E2E 鍵盤拖曳")).toBeVisible();
});

test("鍵盤拖曳按 Esc 取消，卡片留在原欄", async ({ page, email }) => {
  await register(page, email);
  await addTrackedJob(page, "E2E 取消拖曳");
  await nav(page, "投遞看板").click();

  await pickUp(page, "E2E 取消拖曳");
  const status = page.getByRole("status");
  await page.keyboard.press("ArrowRight");
  await expect(status).toContainText("移到已投");
  await page.keyboard.press("Escape");
  await expect(status).toContainText("取消移動");

  await expect(column(page, "收藏").getByText("E2E 取消拖曳")).toBeVisible();
});

test("改狀態後詳情頁有歷程，統計頁有數字", async ({ page, email }) => {
  await register(page, email);
  await addTrackedJob(page, "E2E 詳情");
  await nav(page, "投遞看板").click();
  await page.getByRole("link", { name: "E2E 詳情" }).click();

  await page.getByRole("button", { name: "已投", exact: true }).click();
  await expect(page.getByText(/收藏\s*→\s*已投/)).toBeVisible();

  await nav(page, "統計").click();
  await expect(page.getByText("E2E 詳情")).toHaveCount(0);
  await expect(page.locator("main")).toContainText("1");
});
