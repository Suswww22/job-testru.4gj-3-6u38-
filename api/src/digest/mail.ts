// 把週報寄到帳號信箱：組出 HTML 與純文字兩個版本，透過 Resend 的 HTTP API 寄出（不裝 SDK，一個 fetch 就夠）。
// 沒設 RESEND_API_KEY 時不寄，週報照常產生在站內。
// 職缺標題、公司名來自外部網站，放進 HTML 前一律跳脫，避免信件內容被插入連結或標籤。

import type { ApplicationStatus } from "@prisma/client";

import type { DigestData } from "./generate.js";

const STATUS_LABELS: Record<ApplicationStatus, string> = {
  SAVED: "收藏",
  APPLIED: "已投",
  INTERVIEW: "面試",
  OFFER: "錄取",
  REJECTED: "拒絕",
};

const esc = (s: string) =>
  s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);
const day = (d: Date | string) => new Date(d).toLocaleDateString("zh-TW", { timeZone: "Asia/Taipei", month: "numeric", day: "numeric" });
const label = (s: ApplicationStatus | null) => (s ? STATUS_LABELS[s] ?? s : "開始追蹤");
/** 只接受 http(s) 連結，其他（javascript: 等）當作沒有連結 */
const safeUrl = (u: string | null | undefined) => (u && /^https?:\/\//i.test(u) ? u : null);

export interface DigestEmail {
  subject: string;
  html: string;
  text: string;
}

export function renderDigestEmail(data: DigestData, periodStart: Date, periodEnd: Date, appUrl?: string): DigestEmail {
  const { progress, followUps, topJobs, notes } = data;
  const range = `${day(periodStart)} – ${day(periodEnd)}`;
  const base = appUrl?.replace(/\/+$/, "");
  const subject = `求職週報 ${range}：待跟進 ${followUps.length}、推薦 ${topJobs.length}`;

  const html: string[] = [];
  const text: string[] = [`求職週報 ${range}`, ""];
  const h = (title: string) => {
    html.push(`<h2 style="font-size:16px;margin:24px 0 8px">${esc(title)}</h2>`);
    text.push(`【${title}】`);
  };
  const p = (s: string) => {
    html.push(`<p style="margin:4px 0;color:#555">${esc(s)}</p>`);
    text.push(s);
  };
  const list = (items: { html: string; text: string }[]) => {
    html.push(`<ul style="margin:4px 0;padding-left:20px">${items.map((i) => `<li style="margin:4px 0">${i.html}</li>`).join("")}</ul>`);
    text.push(...items.map((i) => `- ${i.text}`));
  };

  h("本週進度");
  p(`新增追蹤 ${progress.newTracked} 筆`);
  if (progress.changes.length === 0) p("這週沒有狀態變化");
  else
    list(progress.changes.map((c) => ({
      html: `${esc(c.title)}（${esc(c.company)}）${esc(label(c.from))} → <strong>${esc(label(c.to))}</strong> · ${day(c.at)}`,
      text: `${c.title}（${c.company}）${label(c.from)} → ${label(c.to)} · ${day(c.at)}`,
    })));
  text.push("");

  h("該跟進的投遞");
  if (followUps.length === 0) p("沒有超過 7 天沒消息的投遞");
  else
    list(followUps.map((f) => {
      const url = base ? `${base}/applications/${encodeURIComponent(f.applicationId)}` : null;
      return {
        html: `${url ? `<a href="${esc(url)}">${esc(f.title)}</a>` : esc(f.title)}（${esc(f.company)}）已 ${f.idleDays} 天沒有進展`,
        text: `${f.title}（${f.company}）已 ${f.idleDays} 天沒有進展`,
      };
    }));
  text.push("");

  h("推薦職缺");
  if (topJobs.length > 0)
    list(topJobs.map((j) => {
      const url = safeUrl(j.sourceUrl);
      const skills = j.matchedSkills.length > 0 ? ` · 符合 ${j.matchedSkills.join("、")}` : "";
      return {
        html: `<strong>${j.score}</strong> ${url ? `<a href="${esc(url)}">${esc(j.title)}</a>` : esc(j.title)} · ${esc(j.company)}${esc(skills)}`,
        text: `${j.score} 分 ${j.title} · ${j.company}${skills}${url ? ` ${url}` : ""}`,
      };
    }));
  else if (notes.length === 0) p("這週沒有 40 分以上的新職缺");
  for (const n of notes) p(n);

  if (base) {
    html.push(`<p style="margin:24px 0 0"><a href="${esc(base)}/digest">在網站上看週報、加入推薦職缺</a></p>`);
    text.push("", `在網站上看週報：${base}/digest`);
  }
  html.push(`<p style="margin:16px 0 0;color:#999;font-size:12px">不想收信可以到網站的「週報」頁關閉 Email。</p>`);
  text.push("", "不想收信可以到網站的「週報」頁關閉 Email。");

  return {
    subject,
    html: `<div style="font-family:system-ui,-apple-system,'Noto Sans TC',sans-serif;font-size:14px;line-height:1.6;color:#222;max-width:600px">${html.join("")}</div>`,
    text: text.join("\n"),
  };
}

/** 是否設定了寄信（沒有 API key 就只產生站內週報） */
export const mailEnabled = () => (process.env["RESEND_API_KEY"] ?? "") !== "";

export async function sendMail(to: string, mail: DigestEmail): Promise<void> {
  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { Authorization: `Bearer ${process.env["RESEND_API_KEY"]}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      // 沒有自己的網域時只能用 Resend 的測試寄件者，而且只能寄給註冊 Resend 的那個信箱
      from: process.env["MAIL_FROM"] || "求職追蹤 <onboarding@resend.dev>",
      to: [to],
      subject: mail.subject,
      html: mail.html,
      text: mail.text,
    }),
    signal: AbortSignal.timeout(15_000),
  });
  if (!res.ok) throw new Error(`Resend ${res.status}：${(await res.text()).slice(0, 200)}`);
}
