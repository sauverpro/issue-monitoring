import { useCallback, useEffect, useState } from "react";
import { Mail, Send } from "lucide-react";
import { apiFetch } from "@/org/lib/api";
import { Badge, Panel } from "@/org/components/ui";

type Frequency = "weekly" | "monthly" | "quarterly";

type Schedule = {
  id: string;
  frequency: Frequency;
  recipients: string[];
  enabled: boolean;
  nextRunAt: string;
  lastRunAt: string | null;
  lastStatus: string | null;
  lastError: string | null;
};

const FREQUENCIES: { id: Frequency; label: string; when: string }[] = [
  { id: "weekly", label: "Weekly", when: "Every Monday 06:00 (Kigali), covering the previous week" },
  { id: "monthly", label: "Monthly", when: "1st of each month 06:00, covering the previous month" },
  { id: "quarterly", label: "Quarterly", when: "1st of Jan / Apr / Jul / Oct 06:00, covering the previous quarter" },
];

function fmtDateTime(iso: string): string {
  return new Date(iso).toLocaleString(undefined, { day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" });
}

function parseRecipients(text: string): string[] {
  return text
    .split(/[\s,;]+/)
    .map((s) => s.trim())
    .filter(Boolean);
}

export function ReportSchedules({ projectId, canManage }: { projectId: string; canManage: boolean }) {
  const base = `/console/projects/${projectId}/report-schedules`;
  const [schedules, setSchedules] = useState<Schedule[]>([]);
  const [emailConfigured, setEmailConfigured] = useState(true);
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const r = await apiFetch<{ emailConfigured: boolean; schedules: Schedule[] }>(base);
      setSchedules(r.schedules);
      setEmailConfigured(r.emailConfigured);
      setLoaded(true);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load schedules");
    }
  }, [base]);

  useEffect(() => {
    void load();
  }, [load]);

  return (
    <div className="space-y-4">
      <div>
        <h2 className="text-sm font-semibold">Scheduled report emails</h2>
        <p className="text-xs text-zinc-500">
          The executive report (health, incidents, adoption funnels, feedback and releases) is emailed as a PDF for each complete period.
        </p>
      </div>
      {!emailConfigured && (
        <div className="rounded-xl border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900 dark:border-amber-500/40 dark:bg-amber-500/10 dark:text-amber-200">
          Email delivery is not configured on the server. Set <code>SMTP_HOST</code>, <code>SMTP_USER</code>, <code>SMTP_PASS</code> and{" "}
          <code>SMTP_FROM</code>; until then schedules run but are recorded as skipped.
        </div>
      )}
      {error && <p className="text-sm text-red-600">{error}</p>}
      {loaded && (
        <div className="grid gap-4 lg:grid-cols-3">
          {FREQUENCIES.map((f) => (
            <ScheduleCard
              key={f.id}
              base={base}
              frequency={f}
              schedule={schedules.find((s) => s.frequency === f.id) ?? null}
              canManage={canManage}
              onChanged={load}
            />
          ))}
        </div>
      )}
    </div>
  );
}

