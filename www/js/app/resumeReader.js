// 把使用者上傳的履歷檔轉成純文字。PDF 與 Word 的解析器只在需要時才從 CDN 載入。
const PDFJS_URL = "https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.min.js";
const PDFJS_WORKER_URL = "https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js";
const MAMMOTH_URL = "https://cdnjs.cloudflare.com/ajax/libs/mammoth/1.6.0/mammoth.browser.min.js";
const loaded = new Map();
function loadScript(url) {
    const cached = loaded.get(url);
    if (cached)
        return cached;
    const p = new Promise((resolve, reject) => {
        const s = document.createElement("script");
        s.src = url;
        s.onload = () => resolve();
        s.onerror = () => reject(new Error(`無法載入解析元件：${url}`));
        document.head.append(s);
    });
    loaded.set(url, p);
    return p;
}
async function readPdf(file) {
    await loadScript(PDFJS_URL);
    const lib = window.pdfjsLib;
    if (!lib)
        throw new Error("PDF 解析元件未就緒");
    lib.GlobalWorkerOptions.workerSrc = PDFJS_WORKER_URL;
    const doc = await lib.getDocument({ data: await file.arrayBuffer() }).promise;
    const pages = [];
    for (let i = 1; i <= doc.numPages; i++) {
        const content = await (await doc.getPage(i)).getTextContent();
        pages.push(content.items.map((it) => it.str ?? "").join(" "));
    }
    return pages.join("\n");
}
async function readDocx(file) {
    await loadScript(MAMMOTH_URL);
    const lib = window.mammoth;
    if (!lib)
        throw new Error("Word 解析元件未就緒");
    return (await lib.extractRawText({ arrayBuffer: await file.arrayBuffer() })).value;
}
export const ACCEPTED_EXTENSIONS = [".pdf", ".docx", ".txt", ".md"];
const MAX_BYTES = 10 * 1024 * 1024;
export async function readResumeFile(file) {
    if (file.size > MAX_BYTES)
        throw new Error("檔案超過 10 MB");
    const ext = file.name.slice(file.name.lastIndexOf(".")).toLowerCase();
    switch (ext) {
        case ".pdf": return readPdf(file);
        case ".docx": return readDocx(file);
        case ".txt":
        case ".md": return file.text();
        default: throw new Error(`不支援的格式（${ext}），請使用 ${ACCEPTED_EXTENSIONS.join("、")}`);
    }
}
