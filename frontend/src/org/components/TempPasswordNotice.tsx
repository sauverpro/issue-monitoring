import { useState } from "react";
import { Check, Copy } from "lucide-react";

export type Provisioned = { email: string; temporaryPassword: string };

/** Shown once after an admin provisions an account or resets a password. */
export function TempPasswordNotice({
  value,
  onDismiss,
}: {
  value: Provisioned;
  onDismiss: () => void;
}) {
  const [copied, setCopied] = useState(false);
  return (
    <div className="mb-3 rounded-xl border border-amber-300 bg-amber-50 p-4 text-sm dark:border-amber-500/40 dark:bg-amber-500/10">
      <p className="font-medium text-amber-900 dark:text-amber-200">
        One-time password for {value.email}
      </p>
      <p className="mt-1 text-xs text-amber-800 dark:text-amber-300/80">
        Share it securely — it is shown once and must be changed at first sign-in.
      </p>
      <div className="mt-3 flex flex-wrap items-center gap-2">
        <code className="rounded-lg bg-white px-3 py-1.5 font-mono text-xs dark:bg-zinc-900">
          {value.temporaryPassword}
        </code>
        <button
          type="button"
          className="btn-secondary text-xs"
          onClick={() => {
            void navigator.clipboard.writeText(value.temporaryPassword);
            setCopied(true);
          }}
        >
          {copied ? <Check className="mr-1 h-3.5 w-3.5" /> : <Copy className="mr-1 h-3.5 w-3.5" />}
          {copied ? "Copied" : "Copy"}
        </button>
        <button
          type="button"
          className="text-xs text-amber-900 underline dark:text-amber-200"
          onClick={onDismiss}
        >
          Dismiss
        </button>
      </div>
    </div>
  );
}
