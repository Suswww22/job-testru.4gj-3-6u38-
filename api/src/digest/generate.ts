// 產生一份週報（過去 7 天）：
// 1. 進度摘要：這段期間新增的追蹤、狀態變化（從 ApplicationEvent 算）
// 2. 該跟進的投遞：狀態停在「已投」超過 7 天
// 3. 新的高分職缺：用週報設定的關鍵字搜尋外部網站，以履歷評分；已在清單裡、或最近幾份週報推薦過的不再列出
// 內容存成 JSON 快照，之後職缺被刪或狀態改變，已產生的週報仍維持當時的樣子。

import { ApplicationStatus, type Prisma } from "@prisma/client";

import { matchJob, parseResume } from "../../../src/shared/matcher.js";
import type { Job, RegionId } from "../../../src/shared/types.js";
import { prisma } from "../db.js";
import { IMPORT_SOURCES, searchSource, toJobInput } from "../import/search.js";
import { mailEnabled, renderDigestEmail, sendMail } from "./mail.js";

const DAY = 24 * 60 * 60 * 1000;
const PERIOD_DAYS = 7;
const FOLLOW_UP_DAYS = 7;
const TOP_JOBS = 5;
/** 低於這個分數的職缺不推薦，寧缺勿濫 */
const MIN_SCORE = 40;
/** 最近幾份週報推薦過的職缺不再重複推薦 */
const SEEN_DIGESTS = 4;

export interface DigestData {
  progress: {
    newTracked: number;
    changes: { title: string; company: string; from: ApplicationStatus | null; to: ApplicationStatus; at: string }[];
  };
  followUps: { applicationId: string; title: string; company: string; appliedAt: string | null; idleDays: number }[];
  topJobs: (ReturnType<typeof toJobInput> & { score: number; matchedSkills: string[]; missingSkills: string[]; reasons: string[] })[];
  /** 沒有推薦職缺時說明原因（沒填履歷、沒設關鍵字、來源連不上…），而不是只給空清單 */
  notes: string[];
}

async function progressOf(userId: string, since: Date): Promise<DigestData["progress"]> {
  const [newTracked, events] = await Promise.all([
    prisma.application.count({ where: { userId, createdAt: { gte: since } } }),
    prisma.applicationEvent.findMany({
      where: { application: { userId }, createdAt: { gte: since }, fromStatus: { not: null } },
      include: { application: { select: { job: { select: { title: true, company: true } } } } },
      orderBy: { createdAt: "asc" },
    }),
  ]);
  return {
    newTracked,
    changes: events.map((e) => ({
      title: e.application.job.title,
      company: e.application.job.company,
      from: e.fromStatus,
      to: e.toStatus,
      at: e.createdAt.toISOString(),
    })),
  };
}

async function followUpsOf(userId: string, now: Date): Promise<DigestData["followUps"]> {
  const apps = await prisma.application.findMany({
    where: { userId, status: ApplicationStatus.APPLIED },
    include: {
      job: { select: { title: true, company: true } },
      events: { orderBy: { createdAt: "desc" }, take: 1, select: { createdAt: true } },
    },
  });
  return apps
    .map((a) => {
      // 最後一次狀態變化的時間；沒有歷程（理論上不會發生）就用建立時間
      const last = a.events[0]?.createdAt ?? a.createdAt;
      return {
        applicationId: a.id,
        title: a.job.title,
        company: a.job.company,
        appliedAt: a.appliedAt?.toISOString() ?? null,
        idleDays: Math.floor((now.getTime() - last.getTime()) / DAY),
      };
    })
    .filter((f) => f.idleDays >= FOLLOW_UP_DAYS)
    .sort((a, b) => b.idleDays - a.idleDays);
}

async function topJobsOf(userId: string, notes: string[]): Promise<DigestData["topJobs"]> {
  const [setting, resume, saved, recent] = await Promise.all([
    prisma.digestSetting.findUnique({ where: { userId } }),
    prisma.resume.findUnique({ where: { userId } }),
    prisma.job.findMany({ where: { userId, externalId: { not: null } }, select: { externalId: true } }),
    prisma.digest.findMany({ where: { userId }, orderBy: { createdAt: "desc" }, take: SEEN_DIGESTS, select: { data: true } }),
  ]);
  if (!resume || resume.content.trim() === "") {
    notes.push("還沒填履歷，所以沒有推薦職缺。到「履歷匹配」貼上履歷後，下週開始會依履歷推薦。");
    return [];
  }
  if (!setting || setting.keywords.length === 0) {
    notes.push("週報設定裡沒有搜尋關鍵字，所以沒有推薦職缺。");
    return [];
  }

  const skip = new Set(saved.map((s) => s.externalId));
  for (const d of recent) for (const j of (d.data as unknown as DigestData).topJobs ?? []) skip.add(j.externalId);

  const found = new Map<string, Job>();
  for (const keyword of setting.keywords) {
    for (const source of IMPORT_SOURCES) {
      try {
        for (const j of await searchSource(source, keyword, { regions: setting.region ? [setting.region as RegionId] : [], districts: [] })) found.set(j.id, j);
      } catch (err) {
        notes.push(err instanceof Error ? err.message : `${source} 搜尋失敗`);
      }
    }
  }

  const profile = parseResume(resume.content);
  return [...found.values()]
    .filter((j) => !skip.has(j.id))
    .map((j) => ({ j, m: matchJob(j, profile) }))
    .filter(({ m }) => m.score >= MIN_SCORE)
    .sort((a, b) => b.m.score - a.m.score)
    .slice(0, TOP_JOBS)
    .map(({ j, m }) => ({
      ...toJobInput(j),
      score: m.score,
      matchedSkills: [...m.matchedSkills],
      missingSkills: [...m.missingSkills],
      reasons: [...m.reasons],
    }));
}

export async function generateDigest(userId: string, now = new Date()) {
  const periodStart = new Date(now.getTime() - PERIOD_DAYS * DAY);
  const notes: string[] = [];
  const [progress, followUps, topJobs] = await Promise.all([
    progressOf(userId, periodStart),
    followUpsOf(userId, now),
    topJobsOf(userId, notes),
  ]);
  const data: DigestData = { progress, followUps, topJobs, notes };
  const digest = await prisma.digest.create({
    data: { userId, periodStart, periodEnd: now, data: data as unknown as Prisma.InputJsonValue },
  });
  return (await emailDigest(userId, digest.id, data, periodStart, now)) ?? digest;
}

/** 設定有開 Email 就寄出並記下寄出時間；寄信失敗只記 log，站內週報已經存好了 */
async function emailDigest(userId: string, digestId: string, data: DigestData, periodStart: Date, periodEnd: Date) {
  if (!mailEnabled()) return null;
  const user = await prisma.user.findUnique({ where: { id: userId }, select: { email: true, digestSetting: { select: { email: true } } } });
  if (!user?.digestSetting?.email) return null;
  try {
    await sendMail(user.email, renderDigestEmail(data, periodStart, periodEnd, process.env["APP_URL"]));
    return await prisma.digest.update({ where: { id: digestId }, data: { emailedAt: new Date() } });
  } catch (err) {
    console.error(`[digest-mail] ${userId} 寄送失敗：`, err);
    return null;
  }
}
