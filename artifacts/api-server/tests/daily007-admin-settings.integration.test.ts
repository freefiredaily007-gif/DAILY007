import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test, { after } from "node:test";
import express from "express";
import type { Server } from "node:http";
import { pool } from "@workspace/db";
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
  throw new Error(
    "This integration test must run through the isolated PostgreSQL test runner.",
  );
}

const TEST_AUTH_SECRET = "daily007-admin-settings-test-secret-at-least-32-chars";
const previousAuthSecret = process.env.DAILY007_AUTH_SECRET;
process.env.DAILY007_AUTH_SECRET = TEST_AUTH_SECRET;

after(async () => {
  await pool.end();
  if (previousAuthSecret === undefined) delete process.env.DAILY007_AUTH_SECRET;
  else process.env.DAILY007_AUTH_SECRET = previousAuthSecret;
});

type JsonResult = { status: number; body: any };

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

async function call(
  origin: string,
  path: string,
  method: "GET" | "PUT",
  options: { token?: string; body?: Record<string, unknown> } = {},
): Promise<JsonResult> {
  const response = await fetch(`${origin}${path}`, {
    method,
    headers: {
      ...(options.token ? { authorization: `Bearer ${options.token}` } : {}),
      ...(options.body ? { "content-type": "application/json" } : {}),
    },
    ...(options.body ? { body: JSON.stringify(options.body) } : {}),
  });
  return { status: response.status, body: await response.json() };
}

function assertPrivateMetadataHidden(body: Record<string, unknown>): void {
  assert.equal(Object.hasOwn(body, "__daily007AutoCancelCursor"), false);
  assert.equal(Object.hasOwn(body, "__daily007VideoCatalogSeeded"), false);
}

test("Admin settings hide the cancellation cursor and preserve private metadata on save", async () => {
  const adminId = randomUUID();
  const cursor = {
    id: randomUUID(),
    startsAt: "2026-10-09T12:00:00.000Z",
  };

  try {
    await pool.query(
      `INSERT INTO daily007_v2_users
         (id, name, email, role, wallet_coins, status, auth_version)
       VALUES ($1, 'Settings Test Admin', $2, 'admin', 0, 'active', 0)`,
      [adminId, `admin-${adminId}@example.test`],
    );
    await pool.query(
      `INSERT INTO daily007_v2_settings (id, settings, updated_by, updated_at)
       VALUES (1, $1::jsonb, $2, now())`,
      [
        JSON.stringify({
          rechargeEnabled: "false",
          withdrawalEnabled: "false",
          upiId: "",
          upiQrObjectPath: "",
          coinToMoneyRate: "2.5",
          __daily007AutoCancelCursor: cursor,
          __daily007VideoCatalogSeeded: true,
        }),
        adminId,
      ],
    );

    const token = makeToken(adminId, 0);
    assert.ok(token, "test admin should receive a Daily007 session token");

    await withServer(async (origin) => {
      const publicSettings = await call(origin, "/settings", "GET");
      assert.equal(publicSettings.status, 200);
      assertPrivateMetadataHidden(publicSettings.body);

      const adminSettings = await call(origin, "/admin/settings", "GET", { token });
      assert.equal(adminSettings.status, 200);
      assertPrivateMetadataHidden(adminSettings.body);

      const updatedSettings = await call(origin, "/admin/settings", "PUT", {
        token,
        body: { paymentNote: "Updated without resetting private progress" },
      });
      assert.equal(updatedSettings.status, 200);
      assert.equal(
        updatedSettings.body.paymentNote,
        "Updated without resetting private progress",
      );
      assert.equal(updatedSettings.body.coinToMoneyRate, "2.5");
      assertPrivateMetadataHidden(updatedSettings.body);
    });

    const saved = await pool.query<{ settings: Record<string, unknown> }>(
      "SELECT settings FROM daily007_v2_settings WHERE id = 1",
    );
    assert.deepEqual(saved.rows[0]?.settings.__daily007AutoCancelCursor, cursor);
    assert.equal(saved.rows[0]?.settings.__daily007VideoCatalogSeeded, true);
    assert.equal(
      saved.rows[0]?.settings.paymentNote,
      "Updated without resetting private progress",
    );
    assert.equal(saved.rows[0]?.settings.coinToMoneyRate, "2.5");
  } finally {
    await pool.query("DELETE FROM daily007_v2_settings WHERE id = 1");
    await pool.query("DELETE FROM daily007_v2_users WHERE id = $1", [adminId]);
  }
});
