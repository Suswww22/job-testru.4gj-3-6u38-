// 迷你 DOM 建構器：一律用 textContent 寫入文字，不用 innerHTML，避免注入問題。
export function h(tag, attrs = {}, ...children) {
    const el = document.createElement(tag);
    for (const [key, value] of Object.entries(attrs)) {
        if (value === undefined || value === false)
            continue;
        if (key.startsWith("on") && typeof value === "function") {
            el.addEventListener(key.slice(2), value);
        }
        else if (key === "class") {
            el.className = String(value);
        }
        else {
            el.setAttribute(key, value === true ? "" : String(value));
        }
    }
    for (const c of children.flat()) {
        if (c === null || c === undefined || c === false)
            continue;
        el.append(typeof c === "number" ? String(c) : c);
    }
    return el;
}
export function $(selector, root = document) {
    const el = root.querySelector(selector);
    if (!el)
        throw new Error(`找不到元素：${selector}`);
    return el;
}
