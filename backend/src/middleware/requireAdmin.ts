import type { RequestHandler } from "express";

/** Must run after requireJwt — relies on req.auth being populated. */
export const requireAdmin: RequestHandler = (req, res, next) => {
  if (req.auth?.role !== "admin") {
    res.status(403).json({ error: "Admin access required" });
    return;
  }
  next();
};
