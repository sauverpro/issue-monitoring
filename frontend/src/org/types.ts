export type OrgRole = "owner" | "admin" | "member" | "viewer";

export type OrgListItem = {
  id: string;
  name: string;
  slug: string;
  suspended: boolean;
  createdAt: string;
  role: OrgRole;
  projectCount: number;
};

export type ProjectListItem = {
  id: string;
  name: string;
  slug: string;
  platform: "react-native" | "web";
  createdAt: string;
  hostCount: number;
};

export type HttpResultClass = "success" | "client_failure" | "server_error" | "network";

export type ApiClassCounts = {
  success: number;
  clientFailure: number;
  serverError: number;
  network: number;
};

export type SessionAction = {
  id: string;
  timestamp: string;
  message: string | null;
  type: string | null;
  status: string | null;
  /** HTTP result class for API calls. */
  resultClass?: HttpResultClass | null;
  actionType: string | null;
  service: string | null;
  method: string | null;
  endpoint: string | null;
  httpStatus: string | null;
  actionIndex: number;
  failureReason: string | null;
  screen?: string | null;
  latencyMs?: number | null;
  responseBody?: string | null;
  requestBody?: string | null;
  target?: string | null;
  sessionId?: string | null;
};

export type SessionListItem = {
  sessionId: string;
  userId?: string | null;
  userEmail: string | null;
  role: string | null;
  accountType: string | null;
  totalActions: number;
  failures: number;
  startedAt: string;
  lastActivity: string;
  apiOutcomes?: ApiClassCounts;
};

export type JourneyUser = {
  userKey: string;
  userId: string | null;
  email: string | null;
  lastActive: string;
  sessions: number;
  actions: number;
  errors: number;
  durationMs: number;
  apiOutcomes?: ApiClassCounts;
};

export type JourneyMapNode = {
  screen: string;
  time: string;
  apiTotal: number;
  apiOk: number;
  apiFail: number;
  failed: boolean;
};

export type JourneyDay = {
  date: string;
  sessions: number;
  actions: number;
  errors: number;
  durationMs: number;
};

export type FunnelStep = {
  screen: string;
  users: number;
  conversion: number;
};

export type ProblemSeverity = "critical" | "high" | "medium" | "low";

export type ProblemRow = {
  severity: ProblemSeverity;
  method: string;
  path: string;
  statusCode: number | null;
  failureReason: string | null;
  resultClass?: HttpResultClass;
  occurrences: number;
  usersAffected: number;
  sessionsAffected: number;
  firstSeen: string;
  lastSeen: string;
  avgLatencyMs: number;
  errorRate: number;
  impact: { score: number; label: "HIGH" | "MEDIUM" | "LOW" };
};
