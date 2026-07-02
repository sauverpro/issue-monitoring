const BASE = import.meta.env.VITE_API_BASE ?? "/api";

export const TOKEN_KEY = "koralink_token";

function getToken(): string | null {
  return localStorage.getItem(TOKEN_KEY);
}

export function setToken(token: string | null): void {
  if (token) localStorage.setItem(TOKEN_KEY, token);
  else localStorage.removeItem(TOKEN_KEY);
}

export async function apiFetch<T>(
  path: string,
  init?: RequestInit & { json?: unknown }
): Promise<T> {
  const headers = new Headers(init?.headers);
  const token = getToken();
  if (token) headers.set("Authorization", `Bearer ${token}`);
  if (init?.json !== undefined) headers.set("Content-Type", "application/json");
  const res = await fetch(`${BASE}${path}`, {
    ...init,
    headers,
    body:
      init?.json !== undefined ? JSON.stringify(init.json) : init?.body,
  });
  if (!res.ok) {
    const errText = await res.text();
    let message = errText;
    try {
      const j = JSON.parse(errText) as { error?: unknown };
      message = typeof j.error === "string" ? j.error : errText;
    } catch {
      /* ignore */
    }
    throw new Error(message || `HTTP ${res.status}`);
  }
  if (res.status === 204) return undefined as T;
  return (await res.json()) as T;
}

export { BASE, getToken };
