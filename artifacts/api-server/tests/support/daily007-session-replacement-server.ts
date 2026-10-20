import express from "express";
import { pool } from "@workspace/db";
import daily007CompatCoreRouter from "../../src/routes/daily007-compat-core";
import daily007V2Router from "../../src/routes/daily007-v2";

const app = express();
app.set("trust proxy", 1);
app.use(express.json());
app.use(daily007V2Router);
app.use(daily007CompatCoreRouter);
app.use((
  error: unknown,
  _request: express.Request,
  response: express.Response,
  _next: express.NextFunction,
) => {
  response.status(500).json({
    error: "Test server encountered an unexpected error.",
    detail: error instanceof Error ? error.message : String(error),
  });
});

const server = app.listen(0, "127.0.0.1", () => {
  const address = server.address();
  if (!address || typeof address === "string") {
    throw new Error("Could not start session-replacement test server.");
  }
  process.stdout.write(`READY:${address.port}\n`);
});

process.on("SIGTERM", () => {
  server.close(() => {
    void pool.end().finally(() => process.exit(0));
  });
});
