import type { RequestHandler } from "express";
import jwt from "jsonwebtoken";
import { config } from "../config.js";

export type DashboardRole = "admin" | "viewer";
export type JwtPayload = { sub: string; email: string; role: DashboardRole };

export function signJwt(
  userId: string,
  email: string,
  role: DashboardRole
): string {
  return jwt.sign({ sub: userId, email, role }, config.jwtSecret, {
    expiresIn: "8h",
  });
}

export const requireJwt: RequestHandler = (req, res, next) => {
  const auth = req.header("authorization")?.replace(/^Bearer\s+/i, "");
  const q = typeof req.query.token === "string" ? req.query.token : undefined;
  const token = auth || q;
  if (!token) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }
  try {
    const payload = jwt.verify(token, config.jwtSecret) as JwtPayload;
    req.auth = payload;
    next();
  } catch {
    res.status(401).json({ error: "Invalid token" });
  }
};
