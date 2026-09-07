import { useState, type FormEvent } from "react";
import { Link, useNavigate } from "react-router-dom";
import { Activity } from "lucide-react";
import { useAuth, postLoginPath } from "@/org/lib/auth";
import { ThemeToggle } from "@/org/components/ThemeToggle";

export function LoginPage() {
  const { login } = useAuth();
  const nav = useNavigate();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const result = await login(email, password);
      nav(postLoginPath(result), { replace: true });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Login failed");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="grid min-h-screen lg:grid-cols-2">
      <div className="relative hidden overflow-hidden bg-zinc-950 lg:flex lg:flex-col lg:justify-between p-10 text-white">
        <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_top_left,_var(--tw-gradient-stops))] from-indigo-600/40 via-zinc-950 to-zinc-950" />
        <div className="relative flex items-center gap-3">
          <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-indigo-500">
            <Activity className="h-5 w-5" />
          </span>
          <span className="text-lg font-semibold tracking-tight">Monitor</span>
        </div>
        <div className="relative max-w-md space-y-4">
          <h2 className="text-3xl font-semibold leading-tight">
            Track Journeys, APIs, and system health —.
          </h2>
          <p className="text-sm leading-relaxed text-zinc-400">
            Each organization gets isolated projects, unique ingest keys, and a dashboard for
            navigations, upstream success/failure, and session context.
          </p>
        </div>
        <p className="relative text-xs text-zinc-500">ICT Chamber · Koralink platform</p>
      </div>
      <div className="relative flex flex-col items-center justify-center bg-zinc-50 px-4 dark:bg-zinc-950">
        <ThemeToggle className="absolute right-4 top-4 rounded-md p-2 text-zinc-500 hover:bg-zinc-100 dark:hover:bg-zinc-800" />
        <form onSubmit={onSubmit} className="w-full max-w-sm space-y-4">
          <div className="lg:hidden mb-2 flex items-center gap-2">
            <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-indigo-600 text-white">
              <Activity className="h-4 w-4" />
            </span>
            <span className="font-semibold">Monitor</span>
          </div>
          <div>
            <h1 className="text-xl font-semibold text-zinc-900 dark:text-white">Sign in</h1>
            <p className="mt-1 text-sm text-zinc-500">
              One app for organization workspaces and platform admin. Ops staff use /ops/login.
            </p>
          </div>
          <label className="block text-xs font-medium text-zinc-600 dark:text-zinc-400">
            Email
            <input className="input mt-1" type="email" value={email} onChange={(e) => setEmail(e.target.value)} required />
          </label>
          <label className="block text-xs font-medium text-zinc-600 dark:text-zinc-400">
            Password
            <input className="input mt-1" type="password" value={password} onChange={(e) => setPassword(e.target.value)} required />
          </label>
          {error && <p className="text-sm text-red-600">{error}</p>}
          <button disabled={busy} className="btn-primary w-full py-2.5">
            {busy ? "Signing in…" : "Sign in"}
          </button>
          <p className="text-center text-sm text-zinc-500">
            No account?{" "}
            <Link className="font-medium text-indigo-600 dark:text-indigo-400" to="/register">
              Register
            </Link>
          </p>
          <p className="text-center text-xs text-zinc-400">
            Platform admins land on Organizations (/platform). Org members land in their workspace.
          </p>
        </form>
      </div>
    </div>
  );
}
