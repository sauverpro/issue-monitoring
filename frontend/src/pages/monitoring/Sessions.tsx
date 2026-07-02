import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { ArrowRight } from "lucide-react";
import { apiFetch } from "@/lib/api";
import type { SessionListItem } from "@/types/session";

export function MonitoringSessions() {
  const [items, setItems] = useState<SessionListItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);
  const [page, setPage] = useState(1);
  const [email, setEmail] = useState("");
  const [sessionId, setSessionId] = useState("");
  const [role, setRole] = useState("");
  const [accountType, setAccountType] = useState("");
  const [status, setStatus] = useState<"all" | "failures" | "success">("all");
  const [startDate, setStartDate] = useState("");
  const [endDate, setEndDate] = useState("");
  const limit = 20;

  useEffect(() => {
    const q = new URLSearchParams();
    q.set("page", String(page));
    q.set("limit", String(limit));
    if (email.trim()) q.set("email", email.trim());
    if (sessionId.trim()) q.set("sessionId", sessionId.trim());
    if (role.trim()) q.set("role", role.trim());
    if (accountType.trim()) q.set("accountType", accountType.trim());
    if (status !== "all") q.set("status", status);
    if (startDate) q.set("startDate", startDate);
    if (endDate) q.set("endDate", endDate);

    let cancelled = false;
    (async () => {
      setLoading(true);
      try {
        const res = await apiFetch<SessionListItem[]>(
          `/api/sessions?${q.toString()}`
        );
        if (!cancelled) {
          setItems(res);
          setErr(null);
        }
      } catch (e) {
        if (!cancelled)
          setErr(e instanceof Error ? e.message : "Failed to load sessions");
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [page, email, sessionId, role, accountType, status, startDate, endDate]);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight text-white">
          Sessions
        </h1>
        <p className="mt-1 text-sm text-zinc-400">
          Investigate user journeys grouped by Sentry session ID.
        </p>
      </div>

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <input
          value={sessionId}
          onChange={(e) => {
            setPage(1);
            setSessionId(e.target.value);
          }}
          placeholder="Session ID"
          className="rounded-md border border-zinc-800 bg-zinc-900 px-3 py-2 text-sm text-zinc-100"
        />
        <input
          value={email}
          onChange={(e) => {
            setPage(1);
            setEmail(e.target.value);
          }}
          placeholder="User email"
          className="rounded-md border border-zinc-800 bg-zinc-900 px-3 py-2 text-sm text-zinc-100"
        />
        <input
          value={role}
          onChange={(e) => {
            setPage(1);
            setRole(e.target.value);
          }}
          placeholder="Role"
          className="rounded-md border border-zinc-800 bg-zinc-900 px-3 py-2 text-sm text-zinc-100"
        />
        <input
          value={accountType}
          onChange={(e) => {
            setPage(1);
            setAccountType(e.target.value);
          }}
          placeholder="Account type"
          className="rounded-md border border-zinc-800 bg-zinc-900 px-3 py-2 text-sm text-zinc-100"
        />
        <select
          value={status}
          onChange={(e) => {
            setPage(1);
            setStatus(e.target.value as typeof status);
          }}
          className="rounded-md border border-zinc-800 bg-zinc-900 px-3 py-2 text-sm text-zinc-100"
        >
          <option value="all">All statuses</option>
          <option value="failures">With failures</option>
          <option value="success">No failures</option>
        </select>
        <input
          type="date"
          value={startDate}
          onChange={(e) => {
            setPage(1);
            setStartDate(e.target.value);
          }}
          className="rounded-md border border-zinc-800 bg-zinc-900 px-3 py-2 text-sm text-zinc-100"
        />
        <input
          type="date"
          value={endDate}
          onChange={(e) => {
            setPage(1);
            setEndDate(e.target.value);
          }}
          className="rounded-md border border-zinc-800 bg-zinc-900 px-3 py-2 text-sm text-zinc-100"
        />
      </div>

      {err && (
        <div className="rounded-lg border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm text-red-200">
          {err}
        </div>
      )}

      <div className="overflow-x-auto rounded-xl border border-zinc-800 bg-zinc-900/30">
        <table className="min-w-full text-left text-sm">
          <thead className="border-b border-zinc-800 bg-zinc-950/50 text-[11px] uppercase tracking-wide text-zinc-500">
            <tr>
              <th className="px-3 py-2">Session ID</th>
              <th className="px-3 py-2">User</th>
              <th className="px-3 py-2">Role</th>
              <th className="px-3 py-2">Account Type</th>
              <th className="px-3 py-2 text-right">Actions</th>
              <th className="px-3 py-2 text-right">Failures</th>
              <th className="px-3 py-2">Started At</th>
              <th className="px-3 py-2">Last Activity</th>
              <th className="px-3 py-2" />
            </tr>
          </thead>
          <tbody className="divide-y divide-zinc-800">
            {loading ? (
              <tr>
                <td colSpan={9} className="px-3 py-8 text-center text-zinc-500">
                  Loading…
                </td>
              </tr>
            ) : items.length === 0 ? (
              <tr>
                <td colSpan={9} className="px-3 py-10 text-center text-zinc-500">
                  No sessions match your filters.
                </td>
              </tr>
            ) : (
              items.map((s) => (
                <tr key={s.sessionId} className="hover:bg-zinc-900/40">
                  <td className="max-w-[160px] truncate px-3 py-2 font-mono text-xs text-zinc-300">
                    {s.sessionId}
                  </td>
                  <td className="px-3 py-2 text-zinc-300">{s.userEmail ?? "—"}</td>
                  <td className="px-3 py-2 text-zinc-500">{s.role ?? "—"}</td>
                  <td className="px-3 py-2 text-zinc-500">{s.accountType ?? "—"}</td>
                  <td className="px-3 py-2 text-right tabular-nums">{s.totalActions}</td>
                  <td
                    className={`px-3 py-2 text-right tabular-nums ${
                      s.failures > 0 ? "text-red-300" : "text-zinc-500"
                    }`}
                  >
                    {s.failures}
                  </td>
                  <td className="whitespace-nowrap px-3 py-2 text-xs text-zinc-400">
                    {new Date(s.startedAt).toISOString()}
                  </td>
                  <td className="whitespace-nowrap px-3 py-2 text-xs text-zinc-400">
                    {new Date(s.lastActivity).toISOString()}
                  </td>
                  <td className="px-3 py-2">
                    <Link
                      to={`/monitoring/sessions/${encodeURIComponent(s.sessionId)}`}
                      className="inline-flex items-center gap-1 text-xs text-emerald-400 hover:text-emerald-300"
                    >
                      View
                      <ArrowRight className="h-3.5 w-3.5" />
                    </Link>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      <div className="flex justify-between text-sm text-zinc-500">
        <button
          type="button"
          disabled={page === 1}
          onClick={() => setPage((p) => Math.max(1, p - 1))}
          className="rounded-md border border-zinc-800 px-3 py-1.5 hover:bg-zinc-900 disabled:opacity-40"
        >
          Previous
        </button>
        <span>Page {page}</span>
        <button
          type="button"
          disabled={items.length < limit}
          onClick={() => setPage((p) => p + 1)}
          className="rounded-md border border-zinc-800 px-3 py-1.5 hover:bg-zinc-900 disabled:opacity-40"
        >
          Next
        </button>
      </div>
    </div>
  );
}
