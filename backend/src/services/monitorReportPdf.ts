import type { Pool } from "pg";
import type { DateRange } from "./monitorJourney.js";
import {
  buildRecommendations,
  getFunnelReport,
  getProjectDashboard,
  getProjectPerformance,
  getProjectProblems,
  getReportBehavior,
} from "./monitorInsights.js";
import {
  getReportOverview,
  getReportRetention,
} from "./monitorReports.js";
import { A4_LANDSCAPE, hexColor, SimplePdf, type PdfColor } from "./simplePdf.js";

export type Overview = Awaited<ReturnType<typeof getReportOverview>>;
export type Funnels = Awaited<ReturnType<typeof getFunnelReport>>;
export type Retention = Awaited<ReturnType<typeof getReportRetention>>;
export type Dashboard = Awaited<ReturnType<typeof getProjectDashboard>>;
export type Problems = Awaited<ReturnType<typeof getProjectProblems>>;
export type Performance = Awaited<ReturnType<typeof getProjectPerformance>>;
export type Behavior = Awaited<ReturnType<typeof getReportBehavior>>;
type Kpi = Overview["kpis"]["users"];

export const C = {
  page: hexColor("#f4f4f5"),
  header: hexColor("#1e1b4b"),
  white: hexColor("#ffffff"),
  ink: hexColor("#18181b"),
  muted: hexColor("#71717a"),
  line: hexColor("#e4e4e7"),
  cardStroke: hexColor("#e4e4e7"),
  indigo: hexColor("#4f46e5"),
  blue: hexColor("#3b82f6"),
  purple: hexColor("#8b5cf6"),
  green: hexColor("#22c55e"),
  sky: hexColor("#38bdf8"),
  red: hexColor("#ef4444"),
  amber: hexColor("#f59e0b"),
  emerald: hexColor("#059669"),
  rose: hexColor("#e11d48"),
};

const ERROR_LABEL: Record<string, string> = {
  "5xx": "5xx Server Error",
  "4xx": "4xx Client Error",
  timeout: "Timeout",
  network: "Network Error",
  other: "Other",
};

const ERROR_COLOR: Record<string, PdfColor> = {
  "5xx": C.red,
  "4xx": hexColor("#f97316"),
  timeout: hexColor("#eab308"),
  network: C.sky,
  other: C.muted,
};

const SEVERITY_COLOR: Record<string, PdfColor> = {
  critical: C.red,
  high: hexColor("#f97316"),
  medium: C.amber,
  low: C.muted,
};

const MARGIN = 28;
const FOOTER_Y = 18;

export const REPORT_SECTION_KEYS = [
  "behavior",
  "journeys",
  "health",
  "apis",
  "errors",
  "users",
  "recommendations",
] as const;
export type ReportSectionKey = (typeof REPORT_SECTION_KEYS)[number];
const ALL_SECTIONS = new Set<string>(REPORT_SECTION_KEYS);

