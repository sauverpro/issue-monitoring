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
} from "lucide-react";
import { clsx } from "clsx";
import { BASE } from "@/lib/api";

type EndpointDef = {
  id: string;
  name: string;
  method: "GET";
  path: string;
  desc: string;
  category: "Executive" | "Telemetry" | "Sessions" | "SLA & Vendors" | "Incidents";
  params: {
    name: string;
    type: string;
    default: string;
    desc: string;
    options?: string[];
  }[];
  sampleParams: Record<string, string>;
};

const DEFAULT_API_KEY = "FdmjzPqKJ_mse35S2ZTukAnFwqcX4GMZFV0A3C5V3Y4";

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
    desc: "Line-item log feed of API calls containing endpoint, status code, latency, outcome, service, user context, and failure reasons for PowerBI Fact tables.",
    params: [
      { name: "service", type: "string", default: "", desc: "Filter by product line", options: ["ALL", "DDIN", "MVEND", "KORALINK"] },
      { name: "outcome", type: "string", default: "", desc: "Filter by outcome", options: ["ALL", "SUCCESS", "FAILURE", "OTHER"] },
      { name: "limit", type: "number", default: "500", desc: "Number of records (max 5000)" },
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
    desc: "Aggregated user journey session metrics including start/end time, total actions, failure counts, distinct endpoints, and user role metadata.",
    params: [
      { name: "hasFailures", type: "boolean", default: "false", desc: "Only sessions with failures", options: ["false", "true"] },
      { name: "limit", type: "number", default: "500", desc: "Number of records (max 5000)" },
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
    desc: "Evaluates vendor SLAs across integrated upstream endpoints (Koralink, Gwiza, DDIN, ResolveIt) with latency percentiles (P50 & P95) and error rates.",
    params: [
      { name: "window", type: "string", default: "24h", desc: "Evaluation window", options: ["1h", "6h", "24h", "7d", "30d"] },
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
];

export function ApiDocs() {
  const [selectedEndpointId, setSelectedEndpointId] = useState<string>("summary");
  const [apiKey, setApiKey] = useState<string>(DEFAULT_API_KEY);
  const [paramValues, setParamValues] = useState<Record<string, string>>(
    ENDPOINTS[0]!.sampleParams
  );
  const [copiedKey, setCopiedKey] = useState(false);
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

  const currentEp = useMemo(
    () => ENDPOINTS.find((e) => e.id === selectedEndpointId) ?? ENDPOINTS[0]!,
    [selectedEndpointId]
  );

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

  // Compute full query URL
  const fullUrl = useMemo(() => {
    const params = new URLSearchParams();
    for (const [k, v] of Object.entries(paramValues)) {
      if (v && v !== "ALL") {
        params.append(k, v);
      }
    }
    params.append("api_key", apiKey.trim());
    return `${apiHost}${currentEp.path}?${params.toString()}`;
  }, [apiHost, currentEp.path, paramValues, apiKey]);

  // Compute Curl Command
  const curlCommand = useMemo(() => {
    if (paramValues.format === "csv") {
      return `curl -s "${fullUrl}" -o ${currentEp.id}_export.csv`;
    }
    return `curl -s "${fullUrl}"`;
  }, [fullUrl, paramValues.format, currentEp.id]);

  // Compute PowerQuery M Code
  const mCodeSnippet = useMemo(() => {
    return `let
    ApiKey = "${apiKey.trim()}",
    BaseUrl = "${fullUrl}",
    Source = ${paramValues.format === "csv" ? 'Csv.Document(Web.Contents(BaseUrl), [Delimiter=",", Encoding=65001, QuoteStyle=QuoteStyle.Csv])' : 'Json.Document(Web.Contents(BaseUrl))'}
in
    Source`;
  }, [apiKey, fullUrl, paramValues.format]);

  const copyToClipboard = (text: string, type: "key" | "url" | "curl" | "mcode") => {
    navigator.clipboard.writeText(text);
    if (type === "key") {
      setCopiedKey(true);
      setTimeout(() => setCopiedKey(false), 2000);
    } else if (type === "url") {
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
    <div className="min-h-screen bg-zinc-950">
      {/* Public top bar (no internal dashboard nav is exposed to unauthenticated visitors) */}
      <header className="sticky top-0 z-10 border-b border-zinc-800/80 bg-zinc-950/95 backdrop-blur">
        <div className="mx-auto flex max-w-7xl items-center justify-between gap-4 px-6 py-3.5 lg:px-8">
          <Link to="/api-docs" className="flex items-center gap-2 font-semibold text-zinc-100">
            <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-emerald-500/15 ring-1 ring-emerald-500/30">
              <Activity className="h-4 w-4 text-emerald-400" />
            </span>
            <span className="text-sm tracking-tight">Koralink</span>
            <span className="hidden text-xs font-normal text-zinc-500 sm:inline">/ API Documentation</span>
          </Link>
          <Link
            to="/login"
            className="flex items-center gap-1.5 rounded-lg border border-zinc-800 bg-zinc-900 px-3 py-1.5 text-xs font-semibold text-zinc-300 transition hover:bg-zinc-800 hover:text-white"
          >
            <LogIn className="h-3.5 w-3.5" />
            Staff Login
          </Link>
        </div>
      </header>

      <div className="mx-auto max-w-7xl space-y-8 px-6 py-8 pb-16 lg:px-8">
        {/* Intro copy for unauthenticated/public visitors */}
        <div className="space-y-2">
          <div className="flex items-center gap-2 text-xs font-semibold text-emerald-400">
            <BookOpen className="h-4 w-4" />
            Public Reference
          </div>
          <p className="max-w-3xl text-sm leading-relaxed text-zinc-400">
            This page documents Koralink&apos;s read-only PowerBI &amp; Data Analyst reporting endpoints.
            Every request requires the <code className="rounded bg-zinc-900 px-1 py-0.5 text-emerald-300">X-API-Key</code> header
            (or an equivalent <code className="rounded bg-zinc-900 px-1 py-0.5 text-emerald-300">Authorization: Bearer</code> token)
            shown below — no dashboard account is needed to explore or test these endpoints. Dashboard
            staff can sign in separately via <strong className="text-zinc-300">Staff Login</strong> above.
          </p>
        </div>

        {/* Header Banner */}
        <div className="relative overflow-hidden rounded-2xl border border-zinc-800/80 bg-gradient-to-r from-zinc-900 via-zinc-900/90 to-zinc-950 p-6 shadow-2xl ring-1 ring-white/[0.04]">
        <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
          <div className="space-y-1">
            <div className="flex items-center gap-2 text-xs font-semibold text-emerald-400">
              <Code2 className="h-4 w-4" />
              Developer &amp; Analyst API Suite
            </div>
            <h1 className="text-2xl font-extrabold tracking-tight text-white sm:text-3xl">
              PowerBI &amp; Data Analyst API Playground
            </h1>
            <p className="max-w-2xl text-xs text-zinc-400">
              Test live reporting endpoints, inspect raw payload responses, and copy ready-to-use PowerQuery formulas for scheduled refreshes in PowerBI, Excel, or Tableau.
            </p>
          </div>

          <div className="flex flex-col items-start gap-2 rounded-xl border border-zinc-800/90 bg-zinc-950/80 p-3 ring-1 ring-zinc-800">
            <div className="flex items-center gap-1.5 text-xs font-semibold text-zinc-300">
              <Key className="h-3.5 w-3.5 text-amber-400" />
              Analyst API Secret Key:
            </div>
            <div className="flex items-center gap-2">
              <code className="rounded bg-zinc-900 px-2 py-1 text-xs font-mono text-emerald-300 border border-zinc-800">
                {apiKey}
              </code>
              <button
                type="button"
                onClick={() => copyToClipboard(apiKey, "key")}
                className="flex items-center gap-1 rounded bg-zinc-800 px-2 py-1 text-[11px] font-medium text-zinc-300 hover:bg-zinc-700 hover:text-white transition"
              >
                {copiedKey ? <Check className="h-3 w-3 text-emerald-400" /> : <Copy className="h-3 w-3" />}
                {copiedKey ? "Copied" : "Copy"}
              </button>
            </div>
          </div>
        </div>
      </div>

      {/* Main Grid: Sidebar List + Playground */}
      <div className="grid gap-6 lg:grid-cols-12">
        {/* Left Sidebar: Endpoint Selector */}
        <div className="space-y-3 lg:col-span-4">
          <h2 className="text-xs font-bold uppercase tracking-wider text-zinc-400 px-1">
            Analyst Endpoints ({ENDPOINTS.length})
          </h2>
          <div className="space-y-2">
            {ENDPOINTS.map((ep) => {
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
                      : "border-zinc-800/80 bg-zinc-900/40 hover:border-zinc-700 hover:bg-zinc-900/80 text-zinc-400"
                  )}
                >
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-xs font-bold text-white truncate">{ep.name}</span>
                    <span className="rounded bg-emerald-500/20 px-1.5 py-0.5 text-[10px] font-mono font-bold text-emerald-300">
                      {ep.method}
                    </span>
                  </div>
                  <code className="mt-1 block text-[11px] font-mono text-zinc-400 truncate">
                    {ep.path}
                  </code>
                  <p className="mt-1 text-[11px] text-zinc-500 line-clamp-2 leading-relaxed">
                    {ep.desc}
                  </p>
                </button>
              );
            })}
          </div>

          {/* Quick Info Box */}
          <div className="rounded-xl border border-zinc-800/80 bg-zinc-900/30 p-4 space-y-2 text-xs text-zinc-400">
            <h3 className="flex items-center gap-1.5 font-semibold text-zinc-200">
              <ShieldCheck className="h-4 w-4 text-emerald-400" />
              Supported Formats
            </h3>
            <p className="text-[11px]">
              All analyst endpoints output standard <strong className="text-zinc-300">JSON</strong> by default or direct <strong className="text-zinc-300">CSV</strong> files when <code className="text-emerald-400">?format=csv</code> is passed.
            </p>
          </div>
        </div>

        {/* Right Pane: Interactive Playground & Documentation */}
        <div className="space-y-6 lg:col-span-8">
          {/* Active Endpoint Header */}
          <div className="rounded-2xl border border-zinc-800/90 bg-zinc-900/60 p-5 space-y-4">
            <div className="flex flex-wrap items-center justify-between gap-3 border-b border-zinc-800/80 pb-4">
              <div>
                <div className="flex items-center gap-2">
                  <span className="rounded bg-emerald-500/20 px-2 py-0.5 text-xs font-mono font-bold text-emerald-400 border border-emerald-500/30">
                    {currentEp.method}
                  </span>
                  <h2 className="text-lg font-bold text-white">{currentEp.name}</h2>
                </div>
                <p className="mt-1 text-xs text-zinc-400">{currentEp.desc}</p>
              </div>
            </div>

            {/* Parameter Configuration Form */}
            <div className="space-y-3">
              <h3 className="text-xs font-bold uppercase tracking-wider text-zinc-400">
                Configure Parameters
              </h3>
              <div className="grid gap-3 sm:grid-cols-2">
                {currentEp.params.map((p) => (
                  <div key={p.name} className="space-y-1">
                    <label className="flex items-center justify-between text-xs font-semibold text-zinc-300">
                      <span>{p.name}</span>
                      <span className="text-[10px] text-zinc-500 font-mono">({p.type})</span>
                    </label>
                    {p.options ? (
                      <select
                        value={paramValues[p.name] ?? p.default}
                        onChange={(e) =>
                          setParamValues((prev) => ({ ...prev, [p.name]: e.target.value }))
                        }
                        className="w-full rounded-lg border border-zinc-800 bg-zinc-950 px-3 py-1.5 text-xs font-medium text-white outline-none focus:border-emerald-500"
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
                        className="w-full rounded-lg border border-zinc-800 bg-zinc-950 px-3 py-1.5 text-xs font-medium text-white outline-none focus:border-emerald-500"
                      />
                    )}
                    <p className="text-[10px] text-zinc-500">{p.desc}</p>
                  </div>
                ))}

                {/* API Key Override */}
                <div className="space-y-1">
                  <label className="text-xs font-semibold text-zinc-300">api_key</label>
                  <input
                    type="text"
                    value={apiKey}
                    onChange={(e) => setApiKey(e.target.value)}
                    className="w-full rounded-lg border border-zinc-800 bg-zinc-950 px-3 py-1.5 text-xs font-mono text-amber-300 outline-none focus:border-emerald-500"
                  />
                  <p className="text-[10px] text-zinc-500">Secret key for authorization</p>
                </div>
              </div>
            </div>

            {/* Generated Live URL Bar */}
            <div className="rounded-xl border border-zinc-800/80 bg-zinc-950 p-3 space-y-2">
              <div className="flex items-center justify-between text-xs font-semibold text-zinc-400">
                <span className="flex items-center gap-1.5">
                  <Database className="h-3.5 w-3.5 text-emerald-400" />
                  Generated Ready-to-Use PowerBI Endpoint URL
                </span>
                <span className="text-[10px] text-emerald-400 font-mono">Format: {paramValues.format ?? "json"}</span>
              </div>
              <div className="flex items-center gap-2 overflow-x-auto rounded-lg bg-zinc-900/90 p-2 text-xs font-mono text-zinc-200 border border-zinc-800">
                <span className="truncate select-all flex-1">{fullUrl}</span>
                <button
                  type="button"
                  onClick={() => copyToClipboard(fullUrl, "url")}
                  className="flex shrink-0 items-center gap-1 rounded bg-emerald-500/20 px-2.5 py-1 text-xs font-bold text-emerald-300 hover:bg-emerald-500/30 transition"
                >
                  {copiedUrl ? <Check className="h-3.5 w-3.5 text-emerald-400" /> : <Copy className="h-3.5 w-3.5" />}
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
                  className="flex items-center gap-1.5 rounded-xl border border-zinc-800 bg-zinc-900 px-3.5 py-2 text-xs font-semibold text-zinc-300 hover:bg-zinc-800 hover:text-white transition"
                >
                  <ExternalLink className="h-3.5 w-3.5" />
                  Open in Browser
                </a>
              </div>

              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => copyToClipboard(curlCommand, "curl")}
                  className="flex items-center gap-1.5 rounded-xl border border-zinc-800 bg-zinc-900 px-3 py-2 text-xs font-medium text-zinc-400 hover:bg-zinc-800 hover:text-zinc-200 transition"
                >
                  <Terminal className="h-3.5 w-3.5 text-cyan-400" />
                  {copiedCurl ? "Copied Curl" : "Copy Curl"}
                </button>

                <button
                  type="button"
                  onClick={() => copyToClipboard(mCodeSnippet, "mcode")}
                  className="flex items-center gap-1.5 rounded-xl border border-zinc-800 bg-zinc-900 px-3 py-2 text-xs font-medium text-zinc-400 hover:bg-zinc-800 hover:text-zinc-200 transition"
                >
                  <FileSpreadsheet className="h-3.5 w-3.5 text-amber-400" />
                  {copiedMCode ? "Copied M Code" : "Copy PowerBI M Code"}
                </button>
              </div>
            </div>
          </div>

          {/* Test Execution Output Console */}
          {testResult && (
            <div className="rounded-2xl border border-zinc-800/90 bg-zinc-950 p-5 space-y-3 shadow-xl">
              <div className="flex items-center justify-between border-b border-zinc-800/80 pb-3">
                <div className="flex items-center gap-3">
                  <span className="text-xs font-bold text-white uppercase tracking-wider">
                    Execution Response Result
                  </span>
                  <span
                    className={clsx(
                      "rounded px-2 py-0.5 text-xs font-mono font-bold",
                      testResult.status === 200
                        ? "bg-emerald-500/20 text-emerald-400"
                        : "bg-rose-500/20 text-rose-400"
                    )}
                  >
                    HTTP {testResult.status}
                  </span>
                  <span className="text-xs text-zinc-500 font-mono">
                    Time: {testResult.timeMs} ms
                  </span>
                </div>

                {testResult.isCsv && (
                  <a
                    href={`data:text/csv;charset=utf-8,${encodeURIComponent(testResult.rawText)}`}
                    download={`${currentEp.id}_export.csv`}
                    className="flex items-center gap-1 rounded bg-emerald-500/20 px-2.5 py-1 text-xs font-bold text-emerald-300 hover:bg-emerald-500/30"
                  >
                    <Download className="h-3.5 w-3.5" />
                    Download CSV
                  </a>
                )}
              </div>

              {/* Console Body */}
              <div className="max-h-96 overflow-auto rounded-xl bg-zinc-900/90 p-4 font-mono text-xs text-zinc-200 border border-zinc-800">
                {testResult.isCsv ? (
                  <pre className="whitespace-pre overflow-x-auto text-emerald-300">{testResult.rawText}</pre>
                ) : (
                  <pre className="whitespace-pre overflow-x-auto text-emerald-400">
                    {JSON.stringify(testResult.data, null, 2)}
                  </pre>
                )}
              </div>
            </div>
          )}

          {/* PowerBI Setup Instructions Card */}
          <div className="rounded-2xl border border-zinc-800/80 bg-zinc-900/40 p-5 space-y-3">
            <h3 className="flex items-center gap-2 text-sm font-bold text-white">
              <Table className="h-4 w-4 text-emerald-400" />
              PowerBI Desktop Quick Setup Instructions
            </h3>
            <ol className="list-decimal list-inside space-y-1.5 text-xs text-zinc-400 leading-relaxed">
              <li>Open <strong>PowerBI Desktop</strong> → click <strong>Get Data</strong> → <strong>Web</strong>.</li>
              <li>Select <strong>Basic</strong> URL and paste the <strong className="text-zinc-200">Generated Ready-to-Use PowerBI Endpoint URL</strong> above.</li>
              <li>Click <strong>OK</strong> — PowerBI will automatically detect the columns and parse the payload.</li>
              <li>For automated daily refreshes, click <strong>Advanced Editor</strong> in PowerQuery and paste the generated <strong>PowerBI M Code</strong> snippet.</li>
            </ol>
          </div>
        </div>
      </div>
      </div>
    </div>
  );
}
