// 週報：上方是設定（開關、最多 3 個關鍵字、地區）與「立即產生」；下方是週報列表，最新一份展開。
// 週報內容由後端產生（每週排程或手動），這裡只負責呈現；推薦職缺可以直接加入自己的清單。

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useState, type FormEvent } from "react";
import { Link } from "react-router-dom";

import { REGIONS } from "../../../src/shared/data";
import type { RegionId } from "../../../src/shared/types";
import { api, ApiError } from "../api/client";
import { STATUSES, type ApplicationStatus, type Digest, type DigestData } from "../api/types";
import { salaryText } from "./JobsPage";

const label = (s: ApplicationStatus | null) => (s ? STATUSES.find((x) => x.id === s)?.label ?? s : "開始追蹤");
const day = (iso: string) => new Date(iso).toLocaleDateString("zh-TW", { month: "numeric", day: "numeric" });

export function DigestPage() {
  const qc = useQueryClient();
  const digests = useQuery({ queryKey: ["digests"], queryFn: api.listDigests });
  const generate = useMutation({
    mutationFn: api.generateDigest,
    onSuccess: (d) => qc.setQueryData<{ items: Digest[] }>(["digests"], (old) => ({ items: [d, ...(old?.items ?? [])] })),
  });

  return (
    <section className="stack digest-page">
      <Settings />
      <div className="row between">
        <h2>週報</h2>
        <button className="ghost" onClick={() => generate.mutate()} disabled={generate.isPending}>
          {generate.isPending ? "產生中…" : "立即產生一份"}
        </button>
      </div>
      {generate.isError && <p className="error" role="alert">{generate.error.message}</p>}
      {digests.isPending && <p className="muted">載入中…</p>}
      {digests.isError && <p className="error">讀取失敗：{digests.error.message}</p>}
      {digests.data?.items.length === 0 && <p className="muted">還沒有週報。開啟週報後每週一早上自動產生，也可以按「立即產生一份」。</p>}
      {digests.data?.items.map((d, i) => (
        <details key={d.id} className="card digest" open={i === 0}>
          <summary>
            <strong>{day(d.periodStart)} – {day(d.periodEnd)}</strong>
            <span className="muted small">{summaryLine(d.data)}</span>
          </summary>
          <DigestBody data={d.data} />
        </details>
      ))}
    </section>
  );
}

function summaryLine(d: DigestData): string {
  return [`狀態變化 ${d.progress.changes.length}`, `待跟進 ${d.followUps.length}`, `推薦 ${d.topJobs.length}`].join(" · ");
}

function Settings() {
  const qc = useQueryClient();
  const settings = useQuery({ queryKey: ["digest-settings"], queryFn: api.digestSettings });
  const [f, setF] = useState({ enabled: false, keywords: "", region: "" as RegionId | "" });
  useEffect(() => {
    if (settings.data) setF({ enabled: settings.data.enabled, keywords: settings.data.keywords.join("、"), region: settings.data.region ?? "" });
  }, [settings.data]);
  const save = useMutation({
    mutationFn: api.saveDigestSettings,
    onSuccess: (s) => qc.setQueryData(["digest-settings"], s),
  });

  function submit(e: FormEvent) {
    e.preventDefault();
    const keywords = f.keywords.split(/[,，、\s]+/).map((k) => k.trim()).filter(Boolean);
    save.mutate({ enabled: f.enabled, keywords, region: f.region || null });
  }

  if (settings.isPending) return null;
  const err = save.error instanceof ApiError ? save.error.message : null;
  return (
    <form className="card digest-settings" onSubmit={submit}>
      <label className="switch">
        <input type="checkbox" checked={f.enabled} onChange={(e) => setF({ ...f, enabled: e.target.checked })} />
        每週一早上自動產生週報
      </label>
      <input
        value={f.keywords}
        onChange={(e) => setF({ ...f, keywords: e.target.value })}
        placeholder="推薦職缺的搜尋關鍵字，最多 3 個，例如：前端、React"
        aria-label="搜尋關鍵字"
      />
      <select value={f.region} onChange={(e) => setF({ ...f, region: e.target.value as RegionId | "" })} aria-label="地區">
        <option value="">全部地區</option>
        {REGIONS.map((r) => <option key={r.id} value={r.id}>{r.name}</option>)}
      </select>
      <button disabled={save.isPending}>{save.isSuccess && !save.isPending ? "已儲存" : "儲存設定"}</button>
      {err && <p className="error full" role="alert">{err.includes("輸入格式") ? "關鍵字最多 3 個，每個 30 字以內" : err}</p>}
    </form>
  );
}

