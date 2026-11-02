// 履歷匹配：左邊貼履歷、看系統辨識出什麼；右邊是自己的職缺依匹配分數排序，附上符合／缺少的技能與評分理由。
// 分數由後端計算（src/shared/matcher.ts 的規則式評分），前端只負責呈現。

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useState, type FormEvent } from "react";
import { Link } from "react-router-dom";

import { REGIONS } from "../../../src/shared/data";
import type { RegionId, ResumeProfile } from "../../../src/shared/types";
import { api } from "../api/client";
import { STATUSES, type MatchItem } from "../api/types";
import { salaryText } from "./JobsPage";

const regionName = (id: RegionId | null) => REGIONS.find((r) => r.id === id)?.name ?? "";
const statusLabel = (id: string) => STATUSES.find((s) => s.id === id)?.label ?? id;

export function MatchPage() {
  const qc = useQueryClient();
  const resume = useQuery({ queryKey: ["resume"], queryFn: api.getResume });
  const match = useQuery({ queryKey: ["match"], queryFn: api.match, enabled: resume.isSuccess });
  const [draft, setDraft] = useState("");
  useEffect(() => {
    if (resume.data) setDraft(resume.data.content);
  }, [resume.data]);

  const save = useMutation({
    mutationFn: api.saveResume,
    onSuccess: (r) => {
      qc.setQueryData(["resume"], r);
      void qc.invalidateQueries({ queryKey: ["match"] });
    },
  });
  // 加入追蹤後，職缺列表、看板、匹配結果上的狀態都要更新
  const track = useMutation({
    mutationFn: api.createApplication,
    onSuccess: () => qc.invalidateQueries({ predicate: (q) => ["match", "jobs", "applications"].includes(String(q.queryKey[0])) }),
  });

  function submit(e: FormEvent) {
    e.preventDefault();
    save.mutate(draft);
  }

  if (resume.isPending) return <p className="muted">載入中…</p>;
  if (resume.isError) return <p className="error">讀取失敗：{resume.error.message}</p>;

  const dirty = draft !== resume.data.content;
  return (
    <section className="match-layout">
      <form className="card stack" onSubmit={submit}>
        <h3>我的履歷</h3>
        <textarea
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          rows={14}
          maxLength={20000}
          placeholder={"貼上履歷文字：技能、工作經歷（例如 2022 – 至今）、學歷、希望的工作地點…"}
          aria-label="履歷內容"
        />
        <div className="row">
          <button disabled={save.isPending || !dirty}>{save.isPending ? "計算中…" : "儲存並計算"}</button>
          {resume.data.updatedAt && !dirty && (
            <span className="muted small">已儲存 {new Date(resume.data.updatedAt).toLocaleString("zh-TW", { dateStyle: "short", timeStyle: "short" })}</span>
          )}
          {save.isError && <span className="error" role="alert">{save.error.message}</span>}
        </div>
        {resume.data.profile && <Profile p={resume.data.profile} />}
      </form>

      <div className="stack">
        {match.isPending && resume.data.content !== "" && <p className="muted">計算中…</p>}
        {match.isError && <p className="error">計算失敗：{match.error.message}</p>}
        {resume.data.content.trim() === "" && <p className="muted">貼上履歷並儲存後，這裡會依匹配分數排出你的職缺。</p>}
        {match.data?.profile && match.data.items.length === 0 && (
          <p className="muted">還沒有職缺。到<Link to="/jobs">職缺</Link>頁從網站匯入幾筆。</p>
        )}
        <ol className="match-list">
          {match.data?.items.map((m) => (
            <MatchCard key={m.job.id} m={m} onTrack={() => track.mutate(m.job.id)} tracking={track.isPending && track.variables === m.job.id} />
          ))}
        </ol>
      </div>
    </section>
  );
}

/** 系統從履歷辨識出的內容；辨識不到的項目直接說「未辨識」，使用者才知道要補寫什麼 */
function Profile({ p }: { p: ResumeProfile }) {
  return (
    <dl className="profile">
      <dt>技能</dt>
      <dd>{p.skills.length ? <span className="chips">{p.skills.map((s) => <span key={s} className="chip">{s}</span>)}</span> : "未辨識"}</dd>
      <dt>年資</dt>
      <dd>{p.years !== null ? `${p.years} 年` : "未辨識"}</dd>
      <dt>學歷</dt>
      <dd>{p.education ?? "未辨識"}</dd>
      <dt>地區</dt>
      <dd>{p.regions.length ? p.regions.map(regionName).join("、") : "未辨識（不影響分數）"}</dd>
    </dl>
  );
}

function MatchCard({ m, onTrack, tracking }: { m: MatchItem; onTrack: () => void; tracking: boolean }) {
  const { job } = m;
  return (
    <li className="card match">
      <div className="score" aria-label={`匹配分數 ${m.score} 分`}>
        <strong>{m.score}</strong>
        <span className="meter"><span style={{ width: `${m.score}%` }} /></span>
      </div>
      <div className="stack match-body">
        <div className="row between">
          <div className="job-main">
            <strong>{job.sourceUrl ? <a href={job.sourceUrl} target="_blank" rel="noreferrer">{job.title}</a> : job.title}</strong>
            <span className="muted small">{[job.company, regionName(job.region), salaryText(job)].filter(Boolean).join(" · ")}</span>
          </div>
          {job.application ? (
            <Link to={`/applications/${job.application.id}`} className={`badge s-${job.application.status}`}>{statusLabel(job.application.status)}</Link>
          ) : (
            <button className="ghost" onClick={onTrack} disabled={tracking}>加入追蹤</button>
          )}
        </div>
        {(m.matchedSkills.length > 0 || m.missingSkills.length > 0) && (
          <div className="chips">
            {m.matchedSkills.map((s) => <span key={s} className="chip have">✓ {s}</span>)}
            {m.missingSkills.map((s) => <span key={s} className="chip lack">缺 {s}</span>)}
          </div>
        )}
        {m.reasons.length > 0 && <p className="muted small reasons">{m.reasons.join("；")}</p>}
      </div>
    </li>
  );
}
