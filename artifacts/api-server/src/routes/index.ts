import { Router, type IRouter } from "express";
import healthRouter from "./health";
import daily007V2Router from "./daily007-v2";
import daily007CompatCoreRouter from "./daily007-compat-core";
import daily007CompatExtraRouter from "./daily007-compat-extra";

const router: IRouter = Router();

router.use(healthRouter);
router.use(daily007V2Router);
router.use(daily007CompatCoreRouter);
router.use(daily007CompatExtraRouter);

export default router;
