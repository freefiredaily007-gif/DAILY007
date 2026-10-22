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

test("tournament cleanup preview is admin-only, read-only, and retains linked history", async () => {
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
              ($3, 'Cleanup Player', $4, '', '', 'user', 0)`,
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
          eligibleDependencies: { registrations: number; rosterRows: number; squadTeams: number; squadMembers: number };
          protectedHistory: {
            matchesWithRegistrations: number;
            registrationRowsPreserved: number;
            matchesWithPublishedResults: number;
            publishedResultAwards: number;
            matchesWithWalletHistory: number;
            walletLedgerRows: number;
            playerStatsRowsPreserved: number;
          };
          excluded: { nonTerminalMatches: number; enabledMatches: number };
          candidates: Array<{ id: string; registrations: number }>;
        };
      };
      assert.equal(body.success, true);
      assert.equal(body.data.retentionHours, 72);
      assert.equal(body.data.scannedMatches, 6);
      assert.equal(body.data.eligibleMatches, 1);
      assert.deepEqual(body.data.eligibleDependencies, {
        registrations: 0,
        rosterRows: 0,
        squadTeams: 0,
        squadMembers: 0,
      });
      assert.equal(body.data.protectedHistory.matchesWithRegistrations, 3);
      assert.equal(body.data.protectedHistory.registrationRowsPreserved, 3);
      assert.equal(body.data.protectedHistory.matchesWithPublishedResults, 1);
      assert.equal(body.data.protectedHistory.publishedResultAwards, 1);
      assert.equal(body.data.protectedHistory.matchesWithWalletHistory, 1);
      assert.equal(body.data.protectedHistory.walletLedgerRows, 1);
      assert.equal(body.data.protectedHistory.playerStatsRowsPreserved, 1);
      assert.deepEqual(body.data.excluded, { nonTerminalMatches: 1, enabledMatches: 1 });
      assert.deepEqual(body.data.candidates.map((candidate) => candidate.id), [eligible]);

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

    const sweep = await runDaily007TournamentCleanupSweep();
    assert.deepEqual(sweep.deletedMatchIds, [eligible]);
    const afterSweep = await pool.query<{ count: number }>(
      "SELECT count(*)::integer AS count FROM daily007_v2_matches WHERE id = ANY($1::uuid[])",
      [matchIds],
    );
    assert.equal(afterSweep.rows[0]?.count, matchIds.length - 1);
    await withServer(async (origin) => {
      const adminList = await fetch(`${origin}/admin/tournaments`, {
        headers: { authorization: `Bearer ${adminToken}` },
      });
      assert.equal(adminList.status, 200);
      const adminMatches = await adminList.json() as Array<{ id: string }>;
      assert.equal(adminMatches.some((match) => match.id === eligible), false);
      for (const matchId of matchIds.slice(1)) {
        assert.equal(adminMatches.some((match) => match.id === matchId), true);
      }

      const nextPreview = await fetch(`${origin}/admin/tournaments/cleanup-preview`, {
        headers: { authorization: `Bearer ${adminToken}` },
      });
      const nextPreviewBody = await nextPreview.json() as { data: { eligibleMatches: number } };
      assert.equal(nextPreviewBody.data.eligibleMatches, 0);
    });
    const retained = await pool.query<{ matches: number; wins: number; kills: number; prize_coins: number }>(
      "SELECT matches, wins, kills, prize_coins FROM daily007_v2_user_stats WHERE user_id = $1",
      [userId],
    );
    assert.deepEqual(retained.rows[0], { matches: 7, wins: 1, kills: 4, prize_coins: 10 });
    const protectedRows = await pool.query<{ result_awards: number; wallet_rows: number; registrations: number }>(
      `SELECT
         (SELECT count(*)::integer FROM daily007_v2_result_awards WHERE match_id = $1) AS result_awards,
         (SELECT count(*)::integer FROM daily007_v2_wallet_ledger WHERE match_id = $2) AS wallet_rows,
         (SELECT count(*)::integer FROM daily007_v2_registrations WHERE id = ANY($3::uuid[])) AS registrations`,
      [resultProtected, walletProtected, [resultRegistration, walletRegistration, dependentRegistration]],
    );
    assert.deepEqual(protectedRows.rows[0], { result_awards: 1, wallet_rows: 1, registrations: 3 });
  } finally {
    await pool.query("DELETE FROM daily007_v2_wallet_ledger WHERE match_id = ANY($1::uuid[])", [matchIds]);
    await pool.query("DELETE FROM daily007_v2_result_awards WHERE match_id = ANY($1::uuid[])", [matchIds]);
    await pool.query("DELETE FROM daily007_v2_matches WHERE id = ANY($1::uuid[])", [matchIds]);
    await pool.query("DELETE FROM daily007_v2_user_stats WHERE user_id = ANY($1::uuid[])", [[adminId, userId]]);
    await pool.query("DELETE FROM daily007_v2_users WHERE id = ANY($1::uuid[])", [[adminId, userId]]);
  }
});
