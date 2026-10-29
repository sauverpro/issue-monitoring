/**
 * Executive & Operational Monitoring Report (portrait, partner-ready).
 *
 * Layout follows the hand-finished July–September 2026 report: dark cover,
 * one-page "Report at a Glance", five short sections and a glossary. Content
 * applies the reviewers' feedback: incomplete requests are split by cause and
 * reliability is judged on server-side failures only; retention and screen-name
 * evidence carry explicit quality caveats; engagement is discounted for retries;
 * one rating vocabulary (Healthy / Watch / Critical) is used everywhere.
 */
import { readFileSync } from "fs";
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
  fmt,
  formatDuration,
  resolveHealth,
  type Behavior,
  type Dashboard,
  type Funnels,
  type Overview,
  type Performance,
  type Problems,
  type ResolvedHealth,
  type Retention,
} from "./monitorReportPdf.js";
import { A4_PORTRAIT, SimplePdf, hexColor, measureText, mixColor, readJpeg, wrapText, type PdfColor, type PdfImage } from "./simplePdf.js";
import { FlowDoc } from "./flowPdf.js";
import { evaluateProjectFunnels, type FunnelResult } from "./featureFunnels.js";
import { getFeedbackSummary, getReleaseSummary, type FeedbackSummary, type ReleaseSummary } from "./productOps.js";
import { getIncidentReport, getPaymentsReport, type IncidentReport, type PaymentsReport } from "./reliability.js";
import { DEFAULT_TARGETS, getReliabilityTargets, targetFor, verdict, type ReliabilityTargets } from "./reliabilityTargets.js";
import {
  SCREEN_FLAG_LABEL,
  assessRetention,
  causeOf,
  flagScreens,
  getReportQuality,
  isLoginLoop,
  type FailureCause,
  type ReportQuality,
  type ServiceStats,
} from "./reportQuality.js";

// ---------------------------------------------------------------------------
// Look & feel
// ---------------------------------------------------------------------------

const MARGIN = 48;
const CONTENT_TOP = 94;
const CONTENT_BOTTOM = 776;
const RADIUS = 6;

/** Brand colour for accents, charts and the cover: REPORT_BRAND_COLOR=#2563eb */
function envColor(name: string, fallback: string): PdfColor {
  const v = process.env[name]?.trim() ?? "";
  return /^#?[0-9a-f]{6}$/i.test(v) ? hexColor(v.startsWith("#") ? v : `#${v}`) : hexColor(fallback);
}

const WHITE = hexColor("#ffffff");
const BRAND = envColor("REPORT_BRAND_COLOR", "#2563eb");
const NAVY = hexColor("#0f1f3d");
const COVER_BG = hexColor("#0b1222");
const COVER_END = mixColor(BRAND, COVER_BG, 0.72);
const BLUE = BRAND;
const INK = hexColor("#1e293b");
const MUTED = hexColor("#64748b");
const LINE = hexColor("#e2e8f0");
const SURFACE = hexColor("#f1f5f9");
const CARD = hexColor("#f8fafc");

const TONE = {
  critical: { color: hexColor("#dc2626"), bg: hexColor("#fef2f2") },
  warning: { color: hexColor("#b45309"), bg: hexColor("#fff7e6") },
  healthy: { color: hexColor("#047857"), bg: hexColor("#ecfdf5") },
  info: { color: BRAND, bg: mixColor(BRAND, WHITE, 0.92) },
  neutral: { color: hexColor("#475569"), bg: SURFACE },
};
type ToneKey = keyof typeof TONE;

const THEME = {
  ink: INK,
  muted: MUTED,
  line: LINE,
  accent: BLUE,
  tableHeaderBg: SURFACE,
  tableHeaderText: hexColor("#475569"),
  stripe: hexColor("#fafbfd"),
  radius: RADIUS,
  headerTracking: 0.3,
};

/** Running header/footer text, updated as sections start. */
const chrome = { section: "", footer: "" };

