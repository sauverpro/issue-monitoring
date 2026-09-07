import { useState, useMemo } from "react";
import { Link } from "react-router-dom";
import {
  Activity,
  Code2,
  Copy,
  Check,
  Play,
  Download,
  Key,
  Database,
  Table,
  FileSpreadsheet,
  Terminal,
  ExternalLink,
  ShieldCheck,
  LogIn,
  BookOpen,
  FolderKanban,
  ListOrdered,
  Link2,
  RefreshCw,
  Layers,
} from "lucide-react";
import { clsx } from "clsx";
import { BASE } from "@/lib/api";

type EndpointDef = {
  id: string;
  name: string;
  method: "GET";
  path: string;
  desc: string;
  category:
    | "Executive"
    | "Telemetry"
    | "Sessions"
    | "SLA & Vendors"
    | "Incidents"
    | "Tenancy"
    | "Journey & Behavior"
    | "Problems"
    | "Performance"
    | "Funnels"
    | "Retention"
    | "Trends";
  /** True for endpoints backed by the multi-tenant Monitor product — these require ?projectId=. */
  requiresProject?: boolean;
  params: {
    name: string;
    type: string;
    default: string;
    desc: string;
    options?: string[];
  }[];
  sampleParams: Record<string, string>;
};

const ENDPOINTS: EndpointDef[] = [
  {
    id: "summary",
    name: "Executive KPI Summary",
    method: "GET",
    path: "/api/powerbi/summary",
    category: "Executive",
    desc: "Returns high-level platform KPI counts, overall success/error rate percentages, unique user metrics, and active incident status for PowerBI Card visual displays.",
    params: [
      { name: "window", type: "string", default: "24h", desc: "Time aggregation window", options: ["1h", "6h", "24h", "7d", "30d"] },
      { name: "projectId", type: "string", default: "", desc: "Optional — scope to one Monitor project (see Tenancy → Projects)" },
      { name: "format", type: "string", default: "json", desc: "Response output format", options: ["json", "csv"] },
    ],
    sampleParams: { window: "24h", format: "json" },
  },
  {
    id: "events",
    name: "Granular Telemetry Fact Table",
    method: "GET",
    path: "/api/powerbi/events",
    category: "Telemetry",
    desc: "Line-item log feed of every API call: endpoint, HTTP method, status code, latency, outcome, service, ingest source, project, and user context — for PowerBI Fact tables.",
    params: [
      { name: "service", type: "string", default: "", desc: "Filter by tracked API", options: ["ALL", "DDIN", "MVEND", "KORALINK", "INTEGRA", "RESOLVEIT"] },
      { name: "outcome", type: "string", default: "", desc: "Filter by outcome", options: ["ALL", "SUCCESS", "FAILURE", "OTHER"] },
      { name: "ingestSource", type: "string", default: "", desc: "Filter by how the row was ingested", options: ["ALL", "direct", "sentry", "sdk"] },
      { name: "projectId", type: "string", default: "", desc: "Optional — scope to one Monitor project (see Tenancy → Projects)" },
      { name: "startDate", type: "string", default: "", desc: "ISO date/time lower bound" },
      { name: "endDate", type: "string", default: "", desc: "ISO date/time upper bound" },
      { name: "limit", type: "number", default: "500", desc: "Number of records (max 5000)" },
      { name: "offset", type: "number", default: "0", desc: "Row offset for paging through all data" },
      { name: "format", type: "string", default: "json", desc: "Output format", options: ["json", "csv"] },
    ],
    sampleParams: { limit: "100", format: "json" },
  },
  {
    id: "sessions",
    name: "User Sessions Dimension Table",
    method: "GET",
    path: "/api/powerbi/sessions",
    category: "Sessions",
    desc: "Aggregated user journey session metrics including start/end time, total actions, failure counts, distinct endpoints, device/app context, and user role metadata.",
    params: [
      { name: "hasFailures", type: "boolean", default: "false", desc: "Only sessions with failures", options: ["false", "true"] },
      { name: "projectId", type: "string", default: "", desc: "Optional — scope to one Monitor project (see Tenancy → Projects)" },
      { name: "limit", type: "number", default: "500", desc: "Number of records (max 5000)" },
      { name: "offset", type: "number", default: "0", desc: "Row offset for paging through all data" },
      { name: "format", type: "string", default: "json", desc: "Output format", options: ["json", "csv"] },
    ],
    sampleParams: { limit: "100", format: "json" },
  },
  {
    id: "upstream",
    name: "Upstream & Vendor SLA Report",
    method: "GET",
    path: "/api/powerbi/upstream-health",
    category: "SLA & Vendors",
    desc: "Evaluates vendor/upstream SLAs across every tracked API host with latency percentiles (P50, P95, P99) and error rates.",
    params: [
      { name: "window", type: "string", default: "24h", desc: "Evaluation window", options: ["1h", "6h", "24h", "7d", "30d"] },
      { name: "projectId", type: "string", default: "", desc: "Optional — scope to one Monitor project (see Tenancy → Projects)" },
      { name: "format", type: "string", default: "json", desc: "Output format", options: ["json", "csv"] },
    ],
    sampleParams: { window: "7d", format: "json" },
  },
  {
    id: "incidents",
    name: "Incident & Outage History Log",
    method: "GET",
    path: "/api/powerbi/incidents",
    category: "Incidents",
    desc: "Historical log of outages and incidents including title, severity, duration in minutes, trigger error rates, and resolution notes.",
    params: [
      { name: "format", type: "string", default: "json", desc: "Output format", options: ["json", "csv"] },
    ],
    sampleParams: { format: "json" },
  },

  // ---- Monitor tenancy dimension table ----------------------------------
  {
    id: "projects",
    name: "Projects & Organizations Dimension Table",
    method: "GET",
    path: "/api/powerbi/projects",
    category: "Tenancy",
    desc: "Every Monitor project and its parent organization — id, name, slug, platform, retention window. Use projectId from this table to filter every endpoint below.",
    params: [
      { name: "format", type: "string", default: "json", desc: "Output format", options: ["json", "csv"] },
    ],
    sampleParams: { format: "json" },
  },

  // ---- Journey & behavior (session_actions — the full Monitor SDK event taxonomy) ----
  {
    id: "journey-events",
    name: "Journey & Behavior Events Feed",
    method: "GET",
    path: "/api/powerbi/journey-events",
    category: "Journey & Behavior",
    desc: "Raw feed of every UI/behavior event captured by the Monitor SDKs — screen views, clicks, form start/submit, search, filter, modal open/close, downloads, file uploads, purchase start/complete, and logout — interleaved with navigation, lifecycle, and auth events.",
    requiresProject: true,
    params: [
      { name: "projectId", type: "string", default: "", desc: "Monitor project id (see Tenancy → Projects)" },
      {
        name: "kind",
        type: "string",
        default: "",
        desc: "Filter by event kind",
        options: [
          "ALL",
          "navigation",
          "lifecycle",
          "auth",
          "click",
          "screen_view",
          "form_start",
          "form_submit",
          "search",
          "filter",
          "modal_open",
          "modal_close",
          "download",
          "file_upload",
          "purchase_start",
          "purchase_complete",
          "logout",
        ],
      },
      { name: "sessionId", type: "string", default: "", desc: "Filter to one session" },
      { name: "startDate", type: "string", default: "", desc: "ISO date/time lower bound" },
      { name: "endDate", type: "string", default: "", desc: "ISO date/time upper bound" },
      { name: "limit", type: "number", default: "500", desc: "Number of records (max 5000)" },
      { name: "offset", type: "number", default: "0", desc: "Row offset for paging through all data" },
      { name: "format", type: "string", default: "json", desc: "Output format", options: ["json", "csv"] },
    ],
    sampleParams: { limit: "100", format: "json" },
  },
  {
    id: "behavior-screens",
    name: "Most Visited Screens",
    method: "GET",
    path: "/api/powerbi/behavior-screens",
    category: "Journey & Behavior",
    desc: "Top screens by view count and unique users for the selected project and date range — same data behind the org console's User Behavior page.",
    requiresProject: true,
    params: [
      { name: "projectId", type: "string", default: "", desc: "Monitor project id (see Tenancy → Projects)" },
      { name: "days", type: "number", default: "7", desc: "Trailing window in days (ignored if from/to given)" },
      { name: "from", type: "string", default: "", desc: "ISO start date" },
      { name: "to", type: "string", default: "", desc: "ISO end date" },
      { name: "format", type: "string", default: "json", desc: "Output format", options: ["json", "csv"] },
    ],
    sampleParams: { days: "7", format: "json" },
  },
  {
    id: "behavior-journeys",
    name: "Most Common Journeys",
    method: "GET",
    path: "/api/powerbi/behavior-journeys",
    category: "Journey & Behavior",
    desc: "Ranked, most-repeated multi-screen navigation paths (e.g. Dashboard -> Events -> Tickets) with session share percentage.",
    requiresProject: true,
    params: [
      { name: "projectId", type: "string", default: "", desc: "Monitor project id (see Tenancy → Projects)" },
      { name: "days", type: "number", default: "7", desc: "Trailing window in days (ignored if from/to given)" },
      { name: "from", type: "string", default: "", desc: "ISO start date" },
      { name: "to", type: "string", default: "", desc: "ISO end date" },
      { name: "format", type: "string", default: "json", desc: "Output format", options: ["json", "csv"] },
    ],
    sampleParams: { days: "7", format: "json" },
  },

  // ---- Problems ----------------------------------------------------------
  {
    id: "problems",
    name: "Problems Fact Table",
    method: "GET",
    path: "/api/powerbi/problems",
    category: "Problems",
    desc: "One row per failing endpoint+status group: occurrences, users/sessions affected, error rate, severity, and impact score — the same grouping shown on the org console's Problems page.",
    requiresProject: true,
    params: [
      { name: "projectId", type: "string", default: "", desc: "Monitor project id (see Tenancy → Projects)" },
      { name: "days", type: "number", default: "7", desc: "Trailing window in days (ignored if from/to given)" },
      { name: "from", type: "string", default: "", desc: "ISO start date" },
      { name: "to", type: "string", default: "", desc: "ISO end date" },
      { name: "format", type: "string", default: "json", desc: "Output format", options: ["json", "csv"] },
    ],
    sampleParams: { days: "7", format: "json" },
  },
  {
    id: "problems-summary",
    name: "Problems Summary Card",
    method: "GET",
    path: "/api/powerbi/problems-summary",
    category: "Problems",
    desc: "Single-row KPI card feed: total errors, users affected, 5xx count, and priority breakdown (critical/high/medium/low), each with % change vs. the prior equal-length window.",
    requiresProject: true,
    params: [
      { name: "projectId", type: "string", default: "", desc: "Monitor project id (see Tenancy → Projects)" },
      { name: "days", type: "number", default: "7", desc: "Trailing window in days (ignored if from/to given)" },
      { name: "from", type: "string", default: "", desc: "ISO start date" },
      { name: "to", type: "string", default: "", desc: "ISO end date" },
      { name: "format", type: "string", default: "json", desc: "Output format", options: ["json", "csv"] },
    ],
    sampleParams: { days: "7", format: "json" },
  },

  // ---- Performance --------------------------------------------------------
  {
    id: "performance",
    name: "Performance Fact Table",
    method: "GET",
    path: "/api/powerbi/performance",
    category: "Performance",
    desc: "One row per endpoint with request volume, average, P95, P99, and max latency for the selected project and date range.",
    requiresProject: true,
    params: [
      { name: "projectId", type: "string", default: "", desc: "Monitor project id (see Tenancy → Projects)" },
      { name: "days", type: "number", default: "7", desc: "Trailing window in days (ignored if from/to given)" },
      { name: "from", type: "string", default: "", desc: "ISO start date" },
      { name: "to", type: "string", default: "", desc: "ISO end date" },
      { name: "format", type: "string", default: "json", desc: "Output format", options: ["json", "csv"] },
    ],
    sampleParams: { days: "7", format: "json" },
  },
  {
    id: "performance-summary",
    name: "Performance Summary Card",
    method: "GET",
    path: "/api/powerbi/performance-summary",
    category: "Performance",
    desc: "Single-row KPI card feed: avg/P95/P99 latency and slow-endpoint count with % change vs. the prior window, plus the hourly/daily latency trend series.",
    requiresProject: true,
    params: [
      { name: "projectId", type: "string", default: "", desc: "Monitor project id (see Tenancy → Projects)" },
      { name: "days", type: "number", default: "7", desc: "Trailing window in days (ignored if from/to given)" },
      { name: "from", type: "string", default: "", desc: "ISO start date" },
      { name: "to", type: "string", default: "", desc: "ISO end date" },
      { name: "format", type: "string", default: "json", desc: "Output format", options: ["json", "csv"] },
    ],
    sampleParams: { days: "7", format: "json" },
  },

  // ---- Funnels -------------------------------------------------------------
  {
    id: "funnels",
    name: "Screen Funnel Steps",
    method: "GET",
    path: "/api/powerbi/funnels",
    category: "Funnels",
    desc: "One row per step of the sequential screen funnel — screen name, users reaching it, and conversion % from the previous step.",
    requiresProject: true,
    params: [
      { name: "projectId", type: "string", default: "", desc: "Monitor project id (see Tenancy → Projects)" },
      { name: "days", type: "number", default: "7", desc: "Trailing window in days (ignored if from/to given)" },
      { name: "from", type: "string", default: "", desc: "ISO start date" },
      { name: "to", type: "string", default: "", desc: "ISO end date" },
      { name: "format", type: "string", default: "json", desc: "Output format", options: ["json", "csv"] },
    ],
    sampleParams: { days: "7", format: "json" },
  },
  {
    id: "funnel-transitions",
    name: "Funnel Transitions",
    method: "GET",
    path: "/api/powerbi/funnel-transitions",
    category: "Funnels",
    desc: "One row per observed screen-to-screen transition with a count — useful for building a Sankey/flow diagram in PowerBI.",
    requiresProject: true,
    params: [
      { name: "projectId", type: "string", default: "", desc: "Monitor project id (see Tenancy → Projects)" },
      { name: "days", type: "number", default: "7", desc: "Trailing window in days (ignored if from/to given)" },
      { name: "from", type: "string", default: "", desc: "ISO start date" },
      { name: "to", type: "string", default: "", desc: "ISO end date" },
      { name: "format", type: "string", default: "json", desc: "Output format", options: ["json", "csv"] },
    ],
    sampleParams: { days: "7", format: "json" },
  },
  {
    id: "funnel-summary",
    name: "Funnel Summary Card",
    method: "GET",
    path: "/api/powerbi/funnel-summary",
    category: "Funnels",
    desc: "Overall funnel conversion % plus the single largest drop-off (from screen, to screen, drop rate, likely causes).",
    requiresProject: true,
    params: [
      { name: "projectId", type: "string", default: "", desc: "Monitor project id (see Tenancy → Projects)" },
      { name: "days", type: "number", default: "7", desc: "Trailing window in days (ignored if from/to given)" },
      { name: "from", type: "string", default: "", desc: "ISO start date" },
      { name: "to", type: "string", default: "", desc: "ISO end date" },
      { name: "format", type: "string", default: "json", desc: "Output format", options: ["json", "csv"] },
    ],
    sampleParams: { days: "7", format: "json" },
  },

  // ---- Retention & trends ---------------------------------------------------
  {
    id: "retention",
    name: "Retention Cohort Table",
    method: "GET",
    path: "/api/powerbi/retention",
    category: "Retention",
    desc: "One row per cohort day with D1 and D7 return counts and rates.",
    requiresProject: true,
    params: [
      { name: "projectId", type: "string", default: "", desc: "Monitor project id (see Tenancy → Projects)" },
      { name: "days", type: "number", default: "7", desc: "Trailing window in days (ignored if from/to given)" },
      { name: "from", type: "string", default: "", desc: "ISO start date" },
      { name: "to", type: "string", default: "", desc: "ISO end date" },
      { name: "format", type: "string", default: "json", desc: "Output format", options: ["json", "csv"] },
    ],
    sampleParams: { days: "7", format: "json" },
  },
  {
    id: "daily-metrics",
    name: "Daily Metrics Rollup",
    method: "GET",
    path: "/api/powerbi/daily-metrics",
    category: "Trends",
    desc: "One row per day: active users, sessions, actions, API requests, errors, and average latency — the fastest way to build a PowerBI trend chart without aggregating millions of raw events yourself.",
    requiresProject: true,
    params: [
      { name: "projectId", type: "string", default: "", desc: "Monitor project id (see Tenancy → Projects)" },
      { name: "days", type: "number", default: "30", desc: "Trailing window in days (ignored if from/to given)" },
      { name: "from", type: "string", default: "", desc: "ISO start date" },
      { name: "to", type: "string", default: "", desc: "ISO end date" },
      { name: "format", type: "string", default: "json", desc: "Output format", options: ["json", "csv"] },
    ],
    sampleParams: { days: "30", format: "json" },
  },
];

