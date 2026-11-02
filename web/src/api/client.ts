// fetch 包裝：cookie 由瀏覽器自動帶上（同網站），前端碰不到 token。
// access token 15 分鐘就過期；收到 401 時先打 /auth/refresh 換新的再重試一次。
// 同時有多個請求過期時只換一次：refresh token 會輪替，重複換會被後端當成外洩而整個登出。

import type { Application, ApplicationDetail, ApplicationStats, ApplicationStatus, Job, JobInput, Note, Page, User } from "./types";

export class ApiError extends Error {
  constructor(readonly status: number, message: string, readonly details?: unknown) {
    super(message);
  }
}

let refreshing: Promise<boolean> | null = null;
// 這幾支回 401 就是真的失敗（帳密錯、refresh token 失效），換發也沒用；/auth/me 不在內，閒置後重開頁面才能自動續登
const NO_REFRESH = new Set(["/auth/login", "/auth/register", "/auth/refresh"]);

function refreshOnce(): Promise<boolean> {
  refreshing ??= fetch("/api/auth/refresh", { method: "POST" })
    .then((r) => r.ok)
    .catch(() => false)
    .finally(() => { refreshing = null; });
  return refreshing;
}

async function request<T>(method: string, path: string, body?: unknown, retry = true): Promise<T> {
  const res = await fetch(`/api${path}`, {
    method,
    headers: body === undefined ? {} : { "Content-Type": "application/json" },
    body: body === undefined ? null : JSON.stringify(body),
  });
  if (res.status === 401 && retry && !NO_REFRESH.has(path)) {
    if (await refreshOnce()) return request<T>(method, path, body, false);
  }
  if (res.status === 204) return undefined as T;
  const data: unknown = await res.json().catch(() => null);
  if (!res.ok) {
    const err = (data as { error?: { message?: string; details?: unknown } } | null)?.error;
    throw new ApiError(res.status, err?.message ?? `請求失敗（${res.status}）`, err?.details);
  }
  return data as T;
}

export const api = {
  me: () => request<{ user: User }>("GET", "/auth/me"),
  login: (email: string, password: string) => request<{ user: User }>("POST", "/auth/login", { email, password }),
  register: (email: string, password: string, name?: string) =>
    request<{ user: User }>("POST", "/auth/register", { email, password, ...(name ? { name } : {}) }),
  logout: () => request<void>("POST", "/auth/logout"),

  listJobs: (q = "") => request<Page<Job>>("GET", `/jobs?limit=100${q ? `&q=${encodeURIComponent(q)}` : ""}`),
  createJob: (input: JobInput) => request<Job>("POST", "/jobs", input),
  deleteJob: (id: string) => request<void>("DELETE", `/jobs/${id}`),

  listApplications: () => request<{ items: Application[] }>("GET", "/applications"),
  applicationStats: () => request<ApplicationStats>("GET", "/applications/stats"),
  createApplication: (jobId: string) => request<Application>("POST", "/applications", { jobId }),
  updateApplicationStatus: (id: string, status: ApplicationStatus) =>
    request<Application>("PATCH", `/applications/${id}`, { status }),
  deleteApplication: (id: string) => request<void>("DELETE", `/applications/${id}`),
  getApplication: (id: string) => request<ApplicationDetail>("GET", `/applications/${id}`),

  addNote: (appId: string, content: string) => request<Note>("POST", `/applications/${appId}/notes`, { content }),
  updateNote: (appId: string, noteId: string, content: string) =>
    request<Note>("PATCH", `/applications/${appId}/notes/${noteId}`, { content }),
  deleteNote: (appId: string, noteId: string) => request<void>("DELETE", `/applications/${appId}/notes/${noteId}`),
};
