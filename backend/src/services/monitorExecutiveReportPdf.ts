import type { Pool } from "pg";
import type { DateRange } from "./monitorJourney.js";
import {
  getFunnelReport,
  getProjectDashboard,
  getProjectPerformance,
  getProjectProblems,
  getReportBehavior,
} from "./monitorInsights.js";
import { getReportOverview, getReportRetention } from "./monitorReports.js";
import {
  deltaText,
  fmt,
  fmtDate,
  formatDuration,
  healthTileStatus,
  reportTypeLabel,
  resolveHealth,
  shortDay,
  type Behavior,
  type Dashboard,
  type Funnels,
  type Overview,
  type Performance,
  type Problems,
  type ResolvedHealth,
  type Retention,
} from "./monitorReportPdf.js";
import { A4_PORTRAIT, SimplePdf, hexColor, type PdfColor } from "./simplePdf.js";
import { FlowDoc } from "./flowPdf.js";

const MARGIN = 40;
const CONTENT_TOP = 76;
const CONTENT_BOTTOM = 792;

const WHITE = hexColor("#ffffff");
const COVER_BG = hexColor("#0f172a");

const THEME = {
  ink: hexColor("#1e293b"),
  muted: hexColor("#64748b"),
  line: hexColor("#e2e8f0"),
  accent: hexColor("#2563eb"),
  tableHeaderBg: hexColor("#1e293b"),
  tableHeaderText: WHITE,
  stripe: hexColor("#f8fafc"),
};

const PRESET = {
  critical: { color: hexColor("#dc2626"), bg: hexColor("#fee2e2") },
  warning: { color: hexColor("#d97706"), bg: hexColor("#fef3c7") },
  healthy: { color: hexColor("#16a34a"), bg: hexColor("#dcfce7") },
  neutral: { color: hexColor("#475569"), bg: hexColor("#f1f5f9") },
};

type Assessment = { label: string; color: PdfColor; bg: PdfColor };

function assessmentPreset(kind: keyof typeof PRESET, label: string): Assessment {
  return { label, ...PRESET[kind] };
}

function badMetricAssessment(bad: boolean, watch: boolean): Assessment {
  if (bad) return assessmentPreset("critical", "Critical");
  if (watch) return assessmentPreset("warning", "Watch");
  return assessmentPreset("healthy", "Healthy");
}

function growthAssessment(delta: number | null): Assessment {
  if (delta == null) return assessmentPreset("neutral", "Flat");
  if (delta > 5) return assessmentPreset("healthy", "Growth");
  if (delta < -5) return assessmentPreset("critical", "Decline");
  return assessmentPreset("neutral", "Flat");
}

function latencyAssessment(avgMs: number): Assessment {
  const s = healthTileStatus("latency", avgMs);
  if (s.label === "Healthy") return assessmentPreset("healthy", "Healthy");
  if (s.label === "Watch") return assessmentPreset("warning", "Slow");
  return assessmentPreset("critical", "Slow");
}

function impactAssessment(delta: number | null, value: number): Assessment {
  if (value === 0) return assessmentPreset("healthy", "None");
  if ((delta ?? 0) > 20) return assessmentPreset("warning", "High impact");
  if ((delta ?? 0) > 0) return assessmentPreset("warning", "Rising");
  return assessmentPreset("healthy", "Improving");
}

function severityAssessment(sev: string): Assessment {
  if (sev === "critical") return assessmentPreset("critical", "Critical");
  if (sev === "high") return assessmentPreset("warning", "High");
  if (sev === "medium") return assessmentPreset("warning", "Medium");
  return assessmentPreset("neutral", "Low");
}

function deltaArrow(value: number | null): string {
  if (value == null) return "-";
  const arrow = value > 0 ? "↑" : value < 0 ? "↓" : "→";
  return `${arrow} ${Math.abs(value).toFixed(1)}%`;
}

/** Builds fixed-fraction column widths that always sum exactly to `cw` (last column takes the remainder). */
function makeCols(cw: number, specs: { label: string; frac?: number; align?: "left" | "right" }[]) {
  let used = 0;
  return specs.map((s, i) => {
    const isLast = i === specs.length - 1;
    const width = isLast ? cw - used : Math.round(cw * (s.frac ?? 0));
    if (!isLast) used += width;
    return { label: s.label, width, align: s.align };
  });
}

function shortEndpointLabel(path: string): string {
  const parts = path.split("/").filter(Boolean);
  const meaningful = parts.filter((p) => !["api", "v1", "mine", "all"].includes(p.toLowerCase()));
  const label = (meaningful.length ? meaningful.slice(-2) : parts).join(" ").replace(/-/g, " ");
  return label || path;
}

function categoriesFromPaths(paths: string[]): string[] {
  const SKIP = new Set(["api", "v1", "intelligrapi", "mine", "all", "info"]);
  const found: string[] = [];
  for (const p of paths) {
    const parts = p.split("/").filter(Boolean);
    const meaningful = parts.filter((s) => !SKIP.has(s.toLowerCase()) && !/^\d+$/.test(s));
    for (const seg of meaningful.slice(0, 2)) {
      const clean = seg.replace(/-/g, " ");
      if (!found.includes(clean)) found.push(clean);
    }
  }
  return found.slice(0, 8);
}

