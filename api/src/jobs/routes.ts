// 職缺 CRUD：/api/jobs。整個 router 需要登入，每筆查詢都帶 userId 條件，別人的職缺一律當成不存在（404）。

import { Prisma } from "@prisma/client";
import { Router } from "express";

import { requireAuth, userIdOf } from "../auth/middleware.js";
import { prisma } from "../db.js";
import { HttpError } from "../errors.js";
import { jobCreateSchema, jobUpdateSchema, listQuerySchema } from "./schema.js";

export const jobsRouter = Router();
jobsRouter.use(requireAuth);

// 回傳職缺時順便帶上投遞狀態，前端列職缺時不用再另外查
const withApplication = { application: { select: { id: true, status: true } } } as const;

async function findOwnedJob(id: string, userId: string) {
  const job = await prisma.job.findFirst({ where: { id, userId }, include: withApplication });
  if (!job) throw new HttpError(404, "找不到這筆職缺");
  return job;
}

jobsRouter.get("/", async (req, res) => {
  const { q, region, source, limit, offset } = listQuerySchema.parse(req.query);
  const userId = userIdOf(req);
  const where: Prisma.JobWhereInput = {
    userId,
    ...(region && { region }),
    ...(source && { source }),
    ...(q && {
      OR: [
        { title: { contains: q, mode: "insensitive" } },
        { company: { contains: q, mode: "insensitive" } },
        { skills: { has: q } },
      ],
    }),
  };
  const [items, total] = await prisma.$transaction([
    prisma.job.findMany({ where, include: withApplication, orderBy: { createdAt: "desc" }, take: limit, skip: offset }),
    prisma.job.count({ where }),
  ]);
  res.json({ items, total, limit, offset });
});

jobsRouter.get("/:id", async (req, res) => {
  res.json(await findOwnedJob(req.params.id, userIdOf(req)));
});

jobsRouter.post("/", async (req, res) => {
  const data = jobCreateSchema.parse(req.body);
  const job = await prisma.job.create({ data: { ...data, userId: userIdOf(req) } });
  res.status(201).location(`/api/jobs/${job.id}`).json(job);
});

jobsRouter.patch("/:id", async (req, res) => {
  const data = jobUpdateSchema.parse(req.body);
  const userId = userIdOf(req);
  const current = await findOwnedJob(req.params.id, userId);
  // 只改了其中一端時，要跟資料庫裡的另一端比
  const min = data.salaryMin !== undefined ? data.salaryMin : current.salaryMin;
  const max = data.salaryMax !== undefined ? data.salaryMax : current.salaryMax;
  if (min != null && max != null && min > max) throw new HttpError(400, "salaryMin 不可大於 salaryMax");
  res.json(await prisma.job.update({ where: { id: current.id }, data }));
});

jobsRouter.delete("/:id", async (req, res) => {
  const job = await findOwnedJob(req.params.id, userIdOf(req));
  await prisma.job.delete({ where: { id: job.id } });
  res.status(204).end();
});
