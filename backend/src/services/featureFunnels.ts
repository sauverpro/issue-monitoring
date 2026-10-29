/**
 * Named feature-adoption funnels (workplan 9.2.1). Each funnel is an ordered list
 * of steps; a step matches either a screen visit (session_actions) or an API call
 * (api_events). A user reaches step N when they hit it at or after the moment they
 * reached step N-1, so the funnel measures real progression, not unrelated visits.
 */
import type { Pool } from "pg";
import { z } from "zod";
import type { DateRange } from "./monitorJourney.js";
import { navKindSql, screenLabelSql } from "./monitorScreenLabel.js";

export const screenStepSchema = z.object({
  type: z.literal("screen"),
  label: z.string().min(1).max(80),
  match: z.enum(["exact", "prefix", "contains"]).default("prefix"),
  value: z.string().min(1).max(200),
});

export const apiStepSchema = z.object({
  type: z.literal("api"),
  label: z.string().min(1).max(80),
  method: z
    .string()
    .max(10)
    .optional()
    .transform((m) => (m ? m.trim().toUpperCase() : undefined)),
  /** Path pattern; `{id}` or `*` matches one path segment. */
  path: z.string().min(1).max(200),
  /** Only count successful (2xx/3xx) calls as reaching the step. */
  successOnly: z.boolean().default(true),
});

export const funnelStepSchema = z.discriminatedUnion("type", [screenStepSchema, apiStepSchema]);
export type FunnelStepDef = z.infer<typeof funnelStepSchema>;

export const funnelDefSchema = z.object({
  name: z.string().min(1).max(80),
  feature: z.string().min(1).max(40).default("general"),
  description: z.string().max(400).default(""),
  steps: z.array(funnelStepSchema).min(2).max(8),
});
export type FunnelDef = z.infer<typeof funnelDefSchema>;

/** Starter funnels built from the Marketplace agent app's real screens and APIs. */
export const FUNNEL_TEMPLATES: (FunnelDef & { key: string })[] = [
  {
    key: "ordering",
    name: "Stock ordering",
    feature: "ordering",
    description: "Agent previews a stock order, places it, then confirms delivery.",
    steps: [
      { type: "api", label: "Order previewed", method: "POST", path: "/stock-orders/preview", successOnly: true },
      { type: "api", label: "Order placed", method: "POST", path: "/stock-orders", successOnly: true },
      { type: "api", label: "Delivery received", method: "POST", path: "/stock-orders/{id}/received", successOnly: true },
    ],
  },
  {
    key: "contracting",
    name: "Digital contracting",
    feature: "contracting",
    description: "Agent opens a contract, reads it, verifies identity and signs with an OTP.",
    steps: [
      { type: "api", label: "Contract opened", method: "POST", path: "/contracts/{id}/view", successOnly: false },
      { type: "api", label: "Read acknowledged", method: "POST", path: "/contracts/{id}/acknowledge-read", successOnly: true },
      { type: "api", label: "National ID verified", method: "POST", path: "/contracts/{id}/verify-national-id", successOnly: true },
      { type: "api", label: "OTP sent", method: "POST", path: "/contracts/{id}/otp", successOnly: true },
      { type: "api", label: "Signed (OTP verified)", method: "POST", path: "/contracts/{id}/otp/verify", successOnly: true },
    ],
  },
  {
    key: "coupons",
    name: "Coupon redemption",
    feature: "coupons",
    description: "Agent opens voucher management and reviews redeemed coupons.",
    steps: [
      { type: "screen", label: "Voucher management", match: "prefix", value: "/voucher-management" },
      { type: "screen", label: "Coupon history", match: "prefix", value: "/coupon-history" },
    ],
  },
  {
    key: "bill-payment",
    name: "Bill payment (DDIN)",
    feature: "digital-services",
    description: "Agent opens digital services, validates a biller and completes the payment.",
    steps: [
      { type: "screen", label: "Digital services", match: "prefix", value: "/digital-services" },
      { type: "api", label: "Biller validated", method: "POST", path: "/services/validate/biller", successOnly: true },
      { type: "api", label: "Payment executed", method: "POST", path: "/services/execute/bill-payment", successOnly: true },
    ],
  },
  {
    key: "wallet-transfer",
    name: "Wallet transfer",
    feature: "payments",
    description: "Agent opens the wallet, validates and sends a transfer.",
    steps: [
      { type: "screen", label: "Wallet opened", match: "prefix", value: "/wallet" },
      { type: "api", label: "Transfer validated", method: "POST", path: "/transfer/validatesend", successOnly: true },
      { type: "api", label: "Transfer sent", method: "POST", path: "/transfer", successOnly: true },
    ],
  },
];

