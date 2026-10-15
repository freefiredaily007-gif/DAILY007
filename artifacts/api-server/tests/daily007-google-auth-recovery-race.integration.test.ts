import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test, { after } from "node:test";
import express from "express";
import type { Server } from "node:http";
import { pool } from "@workspace/db";
import type { User } from "@clerk/express";
import daily007AccountRecoveryRouter from "../src/routes/daily007-account-recovery";
import daily007GoogleAuthRouter from "../src/routes/daily007-google-auth";
import daily007V2Router from "../src/routes/daily007-v2";
import { makeToken } from "../src/lib/daily007-session-token";
import { resetMockGoogleUsers } from "./support/daily007-google-auth-clerk-mock";

const ACCOUNT_EMAIL = "google-recovery-race@example.test";
const SIGN_IN_CLERK_ID = "clerk-google-race-signin";
const RECOVERY_CLERK_ID = "clerk-google-race-recovery";
const REVIEW_NOTE = "Verified the requested recovery identity.";
const TEST_AUTH_SECRET = "google-recovery-race-tests-only-secret-at-least-32-chars";
const previousAuthSecret = process.env.DAILY007_AUTH_SECRET;
process.env.DAILY007_AUTH_SECRET = TEST_AUTH_SECRET;
const testDatabaseUrl = process.env.DATABASE_URL ? new URL(process.env.DATABASE_URL) : null;

if (
  process.env.DAILY007_ISOLATED_POSTGRES_TEST !== "1" ||
  !testDatabaseUrl ||
  testDatabaseUrl.hostname !== "127.0.0.1" ||
  testDatabaseUrl.pathname !== "/postgres" ||
  testDatabaseUrl.port !== process.env.DAILY007_TEST_POSTGRES_PORT
) {
  throw new Error("This integration test must run through the isolated PostgreSQL test runner.");
}

function verifiedGoogleUser(id: string): User {
  return {
    id,
    firstName: "Race",
    lastName: "Test",
    emailAddresses: [{ emailAddress: ACCOUNT_EMAIL, verification: { status: "verified" } }],
    externalAccounts: [{
      provider: "google",
      emailAddress: ACCOUNT_EMAIL,
      firstName: "Race",
      lastName: "Test",
      verification: { status: "verified" },
    }],
  } as unknown as User;
}

type JsonResult = { status: number; body: Record<string, unknown> };

after(async () => {
  resetMockGoogleUsers();
  if (previousAuthSecret === undefined) delete process.env.DAILY007_AUTH_SECRET;
  else process.env.DAILY007_AUTH_SECRET = previousAuthSecret;
  await pool.end();
});

async function withServer(run: (origin: string) => Promise<void>): Promise<void> {
  const app = express();
  app.use(express.json());
  app.use((request, _response, next) => {
    Object.assign(request, {
      auth: { userId: request.get("x-mock-clerk-user-id") ?? null },
    });
    next();
  });
  app.use(daily007V2Router);
  app.use(daily007GoogleAuthRouter);
  app.use(daily007AccountRecoveryRouter);
  app.use((_error: unknown, _request: express.Request, response: express.Response, _next: express.NextFunction) => {
    response.status(500).json({ error: "Test server encountered an unexpected error." });
  });

  const server = await new Promise<Server>((resolve, reject) => {
    const listening = app.listen(0, "127.0.0.1", () => resolve(listening));
    listening.once("error", reject);
  });
  const address = server.address();
  assert.ok(address && typeof address !== "string");
  try {
    await run(`http://127.0.0.1:${address.port}`);
  } finally {
    await new Promise<void>((resolve, reject) => {
      server.close((error) => error ? reject(error) : resolve());
    });
  }
}

async function postJson(
  origin: string,
  path: string,
  body: Record<string, unknown>,
  headers: Record<string, string>,
): Promise<JsonResult> {
  const response = await fetch(`${origin}${path}`, {
    method: "POST",
    headers: { "content-type": "application/json", ...headers },
    body: JSON.stringify(body),
  });
  return { status: response.status, body: await response.json() as Record<string, unknown> };
}

