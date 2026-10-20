/**
 * Feedback backlog + release calendar (workplan 9.2.1). Feedback comes from
 * supervisors / support channels (entered by staff) or in-app (ingest key) and
 * is routed into an enhancement backlog that links to the release that shipped it.
 */
import type { Pool } from "pg";
import { z } from "zod";
import type { DateRange } from "./monitorJourney.js";

export const FEEDBACK_SOURCES = ["supervisor", "support_call", "whatsapp", "field_visit", "in_app", "email", "other"] as const;
export const FEEDBACK_CATEGORIES = ["bug", "request", "complaint", "question", "praise"] as const;
export const FEEDBACK_PRIORITIES = ["low", "medium", "high", "critical"] as const;
export const FEEDBACK_STATUSES = ["new", "triaged", "planned", "in_progress", "done", "wont_do"] as const;
export const RELEASE_KINDS = ["major", "minor", "patch", "hotfix"] as const;
export const RELEASE_STATUSES = ["planned", "released", "cancelled"] as const;

const featureSchema = z
  .string()
  .max(40)
  .transform((s) => s.trim().toLowerCase().replace(/[^a-z0-9-]+/g, "-").replace(/^-+|-+$/g, "") || "general");

const optionalText = (max: number) =>
  z
    .string()
    .max(max)
    .optional()
    .nullable()
    .transform((s) => (s && s.trim() ? s.trim() : null));

export const feedbackCreateSchema = z.object({
  title: z.string().trim().min(1).max(160),
  details: z.string().max(4000).default(""),
  source: z.enum(FEEDBACK_SOURCES).default("supervisor"),
  category: z.enum(FEEDBACK_CATEGORIES).default("request"),
  feature: featureSchema.default("general"),
  priority: z.enum(FEEDBACK_PRIORITIES).default("medium"),
  reporterName: optionalText(120),
  reporterContact: optionalText(120),
  userEmail: optionalText(200),
  userId: optionalText(200),
  sessionId: optionalText(200),
});

export const feedbackUpdateSchema = z
  .object({
    title: z.string().trim().min(1).max(160),
    details: z.string().max(4000),
    category: z.enum(FEEDBACK_CATEGORIES),
    feature: featureSchema,
    priority: z.enum(FEEDBACK_PRIORITIES),
    status: z.enum(FEEDBACK_STATUSES),
    releaseId: z.string().uuid().nullable(),
  })
  .partial();

/** In-app feedback posted by the instrumented app with its ingest key. */
export const ingestFeedbackSchema = z.object({
  message: z.string().trim().min(1).max(4000),
  title: z.string().trim().max(160).optional(),
  category: z.enum(FEEDBACK_CATEGORIES).default("request"),
  feature: featureSchema.optional(),
  screen: z.string().max(200).optional(),
  session: z
    .object({
      id: z.string().max(200).optional(),
      user_id: z.string().max(200).optional(),
      email: z.string().max(200).optional(),
      name: z.string().max(120).optional(),
    })
    .optional(),
});

export const releaseCreateSchema = z.object({
  version: z.string().trim().min(1).max(40),
  title: z.string().trim().max(160).default(""),
  kind: z.enum(RELEASE_KINDS).default("patch"),
  status: z.enum(RELEASE_STATUSES).default("planned"),
  plannedFor: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .nullable()
    .optional(),
  releasedAt: z.string().datetime({ offset: true }).nullable().optional(),
  notes: z.string().max(8000).default(""),
});

export const releaseUpdateSchema = releaseCreateSchema.partial();

/** CI deploy hook: records (or marks released) a version for the project. */
export const ingestReleaseSchema = z.object({
  version: z.string().trim().min(1).max(40),
  title: z.string().trim().max(160).optional(),
  kind: z.enum(RELEASE_KINDS).optional(),
  notes: z.string().max(8000).optional(),
  commit_sha: z.string().max(64).optional(),
  released_at: z.string().datetime({ offset: true }).optional(),
});

export type FeedbackItem = {
  id: string;
  title: string;
  details: string;
  source: string;
  category: string;
  feature: string;
  priority: string;
  status: string;
  reporterName: string | null;
  reporterContact: string | null;
  userEmail: string | null;
  userId: string | null;
  sessionId: string | null;
  releaseId: string | null;
  releaseVersion: string | null;
  createdBy: string | null;
  createdAt: string;
  updatedAt: string;
  resolvedAt: string | null;
};