/** Escape a literal for a POSIX regex (Postgres `~`). */
function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * Path pattern → anchored-at-end regex. `{id}` / `*` match one segment, so
 * `/stock-orders` matches `/api/v1/stock-orders` but not `/stock-orders/preview`.
 */
export function pathPatternToRegex(pattern: string): string {
  const trimmed = pattern.trim().replace(/\/+$/, "");
  const parts = trimmed.split(/(\{[^}]*\}|\*)/g);
  const body = parts
    .map((p) => (p === "*" || /^\{[^}]*\}$/.test(p) ? "[^/?]+" : escapeRegex(p)))
    .join("");
  return `${body}/?([?#].*)?$`;
}

/** ILIKE pattern for a screen matcher. */
export function screenLikePattern(match: "exact" | "prefix" | "contains", value: string): string {
  const v = value.trim().replace(/[\\%_]/g, (c) => `\\${c}`);
  if (match === "exact") return v;
  if (match === "prefix") return `${v}%`;
  return `%${v}%`;
}

export type StepHit = { userKey: string; at: number; ok: boolean };

export type FunnelStepResult = {
  label: string;
  type: "screen" | "api";
  users: number;
  /** For API steps: users who attempted after the prior step but never succeeded. */
  failedUsers: number;
  conversionFromStart: number;
  conversionFromPrev: number;
};

export type FunnelResult = {
  steps: FunnelStepResult[];
  started: number;
  completed: number;
  completionRate: number;
  medianCompletionMs: number | null;
  biggestDrop: { from: string; to: string; lost: number; rate: number } | null;
};

/**
 * Sequential funnel over per-step hits. A user enters at their first step-0 hit
 * and advances to step N at the earliest successful hit no earlier than step N-1.
 */
export function computeSequentialFunnel(
  labels: { label: string; type: "screen" | "api" }[],
  hitsPerStep: StepHit[][]
): FunnelResult {
  const byStep = hitsPerStep.map((hits) => {
    const m = new Map<string, StepHit[]>();
    for (const h of hits) {
      const arr = m.get(h.userKey);
      if (arr) arr.push(h);
      else m.set(h.userKey, [h]);
    }
    for (const arr of m.values()) arr.sort((a, b) => a.at - b.at);
    return m;
  });

  const reached = labels.map(() => 0);
  const failed = labels.map(() => 0);
  const durations: number[] = [];

  const entrants = byStep[0] ?? new Map<string, StepHit[]>();
  for (const [user, hits] of entrants) {
    const first = hits.find((h) => h.ok);
    if (!first) continue;
    reached[0]! += 1;
    let t = first.at;
    let advanced = true;
    for (let i = 1; i < labels.length && advanced; i++) {
      const later = (byStep[i]?.get(user) ?? []).filter((h) => h.at >= t);
      const ok = later.find((h) => h.ok);
      if (ok) {
        reached[i]! += 1;
        t = ok.at;
        if (i === labels.length - 1) durations.push(t - first.at);
      } else {
        if (later.length > 0) failed[i]! += 1;
        advanced = false;
      }
    }
  }

  const started = reached[0] ?? 0;
  const steps: FunnelStepResult[] = labels.map((l, i) => ({
    label: l.label,
    type: l.type,
    users: reached[i]!,
    failedUsers: failed[i]!,
    conversionFromStart: started ? reached[i]! / started : 0,
    conversionFromPrev: i === 0 ? 1 : reached[i - 1]! ? reached[i]! / reached[i - 1]! : 0,
  }));

  let biggestDrop: FunnelResult["biggestDrop"] = null;
  for (let i = 1; i < steps.length; i++) {
    const lost = steps[i - 1]!.users - steps[i]!.users;
    if (lost > 0 && (!biggestDrop || lost > biggestDrop.lost)) {
      biggestDrop = {
        from: steps[i - 1]!.label,
        to: steps[i]!.label,
        lost,
        rate: steps[i - 1]!.users ? lost / steps[i - 1]!.users : 0,
      };
    }
  }

  durations.sort((a, b) => a - b);
  const completed = steps[steps.length - 1]?.users ?? 0;
  return {
    steps,
    started,
    completed,
    completionRate: started ? completed / started : 0,
    medianCompletionMs: durations.length ? durations[Math.floor(durations.length / 2)]! : null,
    biggestDrop,
  };
}

