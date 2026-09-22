import { useEffect, useMemo, useState, type ReactNode } from "react";
import { Link, useParams, useSearchParams } from "react-router-dom";
import { clsx } from "clsx";
import {
  Activity,
  AlertTriangle,
  CalendarRange,
  ChevronDown,
  Download,
  FileDown,
  FileText,
  Filter,
  Gauge,
  Globe,
  Layers,
  MousePointerClick,
  Share2,
  Users,
} from "lucide-react";
import { apiDownload, apiFetch } from "@/org/lib/api";
import { useRange, type RangePreset } from "@/org/lib/range";
import { Delta } from "@/org/lib/metrics";
import { TimeRangePicker } from "@/org/components/TimeRangePicker";
import { encodeUserKey, formatDuration } from "@/org/lib/journey";
import { BarChart, DonutChart, HorizontalBars, LineChart, Sparkline } from "@/org/components/charts";
import { EmptyState, PageHeader, Panel } from "@/org/components/ui";

type Kpi = { value: number; previous: number; delta: number | null; sparkline: number[] };
type Daily = {
  date: string;
  users: number;
  sessions: number;
  durationMs: number;
  actions: number;
  apiRequests: number;
  errors: number;
  avgLatencyMs: number;
};
type Overview = {
  range: { from: string; to: string };
  previous: { from: string; to: string };
  hasEvents: boolean;
  kpis: {
    users: Kpi;
    sessions: Kpi;
    actions: Kpi;
    apiRequests: Kpi;
    errors: Kpi;
    avgLatencyMs: Kpi;
    avgDurationMs: Kpi;
  };
  daily: Daily[];
  actionsByType: { kind: string; count: number }[];
  topScreens: { screen: string; count: number; pct: number }[];
  topApis: { method: string; path: string; requests: number; avgLatencyMs: number; errorRate: number }[];
  errorsByType: { type: string; count: number }[];
  topUsers: {
    userKey: string;
    userId: string | null;
    email: string | null;
    sessions: number;
    actions: number;
    errors: number;
  }[];
};

const TABS = [
  { id: "overview", label: "Overview" },
  { id: "activity", label: "User Activity" },
  { id: "sessions", label: "Sessions" },
  { id: "apis", label: "API Performance" },
  { id: "errors", label: "Errors" },
  { id: "funnels", label: "Funnels" },
  { id: "retention", label: "Retention" },
  { id: "custom", label: "Custom Reports" },
] as const;

type TabId = (typeof TABS)[number]["id"];

const SECTION_KEYS = [
  "behavior",
  "journeys",
  "health",
  "apis",
  "errors",
  "users",
  "recommendations",
] as const;
type SectionKey = (typeof SECTION_KEYS)[number];
type SectionFlags = Record<SectionKey, boolean>;
const DEFAULT_SECTIONS: SectionFlags = {
  behavior: true,
  journeys: true,
  health: true,
  apis: true,
  errors: true,
  users: true,
  recommendations: true,
};

type ReportType = "daily" | "weekly" | "monthly" | "custom";

function presetToReportType(preset: RangePreset): ReportType {
  if (preset === "today" || preset === "yesterday") return "daily";
  if (preset === "7d") return "weekly";
  if (preset === "30d" || preset === "this_month" || preset === "last_month") return "monthly";
  return "custom";
}

function reportTypeToPreset(type: ReportType): RangePreset {
  if (type === "daily") return "today";
  if (type === "weekly") return "7d";
  if (type === "monthly") return "this_month";
  return "custom";
}

const KIND_LABEL: Record<string, string> = {
  api: "API Call",
  navigation: "Screen View",
  click: "Button Click",
  auth: "Auth",
  lifecycle: "Lifecycle",
  system: "Other",
};

const ERROR_LABEL: Record<string, string> = {
  "5xx": "5xx Server Error",
  "4xx": "4xx Client Error",
  timeout: "Timeout",
  network: "Network Error",
  other: "Other",
};

const ERROR_COLOR: Record<string, string> = {
  "5xx": "#ef4444",
  "4xx": "#f97316",
  timeout: "#eab308",
  network: "#38bdf8",
  other: "#64748b",
};

