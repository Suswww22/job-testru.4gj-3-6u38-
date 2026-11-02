// 職缺輸入驗證。列舉值直接取自 src/shared，前端、爬蟲與 API 的認知一致。
// 沒傳的欄位交給資料庫預設值（schema.prisma 的 @default），所以這裡不設預設，PATCH 也就不會把沒傳的欄位蓋回預設。

import { z } from "zod";

import { REGIONS, SOURCES } from "../../../src/shared/data.js";
import type { JobNature, RegionId, Salary, SourceId } from "../../../src/shared/types.js";

type JobSource = SourceId | "manual";

const REGION_IDS = REGIONS.map((r) => r.id) as [RegionId, ...RegionId[]];
const SOURCE_IDS = ["manual", ...SOURCES.map((s) => s.id)] as [JobSource, ...JobSource[]];
const NATURES = ["全職", "兼職", "約聘", "實習", "其他"] as const satisfies readonly JobNature[];
const SALARY_KINDS = ["月薪", "年薪", "時薪", "日薪", "面議"] as const satisfies readonly Salary["kind"][];

const tagList = z.array(z.string().trim().min(1).max(50)).max(50);

const fields = {
  source: z.enum(SOURCE_IDS).optional(),
  externalId: z.string().max(200).nullish(),
  sourceUrl: z.string().url().max(2000).nullish(),
  title: z.string().trim().min(1).max(200),
  company: z.string().trim().min(1).max(200),
  region: z.enum(REGION_IDS).nullish(),
  address: z.string().max(300).optional(),
  nature: z.enum(NATURES).optional(),
  salaryKind: z.enum(SALARY_KINDS).optional(),
  salaryMin: z.number().int().nonnegative().nullish(),
  salaryMax: z.number().int().nonnegative().nullish(),
  salaryNote: z.string().max(300).optional(),
  skills: tagList.optional(),
  tags: tagList.optional(),
  description: z.string().max(20000).optional(),
  postedAt: z.coerce.date().nullish(),
};

const salaryRangeOk = (j: { salaryMin?: number | null | undefined; salaryMax?: number | null | undefined }) =>
  j.salaryMin == null || j.salaryMax == null || j.salaryMin <= j.salaryMax;
const salaryRangeError = { message: "salaryMin 不可大於 salaryMax", path: ["salaryMax"] };

export const jobCreateSchema = z.object(fields).strict().refine(salaryRangeOk, salaryRangeError);
export const jobUpdateSchema = z.object(fields).partial().strict().refine(salaryRangeOk, salaryRangeError);

export const listQuerySchema = z.object({
  q: z.string().max(100).optional(),
  region: z.enum(REGION_IDS).optional(),
  source: z.enum(SOURCE_IDS).optional(),
  limit: z.coerce.number().int().min(1).max(100).default(20),
  offset: z.coerce.number().int().min(0).default(0),
});
