export function normalizeHost(host: string): string {
  return host.trim().toLowerCase().replace(/^www\./, "");
}

export function extractHost(requestUrl: string): string | null {
  const raw = requestUrl.trim();
  if (!raw) return null;
  try {
    const candidate = raw.includes("://") ? raw : `https://${raw.replace(/^\/+/, "")}`;
    return normalizeHost(new URL(candidate).hostname);
  } catch {
    return null;
  }
}

export function hostAllowed(requestUrl: string, allowedHosts: string[]): boolean {
  const host = extractHost(requestUrl);
  if (!host) return false;
  return allowedHosts.some((h) => {
    const needle = normalizeHost(h);
    if (!needle) return false;
    return host === needle || host.endsWith(`.${needle}`);
  });
}

export function matchUpstreamSlug(
  requestUrl: string,
  upstreams: Array<{ slug: string; host: string }>
): string | null {
  const host = extractHost(requestUrl);
  if (!host) return null;
  for (const u of upstreams) {
    const needle = normalizeHost(u.host);
    if (host === needle || host.endsWith(`.${needle}`)) return u.slug.toUpperCase();
  }
  return null;
}

export function slugUpstreamKey(host: string, path: string): string {
  const base = `${host}_${path.replace(/^\/+/, "").replace(/[^a-zA-Z0-9]+/g, "_")}`
    .toLowerCase()
    .replace(/^_+|_+$/g, "");
  const slug = base.length > 0 ? base : "unknown";
  return slug.slice(0, 128);
}

export function classifyNetworkFailure(reason: string | undefined): string | undefined {
  if (!reason) return undefined;
  const t = reason.toLowerCase();
  if (t.includes("offline") || t.includes("network request failed") || t.includes("failed to fetch")) {
    return "offline";
  }
  if (t.includes("enotfound") || t.includes("dns") || t.includes("getaddrinfo")) return "dns";
  if (t.includes("cert") || t.includes("ssl") || t.includes("tls") || t.includes("err_cert")) {
    return "tls";
  }
  if (t.includes("timeout") || t.includes("timed out") || t.includes("etimedout") || t.includes("abort")) {
    return "timeout";
  }
  return reason.slice(0, 128);
}