type OverallStatus = { label: string; detail: string; color: PdfColor };

function computeOverallStatus(health: ResolvedHealth, usersDelta: number | null): OverallStatus {
  const growth = (usersDelta ?? 0) >= 20;
  const bad = health.availability < 0.97 || health.errorRate > 0.05;
  const watch = !bad && (health.availability < 0.995 || health.errorRate > 0.01 || health.avgLatencyMs > 800);
  if (bad) {
    return growth
      ? { label: "CRITICAL", detail: "Reliability Gap Under Growth", color: PRESET.critical.color }
      : { label: "CRITICAL", detail: "Reliability Issue", color: PRESET.critical.color };
  }
  if (watch) {
    return growth
      ? { label: "WARNING", detail: "Reliability Strain Under Growth", color: PRESET.warning.color }
      : { label: "WARNING", detail: "Elevated Error/Latency", color: PRESET.warning.color };
  }
  return growth
    ? { label: "HEALTHY", detail: "Strong Growth", color: PRESET.healthy.color }
    : { label: "STABLE", detail: "Steady State", color: PRESET.healthy.color };
}

// ---------------------------------------------------------------------------
// Narrative text builders — every number below comes from the fetched data.
// ---------------------------------------------------------------------------

function paraActivity(data: Overview, health: ResolvedHealth): string {
  const trend = (v: number | null) =>
    v == null ? "was stable" : v >= 0 ? `increased ${v.toFixed(1)}%` : `decreased ${Math.abs(v).toFixed(1)}%`;
  const qualityClause =
    health.availability < 0.97 || health.errorRate > 0.05
      ? "This indicates substantially higher engagement and workload, but the underlying service quality deteriorated."
      : "This indicates growing engagement while service quality has been maintained.";
  return (
    `The monitoring period recorded ${fmt(data.kpis.users.value)} active users, ${fmt(data.kpis.sessions.value)} sessions, and ${fmt(data.kpis.actions.value)} actions. ` +
    `Compared with the prior equal-length window, active users ${trend(data.kpis.users.delta)}, sessions ${trend(data.kpis.sessions.delta)}, and actions ${trend(data.kpis.actions.delta)}. ` +
    qualityClause
  );
}

function paraReliability(health: ResolvedHealth): string {
  const gapClause =
    health.availability < 0.97 || health.errorRate > 0.05
      ? "The monitoring data therefore points to a material gap between demand growth and system capacity/reliability."
      : "The monitoring data indicates the platform is keeping pace with current demand.";
  return (
    `Overall availability was ${(health.availability * 100).toFixed(2)}%, ${deltaText(health.availabilityDelta)}, while the overall error rate reached ${(health.errorRate * 100).toFixed(2)}%, ${deltaText(health.errorRateDelta)}. ` +
    `Average API latency was ${fmt(health.avgLatencyMs)} ms, ${deltaText(health.latencyDelta)}. ${gapClause}`
  );
}

function paraTopIncident(problems: Problems, performance: Performance): string {
  const parts: string[] = [];
  const top = problems.errors[0];
  const hotspot = performance.endpoints[0];
  if (top) {
    parts.push(
      `The most significant identified incident is ${top.method} ${top.path}, with ${fmt(top.occurrences)} occurrences affecting ${fmt(top.usersAffected)} users across ${fmt(top.sessionsAffected)} sessions.`
    );
  }
  if (hotspot && hotspot.path !== top?.path) {
    parts.push(
      `A separate performance hotspot, ${hotspot.method} ${hotspot.path}, averaged ${fmt(hotspot.avgLatencyMs)} ms and recorded a P99 of ${fmt(hotspot.p99Ms)} ms.`
    );
  }
  if (performance.endpoints.length > 1) {
    parts.push("Several other APIs also exhibited multi-second to tens-of-seconds response times.");
  }
  return parts.join(" ") || "No significant incidents or performance hotspots were identified in this range.";
}

function managementTitle(status: OverallStatus): string {
  if (status.label === "CRITICAL") return "Priority: Stabilization over expansion";
  if (status.label === "WARNING") return "Priority: Monitor closely and address emerging risk";
  return "Priority: Sustain momentum";
}

function managementBody(status: OverallStatus, categories: string[]): string {
  const cats = categories.length ? categories.join(", ") : "the reported endpoints";
  if (status.label === "CRITICAL" || status.label === "WARNING") {
    return (
      `The immediate priority is not additional feature expansion; it is stabilization of the API layer. The telemetry suggests that increased traffic and activity are exposing existing backend weaknesses, particularly around ${cats}. ` +
      "The system should move into a focused reliability sprint before the next reporting cycle."
    );
  }
  return `Reliability and performance are within an acceptable range alongside continued growth. Continue monitoring ${cats} and maintain current alerting thresholds ahead of the next reporting cycle.`;
}

