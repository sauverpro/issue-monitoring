/**
 * Attach existing telemetry to ICT Chamber → Marketplace.
 *
 * Sets project_id on api_events, session_actions, and user_sessions so the
 * organization frontend can see historical (previously unscoped) data.
 *
 * Run from repo root: npm run db:assign-marketplace
 * Or: npm run db:assign-marketplace -w backend
 */
import dotenv from "dotenv";
import { resolve } from "path";

dotenv.config({ path: resolve(process.cwd(), ".env") });
dotenv.config({ path: resolve(process.cwd(), "../.env") });
import pg from "pg";

const ORG_NAME = "ICT Chamber";
const ORG_SLUG = "ict-chamber";
const PROJECT_NAME = "Marketplace";
const PROJECT_SLUG = "marketplace";

const MARKETPLACE_UPSTREAMS = [
  { slug: "MVEND", host: "openapi.gwiza.tech", label: "MVEND / Gwiza Payments API" },
  { slug: "KORALINK", host: "djyh.rw", label: "Koralink Core API" },
  { slug: "DDIN", host: "core-api.ddin.rw", label: "DDIN Digital Services API" },
  { slug: "INTEGRA", host: "rw-prod.intelligra.io", label: "Integra / Intelligra API" },
  { slug: "RESOLVEIT", host: "resolveit.rw", label: "ResolveIt Ticketing API" },
];

async function count(
  client: pg.Client,
  table: string,
  where: string,
  params: unknown[] = []
): Promise<number> {
  const q = await client.query<{ n: string }>(
    `SELECT COUNT(*)::text AS n FROM ${table} ${where}`,
    params
  );
  return Number(q.rows[0]?.n ?? 0);
}

async function main() {
  const url = process.env.DATABASE_URL;
  if (!url) {
    console.error("DATABASE_URL is required");
    process.exit(1);
  }

  const client = new pg.Client({ connectionString: url });
  await client.connect();
  try {
    await client.query("BEGIN");

    const org = await client.query<{ id: string }>(
      `INSERT INTO organizations (name, slug)
       VALUES ($1, $2)
       ON CONFLICT (slug) DO UPDATE SET name = EXCLUDED.name
       RETURNING id::text`,
      [ORG_NAME, ORG_SLUG]
    );
    const orgId = org.rows[0]!.id;

    const adminEmail = (
      process.env.CONSOLE_ADMIN_EMAIL ||
      process.env.ADMIN_EMAIL ||
      ""
    ).toLowerCase();
    if (adminEmail) {
      const user = await client.query<{ id: string }>(
        `SELECT id::text FROM console_users WHERE email = $1`,
        [adminEmail]
      );
      if (user.rows[0]) {
        await client.query(
          `INSERT INTO organization_members (organization_id, user_id, role)
           VALUES ($1, $2, 'owner')
           ON CONFLICT (organization_id, user_id) DO UPDATE SET role = 'owner'`,
          [orgId, user.rows[0].id]
        );
      }
    }

    const project = await client.query<{ id: string }>(
      `INSERT INTO projects (organization_id, name, slug, platform)
       VALUES ($1, $2, $3, 'react-native')
       ON CONFLICT (organization_id, slug) DO UPDATE SET name = EXCLUDED.name
       RETURNING id::text`,
      [orgId, PROJECT_NAME, PROJECT_SLUG]
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
    await client.query(`UPDATE projects SET allowed_hosts = $2 WHERE id = $1`, [
      projectId,
      MARKETPLACE_UPSTREAMS.map((u) => u.host),
    ]);

    const before = {
      sessionsNull: await count(client, "user_sessions", "WHERE project_id IS NULL"),
      sessionsOther: await count(
        client,
        "user_sessions",
        "WHERE project_id IS NOT NULL AND project_id <> $1",
        [projectId]
      ),
      actionsNull: await count(client, "session_actions", "WHERE project_id IS NULL"),
      actionsOther: await count(
        client,
        "session_actions",
        "WHERE project_id IS NOT NULL AND project_id <> $1",
        [projectId]
      ),
      apisNull: await count(client, "api_events", "WHERE project_id IS NULL"),
      apisOther: await count(
        client,
        "api_events",
        "WHERE project_id IS NOT NULL AND project_id <> $1",
        [projectId]
      ),
    };

    const sessions = await client.query(
      `UPDATE user_sessions SET project_id = $1 WHERE project_id IS DISTINCT FROM $1`,
      [projectId]
    );
    const actions = await client.query(
      `UPDATE session_actions SET project_id = $1 WHERE project_id IS DISTINCT FROM $1`,
      [projectId]
    );
    const apis = await client.query(
      `UPDATE api_events SET project_id = $1 WHERE project_id IS DISTINCT FROM $1`,
      [projectId]
    );

    await client.query("COMMIT");

    const after = {
      sessions: await count(client, "user_sessions", "WHERE project_id = $1", [projectId]),
      actions: await count(client, "session_actions", "WHERE project_id = $1", [projectId]),
      apis: await count(client, "api_events", "WHERE project_id = $1", [projectId]),
    };

    console.log(`Org:     ${ORG_NAME} (${ORG_SLUG})  ${orgId}`);
    console.log(`Project: ${PROJECT_NAME} (${PROJECT_SLUG})  ${projectId}`);
    console.log("Updated rows:");
    console.log(`  user_sessions    ${sessions.rowCount ?? 0}  (were null: ${before.sessionsNull}, other project: ${before.sessionsOther})`);
    console.log(`  session_actions  ${actions.rowCount ?? 0}  (were null: ${before.actionsNull}, other project: ${before.actionsOther})`);
    console.log(`  api_events       ${apis.rowCount ?? 0}  (were null: ${before.apisNull}, other project: ${before.apisOther})`);
    console.log("Now on Marketplace:");
    console.log(`  user_sessions    ${after.sessions}`);
    console.log(`  session_actions  ${after.actions}`);
    console.log(`  api_events       ${after.apis}`);
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    await client.end();
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
