import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import type { Server } from "node:http";
import express from "express";
import test from "node:test";
import { pool } from "@workspace/db";
import { makeToken } from "../src/lib/daily007-session-token";
import daily007CompatExtraRouter from "../src/routes/daily007-compat-extra";
import {
  approveKillEarnReward,
  listCompletedKillEarnMatches,
  listKillEarnParticipants,
  listKillEarnRewardHistory,
  rejectKillEarnReward,
  saveKillEarnKills,
} from "../src/lib/daily007-kill-earn-rewards";

const ids = {
  admin: randomUUID(),
  match: randomUUID(),
  pendingMatch: randomUUID(),
  players: [randomUUID(), randomUUID(), randomUUID()],
  registrations: [randomUUID(), randomUUID(), randomUUID()],
};
const previousAuthSecret = process.env.DAILY007_AUTH_SECRET;
process.env.DAILY007_AUTH_SECRET = "daily007-kill-reward-test-secret-32-characters";

async function transaction<T>(run: (client: any) => Promise<T>): Promise<T> {
  const client = await pool.connect();
  await client.query("BEGIN");
  try {
    const result = await run(client);
    await client.query("COMMIT");
    return result;
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

async function withServer(run: (origin: string) => Promise<void>): Promise<void> {
  const app = express();
  app.use(express.json());
  app.use(daily007CompatExtraRouter);
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

function authorization(userId: string): string {
  const token = makeToken(userId, 0);
  assert.ok(token);
  return `Bearer ${token}`;
}

test("per-kill rewards snapshot rates and credit once atomically", async () => {
  try {
    await pool.query(
      `INSERT INTO daily007_v2_users (id, name, email, role, status, wallet_coins)
       VALUES
         ($1, 'Reward Admin', 'reward-admin@example.test', 'tournament_admin', 'active', 0),
         ($2, 'Player One', 'reward-player-one@example.test', 'user', 'active', 0),
         ($3, 'Player Two', 'reward-player-two@example.test', 'user', 'active', 0),
         ($4, 'Player Three', 'reward-player-three@example.test', 'user', 'active', 0)`,
      [ids.admin, ...ids.players],
    );
    await pool.query(
      `INSERT INTO daily007_v2_matches
         (id, title, game_mode, team_type, kill_reward_coins, enabled, status, starts_at)
       VALUES
         ($1, 'Kill & Earn Duo QA', 'battle_royale_kill_earn', 'duo', 5, false, 'completed', now()),
         ($2, 'Unfinished Kill & Earn Solo', 'battle_royale_kill_earn', 'solo', 5, true, 'upcoming', now())`,
      [ids.match, ids.pendingMatch],
    );
    await pool.query(
      `INSERT INTO daily007_v2_registrations
         (id, match_id, captain_user_id, captain_name, captain_game_name, captain_game_uid, assigned_group_number, status)
       VALUES
         ($1, $4, $2, 'Player One', 'IGN One', 'UID-ONE', 1, 'approved'),
         ($3, $4, $5, 'Player Two', 'IGN Two', 'UID-TWO', 1, 'approved'),
         ($6, $4, $7, 'Player Three', 'IGN Three', 'UID-THREE', 2, 'approved')`,
      [
        ids.registrations[0],
        ids.players[0],
        ids.registrations[1],
        ids.match,
        ids.players[1],
        ids.registrations[2],
        ids.players[2],
      ],
    );
    await pool.query(
      `INSERT INTO daily007_v2_result_awards
         (id, match_id, registration_id, user_id, rank, kills, prize_coins)
       VALUES ($1, $2, $3, $4, 1, 0, 0)`,
      [randomUUID(), ids.match, ids.registrations[0], ids.players[0]],
    );

    const completedMatches = await listCompletedKillEarnMatches(pool);
    assert.equal(completedMatches.length, 1);
    assert.equal(completedMatches[0]?.id, ids.match);
    assert.equal(completedMatches[0]?.approvedPlayers, 3);

    const players = await listKillEarnParticipants(pool, ids.match);
    assert.equal(players.length, 3);
    assert.equal(players[0]?.playerName, "IGN One");
    assert.equal(players[0]?.rewardPerKill, 5);

    const firstSaved = await transaction((client) =>
      saveKillEarnKills(client, ids.match, ids.registrations[0], 8),
    );
    const secondSaved = await transaction((client) =>
      saveKillEarnKills(client, ids.match, ids.registrations[1], 4),
    );
    const thirdSaved = await transaction((client) =>
      saveKillEarnKills(client, ids.match, ids.registrations[2], 2),
    );
    assert.equal(firstSaved.rewardCoins, 40);
    assert.equal(firstSaved.rewardPerKill, 5);
    assert.equal(secondSaved.rewardCoins, 20);
    assert.equal(thirdSaved.rewardCoins, 10);

    const beforeApproval = await pool.query<{ wallet_coins: number }>(
      "SELECT wallet_coins FROM daily007_v2_users WHERE id = ANY($1::uuid[]) ORDER BY id",
      [ids.players],
    );
    assert.ok(beforeApproval.rows.every((row) => Number(row.wallet_coins) === 0));

    await pool.query(
      "UPDATE daily007_v2_matches SET kill_reward_coins = 9 WHERE id = $1",
      [ids.match],
    );
    const secondRevised = await transaction((client) =>
      saveKillEarnKills(client, ids.match, ids.registrations[1], 5),
    );
    assert.equal(secondRevised.rewardPerKill, 5, "a saved reward keeps its original per-kill rate");
    assert.equal(secondRevised.rewardCoins, 25);

    await assert.rejects(
      transaction((client) => saveKillEarnKills(client, ids.match, ids.registrations[0], -1)),
      /non-negative whole number/,
    );

    const firstRewardId = firstSaved.id;
    let firstPayout: Awaited<ReturnType<typeof approveKillEarnReward>>["reward"] | undefined;
    await withServer(async (origin) => {
      const unauthorized = await fetch(`${origin}/admin/kill-earn/matches`);
      assert.equal(unauthorized.status, 401);

      const playerApproval = await fetch(`${origin}/admin/kill-earn/rewards/${firstRewardId}/approve`, {
        method: "POST",
        headers: {
          authorization: authorization(ids.players[0]),
          "content-type": "application/json",
        },
        body: "{}",
      });
      assert.equal(playerApproval.status, 403, "a normal player cannot approve rewards");
      const playerBalance = await pool.query<{ wallet_coins: number }>(
        "SELECT wallet_coins FROM daily007_v2_users WHERE id = $1",
        [ids.players[0]],
      );
      assert.equal(Number(playerBalance.rows[0]?.wallet_coins), 0);

      const completedResponse = await fetch(`${origin}/admin/kill-earn/matches`, {
        headers: { authorization: authorization(ids.admin) },
      });
      assert.equal(completedResponse.status, 200, "a tournament admin can load completed matches");

      const payoutResponse = await fetch(`${origin}/admin/kill-earn/rewards/${firstRewardId}/approve`, {
        method: "POST",
        headers: {
          authorization: authorization(ids.admin),
          "content-type": "application/json",
        },
        body: "{}",
      });
      assert.equal(payoutResponse.status, 200);
      const payoutBody = await payoutResponse.json() as {
        data: Awaited<ReturnType<typeof approveKillEarnReward>>["reward"];
      };
      firstPayout = payoutBody.data;
      assert.equal(firstPayout.status, "credited");
      assert.equal(firstPayout.rewardCoins, 40);

      const duplicateResponse = await fetch(`${origin}/admin/kill-earn/rewards/${firstRewardId}/approve`, {
        method: "POST",
        headers: {
          authorization: authorization(ids.admin),
          "content-type": "application/json",
        },
        body: "{}",
      });
      assert.equal(duplicateResponse.status, 409);
      const duplicateBody = await duplicateResponse.json() as { error?: string };
      assert.equal(duplicateBody.error, "Reward Already Credited");
    });
    assert.ok(firstPayout);

    const concurrent = await Promise.all([
      transaction((client) => approveKillEarnReward(client, secondSaved.id, ids.admin)),
      transaction((client) => approveKillEarnReward(client, secondSaved.id, ids.admin)),
    ]);
    assert.equal(concurrent.filter((result) => result.kind === "credited").length, 1);
    assert.equal(concurrent.filter((result) => result.kind === "already_credited").length, 1);

    const rejected = await transaction((client) =>
      rejectKillEarnReward(client, thirdSaved.id, ids.admin, "Kill evidence could not be verified."),
    );
    assert.equal(rejected.status, "rejected");
    assert.equal(rejected.rejectionReason, "Kill evidence could not be verified.");

    const balances = await pool.query<{ id: string; wallet_coins: number }>(
      "SELECT id, wallet_coins FROM daily007_v2_users WHERE id = ANY($1::uuid[])",
      [ids.players],
    );
    const balanceById = new Map(balances.rows.map((row) => [row.id, Number(row.wallet_coins)]));
    assert.equal(balanceById.get(ids.players[0]), 40);
    assert.equal(balanceById.get(ids.players[1]), 25);
    assert.equal(balanceById.get(ids.players[2]), 0);

    const ledger = await pool.query<{
      user_id: string;
      amount: number;
      reason: string;
      details: Record<string, unknown>;
      idempotency_key: string;
    }>(
      "SELECT user_id, amount, reason, details, idempotency_key FROM daily007_v2_wallet_ledger ORDER BY user_id",
    );
    assert.equal(ledger.rows.length, 2, "duplicate approvals must not add another ledger row");
    const firstLedger = ledger.rows.find((row) => row.user_id === ids.players[0]);
    assert.ok(firstLedger);
    assert.equal(Number(firstLedger.amount), 40);
    assert.equal(firstLedger.reason, "battle_royale_kill_earn_reward");
    assert.equal(firstLedger.details.description, "Battle Royale Kill & Earn Reward");
    assert.equal(firstLedger.details.tournamentId, ids.match);
    assert.equal(firstLedger.details.playerId, ids.players[0]);
    assert.equal(firstLedger.details.verifiedKills, 8);
    assert.equal(firstLedger.details.rewardPerKill, 5);
    assert.equal(firstLedger.details.creditedAmount, 40);
    assert.equal(firstLedger.details.adminId, ids.admin);
    assert.ok(firstLedger.idempotency_key.includes(ids.match));

    const creditedHistory = await listKillEarnRewardHistory(pool, {
      tournament: "Kill & Earn Duo QA",
      player: "UID-ONE",
      status: "credited",
    });
    assert.equal(creditedHistory.length, 1);
    assert.equal(creditedHistory[0]?.walletTransactionId, firstPayout.walletTransactionId);

    const todayIst = new Intl.DateTimeFormat("en-CA", {
      timeZone: "Asia/Kolkata",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    }).format(new Date());
    const todayHistory = await listKillEarnRewardHistory(pool, {
      fromDate: todayIst,
      toDate: todayIst,
    });
    assert.equal(todayHistory.length, 3);

    await pool.query("DELETE FROM daily007_v2_matches WHERE id = $1", [ids.match]);
    const retainedHistory = await listKillEarnRewardHistory(pool, { tournament: ids.match });
    assert.equal(retainedHistory.length, 3, "reward snapshots remain after tournament/registration cleanup");
    assert.equal(retainedHistory[0]?.tournamentName, "Kill & Earn Duo QA");
  } finally {
    await pool.end();
    if (previousAuthSecret === undefined) delete process.env.DAILY007_AUTH_SECRET;
    else process.env.DAILY007_AUTH_SECRET = previousAuthSecret;
  }
});
