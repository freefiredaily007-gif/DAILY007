import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import type { Server } from "node:http";
import express from "express";
import test, { after } from "node:test";
import { pool } from "@workspace/db";
import { makeToken } from "../src/lib/daily007-session-token";
import daily007CompatCoreRouter from "../src/routes/daily007-compat-core";
import daily007CompatExtraRouter from "../src/routes/daily007-compat-extra";
import daily007V2Router from "../src/routes/daily007-v2";

const TEST_AUTH_SECRET = "daily007-squad-slots-integration-test-secret";
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

type ApiResponse = { status: number; body: Record<string, any> };

after(async () => {
  if (previousAuthSecret === undefined) delete process.env.DAILY007_AUTH_SECRET;
  else process.env.DAILY007_AUTH_SECRET = previousAuthSecret;
  await pool.end();
});

async function withServer(run: (origin: string) => Promise<void>): Promise<void> {
  const app = express();
  app.use(express.json());
  app.use(daily007CompatCoreRouter);
  app.use(daily007CompatExtraRouter);
  app.use(daily007V2Router);
  app.use((
    error: unknown,
    _request: express.Request,
    response: express.Response,
    _next: express.NextFunction,
  ) => {
    response.status(500).json({ error: error instanceof Error ? error.message : String(error) });
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

function headers(userId: string): Record<string, string> {
  const token = makeToken(userId, 0);
  assert.ok(token);
  return { authorization: `Bearer ${token}`, "content-type": "application/json" };
}

async function createUser(role = "user", walletCoins = 100): Promise<string> {
  const id = randomUUID();
  await pool.query(
    `INSERT INTO daily007_v2_users
       (id, name, email, password_salt, password_hash, role, wallet_coins)
     VALUES ($1, $2, $3, 'salt', 'hash', $4, $5)`,
    [id, `Squad Player ${id.slice(0, 6)}`, `squad-${id}@example.test`, role, walletCoins],
  );
  return id;
}

async function createMatch(entryCoins = 10): Promise<string> {
  const id = randomUUID();
  await pool.query(
    `INSERT INTO daily007_v2_matches
       (id, title, mode, game_mode, team_type, capacity, entry_coins, starts_at, status)
     VALUES ($1, 'Squad Slot Integration', 'squad', 'battle_royale', 'squad',
             12, $2, clock_timestamp() + interval '20 hours', 'open')`,
    [id, entryCoins],
  );
  return id;
}

async function joinSlot(
  origin: string,
  matchId: string,
  userId: string,
  teamNumber: number,
  slotNumber: number,
): Promise<ApiResponse> {
  const response = await fetch(`${origin}/daily007/v2/matches/${matchId}/squad-join`, {
    method: "POST",
    headers: headers(userId),
    body: JSON.stringify({
      teamNumber,
      slotNumber,
      gameName: `Player-${userId.slice(0, 6)}`,
      gameUid: `uid-${userId}`,
    }),
  });
  return { status: response.status, body: await response.json() as Record<string, any> };
}

async function slotsFor(origin: string, matchId: string, userId: string): Promise<ApiResponse> {
  const response = await fetch(`${origin}/daily007/v2/matches/${matchId}/squad-slots`, {
    headers: headers(userId),
  });
  return { status: response.status, body: await response.json() as Record<string, any> };
}

test("Squad slots charge each player atomically, preserve captain control, and transfer captaincy", async (t) => {
  await withServer(async (origin) => {
    await t.test("only one concurrent player can take the same slot and charge", async () => {
      const matchId = await createMatch();
      const [firstUser, secondUser] = await Promise.all([createUser(), createUser()]);
      const results = await Promise.all([
        joinSlot(origin, matchId, firstUser, 1, 1),
        joinSlot(origin, matchId, secondUser, 1, 1),
      ]);
      assert.equal(results.filter((result) => result.status === 201).length, 1);
      assert.equal(results.filter((result) => result.status === 409).length, 1);
      const rows = await pool.query<{
        registrations: number; active_members: number; entry_ledgers: number; paid_balance: number;
      }>(
        `SELECT
           (SELECT count(*)::integer FROM daily007_v2_registrations WHERE match_id = $1) AS registrations,
           (SELECT count(*)::integer FROM daily007_v2_squad_team_members member
              JOIN daily007_v2_squad_teams team ON team.id = member.team_id
             WHERE team.match_id = $1 AND member.is_active) AS active_members,
           (SELECT count(*)::integer FROM daily007_v2_wallet_ledger WHERE match_id = $1) AS entry_ledgers,
           (SELECT count(*)::integer FROM daily007_v2_users WHERE id = ANY($2::uuid[]) AND wallet_coins = 90) AS paid_balance`,
        [matchId, [firstUser, secondUser]],
      );
      assert.deepEqual(rows.rows[0], { registrations: 1, active_members: 1, entry_ledgers: 1, paid_balance: 1 });
    });

    await t.test("captain removal keeps the paid fee, reopens the slot, and admin rejection transfers captaincy", async () => {
      const matchId = await createMatch();
      const captain = await createUser();
      const removedPlayer = await createUser();
      const replacement = await createUser();
      const teammate = await createUser();
      const admin = await createUser("tournament_admin");
      const captainJoin = await joinSlot(origin, matchId, captain, 3, 1);
      const removedJoin = await joinSlot(origin, matchId, removedPlayer, 3, 2);
      assert.equal(captainJoin.status, 201);
      assert.equal(captainJoin.body.isCaptain, true);
      assert.equal(removedJoin.status, 201);
      const removedRegistrationId = removedJoin.body.registrationId as string;

      const removed = await fetch(`${origin}/daily007/v2/matches/${matchId}/squad-slots/3/2`, {
        method: "DELETE",
        headers: headers(captain),
      });
      assert.equal(removed.status, 200);
      assert.equal((await removed.json() as Record<string, unknown>).refunded, false);
      const afterRemoval = await pool.query<{ wallet_coins: number; ledger_count: number; status: string }>(
        `SELECT u.wallet_coins,
                (SELECT count(*)::integer FROM daily007_v2_wallet_ledger WHERE registration_id = $2) AS ledger_count,
                r.status
           FROM daily007_v2_users u JOIN daily007_v2_registrations r ON r.captain_user_id = u.id
          WHERE u.id = $1 AND r.id = $2`,
        [removedPlayer, removedRegistrationId],
      );
      assert.deepEqual(afterRemoval.rows[0], { wallet_coins: 90, ledger_count: 1, status: "removed" });

      assert.equal((await joinSlot(origin, matchId, replacement, 3, 2)).status, 201);
      assert.equal((await joinSlot(origin, matchId, teammate, 3, 3)).status, 201);
      const selfRemoval = await fetch(`${origin}/daily007/v2/matches/${matchId}/squad-slots/3/1`, {
        method: "DELETE",
        headers: headers(captain),
      });
      assert.equal(selfRemoval.status, 409, "a captain cannot remove themself");
      const unauthorizedRemoval = await fetch(`${origin}/daily007/v2/matches/${matchId}/squad-slots/3/2`, {
        method: "DELETE",
        headers: headers(teammate),
      });
      assert.equal(unauthorizedRemoval.status, 403, "a non-captain cannot manage another player's slot");
      const reject = await fetch(`${origin}/admin/registrations/${captainJoin.body.registrationId}/reject`, {
        method: "POST",
        headers: headers(admin),
        body: JSON.stringify({}),
      });
      assert.equal(reject.status, 200);
      const state = await slotsFor(origin, matchId, replacement);
      assert.equal(state.status, 200);
      const team = state.body.teams.find((candidate: any) => candidate.teamNumber === 3);
      assert.equal(team.slots[1].isCaptain, true);
      assert.equal(team.slots[2].canRemove, true);

      const balances = await pool.query<{ id: string; wallet_coins: number }>(
        "SELECT id, wallet_coins FROM daily007_v2_users WHERE id = ANY($1::uuid[]) ORDER BY id",
        [[captain, removedPlayer, replacement, teammate]],
      );
      const balanceById = Object.fromEntries(balances.rows.map((row) => [row.id, row.wallet_coins]));
      assert.equal(balanceById[captain], 100, "admin rejection refunds the captain's entry fee");
      assert.equal(balanceById[removedPlayer], 90, "captain removal does not refund the teammate");
      assert.equal(balanceById[replacement], 90);
      assert.equal(balanceById[teammate], 90);
    });

    await t.test("only the captain's registration can publish a Squad result", async () => {
      const matchId = await createMatch();
      const captain = await createUser();
      const teammate = await createUser();
      const admin = await createUser("tournament_admin");
      const captainJoin = await joinSlot(origin, matchId, captain, 2, 1);
      const teammateJoin = await joinSlot(origin, matchId, teammate, 2, 2);
      await pool.query(
        "UPDATE daily007_v2_matches SET starts_at = clock_timestamp() - interval '1 hour' WHERE id = $1",
        [matchId],
      );
      const response = await fetch(`${origin}/admin/results`, {
        method: "POST",
        headers: headers(admin),
        body: JSON.stringify({
          tournamentId: matchId,
          registrationId: teammateJoin.body.registrationId,
          rank: 1,
          kills: 0,
        }),
      });
      assert.equal(response.status, 409);
      assert.match(String((await response.json() as Record<string, unknown>).error), /team captain/i);
      const noAwards = await pool.query<{ count: number }>(
        "SELECT count(*)::integer AS count FROM daily007_v2_result_awards WHERE match_id = $1",
        [matchId],
      );
      assert.equal(noAwards.rows[0].count, 0);
      assert.equal(captainJoin.status, 201);
    });

    await t.test("legacy whole-team records stay intact and public rosters expose names only", async () => {
      const matchId = await createMatch();
      const captain = await createUser();
      const registration = await pool.query<{ id: string }>(
        `INSERT INTO daily007_v2_registrations
           (match_id, captain_user_id, captain_name, captain_game_name, captain_game_uid,
            team_name, entry_coins_paid, status)
         VALUES ($1, $2, 'Legacy Captain', 'LegacyLead', 'legacy-captain-uid',
                 'Legacy Team', 10, 'approved')
         RETURNING id`,
        [matchId, captain],
      );
      for (const [position, name, uid] of [
        [1, "Legacy Mate One", "legacy-mate-uid-1"],
        [2, "Legacy Mate Two", "legacy-mate-uid-2"],
        [3, "Legacy Mate Three", "legacy-mate-uid-3"],
      ] as const) {
        await pool.query(
          "INSERT INTO daily007_v2_roster (registration_id, position, member_name, member_uid) VALUES ($1, $2, $3, $4)",
          [registration.rows[0].id, position, name, uid],
        );
      }
      const response = await slotsFor(origin, matchId, captain);
      assert.equal(response.status, 200);
      const team = response.body.teams[0];
      assert.equal(team.legacy, true);
      assert.deepEqual(team.slots.map((slot: any) => slot.gameName), [
        "LegacyLead", "Legacy Mate One", "Legacy Mate Two", "Legacy Mate Three",
      ]);
      assert.equal(team.slots[0].isCaptain, true);
      assert.equal(team.slots[1].canRemove, false);

      const publicResponse = await fetch(`${origin}/tournaments/${matchId}/participants`);
      assert.equal(publicResponse.status, 200);
      const publicBody = await publicResponse.json() as Record<string, any>;
      assert.deepEqual(publicBody.participants[0].players, [
        "LegacyLead", "Legacy Mate One", "Legacy Mate Two", "Legacy Mate Three",
      ]);
      const serialized = JSON.stringify(publicBody);
      assert.equal(serialized.includes("legacy-captain-uid"), false);
      assert.equal(serialized.includes(captain), false);
      const preserved = await pool.query<{ team_name: string; status: string; roster_count: number }>(
        `SELECT registration.team_name, registration.status,
                (SELECT count(*)::integer FROM daily007_v2_roster roster
                  WHERE roster.registration_id = registration.id) AS roster_count
           FROM daily007_v2_registrations registration WHERE registration.id = $1`,
        [registration.rows[0].id],
      );
      assert.deepEqual(preserved.rows[0], { team_name: "Legacy Team", status: "approved", roster_count: 3 });
    });

    await t.test("zero-fee matches do not change the wallet or create a payment ledger entry", async () => {
      const matchId = await createMatch(0);
      const player = await createUser("user", 37);
      const joined = await joinSlot(origin, matchId, player, 1, 4);
      assert.equal(joined.status, 201);
      assert.equal(joined.body.entryCoinsPaid, 0);
      const result = await pool.query<{ wallet_coins: number; ledger_count: number }>(
        `SELECT wallet_coins,
                (SELECT count(*)::integer FROM daily007_v2_wallet_ledger WHERE match_id = $2) AS ledger_count
           FROM daily007_v2_users WHERE id = $1`,
        [player, matchId],
      );
      assert.deepEqual(result.rows[0], { wallet_coins: 37, ledger_count: 0 });
    });
  });
});
