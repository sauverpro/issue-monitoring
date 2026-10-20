/**
 * Scheduled executive-report emails (workplan 9.2.1). Each project can have a
 * weekly, monthly and/or quarterly schedule; when due, the executive PDF for the
 * previous complete period is emailed to the recipients. Periods follow Kigali
 * time (UTC+2, no DST) and runs fire at 06:00 local on the first day of a period.
 */
import type { Pool } from "pg";
import { z } from "zod";
import { config } from "../config.js";
import type { DateRange } from "./monitorJourney.js";
import { exportExecutiveReportPdf } from "./monitorExecutiveReportPdf.js";
import { emailConfigured, sendEmail } from "./notifications/email.js";

export const REPORT_FREQUENCIES = ["weekly", "monthly", "quarterly"] as const;
export type ReportFrequency = (typeof REPORT_FREQUENCIES)[number];

const LOCAL_OFFSET_MS = 2 * 3600_000;
const RUN_HOUR_LOCAL = 6;

export const scheduleUpsertSchema = z.object({
  frequency: z.enum(REPORT_FREQUENCIES),
  recipients: z
    .array(z.string().trim().toLowerCase().email())
    .min(1)
    .max(20)
    .transform((list) => [...new Set(list)]),
  enabled: z.boolean().default(true),
});

/** Start (UTC instant) of the local period containing `now`. */
function periodStart(freq: ReportFrequency, now: Date): Date {
  const local = new Date(now.getTime() + LOCAL_OFFSET_MS);
  const y = local.getUTCFullYear();
  const m = local.getUTCMonth();
  let startLocal: number;
  if (freq === "weekly") {
    const dow = (local.getUTCDay() + 6) % 7; // Monday = 0
    startLocal = Date.UTC(y, m, local.getUTCDate() - dow);
  } else if (freq === "monthly") {
    startLocal = Date.UTC(y, m, 1);
  } else {
    startLocal = Date.UTC(y, Math.floor(m / 3) * 3, 1);
  }
  return new Date(startLocal - LOCAL_OFFSET_MS);
}

function shiftPeriod(freq: ReportFrequency, start: Date, n: number): Date {
  const local = new Date(start.getTime() + LOCAL_OFFSET_MS);
  const y = local.getUTCFullYear();
  const m = local.getUTCMonth();
  const d = local.getUTCDate();
  const shifted =
    freq === "weekly"
      ? Date.UTC(y, m, d + 7 * n)
      : Date.UTC(y, m + (freq === "monthly" ? n : 3 * n), 1);
  return new Date(shifted - LOCAL_OFFSET_MS);
}

/** The last complete period before `now` — what a run at `now` reports on. */
export function previousPeriod(freq: ReportFrequency, now: Date): DateRange {
  const current = periodStart(freq, now);
  const prev = shiftPeriod(freq, current, -1);
  return { from: prev, to: new Date(current.getTime() - 1) };
}

/** Next 06:00-local run strictly after `now`. */
export function nextRunAfter(freq: ReportFrequency, now: Date): Date {
  const runOffset = RUN_HOUR_LOCAL * 3600_000;
  const current = periodStart(freq, now);
  const candidate = new Date(current.getTime() + runOffset);
  if (candidate.getTime() > now.getTime()) return candidate;
  return new Date(shiftPeriod(freq, current, 1).getTime() + runOffset);
}

export function periodLabel(freq: ReportFrequency, range: DateRange): string {
  const local = new Date(range.from.getTime() + LOCAL_OFFSET_MS);
  const y = local.getUTCFullYear();
  if (freq === "quarterly") return `Q${Math.floor(local.getUTCMonth() / 3) + 1} ${y}`;
  if (freq === "monthly") {
    return local.toLocaleString("en-GB", { month: "long", year: "numeric", timeZone: "UTC" });
  }
  const end = new Date(range.to.getTime() + LOCAL_OFFSET_MS);
  const fmt = (d: Date) => d.toLocaleString("en-GB", { day: "numeric", month: "short", timeZone: "UTC" });
  return `week of ${fmt(local)} – ${fmt(end)} ${end.getUTCFullYear()}`;
}

export type ScheduleRow = {
  id: string;
  frequency: ReportFrequency;
  recipients: string[];
  enabled: boolean;
  nextRunAt: string;
  lastRunAt: string | null;
  lastStatus: string | null;
  lastError: string | null;
};

function mapSchedule(r: Record<string, unknown>): ScheduleRow {
  return {
    id: r.id as string,
    frequency: r.frequency as ReportFrequency,
    recipients: r.recipients as string[],
    enabled: r.enabled as boolean,
    nextRunAt: (r.next_run_at as Date).toISOString(),
    lastRunAt: r.last_run_at ? (r.last_run_at as Date).toISOString() : null,
    lastStatus: (r.last_status as string) ?? null,
    lastError: (r.last_error as string) ?? null,
  };
}

export async function listSchedules(pool: Pool, projectId: string): Promise<ScheduleRow[]> {
  const q = await pool.query(
    `SELECT id::text, frequency, recipients, enabled, next_run_at, last_run_at, last_status, last_error
     FROM report_schedules WHERE project_id = $1
     ORDER BY array_position(ARRAY['weekly','monthly','quarterly'], frequency)`,
    [projectId]
  );
  return q.rows.map(mapSchedule);
}

