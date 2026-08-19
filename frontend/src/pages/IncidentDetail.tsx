import { useCallback, useEffect, useState, type FormEvent } from "react";
import { Link, useParams } from "react-router-dom";
import { apiFetch } from "@/lib/api";
import { useAuth } from "@/lib/auth";

type Incident = {
  id: string;
  service: string;
  severity: string;
  status: string;
  opened_at: string;
  resolved_at: string | null;
  title: string;
  trigger_error_rate: string | null;
  resolution_reason: string | null;
  auto_resolved: boolean;
};

type Note = {
  id: string;
  body: string;
  author: string | null;
  created_at: string;
};

export function IncidentDetail() {
  const { auth } = useAuth();
  const isAdmin = auth.role === "admin";
  const { id } = useParams<{ id: string }>();
  const [data, setData] = useState<{
    incident: Incident;
    notes: Note[];
  } | null>(null);
  const [note, setNote] = useState("");
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    if (!id) return;
    const res = await apiFetch<{ incident: Incident; notes: Note[] }>(
      `/incidents/${id}`
    );
    setData(res);
  }, [id]);

  useEffect(() => {
    let c = false;
    (async () => {
      try {
        await load();
      } catch (e) {
        if (!c) setErr(e instanceof Error ? e.message : "Failed");
      }
    })();
    return () => {
      c = true;
    };
  }, [load]);

  async function addNote(e: FormEvent) {
    e.preventDefault();
    if (!id || !note.trim()) return;
    setBusy(true);
    try {
      await apiFetch(`/incidents/${id}/notes`, {
        method: "POST",
        json: { body: note.trim() },
      });
      setNote("");
      await load();
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Failed to add note");
    } finally {
      setBusy(false);
    }
  }

  async function setStatus(status: "investigating" | "resolved") {
    if (!id) return;
    setBusy(true);
    try {
      await apiFetch(`/incidents/${id}`, {
        method: "PATCH",
        json: { status },
      });
      await load();
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Failed to update");
    } finally {
      setBusy(false);
    }
  }

  if (err && !data) {
    return (
      <p className="text-red-600 dark:text-red-400">
        {err}{" "}
        <Link to="/incidents" className="text-emerald-600 dark:text-emerald-400 underline">
          Back
        </Link>
      </p>
    );
  }

  if (!data) {
    return <p className="text-zinc-600 dark:text-zinc-500">Loading…</p>;
  }

  const { incident, notes } = data;

  return (
    <div className="mx-auto max-w-3xl space-y-8">
      <Link
        to="/incidents"
        className="text-sm text-emerald-600 dark:text-emerald-400 hover:text-emerald-700 dark:hover:text-emerald-300"
      >
        ← Incidents
      </Link>
      <header>
        <h1 className="text-2xl font-semibold text-zinc-900 dark:text-white">{incident.title}</h1>
        <dl className="mt-4 grid gap-3 text-sm sm:grid-cols-2">
          <div>
            <dt className="text-zinc-600 dark:text-zinc-500">Service</dt>
            <dd className="font-medium text-zinc-700 dark:text-zinc-200">{incident.service}</dd>
          </div>
          <div>
            <dt className="text-zinc-600 dark:text-zinc-500">Severity</dt>
            <dd className="font-medium text-zinc-700 dark:text-zinc-200">{incident.severity}</dd>
          </div>
          <div>
            <dt className="text-zinc-600 dark:text-zinc-500">Status</dt>
            <dd className="font-medium text-zinc-700 dark:text-zinc-200">{incident.status}</dd>
          </div>
          <div>
            <dt className="text-zinc-600 dark:text-zinc-500">Opened</dt>
            <dd className="text-zinc-600 dark:text-zinc-300">
              {new Date(incident.opened_at).toLocaleString()}
            </dd>
          </div>
          {incident.trigger_error_rate && (
            <div>
              <dt className="text-zinc-600 dark:text-zinc-500">Trigger error rate</dt>
              <dd className="tabular-nums text-zinc-600 dark:text-zinc-300">
                {(Number(incident.trigger_error_rate) * 100).toFixed(2)}%
              </dd>
            </div>
          )}
          {incident.resolved_at && (
            <div>
              <dt className="text-zinc-600 dark:text-zinc-500">Resolved</dt>
              <dd className="text-zinc-600 dark:text-zinc-300">
                {new Date(incident.resolved_at).toLocaleString()}
                {incident.auto_resolved && (
                  <span className="ml-2 text-xs text-zinc-600 dark:text-zinc-500">(auto)</span>
                )}
              </dd>
            </div>
          )}
        </dl>
      </header>

      {isAdmin && (
        <div className="flex flex-wrap gap-2">
          {incident.status !== "investigating" &&
            incident.status !== "resolved" && (
              <button
                type="button"
                disabled={busy}
                onClick={() => void setStatus("investigating")}
                className="rounded-md border border-zinc-300 dark:border-zinc-700 bg-zinc-50 dark:bg-zinc-900 px-3 py-2 text-sm text-zinc-800 dark:text-zinc-100 hover:bg-zinc-200 dark:hover:bg-zinc-800 disabled:opacity-50"
              >
                Mark investigating
              </button>
            )}
          {incident.status !== "resolved" && (
            <button
              type="button"
              disabled={busy}
              onClick={() => void setStatus("resolved")}
              className="rounded-md bg-emerald-600 px-3 py-2 text-sm font-medium text-zinc-900 dark:text-white hover:bg-emerald-500 disabled:opacity-50"
            >
              Resolve
            </button>
          )}
        </div>
      )}

      <section>
        <h2 className="text-sm font-medium text-zinc-700 dark:text-zinc-400">Notes</h2>
        <ul className="mt-3 space-y-3">
          {notes.length === 0 ? (
            <li className="text-sm text-zinc-600 dark:text-zinc-500">No notes yet.</li>
          ) : (
            notes.map((n) => (
              <li
                key={n.id}
                className="rounded-lg border border-zinc-200 dark:border-zinc-800 bg-zinc-50/40 dark:bg-zinc-900/40 px-4 py-3"
              >
                <p className="whitespace-pre-wrap text-sm text-zinc-700 dark:text-zinc-200">
                  {n.body}
                </p>
                <p className="mt-2 text-xs text-zinc-600 dark:text-zinc-500">
                  {n.author ?? "Unknown"} ·{" "}
                  {new Date(n.created_at).toLocaleString()}
                </p>
              </li>
            ))
          )}
        </ul>
        {isAdmin && (
          <form onSubmit={addNote} className="mt-4 space-y-2">
            <textarea
              value={note}
              onChange={(e) => setNote(e.target.value)}
              rows={3}
              placeholder="Add an internal note…"
              className="w-full rounded-md border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-950 px-3 py-2 text-sm text-zinc-900 dark:text-white outline-none ring-emerald-500/30 focus:ring-2"
            />
            <button
              type="submit"
              disabled={busy || !note.trim()}
              className="rounded-md bg-zinc-100 px-3 py-2 text-sm font-medium text-zinc-900 hover:bg-white disabled:opacity-50"
            >
              Add note
            </button>
          </form>
        )}
      </section>
    </div>
  );
}
