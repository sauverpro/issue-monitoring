import { useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { ShieldAlert, Wallet } from "lucide-react";
import { apiFetch } from "@/org/lib/api";
import { useRange } from "@/org/lib/range";
import { useCanManage } from "@/org/lib/auth";
import { TimeRangePicker } from "@/org/components/TimeRangePicker";
import { LineChart } from "@/org/components/charts";
import { Badge, EmptyState, PageHeader, Panel, StatCard } from "@/org/components/ui";
import { fmtPct, rateTone, type PaymentChannel, type PaymentsReport } from "@/org/lib/productOps";

const STATUS: Record<PaymentChannel["statusNow"], { label: string; tone: "green" | "amber" | "red" | "neutral" }> = {
  operational: { label: "Operational", tone: "green" },
  degraded: { label: "Degraded", tone: "amber" },
  down: { label: "Down", tone: "red" },
  no_data: { label: "No traffic (5 min)", tone: "neutral" },
};

const shortDay = (d: string) => new Date(`${d}T00:00:00`).toLocaleDateString(undefined, { day: "numeric", month: "short" });

export function PaymentsPage() {
  const { orgId, projectId } = useParams();
  const canManage = useCanManage(orgId);
  const { range } = useRange();
  const [data, setData] = useState<PaymentsReport | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    apiFetch<PaymentsReport>(`/console/projects/${projectId}/payments?${range.query}`)
      .then((d) => {
        setData(d);
        setError(null);
      })
      .catch((e) => setError(e instanceof Error ? e.message : "Failed to load payments"));
  }, [projectId, range.query]);

  if (error && !data) return <p className="text-red-600">{error}</p>;
  if (!data) return <p className="text-zinc-500">Loading…</p>;
  const o = data.overall;
  const settings = `/orgs/${orgId}/projects/${projectId}/settings`;

  return (
    <div>
      <PageHeader
        eyebrow="Application"
        title="Payments"
        description="Wallet and payment reliability per channel. An agent who cannot transact cannot earn, so payment services alert at a lower error rate than other APIs."
        actions={<TimeRangePicker />}
      />

      {data.channels.length === 0 ? (
        <Panel>
          <EmptyState
            title="No payment channels tagged"
            body={canManage ? "In Settings, set an upstream's category to Payments (primary or backup) to track it here." : "An admin can tag payment upstreams in Settings."}
          />
        </Panel>
      ) : (
        <>
          <div className="mb-6 grid grid-cols-2 gap-3 lg:grid-cols-4">
            <StatCard label="Payment success rate" value={fmtPct(o.successRate)} hint={range.label} />
            <StatCard label="Payment calls" value={o.calls.toLocaleString()} hint={`${o.failures.toLocaleString()} failed`} />
            <StatCard label="Agents affected" value={o.agentsAffected.toLocaleString()} hint="At least one failed payment call" />
            <StatCard label="Channels" value={data.channels.length} hint={data.hasBackup ? "Backup configured" : "No backup channel"} />
          </div>

          {!data.hasBackup && (
            <div className="mb-6 flex items-start gap-3 rounded-xl border border-amber-300 bg-amber-50 p-4 text-sm text-amber-900 dark:border-amber-500/40 dark:bg-amber-500/10 dark:text-amber-200">
              <ShieldAlert className="mt-0.5 h-4 w-4 shrink-0" />
              <div>
                <p className="font-medium">No backup payment channel</p>
                <p className="mt-0.5">
                  If the primary rail fails, agents have no alternative. Add the mobile-money or secondary provider's API host as an upstream and tag it as a{" "}
                  <em>backup</em> payment channel so its readiness is tracked here.
                  {canManage && (
                    <>
                      {" "}
                      <Link className="font-medium underline" to={settings}>
                        Open Settings
                      </Link>
                    </>
                  )}
                </p>
              </div>
            </div>
          )}

          <div className="space-y-6">
            {data.channels.map((c) => (
              <ChannelCard key={c.slug} c={c} />
            ))}
          </div>
        </>
      )}
    </div>
  );
}

