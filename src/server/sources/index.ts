// 已登記的來源。新增網站：寫一個 JobSourceAdapter，加進這個清單即可。

import type { SourceId } from "../../shared/types.js";
import type { JobSourceAdapter } from "./source.js";
import { taiwanJobs } from "./taiwanjobs.js";
import { yourator } from "./yourator.js";

export const ADAPTERS: ReadonlyMap<SourceId, JobSourceAdapter> = new Map(
  [taiwanJobs, yourator].map((a) => [a.id, a]),
);
