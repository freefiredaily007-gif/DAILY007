import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test, { after } from "node:test";
import express from "express";
import type { Server } from "node:http";
import { pool } from "@workspace/db";
import { makeToken } from "../src/lib/daily007-session-token";
import daily007CompatCoreRouter from "../src/routes/daily007-compat-core";
import daily007CompatExtraRouter from "../src/routes/daily007-compat-extra";

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

const TEST_AUTH_SECRET = "daily007-tournament-cleanup-test-secret";
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

test("unresolved matches older than 72 hours remain available for admin results without read side effects", async () => {
  const adminId = randomUUID();
  const playerId = randomUUID();
  const winnerId = randomUUID();
  const matchId = randomUUID();
  const registrationId = randomUUID();
  const winnerRegistrationId = randomUUID();
  const awardId = randomUUID();
  const ledgerId = randomUUID();
  const userIds = [adminId, playerId, winnerId];
  const adminToken = makeToken(adminId, 0);
  assert.ok(adminToken);

  try {
    await pool.query(
      `INSERT INTO daily007_v2_users
         (id, name, email, password_salt, password_hash, role, wallet_coins)
       VALUES ($1, 'Tournament Admin', $2, '', '', 'tournament_admin', 0),
              ($3, 'Result Player', $4, '', '', 'user', 95),
              ($5, 'Winner Player', $6, '', '', 'user', 95)`,
      [
        adminId, `admin-${adminId}@example.test`,
        playerId, `player-${playerId}@example.test`,
        winnerId, `winner-${winnerId}@example.test`,
      ],
    );
    await pool.query(
      `INSERT INTO daily007_v2_matches
         (id, title, mode, capacity, enabled, starts_at, status)
       VALUES ($1, 'Old unresolved match', 'solo', 48, true, now() - interval '4 days', 'open')`,
      [matchId],
    );
    await pool.query(
      `INSERT INTO daily007_v2_registrations
         (id, match_id, captain_user_id, captain_name, captain_game_name,
          captain_game_uid, entry_coins_paid, status)
       VALUES ($1, $2, $3, 'Result Player', 'Result Player', 'old-match-player', 0, 'approved')`,
      [registrationId, matchId, playerId],
    );
    await pool.query(
      `INSERT INTO daily007_v2_registrations
         (id, match_id, captain_user_id, captain_name, captain_game_name,
          captain_game_uid, entry_coins_paid, status)
       VALUES ($1, $2, $3, 'Winner Player', 'Winner Player', 'old-match-winner', 0, 'approved')`,
      [winnerRegistrationId, matchId, winnerId],
    );
    // A runner-up placement exists, but without a winner the tournament remains unresolved.
    await pool.query(
      `INSERT INTO daily007_v2_result_awards
         (id, match_id, registration_id, user_id, rank, kills, prize_coins)
       VALUES ($1, $2, $3, $4, 2, 3, 10)`,
      [awardId, matchId, registrationId, playerId],
    );
    await pool.query(
      `INSERT INTO daily007_v2_wallet_ledger
         (id, user_id, amount, balance_after, reason, match_id, registration_id)
       VALUES ($1, $2, -5, 95, 'tournament_entry', $3, $4)`,
      [ledgerId, playerId, matchId, registrationId],
    );

    const usersBefore = await pool.query(
      "SELECT * FROM daily007_v2_users WHERE id = ANY($1::uuid[]) ORDER BY id",
      [userIds],
    );
    const walletBefore = await pool.query(
      "SELECT * FROM daily007_v2_wallet_ledger WHERE user_id = ANY($1::uuid[]) ORDER BY id",
      [userIds],
    );
    const matchBefore = await pool.query(
      "SELECT * FROM daily007_v2_matches WHERE id = $1",
      [matchId],
    );

    await withServer(async (origin) => {
      const tournamentResponse = await fetch(`${origin}/tournaments`);
      assert.equal(tournamentResponse.status, 200);
      const tournaments = await tournamentResponse.json() as Array<{ id: string; status: string }>;
      assert.ok(tournaments.some((match) => match.id === matchId));
      assert.equal(tournaments.find((match) => match.id === matchId)?.status, "ongoing");

      const adminTournamentResponse = await fetch(`${origin}/admin/tournaments`, {
        headers: { authorization: `Bearer ${adminToken}` },
      });
      assert.equal(adminTournamentResponse.status, 200);
      const adminTournaments = await adminTournamentResponse.json() as Array<{ id: string; status: string }>;
      assert.ok(adminTournaments.some((match) => match.id === matchId));
      assert.equal(adminTournaments.find((match) => match.id === matchId)?.status, "ongoing");

      const registrationsResponse = await fetch(`${origin}/admin/registrations`, {
        headers: { authorization: `Bearer ${adminToken}` },
      });
      assert.equal(registrationsResponse.status, 200);
      const registrations = await registrationsResponse.json() as Array<{
        id: string;
        tournamentId: string;
        status: string;
      }>;
      assert.ok(registrations.some((registration) =>
        registration.id === registrationId &&
        registration.tournamentId === matchId &&
        registration.status === "approved"
      ), "the admin must still be able to load an approved player for result entry");

      const resultsResponse = await fetch(`${origin}/admin/results?includeUnfinalized=true`, {
        headers: { authorization: `Bearer ${adminToken}` },
      });
      assert.equal(resultsResponse.status, 200);
      const results = await resultsResponse.json() as {
        success: boolean;
        data: Array<{ tournamentId: string; registrationId: string; rank: number }>;
      };
      assert.equal(results.success, true);
      assert.ok(results.data.some((result) =>
        result.tournamentId === matchId &&
        result.registrationId === registrationId &&
        result.rank === 2
      ));

      // Compare immediately after the GETs, before explicitly publishing the winner below.
      const usersAfterReads = await pool.query(
        "SELECT * FROM daily007_v2_users WHERE id = ANY($1::uuid[]) ORDER BY id",
        [userIds],
      );
      const walletAfterReads = await pool.query(
        "SELECT * FROM daily007_v2_wallet_ledger WHERE user_id = ANY($1::uuid[]) ORDER BY id",
        [userIds],
      );
      const matchAfterReads = await pool.query(
        "SELECT * FROM daily007_v2_matches WHERE id = $1",
        [matchId],
      );
      assert.deepEqual(usersAfterReads.rows, usersBefore.rows, "tournament reads must not change accounts or wallet balances");
      assert.deepEqual(walletAfterReads.rows, walletBefore.rows, "tournament reads must not change wallet records");
      assert.deepEqual(matchAfterReads.rows, matchBefore.rows, "tournament reads must not change match records or status");

      const publishResponse = await fetch(`${origin}/admin/results`, {
        method: "POST",
        headers: {
          authorization: `Bearer ${adminToken}`,
          "content-type": "application/json",
        },
        body: JSON.stringify({
          tournamentId: matchId,
          registrationId: winnerRegistrationId,
          rank: 1,
          kills: 5,
        }),
      });
      assert.equal(publishResponse.status, 201, "admins can publish a winner for a match older than 72 hours");
      const published = await publishResponse.json() as { registrationId: string };
      assert.equal(published.registrationId, winnerRegistrationId);

      const completedTournamentResponse = await fetch(`${origin}/admin/tournaments`, {
        headers: { authorization: `Bearer ${adminToken}` },
      });
      assert.equal(completedTournamentResponse.status, 200);
      const completedTournaments = await completedTournamentResponse.json() as Array<{
        id: string;
        status: string;
      }>;
      assert.equal(
        completedTournaments.find((match) => match.id === matchId)?.status,
        "completed",
        "the old match only becomes completed after its winner is manually published",
      );
    });
  } finally {
    await pool.query("DELETE FROM daily007_v2_wallet_ledger WHERE user_id = ANY($1::uuid[])", [userIds]);
    await pool.query("DELETE FROM daily007_v2_result_awards WHERE match_id = $1", [matchId]);
    await pool.query("DELETE FROM daily007_v2_matches WHERE id = $1", [matchId]);
    await pool.query("DELETE FROM daily007_v2_user_stats WHERE user_id = ANY($1::uuid[])", [userIds]);
    await pool.query("DELETE FROM daily007_v2_users WHERE id = ANY($1::uuid[])", [userIds]);
  }
});

