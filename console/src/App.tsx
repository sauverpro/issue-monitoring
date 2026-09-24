import type { ReactNode } from "react";
import { Navigate, Route, Routes, useLocation } from "react-router-dom";
import { useAuth } from "@/lib/auth";
import { AppShell } from "@/components/AppShell";
import { LoginPage } from "@/pages/Login";
import { AdminPage } from "@/pages/Admin";
import { PackagesPage } from "@/pages/Packages";

function Protected({ children }: { children: ReactNode }) {
  const { auth } = useAuth();
  const loc = useLocation();
  if (!auth.token) {
    return <Navigate to="/login" replace state={{ from: loc }} />;
  }
  if (!auth.isPlatformAdmin) {
    return (
      <div className="flex min-h-screen items-center justify-center px-4">
        <div className="max-w-md space-y-3 text-center">
          <h1 className="text-lg font-semibold">Platform admin only</h1>
          <p className="text-sm text-zinc-500">
            This console manages organizations and SDK packages. Organization members should use the
            frontend workspace (port 5173).
          </p>
        </div>
      </div>
    );
  }
  return <AppShell>{children}</AppShell>;
}

export default function App() {
  return (
    <Routes>
      <Route path="/login" element={<LoginPage />} />
      <Route
        path="/"
        element={
          <Protected>
            <AdminPage />
          </Protected>
        }
      />
      <Route
        path="/packages"
        element={
          <Protected>
            <PackagesPage />
          </Protected>
        }
      />
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}
