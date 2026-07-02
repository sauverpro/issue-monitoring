import type { Response } from "express";

type SseClient = { res: Response };

const clients = new Set<SseClient>();

export function addSseClient(res: Response): () => void {
  const client = { res };
  clients.add(client);
  return () => {
    clients.delete(client);
  };
}

export function broadcastSse(event: string, data: unknown): void {
  const payload =
    typeof data === "string" ? data : JSON.stringify(data);
  const dead: SseClient[] = [];
  for (const c of clients) {
    try {
      c.res.write(`event: ${event}\n`);
      c.res.write(`data: ${payload}\n\n`);
    } catch {
      dead.push(c);
    }
  }
  dead.forEach((c) => clients.delete(c));
}
