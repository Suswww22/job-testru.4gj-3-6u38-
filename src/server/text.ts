// 把來源的 HTML／純文字描述整理成本站欄位。各來源格式不同，這裡只做通用的啟發式擷取。

import type { JobNature, Salary, Shift } from "../shared/types.js";

const ENTITIES: Readonly<Record<string, string>> = {
  amp: "&", lt: "<", gt: ">", quot: "\"", apos: "'", nbsp: " ",
  rsquo: "’", lsquo: "‘", rdquo: "”", ldquo: "“", hellip: "…", mdash: "—", ndash: "–",
};

export function decodeEntities(s: string): string {
  return s.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (whole, code: string) => {
    if (code.startsWith("#x") || code.startsWith("#X")) return String.fromCodePoint(parseInt(code.slice(2), 16));
    if (code.startsWith("#")) return String.fromCodePoint(Number(code.slice(1)));
    return ENTITIES[code.toLowerCase()] ?? whole;
  });
}

/** HTML 轉成去除空白的文字行 */
export function htmlToLines(html: string): string[] {
  const text = decodeEntities(
    html
      .replace(/<(br|\/p|\/li|\/div|\/h\d)[^>]*>/gi, "\n")
      .replace(/<li[^>]*>/gi, "\n• ")
      .replace(/<[^>]+>/g, ""),
  );
  return toLines(text);
}

export function toLines(text: string): string[] {
  return text
    .split(/\r?\n/)
    .map((l) => l.replace(/\s+/g, " ").trim())
    // 畫面已有項目符號，去掉來源自帶的「-」「•」等行首符號
    .map((l) => l.replace(/^[-•*·‧●▪■◆]\s*/, "").trim())
    .filter((l) => l !== "");
}

export function mapNature(raw: string): JobNature {
  if (/實習/.test(raw) || /intern/i.test(raw)) return "實習";
  if (/兼職|工讀|part/i.test(raw)) return "兼職";
  if (/約聘|派遣|契約|contract|temporary/i.test(raw)) return "約聘";
  if (/全職|正職|full/i.test(raw)) return "全職";
  return "其他";
}

export function mapShift(raw: string): Shift {
  if (/輪班|排班|三班|二班/.test(raw)) return "輪班";
  if (/彈性|flexible/i.test(raw)) return "彈性工時";
  if (/夜班|晚班|大夜|小夜/.test(raw)) return "晚班";
  if (/日班|白班|0?[89][:：]\d{2}/.test(raw)) return "日班";
  return "未提供";
}

export function findHours(lines: readonly string[]): string {
  const line = lines.find((l) => /\d{1,2}[:：]\d{2}\s*[-~～至到]\s*\d{1,2}[:：]\d{2}/.test(l) && l.length <= 80);
  return line ?? "";
}

export function findLeave(lines: readonly string[]): string | null {
  const i = lines.findIndex((l) => /休假制度|休假方式/.test(l));
  // 「休假制度」若是獨立標題行，取下一行內容
  if (i >= 0) {
    const cur = lines[i] ?? "";
    const next = lines[i + 1];
    return cur.replace(/休假(制度|方式)[:：]?/, "").trim() || (next ?? null);
  }
  return lines.find((l) => /週休|周休|月休|排休|做[一二三四五]休/.test(l) && l.length <= 80) ?? null;
}

const BENEFIT_RE = /福利|補助|津貼|團保|健檢|旅遊|下午茶|零食|生日|禮金|員工餐|宿舍|交通車|認股|教育訓練|進修/;
const PERK_RE = /年終|獎金|分紅|調薪|績效|保障.*個月|三節/;

export function findPerks(lines: readonly string[]): string[] {
  return unique(lines.filter((l) => PERK_RE.test(l) && l.length <= 80)).slice(0, 6);
}

export function findBenefits(lines: readonly string[]): string[] {
  return unique(lines.filter((l) => BENEFIT_RE.test(l) && !PERK_RE.test(l) && l.length <= 80)).slice(0, 10);
}

function unique(items: readonly string[]): string[] {
  return [...new Set(items)];
}

function toNumber(s: string): number | null {
  const n = Number(s.replace(/[,\s]/g, ""));
  return Number.isFinite(n) && n > 0 ? n : null;
}

/** 解析「NT$ 80,000 - 100,000 (月薪)」「月薪 38000~45000」「面議（經常性薪資達 4 萬元）」等寫法 */
export function parseSalaryText(raw: string): Salary {
  const note = raw.trim();
  const kind: Salary["kind"] =
    /年薪/.test(raw) ? "年薪" : /時薪/.test(raw) ? "時薪" : /日薪/.test(raw) ? "日薪" : /月薪/.test(raw) ? "月薪" : "面議";
  const nums = [...raw.matchAll(/\d[\d,]*(?:\.\d+)?/g)].map((m) => toNumber(m[0])).filter((n): n is number => n !== null);

  if (kind === "面議") {
    const wan = /達\s*(\d+(?:\.\d+)?)\s*萬/.exec(raw);
    return { kind, min: wan ? Number(wan[1]) * 10000 : null, max: null, note: note || "薪資面議", perks: [] };
  }
  const [min = null, max = null] = nums;
  return { kind, min, max, note, perks: [] };
}

/** 「2年以上」→ 2；「不拘」→ 0 */
export function parseMinYears(raw: string): number {
  const m = /(\d{1,2})\s*年/.exec(raw);
  return m ? Number(m[1]) : 0;
}

/** 20261101 或 2026-11-01T… → 2026-11-01 */
export function normalizeDate(raw: string): string {
  const compact = /^(\d{4})(\d{2})(\d{2})$/.exec(raw.trim());
  if (compact) return `${compact[1]}-${compact[2]}-${compact[3]}`;
  const iso = /^(\d{4})[-/](\d{1,2})[-/](\d{1,2})/.exec(raw.trim());
  if (iso) return `${iso[1]}-${(iso[2] ?? "").padStart(2, "0")}-${(iso[3] ?? "").padStart(2, "0")}`;
  return "";
}