function shortDay(date: string) {
  return new Date(`${date}T12:00:00`).toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

function KpiCard({
  label,
  kpi,
  format,
  invert,
  icon: Icon,
  color,
}: {
  label: string;
  kpi: Kpi;
  format?: (n: number) => string;
  invert?: boolean;
  icon: typeof Users;
  color: string;
}) {
  return (
    <div className="rounded-2xl border border-zinc-200/80 bg-white p-4 shadow-sm dark:border-zinc-800 dark:bg-zinc-900/60">
      <div className="flex items-start justify-between">
        <p className="text-xs font-medium uppercase tracking-wide text-zinc-500">{label}</p>
        <Icon className="h-4 w-4" style={{ color }} />
      </div>
      <p className="mt-2 text-2xl font-semibold tabular-nums">{format ? format(kpi.value) : kpi.value.toLocaleString()}</p>
      <Delta value={kpi.delta} invert={invert} />
      <Sparkline values={kpi.sparkline} color={color} className="mt-3" />
    </div>
  );
}

function PanelHead({ title, action }: { title: string; action?: ReactNode }) {
  return (
    <div className="flex items-center justify-between border-b border-zinc-200 px-5 py-3 dark:border-zinc-800">
      <h3 className="text-sm font-medium">{title}</h3>
      {action}
    </div>
  );
}

export function ReportsPage() {
  const { orgId, projectId } = useParams();
  const [params, setParams] = useSearchParams();
  const { range, setPreset } = useRange();
  const from = range.customFrom;
  const to = range.customTo;
  const tab = (TABS.some((t) => t.id === params.get("tab")) ? params.get("tab") : "overview") as TabId;
  const [data, setData] = useState<Overview | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [granularity, setGranularity] = useState<"daily" | "weekly">("daily");
  const [copied, setCopied] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [sections, setSections] = useState<SectionFlags>(DEFAULT_SECTIONS);
  const [openFilter, setOpenFilter] = useState<"period" | "sections" | "export" | null>(null);
  const reportType = presetToReportType(range.preset);
  const selectedCount = SECTION_KEYS.filter((k) => sections[k]).length;

  function toggleSection(key: SectionKey) {
    setSections((s) => ({ ...s, [key]: !s[key] }));
  }

  function setReportType(type: ReportType) {
    const preset = reportTypeToPreset(type);
    if (preset === "custom") setPreset("custom", range.customFrom, range.customTo);
    else setPreset(preset);
  }

  const query = useMemo(() => new URLSearchParams(range.query), [range.query]);

  useEffect(() => {
    if (!projectId) return;
    apiFetch<Overview>(`/console/projects/${projectId}/reports/overview?${query}`)
      .then(setData)
      .catch((e) => setError(e instanceof Error ? e.message : "Failed"));
  }, [projectId, query]);

  function setTab(id: TabId) {
    const next = new URLSearchParams(params);
    next.set("tab", id);
    setParams(next, { replace: true });
  }

  async function share() {
    const next = new URLSearchParams();
    next.set("tab", tab);
    const url = `${window.location.origin}${window.location.pathname}?${next}`;
    await navigator.clipboard.writeText(url);
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1500);
  }

  async function download(dataset: string) {
    if (!projectId) return;
    setExporting(true);
    try {
      await apiDownload(
        `/console/projects/${projectId}/reports/export?${query}&dataset=${dataset}`,
        `monitor-${dataset}-${from}.csv`
      );
    } catch (e) {
      setError(e instanceof Error ? e.message : "Export failed");
    } finally {
      setExporting(false);
    }
  }

  async function downloadPdf() {
    if (!projectId) return;
    setExporting(true);
    try {
      const pdfParams = new URLSearchParams(query);
      const selected = SECTION_KEYS.filter((k) => sections[k]);
      pdfParams.set("sections", selected.join(","));
      await apiDownload(
        `/console/projects/${projectId}/reports/pdf?${pdfParams}`,
        `monitor-report-${from}.pdf`
      );
    } catch (e) {
      setError(e instanceof Error ? e.message : "PDF export failed");
    } finally {
      setExporting(false);
    }
  }

  async function downloadExecutivePdf() {
    if (!projectId) return;
    setExporting(true);
    try {
      await apiDownload(
        `/console/projects/${projectId}/reports/executive-pdf?${query}`,
        `monitor-executive-report-${from}.pdf`
      );
    } catch (e) {
      setError(e instanceof Error ? e.message : "Executive report export failed");
    } finally {
      setExporting(false);
    }
  }

  const chart = useMemo(() => {
    if (!data) return null;
    if (granularity === "daily") {
      return {
        labels: data.daily.map((d) => shortDay(d.date)),
        users: data.daily.map((d) => d.users),
        sessions: data.daily.map((d) => d.sessions),
        duration: data.daily.map((d) => d.durationMs),
        errors: data.daily.map((d) => d.errors),
        actions: data.daily.map((d) => d.actions),
        apis: data.daily.map((d) => d.apiRequests),
      };
    }
    const buckets = new Map<string, Daily & { n: number }>();
    for (const d of data.daily) {
      const dt = new Date(`${d.date}T00:00:00Z`);
      const key = `${dt.getUTCFullYear()}-W${String(Math.ceil((dt.getUTCDate() + 6 - ((dt.getUTCDay() + 6) % 7)) / 7)).padStart(2, "0")}`;
      const cur = buckets.get(key) ?? {
        date: key,
        users: 0,
        sessions: 0,
        durationMs: 0,
        actions: 0,
        apiRequests: 0,
        errors: 0,
        avgLatencyMs: 0,
        n: 0,
      };
      cur.users += d.users;
      cur.sessions += d.sessions;
      cur.durationMs += d.durationMs;
      cur.actions += d.actions;
      cur.apiRequests += d.apiRequests;
      cur.errors += d.errors;
      cur.n += 1;
      buckets.set(key, cur);
    }
    const rows = [...buckets.values()];
    return {
      labels: rows.map((d) => d.date),
      users: rows.map((d) => d.users),
      sessions: rows.map((d) => d.sessions),
      duration: rows.map((d) => Math.round(d.durationMs / Math.max(1, d.n))),
      errors: rows.map((d) => d.errors),
      actions: rows.map((d) => d.actions),
      apis: rows.map((d) => d.apiRequests),
    };
  }, [data, granularity]);

  if (error && !data) return <p className="text-red-600">{error}</p>;
  if (!data || !chart) return <p className="text-zinc-500">Loading…</p>;

  const base = `/orgs/${orgId}/projects/${projectId}`;

  return (
    <div>
      <PageHeader
        title="Reports"
        description="Explore analytics for the selected period, then expand filters to shape and export a PDF."
        actions={
          <button type="button" className="btn-secondary" onClick={() => void share()}>
            <Share2 className="mr-1.5 h-3.5 w-3.5" />
            {copied ? "Link copied" : "Share"}
          </button>
        }
      />

      <ReportFilters
        from={from}
        to={to}
        type={reportType}
        onTypeChange={setReportType}
        sections={sections}
        selectedCount={selectedCount}
        onToggleSection={toggleSection}
        onSelectAllSections={() =>
          setSections(Object.fromEntries(SECTION_KEYS.map((k) => [k, true])) as SectionFlags)
        }
        onClearSections={() =>
          setSections(Object.fromEntries(SECTION_KEYS.map((k) => [k, false])) as SectionFlags)
        }
        open={openFilter}
        onOpenChange={setOpenFilter}
        exporting={exporting}
        onPreview={() => {
          setTab("overview");
          setOpenFilter(null);
        }}
        onPdf={() => void downloadPdf()}
        onExecutivePdf={() => void downloadExecutivePdf()}
        onCsv={() => void download("daily")}
      />

      {error && <p className="mb-3 text-sm text-red-600">{error}</p>}
      <div className="mb-6 flex gap-1 overflow-x-auto border-b border-zinc-200 dark:border-zinc-800">
        {TABS.map((t) => (
          <button
            key={t.id}
            type="button"
            onClick={() => setTab(t.id)}
            className={clsx(
              "whitespace-nowrap px-3 py-2 text-sm font-medium transition-colors",
              tab === t.id
                ? "border-b-2 border-indigo-500 text-indigo-600 dark:text-indigo-400"
                : "text-zinc-500 hover:text-zinc-800 dark:hover:text-zinc-200"
            )}
          >
            {t.label}
          </button>
        ))}
      </div>

      {tab === "overview" && (
        <OverviewTab data={data} chart={chart} granularity={granularity} onGranularity={setGranularity} base={base} />
      )}
      {tab === "activity" && <ActivityTab data={data} chart={chart} granularity={granularity} onGranularity={setGranularity} />}
      {tab === "sessions" && <SessionsTab data={data} chart={chart} />}
      {tab === "apis" && <ApisTab data={data} base={base} />}
      {tab === "errors" && <ErrorsTab data={data} chart={chart} base={base} />}
      {tab === "funnels" && <FunnelsTab projectId={projectId!} query={query} />}
      {tab === "retention" && <RetentionTab projectId={projectId!} query={query} />}
      {tab === "custom" && (
        <CustomTab
          onDownload={(d) => void download(d)}
          onDownloadPdf={() => void downloadPdf()}
          exporting={exporting}
        />
      )}
    </div>
  );
}

