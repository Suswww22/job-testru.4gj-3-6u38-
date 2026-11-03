// 爬蟲職缺轉成「新增職缺」的欄位：來源資料常有髒值，轉換時要修正到能通過 API 驗證。

import { describe, expect, it } from "vitest";

import { toJobInput } from "../src/import/search.js";
import { makeJob } from "./helpers.js";

describe("toJobInput", () => {
  it("externalId 沿用爬蟲的全域編號", () => {
    const j = makeJob();
    expect(toJobInput(j).externalId).toBe(j.id);
  });

  it("薪資上限比下限小時只留下限", () => {
    expect(toJobInput(makeJob({ salary: { min: 50000, max: 5000 } }))).toMatchObject({ salaryMin: 50000, salaryMax: null });
    expect(toJobInput(makeJob({ salary: { min: 40000, max: 60000 } }))).toMatchObject({ salaryMin: 40000, salaryMax: 60000 });
  });

  it("日期格式不對就不填", () => {
    expect(toJobInput(makeJob({ postedAt: "2026-11-01" })).postedAt).toBe("2026-11-01");
    expect(toJobInput(makeJob({ postedAt: "" })).postedAt).toBeNull();
    expect(toJobInput(makeJob({ postedAt: "115/11/01" })).postedAt).toBeNull();
  });

  it("過長的欄位會截斷，空白標籤會移除", () => {
    const r = toJobInput(makeJob({ title: "長".repeat(500), tags: ["", "  ", "遠端", "x".repeat(80)] }));
    expect(r.title).toHaveLength(200);
    expect(r.tags).toEqual(["遠端", "x".repeat(50)]);
  });

  it("工作內容與其他條件合併成描述", () => {
    expect(toJobInput(makeJob({ duties: ["開發網頁", "維護系統"] })).description).toBe("開發網頁\n維護系統");
  });
});
