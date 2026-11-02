// 把使用者上傳的履歷檔轉成純文字。PDF 與 Word 的解析器只在需要時才從 CDN 載入。

const PDFJS_URL = "https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.min.js";
const PDFJS_WORKER_URL = "https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js";
const MAMMOTH_URL = "https://cdnjs.cloudflare.com/ajax/libs/mammoth/1.6.0/mammoth.browser.min.js";

// 只宣告實際用到的外部函式庫介面
interface PdfTextItem { readonly str?: string }
interface PdfPage { getTextContent(): Promise<{ items: readonly PdfTextItem[] }> }
interface PdfDocument { readonly numPages: number; getPage(n: number): Promise<PdfPage> }
interface PdfJsLib {
  GlobalWorkerOptions: { workerSrc: string };
  getDocument(src: { data: ArrayBuffer }): { promise: Promise<PdfDocument> };
}
interface Mammoth {
  extractRawText(input: { arrayBuffer: ArrayBuffer }): Promise<{ value: string }>;
}

declare global {
  interface Window { pdfjsLib?: PdfJsLib; mammoth?: Mammoth }
}

const loaded = new Map<string, Promise<void>>();

function loadScript(url: string): Promise<void> {
  const cached = loaded.get(url);
  if (cached) return cached;
  const p = new Promise<void>((resolve, reject) => {
    const s = document.createElement("script");
    s.src = url;
    s.onload = () => resolve();
    s.onerror = () => reject(new Error(`無法載入解析元件：${url}`));
    document.head.append(s);
  });
  loaded.set(url, p);
  return p;
}

async function readPdf(file: File): Promise<string> {
  await loadScript(PDFJS_URL);
  const lib = window.pdfjsLib;
  if (!lib) throw new Error("PDF 解析元件未就緒");
  lib.GlobalWorkerOptions.workerSrc = PDFJS_WORKER_URL;
  const doc = await lib.getDocument({ data: await file.arrayBuffer() }).promise;
  const pages: string[] = [];
  for (let i = 1; i <= doc.numPages; i++) {
    const content = await (await doc.getPage(i)).getTextContent();
    pages.push(content.items.map((it) => it.str ?? "").join(" "));
  }
  return pages.join("\n");
}

async function readDocx(file: File): Promise<string> {
  await loadScript(MAMMOTH_URL);
  const lib = window.mammoth;
  if (!lib) throw new Error("Word 解析元件未就緒");
  return (await lib.extractRawText({ arrayBuffer: await file.arrayBuffer() })).value;
}

export const ACCEPTED_EXTENSIONS = [".pdf", ".docx", ".txt", ".md"] as const;
const MAX_BYTES = 10 * 1024 * 1024;

export async function readResumeFile(file: File): Promise<string> {
  if (file.size > MAX_BYTES) throw new Error("檔案超過 10 MB");
  const ext = file.name.slice(file.name.lastIndexOf(".")).toLowerCase();
  switch (ext) {
    case ".pdf": return readPdf(file);
    case ".docx": return readDocx(file);
    case ".txt":
    case ".md": return file.text();
    default: throw new Error(`不支援的格式（${ext}），請使用 ${ACCEPTED_EXTENSIONS.join("、")}`);
  }
}
