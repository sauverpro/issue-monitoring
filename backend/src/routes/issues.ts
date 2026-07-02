import { Router, type IRouter } from "express";
import type { Pool } from "pg";
import { z } from "zod";
import { requireJwt } from "../middleware/jwt.js";
import { sentryRateLimit } from "../middleware/sentryRateLimit.js";
import { issueIdSchema } from "../schemas/session.js";
import {
  fetchSentryIssuesList,
  SentryApiError,
} from "../services/sentry/sentryClient.js";
import { cacheGet, cacheSet } from "../services/cache.js";
import type { SentryIssueDetail, SessionActionsResponse } from "../types/sessionInvestigation.js";
import { config } from "../config.js";
import { correlateIssueToSession, fetchIssueWithLatestEvent } from "../services/issueCorrelation.js";
import { getSessionActions } from "../services/sessionInvestigation.js";

const listQuery = z.object({
  page: z.coerce.number().int().min(1).optional(),
  limit: z.coerce.number().int().min(1).max(100).optional(),
});

function sessionTimelineUrl(sessionId: string): string {
  return `/monitoring/sessions/${encodeURIComponent(sessionId)}`;
}

export function issuesRouter(pool: Pool): IRouter {
  const r = Router();
  r.use(sentryRateLimit);

  r.get("/api/issues", requireJwt, async (req, res) => {
    if (!config.sentry.authToken) {
      res.status(503).json({ error: "Sentry not configured" });
      return;
    }
    const parsed = listQuery.safeParse(req.query);
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.flatten() });
      return;
    }
    const page = parsed.data.page ?? 1;
    const limit = parsed.data.limit ?? 20;
    const cacheKey = `issues:list:${page}:${limit}`;
    const cached = cacheGet<{ issues: unknown[]; hasMore: boolean }>(cacheKey);
    if (cached) {
      res.json(cached);
      return;
    }
    try {
      const result = await fetchSentryIssuesList(page, limit);
      const issues = result.issues.map((issue) => ({
        id: String(issue.id ?? ""),
        title: String(issue.title ?? issue.metadata ?? "Untitled"),
        status: String(issue.status ?? "unknown"),
        level: String(issue.level ?? "error"),
        count: String(issue.count ?? "0"),
        userCount: Number(issue.userCount ?? 0),
        firstSeen: String(issue.firstSeen ?? ""),
        lastSeen: String(issue.lastSeen ?? ""),
        permalink: String(issue.permalink ?? ""),
      }));
      const payload = { issues, hasMore: result.hasMore };
      cacheSet(cacheKey, payload);
      res.json(payload);
    } catch (err) {
      console.error(err);
      res.status(502).json({
        error: err instanceof Error ? err.message : "Failed to fetch issues",
      });
    }
  });

  r.get("/api/issues/:issueId", requireJwt, async (req, res) => {
    if (!config.sentry.authToken) {
      res.status(503).json({ error: "Sentry not configured" });
      return;
    }
    const parsed = issueIdSchema.safeParse(req.params.issueId);
    if (!parsed.success) {
      res.status(400).json({ error: "Invalid issueId" });
      return;
    }
    const issueId = parsed.data;
    const cacheKey = `issue:v2:${issueId}`;
    const cached = cacheGet<SentryIssueDetail>(cacheKey);
    if (cached) {
      res.json(cached);
      return;
    }
    try {
      const issue = await fetchIssueWithLatestEvent(issueId);
      const lastSeen = String(issue.lastSeen ?? "");
      const relatedSessionId = await correlateIssueToSession(pool, issueId, {
        lastSeen,
        firstSeen: String(issue.firstSeen ?? ""),
        title: String(issue.title ?? issue.metadata ?? ""),
      });

      let session: SessionActionsResponse | null = null;
      if (relatedSessionId) {
        try {
          session = await getSessionActions(pool, relatedSessionId);
        } catch (err) {
          console.warn("[issues] session actions fetch failed", err);
        }
      }

      const detail: SentryIssueDetail = {
        id: String(issue.id ?? issueId),
        title: String(issue.title ?? issue.metadata ?? "Untitled"),
        status: String(issue.status ?? "unknown"),
        level: String(issue.level ?? "error"),
        count: String(issue.count ?? "0"),
        userCount: Number(issue.userCount ?? 0),
        firstSeen: String(issue.firstSeen ?? ""),
        lastSeen,
        permalink: String(issue.permalink ?? ""),
        project: issue.project
          ? String((issue.project as { slug?: string }).slug ?? issue.project)
          : null,
        relatedSessionId,
        sessionActionsUrl: relatedSessionId
          ? sessionTimelineUrl(relatedSessionId)
          : null,
        session,
      };
      cacheSet(cacheKey, detail);
      res.json(detail);
    } catch (err) {
      console.error(err);
      if (err instanceof SentryApiError && err.status === 404) {
        res.status(404).json({
          error:
            "Issue not found in Sentry. It may have been resolved, merged, or deleted.",
        });
        return;
      }
      res.status(502).json({
        error: err instanceof Error ? err.message : "Failed to fetch issue",
      });
    }
  });

  return r;
}
