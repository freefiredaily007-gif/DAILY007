import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test, { after } from "node:test";
import express from "express";
import type { Server } from "node:http";
import { pool } from "@workspace/db";
import {
  isValidInstagramAccountUrl,
  normalizeInstagramUsername,
} from "../src/lib/daily007-compat-extra-validation";
import { makeToken } from "../src/lib/daily007-session-token";
import router from "../src/routes/daily007-compat-extra";

const testDatabaseUrl = process.env.DATABASE_URL
  ? new URL(process.env.DATABASE_URL)
  : null;
const testDatabasePort = process.env.DAILY007_TEST_POSTGRES_PORT;
if (
  process.env.DAILY007_ISOLATED_POSTGRES_TEST !== "1" ||
  !testDatabaseUrl ||
  testDatabaseUrl.hostname !== "127.0.0.1" ||
  testDatabaseUrl.pathname !== "/postgres" ||
  testDatabaseUrl.port !== testDatabasePort
) {
  throw new Error("This integration test must run through the isolated PostgreSQL test runner.");
}

const TEST_AUTH_SECRET = "daily007-instagram-follow-test-secret-at-least-32";
const previousAuthSecret = process.env.DAILY007_AUTH_SECRET;
process.env.DAILY007_AUTH_SECRET = TEST_AUTH_SECRET;

after(async () => {
  await pool.end();
  if (previousAuthSecret === undefined) delete process.env.DAILY007_AUTH_SECRET;
  else process.env.DAILY007_AUTH_SECRET = previousAuthSecret;
});

type JsonResult = { status: number; body: any };

test("Instagram account URL and username validation reject malformed input", () => {
  assert.equal(isValidInstagramAccountUrl("https://www.instagram.com/freefiredaily007/"), true);
  assert.equal(isValidInstagramAccountUrl("https://instagram.com/valid.name_007"), true);
  assert.equal(isValidInstagramAccountUrl("http://instagram.com/freefiredaily007"), false);
  assert.equal(isValidInstagramAccountUrl("https://instagram.com/accounts/login/"), false);
  assert.equal(isValidInstagramAccountUrl("https://example.com/freefiredaily007"), false);
  assert.equal(normalizeInstagramUsername("@valid.name_007"), "valid.name_007");
  assert.equal(normalizeInstagramUsername("not a valid name"), null);
});

