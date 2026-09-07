import { useEffect, useState } from "react";
import { Download } from "lucide-react";
import { PageHeader, Panel } from "@/org/components/ui";

type SdkPackage = {
  name: string;
  version: string;
  file: string;
  url: string;
  bytes: number;
};

function tarballUrl(pkg: SdkPackage): string {
  return `${window.location.origin}${pkg.url}`;
}

/** npm 12+ defaults allow-remote to none and rejects http(s) tarball specs. */
function installCmd(...pkgs: SdkPackage[]): string {
  return `npm install --allow-remote=all ${pkgs.map(tarballUrl).join(" ")}`;
}

export function PlatformPackagesPage() {
  const [pkgs, setPkgs] = useState<SdkPackage[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState<string | null>(null);

  useEffect(() => {
    fetch("/sdk")
      .then(async (res) => {
        const text = await res.text();
        if (!res.ok) {
          let message = text || `HTTP ${res.status}`;
          try {
            const j = JSON.parse(text) as { error?: unknown };
            if (typeof j.error === "string") message = j.error;
          } catch {
            /* keep raw body */
          }
          throw new Error(message);
        }
        return JSON.parse(text) as { packages: SdkPackage[]; installHint: string };
      })
      .then((d) => setPkgs(d.packages ?? []))
      .catch((e) =>
        setError(
          e instanceof Error
            ? e.message
            : "Could not list packages. Run npm run pack:sdk and keep the API running."
        )
      );
  }, []);

  function copy(text: string) {
    void navigator.clipboard.writeText(text);
    setCopied(text);
    setTimeout(() => setCopied(null), 1500);
  }

  const core = pkgs.find((p) => p.name === "@koralink/monitor-core");
  const web = pkgs.find((p) => p.name === "@koralink/monitor-web");
  const rn = pkgs.find((p) => p.name === "@koralink/monitor-react-native");
  const webBundle = core && web ? installCmd(core, web) : null;
  const rnBundle = core && rn ? installCmd(core, rn) : null;

  return (
    <div>
      <PageHeader
        eyebrow="Platform admin"
        title="SDK packages"
        description="Optional npm packages. Prefer HTTP ingest on the project Integration page — same URLs, no package."
      />
      <div className="mb-6 space-y-2 rounded-2xl border border-zinc-200 bg-white p-5 text-sm leading-relaxed text-zinc-600 dark:border-zinc-800 dark:bg-zinc-900/60 dark:text-zinc-400">
        <p>
          <strong className="text-zinc-900 dark:text-zinc-100">1. Pack</strong> on the server or CI:{" "}
          <code className="rounded bg-zinc-100 px-1 dark:bg-zinc-800">npm run pack:sdk</code>
        </p>
        <p>
          <strong className="text-zinc-900 dark:text-zinc-100">2. Install in the app</strong> with{" "}
          <code className="rounded bg-zinc-100 px-1 dark:bg-zinc-800">--allow-remote=all</code>{" "}
          (npm 12+). Install <em>core together with</em> web or React Native so npm does not look up{" "}
          <code>@koralink/monitor-core</code> on npmjs.
        </p>
        <p>
          <strong className="text-zinc-900 dark:text-zinc-100">3. Prefer HTTP ingest</strong> on the
          project Integration page. Use these tarballs only if you want automatic hooks.
        </p>
      </div>
      {error && (
        <p className="mb-4 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900 dark:border-amber-500/30 dark:bg-amber-500/10 dark:text-amber-200">
          {error}
        </p>
      )}
      {(webBundle || rnBundle) && (
        <div className="mb-4 flex flex-wrap gap-2">
          {webBundle && (
            <button type="button" className="btn-secondary text-xs" onClick={() => copy(webBundle)}>
              {copied === webBundle ? "Copied" : "Copy web install (core + web)"}
            </button>
          )}
          {rnBundle && (
            <button type="button" className="btn-secondary text-xs" onClick={() => copy(rnBundle)}>
              {copied === rnBundle ? "Copied" : "Copy RN install (core + RN)"}
            </button>
          )}
        </div>
      )}
      <Panel>
        {pkgs.length === 0 && !error ? (
          <p className="px-5 py-8 text-center text-sm text-zinc-500">
            No tarballs in packages/releases yet.
          </p>
        ) : (
          <ul className="divide-y divide-zinc-100 dark:divide-zinc-800">
            {pkgs.map((p) => {
              const cmd = installCmd(p);
              return (
                <li
                  key={p.file}
                  className="flex flex-col gap-3 px-5 py-4 sm:flex-row sm:items-center"
                >
                  <div className="min-w-0 flex-1">
                    <p className="font-medium">{p.name}</p>
                    <p className="text-xs text-zinc-500">
                      v{p.version} · {(p.bytes / 1024).toFixed(1)} KB · {p.file}
                    </p>
                    <code className="mt-1 block truncate text-[11px] text-zinc-500">{cmd}</code>
                  </div>
                  <div className="flex gap-2">
                    <button type="button" className="btn-secondary text-xs" onClick={() => copy(cmd)}>
                      {copied === cmd ? "Copied" : "Copy install"}
                    </button>
                    <a className="btn-primary gap-1 text-xs" href={p.url} download>
                      <Download className="h-3.5 w-3.5" />
                      Download
                    </a>
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </Panel>
    </div>
  );
}