function paraBehaviorActivity(data: Overview): string {
  const u = data.kpis.users.value;
  const s = data.kpis.sessions.value;
  const a = data.kpis.actions.value;
  const avgSessionsPerUser = u ? (s / u).toFixed(2) : "0";
  const avgActionsPerSession = s ? (a / s).toFixed(2) : "0";
  return (
    `User activity ${(data.kpis.users.delta ?? 0) >= 0 ? "increased" : "decreased"} during the reporting window. The application recorded ${fmt(u)} active users over ${fmt(s)} sessions, with an average of ${avgSessionsPerUser} sessions per user and ${avgActionsPerSession} actions per session. ` +
    `Average session duration was ${formatDuration(data.kpis.avgDurationMs.value)}, ${deltaText(data.kpis.avgDurationMs.delta)}. Total actions reached ${fmt(a)}, ${deltaText(data.kpis.actions.delta)}.`
  );
}

function paraBehaviorCaveat(health: ResolvedHealth): string | null {
  if (health.errorRate <= 0.05) return null;
  return (
    `However, engagement growth must be interpreted together with system health. The same period produced a ${(health.errorRate * 100).toFixed(2)}% error rate. ` +
    "Therefore, a portion of the observed activity may represent retries, failed requests, navigation loops, or users attempting to complete operations through unstable APIs."
  );
}

function behaviorFindings(
  screens: { screen: string; views: number; users: number }[],
  journeys: { path: string[]; count: number; pct: number }[],
  funnels: Funnels,
  retention: Retention
): string[] {
  const out: string[] = [];
  const top = screens[0];
  if (top) {
    const isUnknown = !top.screen || /unknown/i.test(top.screen);
    out.push(
      isUnknown
        ? `${top.screen || "(unknown)"} is the dominant observed entry point, with ${fmt(top.views)} views. This is a telemetry-quality concern because it limits the ability to identify exactly where users are landing and how their journeys progress.`
        : `${top.screen} is the dominant observed entry point, with ${fmt(top.views)} views this period.`
    );
  }
  if (screens.length > 2) {
    out.push(`${screens[1]!.screen} and ${screens[2]!.screen} are also prominent, suggesting these are important operational workflows.`);
  }
  const topJourney = journeys[0];
  if (topJourney) {
    out.push(
      `The leading journey is ${topJourney.path.join(" -> ")}, representing ${(topJourney.pct * 100).toFixed(1)}% of sampled sessions.`
    );
  }
  if (funnels.dropoff) {
    out.push(
      `A notable drop-off was observed between ${funnels.dropoff.from} and ${funnels.dropoff.to} (${(funnels.dropoff.rate * 100).toFixed(0)}% of users do not continue).`
    );
  } else {
    out.push("No significant funnel drop-off was detected in the reported range.");
  }
  const avgD1 = retention.days.length ? retention.days.reduce((s, d) => s + d.rate1d, 0) / retention.days.length : 0;
  out.push(
    avgD1 < 0.3
      ? "Retention remains weak in the available cohort data."
      : "Retention is holding at a reasonable level across the available cohort data."
  );
  return out;
}

function paraSystemHealth(health: ResolvedHealth, daily: Overview["daily"]): string {
  const top2 = [...daily].sort((a, b) => b.sessions - a.sessions).slice(0, 2);
  const dayClauses = top2.map(
    (d) =>
      `On ${shortDay(d.date)}, ${fmt(d.users)} users generated ${fmt(d.sessions)} sessions and ${fmt(d.actions)} actions, with ${fmt(d.apiRequests)} API requests and ${fmt(d.errors)} errors.`
  );
  const lead =
    health.availability < 0.97 || health.errorRate > 0.05
      ? "The system-health picture is critical."
      : health.availability < 0.995 || health.errorRate > 0.01
        ? "The system-health picture shows some strain."
        : "The system-health picture is healthy.";
  return `${lead} Availability was ${(health.availability * 100).toFixed(2)}%, while the error rate was ${(health.errorRate * 100).toFixed(2)}%. ${dayClauses.join(" ")}`;
}

function paraPerformance(performance: Performance): string {
  const severe = performance.kpis.p99Ms > 5000;
  return (
    `Average API latency reached ${fmt(performance.kpis.avgLatencyMs)} ms, ${deltaText(performance.kpis.avgDelta)}. P95 latency was ${fmt(performance.kpis.p95Ms)} ms, ${deltaText(performance.kpis.p95Delta)}, while P99 latency was ${fmt(performance.kpis.p99Ms)} ms. ` +
    `The monitoring report identifies ${fmt(performance.kpis.slowApis)} slow APIs averaging above 500 ms. These figures indicate ${severe ? "both broad degradation and severe tail-latency behavior" : "generally acceptable performance with isolated hotspots"}.`
  );
}

const TECH_HYPOTHESES =
  "The report alone does not identify the root cause, so root-cause statements should remain hypotheses until trace-level investigation is performed. Nevertheless, the pattern is consistent with one or more of the following areas requiring verification: slow upstream dependencies, database/query bottlenecks, missing caching, connection-pool saturation, repeated downstream calls, synchronous processing on request paths, or inadequate timeout/retry behavior.";

function paraTailLatencyCaveat(endpoints: Performance["endpoints"]): string | null {
  const worst = endpoints.find((e) => e.maxLatencyMs > 60000 && e.maxLatencyMs > Math.max(e.p99Ms, 1) * 10);
  if (!worst) return null;
  return (
    `The extremely high maximum latencies observed on some endpoints (up to ${fmt(worst.maxLatencyMs)} ms) also warrant validation of telemetry semantics and timeout handling. ` +
    "These values may represent requests that remained open for unusually long periods or instrumentation around failed/aborted requests. This should be confirmed from distributed traces and server logs rather than assumed to be normal application processing time."
  );
}

