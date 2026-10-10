import { Navigate, Outlet, Route, Routes, useLocation } from "react-router";
import { useMe } from "./api/hooks";
import { Layout } from "./components/Layout";
import { Spinner } from "./components/ui";
import { InboxPage } from "./pages/Inbox";
import { KnowledgePage } from "./pages/knowledge/KnowledgePage";
import { LoginPage } from "./pages/Login";
import { RegisterPage } from "./pages/Register";

export function App() {
  return (
    <Routes>
      <Route element={<GuestOnly />}>
        <Route path="/login" element={<LoginPage />} />
        <Route path="/register" element={<RegisterPage />} />
      </Route>
      <Route element={<RequireSession />}>
        <Route element={<Layout />}>
          <Route path="/inbox/:conversationId?" element={<InboxPage />} />
          <Route path="/knowledge/:tab?" element={<KnowledgePage />} />
          <Route path="*" element={<Navigate to="/inbox" replace />} />
        </Route>
      </Route>
    </Routes>
  );
}

function RequireSession() {
  const me = useMe();
  const location = useLocation();
  if (me.isPending) return <Spinner />;
  if (me.isError) return <Navigate to="/login" replace state={{ from: location.pathname }} />;
  return <Outlet />;
}

function GuestOnly() {
  const me = useMe();
  if (me.isPending) return <Spinner />;
  if (me.isSuccess) return <Navigate to="/inbox" replace />;
  return <Outlet />;
}
