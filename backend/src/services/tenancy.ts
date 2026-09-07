import type { Pool } from "pg";
import type { ConsoleProject, OrgRole, ProjectUpstream } from "../types/consoleAuth.js";

export type OrgRow = {
  id: string;
  name: string;
  slug: string;
  suspendedAt: string | null;
  createdAt: string;
  role: OrgRole;
  projectCount: number;
};

export async function listOrgsForUser(pool: Pool, userId: string): Promise<OrgRow[]> {
  const q = await pool.query<{
    id: string;
    name: string;
    slug: string;
    suspended_at: Date | null;
    created_at: Date;
    role: OrgRole;
    project_count: number;
  }>(
    `SELECT o.id::text, o.name, o.slug, o.suspended_at, o.created_at, m.role,
            (SELECT COUNT(*)::int FROM projects p WHERE p.organization_id = o.id) AS project_count
     FROM organization_members m
     JOIN organizations o ON o.id = m.organization_id
     WHERE m.user_id = $1
     ORDER BY o.name ASC`,
    [userId]
  );
  return q.rows.map((r) => ({
    id: r.id,
    name: r.name,
    slug: r.slug,
    suspendedAt: r.suspended_at?.toISOString() ?? null,
    createdAt: r.created_at.toISOString(),
    role: r.role,
    projectCount: r.project_count,
  }));
}

export function toOrgListItem(row: OrgRow) {
  return {
    id: row.id,
    name: row.name,
    slug: row.slug,
    suspended: row.suspendedAt != null,
    createdAt: row.createdAt,
    role: row.role,
    projectCount: row.projectCount,
  };
}

export async function getMembership(
  pool: Pool,
  orgId: string,
  userId: string
): Promise<{ role: OrgRole } | null> {
  const q = await pool.query<{ role: OrgRole }>(
    `SELECT role FROM organization_members
     WHERE organization_id = $1 AND user_id = $2`,
    [orgId, userId]
  );
  return q.rows[0] ?? null;
}

export async function getProject(
  pool: Pool,
  projectId: string
): Promise<(ConsoleProject & { organizationName: string }) | null> {
  const q = await pool.query<{
    id: string;
    organization_id: string;
    name: string;
    slug: string;
    platform: "react-native" | "web";
    allowed_hosts: string[] | null;
    retention_days: number;
    org_name: string;
  }>(
    `SELECT p.id::text, p.organization_id::text, p.name, p.slug, p.platform,
            p.allowed_hosts, p.retention_days, o.name AS org_name
     FROM projects p
     JOIN organizations o ON o.id = p.organization_id
     WHERE p.id = $1`,
    [projectId]
  );
  const r = q.rows[0];
  if (!r) return null;
  return {
    id: r.id,
    organizationId: r.organization_id,
    name: r.name,
    slug: r.slug,
    platform: r.platform,
    allowedHosts: r.allowed_hosts ?? [],
    retentionDays: r.retention_days,
    organizationName: r.org_name,
  };
}

export async function listProjectUpstreams(
  pool: Pool,
  projectId: string
): Promise<ProjectUpstream[]> {
  const q = await pool.query<{
    id: string;
    slug: string;
    host: string;
    label: string;
  }>(
    `SELECT id::text, slug, host, label
     FROM project_upstreams WHERE project_id = $1 ORDER BY slug ASC`,
    [projectId]
  );
  return q.rows;
}

export async function refreshAllowedHosts(pool: Pool, projectId: string): Promise<string[]> {
  const q = await pool.query<{ host: string }>(
    `SELECT DISTINCT lower(host) AS host FROM project_upstreams WHERE project_id = $1`,
    [projectId]
  );
  const hosts = q.rows.map((r) => r.host);
  await pool.query(`UPDATE projects SET allowed_hosts = $2 WHERE id = $1`, [
    projectId,
    hosts,
  ]);
  return hosts;
}
