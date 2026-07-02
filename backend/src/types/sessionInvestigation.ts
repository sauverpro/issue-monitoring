export type SessionUser = {
  id: string | null;
  email: string | null;
  role: string | null;
  accountType: string | null;
};

export type SessionAction = {
  id: string;
  timestamp: string;
  message: string | null;
  type: string | null;
  status: string | null;
  actionType: string | null;
  service: string | null;
  method: string | null;
  endpoint: string | null;
  httpStatus: string | null;
  actionIndex: number;
  orderId: string | null;
  failureReason: string | null;
  role: string | null;
  accountType: string | null;
};

export type SessionSummary = {
  totalActions: number;
  successfulActions: number;
  failedActions: number;
  apiCalls: number;
  errorRate: number;
  startedAt: string | null;
  endedAt: string | null;
};

export type SessionActionsResponse = {
  sessionId: string;
  user: SessionUser;
  summary: SessionSummary;
  actions: SessionAction[];
};

export type SessionListItem = {
  sessionId: string;
  userEmail: string | null;
  role: string | null;
  accountType: string | null;
  totalActions: number;
  failures: number;
  startedAt: string;
  lastActivity: string;
};

export type SessionFailure = {
  endpoint: string | null;
  service: string | null;
  failureReason: string | null;
  httpStatus: string | null;
  timestamp: string;
  actionIndex: number;
};

export type SessionFailuresResponse = {
  sessionId: string;
  failures: SessionFailure[];
};

export type SentryIssueDetail = {
  id: string;
  title: string;
  status: string;
  level: string;
  count: string;
  userCount: number;
  firstSeen: string;
  lastSeen: string;
  permalink: string;
  relatedSessionId: string | null;
  sessionActionsUrl: string | null;
  project: string | null;
  /** Populated when a session is correlated — full timeline for issue detail UI */
  session?: SessionActionsResponse | null;
};