type ChartBlock = {
  labels: string[];
  users: number[];
  sessions: number[];
  duration: number[];
  errors: number[];
  actions: number[];
  apis: number[];
};

function OverviewTab({
  data,
  chart,
  granularity,
  onGranularity,
  base,
}: {
  data: Overview;
  chart: ChartBlock;
  granularity: "daily" | "weekly";
  onGranularity: (g: "daily" | "weekly") => void;
  base: string;
}) {
  const k = data.kpis;
  return (
    <div className="space-y-6">
      {!data.hasEvents && (
        <div className="rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900 dark:border-amber-500/30 dark:bg-amber-500/10 dark:text-amber-200">
          No events in this range.{" "}
          <Link className="font-medium underline" to={`${base}/integration`}>
            Open Integration
          </Link>
        </div>
      )}
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-6">
        <KpiCard label="Active users" kpi={k.users} icon={Users} color="#3b82f6" />
        <KpiCard label="Sessions" kpi={k.sessions} icon={Activity} color="#8b5cf6" />
        <KpiCard label="Total actions" kpi={k.actions} icon={MousePointerClick} color="#22c55e" />
        <KpiCard label="API requests" kpi={k.apiRequests} icon={Globe} color="#38bdf8" />
        <KpiCard label="Errors" kpi={k.errors} icon={AlertTriangle} color="#ef4444" invert />
        <KpiCard
          label="Avg. latency"
          kpi={k.avgLatencyMs}
          icon={Gauge}
          color="#f59e0b"
          invert
          format={(n) => `${n}ms`}
        />
      </div>
      <div className="grid gap-6 lg:grid-cols-3">
        <Panel className="lg:col-span-2">
          <PanelHead
            title="User activity over time"
            action={
              <select
                className="input w-28 py-1 text-xs"
                value={granularity}
                onChange={(e) => onGranularity(e.target.value as "daily" | "weekly")}
              >
                <option value="daily">Daily</option>
                <option value="weekly">Weekly</option>
              </select>
            }
          />
          <div className="p-4">
            <LineChart
              labels={chart.labels}
              series={[
                { name: "Active users", color: "#3b82f6", values: chart.users },
                { name: "Sessions", color: "#8b5cf6", values: chart.sessions },
              ]}
            />
          </div>
        </Panel>
        <Panel>
          <PanelHead title="Actions by type" />
          <div className="p-4">
            {data.actionsByType.length === 0 ? (
              <EmptyState title="No actions" body="Navigation, clicks, and APIs will appear here." />
            ) : (
              <DonutChart
                center={data.kpis.actions.value.toLocaleString()}
                slices={data.actionsByType.map((s) => ({
                  label: KIND_LABEL[s.kind] ?? s.kind,
                  value: s.count,
                }))}
              />
            )}
          </div>
        </Panel>
      </div>
      <div className="grid gap-6 lg:grid-cols-3">
        <Panel>
          <PanelHead
            title="Top screens"
            action={
              <Link className="text-xs text-indigo-600 dark:text-indigo-400" to={`${base}/journey`}>
                View all →
              </Link>
            }
          />
          <div className="p-4">
            <HorizontalBars
              items={data.topScreens.map((s) => ({
                label: s.screen,
                value: s.count,
                hint: `${s.count.toLocaleString()} · ${(s.pct * 100).toFixed(1)}%`,
              }))}
            />
          </div>
        </Panel>
        <Panel>
          <PanelHead title="Sessions by day" />
          <div className="p-4">
            <BarChart values={chart.sessions} labels={chart.labels} />
          </div>
        </Panel>
        <Panel>
          <PanelHead title="Errors over time" />
          <div className="p-4">
            <LineChart
              labels={chart.labels}
              series={[{ name: "Errors", color: "#ef4444", values: chart.errors }]}
            />
            <p className="mt-2 text-xs text-zinc-500">
              {data.kpis.errors.value.toLocaleString()} in range · <Delta value={data.kpis.errors.delta} invert />
            </p>
          </div>
        </Panel>
      </div>
      <div className="grid gap-6 lg:grid-cols-3">
        <Panel className="lg:col-span-1">
          <PanelHead
            title="Top API endpoints"
            action={
              <Link className="text-xs text-indigo-600 dark:text-indigo-400" to={`${base}/performance`}>
                Full report →
              </Link>
            }
          />
          <ApiTable rows={data.topApis} />
        </Panel>
        <Panel>
          <PanelHead
            title="Errors by type"
            action={
              <Link className="text-xs text-indigo-600 dark:text-indigo-400" to={`${base}/problems`}>
                View errors →
              </Link>
            }
          />
          <div className="p-4">
            {data.errorsByType.length === 0 ? (
              <EmptyState title="No failures" body="Failed API calls group here." />
            ) : (
              <DonutChart
                center={data.kpis.errors.value.toLocaleString()}
                slices={data.errorsByType.map((s) => ({
                  label: ERROR_LABEL[s.type] ?? s.type,
                  value: s.count,
                  color: ERROR_COLOR[s.type],
                }))}
              />
            )}
          </div>
        </Panel>
        <Panel>
          <PanelHead
            title="Top users by activity"
            action={
              <Link className="text-xs text-indigo-600 dark:text-indigo-400" to={`${base}/users`}>
                View all users →
              </Link>
            }
          />
          <UserTable rows={data.topUsers} base={base} />
        </Panel>
      </div>
    </div>
  );
}

