import express from "express";
import { pool } from "@workspace/db";
import daily007CompatExtraRouter from "../../src/routes/daily007-compat-extra";
import daily007GoogleAuthRouter from "../../src/routes/daily007-google-auth";
import daily007V2Router from "../../src/routes/daily007-v2";
import { resetMockGoogleUser, type User } from "./daily007-google-auth-clerk-mock";

const clerkUserId = process.env.DAILY007_TEST_GOOGLE_CLERK_USER_ID;
const email = process.env.DAILY007_TEST_GOOGLE_EMAIL;
if (!clerkUserId || !email) {
  throw new Error("The Google auth restart test server requires a mocked Clerk identity.");
}

resetMockGoogleUser({
  id: clerkUserId,
  firstName: "Google",
  lastName: "Postgres",
  emailAddresses: [{
    emailAddress: email,
    verification: { status: "verified" },
  }],
  externalAccounts: [{
    provider: "google",
    emailAddress: email,
    firstName: "Google",
    lastName: "Postgres",
    verification: { status: "verified" },
  }],
} satisfies User);

const app = express();
app.use(express.json());
app.use((request, _response, next) => {
  Object.assign(request, {
    auth: { userId: request.get("x-mock-clerk-user-id") ?? clerkUserId },
  });
  next();
});
app.use(daily007V2Router);
app.use(daily007GoogleAuthRouter);
app.use(daily007CompatExtraRouter);
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
    throw new Error("Could not start the Google auth restart test server.");
  }
  process.stdout.write(`READY:${address.port}\n`);
});

process.on("SIGTERM", () => {
  server.close(() => {
    void pool.end().finally(() => process.exit(0));
  });
});
