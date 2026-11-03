import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useDeferredValue, useState, type FormEvent } from "react";

import { REGIONS } from "../../../src/shared/data";
import type { RegionId } from "../../../src/shared/types";
import { api, ApiError } from "../api/client";
import { STATUSES, type Job } from "../api/types";
import { Icon } from "../components/Icon";
import { ImportPanel } from "./ImportPanel";

const regionName = (id: RegionId | null) => REGIONS.find((r) => r.id === id)?.name ?? "";
const SOURCE_NAMES: Record<string, string> = { taiwanjobs: "台灣就業通", yourator: "Yourator" };
const statusLabel = (id: string) => STATUSES.find((s) => s.id === id)?.label ?? id;

export function salaryText(job: Pick<Job, "salaryKind" | "salaryMin" | "salaryMax">): string {
  const n = (v: number) => v.toLocaleString("zh-TW");
  if (job.salaryMin == null && job.salaryMax == null) return job.salaryKind;
  if (job.salaryMax == null) return `${job.salaryKind} ${n(job.salaryMin!)} 以上`;
  if (job.salaryMin == null) return `${job.salaryKind} 最高 ${n(job.salaryMax)}`;
  return `${job.salaryKind} ${n(job.salaryMin)}–${n(job.salaryMax)}`;
}

export function JobsPage() {
  const qc = useQueryClient();
  const [q, setQ] = useState("");
  const query = useDeferredValue(q.trim());
  const jobs = useQuery({ queryKey: ["jobs", query], queryFn: () => api.listJobs(query) });
  const [mode, setMode] = useState<"import" | "manual">("import");

  // 職缺與投遞互相影響（加入追蹤、刪職缺會連帶刪投遞），一起重新抓
  const refresh = () => qc.invalidateQueries({ predicate: (k) => ["jobs", "applications"].includes(String(k.queryKey[0])) });
  const track = useMutation({ mutationFn: api.createApplication, onSuccess: refresh });
  const remove = useMutation({ mutationFn: api.deleteJob, onSuccess: refresh });

  return (
    <section className="stack">
      <div className="row between">
        <h2>職缺 {jobs.data && <span className="muted">（{jobs.data.total}）</span>}</h2>
        <input className="search" type="search" placeholder="搜尋職稱、公司、技能" value={q} onChange={(e) => setQ(e.target.value)} />
      </div>

      <div className="tabs add-mode" role="tablist" aria-label="新增職缺的方式">
        {(["import", "manual"] as const).map((m) => (
          <button key={m} type="button" role="tab" aria-selected={mode === m} onClick={() => setMode(m)}>
            {m === "import" ? "從網站匯入" : "手動新增"}
          </button>
        ))}
      </div>
      {mode === "import" ? <ImportPanel onImported={refresh} /> : <NewJobForm onCreated={refresh} />}

      {jobs.isPending && <p className="muted">載入中…</p>}
      {jobs.isError && <p className="error">讀取失敗：{jobs.error.message}</p>}
      {jobs.data?.items.length === 0 && <p className="muted">{query ? "沒有符合的職缺" : "還沒有職缺，先在上面新增一筆"}</p>}

      <ul className="job-list">
        {jobs.data?.items.map((job) => (
          <li key={job.id} className="card job">
            <div className="job-main">
              <strong className="job-title">{job.sourceUrl ? <a href={job.sourceUrl} target="_blank" rel="noreferrer">{job.title}</a> : job.title}</strong>
              <span className="meta"><span><Icon name="building" />{job.company}</span></span>
              <span className="meta">
                {job.region && <span><Icon name="pin" />{regionName(job.region)}</span>}
                <span><Icon name="money" />{salaryText(job)}</span>
                {SOURCE_NAMES[job.source] && <span><Icon name="globe" />{SOURCE_NAMES[job.source]}</span>}
              </span>
              {job.skills.length > 0 && (
                <span className="chips">{job.skills.map((s) => <span key={s} className="chip">{s}</span>)}</span>
              )}
            </div>
            <div className="job-actions">
              {job.application ? (
                <span className={`badge s-${job.application.status}`}>{statusLabel(job.application.status)}</span>
              ) : (
                <button onClick={() => track.mutate(job.id)} disabled={track.isPending}>加入追蹤</button>
              )}
              <button
                className="ghost danger"
                aria-label={`刪除 ${job.title}`}
                onClick={() => confirm(`刪除「${job.title}」？投遞紀錄與筆記也會一起刪除。`) && remove.mutate(job.id)}
              >
                刪除
              </button>
            </div>
          </li>
        ))}
      </ul>
    </section>
  );
}

function NewJobForm({ onCreated }: { onCreated: () => void }) {
  const empty = { title: "", company: "", region: "", salaryMin: "", salaryMax: "", skills: "", sourceUrl: "" };
  const [f, setF] = useState(empty);
  const create = useMutation({
    mutationFn: api.createJob,
    onSuccess: () => {
      setF(empty);
      onCreated();
    },
  });
  const set = (k: keyof typeof empty) => (e: { target: { value: string } }) => setF({ ...f, [k]: e.target.value });
  const num = (v: string) => (v.trim() === "" ? null : Number(v));

  function submit(e: FormEvent) {
    e.preventDefault();
    const min = num(f.salaryMin);
    const max = num(f.salaryMax);
    create.mutate({
      title: f.title.trim(),
      company: f.company.trim(),
      region: (f.region || null) as RegionId | null,
      ...(min != null || max != null ? { salaryKind: "月薪" as const, salaryMin: min, salaryMax: max } : {}),
      skills: f.skills.split(/[,，、]/).map((s) => s.trim()).filter(Boolean),
      sourceUrl: f.sourceUrl.trim() || null,
    });
  }

  const err = create.error instanceof ApiError ? create.error.message : null;

  return (
    <form className="card new-job" onSubmit={submit}>
      <input placeholder="職稱 *" required value={f.title} onChange={set("title")} aria-label="職稱" />
      <input placeholder="公司 *" required value={f.company} onChange={set("company")} aria-label="公司" />
      <select value={f.region} onChange={set("region")} aria-label="地區">
        <option value="">地區</option>
        {REGIONS.map((r) => <option key={r.id} value={r.id}>{r.name}</option>)}
      </select>
      <input type="number" min={0} step={1000} placeholder="月薪下限" value={f.salaryMin} onChange={set("salaryMin")} aria-label="月薪下限" />
      <input type="number" min={0} step={1000} placeholder="月薪上限" value={f.salaryMax} onChange={set("salaryMax")} aria-label="月薪上限" />
      <input placeholder="技能（逗號分隔）" value={f.skills} onChange={set("skills")} aria-label="技能" />
      <input type="url" placeholder="職缺網址" value={f.sourceUrl} onChange={set("sourceUrl")} aria-label="職缺網址" />
      <button type="submit" disabled={create.isPending}>新增職缺</button>
      {err && <p className="error full" role="alert">{err}</p>}
    </form>
  );
}