function ApiTable({
  rows,
}: {
  rows: Overview["topApis"];
}) {
  return (
    <table className="w-full text-left text-sm">
      <thead className="table-head">
        <tr>
          <th className="px-4 py-2">Endpoint</th>
          <th className="px-4 py-2">Requests</th>
          <th className="px-4 py-2">Avg</th>
          <th className="px-4 py-2">Errors</th>
        </tr>
      </thead>
      <tbody>
        {rows.map((r) => (
          <tr key={`${r.method}-${r.path}`} className="border-b border-zinc-100 dark:border-zinc-800">
            <td className="max-w-[10rem] truncate px-4 py-2 font-mono text-xs">
              {r.method} {r.path}
            </td>
            <td className="px-4 py-2 tabular-nums">{r.requests.toLocaleString()}</td>
            <td className="px-4 py-2 tabular-nums">{r.avgLatencyMs}ms</td>
            <td className="px-4 py-2 tabular-nums">{(r.errorRate * 100).toFixed(1)}%</td>
          </tr>
        ))}
        {rows.length === 0 && (
          <tr>
            <td colSpan={4}>
              <EmptyState title="No API traffic" body="Requests in this range will list here." />
            </td>
          </tr>
        )}
      </tbody>
    </table>
  );
}

function UserTable({
  rows,
  base,
}: {
  rows: Overview["topUsers"];
  base: string;
}) {
  return (
    <table className="w-full text-left text-sm">
      <thead className="table-head">
        <tr>
          <th className="px-4 py-2">User</th>
          <th className="px-4 py-2">Sessions</th>
          <th className="px-4 py-2">Actions</th>
          <th className="px-4 py-2">Errors</th>
        </tr>
      </thead>
      <tbody>
        {rows.map((u) => {
          const key = encodeUserKey(u.userId, u.email ?? u.userKey);
          return (
            <tr key={u.userKey} className="border-b border-zinc-100 dark:border-zinc-800">
              <td className="px-4 py-2">
                <Link className="text-indigo-600 hover:underline dark:text-indigo-400" to={`${base}/users/${key}`}>
                  {u.email || `User ${u.userId}`}
                </Link>
              </td>
              <td className="px-4 py-2 tabular-nums">{u.sessions}</td>
              <td className="px-4 py-2 tabular-nums">{u.actions}</td>
              <td className="px-4 py-2 tabular-nums">{u.errors > 0 ? <span className="text-red-600">{u.errors}</span> : 0}</td>
            </tr>
          );
        })}
        {rows.length === 0 && (
          <tr>
            <td colSpan={4}>
              <EmptyState title="No identified users" body="Identify users on ingest to rank activity." />
            </td>
          </tr>
        )}
      </tbody>
    </table>
  );
}

function ActivityTab({
  data,
  chart,
  granularity,
  onGranularity,
}: {
  data: Overview;
  chart: ChartBlock;
  granularity: "daily" | "weekly";
  onGranularity: (g: "daily" | "weekly") => void;
}) {
  return (
    <div className="space-y-6">
      <div className="flex justify-end">
        <select
          className="input w-32"
          value={granularity}
          onChange={(e) => onGranularity(e.target.value as "daily" | "weekly")}
        >
          <option value="daily">Daily</option>
          <option value="weekly">Weekly</option>
        </select>
      </div>
      <Panel>
        <PanelHead title="Active users and sessions" />
        <div className="p-4">
          <LineChart
            labels={chart.labels}
            series={[
              { name: "Active users", color: "#3b82f6", values: chart.users },
              { name: "Sessions", color: "#8b5cf6", values: chart.sessions },
              { name: "Actions", color: "#22c55e", values: chart.actions },
            ]}
          />
        </div>
      </Panel>
      <div className="grid gap-6 lg:grid-cols-2">
        <Panel>
          <PanelHead title="Top screens" />
          <div className="p-4">
            <HorizontalBars
              items={data.topScreens.map((s) => ({
                label: s.screen,
                value: s.count,
                hint: s.count.toLocaleString(),
              }))}
            />
          </div>
        </Panel>
        <Panel>
          <PanelHead title="Actions by type" />
          <div className="p-4">
            <DonutChart
              center={data.kpis.actions.value.toLocaleString()}
              slices={data.actionsByType.map((s) => ({
                label: KIND_LABEL[s.kind] ?? s.kind,
                value: s.count,
              }))}
            />
          </div>
        </Panel>
      </div>
    </div>
  );
}

