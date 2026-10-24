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
  fullAdmin: randomUUID(),
  match: randomUUID(),
  pendingMatch: randomUUID(),
  players: [randomUUID(), randomUUID(), randomUUID()],
  registrations: [randomUUID(), randomUUID(), randomUUID()],
};
const evidenceReferences = [
  "https://proof.daily007.example/match/duo-player-one",
  "https://proof.daily007.example/match/duo-player-two",
  "https://proof.daily007.example/match/duo-player-three",
];
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
         ($2, 'Correction Full Admin', 'correction-admin@example.test', 'admin', 'active', 0),
         ($3, 'Player One', 'reward-player-one@example.test', 'user', 'active', 0),
         ($4, 'Player Two', 'reward-player-two@example.test', 'user', 'active', 0),
         ($5, 'Player Three', 'reward-player-three@example.test', 'user', 'active', 0)`,
      [ids.admin, ids.fullAdmin, ...ids.players],
    );
    await pool.query(
      `INSERT INTO daily007_v2_user_stats (user_id, matches, wins, kills, prize_coins)
       SELECT id, 0, 0, 0, 0 FROM daily007_v2_users WHERE id = ANY($1::uuid[])`,
      [ids.players],
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
      saveKillEarnKills(client, ids.match, ids.registrations[0], 8, evidenceReferences[0]),
    );
    const secondSaved = await transaction((client) =>
      saveKillEarnKills(client, ids.match, ids.registrations[1], 4, evidenceReferences[1]),
    );
    const thirdSaved = await transaction((client) =>
      saveKillEarnKills(client, ids.match, ids.registrations[2], 2),
    );
    assert.equal(firstSaved.rewardCoins, 40);
    assert.equal(firstSaved.rewardPerKill, 5);
    assert.equal(firstSaved.evidenceReference, evidenceReferences[0]);
    assert.equal(secondSaved.rewardCoins, 20);
    assert.equal(thirdSaved.rewardCoins, 10);
    assert.equal(thirdSaved.evidenceReference, null);

    const participantsWithEvidence = await listKillEarnParticipants(pool, ids.match);
    assert.equal(participantsWithEvidence[0]?.playerUid, "UID-ONE");
    assert.equal(participantsWithEvidence[0]?.evidenceReference, evidenceReferences[0]);
    assert.equal(participantsWithEvidence[2]?.evidenceReference, null);

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
    await assert.rejects(
      transaction((client) => saveKillEarnKills(
        client,
        ids.match,
        ids.registrations[2],
        2,
        "http://proof.daily007.example/match/unsafe",
      )),
      /valid HTTPS URL/,
    );
    await assert.rejects(
      transaction((client) => approveKillEarnReward(client, thirdSaved.id, ids.admin)),
      /evidence link before approving/,
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

      const missingEvidenceApproval = await fetch(
        `${origin}/admin/kill-earn/rewards/${thirdSaved.id}/approve`,
        {
          method: "POST",
          headers: {
            authorization: authorization(ids.admin),
            "content-type": "application/json",
          },
          body: "{}",
        },
      );
      assert.equal(missingEvidenceApproval.status, 409);
      const missingEvidenceBody = await missingEvidenceApproval.json() as { error?: string };
      assert.match(missingEvidenceBody.error ?? "", /evidence link before approving/i);

      const saveEvidenceResponse = await fetch(
        `${origin}/admin/kill-earn/matches/${ids.match}/participants/${ids.registrations[2]}/kills`,
        {
          method: "PUT",
          headers: {
            authorization: authorization(ids.admin),
            "content-type": "application/json",
          },
          body: JSON.stringify({
            verifiedKills: 2,
            evidenceReference: evidenceReferences[2],
          }),
        },
      );
      assert.equal(saveEvidenceResponse.status, 200);
      const savedEvidenceBody = await saveEvidenceResponse.json() as {
        data: Awaited<ReturnType<typeof approveKillEarnReward>>["reward"];
      };
      assert.equal(savedEvidenceBody.data.evidenceReference, evidenceReferences[2]);

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

    await pool.query(
      `UPDATE daily007_v2_result_awards SET kills = 8
        WHERE match_id = $1 AND registration_id = $2`,
      [ids.match, ids.registrations[0]],
    );
    await pool.query(
      "UPDATE daily007_v2_user_stats SET kills = 8 WHERE user_id = $1",
      [ids.players[0]],
    );
    await pool.query(
      `INSERT INTO daily007_v2_result_awards
         (id, match_id, registration_id, user_id, rank, kills, prize_coins)
       VALUES ($1, $2, $3, $4, 2, 2, 0)`,
      [randomUUID(), ids.match, ids.registrations[2], ids.players[2]],
    );
    await pool.query(
      "UPDATE daily007_v2_user_stats SET kills = 2 WHERE user_id = $1",
      [ids.players[2]],
    );
    await pool.query(
      `INSERT INTO daily007_v2_wallet_ledger
         (user_id, amount, balance_after, reason, match_id, registration_id, idempotency_key, details)
       VALUES ($1, 10, 10, 'kill_reward', $2, $3, $4, $5::jsonb)`,
      [
        ids.players[2],
        ids.match,
        ids.registrations[2],
        `kill_reward:${ids.match}:${ids.registrations[2]}`,
        JSON.stringify({
          kills: 2,
          coinsPerKill: 5,
          description: "Kill & Earn reward - Kill & Earn Duo QA",
        }),
      ],
    );
    await pool.query(
      "UPDATE daily007_v2_users SET wallet_coins = 10 WHERE id = $1",
      [ids.players[2]],
    );
    await withServer(async (origin) => {
      const tournamentAdminHistory = await fetch(
        `${origin}/admin/kill-earn/matches/${ids.match}/corrections`,
        { headers: { authorization: authorization(ids.admin) } },
      );
      assert.equal(tournamentAdminHistory.status, 403, "Tournament Admins cannot view Full Admin corrections");

      const fullAdminHistory = await fetch(
        `${origin}/admin/kill-earn/matches/${ids.match}/corrections`,
        { headers: { authorization: authorization(ids.fullAdmin) } },
      );
      assert.equal(fullAdminHistory.status, 200);
      const initialAudit = await fullAdminHistory.json() as {
        data: { players: Array<{ registrationId: string; currentKills: number; canCorrect: boolean }> };
      };
      const firstPlayerAudit = initialAudit.data.players.find((player) => player.registrationId === ids.registrations[0]);
      assert.equal(firstPlayerAudit?.currentKills, 8);
      assert.equal(firstPlayerAudit?.canCorrect, true);

      const requestId = randomUUID();
      const correctionRequest = () => fetch(
        `${origin}/admin/kill-earn/matches/${ids.match}/corrections`,
        {
          method: "POST",
          headers: {
            authorization: authorization(ids.fullAdmin),
            "content-type": "application/json",
          },
          body: JSON.stringify({
            registrationId: ids.registrations[0],
            correctedKills: 10,
            reason: "Reviewed match-end screenshot and confirmed UID-ONE; corrected total is 10.",
            requestId,
          }),
        },
      );
      const duplicateResponses = await Promise.all([correctionRequest(), correctionRequest()]);
      assert.deepEqual(duplicateResponses.map((response) => response.status), [200, 200]);
      const duplicateBodies = await Promise.all(duplicateResponses.map((response) => response.json())) as Array<{
        data: { alreadyApplied: boolean; coinDelta: number; ledgerId: string };
      }>;
      assert.deepEqual(
        duplicateBodies.map((body) => body.data.alreadyApplied).sort(),
        [false, true],
        "a concurrent retry shares one correction outcome",
      );
      assert.equal(duplicateBodies[0]?.data.ledgerId, duplicateBodies[1]?.data.ledgerId);
      assert.equal(duplicateBodies[0]?.data.coinDelta, 10);

      const playerTransactions = await fetch(`${origin}/wallet/transactions`, {
        headers: { authorization: authorization(ids.players[0]) },
      });
      assert.equal(playerTransactions.status, 200);
      const transactionRows = await playerTransactions.json() as Array<{
        reason: string;
        amount: number;
        description: string;
      }>;
      const correctionTransaction = transactionRows.find((entry) => entry.reason === "kill_earn_correction");
      assert.equal(correctionTransaction?.amount, 10);
      assert.match(correctionTransaction?.description ?? "", /Reviewed match-end screenshot and confirmed UID-ONE/);

      const walletBeforeFailure = await pool.query<{ wallet_coins: number }>(
        "SELECT wallet_coins FROM daily007_v2_users WHERE id = $1",
        [ids.players[0]],
      );
      assert.equal(Number(walletBeforeFailure.rows[0]?.wallet_coins), 50);
      const countBeforeFailure = await pool.query<{ count: number }>(
        "SELECT count(*)::int AS count FROM daily007_v2_kill_earn_corrections WHERE match_id = $1",
        [ids.match],
      );
      assert.equal(Number(countBeforeFailure.rows[0]?.count), 1);

      const finalAuditResponse = await fetch(
        `${origin}/admin/kill-earn/matches/${ids.match}/corrections`,
        { headers: { authorization: authorization(ids.fullAdmin) } },
      );
      const finalAudit = await finalAuditResponse.json() as {
        data: { players: Array<{ registrationId: string; currentKills: number; corrections: Array<{ adminName: string | null; reason: string; ledgerId: string }> }> };
      };
      const correctedPlayer = finalAudit.data.players.find((player) => player.registrationId === ids.registrations[0]);
      assert.equal(correctedPlayer?.currentKills, 10);
      assert.equal(correctedPlayer?.corrections.length, 1);
      assert.equal(correctedPlayer?.corrections[0]?.adminName, "Correction Full Admin");
      assert.equal(correctedPlayer?.corrections[0]?.ledgerId, duplicateBodies[0]?.data.ledgerId);
      assert.match(correctedPlayer?.corrections[0]?.reason ?? "", /UID-ONE/);

      const primaryFlowCorrection = await fetch(
        `${origin}/admin/kill-earn/matches/${ids.match}/corrections`,
        {
          method: "POST",
          headers: {
            authorization: authorization(ids.fullAdmin),
            "content-type": "application/json",
          },
          body: JSON.stringify({
            registrationId: ids.registrations[2],
            correctedKills: 3,
            reason: "Reviewed match-end recording for UID-THREE; count is three.",
            requestId: randomUUID(),
          }),
        },
      );
      assert.equal(primaryFlowCorrection.status, 200);
      const primaryFlowBody = await primaryFlowCorrection.json() as {
        data: { previousKills: number; correctedKills: number; coinDelta: number };
      };
      assert.equal(primaryFlowBody.data.previousKills, 2);
      assert.equal(primaryFlowBody.data.correctedKills, 3);
      assert.equal(primaryFlowBody.data.coinDelta, 5);
      const correctedStats = await pool.query<{ kills: number; wallet_coins: number }>(
        `SELECT stats.kills, player.wallet_coins
           FROM daily007_v2_user_stats stats
           JOIN daily007_v2_users player ON player.id = stats.user_id
          WHERE stats.user_id = $1`,
        [ids.players[2]],
      );
      assert.equal(Number(correctedStats.rows[0]?.kills), 3);
      assert.equal(Number(correctedStats.rows[0]?.wallet_coins), 15);

      await pool.query(
        "UPDATE daily007_v2_users SET wallet_coins = 0 WHERE id = $1",
        [ids.players[0]],
      );
      const insufficientBalance = await fetch(
        `${origin}/admin/kill-earn/matches/${ids.match}/corrections`,
        {
          method: "POST",
          headers: {
            authorization: authorization(ids.fullAdmin),
            "content-type": "application/json",
          },
          body: JSON.stringify({
            registrationId: ids.registrations[0],
            correctedKills: 5,
            reason: "Reviewed match-end recording; lowering the count to five.",
            requestId: randomUUID(),
          }),
        },
      );
      assert.equal(insufficientBalance.status, 409);
      const stateAfterFailure = await pool.query<{ kills: number; wallet_coins: number; corrections: number }>(
        `SELECT award.kills,
                player.wallet_coins,
                (SELECT count(*)::int FROM daily007_v2_kill_earn_corrections correction
                  WHERE correction.match_id = award.match_id
                    AND correction.registration_id = award.registration_id) AS corrections
           FROM daily007_v2_result_awards award
           JOIN daily007_v2_users player ON player.id = award.user_id
          WHERE award.match_id = $1 AND award.registration_id = $2`,
        [ids.match, ids.registrations[0]],
      );
      assert.equal(Number(stateAfterFailure.rows[0]?.kills), 10);
      assert.equal(Number(stateAfterFailure.rows[0]?.wallet_coins), 0);
      assert.equal(Number(stateAfterFailure.rows[0]?.corrections), 1);
      await pool.query(
        "UPDATE daily007_v2_users SET wallet_coins = 50 WHERE id = $1",
        [ids.players[0]],
      );
    });

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
    assert.equal(balanceById.get(ids.players[0]), 50);
    assert.equal(balanceById.get(ids.players[1]), 25);
    assert.equal(balanceById.get(ids.players[2]), 15);

    const ledger = await pool.query<{
      user_id: string;
      amount: number;
      reason: string;
      details: Record<string, unknown>;
      idempotency_key: string;
    }>(
      "SELECT user_id, amount, reason, details, idempotency_key FROM daily007_v2_wallet_ledger ORDER BY user_id",
    );
    assert.equal(ledger.rows.length, 5, "duplicate approvals and correction retries must not add duplicate ledger rows");
    const firstLedger = ledger.rows.find((row) =>
      row.user_id === ids.players[0] && row.reason === "battle_royale_kill_earn_reward");
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
    assert.equal(firstLedger.details.evidenceReference, evidenceReferences[0]);
    assert.ok(firstLedger.idempotency_key.includes(ids.match));
    const correctionLedger = ledger.rows.find((row) =>
      row.user_id === ids.players[0] && row.reason === "kill_earn_correction");
    assert.ok(correctionLedger);
    assert.equal(Number(correctionLedger.amount), 10);
    assert.match(String(correctionLedger.details.description), /corrected total is 10/);

    const creditedHistory = await listKillEarnRewardHistory(pool, {
      tournament: "Kill & Earn Duo QA",
      player: "UID-ONE",
      status: "credited",
    });
    assert.equal(creditedHistory.length, 1);
    assert.equal(creditedHistory[0]?.walletTransactionId, firstPayout.walletTransactionId);
    assert.equal(creditedHistory[0]?.evidenceReference, evidenceReferences[0]);

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
    assert.ok(retainedHistory.some((record) => record.evidenceReference === evidenceReferences[0]));
  } finally {
    await pool.end();
    if (previousAuthSecret === undefined) delete process.env.DAILY007_AUTH_SECRET;
    else process.env.DAILY007_AUTH_SECRET = previousAuthSecret;
  }
});
