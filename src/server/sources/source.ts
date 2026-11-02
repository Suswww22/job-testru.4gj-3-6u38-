// 「來源轉接器」介面：每個求職網站實作一份，伺服器就能統一呼叫。
// 要新增網站時，只要再寫一個符合這個介面的檔案並登記到 index.ts。

import type { Job, SearchQuery, SourceId } from "../../shared/types.js";

export interface JobSourceAdapter {
  readonly id: SourceId;
  /** true 代表來源網站已用關鍵字搜尋過，伺服器不再以關鍵字二次過濾（摘要沒有內文，二次過濾會誤刪） */
  readonly handlesKeyword: boolean;
  /** 依條件取回職缺；可只回傳摘要（detailLoaded = false） */
  search(query: SearchQuery): Promise<Job[]>;
  /** 取單一職缺完整內容；url 必須先經過 acceptsUrl 驗證 */
  detail?(url: string): Promise<Job>;
  /** 只允許抓自己網站的網址，避免伺服器被當成任意代理 */
  acceptsUrl?(url: string): boolean;
}
