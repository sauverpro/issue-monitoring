const TRANSIENT_STATUS = new Set([408, 429, 502, 503, 504]);

export function summarizeSentryBody(body: string): string {
  const trimmed = body.trim();
  if (!trimmed) return "empty body";
  if (/^<!doctype html/i.test(trimmed) || /^<html/i.test(trimmed)) {
    return "HTML error page (Sentry gateway)";
  }
  try {
    const j = JSON.parse(trimmed) as { error?: unknown; detail?: unknown };
    const parts = [j.error, j.detail].filter((x) => typeof x === "string") as string[];
    if (parts.length) return parts.join(": ");
  } catch {
    /* not JSON */
  }
  return trimmed.replace(/\s+/g, " ").slice(0, 160);
}

export function isTransientSentryStatus(status: number): boolean {
  return TRANSIENT_STATUS.has(status);
}

export class SentryApiError extends Error {
  constructor(
    public readonly status: number,
    body: string
  ) {
    super(`Sentry API ${status}: ${summarizeSentryBody(body)}`);
    this.name = "SentryApiError";
  }
}

export function isTransientSentryError(err: unknown): boolean {
  if (err instanceof SentryApiError) return isTransientSentryStatus(err.status);
  if (err instanceof Error && (err.name === "TimeoutError" || err.name === "AbortError")) {
    return true;
  }
  return false;
}