const POWERBI_GUIDE_STEPS = [
  {
    title: "Get your Analyst API key",
    body: "Ask an ICT Chamber admin for the Power BI / Analyst API key. Paste it in the key field on this page — never commit it to source control or share it in screenshots.",
  },
  {
    title: "Confirm the API host",
    body: "All requests go to this deployment’s origin under /api/powerbi/*. Use the Generated URL or M code from this page so the host matches production (or staging).",
  },
  {
    title: "Discover projectId (required for Monitor feeds)",
    body: "Call GET /api/powerbi/projects (or use Load projects below). Copy the project UUID into ?projectId= for journey, problems, performance, funnels, retention, and behavior endpoints.",
  },
  {
    title: "Connect in Power BI Desktop",
    body: "Get Data → Web is fine for a quick JSON/CSV pull. For scheduled refresh, prefer Advanced Editor and paste the M code (X-API-Key header) so the key is not stored in the URL.",
  },
  {
    title: "Model relationships",
    body: "Treat events / journey-events as facts; sessions and projects as dimensions. Join on sessionId / projectId. Use daily-metrics for trend cards without loading every raw row.",
  },
  {
    title: "Publish & refresh",
    body: "Publish to Power BI Service. Set the web data source credential to Anonymous when using M code with X-API-Key, then schedule daily refresh.",
  },
] as const;