const FEEDBACK_SELECT = `
  SELECT f.id::text, f.title, f.details, f.source, f.category, f.feature, f.priority, f.status,
         f.reporter_name, f.reporter_contact, f.user_email, f.user_id, f.session_id,
         f.release_id::text, r.version AS release_version, u.email AS created_by,
         f.created_at, f.updated_at, f.resolved_at
  FROM project_feedback f
  LEFT JOIN project_releases r ON r.id = f.release_id
  LEFT JOIN console_users u ON u.id = f.created_by`;

function mapFeedback(r: Record<string, unknown>): FeedbackItem {
  return {
    id: r.id as string,
    title: r.title as string,
    details: r.details as string,
    source: r.source as string,
    category: r.category as string,
    feature: r.feature as string,
    priority: r.priority as string,
    status: r.status as string,
    reporterName: (r.reporter_name as string) ?? null,
    reporterContact: (r.reporter_contact as string) ?? null,
    userEmail: (r.user_email as string) ?? null,
    userId: (r.user_id as string) ?? null,
    sessionId: (r.session_id as string) ?? null,
    releaseId: (r.release_id as string) ?? null,
    releaseVersion: (r.release_version as string) ?? null,
    createdBy: (r.created_by as string) ?? null,
    createdAt: (r.created_at as Date).toISOString(),
    updatedAt: (r.updated_at as Date).toISOString(),
    resolvedAt: r.resolved_at ? (r.resolved_at as Date).toISOString() : null,
  };
}

export async function listFeedback(
  pool: Pool,
  projectId: string,
  filters: { status?: string; feature?: string; source?: string; category?: string; search?: string } = {}
): Promise<FeedbackItem[]> {
  const conds = ["f.project_id = $1"];
  const params: unknown[] = [projectId];
  const add = (sql: string, v: unknown) => {
    params.push(v);
    conds.push(sql.replace("?", `$${params.length}`));
  };
  if (filters.status === "open") conds.push(`f.status NOT IN ('done', 'wont_do')`);
  else if (filters.status) add("f.status = ?", filters.status);
  if (filters.feature) add("f.feature = ?", filters.feature);
  if (filters.source) add("f.source = ?", filters.source);
  if (filters.category) add("f.category = ?", filters.category);
  if (filters.search) {
    params.push(`%${filters.search}%`);
    conds.push(`(f.title ILIKE $${params.length} OR f.details ILIKE $${params.length})`);
  }
  const q = await pool.query(
    `${FEEDBACK_SELECT} WHERE ${conds.join(" AND ")}
     ORDER BY CASE f.priority WHEN 'critical' THEN 0 WHEN 'high' THEN 1 WHEN 'medium' THEN 2 ELSE 3 END,
              f.created_at DESC
     LIMIT 500`,
    params
  );
  return q.rows.map(mapFeedback);
}

export async function getFeedback(pool: Pool, projectId: string, id: string): Promise<FeedbackItem | null> {
  const q = await pool.query(`${FEEDBACK_SELECT} WHERE f.project_id = $1 AND f.id = $2`, [projectId, id]);
  return q.rows[0] ? mapFeedback(q.rows[0]) : null;
}

export async function createFeedback(
  pool: Pool,
  projectId: string,
  input: z.infer<typeof feedbackCreateSchema>,
  createdBy: string | null
): Promise<string> {
  const q = await pool.query<{ id: string }>(
    `INSERT INTO project_feedback
       (project_id, title, details, source, category, feature, priority,
        reporter_name, reporter_contact, user_email, user_id, session_id, created_by)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)
     RETURNING id::text`,
    [
      projectId,
      input.title,
      input.details,
      input.source,
      input.category,
      input.feature,
      input.priority,
      input.reporterName,
      input.reporterContact,
      input.userEmail,
      input.userId,
      input.sessionId,
      createdBy,
    ]
  );
  return q.rows[0]!.id;
}

