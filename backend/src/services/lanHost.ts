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