function SessionsTab({ data, chart }: { data: Overview; chart: ChartBlock }) {
  return (
    <div className="space-y-6">
      <div className="grid gap-3 sm:grid-cols-3">
        <KpiCard label="Sessions" kpi={data.kpis.sessions} icon={Activity} color="#8b5cf6" />
        <KpiCard
          label="Avg duration"
          kpi={data.kpis.avgDurationMs}
          icon={Gauge}
          color="#3b82f6"
          format={(n) => formatDuration(n)}
        />
        <KpiCard label="Active users" kpi={data.kpis.users} icon={Users} color="#3b82f6" />
      </div>
      <div className="grid gap-6 lg:grid-cols-2">
        <Panel>
          <PanelHead title="Sessions by day" />
          <div className="p-4">
            <BarChart values={chart.sessions} labels={chart.labels} />
          </div>
        </Panel>
        <Panel>
          <PanelHead title="Average session duration" />
          <div className="p-4">
            <LineChart
              labels={chart.labels}
              series={[{ name: "Duration (ms)", color: "#3b82f6", values: chart.duration }]}
            />
            <p className="mt-2 text-sm text-zinc-500">
              {formatDuration(data.kpis.avgDurationMs.value)} average ·{" "}
              <Delta value={data.kpis.avgDurationMs.delta} />
            </p>
          </div>
        </Panel>
      </div>
    </div>
  );
}

function ApisTab({ data, base }: { data: Overview; base: string }) {
  return (
    <div className="space-y-6">
      <div className="grid gap-3 sm:grid-cols-3">
        <KpiCard label="API requests" kpi={data.kpis.apiRequests} icon={Globe} color="#38bdf8" />
        <KpiCard
          label="Avg. latency"
          kpi={data.kpis.avgLatencyMs}
          icon={Gauge}
          color="#f59e0b"
          invert
          format={(n) => `${n}ms`}
        />
        <KpiCard label="Errors" kpi={data.kpis.errors} icon={AlertTriangle} color="#ef4444" invert />
      </div>
      <Panel>
        <PanelHead
          title="Top API endpoints"
          action={
            <Link className="text-xs text-indigo-600 dark:text-indigo-400" to={`${base}/performance`}>
              Latency report →
            </Link>
          }
        />
        <ApiTable rows={data.topApis} />
      </Panel>
    </div>
  );
}

function ErrorsTab({ data, chart, base }: { data: Overview; chart: ChartBlock; base: string }) {
  return (
    <div className="space-y-6">
      <KpiCard label="Errors" kpi={data.kpis.errors} icon={AlertTriangle} color="#ef4444" invert />
      <div className="grid gap-6 lg:grid-cols-2">
        <Panel>
          <PanelHead title="Errors over time" />
          <div className="p-4">
            <LineChart
              labels={chart.labels}
              series={[{ name: "Errors", color: "#ef4444", values: chart.errors }]}
            />
          </div>
        </Panel>
        <Panel>
          <PanelHead
            title="Errors by type"
            action={
              <Link className="text-xs text-indigo-600 dark:text-indigo-400" to={`${base}/problems`}>
                Problems →
              </Link>
            }
          />
          <div className="p-4">
            <DonutChart
              center={data.kpis.errors.value.toLocaleString()}
              slices={data.errorsByType.map((s) => ({
                label: ERROR_LABEL[s.type] ?? s.type,
                value: s.count,
                color: ERROR_COLOR[s.type],
              }))}
            />
          </div>
        </Panel>
      </div>
    </div>
  );
}

function FunnelsTab({ projectId, query }: { projectId: string; query: URLSearchParams }) {
  const [data, setData] = useState<{
    steps: { screen: string; users: number; conversion: number }[];
    conversion: number;
    dropoff: { from: string; to: string; fromCount: number; toCount: number; rate: number; causes: string[] } | null;
  } | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    apiFetch<{
      steps: { screen: string; users: number; conversion: number }[];
      conversion: number;
      dropoff: { from: string; to: string; fromCount: number; toCount: number; rate: number; causes: string[] } | null;
    }>(`/console/projects/${projectId}/reports/funnels?${query}`)
      .then(setData)
      .catch((e) => setError(e instanceof Error ? e.message : "Failed"));
  }, [projectId, query]);
  if (error) return <p className="text-red-600">{error}</p>;
  if (!data) return <p className="text-zinc-500">Loading…</p>;
  const max = Math.max(1, ...data.steps.map((s) => s.users));
  return (
    <div className="grid gap-6 lg:grid-cols-2">
      <Panel>
        <PanelHead title="Screen funnel" />
        <div className="space-y-3 p-5">
          {data.steps.length === 0 ? (
            <EmptyState title="No navigation funnel" body="Send screen views with from_screen to build a path." />
          ) : (
            data.steps.map((s, i) => (
              <div key={s.screen}>
                <div className="mb-1 flex justify-between text-sm">
                  <span className="font-mono text-xs">
                    {i + 1}. {s.screen}
                  </span>
                  <span className="text-xs text-zinc-500">
                    {s.users.toLocaleString()} · {(s.conversion * 100).toFixed(0)}%
                  </span>
                </div>
                <div className="h-8 overflow-hidden rounded-lg bg-zinc-100 dark:bg-zinc-800">
                  <div
                    className="flex h-full items-center rounded-lg bg-indigo-500/80 px-2 text-xs text-white"
                    style={{ width: `${Math.max(12, (s.users / max) * 100)}%` }}
                  />
                </div>
              </div>
            ))
          )}
        </div>
      </Panel>
      {data.dropoff && (
        <Panel>
          <PanelHead title="Largest drop-off" />
          <div className="space-y-2 p-5 text-sm">
            <p>
              {data.dropoff.from} → {data.dropoff.to}
            </p>
            <p className="text-zinc-500">
              {data.dropoff.fromCount} → {data.dropoff.toCount}
            </p>
            <ul className="list-inside list-disc text-zinc-600 dark:text-zinc-300">
              {data.dropoff.causes.map((c) => (
                <li key={c}>{c}</li>
              ))}
            </ul>
          </div>
        </Panel>
      )}
    </div>
  );
}

