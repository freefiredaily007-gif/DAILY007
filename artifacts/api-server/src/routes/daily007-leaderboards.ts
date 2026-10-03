import { Router, type IRouter, type Request, type Response } from "express";
import { authenticate, requireAdmin } from "./daily007-v2";
import {
  getDaily007LeaderboardRewardSettings,
  getDaily007Leaderboards,
  updateDaily007LeaderboardRewardSettings,
} from "../lib/daily007-leaderboards";

const router: IRouter = Router();
const MAX_INT = 2_147_483_647;
const REWARD_KEYS = ["firstPlaceCoins", "secondPlaceCoins", "thirdPlaceCoins"] as const;

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
    error(res, 409, "This leaderboard reward update conflicts with existing data.");
    return;
  }
  throw cause;
}

router.get("/daily007/v2/leaderboards", async (_req, res): Promise<void> => {
  res.json(await getDaily007Leaderboards());
});

router.get(
  "/daily007/v2/admin/leaderboards/rewards",
  authenticate,
  async (req, res): Promise<void> => {
    if (!requireAdmin(req, res)) return;
    try {
      res.json(await getDaily007LeaderboardRewardSettings());
    } catch (cause) {
      respondFailure(res, cause);
    }
  },
);

router.put(
  "/daily007/v2/admin/leaderboards/rewards",
  authenticate,
  async (req, res): Promise<void> => {
    if (!requireAdmin(req, res)) return;
    const adminId = req.daily007Account?.id;
    if (!adminId) {
      error(res, 400, "A Full Admin account is required.");
      return;
    }

    const body = req.body as unknown;
    if (!isObject(body) || !isObject(body.weekly) || !isObject(body.monthly)) {
      error(res, 400, "Provide weekly and monthly reward amounts.");
      return;
    }

    type RewardAmountsInput = {
      firstPlaceCoins: number;
      secondPlaceCoins: number;
      thirdPlaceCoins: number;
    };
    const schedules: {
      weekly: RewardAmountsInput;
      monthly: RewardAmountsInput;
    } = {
      weekly: { firstPlaceCoins: 0, secondPlaceCoins: 0, thirdPlaceCoins: 0 },
      monthly: { firstPlaceCoins: 0, secondPlaceCoins: 0, thirdPlaceCoins: 0 },
    };
    for (const cycleType of ["weekly", "monthly"] as const) {
      const schedule = body[cycleType] as Record<string, unknown>;
      for (const key of REWARD_KEYS) {
        const value = schedule[key];
        if (
          typeof value !== "number" ||
          !Number.isSafeInteger(value) ||
          value < 0 ||
          value > MAX_INT
        ) {
          error(res, 400, "Each reward must be a whole number of coins from 0 to 2147483647.");
          return;
        }
        schedules[cycleType][key] = value;
      }
    }

    try {
      res.json(await updateDaily007LeaderboardRewardSettings(adminId, schedules));
    } catch (cause) {
      respondFailure(res, cause);
    }
  },
);

export default router;