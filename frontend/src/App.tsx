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

function Protected({ children }: { children: ReactNode }) {
  const { auth } = useAuth();
  const loc = useLocation();
  if (!auth.token) {
    return <Navigate to="/login" replace state={{ from: loc }} />;
  }
  return <Layout>{children}</Layout>;
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
      <Route path="/login" element={<Login />} />
      <Route
        path="/"
        element={
          <Protected>
            <Overview />
          </Protected>
        }
      />
      <Route
        path="/incidents"
        element={
          <Protected>
            <Incidents />
          </Protected>
        }
      />
      <Route
        path="/incidents/:id"
        element={
          <Protected>
            <IncidentDetail />
          </Protected>
        }
      />
      <Route
        path="/events"
        element={
          <Protected>
            <Events />
          </Protected>
        }
      />
      <Route
        path="/endpoints"
        element={
          <Protected>
            <Endpoints />
          </Protected>
        }
      />
      <Route
        path="/sentry-sync"
        element={
          <Protected>
            <SentrySync />
          </Protected>
        }
      />
      <Route
        path="/monitoring/issues"
        element={
          <Protected>
            <MonitoringIssues />
          </Protected>
        }
      />
      <Route
        path="/monitoring/issues/:issueId"
        element={
          <Protected>
            <MonitoringIssueDetail />
          </Protected>
        }
      />
      <Route
        path="/monitoring/sessions"
        element={
          <Protected>
            <MonitoringSessions />
          </Protected>
        }
      />
      <Route
        path="/monitoring/sessions/:sessionId"
        element={
          <Protected>
            <MonitoringSessionDetail />
          </Protected>
        }
      />
      <Route
        path="/monitoring/session-analytics"
        element={
          <Protected>
            <SessionAnalyticsPage />
          </Protected>
        }
      />
      <Route path="/api-docs" element={<ApiDocs />} />
      <Route path="/sessions" element={<Navigate to="/monitoring/sessions" replace />} />
      <Route
        path="/sessions/:id"
        element={<SessionLegacyRedirect />}
      />
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}
