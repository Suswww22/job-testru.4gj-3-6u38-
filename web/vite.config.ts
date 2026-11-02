import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

// 開發時把 /api 轉到後端：對瀏覽器來說前後端是同一個網站，SameSite=Strict 的 cookie 才會帶上
export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    proxy: { "/api": "http://localhost:3001" },
  },
});
