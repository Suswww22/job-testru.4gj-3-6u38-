import { Navigate, NavLink, Route, Routes } from "react-router-dom";

import { useAuth } from "./auth";
import { ApplicationPage } from "./pages/ApplicationPage";
import { BoardPage } from "./pages/BoardPage";
import { JobsPage } from "./pages/JobsPage";
import { LoginPage } from "./pages/LoginPage";
import { MatchPage } from "./pages/MatchPage";
import { StatsPage } from "./pages/StatsPage";

export function App() {
  const { user, loading, logout } = useAuth();

  if (loading) return <p className="center muted">載入中…</p>;
  if (!user) return <LoginPage />;

  return (
    <div className="shell">
      <header className="topbar">
        <strong className="brand">求職追蹤</strong>
        <nav>
          <NavLink to="/jobs">職缺</NavLink>
          <NavLink to="/board">投遞看板</NavLink>
          <NavLink to="/match">履歷匹配</NavLink>
          <NavLink to="/stats">統計</NavLink>
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
          <Route path="*" element={<Navigate to="/board" replace />} />
        </Routes>
      </main>
    </div>
  );
}
