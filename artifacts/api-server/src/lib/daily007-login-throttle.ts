import type { Request, Response } from "express";

export const DAILY007_LOGIN_ATTEMPT_LIMIT = 10;
export const DAILY007_LOGIN_ATTEMPT_WINDOW_MS = 60_000;
export const DAILY007_LOGIN_RATE_LIMIT_MESSAGE =
  "Too many login attempts. Please try again shortly.";

type AttemptWindow = {
  attempts: number;
  expiresAt: number;
};

export type LoginThrottleResult =
  | { allowed: true }
  | { allowed: false; retryAfterSeconds: number };

type LoginThrottleOptions = {
  limit?: number;
  windowMs?: number;
  maxTrackedClients?: number;
  now?: () => number;
};

export function createDaily007LoginThrottle({
  limit = DAILY007_LOGIN_ATTEMPT_LIMIT,
  windowMs = DAILY007_LOGIN_ATTEMPT_WINDOW_MS,
  maxTrackedClients = 20_000,
  now = Date.now,
}: LoginThrottleOptions = {}) {
  if (!Number.isSafeInteger(limit) || limit < 1) {
    throw new Error("The Daily007 login attempt limit must be a positive integer.");
  }
  if (!Number.isFinite(windowMs) || windowMs < 1) {
    throw new Error("The Daily007 login attempt window must be positive.");
  }
  if (!Number.isSafeInteger(maxTrackedClients) || maxTrackedClients < 1) {
    throw new Error("The Daily007 login throttle must track at least one client.");
  }

  const clients = new Map<string, AttemptWindow>();
  let operations = 0;

  const pruneExpired = (timestamp: number) => {
    for (const [clientId, entry] of clients) {
      if (entry.expiresAt <= timestamp) clients.delete(clientId);
    }
  };

  return {
    consume(clientId: string): LoginThrottleResult {
      const timestamp = now();
      const key = clientId.trim() || "unknown";
      if (++operations % 256 === 0) pruneExpired(timestamp);

      let entry = clients.get(key);
      if (entry && entry.expiresAt <= timestamp) {
        clients.delete(key);
        entry = undefined;
      }

      if (!entry) {
        if (clients.size >= maxTrackedClients) {
          pruneExpired(timestamp);
          if (clients.size >= maxTrackedClients) {
            const oldestClient = clients.keys().next().value;
            if (oldestClient !== undefined) clients.delete(oldestClient);
          }
        }
        clients.set(key, { attempts: 1, expiresAt: timestamp + windowMs });
        return { allowed: true };
      }

      if (entry.attempts >= limit) {
        return {
          allowed: false,
          retryAfterSeconds: Math.max(1, Math.ceil((entry.expiresAt - timestamp) / 1000)),
        };
      }

      entry.attempts += 1;
      return { allowed: true };
    },
  };
}

const daily007LoginThrottle = createDaily007LoginThrottle();

export function checkDaily007LoginThrottle(req: Request, res: Response): boolean {
  const result = daily007LoginThrottle.consume(req.ip || req.socket.remoteAddress || "unknown");
  if (result.allowed) return true;

  res.setHeader("Retry-After", String(result.retryAfterSeconds));
  res.status(429).json({ error: DAILY007_LOGIN_RATE_LIMIT_MESSAGE });
  return false;
}
