import { Router, type IRouter } from "express";
import healthRouter from "./health";
import daily007V2Router from "./daily007-v2";
import daily007CompatCoreRouter from "./daily007-compat-core";
import daily007CompatExtraRouter from "./daily007-compat-extra";
import daily007LeaderboardRouter from "./daily007-leaderboards";
import daily007GoogleAuthRouter from "./daily007-google-auth";

const router: IRouter = Router();

router.use(healthRouter);
router.use(daily007V2Router);
router.use(daily007CompatCoreRouter);
router.use(daily007CompatExtraRouter);
router.use(daily007LeaderboardRouter);
router.use(daily007GoogleAuthRouter);

export default router;
