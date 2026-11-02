// 統計：上方是重點數字，下面兩張橫條圖——目前各狀態分布、投遞漏斗。
// 資料只有四、五條，用 CSS 畫就夠了，不必為此多載一個圖表套件。
// 每條都寫上名稱和數字，顏色只是輔助（面試、錄取的顏色在紅綠色弱下分不太開）。

import { useQuery } from "@tanstack/react-query";
import { Link } from "react-router-dom";

import { api } from "../api/client";
import { STATUSES, type ApplicationStats } from "../api/types";

const rate = (part: number, whole: number) => (whole ? `${Math.round((part / whole) * 100)}%` : "—");

export function StatsPage() {
  const stats = useQuery({ queryKey: ["applications", "stats"], queryFn: api.applicationStats });

  if (stats.isPending) return <p className="muted">載入中…</p>;
  if (stats.isError) return <p className="error">讀取失敗：{stats.error.message}</p>;
  if (stats.data.total === 0) {
    return <p className="muted">還沒有追蹤中的職缺。到<Link to="/jobs">職缺</Link>頁按「加入追蹤」。</p>;
  }

  const { funnel } = stats.data;
  return (
    <section className="stack">
      <div className="tiles">
        <Tile label="追蹤中" value={funnel.tracked} />
        <Tile label="已投遞" value={funnel.applied} />
        <Tile label="面試率" value={rate(funnel.interview, funnel.applied)} hint={`${funnel.interview} / ${funnel.applied} 份投遞`} />
        <Tile label="錄取率" value={rate(funnel.offer, funnel.applied)} hint={`${funnel.offer} / ${funnel.applied} 份投遞`} />
      </div>
      <div className="charts">
        <StatusChart stats={stats.data} />
        <FunnelChart funnel={funnel} />
      </div>
    </section>
  );
}

function Tile({ label, value, hint }: { label: string; value: number | string; hint?: string }) {
  return (
    <div className="card tile">
      <span className="muted small">{label}</span>
      <strong>{value}</strong>
      {hint && <span className="muted small">{hint}</span>}
    </div>
  );
}

function StatusChart({ stats }: { stats: ApplicationStats }) {
  const max = Math.max(...Object.values(stats.byStatus), 1);
  return (
    <figure className="card chart">
      <figcaption>目前狀態</figcaption>
      <ul className="bars">
        {STATUSES.map((s) => (
          <Bar key={s.id} className={`s-${s.id}`} label={s.label} value={stats.byStatus[s.id]} max={max} />
        ))}
      </ul>
    </figure>
  );
}

/** 曾經走到某一關的數量；後面一關附上「相對前一關」的轉換率 */
function FunnelChart({ funnel }: { funnel: ApplicationStats["funnel"] }) {
  const steps = [
    { label: "追蹤", value: funnel.tracked },
    { label: "投遞", value: funnel.applied },
    { label: "面試", value: funnel.interview },
    { label: "錄取", value: funnel.offer },
  ];
  return (
    <figure className="card chart">
      <figcaption>投遞漏斗</figcaption>
      <ul className="bars">
        {steps.map((s, i) => (
          <Bar
            key={s.label}
            className="funnel"
            label={s.label}
            value={s.value}
            max={funnel.tracked}
            note={i > 0 ? rate(s.value, steps[i - 1]!.value) : undefined}
          />
        ))}
      </ul>
      <p className="muted small">轉換率是相對前一關；面試後被拒的投遞仍算進「面試」。</p>
    </figure>
  );
}

function Bar({ label, value, max, className, note }: { label: string; value: number; max: number; className: string; note?: string | undefined }) {
  return (
    <li className={`bar-row ${className}`} title={`${label}：${value}${note ? `（${note}）` : ""}`}>
      <span>{label}</span>
      <span className="track">
        <span className="fill" style={{ width: `${(value / max) * 100}%` }} />
      </span>
      <span className="value">
        {value}
        {note && <span className="muted small"> {note}</span>}
      </span>
    </li>
  );
}
