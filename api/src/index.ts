import { createApp } from "./app.js";
import { assertJwtConfigured } from "./auth/token.js";

assertJwtConfigured();

const PORT = Number(process.env["PORT"] ?? 3001);

// Express 5 會把 listen 失敗（例如 port 被占用）傳給 callback，不處理的話會誤印「已啟動」
createApp().listen(PORT, (err) => {
  if (err) {
    console.error(`API 啟動失敗：${err.message}`);
    process.exit(1);
  }
  console.log(`API 已啟動：http://localhost:${PORT}/api`);
});
