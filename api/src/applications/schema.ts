// 投遞與筆記的輸入驗證

import { ApplicationStatus } from "@prisma/client";
import { z } from "zod";

const status = z.enum(ApplicationStatus);

export const applicationCreateSchema = z.object({
  jobId: z.string().min(1).max(50),
  status: status.optional(),
  appliedAt: z.coerce.date().nullish(),
}).strict();

export const applicationUpdateSchema = z.object({
  status: status.optional(),
  appliedAt: z.coerce.date().nullish(),
}).strict();

export const applicationListQuerySchema = z.object({
  status: status.optional(),
});

export const noteSchema = z.object({
  content: z.string().trim().min(1, "筆記不可空白").max(5000),
}).strict();
