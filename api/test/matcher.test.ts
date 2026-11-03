// 履歷匹配的規則：年資解析、技能擷取、學歷、評分。
// 這些是純函式，前端（舊版網頁）與後端共用，改規則時最容易不小心改壞。

import { describe, expect, it } from "vitest";

import {
  classify, containsTerm, extractSkills, highestEducation, lowestEducation, matchJob, parseResume, parseYears,
} from "../../src/shared/matcher.js";
import { makeJob } from "./helpers.js";

describe("parseYears", () => {
  it.each<[string, number | null]>([
    ["4 年前端開發經驗", 4],
    ["3 年 React、Node.js 與 PostgreSQL 開發經驗", 3],
    ["具備 5年以上 Java 經驗", 5],
    ["經驗：2 年", 2],
    ["3+ years of experience", 3],
    // 年與經驗之間夾三項技能（31 字），曾因上限 30 字讀不到
    ["3 年 React、TypeScript、JavaScript 開發經驗", 3],
    ["需 2 年以上前端經驗\n學歷：大學以上", 2],
    // 以下不是年資
    ["2024年開始累積前端經驗", null],
    ["3 年前離職，之後累積 Python 經驗", null],
    ["負責門市銷售", null],
    ["2022 – 至今 前端工程師", null],
  ])("%j → %s", (text, want) => {
    expect(parseYears(text)).toBe(want);
  });

  it("多處提到年資時取最大值", () => {
    expect(parseYears("2 年 Vue 經驗，5 年以上 Java 經驗")).toBe(5);
  });
});

describe("containsTerm / extractSkills", () => {
  it("英文詞要整個字相符，不會在別的字裡誤判", () => {
    expect(containsTerm("javascript developer", "java")).toBe(false);
    expect(containsTerm("Java、Spring Boot", "java")).toBe(true);
  });

  it("中文詞直接比對，大小寫由 extractSkills 先統一成小寫", () => {
    expect(containsTerm("熟悉 go 語言", "go 語言")).toBe(true);
    expect(extractSkills("熟悉 Go 語言")).toContain("Go");
  });

  it("別名會對應到同一項技能", () => {
    expect(extractSkills("熟悉 ReactJS、Express 與 Postgres")).toEqual(expect.arrayContaining(["React", "Node.js", "SQL"]));
  });

  it("ts 不會從 tsmc 這類單字裡誤抓", () => {
    expect(extractSkills("tsmc 製程")).not.toContain("TypeScript");
  });
});

describe("學歷", () => {
  it("履歷取最高學歷", () => {
    expect(highestEducation("大學畢業，後取得碩士學位")).toBe("碩士");
    expect(highestEducation("沒有寫學歷")).toBeNull();
  });

  it("職缺取最低門檻；空白或不拘都是不拘", () => {
    expect(lowestEducation("大學、碩士")).toBe("大學");
    expect(lowestEducation("學歷不拘")).toBe("不拘");
    expect(lowestEducation("")).toBe("不拘");
  });
});

describe("classify", () => {
  it("職稱命中優先於描述", () => {
    const fe = classify("前端工程師", "");
    const be = classify("後端工程師", "與前端合作");
    expect(fe).not.toBeNull();
    expect(be).not.toBeNull();
    expect(be).not.toEqual(fe);
  });

  it("完全無關的文字回傳 null", () => {
    expect(classify("zzz", "qqq")).toBeNull();
  });
});

describe("parseResume", () => {
  it("從履歷抽出技能、年資、學歷、地區、職務", () => {
    const p = parseResume("前端工程師，3 年 React、TypeScript 開發經驗，大學資工系畢業，希望在台北工作");
    expect(p.skills).toEqual(expect.arrayContaining(["React", "TypeScript"]));
    expect(p.years).toBe(3);
    expect(p.education).toBe("大學");
    expect(p.regions).toContain("taipei");
    expect(p.subIds.length).toBeGreaterThan(0);
  });

  it("沒寫年資時用工作期間加總", () => {
    expect(parseResume("2019 - 2022 ABC 公司 前端").years).toBe(3);
  });
});

describe("matchJob", () => {
  const resume = parseResume("前端工程師，3 年 React、TypeScript、JavaScript 開發經驗，大學畢業，台北");

  it("分數在 0–100，列出符合與缺少的技能", () => {
    const r = matchJob(makeJob({ skills: ["React", "TypeScript", "Docker"] }), resume);
    expect(r.score).toBeGreaterThanOrEqual(0);
    expect(r.score).toBeLessThanOrEqual(100);
    expect(r.matchedSkills).toEqual(["React", "TypeScript"]);
    expect(r.missingSkills).toEqual(["Docker"]);
  });

  it("相關職缺的分數高於無關職缺", () => {
    const frontend = matchJob(makeJob({ title: "前端工程師", skills: ["React", "TypeScript"] }), resume).score;
    const java = matchJob(makeJob({ title: "Java 後端工程師", skills: ["Java", "SQL"] }), resume).score;
    const retail = matchJob(makeJob({ title: "門市銷售人員", skills: ["客戶服務"] }), resume).score;
    expect(frontend).toBeGreaterThan(java);
    expect(java).toBeGreaterThanOrEqual(retail);
    expect(frontend).toBeGreaterThanOrEqual(60);
  });

  it("年資、學歷、地區不符會打折並寫出原因", () => {
    const ok = matchJob(makeJob({ skills: ["React"] }), resume);
    const strict = matchJob(makeJob({ skills: ["React"], minYears: 6, education: "碩士", region: "kaohsiung" as never }), resume);
    expect(strict.score).toBeLessThan(ok.score);
    expect(strict.reasons).toEqual(expect.arrayContaining(["年資差 3 年", "學歷要求碩士以上", "地點不在偏好地區"]));
  });

  it("遠端職缺不算地點不符", () => {
    const r = matchJob(makeJob({ skills: ["React"], region: "remote" }), resume);
    expect(r.reasons).toContain("地點符合偏好");
  });

  it("沒列技能的職缺拿中間分，但低於週報推薦門檻 40 分", () => {
    const r = matchJob(makeJob({ title: "門市銷售人員", skills: [] }), resume);
    expect(r.score).toBeGreaterThan(0);
    expect(r.score).toBeLessThan(40);
  });

  it("只會通用技能（英文）不會跟所有職缺高度匹配", () => {
    const p = parseResume("英文流利");
    const r = matchJob(makeJob({ title: "前端工程師", skills: ["React", "英文"] }), p);
    expect(r.score).toBeLessThan(50);
  });
});
