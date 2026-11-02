// 工程師求職 Agent 的資料結構（伺服器與網頁共用）。
export const ROLES = [
    { id: "ai", name: "AI 工程師" },
    { id: "fe", name: "前端工程師" },
    { id: "be", name: "後端工程師" },
    { id: "fs", name: "全端工程師" },
];
export const LEVELS = [
    { id: "junior", name: "初階", hint: "0–1 年" },
    { id: "mid", name: "中階", hint: "2–5 年" },
    { id: "senior", name: "資深", hint: "5 年以上" },
    { id: "lead", name: "主管", hint: "Lead／架構師" },
];
/** 縣市與其三碼郵遞區號範圍（含不存在的號碼，查詢時回傳空結果，無害） */
export const COUNTIES = [
    { name: "台北市", area: "北部", zips: [[100, 116]] },
    { name: "新北市", area: "北部", zips: [[207, 208], [220, 253]] },
    { name: "基隆市", area: "北部", zips: [[200, 206]] },
    { name: "桃園市", area: "北部", zips: [[320, 338]] },
    { name: "新竹市", area: "北部", zips: [[300, 300]] },
    { name: "新竹縣", area: "北部", zips: [[302, 315]] },
    { name: "宜蘭縣", area: "北部", zips: [[260, 272]] },
    { name: "苗栗縣", area: "中部", zips: [[350, 369]] },
    { name: "台中市", area: "中部", zips: [[400, 439]] },
    { name: "彰化縣", area: "中部", zips: [[500, 530]] },
    { name: "南投縣", area: "中部", zips: [[540, 558]] },
    { name: "雲林縣", area: "中部", zips: [[630, 655]] },
    { name: "嘉義市", area: "南部", zips: [[600, 600]] },
    { name: "嘉義縣", area: "南部", zips: [[602, 625]] },
    { name: "台南市", area: "南部", zips: [[700, 745]] },
    { name: "高雄市", area: "南部", zips: [[800, 852]] },
    { name: "屏東縣", area: "南部", zips: [[900, 947]] },
    { name: "花蓮縣", area: "東部與離島", zips: [[970, 983]] },
    { name: "台東縣", area: "東部與離島", zips: [[950, 966]] },
    { name: "澎湖縣", area: "東部與離島", zips: [[880, 885]] },
    { name: "金門縣", area: "東部與離島", zips: [[890, 896]] },
    { name: "連江縣", area: "東部與離島", zips: [[209, 212]] },
];
export const REMOTE = "遠端";