function clerkHeaders(clerkUserId: string): Record<string, string> {
  return {
    authorization: "Bearer mocked-clerk-session",
    "x-mock-clerk-user-id": clerkUserId,
  };
}

async function waitForBlockedBackend(
  blockerPid: number,
  queryPattern: string,
  description: string,
  timeoutMs = 10_000,
): Promise<number> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const result = await pool.query<{ pid: number }>(
      `SELECT waiting.pid
         FROM pg_stat_activity AS waiting
        WHERE waiting.pid <> pg_backend_pid()
          AND waiting.wait_event_type = 'Lock'
          AND waiting.query ILIKE $1
          AND $2 = ANY(pg_blocking_pids(waiting.pid))
        ORDER BY waiting.query_start
        LIMIT 1`,
      [queryPattern, blockerPid],
    );
    const pid = result.rows[0]?.pid;
    if (pid !== undefined) return pid;
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  throw new Error(`Timed out waiting for ${description} to block in PostgreSQL.`);
}

async function seedRace(winningClerkUserId: string) {
  const accountId = randomUUID();
  const reviewerId = randomUUID();
  const requestId = randomUUID();
  await pool.query(
    `INSERT INTO daily007_v2_users
       (id, name, email, password_salt, password_hash)
     VALUES ($1, 'Google Race Account', $2, 'test-salt', 'test-hash')`,
    [accountId, ACCOUNT_EMAIL],
  );
  await pool.query(
    `INSERT INTO daily007_v2_users
       (id, name, email, password_salt, password_hash, role)
     VALUES ($1, 'Recovery Reviewer', $2, 'test-salt', 'test-hash', 'admin')`,
    [reviewerId, `reviewer-${reviewerId}@example.test`],
  );
  await pool.query(
    `INSERT INTO daily007_v2_google_recovery_requests
       (id, user_id, google_clerk_user_id, google_email)
     VALUES ($1, $2, $3, $4)`,
    [requestId, accountId, RECOVERY_CLERK_ID, ACCOUNT_EMAIL],
  );
  await pool.query(
    `INSERT INTO daily007_test_google_link_gate (user_id, winning_clerk_user_id)
     VALUES ($1, $2)`,
    [accountId, winningClerkUserId],
  );
  return { accountId, reviewerId, requestId };
}