function DigestBody({ data }: { data: DigestData }) {
  const qc = useQueryClient();
  const [added, setAdded] = useState<Set<string>>(new Set());
  const add = useMutation({
    mutationFn: ({ score: _s, matchedSkills: _m, missingSkills: _x, reasons: _r, ...input }: DigestData["topJobs"][number]) => api.createJob(input),
    onSettled: (_d, e, job) => {
      // 409 代表已經在清單裡，一樣標成已加入
      if (!e || (e instanceof ApiError && e.status === 409)) setAdded((s) => new Set(s).add(job.externalId));
      void qc.invalidateQueries({ queryKey: ["jobs"] });
    },
  });
  const { progress, followUps, topJobs, notes } = data;

  return (
    <div className="stack digest-body">
      <section>
        <h3>本週進度</h3>
        <p className="muted small">新增追蹤 {progress.newTracked} 筆</p>
        {progress.changes.length === 0 ? (
          <p className="muted small">這週沒有狀態變化</p>
        ) : (
          <ul className="plain">
            {progress.changes.map((c, i) => (
              <li key={i}>
                {c.title}<span className="muted">（{c.company}）</span> {label(c.from)} → <span className={`s-${c.to} status-text`}>{label(c.to)}</span>
                <span className="muted small"> · {day(c.at)}</span>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section>
        <h3>該跟進的投遞</h3>
        {followUps.length === 0 ? (
          <p className="muted small">沒有超過 7 天沒消息的投遞</p>
        ) : (
          <ul className="plain">
            {followUps.map((f) => (
              <li key={f.applicationId}>
                <Link to={`/applications/${f.applicationId}`}>{f.title}</Link>
                <span className="muted">（{f.company}）</span> 已 {f.idleDays} 天沒有進展
              </li>
            ))}
          </ul>
        )}
      </section>

      <section>
        <h3>推薦職缺</h3>
        {topJobs.length > 0 && (
          <ul className="plain recs">
            {topJobs.map((j) => (
              <li key={j.externalId} className="row between">
                <div className="job-main">
                  <span>
                    <strong className="rec-score">{j.score}</strong>{" "}
                    {j.sourceUrl ? <a href={j.sourceUrl} target="_blank" rel="noreferrer">{j.title}</a> : j.title}
                  </span>
                  <span className="muted small">
                    {[j.company, salaryText({ salaryKind: j.salaryKind ?? "面議", salaryMin: j.salaryMin ?? null, salaryMax: j.salaryMax ?? null })].join(" · ")}
                    {j.matchedSkills.length > 0 && ` · 符合 ${j.matchedSkills.join("、")}`}
                  </span>
                </div>
                {added.has(j.externalId) ? (
                  <span className="muted small">已加入</span>
                ) : (
                  <button className="ghost" onClick={() => add.mutate(j)} disabled={add.isPending && add.variables?.externalId === j.externalId}>加入</button>
                )}
              </li>
            ))}
          </ul>
        )}
        {topJobs.length === 0 && notes.length === 0 && <p className="muted small">這週沒有 40 分以上的新職缺</p>}
        {notes.map((n, i) => <p key={i} className="muted small">{n}</p>)}
      </section>
    </div>
  );
}