const API_USER_SQL = `COALESCE(NULLIF(TRIM(e.user_id), ''), NULLIF(TRIM(e.user_email), ''),
  NULLIF(TRIM(us.user_id), ''), NULLIF(TRIM(us.user_email), ''), e.session_id)`;
const ACTION_USER_SQL = `COALESCE(NULLIF(TRIM(us.user_id), ''), NULLIF(TRIM(us.user_email), ''), a.session_id)`;
const API_OK_SQL = `((e.status_code BETWEEN 200 AND 399)
  OR (COALESCE(e.status_code, 0) = 0 AND UPPER(COALESCE(e.outcome, '')) = 'SUCCESS'))`;

async function fetchStepHits(
  pool: Pool,
  projectId: string,
  range: DateRange,
  step: FunnelStepDef
): Promise<StepHit[]> {
  if (step.type === "screen") {
    const q = await pool.query<{ user_key: string; at: Date }>(
      `SELECT ${ACTION_USER_SQL} AS user_key, a.occurred_at AS at
       FROM session_actions a
       LEFT JOIN user_sessions us ON us.session_id = a.session_id
       WHERE a.project_id = $1 AND ${navKindSql("a")}
         AND a.occurred_at >= $2 AND a.occurred_at <= $3
         AND ${screenLabelSql("a")} ILIKE $4`,
      [projectId, range.from, range.to, screenLikePattern(step.match, step.value)]
    );
    return q.rows.map((r) => ({ userKey: r.user_key, at: r.at.getTime(), ok: true }));
  }
  const params: unknown[] = [projectId, range.from, range.to, pathPatternToRegex(step.path)];
  let methodCond = "";
  if (step.method) {
    params.push(step.method);
    methodCond = `AND UPPER(COALESCE(e.http_method, '')) = $${params.length}`;
  }
  const q = await pool.query<{ user_key: string; at: Date; ok: boolean }>(
    `SELECT ${API_USER_SQL} AS user_key, e.occurred_at AS at, ${API_OK_SQL} AS ok
     FROM api_events_real e
     LEFT JOIN user_sessions us ON us.session_id = e.session_id
     WHERE e.project_id = $1
       AND e.occurred_at >= $2 AND e.occurred_at <= $3
       AND COALESCE(NULLIF(e.endpoint, ''), e.request_url, '') ~* $4
       ${methodCond}`,
    params
  );
  return q.rows
    .filter((r) => r.user_key)
    .map((r) => ({ userKey: r.user_key, at: r.at.getTime(), ok: step.successOnly ? r.ok : true }));
}

export async function evaluateFunnel(
  pool: Pool,
  projectId: string,
  range: DateRange,
  steps: FunnelStepDef[]
): Promise<FunnelResult> {
  const hits = await Promise.all(steps.map((s) => fetchStepHits(pool, projectId, range, s)));
  return computeSequentialFunnel(
    steps.map((s) => ({ label: s.label, type: s.type })),
    hits
  );
}

export type StoredFunnel = FunnelDef & { id: string; position: number; createdAt: string };

export async function listFunnels(pool: Pool, projectId: string): Promise<StoredFunnel[]> {
  const q = await pool.query(
    `SELECT id::text, name, feature, description, steps, position, created_at
     FROM project_funnels WHERE project_id = $1
     ORDER BY position ASC, created_at ASC`,
    [projectId]
  );
  return q.rows.map((r) => ({
    id: r.id,
    name: r.name,
    feature: r.feature,
    description: r.description,
    steps: r.steps as FunnelStepDef[],
    position: r.position,
    createdAt: r.created_at,
  }));
}

export async function evaluateProjectFunnels(pool: Pool, projectId: string, range: DateRange) {
  const funnels = await listFunnels(pool, projectId);
  return Promise.all(
    funnels.map(async (f) => ({ ...f, result: await evaluateFunnel(pool, projectId, range, f.steps) }))
  );
}
