import { createHash } from "node:crypto";
import type { Request, Response } from "express";
import { pool } from "@workspace/db";
import { logger } from "./logger";

export const DAILY007_LOGIN_ATTEMPT_LIMIT = 10;
export const DAILY007_LOGIN_ATTEMPT_WINDOW_MS = 60_000;
export const DAILY007_LOGIN_RATE_LIMIT_MESSAGE =
  "Too many login attempts. Please try again shortly.";

export type LoginThrottleResult =
  | { allowed: true }
  | { allowed: false; retryAfterSeconds: number };

type LoginThrottleOptions = {
  limit?: number;
  windowMs?: number;
};

export function createDaily007LoginThrottle({
  limit = DAILY007_LOGIN_ATTEMPT_LIMIT,
  windowMs = DAILY007_LOGIN_ATTEMPT_WINDOW_MS,
}: LoginThrottleOptions = {}) {
  if (!Number.isSafeInteger(limit) || limit < 1) {
    throw new Error("The Daily007 login attempt limit must be a positive integer.");
  }
  if (limit >= 2_147_483_647) {
    throw new Error("The Daily007 login attempt limit must fit a PostgreSQL integer.");
  }
  if (!Number.isFinite(windowMs) || windowMs < 1) {
    throw new Error("The Daily007 login attempt window must be positive.");
  }
  let operations = 0;

  return {
    async consume(clientId: string): Promise<LoginThrottleResult> {
      const key = clientId.trim() || "unknown";
      const clientIpHash = createHash("sha256").update(key).digest("hex");
      const result = await pool.query<{ attempts: number; retry_after_seconds: number }>(
        `INSERT INTO daily007_login_rate_limits
           (client_ip_hash, attempts, expires_at)
         VALUES ($1, 1, now() + ($2::double precision * interval '1 millisecond'))
         ON CONFLICT (client_ip_hash) DO UPDATE
           SET attempts = CASE
                 WHEN daily007_login_rate_limits.expires_at <= now() THEN 1
                 ELSE LEAST(daily007_login_rate_limits.attempts + 1, $3::integer + 1)
               END,
               expires_at = CASE
                 WHEN daily007_login_rate_limits.expires_at <= now() THEN EXCLUDED.expires_at
                 ELSE daily007_login_rate_limits.expires_at
               END
         RETURNING attempts,
           GREATEST(1, CEIL(EXTRACT(EPOCH FROM (expires_at - now()))))::integer AS retry_after_seconds`,
        [clientIpHash, windowMs, limit],
      );
      const row = result.rows[0];
      if (!row) throw new Error("Daily007 login throttle did not return its shared counter.");

      if (++operations % 256 === 0) {
        void pool.query(
          "DELETE FROM daily007_login_rate_limits WHERE expires_at <= now()",
        ).catch((error: unknown) => {
          logger.warn({ err: error }, "Could not prune expired Daily007 login throttle counters.");
        });
      }

      return row.attempts <= limit
        ? { allowed: true }
        : { allowed: false, retryAfterSeconds: row.retry_after_seconds };
    },
  };
}

const daily007LoginThrottle = createDaily007LoginThrottle();

export async function checkDaily007LoginThrottle(req: Request, res: Response): Promise<boolean> {
  const result = await daily007LoginThrottle.consume(
    req.ip || req.socket.remoteAddress || "unknown",
  );
  if (result.allowed) return true;

  res.setHeader("Retry-After", String(result.retryAfterSeconds));
  res.status(429).json({ error: DAILY007_LOGIN_RATE_LIMIT_MESSAGE });
  return false;
}
