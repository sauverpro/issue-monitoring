import type { BadgeTone } from "@/org/components/ui";

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

export type FeedbackSummary = {
  received: number;
  resolved: number;
  open: number;
  medianResolutionHours: number | null;
  byFeature: { feature: string; total: number; open: number }[];
  bySource: { source: string; total: number }[];
  byCategory: { category: string; total: number }[];
};

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

export type ScreenStep = { type: "screen"; label: string; match: "exact" | "prefix" | "contains"; value: string };
export type ApiStep = { type: "api"; label: string; method?: string; path: string; successOnly: boolean };
export type FunnelStepDef = ScreenStep | ApiStep;

export type FunnelDef = { name: string; feature: string; description: string; steps: FunnelStepDef[] };

export type FunnelStepResult = {
  label: string;
  type: "screen" | "api";
  users: number;
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

export type StoredFunnel = FunnelDef & { id: string; result: FunnelResult };

export const FEEDBACK_SOURCES: Record<string, string> = {
  supervisor: "Supervisor",
  support_call: "Support call",
  whatsapp: "WhatsApp",
  field_visit: "Field visit",
  in_app: "In-app",
  email: "Email",
  other: "Other",
};

export const FEEDBACK_CATEGORIES: Record<string, string> = {
  bug: "Bug",
  request: "Feature request",
  complaint: "Complaint",
  question: "Question",
  praise: "Praise",
};

export const FEEDBACK_PRIORITIES: Record<string, string> = {
  critical: "Critical",
  high: "High",
  medium: "Medium",
  low: "Low",
};

export const FEEDBACK_STATUSES: Record<string, string> = {
  new: "New",
  triaged: "Triaged",
  planned: "Planned",
  in_progress: "In progress",
  done: "Done",
  wont_do: "Won't do",
};

/** Suggested feature tags; free text is also accepted. */
export const FEATURE_SUGGESTIONS = [
  "ordering",
  "contracting",
  "coupons",
  "payments",
  "wallet",
  "digital-services",
  "sales",
  "inventory",
  "login",
  "general",
];

export const RELEASE_KINDS: Record<string, string> = {
  major: "Major",
  minor: "Minor",
  patch: "Patch",
  hotfix: "Hotfix",
};

export function priorityTone(p: string): BadgeTone {
  return p === "critical" ? "red" : p === "high" ? "amber" : p === "medium" ? "sky" : "neutral";
}

export function statusTone(s: string): BadgeTone {
  if (s === "done") return "green";
  if (s === "wont_do") return "neutral";
  if (s === "new") return "indigo";
  if (s === "in_progress" || s === "planned") return "amber";
  return "sky";
}

export function releaseKindTone(k: string): BadgeTone {
  return k === "hotfix" ? "red" : k === "major" ? "indigo" : k === "minor" ? "sky" : "neutral";
}

export function humanize(s: string): string {
  return s.replace(/[_-]+/g, " ").replace(/^./, (c) => c.toUpperCase());
}

export function fmtDate(iso: string | null | undefined): string {
  if (!iso) return "—";
  const d = /^\d{4}-\d{2}-\d{2}$/.test(iso) ? new Date(`${iso}T00:00:00`) : new Date(iso);
  return d.toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" });
}

export function fmtHours(h: number | null): string {
  if (h == null) return "—";
  if (h < 1) return `${Math.max(1, Math.round(h * 60))} min`;
  if (h < 48) return `${h.toFixed(1)} h`;
  return `${(h / 24).toFixed(1)} days`;
}

export function fmtDurationMs(ms: number | null): string {
  if (ms == null) return "—";
  const min = ms / 60000;
  if (min < 1) return `${Math.round(ms / 1000)}s`;
  if (min < 120) return `${Math.round(min)} min`;
  if (min < 48 * 60) return `${(min / 60).toFixed(1)} h`;
  return `${(min / 1440).toFixed(1)} days`;
}

export type IncidentRow = {
  id: string;
  service: string;
  severity: string;
  status: string;
  title: string;
  openedAt: string;
  resolvedAt: string | null;
  durationMinutes: number;
  autoResolved: boolean;
  resolution: string | null;
  usersAffected: number;
  failedCalls: number;
  notes: number;
};

export type IncidentReport = {
  services: string[];
  summary: {
    total: number;
    openNow: number;
    bySeverity: Record<string, number>;
    meanResolutionMinutes: number | null;
    medianResolutionMinutes: number | null;
    p90ResolutionMinutes: number | null;
    downtimeMinutes: number;
    longestMinutes: number | null;
    autoResolvedShare: number | null;
    manuallyResolved: number;
    usersAffected: number;
  };
  byService: {
    service: string;
    label: string;
    payment: boolean;
    thresholdPct: number;
    incidents: number;
    downtimeMinutes: number;
    availability: number;
    medianResolutionMinutes: number | null;
    lastIncidentAt: string | null;
  }[];
  incidents: IncidentRow[];
};

export type IncidentDetail = IncidentRow & {
  triggerErrorRate: number | null;
  resolutionReason: string | null;
  notesList: { id: string; body: string; author: string | null; createdAt: string }[];
  failingEndpoints: { method: string; path: string; failures: number; users: number; lastStatus: number | null }[];
  affectedUsers: { userKey: string; email: string | null; failures: number }[];
};

export type PaymentChannel = {
  slug: string;
  label: string;
  host: string;
  role: string | null;
  statusNow: "operational" | "degraded" | "down" | "no_data";
  errorRate5m: number;
  thresholdPct: number;
  calls: number;
  successRate: number | null;
  failures: number;
  agents: number;
  agentsAffected: number;
  p95LatencyMs: number | null;
  incidents: number;
  daily: { date: string; calls: number; successRate: number | null }[];
  failingEndpoints: { method: string; path: string; failures: number; calls: number; agents: number; topStatus: number | null }[];
};

export type PaymentsReport = {
  channels: PaymentChannel[];
  overall: { calls: number; successRate: number | null; agentsAffected: number; failures: number };
  hasBackup: boolean;
};

export function fmtMinutes(m: number | null | undefined): string {
  if (m == null) return "—";
  if (m < 1) return "<1 min";
  if (m < 120) return `${Math.round(m)} min`;
  if (m < 48 * 60) return `${(m / 60).toFixed(1)} h`;
  return `${(m / 1440).toFixed(1)} days`;
}

export function severityTone(s: string): BadgeTone {
  return s === "P1" ? "red" : s === "P2" ? "amber" : s === "P3" ? "sky" : "neutral";
}

export function rateTone(rate: number | null, warn: number, bad: number): BadgeTone {
  if (rate == null) return "neutral";
  return rate < bad ? "red" : rate < warn ? "amber" : "green";
}

export function fmtPct(v: number | null | undefined, digits = 1): string {
  return v == null ? "—" : `${(v * 100).toFixed(digits)}%`;
}
