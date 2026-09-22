import { useState, type FormEvent } from "react";
import { useNavigate } from "react-router-dom";
import { Activity } from "lucide-react";
import { useAuth, postLoginPath } from "@/org/lib/auth";
import { ThemeToggle } from "@/org/components/ThemeToggle";

export function ChangePasswordPage() {
  const { auth, changePassword, logout } = useAuth();
  const nav = useNavigate();
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const forced = auth.mustChangePassword;

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    if (newPassword !== confirm) {
      setError("New passwords do not match");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await changePassword(currentPassword, newPassword);
      nav(postLoginPath({ ...auth, mustChangePassword: false }), { replace: true });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not change password");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex min-h-screen flex-col items-center justify-center bg-zinc-50 px-4 dark:bg-zinc-950">
      <ThemeToggle className="absolute right-4 top-4 rounded-md p-2 text-zinc-500 hover:bg-zinc-100 dark:hover:bg-zinc-800" />
      <div className="mb-6 flex items-center gap-2">
        <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-indigo-600 text-white">
          <Activity className="h-4 w-4" />
        </span>
        <span className="font-semibold">Monitor</span>
      </div>
      <form
        onSubmit={onSubmit}
        className="w-full max-w-sm space-y-3 rounded-2xl border border-zinc-200 bg-white p-6 shadow-sm dark:border-zinc-800 dark:bg-zinc-900"
      >
        <div>
          <h1 className="text-lg font-semibold">
            {forced ? "Set your password" : "Change password"}
          </h1>
          <p className="mt-1 text-sm text-zinc-500">
            {forced
              ? "Your account was created with a temporary password. Choose a new one to continue."
              : `Signed in as ${auth.email ?? ""}`}
          </p>
        </div>
        <label className="block text-xs font-medium text-zinc-600 dark:text-zinc-400">
          {forced ? "Temporary password" : "Current password"}
          <input
            className="input mt-1"
            type="password"
            value={currentPassword}
            onChange={(e) => setCurrentPassword(e.target.value)}
            required
            autoFocus
          />
        </label>
        <label className="block text-xs font-medium text-zinc-600 dark:text-zinc-400">
          New password
          <input
            className="input mt-1"
            type="password"
            minLength={8}
            value={newPassword}
            onChange={(e) => setNewPassword(e.target.value)}
            required
          />
        </label>
        <label className="block text-xs font-medium text-zinc-600 dark:text-zinc-400">
          Confirm new password
          <input
            className="input mt-1"
            type="password"
            minLength={8}
            value={confirm}
            onChange={(e) => setConfirm(e.target.value)}
            required
          />
        </label>
        {error && <p className="text-sm text-red-600">{error}</p>}
        <button disabled={busy} className="btn-primary w-full py-2.5">
          {busy ? "Saving…" : "Save password"}
        </button>
        <button
          type="button"
          className="w-full text-center text-xs text-zinc-500 hover:text-zinc-700 dark:hover:text-zinc-300"
          onClick={logout}
        >
          Sign out
        </button>
      </form>
    </div>
  );
}
