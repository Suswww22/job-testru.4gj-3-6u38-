import { useEffect, useRef } from "react";
import { Navigate, NavLink, Route, Routes, useLocation } from "react-router-dom";

import { useAuth } from "./auth";
import { ApplicationPage } from "./pages/ApplicationPage";
import { BoardPage } from "./pages/BoardPage";
import { DigestPage } from "./pages/DigestPage";
import { JobsPage } from "./pages/JobsPage";
import { LoginPage } from "./pages/LoginPage";
import { MatchPage } from "./pages/MatchPage";
import { StatsPage } from "./pages/StatsPage";

export function App() {
  const { user, loading, logout } = useAuth();
  const { pathname } = useLocation();
  const nav = useRef<HTMLElement>(null);

  // 手機上選單可以左右滑：換頁後把目前這一項捲進畫面
  useEffect(() => {
    nav.current?.querySelector(".active")?.scrollIntoView({ block: "nearest", inline: "nearest" });
  }, [pathname, user]);

  if (loading) return <p className="center muted">載入中…</p>;
  if (!user) return <LoginPage />;

  return (
    <div className="shell">
      <header className="topbar">
        <strong className="brand">求職追蹤</strong>
        <nav ref={nav}>
          <NavLink to="/jobs">職缺</NavLink>
          <NavLink to="/board">投遞看板</NavLink>
          <NavLink to="/match">履歷匹配</NavLink>
          <NavLink to="/stats">統計</NavLink>
          <NavLink to="/digest">週報</NavLink>
        </nav>
        <span className="muted user">{user.name ?? user.email}</span>
        <button className="ghost" onClick={() => logout.mutate()}>登出</button>
      </header>
      <main>
        <Routes>
          <Route path="/jobs" element={<JobsPage />} />
          <Route path="/board" element={<BoardPage />} />
          <Route path="/applications/:id" element={<ApplicationPage />} />
          <Route path="/match" element={<MatchPage />} />
          <Route path="/stats" element={<StatsPage />} />
          <Route path="/digest" element={<DigestPage />} />
          <Route path="*" element={<Navigate to="/board" replace />} />
        </Routes>
      </main>
    </div>
  );
}
