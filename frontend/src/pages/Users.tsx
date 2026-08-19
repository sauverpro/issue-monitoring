import { useCallback, useEffect, useState, type FormEvent } from "react";
import { apiFetch } from "@/lib/api";
import { Skeleton } from "@/components/Skeleton";
import { Trash2 } from "lucide-react";

type DashboardUser = {
  id: string;
  email: string;
  role: "admin" | "viewer";
  created_at: string;
};

export function Users() {
  const [users, setUsers] = useState<DashboardUser[]>([]);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [role, setRole] = useState<"admin" | "viewer">("viewer");

  const load = useCallback(async () => {
    const res = await apiFetch<{ users: DashboardUser[] }>("/users");
    setUsers(res.users);
  }, []);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        await load();
      } catch (e) {
        if (!cancelled) setErr(e instanceof Error ? e.message : "Failed to load");
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [load]);

  async function createUser(e: FormEvent) {
    e.preventDefault();
    setErr(null);
    setBusy(true);
    try {
      await apiFetch("/users", {
        method: "POST",
        json: { email, password, role },
      });
      setEmail("");
      setPassword("");
      setRole("viewer");
      await load();
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Failed to create user");
    } finally {
      setBusy(false);
    }
  }

  async function changeRole(id: string, nextRole: "admin" | "viewer") {
    setErr(null);
    try {
      await apiFetch(`/users/${id}`, { method: "PATCH", json: { role: nextRole } });
      await load();
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Failed to update role");
    }
  }

  async function removeUser(id: string) {
    setErr(null);
    try {
      await apiFetch(`/users/${id}`, { method: "DELETE" });
      await load();
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Failed to delete user");
    }
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight text-zinc-900 dark:text-white">Users</h1>
        <p className="mt-1 text-sm text-zinc-700 dark:text-zinc-400">
          Admins can resolve incidents and add notes; viewers have read-only access.
        </p>
      </div>

      {err && (
        <div className="rounded-lg border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm text-red-700 dark:text-red-200">
          {err}
        </div>
      )}

      <form
        onSubmit={createUser}
        className="grid gap-3 rounded-xl border border-zinc-200 dark:border-zinc-800 bg-zinc-50/40 dark:bg-zinc-900/40 p-4 sm:grid-cols-[1fr_1fr_auto_auto]"
      >
        <input
          type="email"
          required
          placeholder="Email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          className="rounded-md border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-950 px-3 py-2 text-sm text-zinc-900 dark:text-white outline-none ring-emerald-500/30 focus:ring-2"
        />
        <input
          type="password"
          required
          minLength={8}
          placeholder="Password (min 8 chars)"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          className="rounded-md border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-950 px-3 py-2 text-sm text-zinc-900 dark:text-white outline-none ring-emerald-500/30 focus:ring-2"
        />
        <select
          value={role}
          onChange={(e) => setRole(e.target.value as "admin" | "viewer")}
          className="rounded-md border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-950 px-3 py-2 text-sm text-zinc-900 dark:text-white outline-none ring-emerald-500/30 focus:ring-2"
        >
          <option value="viewer">Viewer</option>
          <option value="admin">Admin</option>
        </select>
        <button
          type="submit"
          disabled={busy}
          className="rounded-md bg-emerald-600 px-4 py-2 text-sm font-medium text-zinc-900 dark:text-white hover:bg-emerald-500 disabled:opacity-50"
        >
          Add user
        </button>
      </form>

      {loading ? (
        <Skeleton className="h-64 w-full" />
      ) : (
        <div className="overflow-hidden rounded-xl border border-zinc-200 dark:border-zinc-800 bg-zinc-50/30 dark:bg-zinc-900/30">
          <table className="w-full text-left text-sm">
            <thead className="border-b border-zinc-200 dark:border-zinc-800 bg-white/50 dark:bg-zinc-950/50 text-xs uppercase tracking-wide text-zinc-600 dark:text-zinc-500">
              <tr>
                <th className="px-4 py-3 font-medium">Email</th>
                <th className="px-4 py-3 font-medium">Role</th>
                <th className="px-4 py-3 font-medium">Created</th>
                <th className="w-10 px-4 py-3" />
              </tr>
            </thead>
            <tbody className="divide-y divide-zinc-200 dark:divide-zinc-800">
              {users.map((u) => (
                <tr key={u.id} className="hover:bg-zinc-50/50 dark:hover:bg-zinc-900/50">
                  <td className="px-4 py-3 font-medium text-zinc-800 dark:text-zinc-100">{u.email}</td>
                  <td className="px-4 py-3">
                    <select
                      value={u.role}
                      onChange={(e) => void changeRole(u.id, e.target.value as "admin" | "viewer")}
                      className="rounded-md border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-950 px-2 py-1 text-xs text-zinc-900 dark:text-white"
                    >
                      <option value="viewer">Viewer</option>
                      <option value="admin">Admin</option>
                    </select>
                  </td>
                  <td className="px-4 py-3 text-zinc-600 dark:text-zinc-500 tabular-nums">
                    {new Date(u.created_at).toLocaleString()}
                  </td>
                  <td className="px-4 py-3">
                    <button
                      type="button"
                      onClick={() => void removeUser(u.id)}
                      className="inline-flex text-zinc-600 dark:text-zinc-500 hover:text-red-600 dark:hover:text-red-400"
                      aria-label={`Delete ${u.email}`}
                    >
                      <Trash2 className="h-4 w-4" />
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