async function withServer(run: (origin: string) => Promise<void>): Promise<void> {
  const app = express();
  app.use(express.json());
  app.use(router);
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

function tokenFor(userId: string): string {
  const token = makeToken(userId, 0);
  assert.ok(token);
  return token;
}

async function call(
  origin: string,
  path: string,
  method: "GET" | "POST",
  token: string,
  body?: Record<string, unknown>,
): Promise<JsonResult> {
  const response = await fetch(`${origin}${path}`, {
    method,
    headers: {
      authorization: `Bearer ${token}`,
      ...(body ? { "content-type": "application/json" } : {}),
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  return { status: response.status, body: await response.json() };
}

test("Instagram follow claims are authenticated, reviewable, and credit the reward once", async () => {
  const adminId = randomUUID();
  const playerId = randomUUID();
  const rejectedPlayerId = randomUUID();
  const userIds = [adminId, playerId, rejectedPlayerId];
  try {
    await pool.query(
      `INSERT INTO daily007_v2_users (id, name, email, role, wallet_coins, status, auth_version)
       VALUES
         ($1, 'Instagram Admin', $4, 'admin', 0, 'active', 0),
         ($2, 'Instagram Player', $5, 'user', 10, 'active', 0),
         ($3, 'Rejected Player', $6, 'user', 7, 'active', 0)`,
      [...userIds, `admin-${adminId}@example.test`, `player-${playerId}@example.test`, `player-${rejectedPlayerId}@example.test`],
    );
    await pool.query(
      `INSERT INTO daily007_v2_settings (id, settings)
       VALUES (1, $1::jsonb)`,
      [JSON.stringify({
        instagramTaskEnabled: "true",
        instagramTaskReward: "3",
        instagramTaskUrl: "https://www.instagram.com/freefiredaily007/",
      })],
    );

    const playerToken = tokenFor(playerId);
    const rejectedPlayerToken = tokenFor(rejectedPlayerId);
    const adminToken = tokenFor(adminId);

    await withServer(async (origin) => {
      const initial = await call(origin, "/earn/instagram-follow", "GET", playerToken);
      assert.equal(initial.status, 200);
      assert.equal(initial.body.enabled, true);
      assert.equal(initial.body.rewardCoins, 3);
      assert.equal(initial.body.claim, null);

      const invalid = await call(origin, "/earn/instagram-follow/claims", "POST", playerToken, {
        instagramUsername: "not a username",
      });
      assert.equal(invalid.status, 400);

      const submitted = await call(origin, "/earn/instagram-follow/claims", "POST", playerToken, {
        instagramUsername: "@daily007.player",
        proofText: "Followed from my public profile.",
      });
      assert.equal(submitted.status, 201);
      assert.equal(submitted.body.status, "pending");
      assert.equal(submitted.body.instagramUsername, "daily007.player");
      assert.equal(submitted.body.proofText, "Followed from my public profile.");
      const claimId = submitted.body.id as string;

      const duplicate = await call(origin, "/earn/instagram-follow/claims", "POST", playerToken, {
        instagramUsername: "another_name",
      });
      assert.equal(duplicate.status, 200);
      assert.equal(duplicate.body.id, claimId);

      const forbiddenList = await call(origin, "/admin/earn/instagram-follow/claims", "GET", playerToken);
      assert.equal(forbiddenList.status, 403);
      const forbiddenReview = await call(
        origin,
        `/admin/earn/instagram-follow/claims/${claimId}/approve`,
        "POST",
        playerToken,
      );
      assert.equal(forbiddenReview.status, 403);

      const listed = await call(origin, "/admin/earn/instagram-follow/claims", "GET", adminToken);
      assert.equal(listed.status, 200);
      assert.equal(listed.body.claims[0].instagramUsername, "daily007.player");
      assert.equal(listed.body.claims[0].proofText, "Followed from my public profile.");

      const approvals = await Promise.all([
        call(origin, `/admin/earn/instagram-follow/claims/${claimId}/approve`, "POST", adminToken),
        call(origin, `/admin/earn/instagram-follow/claims/${claimId}/approve`, "POST", adminToken),
      ]);
      assert.deepEqual(approvals.map(({ status }) => status), [200, 200]);
      assert.equal(approvals[0].body.status, "approved");
      assert.equal(approvals[1].body.status, "approved");

      const wallet = await pool.query<{ wallet_coins: number }>(
        "SELECT wallet_coins FROM daily007_v2_users WHERE id = $1",
        [playerId],
      );
      const ledger = await pool.query<{ id: string; amount: number; reason: string; idempotency_key: string }>(
        "SELECT id, amount, reason, idempotency_key FROM daily007_v2_wallet_ledger WHERE user_id = $1",
        [playerId],
      );
      assert.equal(wallet.rows[0]?.wallet_coins, 13);
      assert.equal(ledger.rows.length, 1);
      assert.equal(ledger.rows[0]?.amount, 3);
      assert.equal(ledger.rows[0]?.reason, "instagram_follow_reward");
      assert.equal(ledger.rows[0]?.idempotency_key, `daily007-instagram-follow:${playerId}`);

      const completed = await call(origin, "/earn/instagram-follow", "GET", playerToken);
      assert.equal(completed.body.completed, true);
      assert.equal(completed.body.claim.transactionId, ledger.rows[0]?.id);
      const repeat = await call(origin, "/earn/instagram-follow/claims", "POST", playerToken, {
        instagramUsername: "daily007.player",
      });
      assert.equal(repeat.status, 200);
      assert.equal(repeat.body.status, "approved");

      const rejectedClaim = await call(origin, "/earn/instagram-follow/claims", "POST", rejectedPlayerToken, {
        instagramUsername: "rejected.player",
      });
      assert.equal(rejectedClaim.status, 201);
      const rejected = await call(
        origin,
        `/admin/earn/instagram-follow/claims/${rejectedClaim.body.id}/reject`,
        "POST",
        adminToken,
        { reason: "Please provide a clearer verification note." },
      );
      assert.equal(rejected.status, 200);
      assert.equal(rejected.body.status, "rejected");
      const rejectedWallet = await pool.query<{ wallet_coins: number }>(
        "SELECT wallet_coins FROM daily007_v2_users WHERE id = $1",
        [rejectedPlayerId],
      );
      assert.equal(rejectedWallet.rows[0]?.wallet_coins, 7);

      const retryAfterRejection = await call(
        origin,
        "/earn/instagram-follow/claims",
        "POST",
        rejectedPlayerToken,
        { instagramUsername: "rejected.player", proofText: "Now public." },
      );
      assert.equal(retryAfterRejection.status, 201);
      assert.equal(retryAfterRejection.body.status, "pending");
    });
  } finally {
    await pool.query(
      "DELETE FROM daily007_v2_instagram_follow_claims WHERE user_id = ANY($1::uuid[])",
      [userIds],
    );
    await pool.query("DELETE FROM daily007_v2_wallet_ledger WHERE user_id = ANY($1::uuid[])", [userIds]);
    await pool.query("DELETE FROM daily007_v2_notifications WHERE user_id = ANY($1::uuid[])", [userIds]);
    await pool.query("DELETE FROM daily007_v2_settings WHERE id = 1");
    await pool.query("DELETE FROM daily007_v2_users WHERE id = ANY($1::uuid[])", [userIds]);
  }
});
