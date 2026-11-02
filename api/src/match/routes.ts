// 履歷匹配：/api/resume 存取履歷文字，/api/match 依履歷幫自己的每筆職缺打分。
// 評分沿用 src/shared/matcher.ts 的規則式演算法（技能、職務領域、年資、學歷、地區），每一分都說得出理由。
// 資料表只存了追蹤需要的欄位，年資、學歷、職務分類這些要求寫在職缺描述裡，匹配時用同一套函式從描述解析回來。

import type { Job as DbJob } from "@prisma/client";
import { Router } from "express";
import { z } from "zod";

import { classify, extractSkills, lowestEducation, matchJob, parseResume, parseYears } from "../../../src/shared/matcher.js";
import type { Job, JobNature, RegionId, Salary } from "../../../src/shared/types.js";
import { requireAuth, userIdOf } from "../auth/middleware.js";
import { prisma } from "../db.js";

export const matchRouter = Router();
matchRouter.use(requireAuth);

const resumeSchema = z.object({ content: z.string().max(20000) }).strict();

/** 只取描述裡寫到學歷的那幾行，避免公司介紹裡的「台灣大學合作」被當成學歷要求 */
function educationLines(description: string): string {
  return description.split("\n").filter((l) => /學歷|以上|畢業|degree/i.test(l)).join("\n");
}

/** 資料庫的職缺轉成 matcher 認得的 Job；技能用字典重新辨識，手動輸入的「react」「PostgreSQL」才能對上履歷的寫法 */
export function toMatchable(j: DbJob): Job {
  const text = [j.title, j.description, ...j.tags].join("\n");
  const cls = classify(j.title, [j.description, ...j.tags, ...j.skills].join(" "));
  return {
    id: j.id,
    source: "demo",
    sourceUrl: j.sourceUrl,
    detailLoaded: true,
    title: j.title,
    company: j.company,
    companyIntro: "",
    categoryId: cls?.categoryId ?? null,
    subId: cls?.subId ?? null,
    region: j.region as RegionId | null,
    address: j.address,
    nature: j.nature as JobNature,
    shift: "未提供",
    hours: "",
    leave: null,
    salary: { kind: j.salaryKind as Salary["kind"], min: j.salaryMin, max: j.salaryMax, note: j.salaryNote, perks: [] },
    duties: [],
    requirements: {
      minYears: parseYears(j.description) ?? 0,
      education: lowestEducation(educationLines(j.description)),
      skills: [...new Set([...extractSkills(j.skills.join(" ")), ...extractSkills(text)])],
      others: [],
    },
    tags: j.tags,
    otherBenefits: [],
    reviews: [],
    postedAt: "",
  };
}

async function resumeOf(userId: string) {
  const r = await prisma.resume.findUnique({ where: { userId } });
  return r && { content: r.content, updatedAt: r.updatedAt, profile: parseResume(r.content) };
}

matchRouter.get("/resume", async (req, res) => {
  res.json((await resumeOf(userIdOf(req))) ?? { content: "", updatedAt: null, profile: null });
});

matchRouter.put("/resume", async (req, res) => {
  const { content } = resumeSchema.parse(req.body);
  const userId = userIdOf(req);
  await prisma.resume.upsert({ where: { userId }, create: { userId, content }, update: { content } });
  res.json(await resumeOf(userId));
});

/** 自己每筆職缺的匹配結果，分數高到低；還沒填履歷時 profile 為 null、items 為空 */
matchRouter.get("/match", async (req, res) => {
  const userId = userIdOf(req);
  const resume = await resumeOf(userId);
  if (!resume || resume.content.trim() === "") {
    res.json({ profile: null, items: [] });
    return;
  }
  const jobs = await prisma.job.findMany({
    where: { userId },
    include: { application: { select: { id: true, status: true } } },
    orderBy: { createdAt: "desc" },
    take: 500,
  });
  const items = jobs
    .map((j) => {
      const { score, matchedSkills, missingSkills, reasons } = matchJob(toMatchable(j), resume.profile);
      const { application, id, title, company, region, sourceUrl, salaryKind, salaryMin, salaryMax } = j;
      return { job: { id, title, company, region, sourceUrl, salaryKind, salaryMin, salaryMax, application }, score, matchedSkills, missingSkills, reasons };
    })
    .sort((a, b) => b.score - a.score);
  res.json({ profile: resume.profile, items });
});
