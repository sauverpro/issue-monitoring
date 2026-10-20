import { Router, type IRouter, type RequestHandler } from "express";

/** Express 4 ignores rejected promises; forward them to the error middleware instead. */
function forwardErrors(handler: unknown): unknown {
  if (typeof handler !== "function") return handler;
  const fn = handler as RequestHandler;
  if (fn.length === 4) return fn; // error middleware
  const wrapped: RequestHandler = (req, res, next) => {
    try {
      const out = fn(req, res, next) as unknown;
      if (out && typeof (out as Promise<unknown>).catch === "function") {
        (out as Promise<unknown>).catch(next);
      }
    } catch (err) {
      next(err);
    }
  };
  return wrapped;
}

/** A Router whose route handlers may be async without risking unhandled rejections. */
export function asyncRouter(): IRouter {
  const r = Router();
  for (const method of ["get", "post", "put", "patch", "delete"] as const) {
    const original = r[method].bind(r) as (...args: unknown[]) => IRouter;
    (r as unknown as Record<string, unknown>)[method] = (path: unknown, ...handlers: unknown[]) =>
      original(path, ...handlers.map(forwardErrors));
  }
  return r;
}