const RECOMMENDED_DATASETS: {
  useCase: string;
  endpoints: string;
  tip: string;
}[] = [
  {
    useCase: "Executive KPI cards",
    endpoints: "summary, daily-metrics",
    tip: "Cards / KPI visuals; filter by window or days.",
  },
  {
    useCase: "API traffic & failures",
    endpoints: "events, upstream-health, incidents",
    tip: "Fact table + SLA; page events with limit/offset.",
  },
  {
    useCase: "User journeys",
    endpoints: "sessions, journey-events",
    tip: "Requires projectId; join on sessionId.",
  },
  {
    useCase: "Errors & impact",
    endpoints: "problems, problems-summary",
    tip: "Requires projectId; severity / users affected.",
  },
  {
    useCase: "Latency & slow APIs",
    endpoints: "performance, performance-summary",
    tip: "Requires projectId; avg / p95 / p99.",
  },
  {
    useCase: "Product analytics",
    endpoints: "behavior-screens, behavior-journeys, funnels, funnel-transitions, retention",
    tip: "Requires projectId; funnels for conversion charts.",
  },
];

export function ApiDocs() {
  const [selectedEndpointId, setSelectedEndpointId] = useState<string>("summary");
  const [apiKey, setApiKey] = useState<string>("");
  const [paramValues, setParamValues] = useState<Record<string, string>>(
    ENDPOINTS[0]!.sampleParams
  );
  const [copiedUrl, setCopiedUrl] = useState(false);
  const [copiedCurl, setCopiedCurl] = useState(false);
  const [copiedMCode, setCopiedMCode] = useState(false);

  // Test execution state
  const [executing, setExecuting] = useState(false);
  const [testResult, setTestResult] = useState<{
    status: number;
    timeMs: number;
    data: unknown;
    isCsv: boolean;
    rawText: string;
  } | null>(null);

  // Project discovery — lets a partner see which projectId to filter by,
  // instead of guessing (fetched live from GET /api/powerbi/projects).
  const [projects, setProjects] = useState<Record<string, unknown>[] | null>(null);
  const [loadingProjects, setLoadingProjects] = useState(false);
  const [projectsError, setProjectsError] = useState<string | null>(null);
  const [copiedProjectId, setCopiedProjectId] = useState<string | null>(null);

  const currentEp = useMemo(
    () => ENDPOINTS.find((e) => e.id === selectedEndpointId) ?? ENDPOINTS[0]!,
    [selectedEndpointId]
  );

  const groupedEndpoints = useMemo(() => {
    const groups = new Map<EndpointDef["category"], EndpointDef[]>();
    for (const ep of ENDPOINTS) {
      const list = groups.get(ep.category) ?? [];
      list.push(ep);
      groups.set(ep.category, list);
    }
    return [...groups.entries()];
  }, []);

  const selectEndpoint = (ep: EndpointDef) => {
    setSelectedEndpointId(ep.id);
    setParamValues(ep.sampleParams);
    setTestResult(null);
  };

  // Base API Host computation
  const apiHost = useMemo(() => {
    if (BASE.startsWith("http")) return BASE;
    return window.location.origin;
  }, []);

  // Query params without the key — reused for both the browser-test URL (key
  // appended separately below) and the M-code URL (key sent as a header instead).
  const baseUrlNoKey = useMemo(() => {
    const params = new URLSearchParams();
    for (const [k, v] of Object.entries(paramValues)) {
      if (v && v !== "ALL") {
        params.append(k, v);
      }
    }
    const qs = params.toString();
    return `${apiHost}${currentEp.path}${qs ? `?${qs}` : ""}`;
  }, [apiHost, currentEp.path, paramValues]);

  // Compute full query URL (includes ?api_key= — fine for a one-off browser/curl
  // test, but the M-code snippet below uses a header instead so scheduled
  // PowerBI refreshes don't leave the key sitting in a cached/logged URL).
  const fullUrl = useMemo(() => {
    const sep = baseUrlNoKey.includes("?") ? "&" : "?";
    return `${baseUrlNoKey}${sep}api_key=${encodeURIComponent(apiKey.trim())}`;
  }, [baseUrlNoKey, apiKey]);

  // Compute Curl Command
  const curlCommand = useMemo(() => {
    if (paramValues.format === "csv") {
      return `curl -s "${fullUrl}" -o ${currentEp.id}_export.csv`;
    }
    return `curl -s "${fullUrl}"`;
  }, [fullUrl, paramValues.format, currentEp.id]);

  // Compute PowerQuery M Code — key sent as an X-API-Key header rather than
  // baked into the URL, so it never lands in a browser/gateway access log or
  // Power BI's cached query URL. This is also what makes scheduled refresh in
  // the Power BI Service work with an "Anonymous" web credential.
  const mCodeSnippet = useMemo(() => {
    const isCsv = paramValues.format === "csv";
    return `let
    ApiKey = "${apiKey.trim()}",
    BaseUrl = "${baseUrlNoKey}",
    Response = Web.Contents(BaseUrl, [Headers=[#"X-API-Key"=ApiKey]]),
    Source = ${isCsv ? 'Csv.Document(Response, [Delimiter=",", Encoding=65001, QuoteStyle=QuoteStyle.Csv])' : "Json.Document(Response)"}${isCsv ? ",\n    Promoted = Table.PromoteHeaders(Source, [PromoteAllScalars=true])\nin\n    Promoted" : "\nin\n    Source"}`;
  }, [apiKey, baseUrlNoKey, paramValues.format]);

  const copyToClipboard = (text: string, type: "url" | "curl" | "mcode") => {
    navigator.clipboard.writeText(text);
    if (type === "url") {
      setCopiedUrl(true);
      setTimeout(() => setCopiedUrl(false), 2000);
    } else if (type === "curl") {
      setCopiedCurl(true);
      setTimeout(() => setCopiedCurl(false), 2000);
    } else if (type === "mcode") {
      setCopiedMCode(true);
      setTimeout(() => setCopiedMCode(false), 2000);
    }
  };

  const copyProjectId = (id: string) => {
    navigator.clipboard.writeText(id);
    setCopiedProjectId(id);
    setTimeout(() => setCopiedProjectId(null), 2000);
  };

  // Discover available Monitor projects via GET /api/powerbi/projects, using
  // whatever API key the user has entered — lets a partner find a real
  // projectId to filter by instead of guessing.
  const loadProjects = async () => {
    if (!apiKey.trim()) {
      setProjectsError("Enter your API key above first.");
      return;
    }
    setLoadingProjects(true);
    setProjectsError(null);
    try {
      const url = `${apiHost}/api/powerbi/projects?api_key=${encodeURIComponent(apiKey.trim())}`;
      const res = await fetch(url);
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body?.error || `Request failed (HTTP ${res.status})`);
      }
      const data = (await res.json()) as Record<string, unknown>[];
      setProjects(data);
    } catch (err) {
      setProjectsError(err instanceof Error ? err.message : "Failed to load projects");
    } finally {
      setLoadingProjects(false);
    }
  };

  // Run live test query
  const runTestQuery = async () => {
    setExecuting(true);
    setTestResult(null);
    const start = performance.now();
    try {
      const isCsv = paramValues.format === "csv";
      const res = await fetch(fullUrl);
      const timeMs = Math.round(performance.now() - start);
      const rawText = await res.text();
      let parsedData: unknown = rawText;
      if (!isCsv) {
        try {
          parsedData = JSON.parse(rawText);
        } catch {
          /* fallback to raw text */
        }
      }
      setTestResult({
        status: res.status,
        timeMs,
        data: parsedData,
        isCsv,
        rawText,
      });
    } catch (err) {
      const timeMs = Math.round(performance.now() - start);
      setTestResult({
        status: 0,
        timeMs,
        data: { error: err instanceof Error ? err.message : "Failed to execute request" },
        isCsv: false,
        rawText: String(err),
      });
    } finally {
      setExecuting(false);
    }
  };

  return (
    <div className="min-h-screen bg-white dark:bg-zinc-950">
      {/* Public top bar (no internal dashboard nav is exposed to unauthenticated visitors) */}
      <header className="sticky top-0 z-10 border-b border-zinc-200/80 dark:border-zinc-800/80 bg-white/95 dark:bg-zinc-950/95 backdrop-blur">
        <div className="mx-auto flex max-w-7xl items-center justify-between gap-4 px-6 py-3.5 lg:px-8">
          <Link to="/api-docs" className="flex items-center gap-2 font-semibold text-zinc-800 dark:text-zinc-100">
            <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-emerald-500/15 ring-1 ring-emerald-500/30">
              <Activity className="h-4 w-4 text-emerald-600 dark:text-emerald-400" />
            </span>
            <span className="text-sm tracking-tight">Koralink</span>
            <span className="hidden text-xs font-normal text-zinc-600 dark:text-zinc-500 sm:inline">/ API Documentation</span>
          </Link>
          <Link
            to="/ops/login"
            className="flex items-center gap-1.5 rounded-lg border border-zinc-200 dark:border-zinc-800 bg-zinc-50 dark:bg-zinc-900 px-3 py-1.5 text-xs font-semibold text-zinc-600 dark:text-zinc-300 transition hover:bg-zinc-200 dark:hover:bg-zinc-800 hover:text-zinc-900 dark:hover:text-white"
          >
            <LogIn className="h-3.5 w-3.5" />
            Staff Login
          </Link>
        </div>
      </header>

      <div className="mx-auto max-w-7xl space-y-8 px-6 py-8 pb-16 lg:px-8">
        {/* Intro copy for unauthenticated/public visitors */}
        <div className="space-y-2">
          <div className="flex items-center gap-2 text-xs font-semibold text-emerald-600 dark:text-emerald-400">
            <BookOpen className="h-4 w-4" />
            Public Reference
          </div>
          <p className="max-w-3xl text-sm leading-relaxed text-zinc-700 dark:text-zinc-400">
            This page is the integration guide for partners wiring Koralink into{" "}
            <strong className="text-zinc-800 dark:text-zinc-200">Power BI</strong>, Excel, or Tableau.
            It documents every read-only <code className="rounded bg-zinc-50 dark:bg-zinc-900 px-1 py-0.5 text-emerald-700 dark:text-emerald-300">/api/powerbi</code>{" "}
            endpoint, how to authenticate, and how to paste ready-made Power Query (M) into Desktop.
            No ops dashboard login is required — paste the Analyst API key below. Staff can still use{" "}
            <strong className="text-zinc-600 dark:text-zinc-300">Staff Login</strong> for the internal console.
          </p>
          <div className="flex flex-wrap gap-2 pt-1">
            <a
              href="#powerbi-integration"
              className="rounded-lg border border-emerald-500/30 bg-emerald-500/10 px-3 py-1.5 text-xs font-semibold text-emerald-700 dark:text-emerald-300 hover:bg-emerald-500/20"
            >
              Power BI integration guide
            </a>
            <a
              href="#powerbi-playground"
              className="rounded-lg border border-zinc-200 dark:border-zinc-800 bg-zinc-50 dark:bg-zinc-900 px-3 py-1.5 text-xs font-semibold text-zinc-700 dark:text-zinc-300 hover:bg-zinc-100 dark:hover:bg-zinc-800"
            >
              Endpoint playground
            </a>
          </div>
        </div>

        {/* Power BI Integration Documentation — primary surface for integrators */}
        <section
          id="powerbi-integration"
          className="scroll-mt-20 space-y-5 rounded-2xl border border-zinc-200/80 dark:border-zinc-800/80 bg-zinc-50/50 dark:bg-zinc-900/40 p-6"
        >
          <div className="space-y-1">
            <div className="flex items-center gap-2 text-xs font-semibold text-emerald-600 dark:text-emerald-400">
              <ListOrdered className="h-4 w-4" />
              Integration documentation
            </div>
            <h2 className="text-xl font-bold tracking-tight text-zinc-900 dark:text-white">
              Connect Power BI to Koralink Monitor
            </h2>
            <p className="max-w-3xl text-sm text-zinc-600 dark:text-zinc-400">
              Follow these steps once, then use the playground below to generate URLs and M code for each dataset.
            </p>
          </div>

          <div className="grid gap-4 lg:grid-cols-3">
            <div className="rounded-xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-950 p-4 space-y-2">
              <h3 className="flex items-center gap-1.5 text-xs font-bold uppercase tracking-wider text-zinc-500">
                <Key className="h-3.5 w-3.5 text-amber-500" />
                Authentication
              </h3>
              <ul className="space-y-1.5 text-xs text-zinc-700 dark:text-zinc-300 leading-relaxed">
                <li>
                  Preferred: header{" "}
                  <code className="rounded bg-zinc-100 dark:bg-zinc-900 px-1 text-emerald-700 dark:text-emerald-300">
                    X-API-Key: &lt;key&gt;
                  </code>
                </li>
                <li>
                  Also accepted:{" "}
                  <code className="rounded bg-zinc-100 dark:bg-zinc-900 px-1 text-emerald-700 dark:text-emerald-300">
                    Authorization: Bearer &lt;key&gt;
                  </code>
                </li>
                <li>
                  Query param{" "}
                  <code className="rounded bg-zinc-100 dark:bg-zinc-900 px-1">?api_key=</code> works for
                  one-off tests only — do not use it for scheduled refresh.
                </li>
              </ul>
            </div>
            <div className="rounded-xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-950 p-4 space-y-2">
              <h3 className="flex items-center gap-1.5 text-xs font-bold uppercase tracking-wider text-zinc-500">
                <Link2 className="h-3.5 w-3.5 text-emerald-500" />
                Base URL &amp; formats
              </h3>
              <ul className="space-y-1.5 text-xs text-zinc-700 dark:text-zinc-300 leading-relaxed">
                <li>
                  Base path:{" "}
                  <code className="rounded bg-zinc-100 dark:bg-zinc-900 px-1 font-mono text-[11px]">
                    {apiHost}/api/powerbi
                  </code>
                </li>
                <li>
                  Default response: JSON. Add{" "}
                  <code className="rounded bg-zinc-100 dark:bg-zinc-900 px-1">format=csv</code> for a
                  flat CSV download.
                </li>
                <li>All endpoints are read-only GET. Max page size is typically 5,000 rows.</li>
              </ul>
            </div>
            <div className="rounded-xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-950 p-4 space-y-2">
              <h3 className="flex items-center gap-1.5 text-xs font-bold uppercase tracking-wider text-zinc-500">
                <RefreshCw className="h-3.5 w-3.5 text-sky-500" />
                Power BI Service refresh
              </h3>
              <ul className="space-y-1.5 text-xs text-zinc-700 dark:text-zinc-300 leading-relaxed">
                <li>Paste M code that sends X-API-Key (Copy PowerBI M Code in the playground).</li>
                <li>Publish the report, open Dataset settings → Data source credentials.</li>
                <li>
                  Choose <strong>Anonymous</strong> for the web source (key is already in the query
                  headers), then enable scheduled refresh.
                </li>
              </ul>
            </div>
          </div>

          <ol className="grid gap-3 sm:grid-cols-2">
            {POWERBI_GUIDE_STEPS.map((step, i) => (
              <li
                key={step.title}
                className="flex gap-3 rounded-xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-950 p-4"
              >
                <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-emerald-500/15 text-xs font-bold text-emerald-700 dark:text-emerald-300">
                  {i + 1}
                </span>
                <div className="min-w-0 space-y-1">
                  <p className="text-sm font-semibold text-zinc-900 dark:text-white">{step.title}</p>
                  <p className="text-xs leading-relaxed text-zinc-600 dark:text-zinc-400">{step.body}</p>
                </div>
              </li>
            ))}
          </ol>

          <div className="space-y-3">
            <h3 className="flex items-center gap-2 text-sm font-bold text-zinc-900 dark:text-white">
              <Layers className="h-4 w-4 text-emerald-600 dark:text-emerald-400" />
              Recommended datasets for a first dashboard
            </h3>
            <div className="overflow-x-auto rounded-xl border border-zinc-200 dark:border-zinc-800">
              <table className="w-full text-left text-xs">
                <thead className="bg-zinc-100 dark:bg-zinc-900 text-zinc-600 dark:text-zinc-400">
                  <tr>
                    <th className="px-3 py-2.5 font-semibold">Use case</th>
                    <th className="px-3 py-2.5 font-semibold">Endpoints</th>
                    <th className="px-3 py-2.5 font-semibold">Notes</th>
                  </tr>
                </thead>
                <tbody>
                  {RECOMMENDED_DATASETS.map((row) => (
                    <tr
                      key={row.useCase}
                      className="border-t border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-950"
                    >
                      <td className="px-3 py-2.5 font-medium text-zinc-900 dark:text-white">
                        {row.useCase}
                      </td>
                      <td className="px-3 py-2.5 font-mono text-[11px] text-emerald-700 dark:text-emerald-300">
                        {row.endpoints}
                      </td>
                      <td className="px-3 py-2.5 text-zinc-600 dark:text-zinc-400">{row.tip}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          <div className="rounded-xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-950 p-4 space-y-3">
            <h3 className="flex items-center gap-2 text-sm font-bold text-zinc-900 dark:text-white">
              <Table className="h-4 w-4 text-emerald-600 dark:text-emerald-400" />
              Power BI Desktop — quick connect
            </h3>
            <ol className="list-decimal list-inside space-y-1.5 text-xs text-zinc-700 dark:text-zinc-400 leading-relaxed">
              <li>
                Open <strong className="text-zinc-800 dark:text-zinc-200">Power BI Desktop</strong> →{" "}
                <strong className="text-zinc-800 dark:text-zinc-200">Get Data</strong> →{" "}
                <strong className="text-zinc-800 dark:text-zinc-200">Web</strong>.
              </li>
              <li>
                For a one-off test, paste the generated endpoint URL (includes{" "}
                <code className="text-emerald-600 dark:text-emerald-400">api_key</code>). Prefer M code
                for anything you will publish.
              </li>
              <li>
                Click <strong className="text-zinc-800 dark:text-zinc-200">Transform Data</strong> →{" "}
                <strong className="text-zinc-800 dark:text-zinc-200">Advanced Editor</strong>, paste{" "}
                <strong className="text-zinc-800 dark:text-zinc-200">Copy PowerBI M Code</strong> from
                the playground, then Close &amp; Apply.
              </li>
              <li>
                For large fact tables (<code className="font-mono">events</code>,{" "}
                <code className="font-mono">journey-events</code>,{" "}
                <code className="font-mono">sessions</code>), page with{" "}
                <code className="font-mono">limit</code> / <code className="font-mono">offset</code>{" "}
                (or <code className="font-mono">List.Generate</code> in Power Query) so you are not
                capped at a single page.
              </li>
            </ol>
          </div>
        </section>

        {/* Header Banner */}
        <div
          id="powerbi-playground"
          className="scroll-mt-20 relative overflow-hidden rounded-2xl border border-zinc-200/80 dark:border-zinc-800/80 bg-gradient-to-r from-zinc-50 dark:from-zinc-900 via-zinc-50/90 dark:via-zinc-900/90 to-white dark:to-zinc-950 p-6 shadow-2xl ring-1 ring-zinc-950/5 dark:ring-white/[0.04]"
        >
        <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
          <div className="space-y-1">
            <div className="flex items-center gap-2 text-xs font-semibold text-emerald-600 dark:text-emerald-400">
              <Code2 className="h-4 w-4" />
              Developer &amp; Analyst API Suite
            </div>
            <h1 className="text-2xl font-extrabold tracking-tight text-zinc-900 dark:text-white sm:text-3xl">
              PowerBI &amp; Data Analyst API Playground
            </h1>
            <p className="max-w-2xl text-xs text-zinc-700 dark:text-zinc-400">
              Test live reporting endpoints, inspect raw payload responses, and copy ready-to-use PowerQuery formulas for scheduled refreshes in PowerBI, Excel, or Tableau.
            </p>
          </div>

          <div className="flex flex-col items-start gap-2 rounded-xl border border-zinc-200/90 dark:border-zinc-800/90 bg-white/80 dark:bg-zinc-950/80 p-3 ring-1 ring-zinc-200 dark:ring-zinc-800 min-w-[260px]">
            <div className="flex items-center gap-1.5 text-xs font-semibold text-zinc-600 dark:text-zinc-300">
              <Key className="h-3.5 w-3.5 text-amber-600 dark:text-amber-400" />
              Your Analyst API Key
            </div>
            <input
              type="password"
              value={apiKey}
              onChange={(e) => setApiKey(e.target.value)}
              placeholder="Paste the key issued to your team"
              className="w-full rounded-lg border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-950 px-2.5 py-1.5 text-xs font-mono text-zinc-900 dark:text-white outline-none focus:border-emerald-500"
            />
            <p className="text-[10px] text-zinc-600 dark:text-zinc-500">
              Ask an ICT Chamber admin for your key — this page never ships a default one.
            </p>
          </div>
        </div>
      </div>

      {/* Available Projects — discover which projectId to filter by */}
      <div className="rounded-2xl border border-zinc-200/80 dark:border-zinc-800/80 bg-zinc-50/40 dark:bg-zinc-900/40 p-5 space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h3 className="flex items-center gap-2 text-sm font-bold text-zinc-900 dark:text-white">
            <FolderKanban className="h-4 w-4 text-emerald-600 dark:text-emerald-400" />
            Available Projects
          </h3>
          <button
            type="button"
            onClick={() => void loadProjects()}
            disabled={loadingProjects}
            className="flex items-center gap-1.5 rounded-lg border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-950 px-3 py-1.5 text-xs font-semibold text-zinc-700 dark:text-zinc-300 hover:bg-zinc-100 dark:hover:bg-zinc-800 disabled:opacity-50"
          >
            <Play className="h-3.5 w-3.5" />
            {loadingProjects ? "Loading…" : projects ? "Refresh" : "Load projects"}
          </button>
        </div>
        <p className="text-[11px] text-zinc-600 dark:text-zinc-500">
          Most endpoints below need a <code className="text-emerald-600 dark:text-emerald-400">projectId</code> filter.
          Load your projects here (uses the API key entered above), then copy an ID into the parameter form.
        </p>
        {projectsError && <p className="text-xs text-rose-500">{projectsError}</p>}
        {projects && projects.length === 0 && !projectsError && (
          <p className="text-xs text-zinc-600 dark:text-zinc-500">No projects visible to this key.</p>
        )}
        {projects && projects.length > 0 && (
          <div className="overflow-x-auto rounded-lg border border-zinc-200 dark:border-zinc-800">
            <table className="w-full text-left text-xs">
              <thead className="bg-zinc-100 dark:bg-zinc-900 text-zinc-600 dark:text-zinc-400">
                <tr>
                  <th className="px-3 py-2 font-semibold">Project</th>
                  <th className="px-3 py-2 font-semibold">Organization</th>
                  <th className="px-3 py-2 font-semibold">Platform</th>
                  <th className="px-3 py-2 font-semibold">Project ID</th>
                  <th className="px-3 py-2" />
                </tr>
              </thead>
              <tbody>
                {projects.map((p) => {
                  const id = String(p.projectId ?? "");
                  return (
                    <tr key={id} className="border-t border-zinc-200 dark:border-zinc-800">
                      <td className="px-3 py-2 font-medium text-zinc-900 dark:text-white">{String(p.projectName ?? "")}</td>
                      <td className="px-3 py-2 text-zinc-600 dark:text-zinc-400">{String(p.organizationName ?? "")}</td>
                      <td className="px-3 py-2 text-zinc-600 dark:text-zinc-400">{String(p.platform ?? "")}</td>
                      <td className="px-3 py-2 font-mono text-zinc-600 dark:text-zinc-400">{id}</td>
                      <td className="px-3 py-2 text-right">
                        <button
                          type="button"
                          onClick={() => copyProjectId(id)}
                          className="flex items-center gap-1 rounded bg-zinc-200 dark:bg-zinc-800 px-2 py-1 text-[11px] font-medium text-zinc-600 dark:text-zinc-300 hover:bg-zinc-300 dark:hover:bg-zinc-700"
                        >
                          {copiedProjectId === id ? <Check className="h-3 w-3 text-emerald-600 dark:text-emerald-400" /> : <Copy className="h-3 w-3" />}
                          {copiedProjectId === id ? "Copied" : "Copy ID"}
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Main Grid: Sidebar List + Playground */}
      <div className="grid gap-6 lg:grid-cols-12">
        {/* Left Sidebar: Endpoint Selector */}
        <div className="space-y-3 lg:col-span-4">
          <h2 className="text-xs font-bold uppercase tracking-wider text-zinc-700 dark:text-zinc-400 px-1">
            Analyst Endpoints ({ENDPOINTS.length})
          </h2>
          <div className="max-h-[70vh] space-y-4 overflow-y-auto pr-1">
            {groupedEndpoints.map(([category, eps]) => (
              <div key={category} className="space-y-2">
                <h3 className="px-1 text-[10px] font-bold uppercase tracking-widest text-zinc-500 dark:text-zinc-600">
                  {category}
                </h3>
                {eps.map((ep) => {
                  const isSelected = ep.id === selectedEndpointId;
                  return (
                    <button
                      key={ep.id}
                      type="button"
                      onClick={() => selectEndpoint(ep)}
                      className={clsx(
                        "w-full text-left rounded-xl border p-3.5 transition-all duration-200",
                        isSelected
                          ? "border-emerald-500/40 bg-emerald-500/10 shadow-lg shadow-emerald-500/5 ring-1 ring-emerald-500/20"
                          : "border-zinc-200/80 dark:border-zinc-800/80 bg-zinc-50/40 dark:bg-zinc-900/40 hover:border-zinc-300 dark:hover:border-zinc-700 hover:bg-zinc-50/80 dark:hover:bg-zinc-900/80 text-zinc-700 dark:text-zinc-400"
                      )}
                    >
                      <div className="flex items-center justify-between gap-2">
                        <span className="text-xs font-bold text-zinc-900 dark:text-white truncate">{ep.name}</span>
                        <span className="flex items-center gap-1">
                          {ep.requiresProject && (
                            <span
                              className="rounded bg-amber-500/20 px-1.5 py-0.5 text-[9px] font-bold text-amber-700 dark:text-amber-300"
                              title="Requires ?projectId="
                            >
                              projectId
                            </span>
                          )}
                          <span className="rounded bg-emerald-500/20 px-1.5 py-0.5 text-[10px] font-mono font-bold text-emerald-700 dark:text-emerald-300">
                            {ep.method}
                          </span>
                        </span>
                      </div>
                      <code className="mt-1 block text-[11px] font-mono text-zinc-700 dark:text-zinc-400 truncate">
                        {ep.path}
                      </code>
                      <p className="mt-1 text-[11px] text-zinc-600 dark:text-zinc-500 line-clamp-2 leading-relaxed">
                        {ep.desc}
                      </p>
                    </button>
                  );
                })}
              </div>
            ))}
          </div>

          {/* Quick Info Box */}
          <div className="rounded-xl border border-zinc-200/80 dark:border-zinc-800/80 bg-zinc-50/30 dark:bg-zinc-900/30 p-4 space-y-2 text-xs text-zinc-700 dark:text-zinc-400">
            <h3 className="flex items-center gap-1.5 font-semibold text-zinc-700 dark:text-zinc-200">
              <ShieldCheck className="h-4 w-4 text-emerald-600 dark:text-emerald-400" />
              Supported Formats
            </h3>
            <p className="text-[11px]">
              All analyst endpoints output standard <strong className="text-zinc-600 dark:text-zinc-300">JSON</strong> by default or direct <strong className="text-zinc-600 dark:text-zinc-300">CSV</strong> files when <code className="text-emerald-600 dark:text-emerald-400">?format=csv</code> is passed.
            </p>
          </div>
        </div>

        {/* Right Pane: Interactive Playground & Documentation */}
        <div className="space-y-6 lg:col-span-8">
          {/* Active Endpoint Header */}
          <div className="rounded-2xl border border-zinc-200/90 dark:border-zinc-800/90 bg-zinc-50/60 dark:bg-zinc-900/60 p-5 space-y-4">
            <div className="flex flex-wrap items-center justify-between gap-3 border-b border-zinc-200/80 dark:border-zinc-800/80 pb-4">
              <div>
                <div className="flex items-center gap-2">
                  <span className="rounded bg-emerald-500/20 px-2 py-0.5 text-xs font-mono font-bold text-emerald-600 dark:text-emerald-400 border border-emerald-500/30">
                    {currentEp.method}
                  </span>
                  <h2 className="text-lg font-bold text-zinc-900 dark:text-white">{currentEp.name}</h2>
                </div>
                <p className="mt-1 text-xs text-zinc-700 dark:text-zinc-400">{currentEp.desc}</p>
              </div>
            </div>

            {currentEp.requiresProject && (
              <p className="rounded-lg border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-[11px] text-amber-700 dark:text-amber-300">
                This endpoint is scoped to one Monitor project — set <code className="font-mono">projectId</code> below.
                Use the <strong>Available Projects</strong> panel above to find a valid id.
              </p>
            )}

            {/* Parameter Configuration Form */}
            <div className="space-y-3">
              <h3 className="text-xs font-bold uppercase tracking-wider text-zinc-700 dark:text-zinc-400">
                Configure Parameters
              </h3>
              <div className="grid gap-3 sm:grid-cols-2">
                {currentEp.params.map((p) => (
                  <div key={p.name} className="space-y-1">
                    <label className="flex items-center justify-between text-xs font-semibold text-zinc-600 dark:text-zinc-300">
                      <span>{p.name}</span>
                      <span className="text-[10px] text-zinc-600 dark:text-zinc-500 font-mono">({p.type})</span>
                    </label>
                    {p.options ? (
                      <select
                        value={paramValues[p.name] ?? p.default}
                        onChange={(e) =>
                          setParamValues((prev) => ({ ...prev, [p.name]: e.target.value }))
                        }
                        className="w-full rounded-lg border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-950 px-3 py-1.5 text-xs font-medium text-zinc-900 dark:text-white outline-none focus:border-emerald-500"
                      >
                        {p.options.map((opt) => (
                          <option key={opt} value={opt}>
                            {opt}
                          </option>
                        ))}
                      </select>
                    ) : (
                      <input
                        type={p.type === "number" ? "number" : "text"}
                        value={paramValues[p.name] ?? p.default}
                        onChange={(e) =>
                          setParamValues((prev) => ({ ...prev, [p.name]: e.target.value }))
                        }
                        className="w-full rounded-lg border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-950 px-3 py-1.5 text-xs font-medium text-zinc-900 dark:text-white outline-none focus:border-emerald-500"
                      />
                    )}
                    <p className="text-[10px] text-zinc-600 dark:text-zinc-500">{p.desc}</p>
                  </div>
                ))}

                {/* API Key Override */}
                <div className="space-y-1">
                  <label className="text-xs font-semibold text-zinc-600 dark:text-zinc-300">api_key</label>
                  <input
                    type="text"
                    value={apiKey}
                    onChange={(e) => setApiKey(e.target.value)}
                    className="w-full rounded-lg border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-950 px-3 py-1.5 text-xs font-mono text-amber-700 dark:text-amber-300 outline-none focus:border-emerald-500"
                  />
                  <p className="text-[10px] text-zinc-600 dark:text-zinc-500">Secret key for authorization</p>
                </div>
              </div>
            </div>

            {/* Generated Live URL Bar */}
            <div className="rounded-xl border border-zinc-200/80 dark:border-zinc-800/80 bg-white dark:bg-zinc-950 p-3 space-y-2">
              <div className="flex items-center justify-between text-xs font-semibold text-zinc-700 dark:text-zinc-400">
                <span className="flex items-center gap-1.5">
                  <Database className="h-3.5 w-3.5 text-emerald-600 dark:text-emerald-400" />
                  Generated Ready-to-Use PowerBI Endpoint URL
                </span>
                <span className="text-[10px] text-emerald-600 dark:text-emerald-400 font-mono">Format: {paramValues.format ?? "json"}</span>
              </div>
              <div className="flex items-center gap-2 overflow-x-auto rounded-lg bg-zinc-50/90 dark:bg-zinc-900/90 p-2 text-xs font-mono text-zinc-700 dark:text-zinc-200 border border-zinc-200 dark:border-zinc-800">
                <span className="truncate select-all flex-1">{fullUrl}</span>
                <button
                  type="button"
                  onClick={() => copyToClipboard(fullUrl, "url")}
                  className="flex shrink-0 items-center gap-1 rounded bg-emerald-500/20 px-2.5 py-1 text-xs font-bold text-emerald-700 dark:text-emerald-300 hover:bg-emerald-500/30 transition"
                >
                  {copiedUrl ? <Check className="h-3.5 w-3.5 text-emerald-600 dark:text-emerald-400" /> : <Copy className="h-3.5 w-3.5" />}
                  {copiedUrl ? "Copied URL" : "Copy URL"}
                </button>
              </div>
            </div>

            {/* Action Control Buttons */}
            <div className="flex flex-wrap items-center justify-between gap-3 pt-2">
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={runTestQuery}
                  disabled={executing}
                  className="flex items-center gap-2 rounded-xl bg-emerald-500 px-4 py-2 text-xs font-bold text-zinc-950 shadow-md transition hover:bg-emerald-400 disabled:opacity-50"
                >
                  <Play className="h-3.5 w-3.5 fill-current" />
                  {executing ? "Running Query..." : "Execute Test Query"}
                </button>

                <a
                  href={fullUrl}
                  target="_blank"
                  rel="noreferrer"
                  className="flex items-center gap-1.5 rounded-xl border border-zinc-200 dark:border-zinc-800 bg-zinc-50 dark:bg-zinc-900 px-3.5 py-2 text-xs font-semibold text-zinc-600 dark:text-zinc-300 hover:bg-zinc-200 dark:hover:bg-zinc-800 hover:text-zinc-900 dark:hover:text-white transition"
                >
                  <ExternalLink className="h-3.5 w-3.5" />
                  Open in Browser
                </a>
              </div>

              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => copyToClipboard(curlCommand, "curl")}
                  className="flex items-center gap-1.5 rounded-xl border border-zinc-200 dark:border-zinc-800 bg-zinc-50 dark:bg-zinc-900 px-3 py-2 text-xs font-medium text-zinc-700 dark:text-zinc-400 hover:bg-zinc-200 dark:hover:bg-zinc-800 hover:text-zinc-700 dark:hover:text-zinc-200 transition"
                >
                  <Terminal className="h-3.5 w-3.5 text-cyan-600 dark:text-cyan-400" />
                  {copiedCurl ? "Copied Curl" : "Copy Curl"}
                </button>

                <button
                  type="button"
                  onClick={() => copyToClipboard(mCodeSnippet, "mcode")}
                  className="flex items-center gap-1.5 rounded-xl border border-zinc-200 dark:border-zinc-800 bg-zinc-50 dark:bg-zinc-900 px-3 py-2 text-xs font-medium text-zinc-700 dark:text-zinc-400 hover:bg-zinc-200 dark:hover:bg-zinc-800 hover:text-zinc-700 dark:hover:text-zinc-200 transition"
                >
                  <FileSpreadsheet className="h-3.5 w-3.5 text-amber-600 dark:text-amber-400" />
                  {copiedMCode ? "Copied M Code" : "Copy PowerBI M Code"}
                </button>
              </div>
            </div>
          </div>

          {/* Test Execution Output Console */}
          {testResult && (
            <div className="rounded-2xl border border-zinc-200/90 dark:border-zinc-800/90 bg-white dark:bg-zinc-950 p-5 space-y-3 shadow-xl">
              <div className="flex items-center justify-between border-b border-zinc-200/80 dark:border-zinc-800/80 pb-3">
                <div className="flex items-center gap-3">
                  <span className="text-xs font-bold text-zinc-900 dark:text-white uppercase tracking-wider">
                    Execution Response Result
                  </span>
                  <span
                    className={clsx(
                      "rounded px-2 py-0.5 text-xs font-mono font-bold",
                      testResult.status === 200
                        ? "bg-emerald-500/20 text-emerald-600 dark:text-emerald-400"
                        : "bg-rose-500/20 text-rose-400"
                    )}
                  >
                    HTTP {testResult.status}
                  </span>
                  <span className="text-xs text-zinc-600 dark:text-zinc-500 font-mono">
                    Time: {testResult.timeMs} ms
                  </span>
                </div>

                {testResult.isCsv && (
                  <a
                    href={`data:text/csv;charset=utf-8,${encodeURIComponent(testResult.rawText)}`}
                    download={`${currentEp.id}_export.csv`}
                    className="flex items-center gap-1 rounded bg-emerald-500/20 px-2.5 py-1 text-xs font-bold text-emerald-700 dark:text-emerald-300 hover:bg-emerald-500/30"
                  >
                    <Download className="h-3.5 w-3.5" />
                    Download CSV
                  </a>
                )}
              </div>

              {/* Console Body */}
              <div className="max-h-96 overflow-auto rounded-xl bg-zinc-50/90 dark:bg-zinc-900/90 p-4 font-mono text-xs text-zinc-700 dark:text-zinc-200 border border-zinc-200 dark:border-zinc-800">
                {testResult.isCsv ? (
                  <pre className="whitespace-pre overflow-x-auto text-emerald-700 dark:text-emerald-300">{testResult.rawText}</pre>
                ) : (
                  <pre className="whitespace-pre overflow-x-auto text-emerald-600 dark:text-emerald-400">
                    {JSON.stringify(testResult.data, null, 2)}
                  </pre>
                )}
              </div>
            </div>
          )}

          {/* Pointer back to full integration guide */}
          <div className="rounded-2xl border border-zinc-200/80 dark:border-zinc-800/80 bg-zinc-50/40 dark:bg-zinc-900/40 p-5 space-y-2">
            <h3 className="flex items-center gap-2 text-sm font-bold text-zinc-900 dark:text-white">
              <BookOpen className="h-4 w-4 text-emerald-600 dark:text-emerald-400" />
              Need the full integration steps?
            </h3>
            <p className="text-xs text-zinc-600 dark:text-zinc-400 leading-relaxed">
              Auth, projectId, recommended datasets, Desktop connect, and Service refresh are documented
              at the top of this page.
            </p>
            <a
              href="#powerbi-integration"
              className="inline-flex text-xs font-semibold text-emerald-700 dark:text-emerald-300 hover:underline"
            >
              Jump to Power BI integration guide →
            </a>
          </div>
        </div>
      </div>
      </div>
    </div>
  );
}
