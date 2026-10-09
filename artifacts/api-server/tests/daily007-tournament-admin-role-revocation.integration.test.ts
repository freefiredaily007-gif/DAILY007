import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test, { after } from "node:test";
import express from "express";
import type { Server } from "node:http";
import { pool } from "@workspace/db";
import { makeToken } from "../src/lib/daily007-session-token";
import compatExtraRouter from "../src/routes/daily007-compat-extra";
import daily007V2Router from "../src/routes/daily007-v2";

const TEST_AUTH_SECRET = "daily007-tournament-admin-role-revocation-secret";
const previousAuthSecret = process.env.DAILY007_AUTH_SECRET;
process.env.DAILY007_AUTH_SECRET = TEST_AUTH_SECRET;
const testDatabaseUrl = process.env.DATABASE_URL ? new URL(process.env.DATABASE_URL) : null;
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

type JsonResponse = {
  status: number;
  body: Record<string, unknown>;
};

type Method = "GET" | "PATCH" | "PUT";

after(async () => {
  if (previousAuthSecret === undefined) delete process.env.DAILY007_AUTH_SECRET;
  else process.env.DAILY007_AUTH_SECRET = previousAuthSecret;
  await pool.end();
});

async function withServer(run: (origin: string) => Promise<void>): Promise<void> {
  const app = express();
  app.use(express.json());
  app.use(daily007V2Router);
  app.use(compatExtraRouter);
  app.use((
    _error: unknown,
    _request: express.Request,
    response: express.Response,
    _next: express.NextFunction,
  ) => {
    response.status(500).json({ error: "Test server encountered an unexpected error." });
  });

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
  assert.ok(token, "The test account must have an authenticated session token.");
  return token;
}

async function request(
  origin: string,
  path: string,
  method: Method,
  token: string,
  body?: Record<string, unknown>,
): Promise<JsonResponse> {
  const response = await fetch(`${origin}${path}`, {
    method,
    headers: {
      authorization: `Bearer ${token}`,
      ...(body ? { "content-type": "application/json" } : {}),
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  return { status: response.status, body: await response.json() as Record<string, unknown> };
}

test("grant enables a Tournament Admin action and revocation blocks a fresh request without changing tournament data", async () => {
  const fullAdminId = randomUUID();
  const tournamentAdminId = randomUUID();
  const matchId = randomUUID();
  await pool.query(
    `INSERT INTO daily007_v2_users
       (id, name, email, password_salt, password_hash, role)
     VALUES
       ($1, 'Role Change Full Admin', $2, 'test-salt', 'test-hash', 'admin'),
       ($3, 'Role Change Tournament Admin', $4, 'test-salt', 'test-hash', 'user')`,
    [
      fullAdminId,
      `role-change-admin-${fullAdminId}@example.test`,
      tournamentAdminId,
      `role-change-player-${tournamentAdminId}@example.test`,
    ],
  );
  await pool.query(
    `INSERT INTO daily007_v2_matches (id, status, room_id, room_password, room_published)
     VALUES ($1, 'upcoming', 'initial-room', 'initial-password', false)`,
    [matchId],
  );

  const fullAdminToken = tokenFor(fullAdminId);
  await withServer(async (origin) => {
    const targetToken = tokenFor(tournamentAdminId);
    const roomPath = `/daily007/v2/admin/matches/${matchId}/room`;
    const initialAttempt = await request(origin, roomPath, "PUT", targetToken, {
      roomId: "denied-before-grant",
      roomPassword: "must-not-be-saved",
    });
    assert.equal(initialAttempt.status, 403);

    const grant = await request(
      origin,
      `/admin/users/${tournamentAdminId}/role`,
      "PATCH",
      fullAdminToken,
      { role: "tournament_admin" },
    );
    assert.equal(grant.status, 200);
    assert.equal(grant.body.role, "tournament_admin");

    const freshGrantedToken = tokenFor(tournamentAdminId);
    const grantedIdentity = await request(origin, "/daily007/v2/auth/me", "GET", freshGrantedToken);
    assert.equal(grantedIdentity.status, 200);
    assert.equal(grantedIdentity.body.role, "tournament_admin");

    const fullAdminControls = await request(origin, "/admin/users", "GET", freshGrantedToken);
    assert.equal(fullAdminControls.status, 403, "Tournament Admin access must not include Full Admin controls.");
    const paymentApprovals = await request(origin, "/admin/payments", "GET", freshGrantedToken);
    assert.equal(paymentApprovals.status, 403, "Tournament Admin access must not include payment approvals.");
    const withdrawalControls = await request(origin, "/admin/withdrawals", "GET", freshGrantedToken);
    assert.equal(withdrawalControls.status, 403, "Tournament Admin access must not include withdrawal controls.");

    const allowedRoomChange = await request(origin, roomPath, "PUT", freshGrantedToken, {
      roomId: "granted-room",
      roomPassword: "granted-room-password",
    });
    assert.equal(allowedRoomChange.status, 200);
    const roomAfterGrant = await pool.query<{
      room_id: string | null;
      room_password: string | null;
      room_published: boolean;
    }>(
      "SELECT room_id, room_password, room_published FROM daily007_v2_matches WHERE id = $1",
      [matchId],
    );
    assert.deepEqual(roomAfterGrant.rows[0], {
      room_id: "granted-room",
      room_password: "granted-room-password",
      room_published: true,
    });

    const revoke = await request(
      origin,
      `/admin/users/${tournamentAdminId}/role`,
      "PATCH",
      fullAdminToken,
      { role: "user" },
    );
    assert.equal(revoke.status, 200);
    assert.equal(revoke.body.role, "user");

    const freshRevokedToken = tokenFor(tournamentAdminId);
    const revokedIdentity = await request(origin, "/daily007/v2/auth/me", "GET", freshRevokedToken);
    assert.equal(revokedIdentity.status, 200);
    assert.equal(revokedIdentity.body.role, "user");

    const deniedRoomChange = await request(origin, roomPath, "PUT", freshRevokedToken, {
      roomId: "revoked-room",
      roomPassword: "must-not-overwrite-granted-room",
    });
    assert.equal(deniedRoomChange.status, 403);

    const roomAfterRevocation = await pool.query<{
      room_id: string | null;
      room_password: string | null;
      room_published: boolean;
    }>(
      "SELECT room_id, room_password, room_published FROM daily007_v2_matches WHERE id = $1",
      [matchId],
    );
    assert.deepEqual(roomAfterRevocation.rows[0], roomAfterGrant.rows[0]);
  });
});
