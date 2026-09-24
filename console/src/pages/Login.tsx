import { useState, type FormEvent } from "react";
import { useNavigate } from "react-router-dom";
import { Activity } from "lucide-react";
import { useAuth } from "@/lib/auth";
import { ThemeToggle } from "@/components/ThemeToggle";

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
      await login(email, password);
      nav("/", { replace: true });
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
          <span className="text-lg font-semibold tracking-tight">Monitor Superadmin</span>
        </div>
        <div className="relative max-w-md space-y-4">
          <h2 className="text-3xl font-semibold leading-tight">
           Track Journeys, APIs, and system health —.
          </h2>
          <p className="text-sm leading-relaxed text-zinc-400">
            Create tenants, suspend organizations, and publish SDK packages. Organization members
            manage projects in the frontend workspace.
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
            <p className="mt-1 text-sm text-zinc-500">Platform admin — organizations, tenants, and SDK packages.</p>
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
        </form>
      </div>
    </div>
  );
}
