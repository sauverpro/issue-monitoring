import { Navigate } from "react-router-dom";
import { useAuth, orgHomePath } from "@/org/lib/auth";
import { EmptyState, PageHeader } from "@/org/components/ui";

export function OrgsPage() {
  const { auth } = useAuth();

  if (!auth.ready) {
    return <p className="text-zinc-500">Loading…</p>;
  }

  if (auth.isPlatformAdmin && !auth.org) {
    return <Navigate to="/platform" replace />;
  }

  if (auth.org) {
    return <Navigate to={orgHomePath(auth.org)} replace />;
  }

  return (
    <div>
      <PageHeader
        eyebrow="Workspace"
        title="Your organization"
        description="This account is not in an organization yet."
      />
      <EmptyState
        title="No organization assigned"
        body="Ask a platform admin to invite this email. You will only see that organization — not every tenant on the platform."
      />
    </div>
  );
}
