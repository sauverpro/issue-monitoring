/** Shared screen-label helpers for journey / funnel / behavior queries. */

/**
 * SQL expression that names a session_actions row's screen.
 * Prefers explicit columns, then JSON payload keys used by Sentry/SDK, then
 * parses common navigation message patterns before falling back to '(unknown)'.
 */
export function screenLabelSql(alias = ""): string {
  const p = alias ? `${alias}.` : "";
  return `COALESCE(
    NULLIF(TRIM(${p}screen), ''),
    NULLIF(TRIM(${p}payload->>'toScreen'), ''),
    NULLIF(TRIM(${p}payload->>'screenName'), ''),
    NULLIF(TRIM(${p}payload->>'current_screen'), ''),
    NULLIF(TRIM(${p}payload->>'to'), ''),
    NULLIF(TRIM(${p}from_screen), ''),
    NULLIF(TRIM(${p}payload->>'fromScreen'), ''),
    NULLIF(TRIM(
      CASE
        WHEN ${p}message ~* '^(Opened|Viewed)[[:space:]]+' THEN
          regexp_replace(${p}message, '^(Opened|Viewed)[[:space:]]+', '', 'i')
        WHEN ${p}message ~* 'viewed[[:space:]]+screen[:[:space:]]+' THEN
          regexp_replace(${p}message, '^.*viewed[[:space:]]+screen[:[:space:]]+', '', 'i')
        WHEN ${p}message ~* '^navigation:[[:space:]]*' THEN
          regexp_replace(${p}message, '^navigation:[[:space:]]*', '', 'i')
        WHEN ${p}message ~ '→' THEN TRIM(split_part(${p}message, '→', 2))
        WHEN ${p}message ~ '->' THEN TRIM(split_part(${p}message, '->', 2))
        WHEN NULLIF(TRIM(${p}message), '') IS NOT NULL
          AND ${p}message !~* '^(navigation|screen[_ ]?view|lifecycle|auth|click|system)$'
          AND char_length(TRIM(${p}message)) BETWEEN 1 AND 80
          THEN TRIM(${p}message)
        ELSE NULL
      END
    ), ''),
    '(unknown)'
  )`;
}

/** Navigation-like action kinds that represent screen visits. */
export const NAV_KIND_SQL = `kind IN ('navigation', 'screen_view')`;

export function navKindSql(alias = ""): string {
  const p = alias ? `${alias}.` : "";
  return `${p}kind IN ('navigation', 'screen_view')`;
}

export function isUnknownScreen(screen: string | null | undefined): boolean {
  if (!screen) return true;
  return /^\(?\s*unknown\s*\)?$/i.test(screen.trim());
}

/** Prefer a named entry screen when building funnels. */
export function pickFunnelStart<T extends { screen: string }>(
  steps: T[]
): T | undefined {
  return steps.find((s) => !isUnknownScreen(s.screen)) ?? steps[0];
}

/**
 * Best-effort screen name from a breadcrumb / event message when structured
 * fields are missing (common in Sentry navigation crumbs).
 */
export function deriveScreenFromMessage(message: string | undefined | null): string | undefined {
  if (!message) return undefined;
  const msg = message.trim();
  if (!msg) return undefined;

  const opened = msg.match(/^(?:Opened|Viewed)\s+(.+)$/i);
  if (opened?.[1]) return opened[1].trim();

  const viewed = msg.match(/viewed\s+screen[:\s]+(.+)$/i);
  if (viewed?.[1]) return viewed[1].trim();

  const nav = msg.match(/^navigation:\s*(.+)$/i);
  if (nav?.[1]) {
    const part = nav[1].includes("→")
      ? nav[1].split("→").pop()
      : nav[1].includes("->")
        ? nav[1].split("->").pop()
        : nav[1];
    return part?.trim() || undefined;
  }

  if (msg.includes("→")) return msg.split("→").pop()?.trim() || undefined;
  if (msg.includes("->")) return msg.split("->").pop()?.trim() || undefined;

  if (
    msg.length <= 80 &&
    !/^(navigation|screen[_ ]?view|lifecycle|auth|click|system)$/i.test(msg)
  ) {
    return msg;
  }
  return undefined;
}
