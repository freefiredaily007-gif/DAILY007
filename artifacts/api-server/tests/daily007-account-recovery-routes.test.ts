import assert from "node:assert/strict";
import express from "express";
import type { Server } from "node:http";
import test, { after } from "node:test";
import daily007AccountRecoveryRouter from "../src/routes/daily007-account-recovery";
import { makeToken } from "../src/lib/daily007-session-token";
import {
  getMockGoogleUserLookupCount,
  resetMockGoogleUser,
} from "./support/daily007-google-auth-clerk-mock";
import type { User as MockGoogleUser } from "./support/daily007-google-auth-clerk-mock";
import {
  recoveryTestDb,
  type RecoveryTestRequest,
} from "./support/daily007-account-recovery-test-db";

const PLAYER_ID = "40000000-0000-4000-8000-000000000101";
const OWNER_ID = "40000000-0000-4000-8000-000000000102";
const REVIEWER_ID = "40000000-0000-4000-8000-000000000103";
const SECOND_ADMIN_ID = "40000000-0000-4000-8000-000000000104";
const TOURNAMENT_ADMIN_ID = "40000000-0000-4000-8000-000000000105";
const PLAYER_CLERK_ID = "clerk-google-player-recovery";
const OWNER_CLERK_ID = "clerk-google-sole-admin-recovery";
const TEST_AUTH_SECRET = "daily007-account-recovery-route-test-secret";
const TEST_OWNER_CODE = "o".repeat(64);
const WRONG_OWNER_CODE = "w".repeat(64);
const REVIEW_NOTE = "Verified with the account owner.";

const previousAuthSecret = process.env.DAILY007_AUTH_SECRET;
const previousOwnerRecoveryCode = process.env.DAILY007_OWNER_RECOVERY_CODE;
process.env.DAILY007_AUTH_SECRET = TEST_AUTH_SECRET;

after(() => {
  if (previousAuthSecret === undefined) delete process.env.DAILY007_AUTH_SECRET;
  else process.env.DAILY007_AUTH_SECRET = previousAuthSecret;
  if (previousOwnerRecoveryCode === undefined) delete process.env.DAILY007_OWNER_RECOVERY_CODE;
  else process.env.DAILY007_OWNER_RECOVERY_CODE = previousOwnerRecoveryCode;
  recoveryTestDb.reset();
  resetMockGoogleUser();
});

function verifiedGoogleUser(id: string, email: string): MockGoogleUser {
  return {
    id,
    firstName: "Recovery",
    lastName: "Test",
    emailAddresses: [{
      emailAddress: email,
      verification: { status: "verified" },
    }],
    externalAccounts: [{
      provider: "google",
      emailAddress: email,
      firstName: "Recovery",
      lastName: "Test",
      verification: { status: "verified" },
    }],
  };
}

function unverifiedGoogleUser(id: string, email: string): MockGoogleUser {
  return {
    ...verifiedGoogleUser(id, email),
    emailAddresses: [{
      emailAddress: email,
      verification: { status: "unverified" },
    }],
    externalAccounts: [{
      provider: "google",
      emailAddress: email,
      firstName: "Recovery",
      lastName: "Test",
      verification: { status: "unverified" },
    }],
  };
}

