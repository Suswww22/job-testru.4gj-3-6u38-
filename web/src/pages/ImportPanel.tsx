// 從外部網站匯入職缺：選來源、地區、關鍵字，按「搜尋」才送出（後端有次數限制，不做邊打字邊搜）。
// 結果按「加入」就交給 POST /api/jobs；重複的會被後端以 409 擋下，畫面上直接標成已加入。

import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useState, type FormEvent } from "react";

import { REGIONS } from "../../../src/shared/data";
import type { RegionId } from "../../../src/shared/types";
import { api, ApiError } from "../api/client";
import type { ImportItem, ImportSource } from "../api/types";
import { Icon } from "../components/Icon";
import { salaryText } from "./JobsPage";

const SOURCE_OPTIONS: readonly { id: ImportSource; name: string }[] = [
  { id: "taiwanjobs", name: "台灣就業通" },
  { id: "yourator", name: "Yourator" },
];
const regionName = (id: RegionId | null | undefined) => REGIONS.find((r) => r.id === id)?.name ?? "";
/** 搜尋列下方的快速地區，點一下就換地區並搜尋 */
const QUICK_REGIONS: readonly RegionId[] = ["taipei", "newtaipei", "taichung", "remote"];

export function ImportPanel({ onImported }: { onImported: () => void }) {
  const qc = useQueryClient();
  const [form, setForm] = useState({ source: "yourator" as ImportSource, region: "" as RegionId | "", keyword: "" });
  const [items, setItems] = useState<ImportItem[] | null>(null);
  const [total, setTotal] = useState(0);

  const search = useMutation({
    mutationFn: api.searchImport,
    onSuccess: (r) => {
      setItems(r.items);
      setTotal(r.total);
    },
  });
  const markSaved = (externalId: string) =>
    setItems((list) => list && list.map((j) => (j.externalId === externalId ? { ...j, saved: true } : j)));
  const add = useMutation({
    mutationFn: ({ saved: _saved, ...input }: ImportItem) => api.createJob(input),
    onSuccess: (_job, item) => {
      markSaved(item.externalId);
      onImported();
    },
    onError: (e, item) => {
      // 409：其他分頁或先前已加入過，視同成功
      if (e instanceof ApiError && e.status === 409) {
        markSaved(item.externalId);
        void qc.invalidateQueries({ queryKey: ["jobs"] });
      }
    },
  });

  function submit(e: FormEvent) {
    e.preventDefault();
    search.mutate({ ...form, keyword: form.keyword.trim() });
  }

  function pickRegion(region: RegionId) {
    // 再點一次同一個地區就取消
    const next = { ...form, region: form.region === region ? ("" as const) : region };
    setForm(next);
    search.mutate({ ...next, keyword: next.keyword.trim() });
  }

  const addError = add.error instanceof ApiError && add.error.status !== 409 ? add.error.message : null;

  return (
    <div className="card stack">
      <form className="searchbar" onSubmit={submit}>
        <label className="field keyword">
          <Icon name="search" />
          <input
            type="search"
            placeholder="關鍵字，例如：前端、React、資料分析"
            value={form.keyword}
            onChange={(e) => setForm({ ...form, keyword: e.target.value })}
            aria-label="關鍵字"
          />
        </label>
        <label className="field">
          <Icon name="pin" />
          <select value={form.region} onChange={(e) => setForm({ ...form, region: e.target.value as RegionId | "" })} aria-label="地區">
            <option value="">全部地區</option>
            {REGIONS.map((r) => <option key={r.id} value={r.id}>{r.name}</option>)}
          </select>
        </label>
        <label className="field">
          <Icon name="globe" />
          <select value={form.source} onChange={(e) => setForm({ ...form, source: e.target.value as ImportSource })} aria-label="來源網站">
            {SOURCE_OPTIONS.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
          </select>
        </label>
        <button disabled={search.isPending}>{search.isPending ? "搜尋中…" : "搜尋"}</button>
      </form>

      <div className="quick-filters" role="group" aria-label="快速選擇地區">
        {QUICK_REGIONS.map((id) => (
          <button
            key={id}
            type="button"
            className="pill"
            aria-pressed={form.region === id}
            disabled={search.isPending}
            onClick={() => pickRegion(id)}
          >
            <Icon name="pin" />
            {regionName(id)}
          </button>
        ))}
      </div>

      {search.isError && <p className="error" role="alert">{search.error.message}</p>}
      {addError && <p className="error" role="alert">加入失敗：{addError}</p>}
      {items && (
        <p className="muted small" aria-live="polite">
          {items.length === 0 ? "沒有符合的職缺" : `共 ${total} 筆${total > items.length ? `，顯示前 ${items.length} 筆` : ""}`}
        </p>
      )}

      {items && items.length > 0 && (
        <ul className="import-list">
          {items.map((j) => (
            <li key={j.externalId} className="row between">
              <div className="job-main">
                {j.sourceUrl ? <a href={j.sourceUrl} target="_blank" rel="noreferrer">{j.title}</a> : <span>{j.title}</span>}
                <span className="meta">
                  <span><Icon name="building" />{j.company}</span>
                  {j.region && <span><Icon name="pin" />{regionName(j.region)}</span>}
                  <span><Icon name="money" />{salaryText({ salaryKind: j.salaryKind ?? "面議", salaryMin: j.salaryMin ?? null, salaryMax: j.salaryMax ?? null })}</span>
                </span>
              </div>
              {j.saved ? (
                <span className="muted small">已加入</span>
              ) : (
                <button className="ghost" disabled={add.isPending && add.variables?.externalId === j.externalId} onClick={() => add.mutate(j)}>
                  加入
                </button>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