function RetentionTab({ projectId, query }: { projectId: string; query: URLSearchParams }) {
  const [data, setData] = useState<{
    days: { date: string; users: number; returned1d: number; returned7d: number; rate1d: number; rate7d: number }[];
  } | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    apiFetch<{
      days: { date: string; users: number; returned1d: number; returned7d: number; rate1d: number; rate7d: number }[];
    }>(`/console/projects/${projectId}/reports/retention?${query}`)
      .then(setData)
      .catch((e) => setError(e instanceof Error ? e.message : "Failed"));
  }, [projectId, query]);
  if (error) return <p className="text-red-600">{error}</p>;
  if (!data) return <p className="text-zinc-500">Loading…</p>;
  return (
    <div className="space-y-6">
      <Panel>
        <PanelHead title="Return rate" />
        <div className="p-4">
          <LineChart
            labels={data.days.map((d) => shortDay(d.date))}
            series={[
              { name: "D1 retention %", color: "#3b82f6", values: data.days.map((d) => Math.round(d.rate1d * 100)) },
              { name: "D7 retention %", color: "#8b5cf6", values: data.days.map((d) => Math.round(d.rate7d * 100)) },
            ]}
          />
        </div>
      </Panel>
      <Panel>
        <table className="w-full text-left text-sm">
          <thead className="table-head">
            <tr>
              <th className="px-4 py-2">Date</th>
              <th className="px-4 py-2">Users</th>
              <th className="px-4 py-2">Returned next day</th>
              <th className="px-4 py-2">D1</th>
              <th className="px-4 py-2">Returned in 7d</th>
              <th className="px-4 py-2">D7</th>
            </tr>
          </thead>
          <tbody>
            {[...data.days].reverse().map((d) => (
              <tr key={d.date} className="border-b border-zinc-100 dark:border-zinc-800">
                <td className="px-4 py-2">{shortDay(d.date)}</td>
                <td className="px-4 py-2 tabular-nums">{d.users}</td>
                <td className="px-4 py-2 tabular-nums">{d.returned1d}</td>
                <td className="px-4 py-2 tabular-nums">{(d.rate1d * 100).toFixed(0)}%</td>
                <td className="px-4 py-2 tabular-nums">{d.returned7d}</td>
                <td className="px-4 py-2 tabular-nums">{(d.rate7d * 100).toFixed(0)}%</td>
              </tr>
            ))}
          </tbody>
        </table>
      </Panel>
    </div>
  );
}

const SECTION_OPTIONS: { key: SectionKey; label: string; hint: string }[] = [
  { key: "behavior", label: "User Behavior", hint: "Screens, actions, engagement" },
  { key: "journeys", label: "User Journeys", hint: "Paths and funnel steps" },
  { key: "health", label: "System Health", hint: "Availability and latency" },
  { key: "apis", label: "API Performance", hint: "Endpoints and outcomes" },
  { key: "errors", label: "Errors", hint: "Failures by type" },
  { key: "users", label: "Affected Users", hint: "Who hit problems" },
  { key: "recommendations", label: "Recommendations", hint: "Suggested follow-ups" },
];

const TYPE_OPTIONS: { id: ReportType; label: string; hint: string }[] = [
  { id: "daily", label: "Daily", hint: "Today" },
  { id: "weekly", label: "Weekly", hint: "Last 7 days" },
  { id: "monthly", label: "Monthly", hint: "This month" },
  { id: "custom", label: "Custom", hint: "Pick dates" },
];

function FilterChip({
  active,
  icon: Icon,
  label,
  value,
  onClick,
}: {
  active: boolean;
  icon: typeof Filter;
  label: string;
  value: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-expanded={active}
      className={clsx(
        "group flex min-w-0 items-center gap-2 rounded-xl border px-3 py-2 text-left transition-all",
        active
          ? "border-indigo-500 bg-indigo-50 shadow-sm ring-1 ring-indigo-500/30 dark:border-indigo-400 dark:bg-indigo-500/10"
          : "border-zinc-200 bg-white hover:border-zinc-300 hover:bg-zinc-50 dark:border-zinc-800 dark:bg-zinc-900/60 dark:hover:border-zinc-700"
      )}
    >
      <span
        className={clsx(
          "flex h-8 w-8 shrink-0 items-center justify-center rounded-lg",
          active
            ? "bg-indigo-500/15 text-indigo-600 dark:text-indigo-300"
            : "bg-zinc-100 text-zinc-500 dark:bg-zinc-800"
        )}
      >
        <Icon className="h-4 w-4" />
      </span>
      <span className="min-w-0 flex-1">
        <span className="block text-[10px] font-semibold uppercase tracking-wider text-zinc-400">
          {label}
        </span>
        <span className="block truncate text-sm font-medium text-zinc-900 dark:text-zinc-100">
          {value}
        </span>
      </span>
      <ChevronDown
        className={clsx(
          "h-4 w-4 shrink-0 text-zinc-400 transition-transform duration-200",
          active && "rotate-180 text-indigo-500"
        )}
      />
    </button>
  );
}