export async function exportReportPdf(
  pool: Pool,
  projectId: string,
  projectName: string,
  range: DateRange,
  sections: Set<string> = ALL_SECTIONS
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
  const recommendations = buildRecommendations({
    errors: problems.errors,
    slow: problems.slow,
    dropoff: funnels.dropoff,
  });
  const buffer = renderMonitorReportPdf({
    projectName,
    overview,
    funnels,
    retention,
    dashboard,
    problems,
    performance,
    behavior,
    recommendations,
    sections,
  });
  const stamp = range.from.toISOString().slice(0, 10);
  const slug =
    projectName
      .replace(/[^a-zA-Z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 40) || "project";
  return { filename: `monitor-report-${slug}-${stamp}.pdf`, buffer };
}

export function renderMonitorReportPdf(input: {
  projectName: string;
  overview: Overview;
  funnels: Funnels;
  retention: Retention;
  dashboard?: Dashboard;
  problems?: Problems;
  performance?: Performance;
  behavior?: Behavior;
  recommendations?: { priority: string; title: string; detail: string }[];
  sections?: Set<string>;
  generatedAt?: Date;
}): Buffer {
  const generatedAt = input.generatedAt ?? new Date();
  const sections = input.sections ?? ALL_SECTIONS;
  const doc = new ReportLayout(input.projectName, input.overview, generatedAt);
  doc.drawCoverPage(reportTypeLabel(input.overview.range), buildScopeLine(sections));
  doc.drawExecutiveSummary(input.overview, input.dashboard);
  if (sections.has("behavior")) doc.drawUserBehaviorPage(input.overview, input.behavior);
  if (sections.has("journeys")) doc.drawUserJourneyPage(input.funnels, input.retention);
  if (sections.has("health")) doc.drawSystemHealthPage(input.overview, input.dashboard);
  if (sections.has("errors")) doc.drawProblemsPage(input.problems, input.overview, sections);
  if (sections.has("apis")) doc.drawPerformancePage(input.performance);
  if (sections.has("recommendations") && input.recommendations && input.recommendations.length > 0) {
    doc.drawRecommendations(input.recommendations);
  }
  return doc.finish();
}

/** Availability/latency/error-rate status thresholds, mirrored from frontend/src/org/lib/metrics.tsx healthLabel(). */
export function healthTileStatus(kind: "availability" | "latency" | "errorRate", value: number): { label: string; color: PdfColor } {
  if (kind === "availability") {
    if (value >= 0.995) return { label: "Healthy", color: C.emerald };
    if (value >= 0.97) return { label: "Degraded", color: C.amber };
    return { label: "Critical", color: C.red };
  }
  if (kind === "latency") {
    if (value <= 300) return { label: "Healthy", color: C.emerald };
    if (value <= 800) return { label: "Watch", color: C.amber };
    return { label: "Slow", color: C.red };
  }
  if (value <= 0.01) return { label: "Healthy", color: C.emerald };
  if (value <= 0.05) return { label: "Watch", color: C.amber };
  return { label: "Critical", color: C.red };
}

export function overallHealthStatus(availability: number, errorRate: number): { label: string; color: PdfColor } {
  if (availability >= 0.995 && errorRate <= 0.01) return { label: "Healthy", color: C.emerald };
  if (availability >= 0.97 && errorRate <= 0.05) return { label: "Degraded", color: C.amber };
  return { label: "Critical", color: C.red };
}

export function reportTypeLabel(range: { from: string; to: string }): string {
  const from = new Date(range.from).getTime();
  const to = new Date(range.to).getTime();
  const days = Math.round((to - from) / 86400000) + 1;
  if (days <= 1) return "Daily Report";
  if (days <= 9) return "Weekly Report";
  if (days <= 35) return "Monthly Report";
  return "Custom Report";
}

const SECTION_SCOPE_LABEL: Record<string, string> = {
  behavior: "user behavior",
  journeys: "journeys",
  health: "system health",
  apis: "API performance",
  errors: "errors",
  users: "affected users",
  recommendations: "recommendations",
};

function buildScopeLine(sections: Set<string>): string {
  const labels = REPORT_SECTION_KEYS.filter((k) => sections.has(k)).map((k) => SECTION_SCOPE_LABEL[k]);
  if (labels.length === 0) return "Executive summary only.";
  return `Overall ${labels.join(" · ")}.`;
}

function buildOverallAssessment(data: Overview, health: ResolvedHealth): string {
  const userDelta = data.kpis.users.delta;
  const userTrend =
    userDelta == null
      ? "was stable"
      : userDelta >= 0
        ? `increased by ${userDelta.toFixed(1)}%`
        : `decreased by ${Math.abs(userDelta).toFixed(1)}%`;
  const errTrend = health.errorRateDelta == null ? "held steady" : health.errorRateDelta <= 0 ? "improved" : "worsened";
  const perfStatus = healthTileStatus("latency", health.avgLatencyMs).label.toLowerCase();
  const relStatus = healthTileStatus("availability", health.availability).label.toLowerCase();
  return (
    `User activity ${userTrend} during this period, reaching ${fmt(data.kpis.users.value)} active users across ${fmt(data.kpis.sessions.value)} sessions. ` +
    `The error rate ${errTrend} to ${(health.errorRate * 100).toFixed(2)}%, and overall reliability is ${relStatus} at ${(health.availability * 100).toFixed(2)}% availability. ` +
    `API performance is ${perfStatus}, averaging ${fmt(health.avgLatencyMs)}ms per request; see the Performance page for the endpoints driving tail latency, and Problems for the errors affecting the most users.`
  );
}

export type ResolvedHealth = {
  availability: number;
  availabilityDelta: number | null;
  avgLatencyMs: number;
  latencyDelta: number | null;
  errorRate: number;
  errorRateDelta: number | null;
};

/** Falls back to overview KPIs when the dashboard health block wasn't fetched. */
export function resolveHealth(data: Overview, dashboard?: Dashboard): ResolvedHealth {
  if (dashboard?.health) {
    const h = dashboard.health;
    return {
      availability: h.availability,
      availabilityDelta: h.availabilityDelta,
      avgLatencyMs: h.avgLatencyMs,
      latencyDelta: h.latencyDelta,
      errorRate: h.errorRate,
      errorRateDelta: h.errorRateDelta,
    };
  }
  const apis = data.kpis.apiRequests.value;
  const errors = data.kpis.errors.value;
  return {
    availability: apis === 0 ? 1 : (apis - errors) / apis,
    availabilityDelta: null,
    avgLatencyMs: data.kpis.avgLatencyMs.value,
    latencyDelta: data.kpis.avgLatencyMs.delta,
    errorRate: apis === 0 ? 0 : errors / apis,
    errorRateDelta: data.kpis.errors.delta,
  };
}

class ReportLayout {
  private pdf = new SimplePdf(A4_LANDSCAPE);
  private y = 0;

  constructor(
    private projectName: string,
    private overview: Overview,
    private generatedAt: Date
  ) {}

  finish(): Buffer {
    this.drawFooters();
    return this.pdf.toBuffer();
  }

  // ------------------------------------------------------------------
  // Page 1 — Cover
  // ------------------------------------------------------------------
  drawCoverPage(reportLabel: string, scopeLine: string): void {
    this.paintPage();
    this.pdf.fill(C.header);
    this.pdf.rect(0, 0, this.pdf.w, 26, "f");
    this.pdf.fill(C.indigo);
    this.pdf.rect(0, 26, this.pdf.w, 2, "f");
    this.pdf.text("MONITOR", MARGIN, 8, { size: 8, bold: true, color: hexColor("#a5b4fc") });
    this.pdf.text("APPLICATION OBSERVABILITY", this.pdf.w - MARGIN, 8, {
      size: 7,
      bold: true,
      color: hexColor("#a5b4fc"),
      align: "right",
    });

    const panelY = 80;
    const panelH = this.pdf.h - panelY - 56;
    this.pdf.fill(C.header);
    this.pdf.rect(MARGIN, panelY, this.pdf.w - MARGIN * 2, panelH, "f");
    this.pdf.fill(C.indigo);
    this.pdf.rect(MARGIN, panelY, 4, panelH, "f");

    const px = MARGIN + 36;
    const pw = this.pdf.w - MARGIN * 2 - 72;
    let ty = panelY + 44;
    this.pdf.text("MONITOR", px, ty, { size: 30, bold: true, color: C.white });
    ty += 30;
    this.pdf.text("Application Monitoring & User Behavior Report", px, ty, { size: 14, color: hexColor("#e0e7ff") });
    ty += 22;
    this.pdf.text(reportLabel.toUpperCase(), px, ty, { size: 9, bold: true, color: hexColor("#a5b4fc") });
    ty += 34;

    this.pdf.text("REPORTING PERIOD", px, ty, { size: 7, bold: true, color: hexColor("#818cf8") });
    ty += 14;
    this.pdf.text(`${fmtDate(this.overview.range.from)} - ${fmtDate(this.overview.range.to)}`, px, ty, {
      size: 12,
      color: C.white,
    });
    ty += 28;

    this.pdf.text("SCOPE", px, ty, { size: 7, bold: true, color: hexColor("#818cf8") });
    ty += 14;
    ty = this.pdf.paragraph(scopeLine, px, ty, pw, { size: 10.5, color: hexColor("#e0e7ff"), lineHeight: 15 });
    ty += 16;

    this.pdf.text(
      `Prepared from monitor.v1 telemetry captured by the application monitoring SDK. Generated ${fmtDateTime(this.generatedAt)}.`,
      px,
      ty,
      { size: 8, color: hexColor("#a5b4fc"), maxWidth: pw }
    );

    this.pdf.text(this.projectName, this.pdf.w - MARGIN - 12, panelY + panelH - 20, {
      size: 9,
      color: hexColor("#a5b4fc"),
      align: "right",
      maxWidth: pw,
    });
  }

  // ------------------------------------------------------------------
  // Page 2 — Executive Summary
  // ------------------------------------------------------------------
  drawExecutiveSummary(data: Overview, dashboard?: Dashboard): void {
    this.pdf.addPage();
    this.paintPage();
    this.drawHero();
    this.y = 62;

    const health = resolveHealth(data, dashboard);
    this.drawSectionTitle("SYSTEM HEALTH", overallHealthStatus(health.availability, health.errorRate));
    this.drawHealthStrip(health);

    this.drawKpis(data);
    this.y += 6;
    this.y = this.pdf.paragraph(buildOverallAssessment(data, health), MARGIN, this.y, this.pdf.w - MARGIN * 2, {
      size: 8.5,
      color: C.ink,
      lineHeight: 13,
    });
    this.y += 10;

    const errRate = health.errorRate;
    const rows: { area: string; status: { label: string; color: PdfColor }; finding: string; action: string }[] = [
      {
        area: "User behavior",
        status: (data.kpis.users.delta ?? 0) >= 0 ? { label: "Healthy", color: C.emerald } : { label: "Watch", color: C.amber },
        finding: `${fmt(data.kpis.users.value)} active users, ${deltaText(data.kpis.users.delta)}.`,
        action: "Continue monitoring peak-hour load.",
      },
      {
        area: "Engagement",
        status: (data.kpis.avgDurationMs.delta ?? 0) >= 0 ? { label: "Healthy", color: C.emerald } : { label: "Watch", color: C.amber },
        finding: `Avg session ${formatDuration(data.kpis.avgDurationMs.value)}, ${deltaText(data.kpis.avgDurationMs.delta)}.`,
        action: "Identify high-value journeys and conversion points.",
      },
      {
        area: "API health",
        status: healthTileStatus("errorRate", errRate),
        finding: `${(errRate * 100).toFixed(2)}% overall error rate.`,
        action: "Prioritize endpoints with repeated 5xx responses.",
      },
      {
        area: "Performance",
        status: healthTileStatus("latency", health.avgLatencyMs),
        finding: `${fmt(health.avgLatencyMs)}ms average latency.`,
        action: "Optimize slow P95/P99 endpoints.",
      },
      {
        area: "Reliability",
        status: healthTileStatus("availability", health.availability),
        finding: `${(health.availability * 100).toFixed(2)}% availability.`,
        action: "Maintain alerting around critical APIs.",
      },
    ];
    this.drawAssessmentTable(rows);
  }

  // ------------------------------------------------------------------
  // Page 2 — User Behavior
  // ------------------------------------------------------------------
  drawUserBehaviorPage(data: Overview, behavior?: Behavior): void {
    this.pdf.addPage();
    this.paintPage();
    this.drawMiniHeader("User Behavior");
    this.y = 52;
    this.drawPageDescription("Daily activity, session behavior, screens and action patterns derived from captured user journeys.");

    const fullW = this.pdf.w - MARGIN * 2;
    const chartH = 150;
    this.panel(MARGIN, this.y, fullW, chartH, "Active users & sessions by day");
    drawLineChart(this.pdf, MARGIN + 16, this.y + 28, fullW - 32, chartH - 44, {
      labels: data.daily.map((d) => shortDay(d.date)),
      series: [
        { name: "Active users", color: C.blue, values: data.daily.map((d) => d.users) },
        { name: "Sessions", color: C.purple, values: data.daily.map((d) => d.sessions) },
      ],
    });
    this.y += chartH + 12;

    const usersVal = data.kpis.users.value;
    const sessionsVal = data.kpis.sessions.value;
    this.drawStatRow([
      { label: "Avg sessions / user", value: (sessionsVal && usersVal ? sessionsVal / usersVal : 0).toFixed(2) },
      { label: "Avg actions / session", value: (data.kpis.actions.value && sessionsVal ? data.kpis.actions.value / sessionsVal : 0).toFixed(2) },
      { label: "Avg session duration", value: formatDuration(data.kpis.avgDurationMs.value), delta: data.kpis.avgDurationMs.delta },
      { label: "Total actions", value: fmt(data.kpis.actions.value), delta: data.kpis.actions.delta },
    ]);

    const half = (fullW - 10) / 2;
    const insightH = 44;
    const remain = this.pdf.h - this.y - 32 - insightH - 10;
    this.panel(MARGIN, this.y, half, remain, "Most visited screens");
    const screens = behavior?.screens ?? data.topScreens.map((s) => ({ screen: s.screen, views: s.count, users: 0 }));
    drawHBars(
      this.pdf,
      MARGIN + 12,
      this.y + 28,
      half - 24,
      remain - 40,
      screens.slice(0, 8).map((s) => ({ label: s.screen, value: s.views, color: C.indigo }))
    );
    this.panel(MARGIN + half + 10, this.y, half, remain, "Most common journeys");
    this.drawJourneyList(MARGIN + half + 10, this.y, half, remain, behavior?.journeys ?? []);
    this.y += remain + 10;

    const topScreen = screens[0];
    const topJourney = behavior?.journeys?.[0];
    const insight =
      (topScreen
        ? `${topScreen.screen} is the primary entry point with ${fmt(topScreen.views)} views this period.`
        : "No screen views were recorded in this range.") +
      (topJourney
        ? ` The most common path through the product is ${topJourney.path.join(" -> ")}, followed by ${(topJourney.pct * 100).toFixed(1)}% of sampled sessions.`
        : "");
    this.drawInsight("BEHAVIOR INSIGHT", insight);
  }

  // ------------------------------------------------------------------
  // Page 3 — User Journey
  // ------------------------------------------------------------------
  drawUserJourneyPage(funnels: Funnels, retention: Retention): void {
    this.pdf.addPage();
    this.paintPage();
    this.drawMiniHeader("User Journey");
    this.y = 52;
    this.drawPageDescription("Where users spend time, how they move through the application, and where journeys break.");

    const fullW = this.pdf.w - MARGIN * 2;
    const half = (fullW - 10) / 2;
    const funnelH = 200;
    this.panel(MARGIN, this.y, half, funnelH, "Screen funnel");
    this.drawFunnel(MARGIN, this.y, half, funnelH, funnels);
    this.panel(MARGIN + half + 10, this.y, half, funnelH, "Top transitions");
    this.drawTransitions(MARGIN + half + 10, this.y, half, funnelH, funnels);
    this.y += funnelH + 12;

    const calloutH = 60;
    this.drawDropoffCallout(MARGIN, this.y, fullW, calloutH, funnels.dropoff);
    this.y += calloutH + 12;

    const remain = this.pdf.h - this.y - 32;
    this.panel(MARGIN, this.y, fullW, remain, "Retention");
    this.drawRetention(MARGIN, this.y, fullW, remain, retention);
  }

  // ------------------------------------------------------------------
  // Page 4 — System Health
  // ------------------------------------------------------------------
  drawSystemHealthPage(data: Overview, dashboard?: Dashboard): void {
    this.pdf.addPage();
    this.paintPage();
    this.drawMiniHeader("System Health");
    this.y = 52;
    this.drawPageDescription("Availability, latency and error-rate trends, plus the full daily activity log behind them.");

    const health = resolveHealth(data, dashboard);
    this.drawHealthStrip(health);

    const fullW = this.pdf.w - MARGIN * 2;
    const half = (fullW - 10) / 2;
    const chartH = 160;
    this.panel(MARGIN, this.y, half, chartH, "Availability by day (%)");
    drawLineChart(this.pdf, MARGIN + 16, this.y + 28, half - 32, chartH - 44, {
      labels: data.daily.map((d) => shortDay(d.date)),
      series: [
        {
          name: "Availability",
          color: C.emerald,
          values: data.daily.map((d) => (d.apiRequests === 0 ? 100 : ((d.apiRequests - d.errors) / d.apiRequests) * 100)),
        },
      ],
    });
    this.panel(MARGIN + half + 10, this.y, half, chartH, "Avg API latency by day (ms)");
    drawLineChart(this.pdf, MARGIN + half + 10 + 16, this.y + 28, half - 32, chartH - 44, {
      labels: data.daily.map((d) => shortDay(d.date)),
      series: [{ name: "Latency", color: C.amber, values: data.daily.map((d) => d.avgLatencyMs) }],
    });
    this.y += chartH + 12;

    const insightH = 30;
    const remain = this.pdf.h - this.y - 32 - insightH - 10;
    this.panel(MARGIN, this.y, fullW, remain, "Daily activity");
    this.drawDailyTable(MARGIN, this.y, fullW, remain, data.daily);
    this.y += remain + 10;

    const latencyNote =
      health.latencyDelta != null && health.latencyDelta > 0
        ? "average latency is trending upward and is worth monitoring closely"
        : "average latency is trending flat or improving";
    this.drawInsight(
      "HEALTH INSIGHT",
      `Availability held at ${(health.availability * 100).toFixed(2)}% with an error rate of ${(health.errorRate * 100).toFixed(2)}%, placing the system in "${overallHealthStatus(health.availability, health.errorRate).label}" status for this period. Meanwhile ${latencyNote}.`
    );
  }

  // ------------------------------------------------------------------
  // Page 5 — Problems
  // ------------------------------------------------------------------
  drawProblemsPage(problems: Problems | undefined, data: Overview, sections: Set<string>): void {
    this.pdf.addPage();
    this.paintPage();
    this.drawMiniHeader("Problems");
    this.y = 52;
    this.drawPageDescription("Error concentration helps prioritize the failures affecting the greatest number of users.");

    if (!problems) {
      this.pdf.text("No problem data available for this range.", MARGIN, this.y + 20, { size: 9, color: C.muted });
      return;
    }

    this.drawStatRow([
      { label: "Total errors", value: fmt(problems.summary.totalErrors), delta: problems.summary.totalErrorsDelta, invert: true },
      { label: "Users affected", value: fmt(problems.summary.usersAffected), delta: problems.summary.usersAffectedDelta, invert: true },
      { label: "5xx errors", value: fmt(problems.summary.errors5xx), delta: problems.summary.errors5xxDelta, invert: true },
      { label: "Critical", value: fmt(problems.summary.critical) },
    ]);

    const fullW = this.pdf.w - MARGIN * 2;
    const half = (fullW - 10) / 2;
    const rowH = 110;
    this.panel(MARGIN, this.y, half, rowH, "Priority breakdown");
    this.drawPriorityBreakdown(MARGIN, this.y, half, rowH, problems.priority);
    this.panel(MARGIN + half + 10, this.y, half, rowH, "Errors by type");
    drawHBars(
      this.pdf,
      MARGIN + half + 10 + 14,
      this.y + 32,
      half - 28,
      rowH - 44,
      data.errorsByType.map((s) => ({
        label: ERROR_LABEL[s.type] ?? s.type,
        value: s.count,
        color: ERROR_COLOR[s.type] ?? C.red,
      }))
    );
    this.y += rowH + 12;

    const insightH = 30;
    const remain = this.pdf.h - this.y - 32 - insightH - 10;
    const issuesW = fullW * 0.62;
    const usersW = fullW - issuesW - 10;
    this.panel(MARGIN, this.y, issuesW, remain, "Top issues");
    this.drawIssuesTable(MARGIN, this.y, issuesW, remain, problems.errors);
    this.panel(MARGIN + issuesW + 10, this.y, usersW, remain, "Top affected users");
    if (sections.has("users")) {
      this.drawUserTable(MARGIN + issuesW + 10, this.y, usersW, remain, data.topUsers);
    } else {
      this.omittedNote(MARGIN + issuesW + 10, this.y, usersW);
    }
    this.y += remain + 10;

    const top = problems.errors[0];
    const insight = top
      ? `${top.method} ${top.path} is the dominant problem this period, combining ${fmt(top.occurrences)} occurrences across ${fmt(top.usersAffected)} users and ${fmt(top.sessionsAffected)} sessions. It should be investigated before lower-volume issues.`
      : "No errors were recorded in this range.";
    this.drawInsight("INCIDENT INTERPRETATION", insight);
  }

  // ------------------------------------------------------------------
  // Page 6 — Performance
  // ------------------------------------------------------------------
  drawPerformancePage(performance?: Performance): void {
    this.pdf.addPage();
    this.paintPage();
    this.drawMiniHeader("Performance");
    this.y = 52;
    this.drawPageDescription("Endpoint volume, latency, and reliability indicators for the selected period.");

    if (!performance) {
      this.pdf.text("No performance data available for this range.", MARGIN, this.y + 20, { size: 9, color: C.muted });
      return;
    }

    this.drawStatRow([
      { label: "Avg latency", value: `${fmt(performance.kpis.avgLatencyMs)}ms`, delta: performance.kpis.avgDelta, invert: true },
      { label: "P95", value: `${fmt(performance.kpis.p95Ms)}ms`, delta: performance.kpis.p95Delta, invert: true },
      { label: "P99", value: `${fmt(performance.kpis.p99Ms)}ms`, delta: performance.kpis.p99Delta, invert: true },
      { label: "Slow APIs", value: fmt(performance.kpis.slowApis), delta: performance.kpis.slowDelta, invert: true },
    ]);

    const fullW = this.pdf.w - MARGIN * 2;
    const chartH = 150;
    this.panel(MARGIN, this.y, fullW, chartH, "API latency over time");
    drawLineChart(this.pdf, MARGIN + 16, this.y + 28, fullW - 32, chartH - 44, {
      labels: performance.latency.map((p) => p.label),
      series: [{ name: "Avg latency", color: C.amber, values: performance.latency.map((p) => p.avgMs) }],
    });
    this.y += chartH + 12;

    const insightH = 30;
    const remain = this.pdf.h - this.y - 32 - insightH - 10;
    this.panel(MARGIN, this.y, fullW, remain, "Slowest endpoints");
    this.drawSlowEndpointsTable(MARGIN, this.y, fullW, remain, performance.endpoints);
    this.y += remain + 10;

    const p95Note =
      performance.kpis.p95Ms >= 2000
        ? "tail latency is elevated and warrants endpoint-level tuning"
        : "tail latency remains within an acceptable range";
    this.drawInsight(
      "PERFORMANCE INSIGHT",
      `P95 latency of ${fmt(performance.kpis.p95Ms)}ms and P99 of ${fmt(performance.kpis.p99Ms)}ms indicate ${p95Note}. ${fmt(performance.kpis.slowApis)} endpoint(s) are averaging over 500ms and are the best candidates for optimization.`
    );
  }

  // ------------------------------------------------------------------
  // Page 7 — Recommendations
  // ------------------------------------------------------------------
  drawRecommendations(recs: { priority: string; title: string; detail: string }[]): void {
    this.pdf.addPage();
    this.paintPage();
    this.drawMiniHeader("Recommendations");
    this.y = 52;
    this.drawPageDescription("Convert telemetry into operational decisions rather than simply displaying metrics.");
    const h = this.pdf.h - this.y - 32;
    this.panel(MARGIN, this.y, this.pdf.w - MARGIN * 2, h, "Priority actions");
    recs.slice(0, 8).forEach((r, i) => {
      const ry = this.y + 36 + i * 52;
      const color = r.priority === "P0" ? C.red : r.priority === "P1" ? C.amber : C.muted;
      this.pdf.fill(color);
      this.pdf.rect(MARGIN + 16, ry - 8, 8, 8, "f");
      this.pdf.text(r.priority, MARGIN + 32, ry, { size: 10, bold: true, color });
      this.pdf.text(r.title, MARGIN + 66, ry, { size: 9, color: C.ink, maxWidth: this.pdf.w - MARGIN * 2 - 78 });
      this.pdf.text(r.detail, MARGIN + 66, ry + 14, { size: 8, color: C.muted, maxWidth: this.pdf.w - MARGIN * 2 - 78 });
    });
  }

  // ------------------------------------------------------------------
  // Shared drawing primitives
  // ------------------------------------------------------------------

  private paintPage(): void {
    this.pdf.fill(C.page);
    this.pdf.rect(0, 0, this.pdf.w, this.pdf.h, "f");
  }

  private drawHero(): void {
    this.pdf.fill(C.header);
    this.pdf.rect(0, 0, this.pdf.w, 52, "f");
    this.pdf.fill(C.indigo);
    this.pdf.rect(0, 52, this.pdf.w, 2, "f");
    this.pdf.text("MONITOR", MARGIN, 12, { size: 9, bold: true, color: hexColor("#a5b4fc") });
    this.pdf.text("Reports", MARGIN, 26, { size: 16, bold: true, color: C.white });
    this.pdf.text(this.projectName, MARGIN + 92, 28, {
      size: 11,
      color: hexColor("#c7d2fe"),
      maxWidth: 260,
    });
    const period = `${fmtDate(this.overview.range.from)}  –  ${fmtDate(this.overview.range.to)}`;
    this.pdf.text(period, this.pdf.w - MARGIN, 16, { size: 10, bold: true, color: C.white, align: "right" });
    this.pdf.text(`Generated ${fmtDateTime(this.generatedAt)}  ·  vs prior equal-length window`, this.pdf.w - MARGIN, 32, {
      size: 8,
      color: hexColor("#a5b4fc"),
      align: "right",
    });
  }

  private drawMiniHeader(subtitle: string): void {
    this.pdf.fill(C.header);
    this.pdf.rect(0, 0, this.pdf.w, 40, "f");
    this.pdf.fill(C.indigo);
    this.pdf.rect(0, 40, this.pdf.w, 2, "f");
    this.pdf.text("MONITOR REPORT", MARGIN, 10, { size: 8, bold: true, color: hexColor("#a5b4fc") });
    this.pdf.text(this.projectName, MARGIN, 22, { size: 12, bold: true, color: C.white, maxWidth: 320 });
    this.pdf.text(subtitle, this.pdf.w - MARGIN, 14, {
      size: 9,
      color: hexColor("#c7d2fe"),
      align: "right",
    });
    this.pdf.text(`${fmtDate(this.overview.range.from)} – ${fmtDate(this.overview.range.to)}`, this.pdf.w - MARGIN, 26, {
      size: 8,
      color: hexColor("#a5b4fc"),
      align: "right",
    });
  }

  private drawFooters(): void {
    const pages = this.pdf.pageCount;
    for (let i = 0; i < pages; i++) {
      this.pdf.usePage(i);
      this.pdf.text("Monitor  ·  confidential", MARGIN, this.pdf.h - FOOTER_Y, {
        size: 7,
        color: C.muted,
      });
      this.pdf.text(`Page ${i + 1} of ${pages}`, this.pdf.w - MARGIN, this.pdf.h - FOOTER_Y, {
        size: 7,
        color: C.muted,
        align: "right",
      });
    }
  }

  private panel(x: number, y: number, w: number, h: number, title: string): void {
    this.pdf.fill(C.white);
    this.pdf.stroke(C.cardStroke);
    this.pdf.lineWidth(0.6);
    this.pdf.rect(x, y, w, h, "B");
    this.pdf.text(title, x + 12, y + 8, { size: 9, bold: true, color: C.ink, maxWidth: w - 24 });
    this.pdf.stroke(C.line);
    this.pdf.lineWidth(0.4);
    this.pdf.line(x, y + 22, x + w, y + 22);
  }

  private omittedNote(x: number, y: number, w: number): void {
    this.pdf.text("Not included in this report.", x + 14, y + 40, {
      size: 8,
      color: C.muted,
      maxWidth: w - 28,
    });
  }

  /** One-line muted caption under a page's mini-header, describing what the page shows. */
  private drawPageDescription(text: string): void {
    this.pdf.text(text, MARGIN, this.y, { size: 8.5, color: C.muted, maxWidth: this.pdf.w - MARGIN * 2 });
    this.y += 16;
  }

  /** A short labeled, wrapped narrative paragraph interpreting the page's data. */
  private drawInsight(label: string, text: string): void {
    this.pdf.text(label, MARGIN, this.y, { size: 7.5, bold: true, color: C.indigo });
    this.y += 12;
    this.y = this.pdf.paragraph(text, MARGIN, this.y, this.pdf.w - MARGIN * 2, {
      size: 8.5,
      color: C.ink,
      lineHeight: 13,
      maxLines: 3,
    });
  }

  private drawSectionTitle(label: string, status: { label: string; color: PdfColor }): void {
    this.pdf.text(label, MARGIN, this.y, { size: 9, bold: true, color: C.muted });
    this.pdf.fill(status.color);
    this.pdf.rect(MARGIN + 88, this.y + 2, 6, 6, "f");
    this.pdf.text(status.label, MARGIN + 98, this.y, { size: 9, bold: true, color: status.color });
    this.y += 16;
  }

  private drawHealthStrip(health: ResolvedHealth): void {
    const items: { label: string; value: string; status: { label: string; color: PdfColor }; delta: number | null; invert: boolean }[] = [
      {
        label: "AVAILABILITY",
        value: `${(health.availability * 100).toFixed(2)}%`,
        status: healthTileStatus("availability", health.availability),
        delta: health.availabilityDelta,
        invert: false,
      },
      {
        label: "AVG API LATENCY",
        value: `${fmt(health.avgLatencyMs)}ms`,
        status: healthTileStatus("latency", health.avgLatencyMs),
        delta: health.latencyDelta,
        invert: true,
      },
      {
        label: "ERROR RATE",
        value: `${(health.errorRate * 100).toFixed(2)}%`,
        status: healthTileStatus("errorRate", health.errorRate),
        delta: health.errorRateDelta,
        invert: true,
      },
    ];
    const gap = 10;
    const w = (this.pdf.w - MARGIN * 2 - gap * 2) / 3;
    const h = 70;
    items.forEach((item, i) => {
      const x = MARGIN + i * (w + gap);
      this.pdf.fill(C.white);
      this.pdf.stroke(C.cardStroke);
      this.pdf.lineWidth(0.6);
      this.pdf.rect(x, this.y, w, h, "B");
      this.pdf.fill(item.status.color);
      this.pdf.rect(x, this.y, w, 3, "f");
      this.pdf.text(item.label, x + 12, this.y + 12, { size: 7, bold: true, color: C.muted });
      this.pdf.text(item.status.label, x + w - 12, this.y + 12, { size: 8, bold: true, color: item.status.color, align: "right" });
      this.pdf.text(item.value, x + 12, this.y + 26, { size: 19, bold: true, color: C.ink });
      const good = item.invert ? (item.delta ?? 0) <= 0 : (item.delta ?? 0) >= 0;
      this.pdf.text(deltaText(item.delta), x + 12, this.y + 54, {
        size: 7,
        color: item.delta == null ? C.muted : good ? C.emerald : C.rose,
      });
    });
    this.y += h + 14;
  }

  private drawKpis(data: Overview): void {
    const items: { label: string; kpi: Kpi; color: PdfColor; format?: (n: number) => string; invert?: boolean }[] = [
      { label: "Active users", kpi: data.kpis.users, color: C.blue },
      { label: "Sessions", kpi: data.kpis.sessions, color: C.purple },
      { label: "Total actions", kpi: data.kpis.actions, color: C.green },
      { label: "API requests", kpi: data.kpis.apiRequests, color: C.sky },
      { label: "Errors", kpi: data.kpis.errors, color: C.red, invert: true },
      { label: "Avg. latency", kpi: data.kpis.avgLatencyMs, color: C.amber, invert: true, format: (n) => `${fmt(n)}ms` },
    ];
    const gap = 8;
    const w = (this.pdf.w - MARGIN * 2 - gap * 5) / 6;
    const h = 78;
    items.forEach((item, i) => {
      const x = MARGIN + i * (w + gap);
      this.pdf.fill(C.white);
      this.pdf.stroke(C.cardStroke);
      this.pdf.lineWidth(0.6);
      this.pdf.rect(x, this.y, w, h, "B");
      this.pdf.fill(item.color);
      this.pdf.rect(x, this.y, 3, h, "f");
      this.pdf.text(item.label.toUpperCase(), x + 10, this.y + 8, {
        size: 6.5,
        bold: true,
        color: C.muted,
        maxWidth: w - 16,
      });
      this.pdf.text(item.format ? item.format(item.kpi.value) : fmt(item.kpi.value), x + 10, this.y + 22, {
        size: 16,
        bold: true,
        color: C.ink,
        maxWidth: w - 16,
      });
      const good = item.invert ? (item.kpi.delta ?? 0) <= 0 : (item.kpi.delta ?? 0) >= 0;
      this.pdf.text(deltaText(item.kpi.delta), x + 10, this.y + 42, {
        size: 7,
        color: item.kpi.delta == null ? C.muted : good ? C.emerald : C.rose,
        maxWidth: w - 16,
      });
      drawSparkline(this.pdf, x + 10, this.y + 56, w - 20, 16, item.kpi.sparkline, item.color);
    });
    this.y += h + 10;
  }

  private drawStatRow(items: { label: string; value: string; delta?: number | null; invert?: boolean }[]): void {
    const gap = 8;
    const w = (this.pdf.w - MARGIN * 2 - gap * (items.length - 1)) / items.length;
    const h = 60;
    items.forEach((item, i) => {
      const x = MARGIN + i * (w + gap);
      this.pdf.fill(C.white);
      this.pdf.stroke(C.cardStroke);
      this.pdf.lineWidth(0.6);
      this.pdf.rect(x, this.y, w, h, "B");
      this.pdf.text(item.label.toUpperCase(), x + 10, this.y + 10, { size: 6.5, bold: true, color: C.muted, maxWidth: w - 20 });
      this.pdf.text(item.value, x + 10, this.y + 24, { size: 15, bold: true, color: C.ink, maxWidth: w - 20 });
      if (item.delta !== undefined) {
        const good = item.invert ? (item.delta ?? 0) <= 0 : (item.delta ?? 0) >= 0;
        this.pdf.text(deltaText(item.delta), x + 10, this.y + 44, {
          size: 7,
          color: item.delta == null ? C.muted : good ? C.emerald : C.rose,
        });
      }
    });
    this.y += h + 12;
  }

  private drawAssessmentTable(rows: { area: string; status: { label: string; color: PdfColor }; finding: string; action: string }[]): void {
    const w = this.pdf.w - MARGIN * 2;
    const cols = [
      { label: "Area", width: w * 0.13, align: "left" as const },
      { label: "Status", width: w * 0.11, align: "left" as const },
      { label: "Key finding", width: w * 0.35, align: "left" as const },
      { label: "Recommended action", width: w - w * 0.13 - w * 0.11 - w * 0.35, align: "left" as const },
    ];
    this.drawTableHeader(MARGIN, this.y, cols);
    const rowH = 24;
    rows.forEach((r, i) => {
      const ry = this.y + 18 + i * rowH;
      let cx = MARGIN;
      this.pdf.text(r.area, cx + 12, ry, { size: 8, color: C.ink, maxWidth: cols[0]!.width - 16 });
      cx += cols[0]!.width;
      this.pdf.text(r.status.label, cx + 12, ry, { size: 8, bold: true, color: r.status.color, maxWidth: cols[1]!.width - 16 });
      cx += cols[1]!.width;
      this.pdf.text(r.finding, cx + 12, ry, { size: 7.5, color: C.ink, maxWidth: cols[2]!.width - 16 });
      cx += cols[2]!.width;
      this.pdf.text(r.action, cx + 12, ry, { size: 7.5, color: C.muted, maxWidth: cols[3]!.width - 16 });
    });
    this.y += 18 + rows.length * rowH + 10;
  }

  private drawJourneyList(x: number, y: number, w: number, h: number, journeys: { path: string[]; count: number; pct: number }[]): void {
    if (journeys.length === 0) {
      this.pdf.text("No repeated journeys in this range.", x + 14, y + 40, { size: 8, color: C.muted });
      return;
    }
    const rowH = Math.min(32, (h - 32) / journeys.length);
    journeys.slice(0, 6).forEach((j, i) => {
      const ry = y + 30 + i * rowH;
      this.pdf.text(j.path.join("  →  "), x + 14, ry, { size: 8, color: C.ink, maxWidth: w - 90 });
      this.pdf.text(`${(j.pct * 100).toFixed(1)}%`, x + w - 14, ry, { size: 8, bold: true, color: C.indigo, align: "right" });
      this.pdf.text(`${fmt(j.count)} sessions`, x + w - 14, ry + 11, { size: 6.5, color: C.muted, align: "right" });
    });
  }

  private drawDropoffCallout(x: number, y: number, w: number, h: number, dropoff: Funnels["dropoff"]): void {
    this.pdf.fill(hexColor("#fef2f2"));
    this.pdf.stroke(hexColor("#fecaca"));
    this.pdf.lineWidth(0.6);
    this.pdf.rect(x, y, w, h, "B");
    if (!dropoff) {
      this.pdf.text("No significant drop-off detected in this range.", x + 14, y + h / 2, { size: 8, color: C.muted });
      return;
    }
    this.pdf.text("LARGEST DROP-OFF", x + 14, y + 10, { size: 7, bold: true, color: C.rose });
    this.pdf.text(`${dropoff.from}  →  ${dropoff.to}`, x + 14, y + 24, { size: 11, bold: true, color: C.ink });
    this.pdf.text(
      `${fmt(dropoff.fromCount)} → ${fmt(dropoff.toCount)}  (${(dropoff.rate * 100).toFixed(0)}% drop)`,
      x + 14,
      y + 40,
      { size: 8, color: C.muted }
    );
    const causes = dropoff.causes;
    if (causes && causes.length > 0) {
      this.pdf.text(`Possible causes: ${causes.join(" · ")}`, x + w - 14, y + 24, {
        size: 8,
        color: C.muted,
        align: "right",
        maxWidth: w * 0.45,
      });
    }
  }

  private drawPriorityBreakdown(x: number, y: number, w: number, h: number, priority: { critical: number; high: number; medium: number; low: number }): void {
    const items = [
      { label: "Critical", value: priority.critical, color: SEVERITY_COLOR.critical! },
      { label: "High", value: priority.high, color: SEVERITY_COLOR.high! },
      { label: "Medium", value: priority.medium, color: SEVERITY_COLOR.medium! },
      { label: "Low", value: priority.low, color: SEVERITY_COLOR.low! },
    ];
    const max = Math.max(...items.map((i) => i.value), 1);
    const rowH = Math.min(24, (h - 30) / items.length);
    items.forEach((item, i) => {
      const ry = y + 30 + i * rowH;
      this.pdf.fill(item.color);
      this.pdf.rect(x + 14, ry, 8, 8, "f");
      this.pdf.text(item.label, x + 28, ry, { size: 8, color: C.ink });
      const barX = x + 92;
      const barW = w - 92 - 40;
      this.pdf.fill(hexColor("#f4f4f5"));
      this.pdf.rect(barX, ry, barW, 8, "f");
      this.pdf.fill(item.color);
      this.pdf.rect(barX, ry, Math.max(2, (item.value / max) * barW), 8, "f");
      this.pdf.text(fmt(item.value), x + w - 14, ry, { size: 8, bold: true, color: C.ink, align: "right" });
    });
  }

  private drawUserTable(x: number, y: number, w: number, h: number, rows: Overview["topUsers"]): void {
    const cols = [
      { label: "User", width: w - 190 },
      { label: "Sessions", width: 64 },
      { label: "Actions", width: 64 },
      { label: "Errors", width: 62 },
    ];
    const startY = y + 28;
    this.drawTableHeader(x, startY, cols.map((c, i) => ({ ...c, align: i === 0 ? "left" : "right" })));
    if (rows.length === 0) {
      this.pdf.text("No identified users in this range.", x + 12, startY + 18, { size: 8, color: C.muted });
      return;
    }
    const maxRows = Math.max(0, Math.floor((h - 48) / 18));
    rows.slice(0, maxRows).forEach((u, i) => {
      const ry = startY + 16 + i * 18;
      this.pdf.text(u.email || u.userId || u.userKey, x + 12, ry, {
        size: 8,
        color: C.ink,
        maxWidth: cols[0]!.width - 10,
      });
      this.pdf.text(fmt(u.sessions), x + cols[0]!.width + cols[1]!.width, ry, { size: 8, color: C.ink, align: "right" });
      this.pdf.text(fmt(u.actions), x + cols[0]!.width + cols[1]!.width + cols[2]!.width, ry, {
        size: 8,
        color: C.ink,
        align: "right",
      });
      this.pdf.text(fmt(u.errors), x + w - 12, ry, {
        size: 8,
        color: u.errors > 0 ? C.rose : C.ink,
        align: "right",
      });
    });
  }

  private drawIssuesTable(x: number, y: number, w: number, h: number, rows: Problems["errors"]): void {
    const fixed = 66 + 48 + 54 + 72 + 60;
    const cols = [
      { label: "Issue", width: w - fixed, align: "left" as const },
      { label: "Occurrences", width: 66, align: "right" as const },
      { label: "Users", width: 48, align: "right" as const },
      { label: "Sessions", width: 54, align: "right" as const },
      { label: "Last seen", width: 72, align: "right" as const },
      { label: "Severity", width: 60, align: "right" as const },
    ];
    const startY = y + 28;
    this.drawTableHeader(x, startY, cols);
    if (rows.length === 0) {
      this.pdf.text("No errors in this range.", x + 12, startY + 18, { size: 8, color: C.muted });
      return;
    }
    const maxRows = Math.max(0, Math.floor((h - 48) / 18));
    rows.slice(0, maxRows).forEach((r, i) => {
      const ry = startY + 16 + i * 18;
      let cx = x;
      const label = `${r.method} ${r.path}${r.statusCode != null ? ` -> ${r.statusCode}` : ""}`;
      this.pdf.text(label, cx + 12, ry, { size: 7.5, color: C.ink, maxWidth: cols[0]!.width - 16 });
      cx += cols[0]!.width;
      this.pdf.text(fmt(r.occurrences), cx + cols[1]!.width - 12, ry, { size: 8, color: C.ink, align: "right" });
      cx += cols[1]!.width;
      this.pdf.text(fmt(r.usersAffected), cx + cols[2]!.width - 12, ry, { size: 8, color: C.ink, align: "right" });
      cx += cols[2]!.width;
      this.pdf.text(fmt(r.sessionsAffected), cx + cols[3]!.width - 12, ry, { size: 8, color: C.ink, align: "right" });
      cx += cols[3]!.width;
      this.pdf.text(fmtDateShort(r.lastSeen), cx + cols[4]!.width - 12, ry, { size: 7, color: C.muted, align: "right" });
      cx += cols[4]!.width;
      this.pdf.text(r.severity.toUpperCase(), x + w - 12, ry, {
        size: 7.5,
        bold: true,
        color: SEVERITY_COLOR[r.severity] ?? C.muted,
        align: "right",
      });
    });
  }

  private drawSlowEndpointsTable(x: number, y: number, w: number, h: number, rows: Performance["endpoints"]): void {
    const cols = [
      { label: "Endpoint", width: w - 280, align: "left" as const },
      { label: "Requests", width: 70, align: "right" as const },
      { label: "Avg", width: 60, align: "right" as const },
      { label: "P95", width: 60, align: "right" as const },
      { label: "P99", width: 60, align: "right" as const },
      { label: "Max", width: 30, align: "right" as const },
    ];
    const startY = y + 28;
    this.drawTableHeader(x, startY, cols);
    if (rows.length === 0) {
      this.pdf.text("No API traffic in this range.", x + 12, startY + 18, { size: 8, color: C.muted });
      return;
    }
    const maxRows = Math.max(0, Math.floor((h - 48) / 18));
    rows.slice(0, maxRows).forEach((r, i) => {
      const ry = startY + 16 + i * 18;
      let cx = x;
      this.pdf.text(`${r.method}  ${r.path}`, cx + 12, ry, { size: 8, color: C.ink, maxWidth: cols[0]!.width - 16 });
      cx += cols[0]!.width;
      this.pdf.text(fmt(r.total), cx + cols[1]!.width - 12, ry, { size: 8, color: C.ink, align: "right" });
      cx += cols[1]!.width;
      this.pdf.text(`${fmt(r.avgLatencyMs)}ms`, cx + cols[2]!.width - 12, ry, { size: 8, color: C.ink, align: "right" });
      cx += cols[2]!.width;
      this.pdf.text(`${fmt(r.p95Ms)}ms`, cx + cols[3]!.width - 12, ry, {
        size: 8,
        color: r.p95Ms >= 2000 ? C.rose : C.ink,
        align: "right",
      });
      cx += cols[3]!.width;
      this.pdf.text(`${fmt(r.p99Ms)}ms`, cx + cols[4]!.width - 12, ry, {
        size: 8,
        color: r.p99Ms >= 2000 ? C.rose : C.ink,
        align: "right",
      });
      cx += cols[4]!.width;
      this.pdf.text(`${fmt(r.maxLatencyMs)}ms`, x + w - 12, ry, { size: 7.5, color: C.muted, align: "right" });
    });
  }

  private drawDailyTable(x: number, y: number, w: number, h: number, rows: Overview["daily"]): void {
    const cols = [
      { label: "Date", width: 90, align: "left" as const },
      { label: "Users", width: 80, align: "right" as const },
      { label: "Sessions", width: 90, align: "right" as const },
      { label: "Actions", width: 90, align: "right" as const },
      { label: "API", width: 90, align: "right" as const },
      { label: "Errors", width: 80, align: "right" as const },
      { label: "Latency", width: 90, align: "right" as const },
      { label: "Duration", width: w - 90 - 80 - 90 - 90 - 90 - 80 - 90 - 24, align: "right" as const },
    ];
    const startY = y + 28;
    this.drawTableHeader(x, startY, cols);
    const maxRows = Math.max(0, Math.floor((h - 48) / 16));
    const slice = [...rows].reverse().slice(0, maxRows);
    slice.forEach((d, i) => {
      const ry = startY + 16 + i * 16;
      this.pdf.text(d.date, x + 12, ry, { size: 8, color: C.ink });
      let cx = x + cols[0]!.width;
      const cells = [fmt(d.users), fmt(d.sessions), fmt(d.actions), fmt(d.apiRequests), fmt(d.errors), `${fmt(d.avgLatencyMs)}ms`, formatDuration(d.durationMs)];
      cells.forEach((cell, ci) => {
        cx += cols[ci + 1]!.width;
        this.pdf.text(cell, ci === cells.length - 1 ? x + w - 12 : cx, ry, {
          size: 8,
          color: C.ink,
          align: "right",
        });
      });
    });
  }

  private drawFunnel(x: number, y: number, w: number, h: number, funnels: Funnels): void {
    if (funnels.steps.length === 0) {
      this.pdf.text("No navigation events in this range.", x + 14, y + 40, { size: 8, color: C.muted });
      return;
    }
    const max = Math.max(...funnels.steps.map((s) => s.users), 1);
    const rowH = Math.min(28, (h - 40) / funnels.steps.length);
    funnels.steps.slice(0, 7).forEach((step, i) => {
      const ry = y + 32 + i * rowH;
      const barW = Math.max(8, ((w - 28) * step.users) / max);
      this.pdf.fill(hexColor("#e0e7ff"));
      this.pdf.rect(x + 14, ry, barW, rowH - 8, "f");
      this.pdf.text(step.screen, x + 18, ry + 4, { size: 8, color: C.ink, maxWidth: w - 90 });
      this.pdf.text(`${fmt(step.users)}  (${(step.conversion * 100).toFixed(0)}%)`, x + w - 14, ry + 4, {
        size: 8,
        color: C.muted,
        align: "right",
      });
    });
  }

  private drawTransitions(x: number, y: number, w: number, h: number, funnels: Funnels): void {
    const cols = [
      { label: "From", width: (w - 80) / 2, align: "left" as const },
      { label: "To", width: (w - 80) / 2, align: "left" as const },
      { label: "Count", width: 80, align: "right" as const },
    ];
    const startY = y + 28;
    this.drawTableHeader(x, startY, cols);
    if (funnels.transitions.length === 0) {
      this.pdf.text("No screen transitions.", x + 12, startY + 18, { size: 8, color: C.muted });
      return;
    }
    funnels.transitions.slice(0, 8).forEach((t, i) => {
      const ry = startY + 16 + i * 18;
      if (ry + 14 > y + h - 6) return;
      this.pdf.text(t.from, x + 12, ry, { size: 8, color: C.ink, maxWidth: cols[0]!.width - 10 });
      this.pdf.text(t.to, x + cols[0]!.width + 12, ry, { size: 8, color: C.ink, maxWidth: cols[1]!.width - 10 });
      this.pdf.text(fmt(t.count), x + w - 12, ry, { size: 8, color: C.ink, align: "right" });
    });
  }

  private drawRetention(x: number, y: number, w: number, h: number, retention: Retention): void {
    const chartH = Math.min(90, h * 0.42);
    drawLineChart(this.pdf, x + 12, y + 28, w - 24, chartH, {
      labels: retention.days.map((d) => shortDay(d.date)),
      series: [
        { name: "D1 %", color: C.blue, values: retention.days.map((d) => Math.round(d.rate1d * 100)) },
        { name: "D7 %", color: C.purple, values: retention.days.map((d) => Math.round(d.rate7d * 100)) },
      ],
    });
    const cols = [
      { label: "Date", width: 90, align: "left" as const },
      { label: "Users", width: 80, align: "right" as const },
      { label: "Returned next day", width: 130, align: "right" as const },
      { label: "D1", width: 70, align: "right" as const },
      { label: "Returned in 7d", width: 120, align: "right" as const },
      { label: "D7", width: 70, align: "right" as const },
    ];
    const tableY = y + 32 + chartH;
    this.drawTableHeader(x, tableY, cols);
    const maxRows = Math.max(0, Math.floor((y + h - tableY - 22) / 14));
    [...retention.days]
      .reverse()
      .slice(0, maxRows)
      .forEach((d, i) => {
        const ry = tableY + 16 + i * 14;
        this.pdf.text(d.date, x + 12, ry, { size: 8, color: C.ink });
        this.pdf.text(fmt(d.users), x + 90 + 80, ry, { size: 8, color: C.ink, align: "right" });
        this.pdf.text(fmt(d.returned1d), x + 90 + 80 + 130, ry, { size: 8, color: C.ink, align: "right" });
        this.pdf.text(`${(d.rate1d * 100).toFixed(0)}%`, x + 90 + 80 + 130 + 70, ry, {
          size: 8,
          color: C.ink,
          align: "right",
        });
        this.pdf.text(fmt(d.returned7d), x + 90 + 80 + 130 + 70 + 120, ry, {
          size: 8,
          color: C.ink,
          align: "right",
        });
        this.pdf.text(`${(d.rate7d * 100).toFixed(0)}%`, x + w - 12, ry, { size: 8, color: C.ink, align: "right" });
      });
  }

  private drawTableHeader(
    x: number,
    y: number,
    cols: { label: string; width: number; align?: "left" | "right" }[]
  ): void {
    this.pdf.fill(hexColor("#f4f4f5"));
    this.pdf.rect(x + 1, y, cols.reduce((s, c) => s + c.width, 0) - 2, 14, "f");
    let cx = x;
    for (const col of cols) {
      this.pdf.text(col.label.toUpperCase(), col.align === "right" ? cx + col.width - 12 : cx + 12, y + 3, {
        size: 6.5,
        bold: true,
        color: C.muted,
        align: col.align === "right" ? "right" : "left",
      });
      cx += col.width;
    }
  }
}

function drawSparkline(
  pdf: SimplePdf,
  x: number,
  y: number,
  w: number,
  h: number,
  values: number[],
  color: PdfColor
): void {
  if (values.length < 2) return;
  const max = Math.max(...values, 1);
  const pts = values.map((v, i) => ({
    x: x + (i / (values.length - 1)) * w,
    y: y + h - (v / max) * h,
  }));
  pdf.stroke(color);
  pdf.lineWidth(1.1);
  pdf.polyline(pts);
}

function drawLineChart(
  pdf: SimplePdf,
  x: number,
  y: number,
  w: number,
  h: number,
  input: { labels: string[]; series: { name: string; color: PdfColor; values: number[] }[] }
): void {
  const legendH = 14;
  const plotY = y + legendH;
  const plotH = h - legendH - 14;
  const plotW = w;
  pdf.stroke(C.line);
  pdf.lineWidth(0.4);
  pdf.line(x, plotY + plotH, x + plotW, plotY + plotH);
  const all = input.series.flatMap((s) => s.values);
  const max = Math.max(...all, 1);
  input.series.forEach((s, si) => {
    pdf.fill(s.color);
    pdf.rect(x + si * 88, y, 8, 8, "f");
    pdf.text(s.name, x + si * 88 + 12, y, { size: 7, color: C.muted });
    if (s.values.length < 2) return;
    const pts = s.values.map((v, i) => ({
      x: x + (i / Math.max(s.values.length - 1, 1)) * plotW,
      y: plotY + plotH - (v / max) * plotH,
    }));
    pdf.stroke(s.color);
    pdf.lineWidth(1.4);
    pdf.polyline(pts);
  });
  const labelEvery = Math.max(1, Math.ceil(input.labels.length / 8));
  input.labels.forEach((label, i) => {
    if (i % labelEvery !== 0 && i !== input.labels.length - 1) return;
    const lx = x + (i / Math.max(input.labels.length - 1, 1)) * plotW;
    pdf.text(label, lx, plotY + plotH + 4, { size: 6, color: C.muted, align: "center" });
  });
}

function drawHBars(
  pdf: SimplePdf,
  x: number,
  y: number,
  w: number,
  h: number,
  items: { label: string; value: number; hint?: string; color?: PdfColor }[]
): void {
  if (items.length === 0) {
    pdf.text("No data in this range.", x, y + 8, { size: 8, color: C.muted });
    return;
  }
  const max = Math.max(...items.map((i) => i.value), 1);
  const rowH = Math.min(22, h / items.length);
  items.forEach((item, i) => {
    const ry = y + i * rowH;
    pdf.text(item.label, x, ry, { size: 7.5, color: C.ink, maxWidth: w * 0.42 });
    const barX = x + w * 0.44;
    const barW = w * 0.34;
    pdf.fill(hexColor("#f4f4f5"));
    pdf.rect(barX, ry + 1, barW, 8, "f");
    pdf.fill(item.color ?? C.indigo);
    pdf.rect(barX, ry + 1, Math.max(2, (item.value / max) * barW), 8, "f");
    const hint = item.hint ?? fmt(item.value);
    pdf.text(hint, x + w, ry, { size: 7, color: C.muted, align: "right" });
  });
}

export function fmt(n: number): string {
  return Math.round(n).toLocaleString("en-US");
}

export function fmtDate(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso.slice(0, 10);
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" });
}

function fmtDateShort(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso.slice(0, 10);
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit", timeZone: "UTC" });
}

export function fmtDateTime(d: Date): string {
  return d.toISOString().replace("T", " ").slice(0, 16) + " UTC";
}

export function shortDay(date: string): string {
  const d = new Date(`${date}T12:00:00.000Z`);
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" });
}

export function deltaText(value: number | null): string {
  if (value == null) return "vs prior period";
  const arrow = value > 0 ? "up" : value < 0 ? "down" : "flat";
  return `${arrow} ${Math.abs(value).toFixed(1)}%`;
}

export function formatDuration(ms: number): string {
  if (!Number.isFinite(ms) || ms <= 0) return "0s";
  const s = Math.round(ms / 1000);
  const m = Math.floor(s / 60);
  const h = Math.floor(m / 60);
  if (h > 0) return `${h}h ${m % 60}m`;
  if (m > 0) return `${m}m ${String(s % 60).padStart(2, "0")}s`;
  return `${s}s`;
}
