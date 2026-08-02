import { Router, type IRouter } from "express";
import type { Pool } from "pg";
import { SERVICES } from "../constants.js";
import { requireJwt } from "../middleware/jwt.js";
import { getDashboardMetrics } from "../services/dashboardMetrics.js";

const WINDOWS: Record<string, string> = {
  "1h": "1 hour",
  "6h": "6 hours",
  "24h": "24 hours",
  "7d": "7 days",
};

/** Sparkline buckets aligned to the selected window (epoch-aligned). */
const SPARK_BUCKET_SEC: Record<string, number> = {
  "1h": 60,
  "6h": 900,
  "24h": 3600,
  "7d": 86400,
};

export function metricsRouter(pool: Pool): IRouter {
  const r = Router();

  r.get(["/api/metrics/services", "/metrics/services"], requireJwt, async (req, res) => {
    const w = (req.query.window as string) || "1h";
    const interval = WINDOWS[w];
    if (!interval) {
      res.status(400).json({ error: "Invalid window" });
      return;
    }
    const bucketSec = SPARK_BUCKET_SEC[w] ?? 60;

    const agg = await pool.query<{
      service: string;
      p50: string;
      p95: string;
      total_requests: string;
      error_rate: string;
    }>(
      `SELECT service,
        COALESCE(percentile_cont(0.5) WITHIN GROUP (ORDER BY latency_ms), 0)::text AS p50,
        COALESCE(percentile_cont(0.95) WITHIN GROUP (ORDER BY latency_ms), 0)::text AS p95,
        COUNT(*)::text AS total_requests,
        COALESCE(AVG(CASE WHEN outcome IN ('FAILURE', 'OTHER') THEN 1.0 ELSE 0 END), 0)::text AS error_rate
      FROM api_events
      WHERE occurred_at >= now() - $1::interval
      GROUP BY service`,
      [interval]
    );

    const map: Record<
      string,
      {
        p50: number;
        p95: number;
        total_requests: number;
        error_rate: number;
      }
    > = {};
    for (const row of agg.rows) {
      map[row.service] = {
        p50: Math.round(Number(row.p50)),
        p95: Math.round(Number(row.p95)),
        total_requests: Number(row.total_requests),
        error_rate: Number(row.error_rate),
      };
    }

    const services: Record<string, (typeof map)[string]> = {};
    for (const s of SERVICES) {
      services[s] = map[s] ?? {
        p50: 0,
        p95: 0,
        total_requests: 0,
        error_rate: 0,
      };
    }

    const spark: Record<string, { bucket: string; count: number }[]> = {};
    for (const s of SERVICES) {
      const sp = await pool.query<{ bucket: Date; c: string }>(
        `SELECT
           (timestamp with time zone 'epoch' +
             (floor(extract(epoch FROM occurred_at) / $2::float8) * $2::float8)
             * interval '1 second') AS bucket,
           COUNT(*)::text AS c
         FROM api_events
         WHERE service = $1 AND occurred_at >= now() - $3::interval
         GROUP BY 1
         ORDER BY 1 ASC`,
        [s, bucketSec, interval]
      );
      spark[s] = sp.rows.map((row) => ({
        bucket: row.bucket.toISOString(),
        count: Number(row.c),
      }));
    }

    res.json({
      window: w,
      services,
      sparkline: spark,
    });
  });

  r.get(["/api/metrics/dashboard", "/metrics/dashboard"], requireJwt, async (req, res) => {
    const w = (req.query.window as string) || "6h";
    if (!WINDOWS[w]) {
      res.status(400).json({ error: "Invalid window" });
      return;
    }
    try {
      const data = await getDashboardMetrics(pool, w);
      res.json(data);
    } catch (err) {
      console.error(err);
      res.status(500).json({ error: "Failed to load dashboard metrics" });
    }
  });

  return r;
}