export async function updateFeedback(
  pool: Pool,
  projectId: string,
  id: string,
  patch: z.infer<typeof feedbackUpdateSchema>
): Promise<boolean> {
  const cols: Record<string, string> = {
    title: "title",
    details: "details",
    category: "category",
    feature: "feature",
    priority: "priority",
    status: "status",
    releaseId: "release_id",
  };
  const sets: string[] = [];
  const params: unknown[] = [projectId, id];
  for (const [key, col] of Object.entries(cols)) {
    const v = (patch as Record<string, unknown>)[key];
    if (v === undefined) continue;
    params.push(v);
    sets.push(`${col} = $${params.length}`);
  }
  if (patch.status !== undefined) {
    sets.push(
      patch.status === "done" || patch.status === "wont_do"
        ? "resolved_at = COALESCE(resolved_at, now())"
        : "resolved_at = NULL"
    );
  }
  if (patch.releaseId) {
    // Linking to a release must stay within the same project.
    const ok = await pool.query(`SELECT 1 FROM project_releases WHERE id = $1 AND project_id = $2`, [
      patch.releaseId,
      projectId,
    ]);
    if (!ok.rows.length) throw new Error("Release not found on this project");
  }
  if (sets.length === 0) return true;
  sets.push("updated_at = now()");
  const q = await pool.query(
    `UPDATE project_feedback SET ${sets.join(", ")} WHERE project_id = $1 AND id = $2`,
    params
  );
  return (q.rowCount ?? 0) > 0;
}

export type ReleaseItem = {
  id: string;
  version: string;
  title: string;
  kind: string;
  status: string;
  plannedFor: string | null;
  releasedAt: string | null;
  notes: string;
  source: string;
  commitSha: string | null;
  createdBy: string | null;
  createdAt: string;
  feedbackCount: number;
  feedbackDone: number;
};

function mapRelease(r: Record<string, unknown>): ReleaseItem {
  return {
    id: r.id as string,
    version: r.version as string,
    title: r.title as string,
    kind: r.kind as string,
    status: r.status as string,
    plannedFor: (r.planned_for as string) ?? null,
    releasedAt: r.released_at ? (r.released_at as Date).toISOString() : null,
    notes: r.notes as string,
    source: r.source as string,
    commitSha: (r.commit_sha as string) ?? null,
    createdBy: (r.created_by as string) ?? null,
    createdAt: (r.created_at as Date).toISOString(),
    feedbackCount: Number(r.feedback_count ?? 0),
    feedbackDone: Number(r.feedback_done ?? 0),
  };
}

export async function listReleases(pool: Pool, projectId: string): Promise<ReleaseItem[]> {
  const q = await pool.query(
    `SELECT r.id::text, r.version, r.title, r.kind, r.status, to_char(r.planned_for, 'YYYY-MM-DD') AS planned_for,
            r.released_at, r.notes, r.source, r.commit_sha, u.email AS created_by, r.created_at,
            (SELECT COUNT(*) FROM project_feedback f WHERE f.release_id = r.id) AS feedback_count,
            (SELECT COUNT(*) FROM project_feedback f WHERE f.release_id = r.id AND f.status = 'done') AS feedback_done
     FROM project_releases r
     LEFT JOIN console_users u ON u.id = r.created_by
     WHERE r.project_id = $1
     ORDER BY COALESCE(r.released_at, r.planned_for::timestamp AT TIME ZONE 'UTC', r.created_at) DESC
     LIMIT 300`,
    [projectId]
  );
  return q.rows.map(mapRelease);
}

/** Planned releases default to released "now" when marked released without a date. */
function releasedAtFor(status: string | undefined, releasedAt: string | null | undefined): string | null | undefined {
  if (releasedAt !== undefined) return releasedAt;
  if (status === "released") return new Date().toISOString();
  if (status) return null;
  return undefined;
}

export async function createRelease(
  pool: Pool,
  projectId: string,
  input: z.infer<typeof releaseCreateSchema>,
  createdBy: string | null
): Promise<string> {
  const q = await pool.query<{ id: string }>(
    `INSERT INTO project_releases (project_id, version, title, kind, status, planned_for, released_at, notes, created_by)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9) RETURNING id::text`,
    [
      projectId,
      input.version,
      input.title,
      input.kind,
      input.status,
      input.plannedFor ?? null,
      releasedAtFor(input.status, input.releasedAt) ?? null,
      input.notes,
      createdBy,
    ]
  );
  return q.rows[0]!.id;
}