function ScheduleCard({
  base,
  frequency,
  schedule,
  canManage,
  onChanged,
}: {
  base: string;
  frequency: { id: Frequency; label: string; when: string };
  schedule: Schedule | null;
  canManage: boolean;
  onChanged: () => Promise<void>;
}) {
  const [text, setText] = useState(schedule?.recipients.join(", ") ?? "");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);

  useEffect(() => {
    setText(schedule?.recipients.join(", ") ?? "");
  }, [schedule]);

  async function save(enabled: boolean) {
    const recipients = parseRecipients(text);
    if (recipients.length === 0) {
      setMsg({ ok: false, text: "Add at least one email address." });
      return;
    }
    setBusy(true);
    setMsg(null);
    try {
      await apiFetch(base, { method: "PUT", json: { frequency: frequency.id, recipients, enabled } });
      await onChanged();
      setMsg({ ok: true, text: enabled ? "Saved" : "Paused" });
    } catch (e) {
      const m = e instanceof Error ? e.message : "";
      setMsg({ ok: false, text: m.startsWith("{") ? "Check the email addresses (max 20)." : m || "Save failed" });
    } finally {
      setBusy(false);
    }
  }

  async function sendNow() {
    if (!schedule) return;
    setBusy(true);
    setMsg(null);
    try {
      const r = await apiFetch<{ detail: string }>(`${base}/${schedule.id}/send`, { method: "POST" });
      setMsg({ ok: true, text: r.detail });
    } catch (e) {
      setMsg({ ok: false, text: e instanceof Error ? e.message : "Send failed" });
    } finally {
      setBusy(false);
      await onChanged();
    }
  }

  async function remove() {
    if (!schedule) return;
    await apiFetch(`${base}/${schedule.id}`, { method: "DELETE" });
    setText("");
    await onChanged();
  }

  const statusTone = schedule?.lastStatus === "sent" ? "green" : schedule?.lastStatus === "failed" ? "red" : "amber";

  return (
    <Panel className="flex flex-col">
      <div className="flex items-center justify-between border-b border-zinc-200 px-4 py-3 dark:border-zinc-800">
        <p className="flex items-center gap-2 text-sm font-medium">
          <Mail className="h-4 w-4 text-indigo-500" /> {frequency.label}
        </p>
        {schedule ? <Badge tone={schedule.enabled ? "green" : "neutral"}>{schedule.enabled ? "Active" : "Paused"}</Badge> : <Badge>Off</Badge>}
      </div>
      <div className="flex-1 space-y-3 p-4 text-sm">
        <p className="text-xs text-zinc-500">{frequency.when}</p>
        <textarea
          className="input min-h-[64px] text-xs"
          placeholder="name@org.rw, manager@org.rw"
          value={text}
          disabled={!canManage}
          onChange={(e) => setText(e.target.value)}
          aria-label={`${frequency.label} recipients`}
        />
        {schedule && (
          <dl className="space-y-1 text-xs">
            {schedule.enabled && (
              <div className="flex justify-between">
                <dt className="text-zinc-400">Next send</dt>
                <dd>{fmtDateTime(schedule.nextRunAt)}</dd>
              </div>
            )}
            {schedule.lastRunAt && (
              <div className="flex justify-between gap-2">
                <dt className="text-zinc-400">Last run</dt>
                <dd className="flex items-center gap-1.5">
                  {fmtDateTime(schedule.lastRunAt)} <Badge tone={statusTone}>{schedule.lastStatus}</Badge>
                </dd>
              </div>
            )}
            {schedule.lastError && <p className="text-[11px] text-red-600">{schedule.lastError}</p>}
          </dl>
        )}
        {msg && <p className={`text-xs ${msg.ok ? "text-emerald-600" : "text-red-600"}`}>{msg.text}</p>}
      </div>
      {canManage && (
        <div className="flex flex-wrap gap-2 border-t border-zinc-100 px-4 py-3 dark:border-zinc-800">
          <button type="button" className="btn-primary px-2.5 py-1 text-xs" disabled={busy} onClick={() => void save(true)}>
            {schedule ? "Save" : "Turn on"}
          </button>
          {schedule && (
            <>
              <button type="button" className="btn-secondary px-2.5 py-1 text-xs" disabled={busy} onClick={() => void sendNow()} title="Email the previous period's report now">
                <Send className="mr-1 h-3 w-3" /> Send now
              </button>
              {schedule.enabled ? (
                <button type="button" className="text-xs text-zinc-500 hover:text-zinc-800" disabled={busy} onClick={() => void save(false)}>
                  Pause
                </button>
              ) : null}
              <button type="button" className="ml-auto text-xs text-zinc-400 hover:text-red-600" disabled={busy} onClick={() => void remove()}>
                Remove
              </button>
            </>
          )}
        </div>
      )}
    </Panel>
  );
}
