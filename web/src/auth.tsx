// 登入狀態：啟動時問一次 /auth/me，之後由登入、註冊、登出更新。
// 用 TanStack Query 存，其他頁面拿 useAuth() 就好。

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { api, ApiError } from "./api/client";
import type { User } from "./api/types";

const ME = ["me"] as const;

export function useAuth() {
  const qc = useQueryClient();
  const me = useQuery({
    queryKey: ME,
    queryFn: async (): Promise<User | null> => {
      try {
        return (await api.me()).user;
      } catch (e) {
        if (e instanceof ApiError && e.status === 401) return null;
        throw e;
      }
    },
    staleTime: Infinity,
  });

  // 換帳號時不能留著上一個人的資料。不用 qc.clear()：它會連 ["me"] 一起移除，
  // 正在觀察它的 useQuery 就收不到後面 setQueryData 的新值，畫面停在登入頁
  const switchUser = (user: User | null) => {
    qc.removeQueries({ predicate: (q) => q.queryKey[0] !== ME[0] });
    qc.setQueryData(ME, user);
  };
  const onSignedIn = ({ user }: { user: User }) => switchUser(user);

  const login = useMutation({
    mutationFn: (v: { email: string; password: string }) => api.login(v.email, v.password),
    onSuccess: onSignedIn,
  });
  const register = useMutation({
    mutationFn: (v: { email: string; password: string; name?: string }) => api.register(v.email, v.password, v.name),
    onSuccess: onSignedIn,
  });
  const logout = useMutation({
    mutationFn: api.logout,
    onSettled: () => switchUser(null),
  });

  return { user: me.data ?? null, loading: me.isPending, login, register, logout };
}
