import jwt from "jsonwebtoken";
import type { RequestHandler } from "express";
import { config } from "../config.js";
import type { ConsoleJwtPayload } from "../types/consoleAuth.js";

export function signConsoleJwt(
  userId: string,
  email: string,
  isPlatformAdmin: boolean
): string {
  const payload: ConsoleJwtPayload = {
    sub: userId,
    email,
    aud: "console",
    isPlatformAdmin,
  };
  return jwt.sign(payload, config.jwtSecret, { expiresIn: "8h" });
}

export const requireConsoleJwt: RequestHandler = (req, res, next) => {
  const auth = req.header("authorization")?.replace(/^Bearer\s+/i, "");
  if (!auth) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }
  try {
    const payload = jwt.verify(auth, config.jwtSecret) as ConsoleJwtPayload;
    if (payload.aud !== "console" || !payload.sub) {
      res.status(401).json({ error: "Invalid token" });
      return;
    }
    req.consoleAuth = payload;
    next();
  } catch {
    res.status(401).json({ error: "Invalid token" });
  }
};

export const requirePlatformAdmin: RequestHandler = (req, res, next) => {
  if (!req.consoleAuth?.isPlatformAdmin) {
    res.status(403).json({ error: "Platform admin required" });
    return;
  }
  next();
};
