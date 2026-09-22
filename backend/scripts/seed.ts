import dotenv from "dotenv";
import { resolve } from "path";

dotenv.config({ path: resolve(process.cwd(), ".env") });
dotenv.config({ path: resolve(process.cwd(), "../.env") });
import bcrypt from "bcryptjs";
import pg from "pg";
import { randomUUID } from "crypto";
import { generateApiKey } from "../src/services/apiKeys.js";

const MARKETPLACE_UPSTREAMS = [
  { slug: "MVEND", host: "openapi.gwiza.tech", label: "MVEND / Gwiza Payments API" },
  { slug: "KORALINK", host: "djyh.rw", label: "Koralink Core API" },
  { slug: "DDIN", host: "core-api.ddin.rw", label: "DDIN Digital Services API" },
  { slug: "INTEGRA", host: "rw-prod.intelligra.io", label: "Integra / Intelligra API" },
  { slug: "RESOLVEIT", host: "resolveit.rw", label: "ResolveIt Ticketing API" },
];

/**
 * Org-scoped accounts seeded alongside the platform admin so every role can be
 * signed in and exercised. Real members are provisioned from the UI, which
 * forces a password change; these are ready to use immediately.
 */
const SEEDED_MEMBERS = [
  {
    role: "admin" as const,
    name: "Organization admin",
    emailEnv: "ORG_ADMIN_EMAIL",
    passwordEnv: "ORG_ADMIN_PASSWORD",
    defaultEmail: "orgadmin@ictchamber.rw",
    defaultPassword: "OrgAdmin#2026",
  },
  {
    role: "viewer" as const,
    name: "Organization viewer",
    emailEnv: "ORG_VIEWER_EMAIL",
    passwordEnv: "ORG_VIEWER_PASSWORD",
    defaultEmail: "viewer@ictchamber.rw",
    defaultPassword: "Viewer#2026",
  },
];

async function seedOrgMembers(
  client: pg.Client,
  orgId: string,
  projectId: string
): Promise<void> {
  for (const m of SEEDED_MEMBERS) {
    const email = (process.env[m.emailEnv] || m.defaultEmail).toLowerCase();
    const password = process.env[m.passwordEnv] || m.defaultPassword;
    const hash = await bcrypt.hash(password, 12);
    const user = await client.query<{ id: string }>(
      `INSERT INTO console_users (email, password_hash, name, must_change_password)
       VALUES ($1, $2, $3, false)
       ON CONFLICT (email) DO UPDATE SET
         password_hash = EXCLUDED.password_hash,
         name = EXCLUDED.name,
         must_change_password = false
       RETURNING id::text`,
      [email, hash, m.name]
    );
    const userId = user.rows[0]!.id;
    await client.query(
      `INSERT INTO organization_members (organization_id, user_id, role)
       VALUES ($1, $2, $3)
       ON CONFLICT (organization_id, user_id) DO UPDATE SET role = EXCLUDED.role`,
      [orgId, userId, m.role]
    );
    if (m.role === "viewer") {
      await client.query(
        `INSERT INTO project_members (project_id, user_id)
         VALUES ($1, $2)
         ON CONFLICT DO NOTHING`,
        [projectId, userId]
      );
    } else {
      await client.query(
        `DELETE FROM project_members pm
         USING projects p
         WHERE pm.project_id = p.id AND p.organization_id = $1 AND pm.user_id = $2`,
        [orgId, userId]
      );
    }
    console.log(`  ${m.role.padEnd(6)}  ${email}  /  ${password}`);
  }
}

