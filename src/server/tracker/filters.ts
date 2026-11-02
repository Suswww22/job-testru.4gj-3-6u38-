// 篩選規則：是不是 AI 職缺、資歷層級、是否在桃園市。
// 地點判定依 SKILL.md 的要求從嚴：無法確定縣市的一律放「地點待確認」，不計入桃園。

import { containsTerm } from "../../shared/matcher.js";
import type { Job } from "../../shared/types.js";
import type { KeywordGroup, LocationBucket, Seniority } from "./types.js";

/** 職稱出現就算 AI 職缺 */
const BASE_TITLE_TERMS: readonly string[] = ["ai", "人工智慧", "a.i.", "aigc", "genai", "生成式"];

export const KEYWORD_TERMS: Readonly<Record<KeywordGroup, readonly string[]>> = {
  ml: ["機器學習", "machine learning", "ml", "mlops"],
  dl: ["深度學習", "deep learning", "神經網路", "neural network", "pytorch", "tensorflow"],
  llm: ["llm", "大型語言模型", "語言模型", "生成式", "genai", "rag", "nlp", "自然語言"],
  cv: ["電腦視覺", "computer vision", "影像辨識", "影像處理", "機器視覺", "opencv"],
  data: ["資料科學", "data scientist", "data science", "資料工程", "data engineer", "數據科學", "演算法"],
};

/** Yourator 站內搜尋要送的詞 */
export function searchTerms(groups: readonly KeywordGroup[]): string[] {
  const perGroup: Readonly<Record<KeywordGroup, readonly string[]>> = {
    ml: ["機器學習", "Machine Learning"],
    dl: ["深度學習"],
    llm: ["LLM", "生成式AI"],
    cv: ["電腦視覺", "影像辨識"],
    data: ["資料科學", "Data Scientist"],
  };
  return ["AI", "AI Engineer", "人工智慧", ...groups.flatMap((g) => perGroup[g])];
}

/** 職稱必須是技術職；否則「市場行銷專員（AI 產業）」這類職缺會因職稱含 AI 被誤收 */
const TECH_ROLE = /工程師|工程|軟體|software|韌體|engineer|scientist|科學家|研究員|researcher|研發|developer|開發|programmer|架構師|architect|演算法|algorithm|技術主管|tech lead|mlops|data analyst|資料分析師/i;

export function isTechRole(job: Job): boolean {
  return TECH_ROLE.test(job.title);
}

/**
 * 職稱命中基本 AI 詞或任一選定關鍵字 → 納入；
 * 職稱沒有、但內文命中兩個以上不同關鍵字 → 也納入（避免只是「熟悉 AI 工具者佳」就被算進來）。
 * 回傳命中的詞；空陣列代表不是 AI 職缺。
 */
export function aiTerms(job: Job, groups: readonly KeywordGroup[]): string[] {
  if (!isTechRole(job)) return [];
  const title = job.title.toLowerCase();
  const body = [...job.duties, ...job.requirements.skills, ...job.tags].join(" ").toLowerCase();
  const groupTerms = groups.flatMap((g) => KEYWORD_TERMS[g]);

  const inTitle = [...BASE_TITLE_TERMS, ...groupTerms].filter((t) => containsTerm(title, t));
  if (inTitle.length > 0) return [...new Set(inTitle)];
  const inBody = [...new Set(groupTerms.filter((t) => containsTerm(body, t)))];
  return inBody.length >= 2 ? inBody : [];
}

export function inferSeniority(job: Job): Exclude<Seniority, "any"> | "unknown" {
  const t = job.title;
  if (/lead|主管|經理|manager|head|principal|staff|主任|架構師|architect|總監|director/i.test(t)) return "lead";
  if (/senior|\bsr\.?\b|資深/i.test(t)) return "senior";
  if (/junior|\bjr\.?\b|初階|助理|新鮮人|entry|intern|實習/i.test(t)) return "junior";
  // 與規格表單一致：中階為 2–5 年，超過 5 年算資深
  const years = job.requirements.minYears;
  if (years > 5) return "senior";
  if (years >= 2) return "mid";
  if (years === 1) return "junior";
  return "unknown";
}

/** 資歷不明的職缺保留，避免把可能符合的職缺漏掉；報告會標示「資歷未標明」 */
export function seniorityAccepted(wanted: Seniority, actual: Exclude<Seniority, "any"> | "unknown"): boolean {
  return wanted === "any" || actual === "unknown" || actual === wanted;
}

const TAOYUAN_DISTRICTS: readonly string[] = [
  "桃園區", "中壢區", "平鎮區", "八德區", "楊梅區", "蘆竹區", "大園區",
  "龜山區", "龍潭區", "大溪區", "觀音區", "新屋區", "復興區",
];

const OTHER_CITIES = /台北|臺北|新北|基隆|新竹|苗栗|台中|臺中|彰化|南投|雲林|嘉義|台南|臺南|高雄|屏東|宜蘭|花蓮|台東|臺東|澎湖|金門|連江|馬祖/;

export function locationBucket(job: Job): LocationBucket {
  const addr = job.address.replace(/\s+/g, "");
  if (job.region === "remote" || /遠端|remote|wfh/i.test(addr)) return "remote";
  // 先看明確的縣市名稱；「八德路」之類的路名會因為同時寫了台北而被正確排除
  if (/桃園[市縣]/.test(addr)) return "taoyuan";
  if (OTHER_CITIES.test(addr)) return "taiwan";
  if (TAOYUAN_DISTRICTS.some((d) => addr.includes(d)) || /桃園|中壢/.test(addr)) return "taoyuan";
  return "unconfirmed";
}
