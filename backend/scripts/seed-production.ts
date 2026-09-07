/**
 * Production bootstrap for ICT Chamber → Marketplace.
 *
 * 1. Upserts ops admin (dashboard_users) when ADMIN_EMAIL/PASSWORD set
 * 2. Upserts console platform admin when CONSOLE_ADMIN_* or ADMIN_* set
 * 3. Ensures ICT Chamber org + Marketplace project + upstreams + ingest keys
 * 4. Assigns all existing telemetry (api_events, session_actions, user_sessions)
 *    to the Marketplace project
 *
 * Usage (from repo root, against production DATABASE_URL):
 *   npm run db:seed:production
 */
import dotenv from "dotenv";
import { resolve } from "path";

dotenv.config({ path: resolve(process.cwd(), ".env") });
dotenv.config({ path: resolve(process.cwd(), "../.env") });

import bcrypt from "bcryptjs";
import { randomUUID } from "crypto";
import pg from "pg";
import { generateApiKey } from "../src/services/apiKeys.js";

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

    const opsEmail = process.env.ADMIN_EMAIL;
    const opsPassword = process.env.ADMIN_PASSWORD;
    if (opsEmail && opsPassword) {
      const hash = await bcrypt.hash(opsPassword, 12);
      await client.query(
        `INSERT INTO dashboard_users (id, email, password_hash, role)
         VALUES ($1, $2, $3, 'admin')
         ON CONFLICT (email) DO UPDATE SET password_hash = EXCLUDED.password_hash, role = 'admin'`,
        [randomUUID(), opsEmail, hash]
      );
      console.log("Ops dashboard admin upserted:", opsEmail);
    } else {
      console.log("Skipping ops admin (ADMIN_EMAIL / ADMIN_PASSWORD not set)");
    }

    const consoleEmail = (
      process.env.CONSOLE_ADMIN_EMAIL ||
      process.env.ADMIN_EMAIL ||
      ""
    ).toLowerCase();
    const consolePassword =
      process.env.CONSOLE_ADMIN_PASSWORD || process.env.ADMIN_PASSWORD || "";

    let platformUserId: string | null = null;
    if (consoleEmail && consolePassword) {
      const hash = await bcrypt.hash(consolePassword, 12);
      const user = await client.query<{ id: string }>(
        `INSERT INTO console_users (email, password_hash, name, is_platform_admin)
         VALUES ($1, $2, 'Platform admin', true)
         ON CONFLICT (email) DO UPDATE SET
           password_hash = EXCLUDED.password_hash,
           is_platform_admin = true
         RETURNING id::text`,
        [consoleEmail, hash]
      );
      platformUserId = user.rows[0]!.id;
      console.log("Monitor platform admin upserted:", consoleEmail);
    } else {
      console.log(
        "Skipping console platform admin (set CONSOLE_ADMIN_EMAIL/PASSWORD or ADMIN_EMAIL/PASSWORD)"
      );
    }

    const org = await client.query<{ id: string }>(
      `INSERT INTO organizations (name, slug)
       VALUES ($1, $2)
       ON CONFLICT (slug) DO UPDATE SET name = EXCLUDED.name
       RETURNING id::text`,
      [ORG_NAME, ORG_SLUG]
    );
    const orgId = org.rows[0]!.id;

    if (platformUserId) {
      await client.query(
        `INSERT INTO organization_members (organization_id, user_id, role)
         VALUES ($1, $2, 'owner')
         ON CONFLICT (organization_id, user_id) DO UPDATE SET role = 'owner'`,
        [orgId, platformUserId]
      );
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

    const existingKeys = await client.query<{ n: string }>(
      `SELECT COUNT(*)::text AS n FROM project_api_keys
       WHERE project_id = $1 AND revoked_at IS NULL`,
      [projectId]
    );
    if (Number(existingKeys.rows[0]?.n) === 0) {
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
    } else {
      console.log("Marketplace project already has API keys (not re-printed).");
    }

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

    console.log("");
    console.log("=== Production seed complete ===");
    console.log(`Org:     ${ORG_NAME} (${ORG_SLUG})  ${orgId}`);
    console.log(`Project: ${PROJECT_NAME} (${PROJECT_SLUG})  ${projectId}`);
    console.log("Assigned telemetry → Marketplace:");
    console.log(
      `  user_sessions    ${sessions.rowCount ?? 0} updated (null: ${before.sessionsNull}, other: ${before.sessionsOther}) → now ${after.sessions}`
    );
    console.log(
      `  session_actions  ${actions.rowCount ?? 0} updated (null: ${before.actionsNull}, other: ${before.actionsOther}) → now ${after.actions}`
    );
    console.log(
      `  api_events       ${apis.rowCount ?? 0} updated (null: ${before.apisNull}, other: ${before.apisOther}) → now ${after.apis}`
    );
    console.log("");
    console.log("Sign in at /login with the platform admin email to open ICT Chamber → Marketplace.");
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
