import { networkInterfaces } from "os";

export function lanIPv4(): string | null {
  const nets = networkInterfaces();
  const candidates: string[] = [];
  for (const addrs of Object.values(nets)) {
    for (const a of addrs ?? []) {
      if (a.family !== "IPv4" && Number(a.family) !== 4) continue;
      if (a.internal) continue;
      if (a.address.startsWith("169.254.")) continue;
      candidates.push(a.address);
    }
  }
  candidates.sort((a, b) => lanScore(a) - lanScore(b));
  return candidates[0] ?? null;
}

function lanScore(ip: string): number {
  if (ip.startsWith("192.168.")) return 0;
  if (ip.startsWith("10.")) return 1;
  if (ip.startsWith("172.")) return 2;
  return 3;
}

export function isLoopbackHttpOrigin(origin: string): boolean {
  try {
    const host = new URL(origin).hostname.toLowerCase();
    return host === "localhost" || host === "127.0.0.1" || host === "::1";
  } catch {
    return true;
  }
}

/** Loopback, emulator, or a raw IP — not a public hostname apps should ship. */
export function isPrivateHttpOrigin(origin: string): boolean {
  try {
    const host = new URL(origin.includes("://") ? origin : `http://${origin}`).hostname.toLowerCase();
    return (
      host === "localhost" ||
      host === "127.0.0.1" ||
      host === "::1" ||
      host === "10.0.2.2" ||
      /^\d{1,3}(?:\.\d{1,3}){3}$/.test(host)
    );
  } catch {
    return true;
  }
}

/** Prefer PUBLIC_INGEST_URL when it is a real hostname; otherwise the request Host. */
export function resolvePublicOrigin(
  req: { get(name: string): string | undefined; protocol: string },
  configured: string
): string {
  const trimmed = configured.replace(/\/$/, "");
  if (trimmed && !isPrivateHttpOrigin(trimmed)) return trimmed;
  const proto = String(req.get("x-forwarded-proto") || req.protocol || "http")
    .split(",")[0]!
    .trim();
  const host = String(req.get("x-forwarded-host") || req.get("host") || "")
    .split(",")[0]!
    .trim();
  if (host && !isPrivateHttpOrigin(host)) {
    return `${proto}://${host}`.replace(/\/$/, "");
  }
  return trimmed;
}

export function deviceOrigins(publicOrigin: string, port: number): {
  lanOrigin: string | null;
  androidEmulatorOrigin: string;
} {
  const lan = lanIPv4();
  return {
    lanOrigin: isLoopbackHttpOrigin(publicOrigin) && lan ? `http://${lan}:${port}` : null,
    androidEmulatorOrigin: `http://10.0.2.2:${port}`,
  };
}