export async function updateRelease(
  pool: Pool,
  projectId: string,
  id: string,
  patch: z.infer<typeof releaseUpdateSchema>
): Promise<boolean> {
  const current = await pool.query<{ released_at: Date | null }>(
    `SELECT released_at FROM project_releases WHERE project_id = $1 AND id = $2`,
    [projectId, id]
  );
  if (!current.rows.length) return false;
  const values: Record<string, unknown> = {
    version: patch.version,
    title: patch.title,
    kind: patch.kind,
    status: patch.status,
    planned_for: patch.plannedFor,
    notes: patch.notes,
    released_at:
      patch.releasedAt !== undefined
        ? patch.releasedAt
        : patch.status === "released"
          ? (current.rows[0]!.released_at?.toISOString() ?? new Date().toISOString())
          : patch.status
            ? null
            : undefined,
  };
  const sets: string[] = [];
  const params: unknown[] = [projectId, id];
  for (const [col, v] of Object.entries(values)) {
    if (v === undefined) continue;
    params.push(v);
    sets.push(`${col} = $${params.length}`);
  }
  if (sets.length === 0) return true;
  sets.push("updated_at = now()");
  await pool.query(`UPDATE project_releases SET ${sets.join(", ")} WHERE project_id = $1 AND id = $2`, params);
  return true;
}

/** Upsert from the CI deploy hook: an existing planned version is marked released. */
export async function recordCiRelease(
  pool: Pool,
  projectId: string,
  input: z.infer<typeof ingestReleaseSchema>
): Promise<{ id: string; created: boolean }> {
  const q = await pool.query<{ id: string; inserted: boolean }>(
    `INSERT INTO project_releases (project_id, version, title, kind, status, released_at, notes, source, commit_sha)
     VALUES ($1, $2, COALESCE($3, ''), COALESCE($4, 'patch'), 'released', COALESCE($5::timestamptz, now()),
             COALESCE($6, ''), 'ci', $7)
     ON CONFLICT (project_id, version) DO UPDATE SET
       status = 'released',
       released_at = COALESCE(project_releases.released_at, EXCLUDED.released_at),
       title = CASE WHEN project_releases.title = '' THEN EXCLUDED.title ELSE project_releases.title END,
       notes = CASE WHEN project_releases.notes = '' THEN EXCLUDED.notes ELSE project_releases.notes END,
       commit_sha = COALESCE(EXCLUDED.commit_sha, project_releases.commit_sha),
       updated_at = now()
     RETURNING id::text, (xmax = 0) AS inserted`,
    [
      projectId,
      input.version,
      input.title ?? null,
      input.kind ?? null,
      input.released_at ?? null,
      input.notes ?? null,
      input.commit_sha ?? null,
    ]
  );
  return { id: q.rows[0]!.id, created: q.rows[0]!.inserted };
}

export type FeedbackSummary = {
  received: number;
  resolved: number;
  open: number;
  medianResolutionHours: number | null;
  byFeature: { feature: string; total: number; open: number }[];
  bySource: { source: string; total: number }[];
  byCategory: { category: string; total: number }[];
  topOpen: { title: string; feature: string; priority: string; status: string; createdAt: string }[];
};

