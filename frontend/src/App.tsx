import type { ReactNode } from "react";
import { Navigate, Route, Routes, useLocation, useParams } from "react-router-dom";
import { useAuth } from "@/lib/auth";
import { Layout } from "@/components/Layout";
import { Login } from "@/pages/Login";
import { Overview } from "@/pages/Overview";
import { Incidents } from "@/pages/Incidents";
import { IncidentDetail } from "@/pages/IncidentDetail";
import { Events } from "@/pages/Events";
import { Endpoints } from "@/pages/Endpoints";
import { MonitoringSessions } from "@/pages/monitoring/Sessions";
import { MonitoringSessionDetail } from "@/pages/monitoring/SessionDetail";
import { SessionAnalyticsPage } from "@/pages/monitoring/SessionAnalytics";
import { MonitoringIssues } from "@/pages/monitoring/Issues";
import { MonitoringIssueDetail } from "@/pages/monitoring/IssueDetail";
import { ApiDocs } from "@/pages/ApiDocs";
import { SentrySync } from "@/pages/SentrySync";
import { Status } from "@/pages/Status";
import { Users } from "@/pages/Users";
import { UptimePage } from "@/pages/monitoring/Uptime";
import { orgRoutes } from "@/org/routes";

function OpsProtected({ children }: { children: ReactNode }) {
  const { auth } = useAuth();
  const loc = useLocation();
  if (!auth.token) {
    return <Navigate to="/ops/login" replace state={{ from: loc }} />;
  }
  return <Layout>{children}</Layout>;
}

function RequireAdmin({ children }: { children: ReactNode }) {
  const { auth } = useAuth();
  if (auth.role !== "admin") {
    return <Navigate to="/ops" replace />;
  }
  return <>{children}</>;
}

function SessionLegacyRedirect() {
  const { id } = useParams<{ id: string }>();
  if (!id) return <Navigate to="/monitoring/sessions" replace />;
  return (
    <Navigate to={`/monitoring/sessions/${encodeURIComponent(id)}`} replace />
  );
}

export default function App() {
  return (
    <Routes>
      {orgRoutes}
      <Route path="/ops/login" element={<Login />} />
      <Route path="/status" element={<Status />} />
      <Route
        path="/ops"
        element={
          <OpsProtected>
            <Overview />
          </OpsProtected>
        }
      />
      <Route
        path="/incidents"
        element={
          <OpsProtected>
            <Incidents />
          </OpsProtected>
        }
      />
      <Route
        path="/incidents/:id"
        element={
          <OpsProtected>
            <IncidentDetail />
          </OpsProtected>
        }
      />
      <Route
        path="/events"
        element={
          <OpsProtected>
            <Events />
          </OpsProtected>
        }
      />
      <Route
        path="/endpoints"
        element={
          <OpsProtected>
            <Endpoints />
          </OpsProtected>
        }
      />
      <Route
        path="/sentry-sync"
        element={
          <OpsProtected>
            <SentrySync />
          </OpsProtected>
        }
      />
      <Route
        path="/monitoring/issues"
        element={
          <OpsProtected>
            <MonitoringIssues />
          </OpsProtected>
        }
      />
      <Route
        path="/monitoring/issues/:issueId"
        element={
          <OpsProtected>
            <MonitoringIssueDetail />
          </OpsProtected>
        }
      />
      <Route
        path="/monitoring/sessions"
        element={
          <OpsProtected>
            <MonitoringSessions />
          </OpsProtected>
        }
      />
      <Route
        path="/monitoring/sessions/:sessionId"
        element={
          <OpsProtected>
            <MonitoringSessionDetail />
          </OpsProtected>
        }
      />
      <Route
        path="/monitoring/session-analytics"
        element={
          <OpsProtected>
            <SessionAnalyticsPage />
          </OpsProtected>
        }
      />
      <Route
        path="/monitoring/uptime"
        element={
          <OpsProtected>
            <UptimePage />
          </OpsProtected>
        }
      />
      <Route
        path="/settings/users"
        element={
          <OpsProtected>
            <RequireAdmin>
              <Users />
            </RequireAdmin>
          </OpsProtected>
        }
      />
      <Route path="/api-docs" element={<ApiDocs />} />
      <Route path="/sessions" element={<Navigate to="/monitoring/sessions" replace />} />
      <Route path="/sessions/:id" element={<SessionLegacyRedirect />} />
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}
