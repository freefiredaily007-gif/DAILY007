import assert from "node:assert/strict";
import test, { after } from "node:test";
import express from "express";
import type { Server } from "node:http";
import { randomUUID } from "node:crypto";
import { pool } from "@workspace/db";
import { makeToken } from "../src/lib/daily007-session-token";
import router from "../src/routes/daily007-leaderboards";

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

const TEST_AUTH_SECRET = "daily007-leaderboard-rewards-test-secret-at-least-32-chars";
const previousAuthSecret = process.env.DAILY007_AUTH_SECRET;
process.env.DAILY007_AUTH_SECRET = TEST_AUTH_SECRET;

after(async () => {
  await pool.end();
  if (previousAuthSecret === undefined) delete process.env.DAILY007_AUTH_SECRET;
  else process.env.DAILY007_AUTH_SECRET = previousAuthSecret;
});

async function withServer(run: (origin: string) => Promise<void>): Promise<void> {
  const app = express();
  app.use(express.json());
  app.use(router);
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

test("six-digit leaderboard prizes persist across a fresh API server instance", async () => {
  const adminId = randomUUID();
  const token = makeToken(adminId, 0);
  assert.ok(token);
  const savedRewards = {
    weekly: { firstPlaceCoins: 123456, secondPlaceCoins: 234567, thirdPlaceCoins: 345678 },
    monthly: { firstPlaceCoins: 456789, secondPlaceCoins: 567890, thirdPlaceCoins: 678901 },
  };
  const rewardAmountsFrom = (body: typeof savedRewards) => ({
    weekly: {
      firstPlaceCoins: body.weekly.firstPlaceCoins,
      secondPlaceCoins: body.weekly.secondPlaceCoins,
      thirdPlaceCoins: body.weekly.thirdPlaceCoins,
    },
    monthly: {
      firstPlaceCoins: body.monthly.firstPlaceCoins,
      secondPlaceCoins: body.monthly.secondPlaceCoins,
      thirdPlaceCoins: body.monthly.thirdPlaceCoins,
    },
  });

  await pool.query(
    `INSERT INTO daily007_v2_users (id, name, email, role)
     VALUES ($1, 'Leaderboard Test Admin', $2, 'admin')`,
    [adminId, `leaderboard-${adminId}@example.test`],
  );
  try {
    await withServer(async (origin) => {
      const response = await fetch(`${origin}/daily007/v2/admin/leaderboards/rewards`, {
        method: "PUT",
        headers: {
          authorization: `Bearer ${token}`,
          "content-type": "application/json",
        },
        body: JSON.stringify(savedRewards),
      });
      assert.equal(response.status, 200);
      const body = await response.json() as typeof savedRewards;
      assert.deepEqual(rewardAmountsFrom(body), savedRewards);
    });

    // Recreate the Express API server; the next read uses PostgreSQL, not an in-memory fixture.
    await withServer(async (origin) => {
      const response = await fetch(`${origin}/daily007/v2/admin/leaderboards/rewards`, {
        headers: { authorization: `Bearer ${token}` },
      });
      assert.equal(response.status, 200);
      const body = await response.json() as typeof savedRewards;
      assert.deepEqual(rewardAmountsFrom(body), savedRewards);
    });
  } finally {
    await pool.query("DELETE FROM daily007_v2_users WHERE id = $1", [adminId]);
  }
});