async function runRace(winner: "google-sign-in" | "recovery-approval"): Promise<void> {
  const winningClerkUserId = winner === "google-sign-in" ? SIGN_IN_CLERK_ID : RECOVERY_CLERK_ID;
  const { accountId, reviewerId, requestId } = await seedRace(winningClerkUserId);
  resetMockGoogleUsers([
    verifiedGoogleUser(SIGN_IN_CLERK_ID),
    verifiedGoogleUser(RECOVERY_CLERK_ID),
  ]);
  const localToken = makeToken(accountId, 0);
  const reviewerToken = makeToken(reviewerId);
  assert.ok(localToken);
  assert.ok(reviewerToken);

  let gateClient: Awaited<ReturnType<typeof pool.connect>> | undefined;
  let gateHeld = false;
  let signInPromise: Promise<JsonResult> | undefined;
  let approvalPromise: Promise<JsonResult> | undefined;
  try {
    gateClient = await pool.connect();
    await gateClient.query("BEGIN");
    gateHeld = true;
    const gatePidResult = await gateClient.query<{ pid: number }>("SELECT pg_backend_pid() AS pid");
    const gatePid = gatePidResult.rows[0].pid;
    await gateClient.query("SELECT pg_advisory_xact_lock(743051, 1)");

    await withServer(async (origin) => {
      const startSignIn = () => postJson(origin, "/auth/google", { referralCode: null }, {
        ...clerkHeaders(SIGN_IN_CLERK_ID),
        "X-Daily007-Token": localToken,
      });
      const startApproval = () => postJson(
        origin,
        `/admin/account-recovery-requests/${requestId}/approve`,
        { reviewNote: REVIEW_NOTE },
        { authorization: `Bearer ${reviewerToken}` },
      );
      const winnerPromise = winner === "google-sign-in" ? startSignIn() : startApproval();
      if (winner === "google-sign-in") signInPromise = winnerPromise;
      else approvalPromise = winnerPromise;

      const winnerPid = await waitForBlockedBackend(
        gatePid,
        "%WHERE id = $1 AND clerk_user_id IS NULL%",
        `${winner} to pause after acquiring the account row`,
      );
      const loserPromise = winner === "google-sign-in" ? startApproval() : startSignIn();
      if (winner === "google-sign-in") approvalPromise = loserPromise;
      else signInPromise = loserPromise;

      await waitForBlockedBackend(
        winnerPid,
        winner === "google-sign-in" ? "%FOR UPDATE OF r, u%" : "%WHERE email = $1 FOR UPDATE%",
        `${winner === "google-sign-in" ? "recovery approval" : "Google sign-in"} to queue behind the winner`,
      );

      await gateClient!.query("COMMIT");
      gateHeld = false;
      const [signIn, approval] = await Promise.all([signInPromise!, approvalPromise!]);

      assert.equal(winner === "google-sign-in" ? signIn.status : approval.status, 200);
      assert.equal(winner === "google-sign-in" ? approval.status : signIn.status, 409);

      const account = await pool.query<{
        clerk_user_id: string | null;
        auth_version: number;
      }>(
        "SELECT clerk_user_id, auth_version FROM daily007_v2_users WHERE id = $1",
        [accountId],
      );
      const request = await pool.query<{
        status: string;
        reviewed_at: Date | null;
        reviewed_by: string | null;
        review_note: string | null;
        review_method: string | null;
      }>(
        `SELECT status, reviewed_at, reviewed_by, review_note, review_method
           FROM daily007_v2_google_recovery_requests
          WHERE id = $1`,
        [requestId],
      );
      assert.equal(account.rows[0].clerk_user_id, winningClerkUserId,
        "exactly the identity whose transaction acquired the row first must remain linked");
      if (winner === "google-sign-in") {
        assert.equal(account.rows[0].auth_version, 0,
          "linking Google from the existing Daily007 session must not rotate that session");
        assert.deepEqual(request.rows[0], {
          status: "pending",
          reviewed_at: null,
          reviewed_by: null,
          review_note: null,
          review_method: null,
        });
      } else {
        assert.equal(account.rows[0].auth_version, 0,
          "the rejected sign-in must not rotate the account session");
        assert.equal(request.rows[0].status, "approved");
        assert.ok(request.rows[0].reviewed_at);
        assert.equal(request.rows[0].reviewed_by, reviewerId);
        assert.equal(request.rows[0].review_note, REVIEW_NOTE);
        assert.equal(request.rows[0].review_method, "full_admin");
      }
    });
  } finally {
    if (gateHeld && gateClient) await gateClient.query("ROLLBACK");
    gateClient?.release();
    await Promise.allSettled([signInPromise, approvalPromise].filter(
      (promise): promise is Promise<JsonResult> => promise !== undefined,
    ));
    await pool.query("DELETE FROM daily007_test_google_link_gate WHERE user_id = $1", [accountId]);
    await pool.query("DELETE FROM daily007_v2_google_recovery_requests WHERE id = $1", [requestId]);
    await pool.query("DELETE FROM daily007_v2_users WHERE id = $1", [accountId]);
    await pool.query("DELETE FROM daily007_v2_users WHERE id = $1", [reviewerId]);
  }
}

test("PostgreSQL serializes Google sign-in ahead of a conflicting recovery approval", async () => {
  await runRace("google-sign-in");
});

test("PostgreSQL serializes recovery approval ahead of a conflicting Google sign-in", async () => {
  await runRace("recovery-approval");
});
