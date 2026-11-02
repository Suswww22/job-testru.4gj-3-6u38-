// 職缺 CRUD：/api/jobs。每筆查詢都帶 userId 條件，之後換成 JWT 登入時只要改 currentUserId 的來源。

import { Prisma } from "@prisma/client";
import { Router } from "express";

import { prisma } from "../db.js";
import { currentUserId } from "../demoUser.js";
import { HttpError } from "../errors.js";
import { jobCreateSchema, jobUpdateSchema, listQuerySchema } from "./schema.js";

export const jobsRouter = Router();

async function findOwnedJob(id: string, userId: string) {
  const job = await prisma.job.findFirst({ where: { id, userId } });
  if (!job) throw new HttpError(404, "找不到這筆職缺");
  return job;
}

jobsRouter.get("/", async (req, res) => {
  const { q, region, source, limit, offset } = listQuerySchema.parse(req.query);
  const userId = await currentUserId();
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
    prisma.job.findMany({ where, orderBy: { createdAt: "desc" }, take: limit, skip: offset }),
    prisma.job.count({ where }),
  ]);
  res.json({ items, total, limit, offset });
});

jobsRouter.get("/:id", async (req, res) => {
  res.json(await findOwnedJob(req.params.id, await currentUserId()));
});

jobsRouter.post("/", async (req, res) => {
  const data = jobCreateSchema.parse(req.body);
  const job = await prisma.job.create({ data: { ...data, userId: await currentUserId() } });
  res.status(201).location(`/api/jobs/${job.id}`).json(job);
});

jobsRouter.patch("/:id", async (req, res) => {
  const data = jobUpdateSchema.parse(req.body);
  const userId = await currentUserId();
  const current = await findOwnedJob(req.params.id, userId);
  // 只改了其中一端時，要跟資料庫裡的另一端比
  const min = data.salaryMin !== undefined ? data.salaryMin : current.salaryMin;
  const max = data.salaryMax !== undefined ? data.salaryMax : current.salaryMax;
  if (min != null && max != null && min > max) throw new HttpError(400, "salaryMin 不可大於 salaryMax");
  res.json(await prisma.job.update({ where: { id: current.id }, data }));
});

jobsRouter.delete("/:id", async (req, res) => {
  const job = await findOwnedJob(req.params.id, await currentUserId());
  await prisma.job.delete({ where: { id: job.id } });
  res.status(204).end();
});
