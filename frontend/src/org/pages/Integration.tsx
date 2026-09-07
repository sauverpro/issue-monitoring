import { useEffect, useMemo, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { clsx } from "clsx";
import { apiFetch } from "@/org/lib/api";
import {
  snippetFor,
  TAB_LABELS,
  type IntegrationInfo,
  type SnippetTab,
} from "@/org/lib/integrationSnippets";
import { PageHeader, Panel } from "@/org/components/ui";

const HTTP_TABS: SnippetTab[] = ["curl", "fetch", "axios"];
const SDK_TABS: SnippetTab[] = ["sdk-web", "sdk-rn"];

export function IntegrationPage() {
  const { orgId, projectId } = useParams();
  const settings = `/orgs/${orgId}/projects/${projectId}/settings`;
  const [info, setInfo] = useState<IntegrationInfo | null>(null);
  const [tab, setTab] = useState<SnippetTab>("curl");
  const [copied, setCopied] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!projectId) return;
    apiFetch<IntegrationInfo>(`/console/projects/${projectId}/integration`)
      .then((d) => {
        setInfo({
          ...d,
          configUrl: d.configUrl ?? `${d.ingestUrl}/config`,
        });
        setTab(d.platform === "react-native" ? "fetch" : "curl");
      })
      .catch((e) => setError(e instanceof Error ? e.message : "Failed to load"));
  }, [projectId]);

  const snippet = useMemo(() => (info ? snippetFor(tab, info) : ""), [info, tab]);

  function copy(label: string, text: string) {
    void navigator.clipboard.writeText(text);
    setCopied(label);
    setTimeout(() => setCopied(null), 1500);
  }

  if (error) return <p className="text-red-600">{error}</p>;
  if (!info) return <p className="text-zinc-500">Loading…</p>;

  return (
    <div>
      <PageHeader
        eyebrow="Project"
        title="Integration"
        description="Call the ingest URLs from any stack. No npm package required. Follow the checklist until Overview, Sessions, and APIs match production."
      />

      <div className="mb-6 grid gap-3 sm:grid-cols-2">
        <UrlCard
          label="This PC (curl / browser)"
          value={info.ingestUrl}
          copied={copied === "ingest"}
          onCopy={() => copy("ingest", info.ingestUrl)}
        />
        <UrlCard
          label="GET config (this PC)"
          value={info.configUrl}
          copied={copied === "config"}
          onCopy={() => copy("config", info.configUrl)}
        />
        {info.deviceIngestUrl && info.deviceIngestUrl !== info.ingestUrl && (
          <UrlCard
            label="Phone / Expo Go (same Wi‑Fi)"
            value={info.deviceIngestUrl}
            copied={copied === "device"}
            onCopy={() => copy("device", info.deviceIngestUrl!)}
          />
        )}
        {info.androidEmulatorIngestUrl && (
          <UrlCard
            label="Android emulator"
            value={info.androidEmulatorIngestUrl}
            copied={copied === "emu"}
            onCopy={() => copy("emu", info.androidEmulatorIngestUrl!)}
          />
        )}
      </div>

      <p className="mb-6 rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900 dark:border-amber-500/30 dark:bg-amber-500/10 dark:text-amber-200">
        <strong>Network Error</strong> on a phone means <code>localhost</code> is the device, not this
        computer. Paste the <em>Phone / Expo Go</em> URL into the app (same Wi‑Fi). Android emulator
        uses <code>{info.androidEmulatorIngestUrl ?? "http://10.0.2.2:3000/ingest/v1"}</code>. Enable
        cleartext HTTP in Expo (<code>android.usesCleartextTraffic: true</code>). Allow Node.js through
        Windows Firewall on this API port. Ignore{" "}
        <code>Route "./sentry.config.ts" is missing the required default export</code> — move that file
        out of Expo Router’s <code>app/</code> folder.
      </p>

      <Panel className="mb-6">
        <div className="border-b border-zinc-200 px-5 py-3 text-sm font-medium dark:border-zinc-800">
          Until this system manages the app
        </div>
        <ol className="list-decimal space-y-2 px-5 py-4 pl-10 text-sm text-zinc-600 dark:text-zinc-400">
          <li>
            Add every production API host in{" "}
            <Link className="font-medium text-indigo-600 dark:text-indigo-400" to={settings}>
              Settings
            </Link>
            . Current: {info.allowedHosts.length ? info.allowedHosts.join(", ") : "(none — API events will be dropped)"}.
          </li>
          <li>
            Create an ingest key in Settings (shown once). Header:{" "}
            <code>X-Monitor-Key: mntr_…</code> or <code>Authorization: Bearer mntr_…</code>.
          </li>
          <li>POST a smoke envelope (curl tab). Expect 202 with <code>dropped: 0</code>, then check Overview.</li>
          <li>Ship a small helper: stable <code>session.id</code>, <code>identify</code> (user id + email), incrementing <code>action_index</code>, every screen, every click, and every HTTP call with request/response bodies (success and failure).</li>
          <li>Keep any crash tool (Sentry) until session timelines look complete, then remove journey/API duplication from the app.</li>
        </ol>
      </Panel>

      <div className="mb-3 flex flex-wrap items-center gap-2">
        {HTTP_TABS.map((t) => (
          <button
            key={t}
            type="button"
            onClick={() => setTab(t)}
            className={clsx(tab === t ? "btn-primary" : "btn-secondary")}
          >
            {TAB_LABELS[t]}
          </button>
        ))}
        <span className="mx-1 text-xs uppercase tracking-widest text-zinc-400">optional</span>
        {SDK_TABS.map((t) => (
          <button
            key={t}
            type="button"
            onClick={() => setTab(t)}
            className={clsx(tab === t ? "btn-primary" : "btn-secondary")}
          >
            {TAB_LABELS[t]}
          </button>
        ))}
        <button type="button" className="btn-secondary ml-auto" onClick={() => copy("snippet", snippet)}>
          {copied === "snippet" ? "Copied" : "Copy"}
        </button>
      </div>

      <pre className="overflow-auto rounded-2xl border border-zinc-800 bg-zinc-950 p-5 text-[12px] leading-relaxed text-zinc-100">
        {snippet}
      </pre>

      <ul className="mt-4 list-disc space-y-1 pl-5 text-sm text-zinc-600 dark:text-zinc-400">
        <li>
          Replace <code>mntr_YOUR_PROJECT_KEY</code> with a Settings key. Never commit it.
        </li>
        <li>
          Browser <code>fetch</code> needs this app origin listed in API <code>CORS_ORIGIN</code>. Native and servers do not.
        </li>
        <li>
          Full field list and cutover checklist: <code>docs/monitor/README.md</code> and{" "}
          <code>docs/monitor/HTTP.md</code>. Optional packages:{" "}
          <Link className="font-medium text-indigo-600 dark:text-indigo-400" to="/packages">
            SDK packages
          </Link>
          .
        </li>
      </ul>
    </div>
  );
}

function UrlCard({
  label,
  value,
  copied,
  onCopy,
}: {
  label: string;
  value: string;
  copied: boolean;
  onCopy: () => void;
}) {
  return (
    <div className="rounded-2xl border border-zinc-200 bg-white p-4 shadow-sm dark:border-zinc-800 dark:bg-zinc-900/60">
      <div className="mb-2 flex items-center justify-between gap-2">
        <p className="text-xs font-medium uppercase tracking-wide text-zinc-500">{label}</p>
        <button type="button" className="btn-secondary text-xs" onClick={onCopy}>
          {copied ? "Copied" : "Copy"}
        </button>
      </div>
      <code className="block break-all text-[12px] text-zinc-800 dark:text-zinc-200">{value}</code>
    </div>
  );
}
