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
  const user = await client.query<{ id: string }>(
    `INSERT INTO console_users (email, password_hash, name, is_platform_admin)
     VALUES ($1, $2, 'Platform admin', true)
     ON CONFLICT (email) DO UPDATE SET
       password_hash = EXCLUDED.password_hash,
       is_platform_admin = true
     RETURNING id::text`,
    [email, hash]
  );
  const userId = user.rows[0]!.id;
  console.log("Console platform admin upserted:", email);

  const org = await client.query<{ id: string }>(
    `INSERT INTO organizations (name, slug)
     VALUES ('ICT Chamber', 'ict-chamber')
     ON CONFLICT (slug) DO UPDATE SET name = EXCLUDED.name
     RETURNING id::text`
  );
  const orgId = org.rows[0]!.id;
  await client.query(
    `INSERT INTO organization_members (organization_id, user_id, role)
     VALUES ($1, $2, 'owner')
     ON CONFLICT (organization_id, user_id) DO UPDATE SET role = 'owner'`,
    [orgId, userId]
  );

  const project = await client.query<{ id: string }>(
    `INSERT INTO projects (organization_id, name, slug, platform)
     VALUES ($1, 'Marketplace', 'marketplace', 'react-native')
     ON CONFLICT (organization_id, slug) DO UPDATE SET name = EXCLUDED.name
     RETURNING id::text`,
    [orgId]
  );
  const projectId = project.rows[0]!.id;

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
