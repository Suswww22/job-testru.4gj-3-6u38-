// 週報 Email 的內容：外部資料一律跳脫、只留 http(s) 連結、三區都在。寄送流程本身由 smoke 與線上實測涵蓋。

import { describe, expect, it } from "vitest";

import type { DigestData } from "../src/digest/generate.js";
import { renderDigestEmail } from "../src/digest/mail.js";

type TopJob = DigestData["topJobs"][number];
const topJob = (o: Partial<TopJob>): TopJob => ({
  source: "yourator", externalId: "yourator:1", sourceUrl: null, title: "前端工程師", company: "A 公司",
  region: null, address: "", nature: "全職", salaryKind: "面議", salaryMin: null, salaryMax: null, salaryNote: "",
  skills: [], tags: [], description: "", postedAt: null,
  score: 80, matchedSkills: [], missingSkills: [], reasons: [], ...o,
});
const empty: DigestData = { progress: { newTracked: 0, changes: [] }, followUps: [], topJobs: [], notes: [] };
const start = new Date("2026-10-26T00:00:00Z");
const end = new Date("2026-11-02T00:00:00Z");

describe("renderDigestEmail", () => {
  it("標題、公司名稱裡的 HTML 會被跳脫", () => {
    const m = renderDigestEmail({
      ...empty,
      progress: { newTracked: 1, changes: [{ title: "<script>alert(1)</script>", company: "A&B", from: null, to: "APPLIED", at: end.toISOString() }] },
      topJobs: [topJob({ title: '<img src=x onerror="1">' })],
    }, start, end);
    expect(m.html).not.toMatch(/<script|<img/);
    expect(m.html).toContain("&lt;script&gt;");
    expect(m.html).toContain("A&amp;B");
  });

  it("只輸出 http(s) 連結", () => {
    const m = renderDigestEmail({
      ...empty,
      topJobs: [
        topJob({ externalId: "a", title: "壞", sourceUrl: "javascript:alert(1)" }),
        topJob({ externalId: "b", title: "好", sourceUrl: "https://example.com/j?a=1&b=2" }),
      ],
    }, start, end);
    expect(m.html + m.text).not.toContain("javascript:");
    expect(m.html).toContain('href="https://example.com/j?a=1&amp;b=2"');
  });

  it("主旨與純文字版都有三區與數量", () => {
    const m = renderDigestEmail({
      ...empty,
      followUps: [{ applicationId: "app1", title: "後端", company: "C", appliedAt: null, idleDays: 9 }],
      topJobs: [topJob({})],
    }, start, end);
    expect(m.subject).toMatch(/待跟進 1、推薦 1$/);
    for (const s of ["【本週進度】", "【該跟進的投遞】", "【推薦職缺】", "已 9 天沒有進展"]) expect(m.text).toContain(s);
  });

  it("有網站網址才放連結，網址結尾的斜線不會重複", () => {
    const data = { ...empty, followUps: [{ applicationId: "app1", title: "後端", company: "C", appliedAt: null, idleDays: 9 }] };
    expect(renderDigestEmail(data, start, end).html).not.toContain("/applications/");
    const m = renderDigestEmail(data, start, end, "https://app.test/");
    expect(m.html).toContain('href="https://app.test/applications/app1"');
    expect(m.html).toContain('href="https://app.test/digest"');
  });

  it("沒有推薦時顯示原因，而不是空白", () => {
    expect(renderDigestEmail({ ...empty, notes: ["還沒填履歷"] }, start, end).text).toContain("還沒填履歷");
    expect(renderDigestEmail(empty, start, end).text).toContain("這週沒有 40 分以上的新職缺");
  });
});
