// 投遞追蹤：/api/applications。一個職缺最多一筆投遞；狀態每次改變都寫一筆 ApplicationEvent，之後的統計從歷程算。
// 狀態可以任意切換（被拒後又被找回去面試也是真的會發生），歷程會如實記下。

import { ApplicationStatus, Prisma } from "@prisma/client";
import { Router } from "express";

import { requireAuth, userIdOf } from "../auth/middleware.js";
import { prisma } from "../db.js";
import { HttpError } from "../errors.js";
import { applicationCreateSchema, applicationListQuerySchema, applicationUpdateSchema, noteSchema } from "./schema.js";

export const applicationsRouter = Router();
applicationsRouter.use(requireAuth);

const jobSummary = { select: { id: true, title: true, company: true, region: true, sourceUrl: true } } as const;

async function findOwnedApplication(id: string, userId: string) {
  const app = await prisma.application.findFirst({ where: { id, userId } });
  if (!app) throw new HttpError(404, "找不到這筆投遞");
  return app;
}

/** 第一次進到「已投」之後的狀態時，沒填投遞日就自動補今天 */
function autoAppliedAt(status: ApplicationStatus, current: Date | null | undefined): Date | undefined {
  return status !== ApplicationStatus.SAVED && current == null ? new Date() : undefined;
}

applicationsRouter.get("/", async (req, res) => {
  const { status } = applicationListQuerySchema.parse(req.query);
  const items = await prisma.application.findMany({
    where: { userId: userIdOf(req), ...(status && { status }) },
    include: { job: jobSummary, _count: { select: { notes: true } } },
    orderBy: { updatedAt: "desc" },
  });
  res.json({ items });
});

/** 各狀態的數量（沒有資料的狀態也回 0，前端畫圖不用補洞） */
applicationsRouter.get("/stats", async (req, res) => {
  const groups = await prisma.application.groupBy({
    by: ["status"],
    where: { userId: userIdOf(req) },
    _count: { _all: true },
  });
  const byStatus = Object.fromEntries(Object.values(ApplicationStatus).map((s) => [s, 0])) as Record<ApplicationStatus, number>;
  for (const g of groups) byStatus[g.status] = g._count._all;
  const total = Object.values(byStatus).reduce((a, b) => a + b, 0);
  res.json({ total, byStatus });
});

applicationsRouter.get("/:id", async (req, res) => {
  const app = await prisma.application.findFirst({
    where: { id: req.params.id, userId: userIdOf(req) },
    include: {
      job: true,
      notes: { orderBy: { createdAt: "desc" } },
      events: { orderBy: { createdAt: "asc" } },
    },
  });
  if (!app) throw new HttpError(404, "找不到這筆投遞");
  res.json(app);
});

applicationsRouter.post("/", async (req, res) => {
  const { jobId, status = ApplicationStatus.SAVED, appliedAt } = applicationCreateSchema.parse(req.body);
  const userId = userIdOf(req);
  // 只能替自己的職缺建投遞；別人的職缺當成不存在
  const job = await prisma.job.findFirst({ where: { id: jobId, userId }, select: { id: true } });
  if (!job) throw new HttpError(404, "找不到這筆職缺");
  // 同一個職缺重複建立時，jobId 的唯一限制會丟 P2002 → 409
  const app = await prisma.application.create({
    data: {
      userId,
      jobId,
      status,
      appliedAt: appliedAt ?? autoAppliedAt(status, null) ?? null,
      events: { create: { fromStatus: null, toStatus: status } },
    },
    include: { job: jobSummary },
  });
  res.status(201).location(`/api/applications/${app.id}`).json(app);
});

applicationsRouter.patch("/:id", async (req, res) => {
  const data = applicationUpdateSchema.parse(req.body);
  const current = await findOwnedApplication(req.params.id, userIdOf(req));
  const statusChanged = data.status !== undefined && data.status !== current.status;

  const update: Prisma.ApplicationUpdateInput = {};
  if (data.appliedAt !== undefined) update.appliedAt = data.appliedAt;
  if (statusChanged && data.status) {
    update.status = data.status;
    update.events = { create: { fromStatus: current.status, toStatus: data.status } };
    // 這次請求沒指定投遞日時才自動補
    if (data.appliedAt === undefined) {
      const auto = autoAppliedAt(data.status, current.appliedAt);
      if (auto) update.appliedAt = auto;
    }
  }

  const app = await prisma.application.update({ where: { id: current.id }, data: update, include: { job: jobSummary } });
  res.json(app);
});

applicationsRouter.delete("/:id", async (req, res) => {
  const app = await findOwnedApplication(req.params.id, userIdOf(req));
  await prisma.application.delete({ where: { id: app.id } });
  res.status(204).end();
});

// ---------- 筆記：/api/applications/:id/notes ----------

applicationsRouter.post("/:id/notes", async (req, res) => {
  const { content } = noteSchema.parse(req.body);
  const app = await findOwnedApplication(req.params.id, userIdOf(req));
  const note = await prisma.note.create({ data: { applicationId: app.id, content } });
  res.status(201).json(note);
});

async function findOwnedNote(applicationId: string, noteId: string, userId: string) {
  const note = await prisma.note.findFirst({ where: { id: noteId, applicationId, application: { userId } } });
  if (!note) throw new HttpError(404, "找不到這則筆記");
  return note;
}

applicationsRouter.patch("/:id/notes/:noteId", async (req, res) => {
  const { content } = noteSchema.parse(req.body);
  const note = await findOwnedNote(req.params.id, req.params.noteId, userIdOf(req));
  res.json(await prisma.note.update({ where: { id: note.id }, data: { content } }));
});

applicationsRouter.delete("/:id/notes/:noteId", async (req, res) => {
  const note = await findOwnedNote(req.params.id, req.params.noteId, userIdOf(req));
  await prisma.note.delete({ where: { id: note.id } });
  res.status(204).end();
});
