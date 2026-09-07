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
  if (allowedHosts.length === 0) return false;
  const host = extractHost(requestUrl);
  if (!host) return false;
  return allowedHosts.some((h) => {
    const needle = normalizeHost(h);
    if (!needle) return false;
    return host === needle || host.endsWith(`.${needle}`);
  });
}

export type Outcome = "SUCCESS" | "FAILURE" | "OTHER";

export function deriveOutcome(statusCode: number): Outcome {
  if (statusCode === 0) return "OTHER";
  if (statusCode >= 200 && statusCode < 300) return "SUCCESS";
  return "FAILURE";
}

export function classifyNetworkFailure(err: unknown): string {
  const msg =
    err instanceof Error
      ? `${err.name} ${err.message}`
      : typeof err === "string"
        ? err
        : String(err ?? "");
  const t = msg.toLowerCase();
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
  return msg.slice(0, 128) || "FETCH_ERROR";
}
