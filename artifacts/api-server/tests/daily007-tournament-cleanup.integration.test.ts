import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test, { after } from "node:test";
import express from "express";
import type { Server } from "node:http";
import { pool } from "@workspace/db";
import { runDaily007TournamentCleanupSweep } from "../src/lib/daily007-tournament-cleanup";
import { makeToken } from "../src/lib/daily007-session-token";
import daily007CompatCoreRouter from "../src/routes/daily007-compat-core";

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

test("cleanup removes all matches past 72 hours while preserving wallet and user history", async () => {
  const adminId = randomUUID();
  const userId = randomUUID();
  const eligible = randomUUID();
  const eligibleWithDependencies = randomUUID();
  const resultProtected = randomUUID();
  const walletProtected = randomUUID();
  const enabled = randomUUID();
  const nonTerminal = randomUUID();
  const future = randomUUID();
  const resultRegistration = randomUUID();
  const walletRegistration = randomUUID();
  const dependentRegistration = randomUUID();
  const squadTeam = randomUUID();
  const rosterId = randomUUID();
  const matchIds = [eligible, eligibleWithDependencies, resultProtected, walletProtected, enabled, nonTerminal, future];

  try {
    await pool.query(
      `INSERT INTO daily007_v2_users
         (id, name, email, password_salt, password_hash, role, wallet_coins)
       VALUES ($1, 'Cleanup Admin', $2, '', '', 'admin', 0),
              ($3, 'Cleanup Player', $4, '', '', 'user', 95)`,
      [adminId, `admin-${adminId}@example.test`, userId, `player-${userId}@example.test`],
    );
    await pool.query(
      `INSERT INTO daily007_v2_matches (id, title, mode, capacity, enabled, starts_at, status)
       VALUES
         ($1, 'Eligible empty', 'solo', 48, false, now() - interval '4 days', 'cancelled'),
         ($2, 'Eligible with dependencies', 'squad', 12, false, now() - interval '4 days', 'cancelled'),
         ($3, 'Published result', 'solo', 48, false, now() - interval '4 days', 'completed'),
         ($4, 'Wallet history', 'solo', 48, false, now() - interval '4 days', 'cancelled'),
         ($5, 'Still enabled', 'solo', 48, true, now() - interval '4 days', 'cancelled'),
         ($6, 'Not terminal', 'solo', 48, false, now() - interval '4 days', 'open'),
         ($7, 'Under 72 hours', 'solo', 48, false, now() - interval '24 hours', 'cancelled')`,
      matchIds,
    );
    await pool.query(
      `INSERT INTO daily007_v2_registrations
         (id, match_id, captain_user_id, captain_name, captain_game_name,
          captain_game_uid, entry_coins_paid, status)
       VALUES
         ($1, $2, $3, 'Result Player', 'Result Player', 'result-uid', 0, 'approved'),
         ($4, $5, $3, 'Wallet Player', 'Wallet Player', 'wallet-uid', 0, 'rejected'),
         ($6, $7, $3, 'Dependency Player', 'Dependency Player', 'dependency-uid', 0, 'rejected')`,
      [resultRegistration, resultProtected, userId, walletRegistration, walletProtected,
        dependentRegistration, eligibleWithDependencies],
    );
    await pool.query(
      `INSERT INTO daily007_v2_result_awards
         (match_id, registration_id, user_id, rank, kills, prize_coins)
       VALUES ($1, $2, $3, 1, 4, 10)`,
      [resultProtected, resultRegistration, userId],
    );
    await pool.query(
      `INSERT INTO daily007_v2_user_stats (user_id, matches, wins, kills, prize_coins)
       VALUES ($1, 7, 1, 4, 10)`,
      [userId],
    );
    await pool.query(
      `INSERT INTO daily007_v2_wallet_ledger
         (user_id, amount, balance_after, reason, match_id, registration_id)
       VALUES ($1, -5, 95, 'tournament_entry', $2, $3)`,
      [userId, walletProtected, walletRegistration],
    );
    await pool.query(
      `INSERT INTO daily007_v2_roster (id, registration_id, position, member_name)
       VALUES ($1, $2, 2, 'Dependency Teammate')`,
      [rosterId, dependentRegistration],
    );
    await pool.query(
      `INSERT INTO daily007_v2_squad_teams (id, match_id, team_number)
       VALUES ($1, $2, 1)`,
      [squadTeam, eligibleWithDependencies],
    );
    await pool.query(
      `INSERT INTO daily007_v2_squad_team_members (team_id, slot_number, registration_id)
       VALUES ($1, 2, $2)`,
      [squadTeam, dependentRegistration],
    );

    const adminToken = makeToken(adminId, 0);
    const userToken = makeToken(userId, 0);
    assert.ok(adminToken);
    assert.ok(userToken);

    await withServer(async (origin) => {
      const response = await fetch(`${origin}/admin/tournaments/cleanup-preview`, {
        headers: { authorization: `Bearer ${adminToken}` },
      });
      assert.equal(response.status, 200);
      const body = await response.json() as {
        success: boolean;
        data: {
          retentionHours: number;
          scannedMatches: number;
          eligibleMatches: number;
          matchDataToDelete: {
            registrations: number;
            rosterRows: number;
            squadTeams: number;
            squadMembers: number;
            resultAwards: number;
          };
          protectedHistory: {
            matchesWithWalletHistory: number;
            walletLedgerRows: number;
            playerStatsRowsPreserved: number;
          };
          candidates: Array<{ id: string; registrations: number; walletLedgerRowsPreserved: number }>;
        };
      };
      assert.equal(body.success, true);
      assert.equal(body.data.retentionHours, 72);
      assert.equal(body.data.scannedMatches, 6);
      assert.equal(body.data.eligibleMatches, 6);
      assert.deepEqual(body.data.matchDataToDelete, {
        registrations: 3,
        rosterRows: 1,
        squadTeams: 1,
        squadMembers: 1,
        resultAwards: 1,
      });
      assert.equal(body.data.protectedHistory.matchesWithWalletHistory, 1);
      assert.equal(body.data.protectedHistory.walletLedgerRows, 1);
      assert.equal(body.data.protectedHistory.playerStatsRowsPreserved, 1);
      assert.deepEqual(
        body.data.candidates.map((candidate) => candidate.id).sort(),
        [eligible, eligibleWithDependencies, resultProtected, walletProtected, enabled, nonTerminal].sort(),
      );
      assert.equal(
        body.data.candidates.find((candidate) => candidate.id === walletProtected)?.walletLedgerRowsPreserved,
        1,
      );

      const userResponse = await fetch(`${origin}/admin/tournaments/cleanup-preview`, {
        headers: { authorization: `Bearer ${userToken}` },
      });
      assert.equal(userResponse.status, 403);
    });

    const afterPreview = await pool.query<{ count: number }>(
      "SELECT count(*)::integer AS count FROM daily007_v2_matches WHERE id = ANY($1::uuid[])",
      [matchIds],
    );
    assert.equal(afterPreview.rows[0]?.count, matchIds.length, "the preview must not delete tournaments");

    const usersBefore = await pool.query(
      `SELECT id, name, email, role, status, wallet_coins
         FROM daily007_v2_users
        WHERE id = ANY($1::uuid[])
        ORDER BY id`,
      [[adminId, userId]],
    );
    const walletBefore = await pool.query(
      `SELECT id, user_id, amount, balance_after, reason, match_id, registration_id,
              idempotency_key, details, created_at
         FROM daily007_v2_wallet_ledger
        WHERE user_id = $1`,
      [userId],
    );
    const statsBefore = await pool.query(
      `SELECT user_id, matches, wins, kills, prize_coins
         FROM daily007_v2_user_stats
        WHERE user_id = $1`,
      [userId],
    );

    const sweep = await runDaily007TournamentCleanupSweep();
    const expiredMatchIds = [eligible, eligibleWithDependencies, resultProtected, walletProtected, enabled, nonTerminal];
    assert.deepEqual([...sweep.deletedMatchIds].sort(), [...expiredMatchIds].sort());
    const afterSweep = await pool.query<{ count: number }>(
      "SELECT count(*)::integer AS count FROM daily007_v2_matches WHERE id = ANY($1::uuid[])",
      [matchIds],
    );
    assert.equal(afterSweep.rows[0]?.count, 1, "only the match that has not reached 72 hours remains");
    await withServer(async (origin) => {
      const adminList = await fetch(`${origin}/admin/tournaments`, {
        headers: { authorization: `Bearer ${adminToken}` },
      });
      assert.equal(adminList.status, 200);
      const adminMatches = await adminList.json() as Array<{ id: string }>;
      assert.deepEqual(adminMatches.map((match) => match.id), [future]);

      const nextPreview = await fetch(`${origin}/admin/tournaments/cleanup-preview`, {
        headers: { authorization: `Bearer ${adminToken}` },
      });
      const nextPreviewBody = await nextPreview.json() as { data: { eligibleMatches: number; scannedMatches: number } };
      assert.equal(nextPreviewBody.data.eligibleMatches, 0);
      assert.equal(nextPreviewBody.data.scannedMatches, 0);
    });
    const usersAfter = await pool.query(
      `SELECT id, name, email, role, status, wallet_coins
         FROM daily007_v2_users
        WHERE id = ANY($1::uuid[])
        ORDER BY id`,
      [[adminId, userId]],
    );
    assert.deepEqual(usersAfter.rows, usersBefore.rows, "user profiles and wallet balances remain unchanged");
    const walletAfter = await pool.query(
      `SELECT id, user_id, amount, balance_after, reason, match_id, registration_id,
              idempotency_key, details, created_at
         FROM daily007_v2_wallet_ledger
        WHERE user_id = $1`,
      [userId],
    );
    assert.deepEqual(walletAfter.rows, walletBefore.rows, "wallet ledger records and their stored IDs remain unchanged");
    const statsAfter = await pool.query(
      `SELECT user_id, matches, wins, kills, prize_coins
         FROM daily007_v2_user_stats
        WHERE user_id = $1`,
      [userId],
    );
    assert.deepEqual(statsAfter.rows, statsBefore.rows, "lifetime player stats are not recalculated or deleted");
    const removedMatchData = await pool.query<{
      result_awards: number;
      registrations: number;
      roster_rows: number;
      squad_teams: number;
      squad_members: number;
    }>(
      `SELECT
         (SELECT count(*)::integer FROM daily007_v2_result_awards WHERE match_id = ANY($1::uuid[])) AS result_awards,
         (SELECT count(*)::integer FROM daily007_v2_registrations WHERE match_id = ANY($1::uuid[])) AS registrations,
         (SELECT count(*)::integer
            FROM daily007_v2_roster roster
            JOIN daily007_v2_registrations registration ON registration.id = roster.registration_id
           WHERE registration.match_id = ANY($1::uuid[])) AS roster_rows,
         (SELECT count(*)::integer FROM daily007_v2_squad_teams WHERE match_id = ANY($1::uuid[])) AS squad_teams,
         (SELECT count(*)::integer
            FROM daily007_v2_squad_team_members member
            JOIN daily007_v2_squad_teams team ON team.id = member.team_id
           WHERE team.match_id = ANY($1::uuid[])) AS squad_members`,
      [expiredMatchIds],
    );
    assert.deepEqual(removedMatchData.rows[0], {
      result_awards: 0,
      registrations: 0,
      roster_rows: 0,
      squad_teams: 0,
      squad_members: 0,
    });
  } finally {
    await pool.query("DELETE FROM daily007_v2_wallet_ledger WHERE user_id = ANY($1::uuid[])", [[adminId, userId]]);
    await pool.query("DELETE FROM daily007_v2_result_awards WHERE match_id = ANY($1::uuid[])", [matchIds]);
    await pool.query("DELETE FROM daily007_v2_matches WHERE id = ANY($1::uuid[])", [matchIds]);
    await pool.query("DELETE FROM daily007_v2_user_stats WHERE user_id = ANY($1::uuid[])", [[adminId, userId]]);
    await pool.query("DELETE FROM daily007_v2_users WHERE id = ANY($1::uuid[])", [[adminId, userId]]);
  }
});
