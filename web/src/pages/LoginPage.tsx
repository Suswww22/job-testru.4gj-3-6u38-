import { useState, type FormEvent } from "react";

import { ApiError } from "../api/client";
import { useAuth } from "../auth";

type Mode = "login" | "register";

export function LoginPage() {
  const { login, register } = useAuth();
  const [mode, setMode] = useState<Mode>("login");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [name, setName] = useState("");

  const action = mode === "login" ? login : register;
  const error = action.error instanceof ApiError ? action.error.message : action.error ? "連線失敗，請稍後再試" : null;

  function submit(e: FormEvent) {
    e.preventDefault();
    if (mode === "login") login.mutate({ email, password });
    else register.mutate({ email, password, ...(name.trim() ? { name: name.trim() } : {}) });
  }

  function switchTo(next: Mode) {
    setMode(next);
    login.reset();
    register.reset();
  }

  return (
    <div className="center">
      <form className="card auth" onSubmit={submit}>
        <h1>求職追蹤</h1>
        <div className="tabs" role="tablist">
          <button type="button" role="tab" aria-selected={mode === "login"} onClick={() => switchTo("login")}>登入</button>
          <button type="button" role="tab" aria-selected={mode === "register"} onClick={() => switchTo("register")}>註冊</button>
        </div>
        <label>
          Email
          <input type="email" autoComplete="email" required value={email} onChange={(e) => setEmail(e.target.value)} />
        </label>
        {mode === "register" && (
          <label>
            名字（選填）
            <input autoComplete="nickname" value={name} onChange={(e) => setName(e.target.value)} />
          </label>
        )}
        <label>
          密碼
          <input
            type="password"
            autoComplete={mode === "login" ? "current-password" : "new-password"}
            minLength={mode === "register" ? 8 : undefined}
            required
            value={password}
            onChange={(e) => setPassword(e.target.value)}
          />
        </label>
        {error && <p className="error" role="alert">{error}</p>}
        <button type="submit" disabled={action.isPending}>
          {action.isPending ? "處理中…" : mode === "login" ? "登入" : "建立帳號"}
        </button>
      </form>
    </div>
  );
}
