import { Router, type IRouter } from "express";
import healthRouter from "./health";
import daily007V2Router from "./daily007-v2";

const router: IRouter = Router();

router.use(healthRouter);
router.use(daily007V2Router);

export default router;