function buildOptimizationSequence(
  problems: Problems,
  performance: Performance
): { priority: string; target: string; reason: string }[] {
  const rows: { priority: string; target: string; reason: string }[] = [];
  const topIssue = problems.errors[0];
  const topHotspot = performance.endpoints[0];
  if (topIssue) {
    rows.push({
      priority: "P0",
      target: shortEndpointLabel(topIssue.path),
      reason: `Highest reported failure concentration: ${fmt(topIssue.occurrences)} occurrences / ${fmt(topIssue.usersAffected)} users`,
    });
  }
  if (topHotspot && topHotspot.path !== topIssue?.path) {
    rows.push({
      priority: "P0",
      target: shortEndpointLabel(topHotspot.path),
      reason: `Highest average latency: ${(topHotspot.avgLatencyMs / 1000).toFixed(1)}s; P99 ${(topHotspot.p99Ms / 1000).toFixed(1)}s`,
    });
  }
  for (const e of performance.endpoints.slice(1, 3)) {
    rows.push({
      priority: "P1",
      target: shortEndpointLabel(e.path),
      reason: `${fmt(e.total)} requests with ${(e.avgLatencyMs / 1000).toFixed(1)}s average latency`,
    });
  }
  const nextIssue = problems.errors[1];
  if (nextIssue) {
    rows.push({
      priority: "P1",
      target: shortEndpointLabel(nextIssue.path),
      reason: `${fmt(nextIssue.occurrences)} reported issue occurrences affecting ${fmt(nextIssue.usersAffected)} users`,
    });
  }
  rows.push({
    priority: "P2",
    target: "Telemetry normalization",
    reason: "Reduce unknown/unnamed screens and improve journey attribution",
  });
  return rows.slice(0, 6);
}

function immediateActions(
  topIssue: Problems["errors"][number] | undefined,
  topHotspot: Performance["endpoints"][number] | undefined
): { action: string; outcome: string }[] {
  return [
    {
      action: topIssue ? `Investigate ${topIssue.method} ${topIssue.path} end-to-end` : "Investigate the highest-volume failing endpoint end-to-end",
      outcome: topIssue ? `Identify and eliminate the highest-volume failure affecting ${fmt(topIssue.usersAffected)} users.` : "Identify and eliminate the highest-volume failure.",
    },
    {
      action: topHotspot ? `Trace ${topHotspot.method} ${topHotspot.path}` : "Trace the slowest endpoint",
      outcome: topHotspot ? `Find the source of ${(topHotspot.avgLatencyMs / 1000).toFixed(1)}s average and extreme tail latency.` : "Find the source of elevated latency.",
    },
    { action: "Review API timeouts, retries and upstream dependency behavior", outcome: "Prevent requests from remaining open for extreme durations." },
    { action: "Inspect database queries used by the top slow/error endpoints", outcome: "Identify missing indexes, N+1 patterns, expensive joins and slow queries." },
    { action: "Check connection pools and resource saturation", outcome: "Determine whether concurrency/load is exhausting DB or HTTP connections." },
    { action: "Add/verify alerts for error rate, availability and P95/P99", outcome: "Detect degradation before it becomes widespread." },
  ];
}

const SHORT_TERM = [
  "Optimize the top five slow endpoints using traces and query profiling.",
  "Introduce caching where read-heavy data can safely be cached.",
  "Reduce repeated downstream requests and consolidate API calls where possible.",
  "Establish standardized timeout and retry policies with exponential backoff and bounded retry counts.",
  "Add structured error codes and correlation IDs so a single user action can be traced across frontend, backend, database, and external services.",
  "Instrument successful business outcomes — not only page views and HTTP errors — for the application's key workflows.",
];

const MEDIUM_TERM = [
  "Define endpoint-level SLOs and error budgets for critical operations.",
  "Run controlled load tests based on the observed increase in users, sessions, actions and API requests.",
  "Introduce dashboards separating frontend errors, backend 4xx/5xx errors, network errors, dependency failures and timeouts.",
  "Improve screen naming and route attribution to eliminate large 'unknown' categories.",
  "Create an incident review workflow linking each high-severity problem to an owner, root cause, corrective action and verification metric.",
];

function successDirection(bad: boolean, watch: boolean, improvingCopy: string, maintainCopy = "Maintain current level"): string {
  if (bad) return `Materially improve; move out of Critical`;
  if (watch) return improvingCopy;
  return maintainCopy;
}

function paraFinalAssessment(status: OverallStatus, problems: Problems): string {
  const top = problems.errors[0];
  const growthClause =
    status.label === "CRITICAL" || status.label === "WARNING"
      ? "is demonstrating growth in usage but insufficient reliability under that workload"
      : "is demonstrating healthy growth alongside acceptable reliability";
  const riskClause =
    status.label === "CRITICAL" || status.label === "WARNING"
      ? "The most important business risk is that users are increasingly active while a meaningful percentage of requests fail or respond slowly."
      : "Continued monitoring will help confirm this trend holds as usage keeps growing.";
  const focusClause = top
    ? ` The monitoring report provides enough evidence to prioritize a reliability effort: start with ${top.method} ${top.path}, then systematically address the broader set of slow or failing endpoints.`
    : "";
  return `The application ${growthClause}. ${riskClause}${focusClause} At the same time, telemetry quality should be improved so user journeys can be analyzed with named screens and business outcomes.`;
}

