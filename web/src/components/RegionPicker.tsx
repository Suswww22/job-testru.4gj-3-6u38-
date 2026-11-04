// 地區勾選視窗：先列出所有縣市，每個縣市可展開勾選鄉鎮市區。
// 勾縣市 = 勾它底下所有區；取消縣市 = 一併取消；只勾部分區時縣市呈「半勾」。
// 勾選結果用一組字串表示：鄉鎮市區是「縣市代號:區名」，遠端工作是 "remote"。

import { useRef, useState } from "react";

import { REGIONS } from "../../../src/shared/data";
import { DISTRICTS, isCounty } from "../../../src/shared/districts";
import type { RegionId } from "../../../src/shared/types";
import { Icon } from "./Icon";

export type Area = ReadonlySet<string>;

/** 縣市底下所有可勾的項目（遠端工作沒有區，就是它自己） */
export const keysOf = (id: RegionId): string[] => (isCounty(id) ? DISTRICTS[id].map((d) => `${id}:${d.name}`) : [id]);

/** 縣市整個勾 → regions；只勾部分區 → districts；全部都勾等於不限地區 */
export function toQuery(area: Area): { regions: RegionId[]; districts: string[] } {
  const regions: RegionId[] = [];
  const districts: string[] = [];
  for (const r of REGIONS) {
    const keys = keysOf(r.id);
    const picked = keys.filter((k) => area.has(k));
    if (picked.length === keys.length) regions.push(r.id);
    else districts.push(...picked);
  }
  return regions.length === REGIONS.length ? { regions: [], districts: [] } : { regions, districts };
}

/** 欄位上的摘要：「全部地區」「台北市」「台北市 等 3 個」 */
function summary(area: Area): string {
  const names = REGIONS.flatMap((r) => {
    const keys = keysOf(r.id);
    const picked = keys.filter((k) => area.has(k));
    if (picked.length === keys.length) return [r.name];
    return picked.map((k) => `${r.name}${k.split(":")[1]}`);
  });
  if (names.length === 0 || names.length === REGIONS.length) return "全部地區";
  return names.length === 1 ? names[0]! : `${names[0]} 等 ${names.length} 個`;
}

export function toggle(area: Area, keys: readonly string[], on: boolean): Set<string> {
  const next = new Set(area);
  for (const k of keys) {
    if (on) next.add(k);
    else next.delete(k);
  }
  return next;
}

export function RegionPicker({ value, onApply }: { value: Area; onApply: (area: Set<string>) => void }) {
  const dialog = useRef<HTMLDialogElement>(null);
  const [draft, setDraft] = useState<Area>(new Set());
  const [expanded, setExpanded] = useState<RegionId | null>(null);

  function open() {
    setDraft(new Set(value));
    setExpanded(null);
    dialog.current?.showModal();
  }
  const close = () => dialog.current?.close();

  return (
    <div className="field">
      <Icon name="pin" />
      <button type="button" className="picker" aria-haspopup="dialog" onClick={open}>
        <span>{summary(value)}</span>
        <Icon name="chevron" />
      </button>

      {/* 點視窗外的灰色背景也會關閉（不套用） */}
      <dialog ref={dialog} className="region-dialog" aria-label="選擇地區" onClick={(e) => e.target === dialog.current && close()}>
        <div className="region-head">
          <h3>選擇地區</h3>
          <button type="button" className="ghost icon-btn" aria-label="關閉" onClick={close}>✕</button>
        </div>

        <ul className="region-tree">
          {REGIONS.map((r) => {
            const keys = keysOf(r.id);
            const picked = keys.filter((k) => draft.has(k)).length;
            const all = picked === keys.length;
            const isOpen = expanded === r.id;
            return (
              <li key={r.id}>
                <div className="county">
                  <label>
                    <input
                      type="checkbox"
                      checked={all}
                      ref={(el) => { if (el) el.indeterminate = picked > 0 && !all; }}
                      onChange={() => setDraft(toggle(draft, keys, !all))}
                    />
                    {r.name}
                  </label>
                  {isCounty(r.id) && (
                    <button
                      type="button"
                      className="expand"
                      aria-expanded={isOpen}
                      aria-label={`${r.name}的鄉鎮市區`}
                      onClick={() => setExpanded(isOpen ? null : r.id)}
                    >
                      {picked > 0 && !all && <span className="small">{picked}/{keys.length}</span>}
                      <Icon name="chevron" />
                    </button>
                  )}
                </div>
                {isOpen && isCounty(r.id) && (
                  <div className="districts">
                    {DISTRICTS[r.id].map((d) => {
                      const key = `${r.id}:${d.name}`;
                      return (
                        <label key={key}>
                          <input type="checkbox" checked={draft.has(key)} onChange={(e) => setDraft(toggle(draft, [key], e.target.checked))} />
                          {d.name}
                        </label>
                      );
                    })}
                  </div>
                )}
              </li>
            );
          })}
        </ul>

        <div className="region-foot">
          <button type="button" className="ghost" onClick={() => setDraft(new Set())} disabled={draft.size === 0}>清除</button>
          <button type="button" onClick={() => { onApply(new Set(draft)); close(); }}>確定</button>
        </div>
      </dialog>
    </div>
  );
}
