import { Router, type IRouter, type Request, type Response } from "express";
import { authenticate, requireAdmin } from "./daily007-v2";
import {
  approveDaily007LeaderboardPeriod,
  getDaily007LeaderboardApprovalQueue,
  getDaily007Leaderboards,
} from "../lib/daily007-leaderboards";

const router: IRouter = Router();
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const MAX_INT = 2_147_483_647;

function isObject(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

function error(res: Response, status: number, message: string): void {
  res.status(status).json({ error: message });
}

function respondFailure(res: Response, cause: unknown): void {
  const status = (cause as { status?: number })?.status;
  if (status) {
    error(res, status, (cause as Error).message);
    return;
  }
  if ((cause as { code?: string })?.code === "23505") {
    error(res, 409, "This leaderboard payout was already recorded.");
    return;
  }
  throw cause;
}

router.get("/daily007/v2/leaderboards", async (_req, res): Promise<void> => {
  res.json(await getDaily007Leaderboards());
});

router.get(
  "/daily007/v2/admin/leaderboards/periods",
  authenticate,
  async (req, res): Promise<void> => {
    if (!requireAdmin(req, res)) return;
    res.json(await getDaily007LeaderboardApprovalQueue());
  },
);

router.post(
  "/daily007/v2/admin/leaderboards/periods/:id/approve",
  authenticate,
  async (req, res): Promise<void> => {
    if (!requireAdmin(req, res)) return;
    const periodParam = req.params.id;
    const periodId = Array.isArray(periodParam) ? periodParam[0] : periodParam;
    const adminId = req.daily007Account?.id;
    if (typeof periodId !== "string" || !UUID.test(periodId) || !adminId) {
      error(res, 400, "A valid leaderboard period and Full Admin account are required.");
      return;
    }

    const body = req.body as unknown;
    if (!isObject(body) || !Array.isArray(body.payouts) || body.payouts.length > 10) {
      error(res, 400, "Provide up to 10 leaderboard rank and coin payout entries.");
      return;
    }

    const ranks = new Set<number>();
    const payouts: { rank: number; coins: number }[] = [];
    for (const entry of body.payouts) {
      if (
        !isObject(entry) ||
        typeof entry.rank !== "number" ||
        !Number.isSafeInteger(entry.rank) ||
        entry.rank < 1 ||
        entry.rank > 100 ||
        typeof entry.coins !== "number" ||
        !Number.isSafeInteger(entry.coins) ||
        entry.coins < 1 ||
        entry.coins > MAX_INT ||
        ranks.has(entry.rank)
      ) {
        error(res, 400, "Each payout needs a unique rank from 1 to 100 and a positive coin amount.");
        return;
      }
      ranks.add(entry.rank);
      payouts.push({ rank: entry.rank, coins: entry.coins });
    }

    try {
      res.json(await approveDaily007LeaderboardPeriod(periodId, adminId, payouts));
    } catch (cause) {
      respondFailure(res, cause);
    }
  },
);

export default router;