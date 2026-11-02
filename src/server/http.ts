// 對外抓資料的共用工具：逾時、快取、併發上限。
// 目的是對資料來源保持禮貌：同一網址在快取期間只抓一次，同時最多 N 個連線。

const USER_AGENT = "JobRadar/1.0 (portfolio project; contact: local)";
const TIMEOUT_MS = 15_000;

interface CacheEntry { readonly expires: number; readonly value: Promise<string> }
const cache = new Map<string, CacheEntry>();

export async function fetchText(url: string, ttlMs: number): Promise<string> {
  const now = Date.now();
  const hit = cache.get(url);
  if (hit && hit.expires > now) return hit.value;

  const value = (async (): Promise<string> => {
    let res: Response;
    try {
      res = await fetch(url, {
        headers: { "User-Agent": USER_AGENT, "Accept-Language": "zh-TW,zh;q=0.9" },
        signal: AbortSignal.timeout(TIMEOUT_MS),
      });
    } catch (err: unknown) {
      // Node 的 fetch 只回「fetch failed」，真正原因（DNS、逾時、連線被拒）在 cause 裡
      const cause = err instanceof Error && err.cause instanceof Error ? err.cause.message : "";
      console.error(`[fetch] ${new URL(url).host} ${cause || String(err)}`);
      throw new Error(cause ? `連線失敗（${cause}）` : "連線失敗");
    }
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return res.text();
  })();
  cache.set(url, { expires: now + ttlMs, value });
  // 失敗的請求不留在快取裡，下次可重試
  value.catch(() => cache.delete(url));
  return value;
}

/** 依序處理 items，同時最多 limit 個在進行 */
export async function mapLimit<T, R>(
  items: readonly T[],
  limit: number,
  fn: (item: T) => Promise<R>,
): Promise<PromiseSettledResult<R>[]> {
  const results: PromiseSettledResult<R>[] = new Array(items.length);
  let next = 0;
  const worker = async (): Promise<void> => {
    while (next < items.length) {
      const i = next++;
      const item = items[i] as T;
      try {
        results[i] = { status: "fulfilled", value: await fn(item) };
      } catch (reason: unknown) {
        results[i] = { status: "rejected", reason };
      }
    }
  };
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return results;
}

export const MINUTE = 60_000;
