import { StrictMode, Suspense, lazy } from "react";
import { createRoot } from "react-dom/client";
import { BrowserRouter, Navigate, Route, Routes } from "react-router-dom";
import { Toaster } from "sonner";
import "./styles.css";
import { AppShell } from "@/components/app-shell";
import { AdminProvider } from "@/lib/admin";
import { PlayerProvider } from "@/lib/player";
import Home from "@/pages/home";
import MySessions from "@/pages/my-sessions";
import AdminLogin, { RequireAdmin } from "@/pages/admin/login";
import { Spinner } from "@/components/ui/field";

const AdminPolls = lazy(() => import("@/pages/admin/polls"));
const AdminCheckin = lazy(() => import("@/pages/admin/checkin"));
const AdminRecords = lazy(() => import("@/pages/admin/records"));
const AdminPlayers = lazy(() => import("@/pages/admin/players"));
const loading = <div className="grid min-h-[50vh] place-items-center text-muted-foreground"><Spinner className="size-6" /></div>;

function App() {
  return (
    <BrowserRouter>
      <AdminProvider>
        <PlayerProvider>
          <AppShell>
            <Suspense fallback={loading}>
            <Routes>
              <Route path="/" element={<Home />} />
              <Route path="/my-sessions" element={<MySessions />} />
              <Route path="/admin/login" element={<AdminLogin />} />
              <Route path="/admin" element={<Navigate to="/admin/polls" replace />} />
              <Route path="/admin/polls" element={<RequireAdmin><AdminPolls /></RequireAdmin>} />
              <Route path="/admin/checkin" element={<RequireAdmin><AdminCheckin /></RequireAdmin>} />
              <Route path="/admin/players" element={<RequireAdmin><AdminPlayers /></RequireAdmin>} />
              <Route path="/admin/records" element={<RequireAdmin><AdminRecords /></RequireAdmin>} />
              <Route path="*" element={<Navigate to="/" replace />} />
            </Routes>
            </Suspense>
          </AppShell>
          <Toaster theme="dark" position="top-center" richColors toastOptions={{ style: { fontFamily: "Inter, sans-serif" } }} />
        </PlayerProvider>
      </AdminProvider>
    </BrowserRouter>
  );
}

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