/** Feedback received / resolved inside a reporting window plus the current open backlog. */
export async function getFeedbackSummary(pool: Pool, projectId: string, range: DateRange): Promise<FeedbackSummary> {
  const [counts, byFeature, bySource, byCategory, topOpen] = await Promise.all([
    pool.query<{ received: string; resolved: string; open: string; median_h: string | null }>(
      `SELECT
         COUNT(*) FILTER (WHERE created_at BETWEEN $2 AND $3)::text AS received,
         COUNT(*) FILTER (WHERE resolved_at BETWEEN $2 AND $3)::text AS resolved,
         COUNT(*) FILTER (WHERE status NOT IN ('done', 'wont_do'))::text AS open,
         (percentile_cont(0.5) WITHIN GROUP (ORDER BY EXTRACT(EPOCH FROM (resolved_at - created_at)) / 3600)
           FILTER (WHERE resolved_at BETWEEN $2 AND $3))::text AS median_h
       FROM project_feedback WHERE project_id = $1`,
      [projectId, range.from, range.to]
    ),
    pool.query<{ feature: string; total: string; open: string }>(
      `SELECT feature, COUNT(*)::text AS total,
              COUNT(*) FILTER (WHERE status NOT IN ('done', 'wont_do'))::text AS open
       FROM project_feedback
       WHERE project_id = $1 AND (created_at BETWEEN $2 AND $3 OR status NOT IN ('done', 'wont_do'))
       GROUP BY feature ORDER BY COUNT(*) DESC LIMIT 10`,
      [projectId, range.from, range.to]
    ),
    pool.query<{ source: string; total: string }>(
      `SELECT source, COUNT(*)::text AS total FROM project_feedback
       WHERE project_id = $1 AND created_at BETWEEN $2 AND $3
       GROUP BY source ORDER BY COUNT(*) DESC`,
      [projectId, range.from, range.to]
    ),
    pool.query<{ category: string; total: string }>(
      `SELECT category, COUNT(*)::text AS total FROM project_feedback
       WHERE project_id = $1 AND created_at BETWEEN $2 AND $3
       GROUP BY category ORDER BY COUNT(*) DESC`,
      [projectId, range.from, range.to]
    ),
    pool.query<{ title: string; feature: string; priority: string; status: string; created_at: Date }>(
      `SELECT title, feature, priority, status, created_at FROM project_feedback
       WHERE project_id = $1 AND status NOT IN ('done', 'wont_do')
       ORDER BY CASE priority WHEN 'critical' THEN 0 WHEN 'high' THEN 1 WHEN 'medium' THEN 2 ELSE 3 END,
                created_at ASC
       LIMIT 8`,
      [projectId]
    ),
  ]);
  const c = counts.rows[0]!;
  return {
    received: Number(c.received),
    resolved: Number(c.resolved),
    open: Number(c.open),
    medianResolutionHours: c.median_h == null ? null : Number(c.median_h),
    byFeature: byFeature.rows.map((r) => ({ feature: r.feature, total: Number(r.total), open: Number(r.open) })),
    bySource: bySource.rows.map((r) => ({ source: r.source, total: Number(r.total) })),
    byCategory: byCategory.rows.map((r) => ({ category: r.category, total: Number(r.total) })),
    topOpen: topOpen.rows.map((r) => ({
      title: r.title,
      feature: r.feature,
      priority: r.priority,
      status: r.status,
      createdAt: r.created_at.toISOString(),
    })),
  };
}

export type ReleaseSummary = {
  shipped: { version: string; title: string; kind: string; releasedAt: string; feedbackDone: number }[];
  upcoming: { version: string; title: string; kind: string; plannedFor: string | null }[];
};

export async function getReleaseSummary(pool: Pool, projectId: string, range: DateRange): Promise<ReleaseSummary> {
  const [shipped, upcoming] = await Promise.all([
    pool.query<{ version: string; title: string; kind: string; released_at: Date; done: string }>(
      `SELECT r.version, r.title, r.kind, r.released_at,
              (SELECT COUNT(*) FROM project_feedback f WHERE f.release_id = r.id AND f.status = 'done')::text AS done
       FROM project_releases r
       WHERE r.project_id = $1 AND r.status = 'released' AND r.released_at BETWEEN $2 AND $3
       ORDER BY r.released_at DESC LIMIT 20`,
      [projectId, range.from, range.to]
    ),
    pool.query<{ version: string; title: string; kind: string; planned_for: string | null }>(
      `SELECT version, title, kind, to_char(planned_for, 'YYYY-MM-DD') AS planned_for
       FROM project_releases
       WHERE project_id = $1 AND status = 'planned'
       ORDER BY planned_for ASC NULLS LAST, created_at ASC LIMIT 10`,
      [projectId]
    ),
  ]);
  return {
    shipped: shipped.rows.map((r) => ({
      version: r.version,
      title: r.title,
      kind: r.kind,
      releasedAt: r.released_at.toISOString(),
      feedbackDone: Number(r.done),
    })),
    upcoming: upcoming.rows.map((r) => ({
      version: r.version,
      title: r.title,
      kind: r.kind,
      plannedFor: r.planned_for,
    })),
  };
}