function ChannelCard({ c }: { c: PaymentChannel }) {
  const st = STATUS[c.statusNow];
  const days = c.daily.filter((d) => d.successRate != null);
  return (
    <Panel>
      <div className="flex flex-wrap items-center gap-2 border-b border-zinc-200 px-5 py-3 dark:border-zinc-800">
        <Wallet className="h-4 w-4 text-indigo-500" />
        <p className="text-sm font-semibold">{c.label}</p>
        {c.role && <Badge tone={c.role === "primary" ? "indigo" : "sky"}>{c.role === "primary" ? "Primary" : "Backup"}</Badge>}
        <span className="text-xs text-zinc-400">{c.host}</span>
        <span className="ml-auto flex items-center gap-2 text-xs text-zinc-500">
          Alerts at {+c.thresholdPct.toFixed(1)}% errors
          <Badge tone={st.tone}>{st.label}</Badge>
        </span>
      </div>
      <div className="grid gap-px bg-zinc-100 dark:bg-zinc-800 sm:grid-cols-3 lg:grid-cols-6">
        {[
          ["Success rate", <Badge key="s" tone={rateTone(c.successRate, 0.98, 0.9)}>{fmtPct(c.successRate)}</Badge>],
          ["Calls", c.calls.toLocaleString()],
          ["Failed", c.failures.toLocaleString()],
          ["Agents", c.agents.toLocaleString()],
          ["Agents affected", c.agentsAffected.toLocaleString()],
          ["Incidents", c.incidents.toLocaleString()],
        ].map(([label, value]) => (
          <div key={label as string} className="bg-white px-5 py-3 dark:bg-zinc-900/60">
            <p className="text-[11px] uppercase tracking-wide text-zinc-400">{label}</p>
            <div className="mt-1 text-lg font-semibold tabular-nums">{value}</div>
          </div>
        ))}
      </div>
      <div className="grid gap-6 p-5 lg:grid-cols-2">
        <div>
          <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-zinc-400">Daily success rate</p>
          {days.length < 2 ? (
            <p className="text-xs text-zinc-500">Not enough days with traffic to plot.</p>
          ) : (
            <LineChart
              labels={days.map((d) => shortDay(d.date))}
              series={[{ name: "Success %", color: "#6366f1", values: days.map((d) => Math.round((d.successRate ?? 0) * 1000) / 10) }]}
              height={160}
            />
          )}
        </div>
        <div>
          <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-zinc-400">Where payments fail</p>
          {c.failingEndpoints.length === 0 ? (
            <p className="text-xs text-zinc-500">No failed payment calls in this period.</p>
          ) : (
            <table className="w-full text-xs">
              <thead>
                <tr className="text-left text-zinc-400">
                  <th className="pb-1.5 font-medium">Call</th>
                  <th className="pb-1.5 text-right font-medium">Failed</th>
                  <th className="pb-1.5 text-right font-medium">Rate</th>
                  <th className="pb-1.5 text-right font-medium">Agents</th>
                  <th className="pb-1.5 text-right font-medium">Mostly</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-zinc-100 dark:divide-zinc-800">
                {c.failingEndpoints.map((e) => (
                  <tr key={`${e.method} ${e.path}`}>
                    <td className="max-w-[220px] truncate py-1.5 font-mono">
                      {e.method} {e.path}
                    </td>
                    <td className="py-1.5 text-right tabular-nums">{e.failures.toLocaleString()}</td>
                    <td className="py-1.5 text-right tabular-nums">{fmtPct(e.failures / Math.max(1, e.calls), 0)}</td>
                    <td className="py-1.5 text-right tabular-nums">{e.agents}</td>
                    <td className="py-1.5 text-right tabular-nums text-zinc-500">{e.topStatus ?? "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </div>
    </Panel>
  );
}
