// 投遞詳情：職缺資訊、改狀態、狀態歷程時間軸、面試筆記（新增／編輯／刪除）。
// 任何變動後都讓「applications」開頭的快取失效，看板與統計回去時就是最新的。

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState, type FormEvent } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";

import { api } from "../api/client";
import { STATUSES, type ApplicationStatus, type Note } from "../api/types";
import { salaryText } from "./JobsPage";

const labelOf = (s: ApplicationStatus) => STATUSES.find((x) => x.id === s)!.label;
const dateTime = (iso: string) => new Date(iso).toLocaleString("zh-TW", { dateStyle: "medium", timeStyle: "short" });

export function ApplicationPage() {
  const { id = "" } = useParams();
  const qc = useQueryClient();
  const navigate = useNavigate();
  const key = ["applications", id] as const;
  const detail = useQuery({ queryKey: key, queryFn: () => api.getApplication(id) });

  // 投遞日、職缺列表上的狀態都可能跟著變
  const refresh = () => qc.invalidateQueries({ predicate: (q) => ["applications", "jobs"].includes(String(q.queryKey[0])) });
  const setStatus = useMutation({
    mutationFn: (status: ApplicationStatus) => api.updateApplicationStatus(id, status),
    onSettled: refresh,
  });
  const remove = useMutation({
    mutationFn: () => api.deleteApplication(id),
    onSuccess: async () => {
      qc.removeQueries({ queryKey: key });
      await refresh();
      navigate("/board");
    },
  });

  if (detail.isPending) return <p className="muted">載入中…</p>;
  if (detail.isError) return <p className="error">讀取失敗：{detail.error.message}　<Link to="/board">回看板</Link></p>;

  const app = detail.data;
  const { job } = app;
  return (
    <section className="stack detail">
      <Link to="/board" className="small">← 投遞看板</Link>

      <div className="card stack">
        <div className="row between">
          <div className="job-main">
            <h2>{job.title}</h2>
            <span className="muted">{job.company} · {salaryText(job)}</span>
            {job.sourceUrl && <a href={job.sourceUrl} target="_blank" rel="noreferrer" className="small">職缺原文 ↗</a>}
          </div>
          <button
            className="ghost danger"
            disabled={remove.isPending}
            onClick={() => confirm("停止追蹤這筆投遞？筆記與歷程會一起刪除。") && remove.mutate()}
          >
            停止追蹤
          </button>
        </div>

        <div className="segmented" role="group" aria-label="投遞狀態">
          {STATUSES.map((s) => (
            <button
              key={s.id}
              className={`s-${s.id}`}
              aria-pressed={app.status === s.id}
              disabled={setStatus.isPending}
              onClick={() => app.status !== s.id && setStatus.mutate(s.id)}
            >
              {s.label}
            </button>
          ))}
        </div>
        {setStatus.isError && <p className="error" role="alert">更新失敗：{setStatus.error.message}</p>}
        <span className="muted small">
          {app.appliedAt ? `投遞日 ${new Date(app.appliedAt).toLocaleDateString("zh-TW")}` : "尚未投遞"}
        </span>
      </div>

      <div className="detail-grid">
        <Notes appId={app.id} notes={app.notes} onChange={refresh} />
        <section className="card stack">
          <h3>狀態歷程</h3>
          <ol className="timeline">
            {[...app.events].reverse().map((e) => (
              <li key={e.id} className={`s-${e.toStatus}`}>
                <span>{e.fromStatus ? `${labelOf(e.fromStatus)} → ${labelOf(e.toStatus)}` : `開始追蹤（${labelOf(e.toStatus)}）`}</span>
                <time className="muted small" dateTime={e.createdAt}>{dateTime(e.createdAt)}</time>
              </li>
            ))}
          </ol>
        </section>
      </div>
    </section>
  );
}

function Notes({ appId, notes, onChange }: { appId: string; notes: Note[]; onChange: () => Promise<unknown> }) {
  const [draft, setDraft] = useState("");
  const add = useMutation({
    mutationFn: (content: string) => api.addNote(appId, content),
    onSuccess: async () => {
      setDraft("");
      await onChange();
    },
  });

  function submit(e: FormEvent) {
    e.preventDefault();
    if (draft.trim()) add.mutate(draft);
  }

  return (
    <section className="card stack">
      <h3>筆記 <span className="muted">{notes.length}</span></h3>
      <form className="stack note-form" onSubmit={submit}>
        <textarea
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          placeholder="面試題目、聯絡人、薪資談判…"
          aria-label="新增筆記"
          rows={3}
        />
        <div className="row">
          <button disabled={add.isPending || !draft.trim()}>新增筆記</button>
          {add.isError && <span className="error" role="alert">{add.error.message}</span>}
        </div>
      </form>
      <ul className="notes">
        {notes.map((n) => <NoteItem key={n.id} appId={appId} note={n} onChange={onChange} />)}
      </ul>
    </section>
  );
}

function NoteItem({ appId, note, onChange }: { appId: string; note: Note; onChange: () => Promise<unknown> }) {
  const [editing, setEditing] = useState<string | null>(null);
  const save = useMutation({
    mutationFn: (content: string) => api.updateNote(appId, note.id, content),
    onSuccess: async () => {
      await onChange();
      setEditing(null);
    },
  });
  const remove = useMutation({ mutationFn: () => api.deleteNote(appId, note.id), onSuccess: onChange });
  const edited = note.updatedAt !== note.createdAt;

  if (editing !== null) {
    return (
      <li className="stack">
        <textarea value={editing} onChange={(e) => setEditing(e.target.value)} aria-label="編輯筆記" rows={3} autoFocus />
        <div className="row">
          <button disabled={save.isPending || !editing.trim()} onClick={() => save.mutate(editing)}>儲存</button>
          <button className="ghost" onClick={() => setEditing(null)}>取消</button>
          {save.isError && <span className="error" role="alert">{save.error.message}</span>}
        </div>
      </li>
    );
  }
  return (
    <li className="stack">
      <p className="note-text">{note.content}</p>
      <div className="row between">
        <time className="muted small" dateTime={note.createdAt}>
          {dateTime(note.createdAt)}{edited ? "（已編輯）" : ""}
        </time>
        <div className="row">
          <button className="ghost small" onClick={() => setEditing(note.content)}>編輯</button>
          <button
            className="ghost danger small"
            disabled={remove.isPending}
            onClick={() => confirm("刪除這則筆記？") && remove.mutate()}
          >
            刪除
          </button>
        </div>
      </div>
    </li>
  );
}
