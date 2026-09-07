import type { RequestHandler } from "express";
import type { Pool } from "pg";
import type { OrgRole } from "../types/consoleAuth.js";
import { getMembership, getProject } from "../services/tenancy.js";
import { roleAtLeast } from "../services/orgRoles.js";

export function requireOrg(pool: Pool, minRole: OrgRole = "viewer"): RequestHandler {
  return async (req, res, next) => {
    const userId = req.consoleAuth?.sub;
    const orgId = String(req.params.orgId ?? "");
    if (!userId || !orgId) {
      res.status(401).json({ error: "Unauthorized" });
      return;
    }
    try {
      const membership = await getMembership(pool, orgId, userId);
      if (!membership) {
        if (req.consoleAuth?.isPlatformAdmin) {
          req.consoleMembership = { orgId, role: "owner" };
          next();
          return;
        }
        res.status(404).json({ error: "Organization not found" });
        return;
      }
      if (!roleAtLeast(membership.role, minRole)) {
        res.status(403).json({ error: "Insufficient permissions" });
        return;
      }
      req.consoleMembership = { orgId, role: membership.role };
      next();
    } catch (err) {
      next(err);
    }
  };
}

export function requireProject(pool: Pool, minRole: OrgRole = "viewer"): RequestHandler {
  return async (req, res, next) => {
    const userId = req.consoleAuth?.sub;
    const projectId = String(req.params.projectId ?? "");
    if (!userId || !projectId) {
      res.status(401).json({ error: "Unauthorized" });
      return;
    }
    try {
      const project = await getProject(pool, projectId);
      if (!project) {
        res.status(404).json({ error: "Project not found" });
        return;
      }
      const membership = await getMembership(pool, project.organizationId, userId);
      if (!membership) {
        if (!req.consoleAuth?.isPlatformAdmin) {
          res.status(404).json({ error: "Project not found" });
          return;
        }
        req.consoleMembership = { orgId: project.organizationId, role: "owner" };
      } else if (!roleAtLeast(membership.role, minRole)) {
        res.status(403).json({ error: "Insufficient permissions" });
        return;
      } else {
        req.consoleMembership = { orgId: project.organizationId, role: membership.role };
      }
      req.consoleProject = project;
      next();
    } catch (err) {
      next(err);
    }
  };
}