// ---------------------------------------------------------------------------
// Cover page + running chrome
// ---------------------------------------------------------------------------

function drawCover(pdf: SimplePdf, projectName: string, range: { from: string; to: string }, status: OverallStatus): void {
  const w = pdf.w;
  const h = pdf.h;
  pdf.fill(COVER_BG);
  pdf.rect(0, 0, w, h, "f");
  const cx = w / 2;
  let y = 90;
  pdf.text("MONITOR", cx, y, { size: 15, bold: true, color: WHITE, align: "center" });
  y += 16;
  pdf.text("A P P L I C A T I O N   O B S E R V A B I L I T Y", cx, y, { size: 7.5, bold: true, color: hexColor("#93c5fd"), align: "center" });
  y += 90;
  pdf.text("Executive & Operational", cx, y, { size: 24, bold: true, color: WHITE, align: "center" });
  y += 30;
  pdf.text("Monitoring Report", cx, y, { size: 24, bold: true, color: WHITE, align: "center" });
  y += 44;
  pdf.text(projectName.toUpperCase(), cx, y, { size: 11, bold: true, color: hexColor("#60a5fa"), align: "center" });
  y += 18;
  pdf.text(`Reporting Period: ${fmtDate(range.from)} - ${fmtDate(range.to)}`, cx, y, { size: 10, color: hexColor("#cbd5e1"), align: "center" });
  y += 56;
  pdf.stroke(hexColor("#3b82f6"));
  pdf.lineWidth(1.2);
  pdf.line(cx - 100, y, cx + 100, y);
  y += 64;
  pdf.text("OVERALL STATUS", cx, y, { size: 8, bold: true, color: hexColor("#94a3b8"), align: "center" });
  y += 16;
  pdf.text(`${status.label} - ${status.detail}`, cx, y, { size: 13, bold: true, color: status.color, align: "center", maxWidth: w - 120 });

  const fy = h - 60;
  pdf.text("Prepared By Koralink Monitor.", cx, fy, { size: 8.5, color: hexColor("#94a3b8"), align: "center" });
  pdf.text(`Generated ${fmtDate(new Date().toISOString())} · Confidential`, cx, fy + 14, { size: 8, color: hexColor("#94a3b8"), align: "center" });
}

function paintPortraitPage(pdf: SimplePdf): void {
  pdf.fill(WHITE);
  pdf.rect(0, 0, pdf.w, pdf.h, "f");
  pdf.text("MONITOR", MARGIN, 22, { size: 8, bold: true, color: THEME.muted });
  pdf.text("Executive & Operational Monitoring Report", pdf.w - MARGIN, 22, { size: 8, color: THEME.muted, align: "right" });
  pdf.stroke(THEME.line);
  pdf.lineWidth(0.6);
  pdf.line(MARGIN, 38, pdf.w - MARGIN, 38);
}

function paintFooter(pdf: SimplePdf, pageIndex: number, pageCount: number): void {
  if (pageIndex === 0) return;
  pdf.stroke(THEME.line);
  pdf.lineWidth(0.5);
  pdf.line(MARGIN, pdf.h - 34, pdf.w - MARGIN, pdf.h - 34);
  pdf.text(`MONITOR · Confidential · Page ${pageIndex + 1} of ${pageCount}`, pdf.w / 2, pdf.h - 24, {
    size: 7.5,
    color: THEME.muted,
    align: "center",
  });
}

// ---------------------------------------------------------------------------
// Entry points
// ---------------------------------------------------------------------------

