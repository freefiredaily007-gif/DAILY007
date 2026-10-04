import assert from "node:assert/strict";
import test, { after } from "node:test";
import express from "express";
import type { Server } from "node:http";

import daily007CompatCoreRouter from "../src/routes/daily007-compat-core";
import daily007CompatExtraRouter from "../src/routes/daily007-compat-extra";
import daily007V2Router from "../src/routes/daily007-v2";
import { signupTestDb } from "./support/daily007-signup-test-db";

const TEST_AUTH_SECRET = "role-refresh-tests-only-secret-at-least-32-chars";
const previousAuthSecret = process.env.DAILY007_AUTH_SECRET;
process.env.DAILY007_AUTH_SECRET = TEST_AUTH_SECRET;

after(() => {
  signupTestDb.reset();
  if (previousAuthSecret === undefined) delete process.env.DAILY007_AUTH_SECRET;
  else process.env.DAILY007_AUTH_SECRET = previousAuthSecret;
});

type JsonResult = { status: number; body: any };
type Method = "GET" | "POST" | "PATCH";

async function withServer(run: (origin: string) => Promise<void>): Promise<void> {
  const app = express();
  app.use(express.json());
  app.use(daily007V2Router);
  app.use(daily007CompatCoreRouter);
  app.use(daily007CompatExtraRouter);

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

async function request(
  origin: string,
  path: string,
  method: Method,
  token?: string,
  body?: Record<string, unknown>,
): Promise<JsonResult> {
  const response = await fetch(`${origin}${path}`, {
    method,
    headers: {
      ...(body ? { "content-type": "application/json" } : {}),
      ...(token ? { authorization: `Bearer ${token}` } : {}),
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  return { status: response.status, body: await response.json() };
}

test("already-open sessions get current role and permissions without signing in again", async () => {
  signupTestDb.reset();

  await withServer(async (origin) => {
    const password = "role-refresh-regression-password";
    const adminSignup = await request(origin, "/auth/register", "POST", undefined, {
      name: "Role Test Admin",
      email: "role-test-admin@example.test",
      password,
    });
    const playerSignup = await request(origin, "/auth/register", "POST", undefined, {
      name: "Role Test Player",
      email: "role-test-player@example.test",
      password,
    });
    const fullAdminSignup = await request(origin, "/auth/register", "POST", undefined, {
      name: "Role Test Full Admin",
      email: "role-test-full-admin@example.test",
      password,
    });
    assert.equal(adminSignup.status, 201);
    assert.equal(playerSignup.status, 201);
    assert.equal(fullAdminSignup.status, 201);

    const actingAdminId = adminSignup.body.id as string;
    const playerId = playerSignup.body.id as string;
    const fullAdminId = fullAdminSignup.body.id as string;
    const actingAdmin = signupTestDb.users.get(actingAdminId);
    const fullAdmin = signupTestDb.users.get(fullAdminId);
    assert.ok(actingAdmin);
    assert.ok(fullAdmin);
    actingAdmin.role = "admin";
    fullAdmin.role = "admin";

    const actingToken = adminSignup.body.token as string;
    const playerToken = playerSignup.body.token as string;
    const fullAdminToken = fullAdminSignup.body.token as string;

    const playerStartsRestricted = await request(origin, "/admin/users", "GET", playerToken);
    assert.equal(playerStartsRestricted.status, 403);

    const grantTournamentAdmin = await request(
      origin,
      `/admin/users/${playerId}/role`,
      "PATCH",
      actingToken,
      { role: "tournament_admin" },
    );
    assert.equal(grantTournamentAdmin.status, 200);

    const promotedPlayerMe = await request(origin, "/auth/me", "GET", playerToken);
    assert.equal(promotedPlayerMe.status, 200);
    assert.equal(promotedPlayerMe.body.role, "tournament_admin");
    const promotedPlayerFullAdminAccess = await request(origin, "/admin/users", "GET", playerToken);
    assert.equal(promotedPlayerFullAdminAccess.status, 403);
    const promotedPlayerTournamentAccess = await request(
      origin,
      "/daily007/v2/admin/matches",
      "POST",
      playerToken,
      {},
    );
    assert.equal(promotedPlayerTournamentAccess.status, 400);

    const removeTournamentAdmin = await request(
      origin,
      `/admin/users/${playerId}/role`,
      "PATCH",
      actingToken,
      { role: "user" },
    );
    assert.equal(removeTournamentAdmin.status, 200);
    const demotedPlayerMe = await request(origin, "/auth/me", "GET", playerToken);
    assert.equal(demotedPlayerMe.status, 200);
    assert.equal(demotedPlayerMe.body.role, "user");
    const demotedPlayerAdminAccess = await request(
      origin,
      "/daily007/v2/admin/matches",
      "POST",
      playerToken,
      {},
    );
    assert.equal(demotedPlayerAdminAccess.status, 403);

    const fullAdminAccessBeforeChange = await request(origin, "/admin/users", "GET", fullAdminToken);
    assert.equal(fullAdminAccessBeforeChange.status, 200);
    const restrictFullAdmin = await request(
      origin,
      `/admin/users/${fullAdminId}/role`,
      "PATCH",
      actingToken,
      { role: "tournament_admin" },
    );
    assert.equal(restrictFullAdmin.status, 200);

    const restrictedFullAdminMe = await request(origin, "/auth/me", "GET", fullAdminToken);
    assert.equal(restrictedFullAdminMe.status, 200);
    assert.equal(restrictedFullAdminMe.body.role, "tournament_admin");
    const restrictedFullAdminControls = await request(origin, "/admin/users", "GET", fullAdminToken);
    assert.equal(restrictedFullAdminControls.status, 403);
    const restrictedFullAdminTournamentAccess = await request(
      origin,
      "/daily007/v2/admin/matches",
      "POST",
      fullAdminToken,
      {},
    );
    assert.equal(restrictedFullAdminTournamentAccess.status, 400);

    const removeFullAdminAccess = await request(
      origin,
      `/admin/users/${fullAdminId}/role`,
      "PATCH",
      actingToken,
      { role: "user" },
    );
    assert.equal(removeFullAdminAccess.status, 200);
    const returnedPlayerMe = await request(origin, "/auth/me", "GET", fullAdminToken);
    assert.equal(returnedPlayerMe.status, 200);
    assert.equal(returnedPlayerMe.body.role, "user");
    const returnedPlayerAdminAccess = await request(
      origin,
      "/daily007/v2/admin/matches",
      "POST",
      fullAdminToken,
      {},
    );
    assert.equal(returnedPlayerAdminAccess.status, 403);
  });
});