test("admins can delete upcoming and ongoing tournaments without refunds or wallet-history changes", async () => {
  const adminId = randomUUID();
  const playerId = randomUUID();
  const upcomingMatchId = randomUUID();
  const ongoingMatchId = randomUUID();
  const completedMatchId = randomUUID();
  const registrationId = randomUUID();
  const teamId = randomUUID();
  const awardId = randomUUID();
  const ledgerId = randomUUID();
  const userIds = [adminId, playerId];
  const matchIds = [upcomingMatchId, ongoingMatchId, completedMatchId];
  const adminToken = makeToken(adminId, 0);
  const playerToken = makeToken(playerId, 0);
  assert.ok(adminToken);
  assert.ok(playerToken);

  try {
    await pool.query(
      `INSERT INTO daily007_v2_users
         (id, name, email, password_salt, password_hash, role, wallet_coins)
       VALUES ($1, 'Tournament Admin', $2, '', '', 'tournament_admin', 0),
              ($3, 'No Refund Player', $4, '', '', 'user', 90)`,
      [
        adminId,
        `delete-admin-${adminId}@example.test`,
        playerId,
        `delete-player-${playerId}@example.test`,
      ],
    );
    await pool.query(
      `INSERT INTO daily007_v2_matches
         (id, title, mode, game_mode, team_type, capacity, entry_coins, prize_pool,
          enabled, starts_at, status)
       VALUES ($1, 'Upcoming delete test', 'duo', 'battle_royale', 'duo', 24, 10, 50,
               true, now() + interval '1 day', 'open'),
              ($2, 'Ongoing delete test', 'duo', 'battle_royale', 'duo', 24, 10, 50,
               true, now() - interval '1 hour', 'open'),
              ($3, 'Completed delete test', 'duo', 'battle_royale', 'duo', 24, 10, 50,
               false, now() - interval '1 hour', 'completed')`,
      matchIds,
    );
    await pool.query(
      `INSERT INTO daily007_v2_registrations
         (id, match_id, captain_user_id, captain_name, captain_game_name,
          captain_game_uid, team_name, entry_coins_paid, status)
       VALUES ($1, $2, $3, 'No Refund Player', 'No Refund Player',
               'NO-REFUND-UID', 'Test Team', 10, 'approved')`,
      [registrationId, ongoingMatchId, playerId],
    );
    await pool.query(
      `INSERT INTO daily007_v2_roster (registration_id, position, member_uid, member_name)
       VALUES ($1, 1, 'TEAM-UID-2', 'Second Player')`,
      [registrationId],
    );
    await pool.query(
      `INSERT INTO daily007_v2_squad_teams (id, match_id, team_number, captain_registration_id)
       VALUES ($1, $2, 1, $3)`,
      [teamId, ongoingMatchId, registrationId],
    );
    await pool.query(
      `INSERT INTO daily007_v2_squad_team_members (team_id, slot_number, registration_id)
       VALUES ($1, 1, $2)`,
      [teamId, registrationId],
    );
    await pool.query(
      `INSERT INTO daily007_v2_result_awards
         (id, match_id, registration_id, user_id, rank, kills, prize_coins)
       VALUES ($1, $2, $3, $4, 2, 2, 0)`,
      [awardId, ongoingMatchId, registrationId, playerId],
    );
    await pool.query(
      `INSERT INTO daily007_v2_wallet_ledger
         (id, user_id, amount, balance_after, reason, match_id, registration_id)
       VALUES ($1, $2, -10, 90, 'tournament_entry', $3, $4)`,
      [ledgerId, playerId, ongoingMatchId, registrationId],
    );

    const usersBefore = await pool.query(
      "SELECT * FROM daily007_v2_users WHERE id = ANY($1::uuid[]) ORDER BY id",
      [userIds],
    );
    const walletBefore = await pool.query(
      "SELECT * FROM daily007_v2_wallet_ledger WHERE user_id = ANY($1::uuid[]) ORDER BY id",
      [userIds],
    );

    await withServer(async (origin) => {
      const unauthorized = await fetch(
        `${origin}/admin/tournaments/${ongoingMatchId}/delete-no-refund`,
        { method: "DELETE", headers: { authorization: `Bearer ${playerToken}` } },
      );
      assert.equal(unauthorized.status, 403, "regular players cannot use the Admin delete action");

      for (const matchId of [upcomingMatchId, ongoingMatchId]) {
        const response = await fetch(`${origin}/admin/tournaments/${matchId}/delete-no-refund`, {
          method: "DELETE",
          headers: { authorization: `Bearer ${adminToken}` },
        });
        assert.equal(response.status, 200);
        assert.deepEqual(await response.json(), {
          success: true,
          data: {
            id: matchId,
            deleted: true,
            refundsIssued: 0,
            walletBalancesChanged: false,
            walletTransactionsChanged: false,
          },
        });
      }

      const completed = await fetch(
        `${origin}/admin/tournaments/${completedMatchId}/delete-no-refund`,
        { method: "DELETE", headers: { authorization: `Bearer ${adminToken}` } },
      );
      assert.equal(completed.status, 409, "completed matches remain protected from this action");
    });

    const usersAfter = await pool.query(
      "SELECT * FROM daily007_v2_users WHERE id = ANY($1::uuid[]) ORDER BY id",
      [userIds],
    );
    const walletAfter = await pool.query(
      "SELECT * FROM daily007_v2_wallet_ledger WHERE user_id = ANY($1::uuid[]) ORDER BY id",
      [userIds],
    );
    assert.deepEqual(usersAfter.rows, usersBefore.rows, "no user account or wallet balance is modified");
    assert.deepEqual(walletAfter.rows, walletBefore.rows, "wallet transaction rows and their match links are unchanged");

    const remaining = await pool.query<{
      matches: number;
      registrations: number;
      rosters: number;
      teams: number;
      team_members: number;
      awards: number;
    }>(
      `SELECT
         (SELECT count(*)::int FROM daily007_v2_matches WHERE id = ANY($1::uuid[])) AS matches,
         (SELECT count(*)::int FROM daily007_v2_registrations WHERE match_id = $2) AS registrations,
         (SELECT count(*)::int FROM daily007_v2_roster roster
            JOIN daily007_v2_registrations registration ON registration.id = roster.registration_id
           WHERE registration.match_id = $2) AS rosters,
         (SELECT count(*)::int FROM daily007_v2_squad_teams WHERE match_id = $2) AS teams,
         (SELECT count(*)::int FROM daily007_v2_squad_team_members member
            JOIN daily007_v2_squad_teams team ON team.id = member.team_id
           WHERE team.match_id = $2) AS team_members,
         (SELECT count(*)::int FROM daily007_v2_result_awards WHERE match_id = $2) AS awards`,
      [matchIds, ongoingMatchId],
    );
    assert.deepEqual(remaining.rows[0], {
      matches: 1,
      registrations: 0,
      rosters: 0,
      teams: 0,
      team_members: 0,
      awards: 0,
    }, "the two active matches and their direct match data are deleted, but completed history remains");
    assert.equal(
      (await pool.query("SELECT id FROM daily007_v2_matches WHERE id = $1", [completedMatchId])).rows.length,
      1,
    );
  } finally {
    await pool.query("DELETE FROM daily007_v2_wallet_ledger WHERE user_id = ANY($1::uuid[])", [userIds]);
    await pool.query("DELETE FROM daily007_v2_result_awards WHERE match_id = ANY($1::uuid[])", [matchIds]);
    await pool.query("DELETE FROM daily007_v2_matches WHERE id = ANY($1::uuid[])", [matchIds]);
    await pool.query("DELETE FROM daily007_v2_user_stats WHERE user_id = ANY($1::uuid[])", [userIds]);
    await pool.query("DELETE FROM daily007_v2_users WHERE id = ANY($1::uuid[])", [userIds]);
  }
});