async function seedConsoleTenant(client: pg.Client): Promise<void> {
  const email = (
    process.env.CONSOLE_ADMIN_EMAIL ||
    process.env.ADMIN_EMAIL ||
    ""
  ).toLowerCase();
  const password = process.env.CONSOLE_ADMIN_PASSWORD || process.env.ADMIN_PASSWORD;
  if (!email || !password) {
    console.log("Skipping console tenant (set CONSOLE_ADMIN_EMAIL/PASSWORD or ADMIN_EMAIL/PASSWORD)");
    return;
  }

  const hash = await bcrypt.hash(password, 12);
  await client.query(
    `INSERT INTO console_users (email, password_hash, name, is_platform_admin, must_change_password)
     VALUES ($1, $2, 'Platform admin', true, false)
     ON CONFLICT (email) DO UPDATE SET
       password_hash = EXCLUDED.password_hash,
       is_platform_admin = true,
       must_change_password = false`,
    [email, hash]
  );

  const org = await client.query<{ id: string }>(
    `INSERT INTO organizations (name, slug)
     VALUES ('ICT Chamber', 'ict-chamber')
     ON CONFLICT (slug) DO UPDATE SET name = EXCLUDED.name
     RETURNING id::text`
  );
  const orgId = org.rows[0]!.id;
  // Platform admins are not org members — they access orgs via platform-admin bypass.
  await client.query(
    `DELETE FROM organization_members m
     USING console_users u
     WHERE m.user_id = u.id AND u.is_platform_admin = true AND m.organization_id = $1`,
    [orgId]
  );

  console.log("Monitor accounts (email / password):");
  console.log(`  super   ${email}  /  ${password}  (platform — not an org member)`);

  const project = await client.query<{ id: string }>(
    `INSERT INTO projects (organization_id, name, slug, platform)
     VALUES ($1, 'Marketplace', 'marketplace', 'react-native')
     ON CONFLICT (organization_id, slug) DO UPDATE SET name = EXCLUDED.name
     RETURNING id::text`,
    [orgId]
  );
  const projectId = project.rows[0]!.id;
  await seedOrgMembers(client, orgId, projectId);

  for (const u of MARKETPLACE_UPSTREAMS) {
    await client.query(
      `INSERT INTO project_upstreams (project_id, slug, host, label)
       VALUES ($1, $2, $3, $4)
       ON CONFLICT (project_id, slug) DO UPDATE SET host = EXCLUDED.host, label = EXCLUDED.label`,
      [projectId, u.slug, u.host, u.label]
    );
  }
  const hosts = MARKETPLACE_UPSTREAMS.map((u) => u.host);
  await client.query(`UPDATE projects SET allowed_hosts = $2 WHERE id = $1`, [
    projectId,
    hosts,
  ]);

  const existingKeys = await client.query<{ n: string }>(
    `SELECT COUNT(*)::text AS n FROM project_api_keys
     WHERE project_id = $1 AND revoked_at IS NULL`,
    [projectId]
  );
  if (Number(existingKeys.rows[0]?.n) > 0) {
    console.log("Marketplace project already has API keys (not re-printed).");
    console.log("  org=ICT Chamber  project=Marketplace  id=" + projectId);
    return;
  }

  for (const name of ["mobile", "web"] as const) {
    const generated = generateApiKey();
    await client.query(
      `INSERT INTO project_api_keys (project_id, name, key_prefix, key_hash)
       VALUES ($1, $2, $3, $4)`,
      [projectId, name, generated.prefix, generated.hash]
    );
    console.log(`Marketplace ${name} ingest key (store now, shown once):`);
    console.log(" ", generated.raw);
  }
  console.log("Sentry sync stays enabled for the ops dashboard until you cut over.");
}

async function main() {
  const url = process.env.DATABASE_URL;
  const email = process.env.ADMIN_EMAIL;
  const password = process.env.ADMIN_PASSWORD;
  if (!url) {
    console.error("DATABASE_URL is required");
    process.exit(1);
  }
  const client = new pg.Client({ connectionString: url });
  await client.connect();
  try {
    if (email && password) {
      const hash = await bcrypt.hash(password, 12);
      await client.query(
        `INSERT INTO dashboard_users (id, email, password_hash, role)
         VALUES ($1, $2, $3, 'admin')
         ON CONFLICT (email) DO UPDATE SET password_hash = EXCLUDED.password_hash, role = 'admin'`,
        [randomUUID(), email, hash]
      );
      console.log("Ops admin user upserted:", email);
    } else {
      console.log("Skipping ops admin (ADMIN_EMAIL / ADMIN_PASSWORD not set)");
    }
    await seedConsoleTenant(client);
  } finally {
    await client.end();
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
