/**
 * Stage-appropriate reliability targets per project. A pilot app is judged against
 * its pilot targets (with the long-term goal always shown next to them), and the
 * targets are raised as the app matures. Own services and third-party providers
 * have separate targets because only the former are under the team's control.
 */
import type { Pool } from "pg";
import { z } from "zod";

const fraction = z.number().min(0.5).max(1);

export const targetsSchema = z.object({
  phase: z.string().trim().min(1).max(30).default("Pilot"),
  overall: fraction.default(0.95),
  core: fraction.default(0.97),
  thirdParty: fraction.default(0.9),
  longTerm: fraction.default(0.995),
  /** Service slugs run by the team itself; every other service is a third-party provider. */
  coreServices: z.array(z.string().trim().toUpperCase().min(1).max(64)).max(20).default(["KORALINK"]),
});

export type ReliabilityTargets = z.infer<typeof targetsSchema>;

export const DEFAULT_TARGETS: ReliabilityTargets = targetsSchema.parse({});

/** How far below a target still counts as "near" (percentage points). */
export const NEAR_MARGIN = 0.02;

export type TargetVerdict = "on" | "near" | "below";

export function verdict(value: number, target: number): TargetVerdict {
  if (value >= target) return "on";
  if (value >= target - NEAR_MARGIN) return "near";
  return "below";
}

export function targetFor(t: ReliabilityTargets, service: string): number {
  return t.coreServices.includes(service.toUpperCase()) ? t.core : t.thirdParty;
}

export async function getReliabilityTargets(pool: Pool, projectId: string): Promise<ReliabilityTargets> {
  const q = await pool.query<{ t: unknown }>(`SELECT reliability_targets AS t FROM projects WHERE id = $1`, [projectId]);
  const parsed = targetsSchema.safeParse(q.rows[0]?.t ?? {});
  return parsed.success ? parsed.data : DEFAULT_TARGETS;
}

export async function setReliabilityTargets(pool: Pool, projectId: string, t: ReliabilityTargets): Promise<void> {
  await pool.query(`UPDATE projects SET reliability_targets = $2::jsonb WHERE id = $1`, [projectId, JSON.stringify(t)]);
}
