import type { ServiceName } from "../constants.js";

/**
 * Hostname → product-line mapping for the five tracked APIs.
 * Matching is case-insensitive and ignores a leading `www.`.
 */
const HOST_RULES: Array<{ hosts: string[]; service: ServiceName }> = [
  { hosts: ["openapi.gwiza.tech"], service: "MVEND" },
  { hosts: ["www.djyh.rw", "djyh.rw"], service: "KORALINK" },
  { hosts: ["www.koralink.org", "koralink.org"], service: "KORALINK" },
  { hosts: ["core-api.ddin.rw"], service: "DDIN" },
  { hosts: ["rw-prod.intelligra.io", "intelligra.io"], service: "INTEGRA" },
  { hosts: ["resolveit.rw", "www.resolveit.rw"], service: "RESOLVEIT" },
];

function normalizeHost(host: string): string {
  return host.trim().toLowerCase().replace(/^www\./, "");
}

/** Classify a request URL (full URL or host) into a monitored service. */
export function mapUrlToService(requestUrl: string | undefined | null): ServiceName | null {
  if (!requestUrl) return null;
  const raw = requestUrl.trim().toLowerCase();
  if (!raw) return null;

  let host = "";
  try {
    const candidate = raw.includes("://") ? raw : `https://${raw.replace(/^\/+/, "")}`;
    host = normalizeHost(new URL(candidate).hostname);
  } catch {
    host = "";
  }

  for (const rule of HOST_RULES) {
    for (const h of rule.hosts) {
      const needle = normalizeHost(h);
      if (host && (host === needle || host.endsWith(`.${needle}`))) return rule.service;
      if (raw.includes(h.toLowerCase())) return rule.service;
    }
  }
  return null;
}

/** Map Sentry tags[service] to a monitor rollup when the URL is missing or unknown. */
export function mapAppServiceToRollup(appService: string): ServiceName {
  const s = appService.trim().toLowerCase();
  switch (s) {
    case "ddin_digital_services":
    case "ddin":
      return "DDIN";
    case "gwiza":
    case "mvend":
      return "MVEND";
    case "djyh":
    case "koralink":
      return "KORALINK";
    case "integra":
    case "integra_phones":
    case "intelligra":
      return "INTEGRA";
    case "resolveit":
    case "resolve_it":
    case "tickets":
      return "RESOLVEIT";
    case "marketplace":
    case "auth":
    default:
      return "KORALINK";
  }
}

/**
 * Prefer the called API host (Sentry `tags[endpoint]` / request URL), then the
 * Sentry `tags[service]` tag.
 */
export function mapEventToService(
  appService: string,
  requestUrl?: string | null
): ServiceName {
  return mapUrlToService(requestUrl) ?? mapAppServiceToRollup(appService);
}
