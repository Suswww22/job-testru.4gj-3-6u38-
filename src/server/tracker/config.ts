// 讀取 tracker-config.json（相當於表單，也可由儀表板網頁編輯），命令列參數可覆寫個別欄位。
// 設定有誤時列出全部錯誤後中止，不用預設值默默帶過。

import { readFile } from "node:fs/promises";

import type { KeywordGroup, LocationScope, Seniority, TrackerConfig, TrackerInputs } from "./types.js";

const LOCATIONS: readonly LocationScope[] = ["taoyuan", "taiwan", "remote", "us", "global"];
const SENIORITIES: readonly Seniority[] = ["any", "junior", "mid", "senior", "lead"];
const KEYWORDS: readonly KeywordGroup[] = ["ml", "dl", "llm", "cv", "data"];

/** sites 欄位可用的名稱 → 程式能直接抓的來源 */
export const CODE_SOURCE_ALIASES: Readonly<Record<"taiwanjobs" | "yourator", readonly string[]>> = {
  taiwanjobs: ["台灣就業通", "就業通", "taiwanjobs"],
  yourator: ["yourator"],
};

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

function csv(v: string): string[] {
  return v.split(",").map((s) => s.trim()).filter((s) => s !== "");
}

function stringList(v: unknown): string[] | null {
  return Array.isArray(v) && v.every((x) => typeof x === "string") ? (v as string[]) : null;
}

export async function loadInputs(path: string): Promise<TrackerInputs> {
  let raw: Record<string, unknown> = {};
  try {
    const text = (await readFile(path, "utf8")).replace(/^﻿/, "");
    const parsed: unknown = JSON.parse(text);
    if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) throw new Error("最外層必須是物件");
    raw = parsed as Record<string, unknown>;
  } catch (err: unknown) {
    if ((err as NodeJS.ErrnoException).code !== "ENOENT") {
      throw new Error(`${path} 讀取失敗：${err instanceof Error ? err.message : String(err)}`);
    }
    // 沒有設定檔就全部使用預設值
  }
  const { inputs, errors } = parseInputs(raw);
  if (errors.length > 0) throw new Error(`設定有誤：\n- ${errors.join("\n- ")}`);
  return inputs;
}

/** 驗證設定內容；命令列參數優先。網頁表單送出時也用這裡檢查。 */
export function parseInputs(raw: Record<string, unknown>): { inputs: TrackerInputs; errors: string[] } {
  const errors: string[] = [];
  const pickList = <T extends string>(key: string, allowed: readonly T[], fallback: readonly T[]): T[] => {
    const cli = arg(key);
    const values = cli !== undefined ? csv(cli) : raw[key] === undefined ? [...fallback] : stringList(raw[key]);
    if (values === null) {
      errors.push(`${key} 必須是字串陣列`);
      return [...fallback];
    }
    const bad = values.filter((v) => !(allowed as readonly string[]).includes(v));
    if (bad.length > 0) errors.push(`${key} 不接受 ${bad.join("、")}，可用值：${allowed.join(" / ")}`);
    if (values.length === 0) errors.push(`${key} 至少要選一項`);
    return values.filter((v): v is T => (allowed as readonly string[]).includes(v));
  };

  const location = pickList("location", LOCATIONS, ["taoyuan"]);
  const keywords = pickList("keywords", KEYWORDS, KEYWORDS);

  const seniorityRaw = arg("seniority") ?? raw["seniority"] ?? "any";
  const seniority = SENIORITIES.find((s) => s === seniorityRaw);
  if (!seniority) errors.push(`seniority 不接受 ${String(seniorityRaw)}，可用值：${SENIORITIES.join(" / ")}`);

  const sites = arg("sites") !== undefined ? csv(arg("sites") ?? "") : stringList(raw["sites"] ?? []);
  if (sites === null) errors.push("sites 必須是字串陣列");

  const exclude = stringList(raw["excludeCompanies"] ?? []);
  if (exclude === null) errors.push("excludeCompanies 必須是字串陣列");

  const salaryRaw = arg("min-salary") !== undefined ? Number(arg("min-salary")) : raw["minMonthlySalary"] ?? null;
  const minMonthlySalary = salaryRaw === null ? null : typeof salaryRaw === "number" && salaryRaw > 0 ? salaryRaw : NaN;
  if (Number.isNaN(minMonthlySalary)) errors.push("minMonthlySalary 必須是正數或 null");

  const notes = arg("notes") ?? raw["notes"] ?? "";
  if (typeof notes !== "string") errors.push("notes 必須是字串");

  const known = new Set(["location", "seniority", "keywords", "sites", "minMonthlySalary", "excludeCompanies", "notes"]);
  const unknown = Object.keys(raw).filter((k) => !known.has(k));
  if (unknown.length > 0) errors.push(`不認得的欄位：${unknown.join("、")}（可能是拼字錯誤）`);

  const inputs: TrackerInputs = {
    locations: location,
    seniority: seniority ?? "any",
    keywords,
    sites: sites ?? [],
    minMonthlySalary: minMonthlySalary === null || Number.isNaN(minMonthlySalary) ? null : minMonthlySalary,
    excludeCompanies: exclude ?? [],
    notes: typeof notes === "string" ? notes : "",
  };
  return { inputs, errors };
}

/** 寫回 tracker-config.json 的格式 */
export function toConfig(inputs: TrackerInputs): TrackerConfig {
  const { locations, ...rest } = inputs;
  return { location: locations, ...rest };
}

/** sites 為空代表全部；否則只抓有被指定的程式來源 */
export function wantsCodeSource(inputs: TrackerInputs, source: keyof typeof CODE_SOURCE_ALIASES): boolean {
  if (inputs.sites.length === 0) return true;
  const names = CODE_SOURCE_ALIASES[source];
  return inputs.sites.some((s) => names.includes(s.trim().toLowerCase()) || names.includes(s.trim()));
}