async function withRecoveryServer(run: (origin: string) => Promise<void>): Promise<void> {
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    Object.assign(req, { auth: { userId: req.get("x-mock-clerk-user-id") ?? null } });
    next();
  });
  app.use(daily007AccountRecoveryRouter);

  const server = await new Promise<Server>((resolve, reject) => {
    const listeningServer = app.listen(0, "127.0.0.1", () => resolve(listeningServer));
    listeningServer.once("error", reject);
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

type JsonResult = { status: number; body: Record<string, unknown> };

async function postJson(
  origin: string,
  path: string,
  body: Record<string, unknown>,
  headers: Record<string, string> = {},
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

function persistentState() {
  return structuredClone({
    accounts: [...recoveryTestDb.users.values()],
    recoveryRecords: [...recoveryTestDb.requests.values()],
  });
}

function ownerCodeFixtureState() {
  return JSON.stringify({
    queries: recoveryTestDb.queryHistory,
    accounts: [...recoveryTestDb.users.values()],
    recoveryRecords: [...recoveryTestDb.requests.values()],
  });
}

function recoveryRecordForUser(userId: string): RecoveryTestRequest | undefined {
  return [...recoveryTestDb.requests.values()].find((request) => request.user_id === userId);
}

test("an active, distinct Full Admin can approve a pending request after fresh Google verification", async () => {
  recoveryTestDb.reset();
  recoveryTestDb.seedUser({
    id: PLAYER_ID,
    name: "Player Recovery",
    email: "Player@Example.test",
  });
  recoveryTestDb.seedUser({
    id: REVIEWER_ID,
    name: "Full Admin Reviewer",
    email: "reviewer@example.test",
    role: "admin",
    status: "active",
  });
  resetMockGoogleUser(verifiedGoogleUser(PLAYER_CLERK_ID, "player@example.test"));

  await withRecoveryServer(async (origin) => {
    const submitted = await postJson(
      origin,
      "/auth/google/recovery-request",
      {},
      clerkHeaders(PLAYER_CLERK_ID),
    );
    assert.equal(submitted.status, 202);
    assert.equal(recoveryTestDb.users.get(PLAYER_ID)?.clerk_user_id, null,
      "submitting a recovery request must not link the account");

    const request = recoveryRecordForUser(PLAYER_ID);
    assert.ok(request, "the eligible request should be queued for Full Admin review");
    assert.equal(request.status, "pending");
    assert.equal(getMockGoogleUserLookupCount(), 1);

    const reviewerToken = makeToken(REVIEWER_ID);
    assert.ok(reviewerToken);
    assert.notEqual(REVIEWER_ID, request.user_id, "the Full Admin reviewer must be a different account");
    const approved = await postJson(
      origin,
      `/admin/account-recovery-requests/${request.id}/approve`,
      { reviewNote: `  ${REVIEW_NOTE}  ` },
      { authorization: `Bearer ${reviewerToken}` },
    );

    assert.equal(approved.status, 200);
    assert.deepEqual(approved.body, { id: request.id, status: "approved" });
    assert.equal(recoveryTestDb.users.get(PLAYER_ID)?.clerk_user_id, PLAYER_CLERK_ID);
    assert.equal(request.status, "approved");
    assert.equal(request.reviewed_by, REVIEWER_ID);
    assert.equal(request.review_note, REVIEW_NOTE);
    assert.equal(request.review_method, "full_admin");
    assert.equal(getMockGoogleUserLookupCount(), 2,
      "approval must fetch and re-verify the Google identity instead of trusting the original request");
  });
});

test("self-review, non-Full-Admin review, and changed Google identity leave links and audit records unchanged", async () => {
  recoveryTestDb.reset();
  recoveryTestDb.seedUser({
    id: OWNER_ID,
    name: "Admin Recovery",
    email: "owner@example.test",
    role: "admin",
    status: "active",
  });
  recoveryTestDb.seedUser({
    id: REVIEWER_ID,
    name: "Different Full Admin",
    email: "reviewer@example.test",
    role: "admin",
    status: "active",
  });
  recoveryTestDb.seedUser({
    id: TOURNAMENT_ADMIN_ID,
    name: "Tournament Admin",
    email: "tournament-admin@example.test",
    role: "tournament_admin",
    status: "active",
  });
  resetMockGoogleUser(verifiedGoogleUser(OWNER_CLERK_ID, "owner@example.test"));

  await withRecoveryServer(async (origin) => {
    const submitted = await postJson(
      origin,
      "/auth/google/recovery-request",
      {},
      clerkHeaders(OWNER_CLERK_ID),
    );
    assert.equal(submitted.status, 202);
    const request = recoveryRecordForUser(OWNER_ID);
    assert.ok(request);
    const beforeReviews = persistentState();

    const selfToken = makeToken(OWNER_ID);
    assert.ok(selfToken);
    const selfReview = await postJson(
      origin,
      `/admin/account-recovery-requests/${request.id}/approve`,
      { reviewNote: REVIEW_NOTE },
      { authorization: `Bearer ${selfToken}` },
    );
    assert.equal(selfReview.status, 409);
    assert.deepEqual(persistentState(), beforeReviews);

    const tournamentAdminToken = makeToken(TOURNAMENT_ADMIN_ID);
    assert.ok(tournamentAdminToken);
    const nonFullAdminReview = await postJson(
      origin,
      `/admin/account-recovery-requests/${request.id}/approve`,
      { reviewNote: REVIEW_NOTE },
      { authorization: `Bearer ${tournamentAdminToken}` },
    );
    assert.equal(nonFullAdminReview.status, 403);
    assert.deepEqual(persistentState(), beforeReviews);

    resetMockGoogleUser(verifiedGoogleUser(OWNER_CLERK_ID, "changed@example.test"));
    const reviewerToken = makeToken(REVIEWER_ID);
    assert.ok(reviewerToken);
    const changedIdentityReview = await postJson(
      origin,
      `/admin/account-recovery-requests/${request.id}/approve`,
      { reviewNote: REVIEW_NOTE },
      { authorization: `Bearer ${reviewerToken}` },
    );
    assert.equal(changedIdentityReview.status, 409);
    assert.equal(getMockGoogleUserLookupCount(), 1,
      "the approval handler must freshly look up the identity before rejecting its changed email");
    assert.deepEqual(persistentState(), beforeReviews);
  });
});

test("sole Full Admin recovery links only the verified matching account and never stores or logs the owner code", async () => {
  recoveryTestDb.reset();
  recoveryTestDb.seedUser({
    id: OWNER_ID,
    name: "Sole Full Admin",
    email: "owner@example.test",
    role: "admin",
    status: "active",
  });
  process.env.DAILY007_OWNER_RECOVERY_CODE = TEST_OWNER_CODE;
  resetMockGoogleUser(verifiedGoogleUser(OWNER_CLERK_ID, "owner@example.test"));
  const capturedLogs: string[] = [];
  const logMethods = ["debug", "info", "log", "warn", "error"] as const;
  const consoleRecord = console as unknown as Record<string, (...args: unknown[]) => void>;
  const originalMethods = new Map(
    logMethods.map((method) => [method, consoleRecord[method]]),
  );
  for (const method of logMethods) {
    consoleRecord[method] = (...args) => {
      capturedLogs.push(args.map((value) => {
        if (typeof value === "string") return value;
        try {
          return JSON.stringify(value);
        } catch {
          return String(value);
        }
      }).join(" "));
    };
  }

  try {
    await withRecoveryServer(async (origin) => {
      const recovered = await postJson(
        origin,
        "/auth/google/recovery-owner",
        { ownerRecoveryCode: TEST_OWNER_CODE },
        clerkHeaders(OWNER_CLERK_ID),
      );

      assert.equal(recovered.status, 200);
      assert.equal(recoveryTestDb.users.get(OWNER_ID)?.clerk_user_id, OWNER_CLERK_ID);
      const record = recoveryRecordForUser(OWNER_ID);
      assert.ok(record, "successful owner recovery should create an audit record");
      assert.equal(record.status, "approved");
      assert.equal(record.reviewed_by, OWNER_ID);
      assert.equal(record.review_method, "owner_code");
      assert.match(record.review_note ?? "", /verified matching Google identity/i);
      assert.equal(getMockGoogleUserLookupCount(), 1,
        "owner recovery must fetch the current Google identity on the recovery request");
      assert.equal(JSON.stringify(recovered.body).includes(TEST_OWNER_CODE), false);
      assert.equal(ownerCodeFixtureState().includes(TEST_OWNER_CODE), false,
        "the owner code must not appear in database parameters, account data, or recovery audit records");
    });
  } finally {
    for (const method of logMethods) {
      const original = originalMethods.get(method);
      if (original) consoleRecord[method] = original;
    }
  }

  assert.equal(capturedLogs.some((line) => line.includes(TEST_OWNER_CODE)), false,
    "the owner code must never appear in console output");
});

test("wrong codes and non-sole-admin owner recovery attempts do not link accounts or alter audit records", async () => {
  recoveryTestDb.reset();
  const wrongCodeOwner = recoveryTestDb.seedUser({
    id: PLAYER_ID,
    name: "Wrong Code Owner",
    email: "wrong-code@example.test",
    role: "admin",
    status: "active",
  });
  const nonSoleOwner = recoveryTestDb.seedUser({
    id: OWNER_ID,
    name: "Non-Sole Full Admin",
    email: "non-sole@example.test",
    role: "admin",
    status: "active",
  });
  recoveryTestDb.seedUser({
    id: SECOND_ADMIN_ID,
    name: "Additional Full Admin",
    email: "second-admin@example.test",
    role: "admin",
    status: "active",
  });
  process.env.DAILY007_OWNER_RECOVERY_CODE = TEST_OWNER_CODE;

  await withRecoveryServer(async (origin) => {
    resetMockGoogleUser(verifiedGoogleUser("clerk-google-wrong-code", wrongCodeOwner.email));
    const beforeWrongCode = persistentState();
    const wrongCode = await postJson(
      origin,
      "/auth/google/recovery-owner",
      { ownerRecoveryCode: WRONG_OWNER_CODE },
      clerkHeaders("clerk-google-wrong-code"),
    );
    assert.equal(wrongCode.status, 403);
    assert.deepEqual(persistentState(), beforeWrongCode);

    resetMockGoogleUser(verifiedGoogleUser("clerk-google-non-sole", nonSoleOwner.email));
    const beforeNonSole = persistentState();
    const nonSoleAttempt = await postJson(
      origin,
      "/auth/google/recovery-owner",
      { ownerRecoveryCode: TEST_OWNER_CODE },
      clerkHeaders("clerk-google-non-sole"),
    );
    assert.equal(nonSoleAttempt.status, 409);
    assert.deepEqual(persistentState(), beforeNonSole);
  });
});

test("unverified Google identities cannot request player or sole-admin recovery", async () => {
  recoveryTestDb.reset();
  const player = recoveryTestDb.seedUser({
    id: PLAYER_ID,
    name: "Unverified Player",
    email: "unverified-player@example.test",
  });
  const owner = recoveryTestDb.seedUser({
    id: OWNER_ID,
    name: "Unverified Sole Admin",
    email: "unverified-owner@example.test",
    role: "admin",
    status: "active",
  });
  process.env.DAILY007_OWNER_RECOVERY_CODE = TEST_OWNER_CODE;

  await withRecoveryServer(async (origin) => {
    const requestClerkId = "clerk-google-unverified-player";
    resetMockGoogleUser(unverifiedGoogleUser(requestClerkId, player.email));
    const beforePlayerRequest = persistentState();
    const playerRequest = await postJson(
      origin,
      "/auth/google/recovery-request",
      {},
      clerkHeaders(requestClerkId),
    );
    assert.equal(playerRequest.status, 403);
    assert.deepEqual(persistentState(), beforePlayerRequest);
    assert.equal(getMockGoogleUserLookupCount(), 1);

    const ownerClerkId = "clerk-google-unverified-owner";
    resetMockGoogleUser(unverifiedGoogleUser(ownerClerkId, owner.email));
    const beforeOwnerRecovery = persistentState();
    const ownerRecovery = await postJson(
      origin,
      "/auth/google/recovery-owner",
      { ownerRecoveryCode: TEST_OWNER_CODE },
      clerkHeaders(ownerClerkId),
    );
    assert.equal(ownerRecovery.status, 403);
    assert.deepEqual(persistentState(), beforeOwnerRecovery);
    assert.equal(getMockGoogleUserLookupCount(), 1);
  });
});