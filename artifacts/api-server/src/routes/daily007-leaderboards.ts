import { Router, type IRouter, type Request, type Response } from "express";
import { authenticate, requireAdmin, withDaily007RoleTransaction } from "./daily007-v2";
import {
  approveDaily007LeaderboardPeriod,
  getDaily007LeaderboardApprovals,
  getDaily007LeaderboardRewardSettings,
  getDaily007Leaderboards,
  scheduleDaily007LeaderboardPeriod,
  updateDaily007LeaderboardRewardSettings,
} from "../lib/daily007-leaderboards";
import type { LeaderboardCycleType } from "../lib/daily007-leaderboard-core";

const router: IRouter = Router();
const MAX_INT = 2_147_483_647;
const REWARD_KEYS = ["firstPlaceCoins", "secondPlaceCoins", "thirdPlaceCoins"] as const;
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

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
    const adminId = req.daily007Account?.id;
    if (!adminId) {
      error(res, 401, "A valid Daily007 account is required.");
      return;
    }
    try {
      res.json(await withDaily007RoleTransaction(adminId, "admin", () =>
        getDaily007LeaderboardRewardSettings()));
    } catch (cause) {
      respondFailure(res, cause);
    }
  },
);

router.get(
  "/daily007/v2/admin/leaderboards/approvals",
  authenticate,
  async (req, res): Promise<void> => {
    if (!requireAdmin(req, res)) return;
    const adminId = req.daily007Account?.id;
    if (!adminId) {
      error(res, 401, "A valid Daily007 account is required.");
      return;
    }
    try {
      res.json(await withDaily007RoleTransaction(adminId, "admin", () =>
        getDaily007LeaderboardApprovals()));
    } catch (cause) {
      respondFailure(res, cause);
    }
  },
);

router.post(
  "/daily007/v2/admin/leaderboards/cycles/start",
  authenticate,
  async (req, res): Promise<void> => {
    if (!requireAdmin(req, res)) return;
    const adminId = req.daily007Account?.id;
    if (!adminId) {
      error(res, 400, "A Full Admin account is required.");
      return;
    }

    const body = req.body as unknown;
    if (
      !isObject(body) ||
      (body.cycleType !== "weekly" && body.cycleType !== "monthly") ||
      !isObject(body.rewards)
    ) {
      error(res, 400, "Provide a weekly or monthly cycle and its three reward amounts.");
      return;
    }
    const cycleType = body.cycleType as LeaderboardCycleType;
    const rewards = {
      firstPlaceCoins: body.rewards.firstPlaceCoins,
      secondPlaceCoins: body.rewards.secondPlaceCoins,
      thirdPlaceCoins: body.rewards.thirdPlaceCoins,
    };
    for (const value of Object.values(rewards)) {
      if (
        typeof value !== "number" ||
        !Number.isSafeInteger(value) ||
        value < 0 ||
        value > MAX_INT
      ) {
        error(res, 400, "Each reward must be a whole number of coins from 0 to 2147483647.");
        return;
      }
    }

    try {
      res.status(201).json(
        await withDaily007RoleTransaction(adminId, "admin", () =>
          scheduleDaily007LeaderboardPeriod(adminId, cycleType, rewards as {
            firstPlaceCoins: number;
            secondPlaceCoins: number;
            thirdPlaceCoins: number;
          })),
      );
    } catch (cause) {
      respondFailure(res, cause);
    }
  },
);

router.post(
  "/daily007/v2/admin/leaderboards/periods/:periodId/approve",
  authenticate,
  async (req, res): Promise<void> => {
    if (!requireAdmin(req, res)) return;
    const adminId = req.daily007Account?.id;
    const periodId = req.params.periodId;
    if (!adminId) {
      error(res, 400, "A Full Admin account is required.");
      return;
    }
    if (typeof periodId !== "string" || !UUID_PATTERN.test(periodId)) {
      error(res, 400, "Leaderboard period id must be a UUID.");
      return;
    }
    try {
      res.json(await withDaily007RoleTransaction(adminId, "admin", () =>
        approveDaily007LeaderboardPeriod(periodId, adminId)));
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
    if (!isObject(body) || (!isObject(body.weekly) && !isObject(body.monthly))) {
      error(res, 400, "Provide reward amounts for at least one cycle.");
      return;
    }

    type RewardAmountsInput = {
      firstPlaceCoins: number;
      secondPlaceCoins: number;
      thirdPlaceCoins: number;
    };
    const schedules: Partial<Record<LeaderboardCycleType, RewardAmountsInput>> = {};
    for (const cycleType of ["weekly", "monthly"] as const) {
      if (!isObject(body[cycleType])) continue;
      const schedule = body[cycleType] as Record<string, unknown>;
      const amounts = {
        firstPlaceCoins: 0,
        secondPlaceCoins: 0,
        thirdPlaceCoins: 0,
      };
      let valid = true;
      for (const key of REWARD_KEYS) {
        const value = schedule[key];
        if (
          typeof value !== "number" ||
          !Number.isSafeInteger(value) ||
          value < 0 ||
          value > MAX_INT
        ) {
          error(res, 400, "Each reward must be a whole number of coins from 0 to 2147483647.");
          valid = false;
          break;
        }
        amounts[key] = value;
      }
      if (!valid) return;
      schedules[cycleType] = amounts;
    }

    try {
      res.json(await withDaily007RoleTransaction(adminId, "admin", () =>
        updateDaily007LeaderboardRewardSettings(adminId, schedules)));
    } catch (cause) {
      respondFailure(res, cause);
    }
  },
);

export default router;