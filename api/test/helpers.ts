// 測試用的職缺工廠：只填測試在意的欄位，其餘給合理預設值。

import type { SkillName } from "../../src/shared/data.js";
import { classify } from "../../src/shared/matcher.js";
import type { Education, Job } from "../../src/shared/types.js";

export interface JobOverrides {
  title?: string;
  skills?: SkillName[];
  minYears?: number;
  education?: Education;
  region?: Job["region"];
  salary?: Partial<Job["salary"]>;
  postedAt?: string;
  duties?: string[];
  tags?: string[];
}

let seq = 0;

export function makeJob(o: JobOverrides = {}): Job {
  const title = o.title ?? "前端工程師";
  const cat = classify(title, "");
  return {
    id: `demo:${++seq}`,
    source: "demo",
    sourceUrl: "https://example.com/job",
    detailLoaded: true,
    title,
    company: "測試公司",
    companyIntro: "",
    categoryId: cat?.categoryId ?? null,
    subId: cat?.subId ?? null,
    region: o.region === undefined ? "taipei" : o.region,
    address: "",
    nature: "全職",
    shift: "日班",
    hours: "",
    leave: null,
    salary: { kind: "月薪", min: 50000, max: 70000, note: "", perks: [], ...o.salary },
    duties: o.duties ?? [],
    requirements: { minYears: o.minYears ?? 0, education: o.education ?? "不拘", skills: o.skills ?? [], others: [] },
    tags: o.tags ?? [],
    otherBenefits: [],
    reviews: [],
    postedAt: o.postedAt ?? "2026-11-01",
  };
}