function ReportFilters({
  from,
  to,
  type,
  onTypeChange,
  sections,
  selectedCount,
  onToggleSection,
  onSelectAllSections,
  onClearSections,
  open,
  onOpenChange,
  exporting,
  onPreview,
  onPdf,
  onExecutivePdf,
  onCsv,
}: {
  from: string;
  to: string;
  type: ReportType;
  onTypeChange: (type: ReportType) => void;
  sections: SectionFlags;
  selectedCount: number;
  onToggleSection: (key: SectionKey) => void;
  onSelectAllSections: () => void;
  onClearSections: () => void;
  open: "period" | "sections" | "export" | null;
  onOpenChange: (v: "period" | "sections" | "export" | null) => void;
  exporting: boolean;
  onPreview: () => void;
  onPdf: () => void;
  onExecutivePdf: () => void;
  onCsv: () => void;
}) {
  function toggle(panel: "period" | "sections" | "export") {
    onOpenChange(open === panel ? null : panel);
  }

  const typeLabel = TYPE_OPTIONS.find((t) => t.id === type)?.label ?? "Custom";
  const rangeLabel = from === to ? from : `${from} → ${to}`;

  return (
    <div className="mb-6 overflow-hidden rounded-2xl border border-zinc-200/80 bg-white shadow-sm dark:border-zinc-800 dark:bg-zinc-900/60">
      <div className="flex flex-col gap-3 border-b border-zinc-100 p-3 dark:border-zinc-800 sm:flex-row sm:items-center sm:justify-between sm:px-4">
        <div className="flex items-center gap-2 text-xs font-medium text-zinc-500">
          <Filter className="h-3.5 w-3.5" />
          Filters
          <span className="rounded-full bg-zinc-100 px-2 py-0.5 tabular-nums text-[10px] dark:bg-zinc-800">
            {selectedCount}/{SECTION_KEYS.length} sections
          </span>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <TimeRangePicker />
          <button
            type="button"
            className="btn-primary"
            disabled={exporting || selectedCount === 0}
            onClick={onPdf}
          >
            <FileDown className="mr-1.5 h-3.5 w-3.5" />
            {exporting ? "Exporting…" : "Generate PDF"}
          </button>
        </div>
      </div>

      <div className="grid gap-2 p-3 sm:grid-cols-3 sm:px-4 sm:pb-4">
        <FilterChip
          active={open === "period"}
          icon={CalendarRange}
          label="Period"
          value={`${typeLabel} · ${rangeLabel}`}
          onClick={() => toggle("period")}
        />
        <FilterChip
          active={open === "sections"}
          icon={Layers}
          label="Include in PDF"
          value={
            selectedCount === SECTION_KEYS.length
              ? "All sections"
              : selectedCount === 0
                ? "None selected"
                : `${selectedCount} sections`
          }
          onClick={() => toggle("sections")}
        />
        <FilterChip
          active={open === "export"}
          icon={Download}
          label="Export"
          value="PDF, executive, CSV"
          onClick={() => toggle("export")}
        />
      </div>

      <div
        className={clsx(
          "grid transition-[grid-template-rows] duration-300 ease-out",
          open ? "grid-rows-[1fr]" : "grid-rows-[0fr]"
        )}
      >
        <div className="overflow-hidden">
          {open === "period" && (
            <div className="border-t border-zinc-100 px-4 py-4 dark:border-zinc-800">
              <p className="mb-3 text-xs font-semibold uppercase tracking-wider text-zinc-400">
                Report type
              </p>
              <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
                {TYPE_OPTIONS.map((opt) => (
                  <label
                    key={opt.id}
                    className={clsx(
                      "flex cursor-pointer items-start gap-3 rounded-xl border p-3 transition",
                      type === opt.id
                        ? "border-indigo-500 bg-indigo-50 ring-1 ring-indigo-500/20 dark:border-indigo-400 dark:bg-indigo-500/10"
                        : "border-zinc-200 hover:border-zinc-300 dark:border-zinc-800"
                    )}
                  >
                    <input
                      type="radio"
                      className="mt-1"
                      name="rtype"
                      checked={type === opt.id}
                      onChange={() => onTypeChange(opt.id)}
                    />
                    <span>
                      <span className="block text-sm font-medium">{opt.label}</span>
                      <span className="text-xs text-zinc-500">{opt.hint}</span>
                    </span>
                  </label>
                ))}
              </div>
              <div className="mt-4 flex flex-wrap items-center justify-between gap-3 rounded-xl bg-zinc-50 px-4 py-3 dark:bg-zinc-800/50">
                <div>
                  <p className="text-[10px] font-semibold uppercase tracking-wider text-zinc-400">
                    Active range
                  </p>
                  <p className="text-sm font-medium tabular-nums">{rangeLabel}</p>
                </div>
                <TimeRangePicker />
              </div>
            </div>
          )}

          {open === "sections" && (
            <div className="border-t border-zinc-100 px-4 py-4 dark:border-zinc-800">
              <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
                <p className="text-xs font-semibold uppercase tracking-wider text-zinc-400">
                  Sections in generated PDF
                </p>
                <div className="flex gap-2 text-xs">
                  <button
                    type="button"
                    className="font-medium text-indigo-600 hover:underline dark:text-indigo-400"
                    onClick={onSelectAllSections}
                  >
                    Select all
                  </button>
                  <span className="text-zinc-300">·</span>
                  <button
                    type="button"
                    className="font-medium text-zinc-500 hover:underline"
                    onClick={onClearSections}
                  >
                    Clear
                  </button>
                </div>
              </div>
              <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
                {SECTION_OPTIONS.map((opt) => (
                  <label
                    key={opt.key}
                    className={clsx(
                      "flex cursor-pointer items-start gap-3 rounded-xl border p-3 transition",
                      sections[opt.key]
                        ? "border-indigo-500/60 bg-indigo-50/80 dark:border-indigo-400/50 dark:bg-indigo-500/10"
                        : "border-zinc-200 opacity-70 hover:opacity-100 dark:border-zinc-800"
                    )}
                  >
                    <input
                      type="checkbox"
                      className="mt-1"
                      checked={sections[opt.key]}
                      onChange={() => onToggleSection(opt.key)}
                    />
                    <span>
                      <span className="block text-sm font-medium">{opt.label}</span>
                      <span className="text-xs text-zinc-500">{opt.hint}</span>
                    </span>
                  </label>
                ))}
              </div>
            </div>
          )}

          {open === "export" && (
            <div className="border-t border-zinc-100 px-4 py-4 dark:border-zinc-800">
              <p className="mb-3 text-xs font-semibold uppercase tracking-wider text-zinc-400">
                Download options
              </p>
              <div className="grid gap-3 sm:grid-cols-3">
                <button
                  type="button"
                  className="flex flex-col items-start gap-2 rounded-xl border border-indigo-500 bg-indigo-50 p-4 text-left transition hover:bg-indigo-100/80 disabled:opacity-50 dark:border-indigo-400 dark:bg-indigo-500/10"
                  disabled={exporting || selectedCount === 0}
                  onClick={onPdf}
                >
                  <FileDown className="h-5 w-5 text-indigo-600 dark:text-indigo-300" />
                  <span className="text-sm font-semibold">Generate PDF</span>
                  <span className="text-xs text-zinc-500">
                    Formatted report with {selectedCount} selected section
                    {selectedCount === 1 ? "" : "s"}
                  </span>
                </button>
                <button
                  type="button"
                  className="flex flex-col items-start gap-2 rounded-xl border border-zinc-200 p-4 text-left transition hover:border-zinc-300 hover:bg-zinc-50 disabled:opacity-50 dark:border-zinc-800 dark:hover:bg-zinc-800/50"
                  disabled={exporting}
                  onClick={onExecutivePdf}
                >
                  <FileText className="h-5 w-5 text-zinc-600 dark:text-zinc-300" />
                  <span className="text-sm font-semibold">Executive report</span>
                  <span className="text-xs text-zinc-500">
                    Narrative summary for management
                  </span>
                </button>
                <button
                  type="button"
                  className="flex flex-col items-start gap-2 rounded-xl border border-zinc-200 p-4 text-left transition hover:border-zinc-300 hover:bg-zinc-50 disabled:opacity-50 dark:border-zinc-800 dark:hover:bg-zinc-800/50"
                  disabled={exporting}
                  onClick={onCsv}
                >
                  <Download className="h-5 w-5 text-zinc-600 dark:text-zinc-300" />
                  <span className="text-sm font-semibold">Export CSV</span>
                  <span className="text-xs text-zinc-500">Daily activity spreadsheet</span>
                </button>
              </div>
              <div className="mt-4 flex flex-wrap gap-2">
                <button type="button" className="btn-secondary" onClick={onPreview}>
                  Preview overview
                </button>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function CustomTab({
  onDownload,
  onDownloadPdf,
  exporting,
}: {
  onDownload: (dataset: string) => void;
  onDownloadPdf: () => void;
  exporting: boolean;
}) {
  const [dataset, setDataset] = useState("daily");
  return (
    <div className="space-y-6">
      <Panel>
        <PanelHead title="Full report (PDF)" />
        <div className="space-y-4 p-5">
          <p className="text-sm text-zinc-500">
            A formatted overview of KPIs, activity, APIs, errors, funnels and retention for the date range
            above. Use the Include filter to choose sections.
          </p>
          <button type="button" className="btn-primary" disabled={exporting} onClick={onDownloadPdf}>
            <FileDown className="mr-1.5 h-3.5 w-3.5" />
            Download PDF
          </button>
        </div>
      </Panel>
      <Panel>
        <PanelHead title="Build a CSV export" />
        <div className="space-y-4 p-5">
          <p className="text-sm text-zinc-500">
            Uses the date range above. Pick a dataset, then download. Open the file in Sheets or Excel.
          </p>
          <label className="block max-w-sm text-xs font-medium text-zinc-500">
            Dataset
            <select className="input mt-1" value={dataset} onChange={(e) => setDataset(e.target.value)}>
              <option value="daily">Daily activity</option>
              <option value="users">Top users</option>
              <option value="screens">Top screens</option>
              <option value="apis">API endpoints</option>
              <option value="errors">Errors by type</option>
              <option value="funnels">Screen transitions</option>
              <option value="retention">Retention</option>
            </select>
          </label>
          <button type="button" className="btn-secondary" disabled={exporting} onClick={() => onDownload(dataset)}>
            <Download className="mr-1.5 h-3.5 w-3.5" />
            Download CSV
          </button>
        </div>
      </Panel>
    </div>
  );
}

