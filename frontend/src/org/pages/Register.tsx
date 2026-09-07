import { useState, type FormEvent } from "react";
import { Link, useNavigate } from "react-router-dom";
import { Activity } from "lucide-react";
import { useAuth, postLoginPath } from "@/org/lib/auth";
import { ThemeToggle } from "@/org/components/ThemeToggle";

export function RegisterPage() {
  const { register } = useAuth();
  const nav = useNavigate();
  const [email, setEmail] = useState("");
  const [name, setName] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const result = await register(email, password, name || undefined);
      nav(postLoginPath(result), { replace: true });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Register failed");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="relative flex min-h-screen flex-col items-center justify-center bg-zinc-50 px-4 dark:bg-zinc-950">
      <ThemeToggle className="absolute right-4 top-4 rounded-md p-2 text-zinc-500 hover:bg-zinc-100 dark:hover:bg-zinc-800" />
      <div className="mb-6 flex items-center gap-2">
        <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-indigo-600 text-white">
          <Activity className="h-4 w-4" />
        </span>
        <span className="font-semibold">Monitor</span>
      </div>
      <form onSubmit={onSubmit} className="w-full max-w-sm space-y-3 rounded-2xl border border-zinc-200 bg-white p-6 shadow-sm dark:border-zinc-800 dark:bg-zinc-900">
        <h1 className="text-lg font-semibold">Create organization account</h1>
        <label className="block text-xs font-medium text-zinc-600">
          Name
          <input className="input mt-1" value={name} onChange={(e) => setName(e.target.value)} />
        </label>
        <label className="block text-xs font-medium text-zinc-600">
          Email
          <input className="input mt-1" type="email" value={email} onChange={(e) => setEmail(e.target.value)} required />
        </label>
        <label className="block text-xs font-medium text-zinc-600">
          Password (min 8)
          <input className="input mt-1" type="password" minLength={8} value={password} onChange={(e) => setPassword(e.target.value)} required />
        </label>
        {error && <p className="text-sm text-red-600">{error}</p>}
        <button disabled={busy} className="btn-primary w-full">
          {busy ? "Creating…" : "Register"}
        </button>
        <p className="text-center text-sm text-zinc-500">
          Have an account?{" "}
          <Link className="font-medium text-indigo-600" to="/login">
            Sign in
          </Link>
        </p>
      </form>
    </div>
  );
}
