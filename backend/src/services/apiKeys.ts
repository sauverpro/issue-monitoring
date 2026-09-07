import { createHash, randomBytes } from "crypto";
import type { Pool } from "pg";

export type GeneratedApiKey = {
  raw: string;
  prefix: string;
  hash: string;
};

export function hashApiKey(raw: string): string {
  return createHash("sha256").update(raw.trim()).digest("hex");
}

export function generateApiKey(): GeneratedApiKey {
  const raw = `mntr_${randomBytes(24).toString("base64url")}`;
  return {
    raw,
    prefix: raw.slice(0, 12),
    hash: hashApiKey(raw),
  };
}

export type ResolvedProjectKey = {
  keyId: string;
  projectId: string;
  organizationId: string;
  allowedHosts: string[];
  suspended: boolean;
};

export async function resolveProjectApiKey(
  pool: Pool,
  rawKey: string | undefined
): Promise<ResolvedProjectKey | null> {
  if (!rawKey) return null;
  const hash = hashApiKey(rawKey);
  const q = await pool.query<{
    key_id: string;
    project_id: string;
    organization_id: string;
    allowed_hosts: string[] | null;
    suspended_at: Date | null;
  }>(
    `SELECT k.id::text AS key_id,
            p.id::text AS project_id,
            p.organization_id::text AS organization_id,
            p.allowed_hosts,
            o.suspended_at
     FROM project_api_keys k
     JOIN projects p ON p.id = k.project_id
     JOIN organizations o ON o.id = p.organization_id
     WHERE k.key_hash = $1 AND k.revoked_at IS NULL`,
    [hash]
  );
  const row = q.rows[0];
  if (!row) return null;
  return {
    keyId: row.key_id,
    projectId: row.project_id,
    organizationId: row.organization_id,
    allowedHosts: row.allowed_hosts ?? [],
    suspended: row.suspended_at != null,
  };
}

export async function touchApiKeyLastUsed(pool: Pool, keyId: string): Promise<void> {
  await pool.query(
    `UPDATE project_api_keys SET last_used_at = now() WHERE id = $1`,
    [keyId]
  );
}
