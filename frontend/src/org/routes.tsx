import type { ReactNode } from "react";
import { Navigate, Route, useLocation, useParams } from "react-router-dom";
import { useAuth } from "@/org/lib/auth";
import { AppShell } from "@/org/components/AppShell";
import { LoginPage } from "@/org/pages/Login";
import { RegisterPage } from "@/org/pages/Register";
import { OrgsPage } from "@/org/pages/Orgs";
import { OrgHomePage } from "@/org/pages/OrgHome";
import { DashboardPage } from "@/org/pages/Dashboard";
import { UserJourneyPage } from "@/org/pages/UserJourney";
import { UsersPage } from "@/org/pages/Users";
import { JourneyPage } from "@/org/pages/Journey";
import { SessionsPage } from "@/org/pages/Sessions";
import { SessionDetailPage } from "@/org/pages/SessionDetail";
import { ApisPage } from "@/org/pages/Apis";
import { ProblemsPage } from "@/org/pages/Problems";
import { ProblemDetailPage, ProblemUsersPage } from "@/org/pages/ProblemDetail";
import { PerformancePage } from "@/org/pages/Performance";
import { BehaviorPage } from "@/org/pages/Behavior";
import { FunnelsPage } from "@/org/pages/Funnels";
import { SettingsPage } from "@/org/pages/Settings";
import { IntegrationPage } from "@/org/pages/Integration";
import { ReportsPage } from "@/org/pages/Reports";
import { PlatformAdminPage } from "@/platform/pages/Admin";
import { PlatformPackagesPage } from "@/platform/pages/Packages";

function OrgProtected({ children }: { children: ReactNode }) {
  const { auth } = useAuth();
  const loc = useLocation();
  if (!auth.ready) {
    return <p className="p-8 text-zinc-500">Loading…</p>;
  }
  if (!auth.token) {
    return <Navigate to="/login" replace state={{ from: loc }} />;
  }
  return <AppShell>{children}</AppShell>;
}

/** Platform-admin-only routes (merged former console app). */
function PlatformProtected({ children }: { children: ReactNode }) {
  const { auth } = useAuth();
  const loc = useLocation();
  if (!auth.ready) {
    return <p className="p-8 text-zinc-500">Loading…</p>;
  }
  if (!auth.token) {
    return <Navigate to="/login" replace state={{ from: loc }} />;
  }
  if (!auth.isPlatformAdmin) {
    return <Navigate to={auth.org ? `/orgs/${auth.org.id}` : "/"} replace />;
  }
  return <AppShell>{children}</AppShell>;
}

function ProjectIndexRedirect() {
  const { orgId, projectId } = useParams();
  return <Navigate to={`/orgs/${orgId}/projects/${projectId}/overview`} replace />;
}

function LegacyRedirect({ to }: { to: "overview" | "users" | "dashboard" | "journey" }) {
  const { orgId, projectId } = useParams();
  const map = {
    overview: "overview",
    dashboard: "overview",
    journey: "users",
    users: "users",
  };
  return <Navigate to={`/orgs/${orgId}/projects/${projectId}/${map[to]}`} replace />;
}

export const orgRoutes = (
  <>
    <Route path="/login" element={<LoginPage />} />
    <Route path="/register" element={<RegisterPage />} />
    <Route
      path="/platform"
      element={
        <PlatformProtected>
          <PlatformAdminPage />
        </PlatformProtected>
      }
    />
    <Route
      path="/platform/packages"
      element={
        <PlatformProtected>
          <PlatformPackagesPage />
        </PlatformProtected>
      }
    />
    <Route
      path="/"
      element={
        <OrgProtected>
          <OrgsPage />
        </OrgProtected>
      }
    />
    <Route
      path="/orgs/:orgId"
      element={
        <OrgProtected>
          <OrgHomePage />
        </OrgProtected>
      }
    />
    <Route
      path="/orgs/:orgId/projects/:projectId"
      element={
        <OrgProtected>
          <ProjectIndexRedirect />
        </OrgProtected>
      }
    />
    <Route
      path="/orgs/:orgId/projects/:projectId/overview"
      element={
        <OrgProtected>
          <DashboardPage />
        </OrgProtected>
      }
    />
    <Route
      path="/orgs/:orgId/projects/:projectId/dashboard"
      element={
        <OrgProtected>
          <LegacyRedirect to="dashboard" />
        </OrgProtected>
      }
    />
    <Route
      path="/orgs/:orgId/projects/:projectId/journey"
      element={
        <OrgProtected>
          <LegacyRedirect to="journey" />
        </OrgProtected>
      }
    />
    <Route
      path="/orgs/:orgId/projects/:projectId/users"
      element={
        <OrgProtected>
          <UsersPage />
        </OrgProtected>
      }
    />
    <Route
      path="/orgs/:orgId/projects/:projectId/users/:userKey"
      element={
        <OrgProtected>
          <UserJourneyPage />
        </OrgProtected>
      }
    />
    <Route
      path="/orgs/:orgId/projects/:projectId/journeys"
      element={
        <OrgProtected>
          <JourneyPage />
        </OrgProtected>
      }
    />
    <Route
      path="/orgs/:orgId/projects/:projectId/sessions"
      element={
        <OrgProtected>
          <SessionsPage />
        </OrgProtected>
      }
    />
    <Route
      path="/orgs/:orgId/projects/:projectId/sessions/:sessionId"
      element={
        <OrgProtected>
          <SessionDetailPage />
        </OrgProtected>
      }
    />
    <Route
      path="/orgs/:orgId/projects/:projectId/apis"
      element={
        <OrgProtected>
          <ApisPage />
        </OrgProtected>
      }
    />
    <Route
      path="/orgs/:orgId/projects/:projectId/problems"
      element={
        <OrgProtected>
          <ProblemsPage />
        </OrgProtected>
      }
    />
    <Route
      path="/orgs/:orgId/projects/:projectId/problems/:problemKey/users"
      element={
        <OrgProtected>
          <ProblemUsersPage />
        </OrgProtected>
      }
    />
    <Route
      path="/orgs/:orgId/projects/:projectId/problems/:problemKey"
      element={
        <OrgProtected>
          <ProblemDetailPage />
        </OrgProtected>
      }
    />
    <Route
      path="/orgs/:orgId/projects/:projectId/performance"
      element={
        <OrgProtected>
          <PerformancePage />
        </OrgProtected>
      }
    />
    <Route
      path="/orgs/:orgId/projects/:projectId/behavior"
      element={
        <OrgProtected>
          <BehaviorPage />
        </OrgProtected>
      }
    />
    <Route
      path="/orgs/:orgId/projects/:projectId/funnels"
      element={
        <OrgProtected>
          <FunnelsPage />
        </OrgProtected>
      }
    />
    <Route
      path="/orgs/:orgId/projects/:projectId/reports"
      element={
        <OrgProtected>
          <ReportsPage />
        </OrgProtected>
      }
    />
    <Route
      path="/orgs/:orgId/projects/:projectId/settings"
      element={
        <OrgProtected>
          <SettingsPage />
        </OrgProtected>
      }
    />
    <Route
      path="/orgs/:orgId/projects/:projectId/integration"
      element={
        <OrgProtected>
          <IntegrationPage />
        </OrgProtected>
      }
    />
  </>
);
