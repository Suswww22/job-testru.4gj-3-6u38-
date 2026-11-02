import { MutationCache, QueryCache, QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { BrowserRouter } from "react-router-dom";

import { ApiError } from "./api/client";
import { App } from "./App";
import "./styles.css";

// 換發也失敗（refresh token 過期或被作廢）時，任何請求都會拿到 401：把登入狀態清掉，畫面自動回到登入頁
const onError = (e: unknown) => {
  if (e instanceof ApiError && e.status === 401) queryClient.setQueryData(["me"], null);
};

const queryClient = new QueryClient({
  queryCache: new QueryCache({ onError }),
  mutationCache: new MutationCache({ onError }),
  defaultOptions: {
    queries: { retry: (count, e) => !(e instanceof ApiError && e.status < 500) && count < 2 },
  },
});

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <BrowserRouter>
        <App />
      </BrowserRouter>
    </QueryClientProvider>
  </StrictMode>,
);
