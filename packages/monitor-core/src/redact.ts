const SENSITIVE_KEY =
  /pass(word|wd)?|pin|otp|cvv|secret|token|authorization|access_token|refresh_token|api[_-]?key|card(_?number)?|mntr_/i;

const MAX_BODY_CHARS = 131072;

export function redactValue(value: unknown, depth = 0): unknown {
  if (depth > 8) return "[truncated]";
  if (value == null) return value;
  if (typeof value === "string") {
    const t = value.trim();
    if ((t.startsWith("{") && t.endsWith("}")) || (t.startsWith("[") && t.endsWith("]"))) {
      try {
        return redactValue(JSON.parse(t) as unknown, depth + 1);
      } catch {
        return value;
      }
    }
    return value;
  }
  if (Array.isArray(value)) return value.map((v) => redactValue(v, depth + 1));
  if (typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      out[k] = SENSITIVE_KEY.test(k) ? "[redacted]" : redactValue(v, depth + 1);
    }
    return out;
  }
  return value;
}

export function clipAndRedactBody(raw: unknown): unknown {
  if (raw === undefined || raw === null || raw === "") return undefined;
  const redacted = redactValue(raw);
  const text = typeof redacted === "string" ? redacted : JSON.stringify(redacted);
  if (text.length <= MAX_BODY_CHARS) return redacted;
  return text.slice(0, MAX_BODY_CHARS);
}