export async function upsertSchedule(
  pool: Pool,
  projectId: string,
  input: z.infer<typeof scheduleUpsertSchema>,
  userId: string | null
): Promise<ScheduleRow> {
  const q = await pool.query(
    `INSERT INTO report_schedules (project_id, frequency, recipients, enabled, next_run_at, created_by)
     VALUES ($1, $2, $3, $4, $5, $6)
     ON CONFLICT (project_id, frequency) DO UPDATE SET
       recipients = EXCLUDED.recipients,
       enabled = EXCLUDED.enabled
     RETURNING id::text, frequency, recipients, enabled, next_run_at, last_run_at, last_status, last_error`,
    [projectId, input.frequency, input.recipients, input.enabled, nextRunAfter(input.frequency, new Date()), userId]
  );
  return mapSchedule(q.rows[0]!);
}

export async function deleteSchedule(pool: Pool, projectId: string, id: string): Promise<void> {
  await pool.query(`DELETE FROM report_schedules WHERE id = $1 AND project_id = $2`, [id, projectId]);
}

/** Builds and emails one report. Returns the status recorded on the schedule. */
export async function deliverScheduledReport(
  pool: Pool,
  schedule: { projectId: string; projectName: string; frequency: ReportFrequency; recipients: string[] },
  now = new Date()
): Promise<{ status: "sent" | "skipped"; detail: string }> {
  if (!emailConfigured()) {
    return { status: "skipped", detail: "SMTP is not configured (set SMTP_HOST)" };
  }
  const range = previousPeriod(schedule.frequency, now);
  const label = periodLabel(schedule.frequency, range);
  const { buffer } = await exportExecutiveReportPdf(pool, schedule.projectId, schedule.projectName, range);
  const filename = `${schedule.projectName}-${schedule.frequency}-report-${label}`
    .replace(/[^a-zA-Z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .concat(".pdf");
  const link = config.dashboardUrl ? `\n\nOpen the dashboard: ${config.dashboardUrl}` : "";
  const kind = schedule.frequency[0]!.toUpperCase() + schedule.frequency.slice(1);
  await sendEmail({
    to: schedule.recipients,
    subject: `${schedule.projectName} — ${kind} technical report (${label})`,
    text:
      `Attached is the ${schedule.frequency} technical report for ${schedule.projectName} covering ${label}.\n\n` +
      `It covers system health and incidents, user engagement and feature adoption, API performance, ` +
      `user feedback received and the releases shipped in the period.${link}`,
    attachments: [{ filename, content: buffer, contentType: "application/pdf" }],
  });
  return { status: "sent", detail: `Sent to ${schedule.recipients.length} recipient(s) for ${label}` };
}

/**
 * Claims each due schedule by advancing next_run_at first (so overlapping ticks
 * or processes never double-send), then delivers and records the outcome.
 */
export async function runDueSchedules(pool: Pool, now = new Date()): Promise<number> {
  const due = await pool.query<{
    id: string;
    project_id: string;
    project_name: string;
    frequency: ReportFrequency;
    recipients: string[];
    next_run_at: Date;
  }>(
    `SELECT s.id::text, s.project_id::text, p.name AS project_name, s.frequency, s.recipients, s.next_run_at
     FROM report_schedules s
     JOIN projects p ON p.id = s.project_id
     JOIN organizations o ON o.id = p.organization_id AND o.suspended_at IS NULL
     WHERE s.enabled AND s.next_run_at <= $1`,
    [now]
  );
  let sent = 0;
  for (const s of due.rows) {
    // "Still due" rather than equality: pg keeps microseconds that a JS Date drops.
    const claimed = await pool.query(
      `UPDATE report_schedules SET next_run_at = $3 WHERE id = $1 AND enabled AND next_run_at <= $2`,
      [s.id, now, nextRunAfter(s.frequency, now)]
    );
    if (!claimed.rowCount) continue;
    let status = "failed";
    let error: string | null = null;
    try {
      const out = await deliverScheduledReport(
        pool,
        { projectId: s.project_id, projectName: s.project_name, frequency: s.frequency, recipients: s.recipients },
        now
      );
      status = out.status;
      error = out.status === "sent" ? null : out.detail;
      if (out.status === "sent") sent += 1;
    } catch (err) {
      error = err instanceof Error ? err.message : String(err);
      console.error("[report-schedules] delivery failed", s.id, error);
    }
    await pool.query(
      `UPDATE report_schedules SET last_run_at = $2, last_status = $3, last_error = $4 WHERE id = $1`,
      [s.id, now, status, error]
    );
  }
  return sent;
}

export function startReportScheduler(pool: Pool): NodeJS.Timeout {
  const tick = () => {
    runDueSchedules(pool).catch((err) => console.error("[report-schedules] tick failed", err));
  };
  if (!emailConfigured()) {
    console.log("[report-schedules] SMTP_HOST unset — due schedules will be recorded as skipped");
  }
  setTimeout(tick, 30_000);
  return setInterval(tick, config.reportSchedulerIntervalMs);
}