/** Optional partner logo strip (JPEG) for the page header: REPORT_HEADER_LOGO=/path/logos.jpg */
function headerLogo(): PdfImage | null {
  const p = process.env.REPORT_HEADER_LOGO?.trim();
  if (!p) return null;
  try {
    return readJpeg(readFileSync(p));
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// Formatting
// ---------------------------------------------------------------------------

const TZ = "Africa/Kigali";
const pct = (v: number, digits = 1) => `${(v * 100).toFixed(digits)}%`;
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const dayIso = (date: string) => {
  const d = new Date(`${date}T12:00:00Z`);
  return `${MONTHS[d.getUTCMonth()]} ${d.getUTCDate()}`;
};

function seconds(ms: number): string {
  if (ms >= 3_600_000) return `${(ms / 3_600_000).toFixed(1)} h`;
  if (ms >= 1000) return `${(ms / 1000).toFixed(1)} s`;
  return `${Math.round(ms)} ms`;
}

function minutes(m: number | null): string {
  if (m == null) return "-";
  if (m < 1) return "<1 min";
  if (m < 120) return `${Math.round(m)} min`;
  if (m < 48 * 60) return `${(m / 60).toFixed(1)} h`;
  return `${(m / 1440).toFixed(1)} days`;
}

/** "July - September 2026" for whole calendar months (Kigali time), otherwise exact dates. */
export function periodLabel(range: { from: string; to: string }): string {
  const opts = (o: Intl.DateTimeFormatOptions): Intl.DateTimeFormatOptions => ({ ...o, timeZone: TZ });
  const from = new Date(range.from);
  const to = new Date(range.to);
  const fromDay = Number(from.toLocaleString("en-GB", opts({ day: "numeric" })));
  const toNextDay = Number(new Date(to.getTime() + 60_000).toLocaleString("en-GB", opts({ day: "numeric" })));
  const month = (d: Date) => d.toLocaleString("en-GB", opts({ month: "long" }));
  const year = (d: Date) => d.toLocaleString("en-GB", opts({ year: "numeric" }));
  if (fromDay === 1 && toNextDay === 1) {
    const sameYear = year(from) === year(to);
    if (month(from) === month(to) && sameYear) return `${month(from)} ${year(from)}`;
    return sameYear ? `${month(from)} - ${month(to)} ${year(to)}` : `${month(from)} ${year(from)} - ${month(to)} ${year(to)}`;
  }
  const full = (d: Date) => d.toLocaleDateString("en-GB", opts({ day: "numeric", month: "short", year: "numeric" }));
  return `${full(from)} - ${full(to)}`;
}

// ---------------------------------------------------------------------------
// Ratings: one vocabulary for scorecard, glance cards and success criteria
// ---------------------------------------------------------------------------

type Rating = { label: "Healthy" | "Watch" | "Critical" | "Context"; tone: ToneKey };
type MetricKey = "availability" | "serviceFailure" | "clientRejection" | "loginFailure" | "avgLatency" | "p95" | "p99";

const RATING: Record<MetricKey, { watch: number; critical: number; higherIsBetter?: boolean; healthy: string; watchT: string }> = {
  availability: { watch: 0.995, critical: 0.97, higherIsBetter: true, healthy: ">= 99.5%", watchT: ">= 97%" },
  serviceFailure: { watch: 0.01, critical: 0.05, healthy: "< 1%", watchT: "< 5%" },
  clientRejection: { watch: 0.05, critical: 0.15, healthy: "< 5%", watchT: "< 15%" },
  loginFailure: { watch: 0.15, critical: 0.35, healthy: "< 15% of attempts", watchT: "< 35% of attempts" },
  avgLatency: { watch: 300, critical: 800, healthy: "< 300 ms", watchT: "< 800 ms" },
  p95: { watch: 800, critical: 1500, healthy: "< 0.8 s", watchT: "< 1.5 s" },
  p99: { watch: 1500, critical: 3000, healthy: "< 1.5 s", watchT: "< 3 s" },
};

const CONTEXT: Rating = { label: "Context", tone: "neutral" };

function rate(key: MetricKey, v: number): Rating {
  const r = RATING[key];
  const bad = r.higherIsBetter ? v < r.critical : v > r.critical;
  const watch = r.higherIsBetter ? v < r.watch : v > r.watch;
  if (bad) return { label: "Critical", tone: "critical" };
  if (watch) return { label: "Watch", tone: "warning" };
  return { label: "Healthy", tone: "healthy" };
}

/**
 * Targets for the report being rendered. Set once at the start of the (synchronous)
 * render so every helper judges availability against the project's stage targets.
 */
let T: ReliabilityTargets = DEFAULT_TARGETS;

const isOwn = (service: string) => T.coreServices.includes(service.toUpperCase());

/** Healthy = meets the target, Watch = within 2 points, Critical = further below. */
function rateAgainst(value: number, target: number): Rating {
  const v = verdict(value, target);
  if (v === "on") return { label: "Healthy", tone: "healthy" };
  if (v === "near") return { label: "Watch", tone: "warning" };
  return { label: "Critical", tone: "critical" };
}

const phase = () => T.phase.toLowerCase();

function nextTarget(key: MetricKey, v: number): string {
  const label = rate(key, v).label;
  if (label === "Critical") return `Move to Watch: ${RATING[key].watchT}`;
  if (label === "Watch") return `Move to Healthy: ${RATING[key].healthy}`;
  return `Hold at Healthy: ${RATING[key].healthy}`;
}

/** Prior-period changes are only reported when the prior window had comparable data. */
function comparable(k: { value: number; previous: number; delta: number | null }): number | null {
  if (k.delta == null || k.previous <= 0 || k.previous < k.value * 0.1 || Math.abs(k.delta) > 500) return null;
  return k.delta;
}

function changeText(k: { value: number; previous: number; delta: number | null }): string {
  const d = comparable(k);
  if (d == null) return "No comparable prior data";
  if (Math.abs(d) < 5) return "Stable vs prior period";
  return `${d > 0 ? "Up" : "Down"} ${Math.abs(d).toFixed(0)}% vs prior period`;
}

// ---------------------------------------------------------------------------
// Plain-language service names
// ---------------------------------------------------------------------------

const MOCK_PATH = /(mock|sandbox|staging)/i;

const SERVICE_NAMES: [RegExp, string | ((method: string) => string)][] = [
  [/getcustomertransactions/i, "Customer transactions"],
  [/accounts\/info\/balance/i, "Agency account balance"],
  [/stock-orders\/preview/i, "Stock order preview"],
  [/stock-orders\/[^/]+\/products\/[^/]+\/received/i, "Stock item received"],
  [/stock-orders\/[^/]+\/received/i, "Stock order delivery"],
  [/stock-orders\/?$/i, (m) => (m === "POST" ? "Place stock order" : "Stock orders list")],
  [/auth\/login|\/login$/i, "User login"],
  [/oauth2\/token/i, "Payment provider token"],
  [/intelligrapi\/authenticate/i, "Intelligra sign-in"],
  [/dcc\/stock/i, "Agent stock"],
  [/dcc\/sales/i, "Agent sales"],
  [/users\/me\/integration/i, "User integration"],
  [/communications\/[^/]+\/read/i, "Mark message read"],
  [/communications/i, "Communications"],
  [/coupon-codes/i, "Coupon codes"],
  [/vouchers\/request/i, "Voucher requests"],
  [/agent-merchants/i, "Agent merchants list"],
  [/loan-charges/i, "Loan charges"],
  [/wallet\/history/i, "Wallet history"],
  [/wallet\/balance/i, "Wallet balance"],
  [/\/wallet/i, "Wallet"],
  [/transfer\/validatesend/i, "Transfer validation"],
  [/\/transfer\/?$/i, "Money transfer"],
  [/validate\/biller/i, "Biller validation"],
  [/bill-payment/i, "Bill payment"],
  [/contracts/i, "Contracts"],
  [/kyc\/reset-pin/i, "PIN reset"],
];

/** Friendly name for an endpoint, e.g. "Customer transactions"; mock endpoints are marked. */
export function serviceName(method: string, path: string): string {
  const m = method.toUpperCase();
  let name: string | null = null;
  for (const [re, label] of SERVICE_NAMES) {
    if (re.test(path)) {
      name = typeof label === "function" ? label(m) : label;
      break;
    }
  }
  if (!name) {
    const parts = path
      .split("?")[0]!
      .split("/")
      .filter((p) => p && !/^(api|v\d+|mine|all|\{id\}|<id>)$/i.test(p) && !ID_SEGMENT.test(p) && !/^\d+$/.test(p));
    const words = parts.slice(-2).join(" ").replace(/[-_]+/g, " ").trim();
    name = words ? words.charAt(0).toUpperCase() + words.slice(1) : path;
  }
  return MOCK_PATH.test(path) ? `${name} (mock)` : name;
}

/** An id-like path segment: long alphanumeric with at least one digit (cuid, uuid, numeric). */
const ID_SEGMENT = /^(?=[a-z]*\d)[0-9a-z-]{20,}$/i;

function collapseIds(path: string): string {
  return path
    .split("/")
    .map((seg) => (seg === "{id}" || ID_SEGMENT.test(seg) || /^\d{3,}$/.test(seg) ? "<ID>" : seg))
    .join("/");
}

/** Display path with ids collapsed to <ID>. */
function displayPath(method: string, path: string): string {
  return `${method.toUpperCase()} ${collapseIds(path)}`;
}

function displayScreen(screen: string): string {
  if (!screen) return "(unknown)";
  if (screen === "/") return "/ (home)";
  return collapseIds(screen);
}

function shortScreen(screen: string): string {
  const s = displayScreen(screen)
    .replace(/^\/ \(home\)$/, "Home")
    .replace(/^DCC Dashboard Access$/i, "Dashboard")
    .replace(/^Login Screen Setup$/i, "Login Setup")
    .replace(/^Login Screen$/i, "Login");
  if (!s.startsWith("/")) return s;
  const w = s.slice(1).split("/")[0]!.replace(/-/g, " ");
  return w ? w.replace(/\b\w/g, (c) => c.toUpperCase()) : "Home";
}

// ---------------------------------------------------------------------------
// Cause helpers
// ---------------------------------------------------------------------------

const CAUSE_SHORT: Record<FailureCause, string> = {
  auth: "Auth / session",
  client: "Client / input",
  server: "Server (5xx)",
  network: "No response",
  unclassified: "No status",
};

const CAUSE_TONE: Record<FailureCause, ToneKey> = {
  auth: "warning",
  client: "warning",
  server: "critical",
  network: "critical",
  unclassified: "neutral",
};

function causeCount(q: ReportQuality, c: FailureCause): number {
  return q.causes.find((x) => x.cause === c)?.count ?? 0;
}

// ---------------------------------------------------------------------------
// Services
// ---------------------------------------------------------------------------

const SERVICE_SHORT: Record<string, string> = {
  KORALINK: "KoraLink core API",
  MVEND: "MVEND payments",
  DDIN: "DDIN",
  INTEGRA: "Intelligra",
  RESOLVEIT: "ResolveIt",
};
/** Services run by the KoraLink team; everything else is a third-party provider. */


const svcName = (code: string) => SERVICE_SHORT[code] ?? code;
/** Compact names for table columns. */
const SERVICE_COL: Record<string, string> = { KORALINK: "KoraLink", MVEND: "MVEND", DDIN: "DDIN", INTEGRA: "Intelligra", RESOLVEIT: "ResolveIt" };

/** Real services (no catch-all bucket), busiest first. */
function realServices(q?: ReportQuality): ServiceStats[] {
  return (q?.byService ?? []).filter((s) => s.service !== "CUSTOM" && s.requests > 0);
}

/** The service behind most service-side failures, if it clearly dominates (>= 30%). */
function failureDriver(q?: ReportQuality): { stats: ServiceStats; share: number } | null {
  const rows = realServices(q);
  const total = rows.reduce((n, r) => n + r.serviceFailures, 0);
  if (!total) return null;
  const top = [...rows].sort((a, b) => b.serviceFailures - a.serviceFailures)[0]!;
  const share = top.serviceFailures / total;
  return share >= 0.3 ? { stats: top, share } : null;
}

/** Lowest request success among real services. */
function weakestService(q?: ReportQuality): ServiceStats | null {
  const rows = realServices(q).filter((r) => r.requests >= 50);
  return rows.length ? [...rows].sort((a, b) => a.availability - b.availability)[0]! : null;
}

/** "By volume X; by rate Y" in one or two sentences. */
function driverSentence(q?: ReportQuality): string {
  const rows = realServices(q);
  const totalReq = rows.reduce((n, r) => n + r.requests, 0);
  const driver = failureDriver(q);
  const weakest = weakestService(q);
  const parts: string[] = [];
  if (driver && totalReq) {
    parts.push(
      `By volume, ${pct(driver.share, 0)} of service failures were on the ${svcName(driver.stats.service)}, which carries ${pct(driver.stats.requests / totalReq, 0)} of traffic and answered ${pct(driver.stats.availability)} of its requests.`
    );
  }
  if (weakest && (!driver || weakest.service !== driver.stats.service)) {
    parts.push(
      `By rate, ${svcName(weakest.service)}${isOwn(weakest.service) ? "" : " (third party)"} is the weakest: ${pct(1 - weakest.availability, 0)} of its calls failed.`
    );
  }
  return parts.join(" ");
}

// ---------------------------------------------------------------------------
// Overall status
// ---------------------------------------------------------------------------

type Status = { label: "ON TARGET" | "NEAR TARGET" | "BELOW TARGET"; detail: string; tone: ToneKey };

/** Overall status = server-side availability against the project's stage target. */
function overallStatus(health: ResolvedHealth, q?: ReportQuality): Status {
  const availability = q ? q.serviceAvailability : health.availability;
  const detail = `${pct(availability, 2)} vs ${phase()} target ${pct(T.overall, 0)}`;
  const v = verdict(availability, T.overall);
  if (v === "on") return { label: "ON TARGET", detail, tone: "healthy" };
  if (v === "near") return { label: "NEAR TARGET", detail, tone: "warning" };
  return { label: "BELOW TARGET", detail, tone: "critical" };
}

// ---------------------------------------------------------------------------
// Page chrome and drawing components
// ---------------------------------------------------------------------------

/** Small rounded-square "K" mark used on the cover and in the page header. */
function brandMark(pdf: SimplePdf, x: number, y: number, size: number, bg: PdfColor, fg: PdfColor): void {
  pdf.fill(bg);
  pdf.roundRect(x, y, size, size, size * 0.28, "f");
  pdf.text("K", x + size / 2, y + size * 0.2, { size: size * 0.62, bold: true, color: fg, align: "center" });
}

/** Rounded status pill; returns its width. `align: "right"` treats x as the right edge. */
function pill(
  pdf: SimplePdf,
  label: string,
  x: number,
  y: number,
  colors: { bg: PdfColor; color: PdfColor },
  opts: { size?: number; align?: "left" | "right" } = {}
): number {
  const size = opts.size ?? 7;
  // measureText's average width runs narrow for capitals and digits in bold.
  const w = measureText(label, size, true, 0.3) * 1.18 + 14;
  const h = size + 7;
  const px = opts.align === "right" ? x - w : x;
  pdf.fill(colors.bg);
  pdf.roundRect(px, y, w, h, h / 2, "f");
  pdf.text(label, px + w / 2, y + 3.4, { size, bold: true, color: colors.color, align: "center", tracking: 0.3 });
  return w;
}

/** Rounded tinted panel with a thin coloured strip on its left edge. */
function accentPanel(pdf: SimplePdf, x: number, y: number, w: number, h: number, tone: ToneKey): void {
  pdf.fill(TONE[tone].bg);
  pdf.roundRect(x, y, w, h, RADIUS, "f");
  pdf.fill(TONE[tone].color);
  pdf.roundRect(x, y, RADIUS * 2, h, RADIUS, "f", "left");
  pdf.fill(TONE[tone].bg);
  pdf.rect(x + 3.5, y, RADIUS * 2 - 2.5, h, "f");
}

/** White rounded card with a hairline border. */
function whiteCard(pdf: SimplePdf, x: number, y: number, w: number, h: number): void {
  pdf.fill(WHITE);
  pdf.stroke(LINE);
  pdf.lineWidth(0.7);
  pdf.roundRect(x, y, w, h, RADIUS, "B");
}

type CoverKpi = { label: string; value: string };

function drawCover(pdf: SimplePdf, projectName: string, period: string, status: Status, kpis: CoverKpi[]): void {
  const { w, h } = pdf;
  // Vertical gradient from deep navy into a dark tint of the brand colour.
  const steps = 60;
  for (let i = 0; i < steps; i++) {
    pdf.fill(mixColor(COVER_BG, COVER_END, i / (steps - 1)));
    pdf.rect(0, (h * i) / steps, w, h / steps + 1, "f");
  }
  // Soft concentric rings in the top-right corner.
  [
    [250, 0.1],
    [190, 0.16],
    [130, 0.24],
  ].forEach(([r, t]) => {
    pdf.fill(mixColor(COVER_BG, BRAND, t!));
    pdf.circle(w + 20, 70, r!, "f");
  });
  pdf.fill(mixColor(COVER_END, BRAND, 0.12));
  pdf.circle(-40, h - 70, 170, "f");

  const left = 64;
  const light = hexColor("#cbd5e1");
  const faint = hexColor("#94a3b8");
  const brandLight = mixColor(BRAND, WHITE, 0.45);
  brandMark(pdf, left, 72, 30, BRAND, WHITE);
  pdf.text("KORALINK MONITOR", left + 42, 75, { size: 12, bold: true, color: WHITE, tracking: 1.6 });
  pdf.text("APPLICATION OBSERVABILITY", left + 42, 92, { size: 7, color: faint, tracking: 1.2 });

  let y = 262;
  pdf.text(projectName.toUpperCase(), left, y, { size: 9, bold: true, color: brandLight, tracking: 1.8 });
  y += 24;
  for (const line of ["Executive &", "Operational", "Monitoring Report"]) {
    pdf.text(line, left, y, { size: 36, bold: true, color: WHITE });
    y += 44;
  }
  y += 14;
  pdf.fill(BRAND);
  pdf.roundRect(left, y, 64, 4, 2, "f");
  y += 24;
  pdf.text("REPORTING PERIOD", left, y, { size: 7, bold: true, color: faint, tracking: 1.2 });
  y += 13;
  pdf.text(period, left, y, { size: 13, color: WHITE });

  y += 54;
  pdf.text("OVERALL STATUS", left, y, { size: 7, bold: true, color: faint, tracking: 1.2 });
  y += 14;
  const toneLight =
    status.tone === "critical" ? hexColor("#f87171") : status.tone === "warning" ? hexColor("#fbbf24") : hexColor("#34d399");
  const pw = pill(pdf, status.label, left, y, { bg: toneLight, color: COVER_BG }, { size: 9 });
  pdf.text(status.detail, left + pw + 12, y + 3, { size: 10.5, color: light, maxWidth: w - left - pw - 80 });

  // KPI strip
  if (kpis.length) {
    const sy = h - 228;
    const sw = w - left * 2;
    pdf.fill(mixColor(COVER_END, WHITE, 0.07));
    pdf.roundRect(left, sy, sw, 74, 10, "f");
    const cwid = sw / kpis.length;
    kpis.forEach((k, i) => {
      const x = left + i * cwid;
      if (i > 0) {
        pdf.stroke(mixColor(COVER_END, WHITE, 0.18));
        pdf.lineWidth(0.6);
        pdf.line(x, sy + 16, x, sy + 58);
      }
      pdf.text(k.label.toUpperCase(), x + 18, sy + 18, { size: 6.5, bold: true, color: faint, tracking: 0.8, maxWidth: cwid - 26 });
      pdf.text(k.value, x + 18, sy + 34, { size: 18, bold: true, color: WHITE, maxWidth: cwid - 26 });
    });
  }

  pdf.text("Prepared by Koralink Monitor", left, h - 110, { size: 9, color: light });
  pdf.text("Figures are generated from production telemetry; test and mock traffic is excluded.", left, h - 96, { size: 7.5, color: faint });
  pdf.fill(BRAND);
  pdf.rect(0, h - 6, w, 6, "f");
}

function paintPage(pdf: SimplePdf, logo: PdfImage | null): void {
  pdf.fill(WHITE);
  pdf.rect(0, 0, pdf.w, pdf.h, "f");
  if (logo) {
    pdf.image(logo, MARGIN, 22, pdf.w - MARGIN * 2, 40);
  } else {
    brandMark(pdf, MARGIN, 32, 20, BRAND, WHITE);
    pdf.text("KORALINK MONITOR", MARGIN + 28, 34, { size: 8, bold: true, color: NAVY, tracking: 1.1 });
    pdf.text("Executive & Operational Report", MARGIN + 28, 45, { size: 7, color: MUTED });
    if (chrome.section) pdf.text(chrome.section, pdf.w - MARGIN, 39, { size: 7.5, bold: true, color: MUTED, align: "right", maxWidth: 260 });
  }
  pdf.stroke(LINE);
  pdf.lineWidth(0.7);
  pdf.line(MARGIN, 68, pdf.w - MARGIN, 68);
}

function paintFooter(pdf: SimplePdf, pageIndex: number, pageCount: number): void {
  if (pageIndex === 0) return;
  const y = pdf.h - 42;
  pdf.stroke(LINE);
  pdf.lineWidth(0.7);
  pdf.line(MARGIN, y - 12, pdf.w - MARGIN, y - 12);
  pdf.text(chrome.footer, MARGIN, y, { size: 7, color: MUTED, maxWidth: pdf.w - MARGIN * 2 - 80 });
  pill(pdf, `${pageIndex + 1} / ${pageCount}`, pdf.w - MARGIN, y - 3.5, { bg: SURFACE, color: NAVY }, { align: "right" });
}

/**
 * Section opener (fresh page by default): a "SECTION 0N" eyebrow, a large title
 * and a short accent bar. The full title also runs in the page header.
 */
function sectionTitle(doc: FlowDoc, title: string, subtitle?: string, newPage = true): void {
  const m = /^(\d+)\.\s+(.*)$/.exec(title);
  const appendix = /^Appendix\b/i.exec(title);
  const eyebrow = m ? `SECTION ${m[1]!.padStart(2, "0")}` : appendix ? "APPENDIX" : "OVERVIEW";
  const name = m ? m[2]! : title.replace(/^Appendix [A-Z]:\s*/i, "");
  chrome.section = title;
  if (newPage) doc.newPage();
  const y = doc.cursorY;
  doc.pdf.fill(BRAND);
  doc.pdf.roundRect(MARGIN, y + 2.5, 16, 3, 1.5, "f");
  doc.pdf.text(eyebrow, MARGIN + 22, y, { size: 7.5, bold: true, color: BRAND, tracking: 1.4 });
  doc.pdf.text(name, MARGIN, y + 14, { size: 21, bold: true, color: NAVY });
  doc.spacer(subtitle ? 46 : 50);
  if (subtitle) {
    doc.pdf.text(subtitle, MARGIN, doc.cursorY, { size: 9.5, color: MUTED });
    doc.spacer(24);
  }
}

function subTitle(doc: FlowDoc, title: string, keepWith = 70): void {
  doc.spacer(4);
  doc.ensureSpace(keepWith);
  const y = doc.cursorY;
  doc.pdf.fill(BRAND);
  doc.pdf.roundRect(MARGIN, y + 0.5, 3, 12, 1.5, "f");
  doc.pdf.text(title, MARGIN + 10, y, { size: 11.5, bold: true, color: NAVY });
  doc.spacer(21);
}

type Card = { label: string; value: string; sub?: string; tone?: ToneKey; valueColor?: PdfColor };

/** Row of KPI cards: white, rounded, with a coloured top edge and status dot (one tone per card, or one for the row). */
function cardRow(doc: FlowDoc, cards: Card[], ruleTones: ToneKey[] | ToneKey = "info", valueSize = 19): void {
  const gap = 10;
  const h = 76;
  doc.ensureSpace(h + 12);
  const y = doc.cursorY;
  const cw = (doc.contentWidth - gap * (cards.length - 1)) / cards.length;
  cards.forEach((c, i) => {
    const x = MARGIN + i * (cw + gap);
    const tone = Array.isArray(ruleTones) ? (ruleTones[i] ?? "info") : ruleTones;
    const accent = TONE[tone].color;
    doc.pdf.fill(accent);
    doc.pdf.roundRect(x, y, cw, h, RADIUS, "f");
    doc.pdf.fill(WHITE);
    doc.pdf.roundRect(x, y + 3, cw, h - 3, RADIUS, "f", "bottom");
    doc.pdf.stroke(LINE);
    doc.pdf.lineWidth(0.7);
    doc.pdf.roundRect(x, y + 3, cw, h - 3, RADIUS, "S", "bottom");
    doc.pdf.fill(accent);
    doc.pdf.circle(x + 13, y + 17, 2.4, "f");
    doc.pdf.text(c.label.toUpperCase(), x + 20, y + 14, { size: 6.6, bold: true, color: MUTED, maxWidth: cw - 28, tracking: 0.4 });
    doc.pdf.text(c.value, x + 11, y + 28, {
      size: valueSize,
      bold: true,
      color: c.valueColor ?? (c.tone ? TONE[c.tone].color : NAVY),
      maxWidth: cw - 18,
    });
    if (c.sub) doc.pdf.text(c.sub, x + 11, y + 56, { size: 7.3, color: MUTED, maxWidth: cw - 18 });
  });
  doc.spacer(h + 12);
}

/** Tinted rounded banner with a coloured left strip: a bold title and a short paragraph. */
function banner(doc: FlowDoc, title: string, text: string, tone: ToneKey): void {
  const w = doc.contentWidth;
  const lines = wrapText(text, w - 40, 9.5);
  const h = 34 + lines.length * 14 + 10;
  doc.ensureSpace(h + 12);
  const y = doc.cursorY;
  accentPanel(doc.pdf, MARGIN, y, w, h, tone);
  doc.pdf.text(title, MARGIN + 20, y + 13, { size: 11, bold: true, color: TONE[tone].color, maxWidth: w - 34 });
  lines.forEach((l, i) => doc.pdf.text(l, MARGIN + 20, y + 34 + i * 14, { size: 9.5, color: INK }));
  doc.spacer(h + 14);
}

/** Three cards with tinted headers (going well / needs attention / next). */
function threeColumns(doc: FlowDoc, columns: { title: string; tone: ToneKey; items: string[] }[]): void {
  const gap = 10;
  const cw = (doc.contentWidth - gap * 2) / 3;
  const size = 8.5;
  const lh = 12;
  const headH = 28;
  const wrapped = columns.map((c) => c.items.map((it) => wrapText(it, cw - 32, size)));
  const contentH = Math.max(...wrapped.map((items) => items.reduce((s, l) => s + l.length * lh + 6, 0)));
  const h = headH + 12 + contentH + 8;
  doc.ensureSpace(h + 10);
  const y = doc.cursorY;
  columns.forEach((c, i) => {
    const x = MARGIN + i * (cw + gap);
    whiteCard(doc.pdf, x, y, cw, h);
    doc.pdf.fill(TONE[c.tone].bg);
    doc.pdf.roundRect(x, y, cw, headH, RADIUS, "f", "top");
    doc.pdf.stroke(LINE);
    doc.pdf.lineWidth(0.7);
    doc.pdf.roundRect(x, y, cw, h, RADIUS, "S");
    doc.pdf.fill(TONE[c.tone].color);
    doc.pdf.circle(x + 14, y + headH / 2, 3, "f");
    doc.pdf.text(c.title, x + 23, y + 9, { size: 10, bold: true, color: TONE[c.tone].color, maxWidth: cw - 30 });
    let ly = y + headH + 12;
    wrapped[i]!.forEach((lines) => {
      doc.pdf.fill(TONE[c.tone].color);
      doc.pdf.circle(x + 14, ly + 4, 1.7, "f");
      lines.forEach((l) => {
        doc.pdf.text(l, x + 22, ly, { size, color: INK });
        ly += lh;
      });
      ly += 6;
    });
  });
  doc.spacer(h + 12);
}

function note(doc: FlowDoc, text: string): void {
  doc.para(text, { size: 7.5, color: MUTED, lineHeight: 10.5 });
}

function bullets(doc: FlowDoc, items: string[]): void {
  for (const item of items) {
    const lines = wrapText(item, doc.contentWidth - 18, 9.5);
    doc.ensureSpace(lines.length * 14 + 6);
    doc.pdf.fill(BLUE);
    doc.pdf.circle(MARGIN + 4, doc.cursorY + 5, 2, "f");
    lines.forEach((l) => {
      doc.pdf.text(l, MARGIN + 16, doc.cursorY, { size: 9.5, color: INK });
      doc.spacer(14);
    });
    doc.spacer(4);
  }
  doc.spacer(4);
}

function cols(cw: number, specs: { label: string; frac?: number; align?: "left" | "right" }[]) {
  let used = 0;
  return specs.map((s, i) => {
    const last = i === specs.length - 1;
    const width = last ? cw - used : Math.round(cw * (s.frac ?? 0));
    if (!last) used += width;
    return { label: s.label, width, align: s.align };
  });
}

/** Legend entries (rounded swatch + name), laid out right-to-left from `right`. */
function legend(pdf: SimplePdf, right: number, y: number, entries: { name: string; color: PdfColor }[]): void {
  let lx = right;
  [...entries].reverse().forEach((s) => {
    lx -= measureText(s.name, 7.5) + 24;
    pdf.fill(s.color);
    pdf.roundRect(lx, y, 8, 8, 2, "f");
    pdf.text(s.name, lx + 12, y - 0.5, { size: 7.5, color: INK });
  });
}

/** Grouped vertical bars on a soft panel (e.g. requests vs incomplete per day). */
function barFigure(
  doc: FlowDoc,
  labels: string[],
  series: { name: string; color: PdfColor; values: number[] }[],
  caption: string
): void {
  const h = 190;
  doc.ensureSpace(h + 46);
  doc.spacer(26);
  const y = doc.cursorY;
  const x0 = MARGIN + 44;
  const w = doc.contentWidth - 60;
  const plotH = h - 40;
  doc.pdf.fill(CARD);
  doc.pdf.roundRect(MARGIN, y - 24, doc.contentWidth, plotH + 46, RADIUS + 2, "f");
  const max = Math.max(1, ...series.flatMap((s) => s.values));
  const step = Math.pow(10, Math.floor(Math.log10(max)));
  const top = Math.ceil(max / step) * step;
  for (let i = 0; i <= 4; i++) {
    const v = (top / 4) * i;
    const gy = y + plotH - (v / top) * plotH;
    doc.pdf.stroke(i === 0 ? hexColor("#cbd5e1") : LINE);
    doc.pdf.lineWidth(i === 0 ? 0.8 : 0.5);
    doc.pdf.line(x0, gy, x0 + w, gy);
    doc.pdf.text(fmt(v), x0 - 6, gy - 4, { size: 7, color: MUTED, align: "right" });
  }
  const groupW = w / Math.max(labels.length, 1);
  const barW = Math.min(16, (groupW - 6) / series.length);
  labels.forEach((label, i) => {
    const gx = x0 + i * groupW + (groupW - barW * series.length) / 2;
    series.forEach((s, si) => {
      const v = s.values[i] ?? 0;
      const bh = (v / top) * plotH;
      if (bh <= 0) return;
      doc.pdf.fill(s.color);
      doc.pdf.roundRect(gx + si * barW, y + plotH - bh, barW - 1.5, bh, Math.min(2.5, bh), "f", "top");
    });
    doc.pdf.text(label, x0 + i * groupW + groupW / 2, y + plotH + 6, { size: 7, color: MUTED, align: "center" });
  });
  legend(doc.pdf, x0 + w, y - 14, series);
  doc.spacer(h - 6);
  note(doc, caption);
}

/** Horizontal paired bars (e.g. average vs P95 response time). */
function pairedHBars(doc: FlowDoc, rows: { label: string; a: number; b: number }[], names: [string, string], caption: string): void {
  const rowH = 30;
  const h = rows.length * rowH + 40;
  doc.ensureSpace(h + 30);
  const y = doc.cursorY;
  const labelW = 150;
  const x0 = MARGIN + labelW;
  const w = doc.contentWidth - labelW - 44;
  const max = Math.max(1, ...rows.flatMap((r) => [r.a, r.b]));
  const colA = NAVY;
  const colB = BRAND;
  rows.forEach((r, i) => {
    const ry = y + i * rowH;
    doc.pdf.text(r.label, x0 - 8, ry + 6, { size: 8, color: INK, align: "right", maxWidth: labelW - 10 });
    doc.pdf.fill(SURFACE);
    doc.pdf.roundRect(x0, ry + 2, w, 21, 3, "f");
    doc.pdf.fill(colA);
    doc.pdf.roundRect(x0, ry + 2, Math.max(2, (r.a / max) * w), 10, 2.5, "f");
    doc.pdf.text(seconds(r.a), x0 + (r.a / max) * w + 4, ry + 2.5, { size: 7, color: INK });
    doc.pdf.fill(colB);
    doc.pdf.roundRect(x0, ry + 13, Math.max(2, (r.b / max) * w), 10, 2.5, "f");
    doc.pdf.text(seconds(r.b), x0 + (r.b / max) * w + 4, ry + 14, { size: 7, color: BRAND });
  });
  const ly = y + rows.length * rowH + 6;
  doc.pdf.fill(colA);
  doc.pdf.roundRect(x0, ly, 8, 8, 2, "f");
  doc.pdf.text(names[0], x0 + 12, ly - 0.5, { size: 7.5, color: INK });
  doc.pdf.fill(colB);
  doc.pdf.roundRect(x0 + 140, ly, 8, 8, 2, "f");
  doc.pdf.text(names[1], x0 + 152, ly - 0.5, { size: 7.5, color: INK });
  doc.spacer(h - 6);
  note(doc, caption);
}

// ---------------------------------------------------------------------------
// Data
// ---------------------------------------------------------------------------

export type ProductSection = {
  featureFunnels: { name: string; feature: string; result: FunnelResult }[];
  feedback: FeedbackSummary;
  releases: ReleaseSummary;
};

export type ReliabilitySection = { incidents: IncidentReport; payments: PaymentsReport };

type ReportInput = {
  projectName: string;
  overview: Overview;
  funnels: Funnels;
  retention: Retention;
  dashboard: Dashboard;
  problems: Problems;
  performance: Performance;
  behavior: Behavior;
  product?: ProductSection;
  reliability?: ReliabilitySection;
  quality?: ReportQuality;
  /** Stage targets (pilot by default); availability is judged against these. */
  targets?: ReliabilityTargets;
};

export async function exportExecutiveReportPdf(
  pool: Pool,
  projectId: string,
  projectName: string,
  range: DateRange
): Promise<{ filename: string; buffer: Buffer }> {
  const [overview, funnels, retention, dashboard, problems, performance, behavior, featureFunnels, feedback, releases, incidents, payments, quality] =
    await Promise.all([
      getReportOverview(pool, projectId, range),
      getFunnelReport(pool, projectId, range),
      getReportRetention(pool, projectId, range),
      getProjectDashboard(pool, projectId, range),
      getProjectProblems(pool, projectId, range),
      getProjectPerformance(pool, projectId, range),
      getReportBehavior(pool, projectId, range),
      evaluateProjectFunnels(pool, projectId, range),
      getFeedbackSummary(pool, projectId, range),
      getReleaseSummary(pool, projectId, range),
      getIncidentReport(pool, projectId, range),
      getPaymentsReport(pool, projectId, range),
      getReportQuality(pool, projectId, range),
    ]);
  const targets = await getReliabilityTargets(pool, projectId);
  const buffer = renderExecutiveReportPdf({
    projectName,
    overview,
    funnels,
    retention,
    dashboard,
    problems,
    performance,
    behavior,
    product: { featureFunnels, feedback, releases },
    reliability: { incidents, payments },
    quality,
    targets,
  });
  const stamp = range.from.toISOString().slice(0, 10);
  const slug = projectName.replace(/[^a-zA-Z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 40) || "project";
  return { filename: `monitor-executive-report-${slug}-${stamp}.pdf`, buffer };
}

// ---------------------------------------------------------------------------
// Report
// ---------------------------------------------------------------------------

export function renderExecutiveReportPdf(input: ReportInput): Buffer {
  const { projectName, overview, funnels, retention, dashboard, problems, performance, behavior, product, reliability, quality: q } = input;
  T = input.targets ?? DEFAULT_TARGETS;
  const health = resolveHealth(overview, dashboard);
  const status = overallStatus(health, q);
  const period = periodLabel(overview.range);
  const retentionA = assessRetention(retention.days, new Date(Math.min(Date.now(), Date.parse(overview.range.to) + 8 * 86400_000)));
  const logo = headerLogo();
  const k = overview.kpis;

  const availability = q ? q.serviceAvailability : health.availability;
  const serviceFail = q ? q.serviceFailureRate : health.errorRate;
  const incomplete = q ? q.incomplete : k.errors.value;
  const totalRequests = q ? q.totalRequests : k.apiRequests.value;
  const friction = q ? causeCount(q, "auth") + causeCount(q, "client") : 0;
  const service = q ? causeCount(q, "server") + causeCount(q, "network") : 0;
  const usersAffected = problems.summary.usersAffected;
  const usersShare = k.users.value ? usersAffected / k.users.value : 0;
  const completedShare = q && q.sessionsTotal ? q.sessionsCompletedWork / q.sessionsTotal : null;
  const loginFailShare = q && q.login.attempts ? q.login.failed / q.login.attempts : null;
  const top = problems.errors[0];
  const topCause = top ? causeOf(top.statusCode, top.path, (top.statusCode ?? 0) === 0) : null;
  const slowest = performance.endpoints.find((e) => e.total >= 5) ?? performance.endpoints[0];
  const screens = behavior.screens.length ? behavior.screens : overview.topScreens.map((s) => ({ screen: s.screen, views: s.count, users: 0 }));
  const flags = flagScreens(screens.map((s) => s.screen));
  const unknownViews = screens.filter((s) => !s.screen || /unknown/i.test(s.screen)).reduce((s, x) => s + x.views, 0);
  const loopJourneys = behavior.journeys.filter((j) => isLoginLoop(j.path));
  const ofIncomplete = (n: number, digits = 0) => pct(n / Math.max(incomplete, 1), digits);

  const pdf = new SimplePdf(A4_PORTRAIT);
  drawCover(pdf, projectName, period, status, [
    { label: "Active users", value: fmt(k.users.value) },
    { label: "Service availability", value: pct(availability, 2) },
    { label: "Typical response (P95)", value: seconds(performance.kpis.p95Ms) },
    ...(reliability ? [{ label: "Incidents", value: fmt(reliability.incidents.summary.total) }] : []),
  ]);
  chrome.section = "Report at a Glance";
  chrome.footer = `Executive & Operational Monitoring Report  ·  ${projectName}  ·  ${period}`;
  const doc = new FlowDoc(pdf, {
    marginX: MARGIN,
    contentTop: CONTENT_TOP,
    contentBottom: CONTENT_BOTTOM,
    theme: THEME,
    onNewPage: (p) => paintPage(p, logo),
  });
  const cw = doc.contentWidth;

  // ── Report at a Glance ────────────────────────────────────────────────
  sectionTitle(doc, "Report at a Glance", `${projectName} · ${period}`, false);
  const glanceLead = `${fmt(k.users.value)} agents used the ${projectName} this period and ${pct(availability, 2)} of requests succeeded on the service side (about 1 in ${Math.max(2, Math.round(1 / Math.max(serviceFail, 1e-6)))} failed).`;
  const core = realServices(q).find((r) => isOwn(r.service));
  const meaning = ` The ${phase()} target is ${pct(T.overall, 0)} (core API ${pct(T.core, 0)}, third-party providers ${pct(T.thirdParty, 0)}); the long-term goal is ${pct(T.longTerm, 1)}.`;
  const drivers = driverSentence(q) ? ` ${driverSentence(q)}` : "";
  banner(doc, `Overall status: ${status.label} - ${status.detail}`, glanceLead + meaning + drivers, status.tone);

  subTitle(doc, "Usage", 110);
  cardRow(doc, [
    { label: "Active users", value: fmt(k.users.value), sub: changeText(k.users) },
    { label: "Sessions", value: fmt(k.sessions.value), sub: completedShare != null ? `${pct(completedShare, 0)} completed real work` : changeText(k.sessions) },
    { label: "Actions", value: fmt(k.actions.value), sub: k.sessions.value ? `${(k.actions.value / k.sessions.value).toFixed(2)} per session` : "" },
    { label: "Avg. session", value: formatDuration(k.avgDurationMs.value), sub: k.users.value ? `${(k.sessions.value / k.users.value).toFixed(2)} sessions per user` : "" },
  ]);

  subTitle(doc, "Reliability & performance", 110);
  const availR = rateAgainst(availability, T.overall);
  const p95R = rate("p95", performance.kpis.p95Ms);
  cardRow(
    doc,
    [
      { label: "Service availability", value: pct(availability, 2), sub: `${T.phase} target ${pct(T.overall, 0)} · ${availR.label}`, tone: availR.tone },
      {
        label: "Incomplete requests",
        value: fmt(incomplete),
        sub: q ? `${pct(incomplete / Math.max(totalRequests, 1))} · ${ofIncomplete(friction)} client/login` : `${pct(incomplete / Math.max(totalRequests, 1))} of requests`,
        tone: "warning",
      },
      { label: "Typical response (P95)", value: seconds(performance.kpis.p95Ms), sub: `Avg ${seconds(health.avgLatencyMs)} · ${p95R.label}`, tone: p95R.tone },
      { label: "Users affected", value: fmt(usersAffected), sub: `~${pct(usersShare, 0)} of active users`, tone: "warning" },
    ],
    [availR.tone, "warning", p95R.tone, "warning"]
  );

  const goingWell: string[] = [];
  if (core) {
    goingWell.push(
      verdict(core.availability, T.core) === "on"
        ? `The KoraLink core API met its ${pct(T.core, 0)} target (${pct(core.availability)}).`
        : `The KoraLink core API reached ${pct(core.availability)}, close to its ${pct(T.core, 0)} target.`
    );
  }
  if (q) goingWell.push(`Server (5xx) failures were only ${ofIncomplete(causeCount(q, "server"), 1)} of incomplete requests.`);
  if (problems.priority.critical === 0) goingWell.push("No critical-severity issues were identified.");
  if (reliability && reliability.incidents.summary.total > 0) {
    goingWell.push(`Half of the ${fmt(reliability.incidents.summary.total)} incidents recovered within ${minutes(reliability.incidents.summary.medianResolutionMinutes)}.`);
  }
  if (unknownViews === 0) goingWell.push("Every screen is named in analytics (0 unknown views); some names still need cleanup.");
  if (completedShare != null && completedShare >= 0.5) goingWell.push(`${pct(completedShare, 0)} of sessions completed at least one successful action.`);

  const attention: string[] = [];
  if (availR.label !== "Healthy") attention.push(`Service availability ${pct(availability, 2)} is ${pct(T.overall - availability, 1)} short of the ${phase()} target (${pct(T.overall, 0)}).`);
  const weakest = weakestService(q);
  if (weakest && weakest.availability < 0.9) {
    attention.push(`${svcName(weakest.service)}${isOwn(weakest.service) ? "" : " (third party)"} fails ${pct(1 - weakest.availability, 0)} of its calls.`);
  }
  if (q && loginFailShare != null && q.login.failed > 0) attention.push(`${fmt(q.login.failed)} of ${fmt(q.login.attempts)} login attempts failed (${pct(loginFailShare, 0)}).`);
  if (p95R.label !== "Healthy") attention.push(`1 in 20 requests takes longer than ${seconds(performance.kpis.p95Ms)}.`);
  if (q && q.testTraffic.requests > 0) attention.push(`${fmt(q.testTraffic.requests)} calls went to mock/test endpoints from production.`);
  if (!retentionA.representative) attention.push("Retention cannot yet be measured for the whole period (too few cohorts).");

  const firstAction =
    topCause === "auth"
      ? "fix token refresh and login handling"
      : top && MOCK_PATH.test(top.path)
        ? "remove mock endpoints from the production app"
        : top
          ? `trace the top failing service (${serviceName(top.method, top.path)})`
          : "trace the top failing service";
  threeColumns(doc, [
    { title: "What is going well", tone: "healthy", items: goingWell.slice(0, 4) },
    { title: "What needs attention", tone: "critical", items: attention.slice(0, 4) },
    {
      title: "What happens next",
      tone: "info",
      items: [
        `0-48 hours: ${firstAction}.`,
        "Days 3-14: fix timeouts and retries on unreachable services; speed up the five slowest.",
        "Days 15-30: set per-service targets, clean screen naming, exclude test traffic.",
      ],
    },
  ]);

  // ── Service Health Summary (per service) ──────────────────────────────
  const svcRows = realServices(q).slice(0, 5);
  if (svcRows.length) {
    const incBy = new Map((reliability?.incidents.byService ?? []).map((r) => [r.service, r]));
    sectionTitle(doc, "Service Health Summary", `Each service the ${projectName} depends on · ${period}`);
    cardRow(
      doc,
      svcRows.map((r) => {
        const target = targetFor(T, r.service);
        const t = rateAgainst(r.availability, target);
        return { label: `${svcName(r.service)}${isOwn(r.service) ? "" : " *"}`, value: pct(r.availability, 1), sub: `Target ${pct(target, 0)} · ${t.label}`, tone: t.tone };
      }),
      svcRows.map((r) => rateAgainst(r.availability, targetFor(T, r.service)).tone),
      16
    );
    const incTotals = reliability?.incidents.summary;
    if (incTotals) {
      const sev = incTotals.bySeverity;
      const quarterMin = (Date.parse(overview.range.to) - Date.parse(overview.range.from)) / 60000;
      cardRow(
        doc,
        [
          { label: "Total incidents", value: fmt(incTotals.total), sub: ["P1", "P2", "P3"].map((p) => `${sev[p] ?? 0} ${p}`).join(" · "), tone: incTotals.total ? "critical" : "healthy" },
          { label: "Combined incident time", value: minutes(incTotals.downtimeMinutes), sub: `All services · target < ${minutes(quarterMin * 0.001)} each`, tone: "critical" },
          { label: "Median time to recover", value: minutes(incTotals.medianResolutionMinutes), sub: `90% within ${minutes(incTotals.p90ResolutionMinutes)}`, tone: "info" },
        ],
        [incTotals.total ? "critical" : "healthy", "critical", "info"]
      );
    }

    subTitle(doc, "Full health summary");
    type Cell = { text: string; tone?: ToneKey };
    const latTone = (ms: number | null, good: number, warn: number): ToneKey | undefined =>
      ms == null ? undefined : ms <= good ? "healthy" : ms <= warn ? "warning" : "critical";
    const metricRows: { metric: string; target: string; cell: (r: ServiceStats) => Cell }[] = [
      { metric: "Request success", target: `${pct(T.core, 0)} / ${pct(T.thirdParty, 0)}*`, cell: (r) => ({ text: pct(r.availability, 1), tone: rateAgainst(r.availability, targetFor(T, r.service)).tone }) },
      { metric: "Service failure rate", target: `< ${pct(1 - T.core, 0)} / ${pct(1 - T.thirdParty, 0)}*`, cell: (r) => ({ text: pct(1 - r.availability, 1), tone: rateAgainst(r.availability, targetFor(T, r.service)).tone }) },
      { metric: "Client / login rejections", target: "< 5%", cell: (r) => ({ text: pct(r.clientRejections / Math.max(r.requests, 1), 1), tone: rate("clientRejection", r.clientRejections / Math.max(r.requests, 1)).tone }) },
      { metric: "Requests", target: "-", cell: (r) => ({ text: fmt(r.requests) }) },
      {
        metric: "Uptime (no open incident)",
        target: `${pct(T.core, 0)} / ${pct(T.thirdParty, 0)}*`,
        cell: (r) => {
          const i = incBy.get(r.service);
          return i ? { text: pct(i.availability, 1), tone: rateAgainst(i.availability, targetFor(T, r.service)).tone } : { text: "-" };
        },
      },
      {
        metric: "Incidents (P1 / P2 / P3)",
        target: "0",
        cell: (r) => {
          const i = incBy.get(r.service);
          if (!i) return { text: "-" };
          const b = i.bySeverity;
          return { text: `${i.incidents} (${b.P1 ?? 0}/${b.P2 ?? 0}/${b.P3 ?? 0})`, tone: i.incidents ? "critical" : "healthy" };
        },
      },
      { metric: "Time with open incident", target: "< 2.2 h", cell: (r) => ({ text: minutes(incBy.get(r.service)?.downtimeMinutes ?? null), tone: (incBy.get(r.service)?.downtimeMinutes ?? 0) > 132 ? "critical" : "healthy" }) },
      { metric: "Avg incident duration", target: "< 30 min", cell: (r) => { const m = incBy.get(r.service)?.meanResolutionMinutes ?? null; return { text: minutes(m), tone: m == null ? undefined : m <= 30 ? "healthy" : m <= 120 ? "warning" : "critical" }; } },
      { metric: "Longest single outage", target: "-", cell: (r) => ({ text: minutes(incBy.get(r.service)?.longestMinutes ?? null) }) },
      { metric: "P50 latency (median)", target: "< 500 ms", cell: (r) => ({ text: r.p50Ms == null ? "-" : seconds(r.p50Ms), tone: latTone(r.p50Ms, 500, 1000) }) },
      { metric: "P95 latency", target: "< 0.8 s", cell: (r) => ({ text: r.p95Ms == null ? "-" : seconds(r.p95Ms), tone: latTone(r.p95Ms, 800, 1500) }) },
      { metric: "P99 latency", target: "< 1.5 s", cell: (r) => ({ text: r.p99Ms == null ? "-" : seconds(r.p99Ms), tone: latTone(r.p99Ms, 1500, 3000) }) },
      { metric: "Users affected", target: "-", cell: (r) => ({ text: `${fmt(r.usersAffected)} of ${fmt(r.users)}` }) },
    ];
    const grid = metricRows.map((m) => ({ metric: m.metric, target: m.target, cells: svcRows.map((r) => m.cell(r)) }));
    const metricFrac = 0.27;
    const targetFrac = 0.12;
    const svcFrac = (1 - metricFrac - targetFrac) / svcRows.length;
    doc.table(
      cols(cw, [
        { label: "Metric", frac: metricFrac },
        ...svcRows.map((r) => ({ label: SERVICE_COL[r.service] ?? r.service, frac: svcFrac, align: "right" as const })),
        { label: "Target", align: "right" },
      ]),
      grid.map((g) => [g.metric, ...g.cells.map((c) => c.text), g.target]),
      {
        cellSize: 8,
        boldCell: (_r, ci) => ci === 0,
        textColor: (_r, ci, ri) => {
          if (ci === 0 || ci > svcRows.length) return undefined;
          const t = grid[ri]!.cells[ci - 1]!.tone;
          return t ? TONE[t].color : undefined;
        },
      }
    );
    note(
      doc,
      "* Third-party provider. Request success counts only server failures (5xx) and requests with no response; uptime is the share of time with no open incident on that service. " +
        `Mock/test traffic is excluded. Targets are ${phase()}-phase: core API ${pct(T.core, 0)} / third-party providers ${pct(T.thirdParty, 0)}; long-term goal ${pct(T.longTerm, 1)}.`
    );
    const worst = [...svcRows].sort((a, b) => a.availability - b.availability)[0]!;
    const best = [...svcRows].sort((a, b) => b.availability - a.availability)[0]!;
    doc.para(
      `What this means: ${svcName(worst.service)} is the weakest link at ${pct(worst.availability)} request success` +
        `${isOwn(worst.service) ? "" : " (a third-party provider, so the fix needs the partner and better timeouts/fallbacks in the app)"}. ` +
        `${svcName(best.service)} performs best at ${pct(best.availability)}.` +
        (() => {
          const meeting = svcRows.filter((r) => verdict(r.availability, targetFor(T, r.service)) === "on").map((r) => svcName(r.service));
          return meeting.length
            ? ` Meeting their ${phase()} target: ${meeting.join(", ")}.`
            : ` No service meets its ${phase()} target yet; the closest is ${svcName([...svcRows].sort((a, b) => (b.availability - targetFor(T, b.service)) - (a.availability - targetFor(T, a.service)))[0]!.service)}.`;
        })()
    );
  }

  // ── 1. Executive Summary ──────────────────────────────────────────────
  sectionTitle(doc, "1. Executive Summary");
  doc.para(
    `Over ${period}, the ${projectName} served ${fmt(k.users.value)} active users across ${fmt(k.sessions.value)} sessions and ${fmt(k.actions.value)} recorded actions. ` +
      (comparable(k.sessions) == null ? "The prior period had too little data for a comparison. " : `Usage was ${changeText(k.sessions).toLowerCase()}. `) +
      (completedShare != null ? `These are raw counts that include retries: ${pct(completedShare, 0)} of sessions completed at least one successful non-login request.` : "")
  );
  doc.para(
    q
      ? `${fmt(incomplete)} requests (${pct(incomplete / Math.max(totalRequests, 1))}) did not complete, for different reasons: ${ofIncomplete(friction)} were login, session or input rejections (a product issue, not an outage), ` +
          `${ofIncomplete(causeCount(q, "network"))} got no response, only ${ofIncomplete(causeCount(q, "server"), 1)} were server (5xx) failures, and ${ofIncomplete(causeCount(q, "unclassified"))} had no HTTP status. ` +
          `Counting server failures and no-response only, service availability was ${pct(availability, 2)}: about 1 in ${Math.max(2, Math.round(1 / Math.max(serviceFail, 1e-6)))} requests failed on the service side, against the ${phase()} target of ${pct(T.overall, 0)} (long-term goal ${pct(T.longTerm, 1)}).` +
          (driverSentence(q) ? ` ${driverSentence(q)}` : "") +
          ` Typical (P95) response time was ${seconds(performance.kpis.p95Ms)}; the ${seconds(health.avgLatencyMs)} average is inflated by a few extreme delays.`
      : `Availability was ${pct(availability, 2)} and ${pct(health.errorRate, 2)} of requests ended in an error. Typical (P95) response time was ${seconds(performance.kpis.p95Ms)}.`
  );
  if (top) {
    doc.para(
      `The largest source of incomplete requests is ${serviceName(top.method, top.path)} (${displayPath(top.method, top.path)}): ${fmt(top.occurrences)} occurrences, ${fmt(top.usersAffected)} users` +
        `${topCause ? `, ${CAUSE_SHORT[topCause].toLowerCase()}` : ""}.` +
        (MOCK_PATH.test(top.path) ? " It is a mock endpoint called from production, so this is a configuration problem rather than a real service failure." : "") +
        (slowest ? ` The slowest busy service is ${serviceName(slowest.method, slowest.path)} at ${seconds(slowest.avgLatencyMs)} on average.` : "")
    );
  }

  subTitle(doc, "KPI scorecard");
  const score: { metric: string; result: string; r: Rating; meaning: string }[] = [
    { metric: "Service availability", result: pct(availability, 2), r: availR, meaning: `Not failed on the server side (5xx / no response). ${T.phase} target ${pct(T.overall, 0)}; long-term ${pct(T.longTerm, 1)}.` },
    ...(core ? [{ metric: "KoraLink core API", result: pct(core.availability, 2), r: rateAgainst(core.availability, T.core), meaning: `Your own backend only. ${T.phase} target ${pct(T.core, 0)}.` }] : []),
    {
      metric: "Service failure rate",
      result: q ? `${pct(serviceFail, 2)} (max ${pct(q.serviceFailureRateUpper, 1)})` : pct(serviceFail, 2),
      r: rateAgainst(1 - serviceFail, T.overall),
      meaning: "5xx + no response. The maximum also counts failures with no HTTP status.",
    },
    ...(q
      ? [
          { metric: "Incomplete requests", result: `${fmt(incomplete)} (${pct(incomplete / Math.max(totalRequests, 1))})`, r: CONTEXT, meaning: "All causes, including client and login rejections (Section 3)." },
          { metric: "Client / login rejections", result: pct(q.clientRejectionRate, 2), r: rate("clientRejection", q.clientRejectionRate), meaning: "Requests the API refused: bad credentials, expired tokens, invalid input." },
          ...(loginFailShare != null
            ? [{ metric: "Failed logins", result: `${fmt(q.login.failed)} of ${fmt(q.login.attempts)}`, r: rate("loginFailure", loginFailShare), meaning: `${fmt(q.login.usersFailedRepeatedly)} users failed three or more times.` }]
            : []),
        ]
      : []),
    { metric: "Typical response (P95)", result: seconds(performance.kpis.p95Ms), r: p95R, meaning: "95% of requests answered faster than this." },
    { metric: "Avg. response", result: seconds(health.avgLatencyMs), r: rate("avgLatency", health.avgLatencyMs), meaning: "Inflated by extreme outliers (see Section 4)." },
    { metric: "Active users", result: fmt(k.users.value), r: CONTEXT, meaning: `${changeText(k.users)}.` },
    {
      metric: "Sessions",
      result: fmt(k.sessions.value),
      r: CONTEXT,
      meaning: completedShare != null ? `${pct(completedShare, 0)} completed real work; the rest were retries or browsing.` : `${changeText(k.sessions)}.`,
    },
    { metric: "Users affected", result: fmt(usersAffected), r: CONTEXT, meaning: `Hit at least one incomplete request (~${pct(usersShare, 0)} of active users).` },
  ];
  doc.table(
    cols(cw, [{ label: "Metric", frac: 0.25 }, { label: "Result", frac: 0.2, align: "right" }, { label: "Status", frac: 0.14 }, { label: "What it means" }]),
    score.map((s) => [s.metric, s.result, s.r.label, s.meaning]),
    {
      wrap: true,
      boldCell: (_r, ci) => ci === 0,
      badge: (_r, ci, ri) => (ci === 2 ? TONE[score[ri]!.r.tone] : undefined),
    }
  );
  note(doc, "Ratings use one scale throughout: Healthy, Watch, Critical. \"Context\" rows are for interpretation and are not rated.");

  const mgmtBody = q
    ? status.label === "BELOW TARGET"
      ? `Restore dependable responses from the services that time out or are unreachable first (Section 3). In parallel, fix login and token-refresh handling: ${fmt(friction)} requests were rejected because of the request itself, not because servers failed.`
      : friction > service
        ? `Most incomplete requests were rejected because of the request itself (${fmt(friction)} vs ${fmt(service)} service failures). Fix token refresh, session expiry and input validation in the app before treating this as a capacity problem.`
        : "Service failures outnumber client rejections; prioritise service reachability, timeouts and retries."
    : "Prioritise stabilization of the API layer before adding features.";
  doc.callout("Management interpretation", mgmtBody, { bg: TONE.neutral.bg, accent: NAVY, titleColor: NAVY });

  // ── 2. User Behavior & Engagement ─────────────────────────────────────
  sectionTitle(doc, "2. User Behavior & Engagement");
  doc.para(
    `${fmt(k.users.value)} active users over ${fmt(k.sessions.value)} sessions: ${k.users.value ? (k.sessions.value / k.users.value).toFixed(2) : "0"} sessions per user and ${k.sessions.value ? (k.actions.value / k.sessions.value).toFixed(2) : "0"} actions per session; the average session lasted ${formatDuration(k.avgDurationMs.value)}.` +
      (q
        ? ` Read these as an upper bound: ${fmt(q.retryFailures)} incomplete requests repeated a failed call within two minutes, ${fmt(q.loginLoopSessions)} sessions returned to the login screen at least twice, and ${pct(completedShare ?? 0, 0)} of sessions completed real work.`
        : "")
  );

  subTitle(doc, "Most visited screens");
  doc.table(
    cols(cw, [{ label: "Screen / route", frac: 0.5 }, { label: "Views / events", frac: 0.18, align: "right" }, { label: "Data note" }]),
    screens.slice(0, 7).map((s) => [displayScreen(s.screen), fmt(s.views), (flags.get(s.screen) ?? []).map((f) => SCREEN_FLAG_LABEL[f]).join(", ") || "-"]),
    { boldCell: (_r, ci) => ci === 1, textColor: (row, ci) => (ci === 2 && row[2] !== "-" ? TONE.warning.color : undefined) }
  );

  subTitle(doc, "Common user journeys");
  const journeys = behavior.journeys.slice(0, 5);
  const journeyText = (path: string[]) => {
    const steps = path.map(shortScreen);
    return steps.length > 5 ? `${steps.slice(0, 5).join(" -> ")} ...` : steps.join(" -> ");
  };
  doc.table(
    cols(cw, [{ label: "Journey (sequence of screens)", frac: 0.58 }, { label: "Share", frac: 0.11, align: "right" }, { label: "Sessions", frac: 0.13, align: "right" }, { label: "Note" }]),
    journeys.map((j) => [journeyText(j.path), pct(j.pct), fmt(j.count), isLoginLoop(j.path) ? "Login loop" : "-"]),
    { textColor: (row, ci) => (ci === 3 && row[3] !== "-" ? TONE.warning.color : undefined) }
  );
  note(doc, `Sampled by the monitoring SDK; "..." marks journeys that continue.${loopJourneys.length ? ` ${loopJourneys.length} of these journeys loop back to Login.` : ""} Flagged names and loops usually come from auth redirects or SDK naming, so treat them as indicative.`);

  subTitle(doc, "Key findings");
  const findings: string[] = [];
  const productScreens = screens.filter((s) => !flags.has(s.screen)).slice(0, 3);
  if (productScreens.length) findings.push(`The most-used product screens with clear names are ${productScreens.map((s) => `${displayScreen(s.screen)} (${fmt(s.views)})`).join(", ")}.`);
  if (screens[0] && flags.has(screens[0].screen)) {
    findings.push(`The most-recorded screen, ${displayScreen(screens[0].screen)}, is a generic or sign-in screen: it shows where the app lands, not what agents came to do.`);
  }
  if (funnels.dropoff) {
    findings.push(`Largest drop-off: ${funnels.dropoff.from} to ${funnels.dropoff.to} (${pct(funnels.dropoff.rate, 0)} do not continue).`);
  } else if (q && (q.login.failed > 0 || q.loginLoopSessions > 0)) {
    findings.push(
      `The screen funnel shows no single large drop-off, but it cannot see failed actions: ${fmt(q.login.failed)} failed logins and ${fmt(q.loginLoopSessions)} sessions looping back to Login show where users actually get stuck.`
    );
  }
  findings.push(
    retentionA.d1Rate == null
      ? "Retention could not be measured in this period."
      : retentionA.representative
        ? `Next-day return was ${pct(retentionA.d1Rate)} (user-weighted, ${retentionA.d1Cohorts} daily cohorts, ${fmt(retentionA.d1Users)} users).`
        : `Retention is indicative only (${retentionA.reason}). Across the observed cohorts, next-day return was ${pct(retentionA.d1Rate)}.`
  );
  bullets(doc, findings);

  // A weekly table of unrepresentative numbers invites over-reading; the finding above states the caveat instead.
  const weekly = retentionA.representative ? retentionA.weekly.slice(-6) : [];
  if (weekly.length) subTitle(doc, "Retention by week");
  if (weekly.length) doc.table(
    cols(cw, [{ label: "Week of", frac: 0.22 }, { label: "Users", frac: 0.14, align: "right" }, { label: "Next-day return", frac: 0.2, align: "right" }, { label: "7-day return", frac: 0.18, align: "right" }, { label: "Note" }]),
    weekly.map((w) => [dayIso(w.week), fmt(w.users), w.d1Rate == null ? "-" : pct(w.d1Rate, 0), w.d7Rate == null ? "-" : pct(w.d7Rate, 0), w.small ? "Small sample" : "-"]),
    { textColor: (row, ci) => (ci === 4 && row[4] !== "-" ? TONE.warning.color : undefined) }
  );

  if (product && product.featureFunnels.length) {
    subTitle(doc, "Feature adoption");
    doc.table(
      cols(cw, [{ label: "Business flow", frac: 0.34 }, { label: "Started", frac: 0.13, align: "right" }, { label: "Completed", frac: 0.15, align: "right" }, { label: "Completion", frac: 0.14, align: "right" }, { label: "Biggest drop" }]),
      product.featureFunnels.map((f) => [
        f.name,
        fmt(f.result.started),
        fmt(f.result.completed),
        f.result.started ? pct(f.result.completionRate, 0) : "-",
        f.result.biggestDrop ? `${f.result.biggestDrop.to} (${pct(f.result.biggestDrop.rate, 0)})` : "-",
      ])
    );
  }

  // ── 3. System Health & Incident Analysis ─────────────────────────────
  sectionTitle(doc, "3. System Health & Incident Analysis");
  const active = overview.daily.filter((d) => d.apiRequests > 0 || d.sessions > 0);
  const qDaily = new Map((q?.daily ?? []).map((d) => [d.date, d]));
  const peak = [...active].sort((a, b) => b.apiRequests - a.apiRequests)[0];
  const byDate = [...active].sort((a, b) => a.date.localeCompare(b.date));
  const busy: typeof active = [];
  if (peak) {
    const i0 = byDate.indexOf(peak);
    let lo = i0;
    let hi = i0;
    while (lo > 0 && byDate[lo - 1]!.apiRequests >= peak.apiRequests * 0.5) lo -= 1;
    while (hi < byDate.length - 1 && byDate[hi + 1]!.apiRequests >= peak.apiRequests * 0.5) hi += 1;
    busy.push(...byDate.slice(lo, hi + 1));
  }
  doc.para(
    `Service availability was ${pct(availability, 2)} (${availR.label}).` +
      (peak && busy.length
        ? ` The heaviest load fell on ${busy.length > 1 ? `${dayIso(busy[0]!.date)} - ${dayIso(busy[busy.length - 1]!.date)}` : dayIso(busy[0]!.date)}, peaking at ${fmt(peak.apiRequests)} requests and ${fmt(peak.users)} users a day; ` +
          `incomplete requests rose with load (${fmt(Math.max(...busy.map((d) => d.errors)))} on the worst day) and average response time reached ${seconds(Math.max(...busy.map((d) => d.avgLatencyMs)))}.`
        : "")
  );

  subTitle(doc, "Daily activity and health");
  const dailyRows = [...active].reverse().slice(0, 12);
  doc.table(
    cols(cw, [
      { label: "Date", frac: 0.11 },
      { label: "Users", frac: 0.09, align: "right" },
      { label: "Sessions", frac: 0.11, align: "right" },
      { label: "API requests", frac: 0.14, align: "right" },
      { label: "Incomplete", frac: 0.13, align: "right" },
      { label: "Service fail.", frac: 0.14, align: "right" },
      { label: "Auth rej.", frac: 0.12, align: "right" },
      { label: "Avg. latency", align: "right" },
    ]),
    dailyRows.map((d) => {
      const qd = qDaily.get(d.date);
      return [dayIso(d.date), fmt(d.users), fmt(d.sessions), fmt(d.apiRequests), fmt(d.errors), qd ? fmt(qd.serviceFailures) : "-", qd ? fmt(qd.authFailures) : "-", seconds(d.avgLatencyMs)];
    }),
    {
      cellSize: 8,
      cellColor: (_r, ci, ri) => {
        const d = dailyRows[ri]!;
        const qd = qDaily.get(d.date);
        return ci === 5 && qd && d.apiRequests && qd.serviceFailures / d.apiRequests > 0.05 ? TONE.critical.bg : undefined;
      },
      textColor: (_r, ci, ri) => {
        const d = dailyRows[ri]!;
        if (ci === 7 && d.avgLatencyMs >= 40_000) return TONE.critical.color;
        if (ci === 7 && d.avgLatencyMs >= 20_000) return TONE.warning.color;
        return undefined;
      },
    }
  );
  const fig = [...dailyRows].reverse();
  if (fig.length > 1) {
    barFigure(
      doc,
      fig.map((d) => String(Number(d.date.slice(8, 10)))),
      [
        { name: "API requests", color: hexColor("#bfd3f3"), values: fig.map((d) => d.apiRequests) },
        { name: "Incomplete", color: hexColor("#e8a19a"), values: fig.map((d) => d.errors) },
        ...(q ? [{ name: "Service failures", color: TONE.critical.color, values: fig.map((d) => qDaily.get(d.date)?.serviceFailures ?? 0) }] : []),
      ],
      `Figure 1. API requests, incomplete requests and service failures per day (${dayIso(fig[0]!.date)} - ${dayIso(fig[fig.length - 1]!.date)}).`
    );
  }

  subTitle(doc, "Incomplete requests", 110);
  cardRow(
    doc,
    [
      { label: "Total incomplete requests", value: fmt(incomplete), sub: "In the reporting period", tone: "critical" },
      { label: "Users affected", value: fmt(usersAffected), sub: `~${pct(usersShare, 0)} of active users`, tone: "warning" },
      { label: "Server (5xx) failures", value: fmt(problems.summary.errors5xx), sub: `${ofIncomplete(problems.summary.errors5xx, 1)} of incomplete requests`, tone: "info" },
    ],
    ["critical", "warning", "info"]
  );
  subTitle(doc, "Issues by severity", 110);
  cardRow(
    doc,
    [
      { label: "Critical", value: fmt(problems.priority.critical), sub: problems.priority.critical ? "Act now" : "None identified", tone: problems.priority.critical ? "critical" : "healthy" },
      { label: "High", value: fmt(problems.priority.high), sub: problems.priority.high ? "Priority issues" : "None identified", tone: "critical" },
      { label: "Medium", value: fmt(problems.priority.medium), sub: problems.priority.medium ? "Monitor & schedule" : "None identified", tone: "warning" },
      { label: "Low", value: fmt(problems.priority.low), sub: problems.priority.low ? "Backlog" : "None identified", valueColor: TONE.neutral.color },
    ],
    ["healthy", "critical", "warning", "neutral"]
  );

  if (q) {
    subTitle(doc, "Incomplete requests by cause");
    const causes = q.causes.filter((c) => c.count > 0);
    doc.table(
      cols(cw, [{ label: "Cause", frac: 0.22 }, { label: "Requests", frac: 0.13, align: "right" }, { label: "Share", frac: 0.1, align: "right" }, { label: "What it typically means" }]),
      causes.map((c) => [CAUSE_SHORT[c.cause], fmt(c.count), pct(c.share), c.meaning]),
      {
        wrap: true,
        boldCell: (_r, ci) => ci === 0 || ci === 2,
        textColor: (_r, ci, ri) => (ci === 0 ? TONE[CAUSE_TONE[causes[ri]!.cause]].color : undefined),
      }
    );
    doc.para(
      `${ofIncomplete(friction)} of incomplete requests were rejected because of the request itself and ${ofIncomplete(service)} were service failures, so investigation should cover login, token and input handling as well as timeouts, not only backend capacity. Root causes remain unconfirmed.` +
        (q.testTraffic.requests ? ` ${fmt(q.testTraffic.requests)} requests were test traffic to mock/sandbox endpoints.` : "")
    );
  }

  subTitle(doc, "Top operational issues");
  const issues = problems.errors.slice(0, 10);
  const issueCause = (e: (typeof issues)[number]) => causeOf(e.statusCode, e.path, (e.statusCode ?? 0) === 0);
  doc.table(
    cols(cw, [{ label: "Service", frac: 0.38 }, { label: "Cause", frac: 0.22 }, { label: "Occurrences", frac: 0.13, align: "right" }, { label: "Users", frac: 0.1, align: "right" }, { label: "Severity", align: "right" }]),
    issues.map((e) => [serviceName(e.method, e.path), `${CAUSE_SHORT[issueCause(e)]}${e.statusCode ? ` (${e.statusCode})` : ""}`, fmt(e.occurrences), fmt(e.usersAffected), e.severity.charAt(0).toUpperCase() + e.severity.slice(1)]),
    {
      subline: (ri, ci) => (ci === 0 ? displayPath(issues[ri]!.method, issues[ri]!.path) : undefined),
      boldCell: (_r, ci) => ci === 0 || ci === 2,
      textColor: (_r, ci, ri) => (ci === 1 ? TONE[CAUSE_TONE[issueCause(issues[ri]!)]].color : undefined),
      badge: (_r, ci, ri) => (ci === 4 ? TONE[issues[ri]!.severity === "low" ? "neutral" : issues[ri]!.severity === "medium" ? "warning" : "critical"] : undefined),
    }
  );
  if (top && topCause) {
    const nature: Record<FailureCause, string> = {
      server: "It is a server-side failure and belongs in the reliability workstream.",
      network: "Requests got no response: an unreachable or slow service, or poor connectivity.",
      auth: "It is a login/session rejection, not an outage: check token expiry, refresh and failed-login handling.",
      client: "It is a client-side rejection: the request itself was invalid, so check what the app sends.",
      unclassified: "It failed without an HTTP status, so its cause cannot be determined; improve instrumentation for this call.",
    };
    doc.callout(
      "Primary interpretation",
      `${serviceName(top.method, top.path)} (${displayPath(top.method, top.path)}) is the largest source of incomplete requests: ${fmt(top.occurrences)} occurrences across ${fmt(top.usersAffected)} users. ${nature[topCause]}` +
        (MOCK_PATH.test(top.path) ? " This is a mock endpoint; production builds should not call it." : ""),
      { bg: TONE[CAUSE_TONE[topCause]].bg, accent: TONE[CAUSE_TONE[topCause]].color }
    );
  }

  if (reliability && reliability.incidents.summary.total > 0) {
    const s = reliability.incidents.summary;
    subTitle(doc, "Incidents & resolution");
    doc.para(
      `${fmt(s.total)} incidents were opened on the services this app depends on. Half recovered within ${minutes(s.medianResolutionMinutes)} and 90% within ${minutes(s.p90ResolutionMinutes)} (longest ${minutes(s.longestMinutes)}).` +
        (s.manuallyResolved === 0 ? " All recovered automatically once error rates fell below threshold." : ` ${fmt(s.manuallyResolved)} ${s.manuallyResolved === 1 ? "was" : "were"} closed by an operator.`)
    );
    note(doc, "Per-service incidents, downtime and outage lengths are on the Service Health Summary page.");
    const pay = reliability.payments.channels[0];
    if (pay && pay.successRate != null) {
      const why = pay.failingEndpoints[0];
      note(
        doc,
        `Payments (${pay.label}): ${pct(pay.successRate)} of ${fmt(pay.calls)} calls succeeded; ${fmt(pay.agentsAffected)} agents hit a failure` +
          (why ? `, mostly ${serviceName(why.method, why.path)}${why.topStatus ? ` (HTTP ${why.topStatus})` : ""}.` : ".") +
          (reliability.payments.hasBackup ? "" : " No backup payment channel is configured.")
      );
    }
  }

  // ── 4. API Performance & Technical Assessment ─────────────────────────
  sectionTitle(doc, "4. API Performance & Technical Assessment");
  note(doc, "Average is the mean; P95 and P99 mean that 95% and 99% of requests were faster than the value shown; Max is the single slowest request.");
  doc.para(
    `Average response time was ${seconds(performance.kpis.avgLatencyMs)}, while P95 was ${seconds(performance.kpis.p95Ms)} and P99 ${seconds(performance.kpis.p99Ms)}. ` +
      (performance.kpis.avgLatencyMs > performance.kpis.p95Ms
        ? "An average above the P95 means a few extreme delays pull it up, so P95 is the better measure of what users experience. "
        : "") +
      `${fmt(performance.kpis.slowApis)} services average more than 500 ms.`
  );
  subTitle(doc, "Endpoint performance hotspots");
  const hot = performance.endpoints.filter((e) => e.total >= 5).slice(0, 8);
  const latTone = (ms: number): ToneKey | null => (ms >= 100_000 ? "critical" : ms >= 40_000 ? "warning" : null);
  doc.table(
    cols(cw, [{ label: "Service", frac: 0.38 }, { label: "Requests", frac: 0.12, align: "right" }, { label: "Average", frac: 0.13, align: "right" }, { label: "P95", frac: 0.12, align: "right" }, { label: "P99", frac: 0.12, align: "right" }, { label: "Max", align: "right" }]),
    hot.map((e) => [serviceName(e.method, e.path), fmt(e.total), seconds(e.avgLatencyMs), seconds(e.p95Ms), seconds(e.p99Ms), seconds(e.maxLatencyMs)]),
    {
      subline: (ri, ci) => (ci === 0 ? displayPath(hot[ri]!.method, hot[ri]!.path) : undefined),
      boldCell: (_r, ci) => ci === 0,
      cellColor: (_r, ci, ri) => {
        const t = ci === 2 ? latTone(hot[ri]!.avgLatencyMs) : null;
        return t ? TONE[t].bg : undefined;
      },
      textColor: (_r, ci, ri) => {
        const t = ci === 2 ? latTone(hot[ri]!.avgLatencyMs) : null;
        return t ? TONE[t].color : undefined;
      },
    }
  );
  note(doc, "Red = average >= 100 s; amber = average >= 40 s. Endpoints with fewer than 5 requests are omitted.");
  if (hot.length > 1) {
    pairedHBars(
      doc,
      hot.slice(0, 7).map((e) => ({ label: serviceName(e.method, e.path), a: e.avgLatencyMs, b: e.p95Ms })),
      ["Average response time", "95th percentile (P95)"],
      "Figure 2. Average versus typical (P95) response time for the busiest slow services."
    );
  }
  subTitle(doc, "Technical interpretation");
  doc.para(
    "Root causes are hypotheses until trace-level investigation is done. The pattern fits slow or unreachable upstream services, missing caching, repeated downstream calls and weak timeout/retry behaviour."
  );
  const maxLat = Math.max(0, ...performance.endpoints.map((e) => e.maxLatencyMs));
  if (maxLat > 3_600_000) {
    doc.para(`Some requests reportedly stayed open for ${seconds(maxLat)}. Values like this usually come from instrumentation around aborted requests or missing timeouts and should be confirmed in server logs.`);
  }
  subTitle(doc, "Priority optimization sequence");
  const prio: [string, string, string][] = [];
  if (top) {
    prio.push([
      "P0",
      serviceName(top.method, top.path),
      MOCK_PATH.test(top.path)
        ? `Mock endpoint in production: ${fmt(top.occurrences)} incomplete requests, ${fmt(top.usersAffected)} users. Remove the call.`
        : `Highest failure concentration: ${fmt(top.occurrences)} occurrences / ${fmt(top.usersAffected)} users.`,
    ]);
  }
  if (q && q.login.failed > 0) prio.push(["P0", "Login & token refresh", `${fmt(q.login.failed)} failed logins and ${fmt(causeCount(q, "auth"))} auth/session rejections.`]);
  hot
    .filter((e) => !prio.some((r) => r[1] === serviceName(e.method, e.path)))
    .slice(0, 2)
    .forEach((e) => prio.push(["P1", serviceName(e.method, e.path), `${fmt(e.total)} requests averaging ${seconds(e.avgLatencyMs)}.`]));
  prio.push(["P2", "Telemetry quality", "Clean screen names, mark retries, record the HTTP status on every failure and exclude test traffic."]);
  const prioTone = (p: string): ToneKey => (p === "P0" ? "critical" : p === "P1" ? "warning" : "healthy");
  doc.table(cols(cw, [{ label: "Priority", frac: 0.11 }, { label: "Target", frac: 0.3 }, { label: "Reason" }]), prio, {
    wrap: true,
    boldCell: (_r, ci) => ci === 1,
    badge: (row, ci) => (ci === 0 ? TONE[prioTone(row[0]!)] : undefined),
  });

  // ── 5. Recommendations ────────────────────────────────────────────────
  sectionTitle(doc, "5. Recommendations & 30-Day Plan");
  doc.para("Reduce user-impacting failures first, then latency, then improve telemetry so the next report can explain why, not only what, happened.");
  subTitle(doc, "Immediate actions - 0 to 48 hours");
  const actions: [string, string][] = [];
  if (top && MOCK_PATH.test(top.path)) {
    actions.push(["Remove mock/test endpoints from the production app", `Eliminates ${fmt(q?.testTraffic.requests ?? top.occurrences)} incomplete requests that are configuration noise.`]);
  }
  if (q && (causeCount(q, "auth") > 0 || q.login.failed > 0)) {
    actions.push(["Fix token refresh, session expiry and failed-login handling", `Cuts ${fmt(causeCount(q, "auth"))} auth/session rejections and login loops.`]);
  }
  if (q && causeCount(q, "network") > 0) {
    const net = q.causes.find((c) => c.cause === "network")?.topEndpoints[0];
    actions.push([`Investigate requests with no response${net ? ` (${serviceName(net.method, net.path)})` : ""}`, "Find the unreachable or timing-out service behind most service failures."]);
  }
  if (slowest) actions.push([`Trace ${serviceName(slowest.method, slowest.path)} for latency`, `Find the source of its ${seconds(slowest.avgLatencyMs)} average response time.`]);
  actions.push(["Set request timeouts and bounded retries", "Stops requests staying open for hours and retry storms."]);
  doc.table(cols(cw, [{ label: "Action", frac: 0.5 }, { label: "Expected outcome" }]), actions.slice(0, 4), { wrap: true, boldCell: (_r, ci) => ci === 0 });
  subTitle(doc, "Days 3 to 30");
  bullets(doc, [
    "Days 3-14: speed up the five slowest services (traces, query profiling, caching); record the HTTP status on every failure; mark retries and give each screen one stable name.",
    "Days 15-30: set per-service targets (success rate, P95, timeouts) with alerts, load-test at peak volume, and review each high-severity issue with an owner and root cause.",
  ]);
  if (product && (product.feedback.received > 0 || product.releases.shipped.length > 0)) {
    note(
      doc,
      `Feedback & releases: ${fmt(product.feedback.received)} feedback items received, ${fmt(product.feedback.resolved)} resolved, ${fmt(product.feedback.open)} open; ` +
        `${product.releases.shipped.length} release(s) shipped${product.releases.shipped[0] ? `, latest ${product.releases.shipped[0].version}` : ""}.`
    );
  }

  subTitle(doc, "Success criteria for the next report");
  const crit: { metric: string; current: string; key?: MetricKey; value?: number; target?: string; rating?: Rating }[] = [
    {
      metric: "Service availability",
      current: pct(availability, 2),
      rating: rateAgainst(availability, T.overall),
      target: verdict(availability, T.overall) === "on" ? `Hold, then work toward ${pct(T.longTerm, 1)}` : `Reach ${phase()} target ${pct(T.overall, 0)} (long-term ${pct(T.longTerm, 1)})`,
    },
    ...(core
      ? [
          {
            metric: "KoraLink core API",
            current: pct(core.availability, 2),
            rating: rateAgainst(core.availability, T.core),
            target: verdict(core.availability, T.core) === "on" ? "Hold at target" : `Reach ${pct(T.core, 0)}`,
          },
        ]
      : []),
    ...(q ? [{ metric: "Client / login rejections", current: pct(q.clientRejectionRate, 2), key: "clientRejection" as MetricKey, value: q.clientRejectionRate }] : []),
    ...(loginFailShare != null ? [{ metric: "Failed logins", current: pct(loginFailShare, 0), key: "loginFailure" as MetricKey, value: loginFailShare }] : []),
    { metric: "P95 response time", current: seconds(performance.kpis.p95Ms), key: "p95", value: performance.kpis.p95Ms },
    { metric: "P99 response time", current: seconds(performance.kpis.p99Ms), key: "p99", value: performance.kpis.p99Ms },
    ...(q ? [{ metric: "Mock/test requests", current: fmt(q.testTraffic.requests), target: q.testTraffic.requests ? "Remove at source (0)" : "Hold at 0" }] : []),
    {
      metric: "Retention (next day)",
      current: retentionA.d1Rate == null ? "-" : `${pct(retentionA.d1Rate, 0)}${retentionA.representative ? "" : " (indicative)"}`,
      target: retentionA.representative ? "Set a target from this baseline" : "Collect 4+ full weeks first",
    },
  ];
  const critRating = (c: (typeof crit)[number]) => c.rating ?? (c.key != null && c.value != null ? rate(c.key, c.value) : null);
  doc.table(
    cols(cw, [{ label: "Metric", frac: 0.3 }, { label: "Current", frac: 0.18, align: "right" }, { label: "Rating", frac: 0.13 }, { label: "Target for next cycle" }]),
    crit.map((c) => [c.metric, c.current, critRating(c)?.label ?? "-", c.key != null && c.value != null ? nextTarget(c.key, c.value) : (c.target ?? "-")]),
    {
      boldCell: (_r, ci) => ci === 0,
      badge: (_r, ci, ri) => {
        const r = critRating(crit[ri]!);
        return ci === 2 && r ? TONE[r.tone] : undefined;
      },
    }
  );

  const finalText = q
    ? `Service-side availability was ${pct(availability, 2)} against the ${phase()} target of ${pct(T.overall, 0)} (${status.label.toLowerCase()}).` +
      (core ? ` The KoraLink core API reached ${pct(core.availability)} (target ${pct(T.core, 0)}).` : "") +
      (weakest && !isOwn(weakest.service) && verdict(weakest.availability, T.thirdParty) === "below"
        ? ` ${svcName(weakest.service)} is well below the third-party target (${pct(weakest.availability)} vs ${pct(T.thirdParty, 0)}); raise it with the provider and add fallbacks in the app.`
        : "") +
      ` ${friction > service ? "Most incomplete requests were login, session and input rejections, so the app's sign-in and request handling offer the quickest gains." : "Service failures outnumber client rejections, so reachability and timeouts come first."}` +
      ` This quarter is the baseline; the next report will show progress against it and the long-term goal of ${pct(T.longTerm, 1)}.`
    : "Start with the top failing service, then address the broader set of slow or failing endpoints.";
  doc.callout("Final assessment", finalText, { bg: TONE.neutral.bg, accent: NAVY, titleColor: NAVY });

  // ── Appendix ──────────────────────────────────────────────────────────
  sectionTitle(doc, "Appendix A: Glossary");
  const glossary: [string, string][] = [
    ["Active user", "A unique person who used the app at least once in the period."],
    ["Session", "A single visit to the app."],
    ["Incomplete request", "A request that did not return a successful response, for any reason."],
    ["Service availability", "Share of requests that did not fail on the server side (5xx or no response)."],
    ["Service failure rate", "Share of requests that failed on the server side or got no response."],
    ["Client / login rejection", "The API refused the request itself: wrong credentials, expired token or invalid input (4xx)."],
    ["No response", "The request did not complete: connectivity problems or timeouts."],
    ["P95 / P99", "The response time that 95% / 99% of requests beat; a better guide than the average."],
    ["Retention (next day / 7 days)", "Share of a day's users who returned one / seven days later, weighted by users."],
    ["Login loop", "A journey that returns to the login screen, usually auth redirects or failed sign-in."],
    ["Mock / test endpoint", "A fake service used for testing that production apps should not call."],
    ["Pilot target", "A stage-appropriate goal for an app still in development, shown next to the long-term goal and raised as the app matures."],
    ["Healthy / Watch / Critical", "The single rating scale: meets target / within 2 points / further below."],
  ];
  doc.table(cols(cw, [{ label: "Term", frac: 0.3 }, { label: "Plain-language meaning" }]), glossary, { wrap: true, boldCell: (_r, ci) => ci === 0 });

  return doc.finish(paintFooter);
}
