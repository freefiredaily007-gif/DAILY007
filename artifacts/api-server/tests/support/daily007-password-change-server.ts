import express from "express";
import { pool } from "@workspace/db";
import daily007CompatCoreRouter from "../../src/routes/daily007-compat-core";
import daily007V2Router from "../../src/routes/daily007-v2";

const app = express();
app.use(express.json());
app.use((request, response, next) => {
  if (
    request.method === "PATCH"
    && request.path === "/auth/me/password"
    && request.get("x-test-drop-password-change-response") === "after-commit"
  ) {
    const sendJson = response.json.bind(response);
    response.json = ((body: unknown) => {
      if (response.statusCode >= 200 && response.statusCode < 300) {
        response.socket?.destroy();
        return response;
      }
      return sendJson(body);
    }) as typeof response.json;
  }
  next();
});
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
  if (!address || typeof address === "string") throw new Error("Could not start password-change test server.");
  process.stdout.write(`READY:${address.port}\n`);
});

process.on("SIGTERM", () => {
  server.close(() => {
    void pool.end().finally(() => process.exit(0));
  });
});
