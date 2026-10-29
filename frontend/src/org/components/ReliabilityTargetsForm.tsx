import { useEffect, useState, type FormEvent } from "react";
import { apiFetch } from "@/org/lib/api";
import { Field, Panel } from "@/org/components/ui";

type Targets = {
  phase: string;
  overall: number;
  core: number;
  thirdParty: number;
  longTerm: number;
  coreServices: string[];
};

const toPct = (v: number) => String(Math.round(v * 1000) / 10);
const fromPct = (v: string) => Number(v) / 100;

/**
 * Stage-appropriate reliability targets. Overview status and reports judge
 * availability against these (with the long-term goal shown alongside).
 */
export function ReliabilityTargetsForm({ projectId, services }: { projectId: string; services: string[] }) {
  const [t, setT] = useState<Targets | null>(null);
  const [form, setForm] = useState({ phase: "", overall: "", core: "", thirdParty: "", longTerm: "" });
  const [core, setCore] = useState<string[]>([]);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    apiFetch<Targets>(`/console/projects/${projectId}/targets`)
      .then((x) => {
        setT(x);
        setForm({ phase: x.phase, overall: toPct(x.overall), core: toPct(x.core), thirdParty: toPct(x.thirdParty), longTerm: toPct(x.longTerm) });
        setCore(x.coreServices);
      })
      .catch(() => undefined);
  }, [projectId]);

  async function save(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setMsg(null);
    try {
      const next = await apiFetch<Targets>(`/console/projects/${projectId}/targets`, {
        method: "PUT",
        json: {
          phase: form.phase,
          overall: fromPct(form.overall),
          core: fromPct(form.core),
          thirdParty: fromPct(form.thirdParty),
          longTerm: fromPct(form.longTerm),
          coreServices: core,
        },
      });
      setT(next);
      setMsg({ ok: true, text: "Saved. The Overview and new reports use these targets." });
    } catch (err) {
      setMsg({ ok: false, text: err instanceof Error ? err.message : "Save failed" });
    } finally {
      setBusy(false);
    }
  }

  if (!t) return null;
  const set = (k: keyof typeof form) => (e: { target: { value: string } }) => setForm((f) => ({ ...f, [k]: e.target.value }));

  return (
    <section className="space-y-3">
      <div>
        <h2 className="text-sm font-semibold">Reliability targets</h2>
        <p className="text-xs text-zinc-500">
          Service availability (server failures and no-response only, test traffic excluded) is rated against these: on target, near target (within 2 points), or below.
          Raise them as the app matures; the long-term goal is always shown alongside.
        </p>
      </div>
      <Panel className="p-5">
        <form onSubmit={save} className="space-y-4">
          <div className="grid gap-4 sm:grid-cols-5">
            <Field label="Phase name">
              <input className="input" maxLength={30} value={form.phase} onChange={set("phase")} placeholder="Pilot" required />
            </Field>
            <Field label="Overall target (%)">
              <input className="input" type="number" min={50} max={100} step={0.1} value={form.overall} onChange={set("overall")} required />
            </Field>
            <Field label="Own services (%)">
              <input className="input" type="number" min={50} max={100} step={0.1} value={form.core} onChange={set("core")} required />
            </Field>
            <Field label="Third-party providers (%)">
              <input className="input" type="number" min={50} max={100} step={0.1} value={form.thirdParty} onChange={set("thirdParty")} required />
            </Field>
            <Field label="Long-term goal (%)">
              <input className="input" type="number" min={50} max={100} step={0.1} value={form.longTerm} onChange={set("longTerm")} required />
            </Field>
          </div>
          {services.length > 0 && (
            <div>
              <p className="mb-1.5 text-xs font-medium text-zinc-600 dark:text-zinc-400">Services run by your team (the rest are third-party providers)</p>
              <div className="flex flex-wrap gap-3">
                {services.map((svc) => (
                  <label key={svc} className="flex items-center gap-1.5 text-sm">
                    <input
                      type="checkbox"
                      checked={core.includes(svc)}
                      onChange={(e) => setCore((c) => (e.target.checked ? [...c, svc] : c.filter((x) => x !== svc)))}
                    />
                    {svc}
                  </label>
                ))}
              </div>
            </div>
          )}
          <div className="flex items-center gap-3">
            <button className="btn-primary" disabled={busy}>
              {busy ? "Saving…" : "Save targets"}
            </button>
            {msg && <span className={`text-xs ${msg.ok ? "text-emerald-600" : "text-red-600"}`}>{msg.text}</span>}
          </div>
        </form>
      </Panel>
    </section>
  );
}