export async function exportExecutiveReportPdf(
  pool: Pool,
  projectId: string,
  projectName: string,
  range: DateRange
): Promise<{ filename: string; buffer: Buffer }> {
  const [overview, funnels, retention, dashboard, problems, performance, behavior] = await Promise.all([
    getReportOverview(pool, projectId, range),
    getFunnelReport(pool, projectId, range),
    getReportRetention(pool, projectId, range),
    getProjectDashboard(pool, projectId, range),
    getProjectProblems(pool, projectId, range),
    getProjectPerformance(pool, projectId, range),
    getReportBehavior(pool, projectId, range),
  ]);
  const buffer = renderExecutiveReportPdf({ projectName, overview, funnels, retention, dashboard, problems, performance, behavior });
  const stamp = range.from.toISOString().slice(0, 10);
  const slug = projectName.replace(/[^a-zA-Z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 40) || "project";
  return { filename: `monitor-executive-report-${slug}-${stamp}.pdf`, buffer };
}

export function renderExecutiveReportPdf(input: {
  projectName: string;
  overview: Overview;
  funnels: Funnels;
  retention: Retention;
  dashboard: Dashboard;
  problems: Problems;
  performance: Performance;
  behavior: Behavior;
}): Buffer {
  const { projectName, overview, funnels, retention, dashboard, problems, performance, behavior } = input;
  const health = resolveHealth(overview, dashboard);
  const status = computeOverallStatus(health, overview.kpis.users.delta);

  const pdf = new SimplePdf(A4_PORTRAIT);
  drawCover(pdf, projectName, overview.range, status);

  const doc = new FlowDoc(pdf, {
    marginX: MARGIN,
    contentTop: CONTENT_TOP,
    contentBottom: CONTENT_BOTTOM,
    theme: THEME,
    onNewPage: (p) => paintPortraitPage(p),
  });
  const cw = doc.contentWidth;

  // -- 1. Executive Summary ---------------------------------------------
  doc.heading("1", "Executive Summary");
  doc.para(paraActivity(overview, health));
  doc.para(paraReliability(health));
  doc.para(paraTopIncident(problems, performance));
  doc.spacer(6);

  const kpiRows: { cols: string[]; assessment: Assessment }[] = [
    { cols: ["Availability", `${(health.availability * 100).toFixed(2)}%`, deltaArrow(health.availabilityDelta)], assessment: badMetricAssessment(health.availability < 0.97, health.availability < 0.995) },
    { cols: ["Error rate", `${(health.errorRate * 100).toFixed(2)}%`, deltaArrow(health.errorRateDelta)], assessment: badMetricAssessment(health.errorRate > 0.05, health.errorRate > 0.01) },
    { cols: ["Avg API latency", `${fmt(health.avgLatencyMs)} ms`, deltaArrow(health.latencyDelta)], assessment: latencyAssessment(health.avgLatencyMs) },
    { cols: ["Active users", fmt(overview.kpis.users.value), deltaArrow(overview.kpis.users.delta)], assessment: growthAssessment(overview.kpis.users.delta) },
    { cols: ["Sessions", fmt(overview.kpis.sessions.value), deltaArrow(overview.kpis.sessions.delta)], assessment: growthAssessment(overview.kpis.sessions.delta) },
    { cols: ["Actions", fmt(overview.kpis.actions.value), deltaArrow(overview.kpis.actions.delta)], assessment: growthAssessment(overview.kpis.actions.delta) },
    { cols: ["Errors", fmt(overview.kpis.errors.value), deltaArrow(overview.kpis.errors.delta)], assessment: badMetricAssessment((overview.kpis.errors.delta ?? 0) > 0 && health.errorRate > 0.05, (overview.kpis.errors.delta ?? 0) > 0) },
    { cols: ["Users affected", fmt(problems.summary.usersAffected), deltaArrow(problems.summary.usersAffectedDelta)], assessment: impactAssessment(problems.summary.usersAffectedDelta, problems.summary.usersAffected) },
  ];
  doc.table(
    makeCols(cw, [{ label: "KPI", frac: 0.28 }, { label: "Current", frac: 0.18, align: "right" }, { label: "Change vs prior window", frac: 0.28, align: "right" }, { label: "Assessment", align: "right" }]),
    kpiRows.map((r) => [...r.cols, r.assessment.label]),
    {
      cellColor: (_row, ci, ri) => (ci === 3 ? kpiRows[ri]!.assessment.bg : undefined),
      textColor: (_row, ci, ri) => (ci === 3 ? kpiRows[ri]!.assessment.color : undefined),
      boldCell: (_row, ci) => ci === 3,
    }
  );

  doc.subheading("Management Interpretation");
  const categories = categoriesFromPaths(problems.errors.slice(0, 6).map((e) => e.path));
  doc.callout(managementTitle(status), managementBody(status, categories), { bg: PRESET.neutral.bg, accent: PRESET.neutral.color });

  // -- 2. User Behavior & Engagement --------------------------------------
  doc.heading("2", "User Behavior & Engagement");
  doc.para(paraBehaviorActivity(overview));
  const caveat = paraBehaviorCaveat(health);
  if (caveat) doc.para(caveat);

  const screens = behavior.screens.length ? behavior.screens : overview.topScreens.map((s) => ({ screen: s.screen, views: s.count, users: 0 }));
  doc.subheading("Most Visited Screens");
  doc.table(
    makeCols(cw, [{ label: "Screen / route", frac: 0.65 }, { label: "Views / events", align: "right" }]),
    screens.slice(0, 8).map((s) => [s.screen || "(unknown)", fmt(s.views)])
  );

  doc.subheading("Common Journeys");
  doc.table(
    makeCols(cw, [{ label: "Journey", frac: 0.62 }, { label: "Share", frac: 0.19, align: "right" }, { label: "Sessions", align: "right" }]),
    behavior.journeys.slice(0, 6).map((j) => [j.path.join(" -> "), `${(j.pct * 100).toFixed(1)}%`, fmt(j.count)])
  );
  if (behavior.journeys.length === 0) {
    doc.para("No repeated multi-screen journeys were observed in this range.", { color: THEME.muted, size: 8.5 });
  }

  doc.subheading("Behavior Findings");
  doc.bulletList(behaviorFindings(screens, behavior.journeys, funnels, retention));

  doc.subheading("Retention");
  doc.table(
    makeCols(cw, [
      { label: "Cohort date", frac: 0.18 },
      { label: "Users", frac: 0.13, align: "right" },
      { label: "D1 returned", frac: 0.17, align: "right" },
      { label: "D1 rate", frac: 0.14, align: "right" },
      { label: "D7 returned", frac: 0.17, align: "right" },
      { label: "D7 rate", align: "right" },
    ]),
    [...retention.days]
      .reverse()
      .slice(0, 8)
      .map((d) => [d.date, fmt(d.users), fmt(d.returned1d), `${(d.rate1d * 100).toFixed(0)}%`, fmt(d.returned7d), `${(d.rate7d * 100).toFixed(0)}%`])
  );

  doc.callout(
    "Recommended behavior-monitoring improvement",
    "Instrument named route/screen IDs consistently, add business-event tracking for key actions, and distinguish successful completion from failed/retried interactions.",
    { bg: hexColor("#eff6ff"), accent: THEME.accent }
  );

  // -- 3. System Health & Incident Analysis -------------------------------
  doc.heading("3", "System Health & Incident Analysis");
  doc.para(paraSystemHealth(health, overview.daily));

  doc.subheading("Daily Activity and Health");
  const dailyRows = [...overview.daily].reverse().slice(0, 12);
  doc.table(
    makeCols(cw, [
      { label: "Date", frac: 0.13 },
      { label: "Users", frac: 0.1, align: "right" },
      { label: "Sessions", frac: 0.12, align: "right" },
      { label: "Actions", frac: 0.13, align: "right" },
      { label: "API req.", frac: 0.13, align: "right" },
      { label: "Errors", frac: 0.11, align: "right" },
      { label: "Latency", frac: 0.14, align: "right" },
      { label: "Duration", align: "right" },
    ]),
    dailyRows.map((d) => [d.date, fmt(d.users), fmt(d.sessions), fmt(d.actions), fmt(d.apiRequests), fmt(d.errors), `${fmt(d.avgLatencyMs)} ms`, formatDuration(d.durationMs)]),
    {
      textColor: (_row, ci, ri) => {
        if (ci !== 5) return undefined;
        const d = dailyRows[ri]!;
        return d.errors > 0 && d.errors / Math.max(d.sessions, 1) > 0.1 ? PRESET.critical.color : undefined;
      },
      boldCell: (_row, ci, ri) => {
        if (ci !== 5) return false;
        const d = dailyRows[ri]!;
        return d.errors > 0 && d.errors / Math.max(d.sessions, 1) > 0.1;
      },
    }
  );

  doc.subheading("Error Concentration");
  doc.table(makeCols(cw, [{ label: "Indicator", frac: 0.45 }, { label: "Value", frac: 0.25, align: "right" }, { label: "Change", align: "right" }]), [
    ["Total errors", fmt(problems.summary.totalErrors), deltaArrow(problems.summary.totalErrorsDelta)],
    ["Users affected", fmt(problems.summary.usersAffected), deltaArrow(problems.summary.usersAffectedDelta)],
    ["5xx errors", fmt(problems.summary.errors5xx), deltaArrow(problems.summary.errors5xxDelta)],
    ["Critical issues", fmt(problems.priority.critical), "-"],
    ["High priority issues", fmt(problems.priority.high), "-"],
    ["Medium priority issues", fmt(problems.priority.medium), "-"],
    ["Low priority issues", fmt(problems.priority.low), "-"],
  ]);

  doc.subheading("Errors by Type");
  const totalErrByType = overview.errorsByType.reduce((s, e) => s + e.count, 0) || 1;
  doc.table(
    makeCols(cw, [{ label: "Type", frac: 0.5 }, { label: "Occurrences", frac: 0.25, align: "right" }, { label: "Share of all errors", align: "right" }]),
    [...overview.errorsByType]
      .sort((a, b) => b.count - a.count)
      .map((e) => [e.type, fmt(e.count), `${((e.count / totalErrByType) * 100).toFixed(1)}%`])
  );

  doc.subheading("Top Operational Issues");
  const topIssues = problems.errors.slice(0, 12);
  doc.table(
    makeCols(cw, [
      { label: "Endpoint / issue", frac: 0.45 },
      { label: "Occurrences", frac: 0.16, align: "right" },
      { label: "Users", frac: 0.13, align: "right" },
      { label: "Sessions", frac: 0.13, align: "right" },
      { label: "Severity", align: "right" },
    ]),
    topIssues.map((e) => [`${e.method} ${e.path}`, fmt(e.occurrences), fmt(e.usersAffected), fmt(e.sessionsAffected), severityAssessment(e.severity).label]),
    {
      textColor: (_row, ci, ri) => (ci === 4 ? severityAssessment(topIssues[ri]!.severity).color : undefined),
      boldCell: (_row, ci) => ci === 4,
    }
  );
  if (topIssues.length === 0) {
    doc.para("No API errors were recorded in this range.", { color: THEME.muted, size: 8.5 });
  } else {
    doc.callout(
      "Primary incident interpretation",
      `${topIssues[0]!.method} ${topIssues[0]!.path} is the dominant reported problem and should be investigated before lower-volume issues. The report identifies ${fmt(topIssues[0]!.occurrences)} occurrences across ${fmt(topIssues[0]!.usersAffected)} users and ${fmt(topIssues[0]!.sessionsAffected)} sessions.`,
      { bg: PRESET.critical.bg, accent: PRESET.critical.color }
    );
  }

  // -- 4. API Performance & Technical Assessment --------------------------
  doc.heading("4", "API Performance & Technical Assessment");
  doc.para(paraPerformance(performance));

  doc.subheading("Endpoint Performance Hotspots");
  const hotspots = performance.endpoints.slice(0, 9);
  doc.table(
    makeCols(cw, [
      { label: "Endpoint", frac: 0.28 },
      { label: "Requests", frac: 0.12, align: "right" },
      { label: "Avg", frac: 0.13, align: "right" },
      { label: "P95", frac: 0.13, align: "right" },
      { label: "P99", frac: 0.15, align: "right" },
      { label: "Max", align: "right" },
    ]),
    hotspots.map((e) => [`${e.method} ${e.path}`, fmt(e.total), `${fmt(e.avgLatencyMs)} ms`, `${fmt(e.p95Ms)} ms`, `${fmt(e.p99Ms)} ms`, `${fmt(e.maxLatencyMs)} ms`])
  );

  doc.subheading("Technical Interpretation");
  doc.para(TECH_HYPOTHESES);
  const tailCaveat = paraTailLatencyCaveat(performance.endpoints);
  if (tailCaveat) doc.para(tailCaveat);

  doc.subheading("Priority Optimization Sequence");
  const optRows = buildOptimizationSequence(problems, performance);
  doc.table(
    makeCols(cw, [{ label: "Priority", frac: 0.12 }, { label: "Target", frac: 0.24 }, { label: "Reason", align: "left" }]),
    optRows.map((r) => [r.priority, r.target, r.reason]),
    {
      textColor: (_row, ci, ri) => (ci === 0 ? optimizationPriorityColor(optRows[ri]!.priority) : undefined),
      boldCell: (_row, ci) => ci === 0,
      wrap: true,
    }
  );

  // -- 5. Recommendations & 30-Day Stabilization Plan ---------------------
  doc.heading("5", "Recommendations & 30-Day Stabilization Plan");
  doc.para(
    "The monitoring evidence supports a focused stabilization program. The objective should be to reduce user-impacting failures first, then address latency and finally improve observability quality so subsequent reports can explain not only what happened, but why."
  );

  doc.subheading("Immediate Actions — 0 to 48 Hours");
  doc.table(
    makeCols(cw, [{ label: "Action", frac: 0.48 }, { label: "Expected outcome", align: "left" }]),
    immediateActions(problems.errors[0], performance.endpoints[0]).map((a) => [a.action, a.outcome]),
    { wrap: true }
  );

  doc.subheading("Short Term — Days 3 to 14");
  doc.numberedList(SHORT_TERM);

  doc.subheading("Medium Term — Days 15 to 30");
  doc.numberedList(MEDIUM_TERM);

  doc.subheading("Success Criteria for the Next Report");
  const unknownScreenViews = screens.filter((s) => !s.screen || /unknown/i.test(s.screen)).reduce((s, x) => s + x.views, 0);
  doc.table(
    makeCols(cw, [{ label: "Metric", frac: 0.32 }, { label: "Current baseline", frac: 0.28, align: "right" }, { label: "Direction for next cycle", align: "left" }]),
    [
      ["Availability", `${(health.availability * 100).toFixed(2)}%`, successDirection(health.availability < 0.97, health.availability < 0.995, "Continue improving toward 99.5%+")],
      ["Error rate", `${(health.errorRate * 100).toFixed(2)}%`, successDirection(health.errorRate > 0.05, health.errorRate > 0.01, "Continue reducing toward <1%")],
      ["Avg latency", `${fmt(health.avgLatencyMs)} ms`, successDirection(health.avgLatencyMs > 800, health.avgLatencyMs > 300, "Continue reducing average latency")],
      ["P95 latency", `${fmt(performance.kpis.p95Ms)} ms`, performance.kpis.p95Ms > 1500 ? "Strong reduction" : "Maintain current level"],
      ["P99 latency", `${fmt(performance.kpis.p99Ms)} ms`, performance.kpis.p99Ms > 3000 ? "Strong reduction" : "Maintain current level"],
      ["Total errors", fmt(problems.summary.totalErrors), problems.summary.totalErrors > 0 ? "Substantial reduction" : "Maintain at zero"],
      ["Users affected", fmt(problems.summary.usersAffected), problems.summary.usersAffected > 0 ? "Substantial reduction" : "Maintain at zero"],
      ["Unknown screen views", fmt(unknownScreenViews), unknownScreenViews > 0 ? "Reduce through route instrumentation" : "Maintain named-route coverage"],
    ]
  );

  doc.subheading("Final Assessment");
  doc.para(paraFinalAssessment(status, problems));

  doc.spacer(4);
  doc.para(
    `Source: Monitor Application Observability — ${reportTypeLabel(overview.range)}, ${projectName}, ${fmtDate(overview.range.from)} - ${fmtDate(overview.range.to)}. All figures and observations in this report are summarized from captured monitoring telemetry; where root causes are discussed, they are explicitly framed as investigation hypotheses rather than confirmed findings.`,
    { size: 7.5, color: THEME.muted, lineHeight: 11 }
  );

  return doc.finish(paintFooter);
}

function optimizationPriorityColor(priority: string): PdfColor {
  if (priority === "P0") return PRESET.critical.color;
  if (priority === "P1") return PRESET.warning.color;
  return PRESET.neutral.color;
}
