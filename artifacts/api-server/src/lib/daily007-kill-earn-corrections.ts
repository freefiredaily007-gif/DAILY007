import { randomUUID } from "node:crypto";

export type KillEarnCorrectionClient = {
  query<T = unknown>(sql: string, values?: unknown[]): Promise<{ rows: T[] }>;
};

const MAX_VERIFIED_KILLS = 47;
const MAX_REWARD_PER_KILL = 100;
const MAX_INT = 2_147_483_647;

type MatchRow = {
  id: string;
  title: string;
  game_mode: string;
  enabled: boolean;
  status: string;
  has_winner: boolean;
};

type CorrectionRow = {
  id: string;
  request_id: string;
  match_id: string;
  registration_id: string;
  user_id: string;
  previous_kills: number;
  corrected_kills: number;
  reward_per_kill: number;
  coin_delta: number;
  reason: string;
  admin_id: string;
  ledger_id: string;
  created_at: Date | string;
  balance_after?: number;
  admin_name?: string | null;
};

function httpError(status: number, message: string): Error & { status: number } {
  return Object.assign(new Error(message), { status });
}

function serializeCorrection(row: CorrectionRow, alreadyApplied = false) {
  return {
    id: row.id,
    requestId: row.request_id,
    matchId: row.match_id,
    registrationId: row.registration_id,
    userId: row.user_id,
    previousKills: Number(row.previous_kills),
    correctedKills: Number(row.corrected_kills),
    rewardPerKill: Number(row.reward_per_kill),
    coinDelta: Number(row.coin_delta),
    reason: row.reason,
    adminId: row.admin_id,
    adminName: row.admin_name ?? null,
    ledgerId: row.ledger_id,
    balanceAfter: row.balance_after === undefined ? undefined : Number(row.balance_after),
    createdAt: row.created_at instanceof Date ? row.created_at.toISOString() : new Date(row.created_at).toISOString(),
    alreadyApplied,
  };
}

async function loadCompletedKillEarnMatch(
  client: KillEarnCorrectionClient,
  matchId: string,
  lock: boolean,
): Promise<MatchRow> {
  const result = await client.query<MatchRow>(
    `SELECT match.id, match.title, match.game_mode, match.enabled, match.status,
            EXISTS (
              SELECT 1 FROM daily007_v2_result_awards award
               WHERE award.match_id = match.id AND award.rank = 1
            ) AS has_winner
       FROM daily007_v2_matches match
      WHERE match.id = $1
      ${lock ? "FOR UPDATE" : ""}`,
    [matchId],
  );
  const match = result.rows[0];
  if (!match) throw httpError(404, "Tournament not found.");
  if (match.game_mode !== "battle_royale_kill_earn") {
    throw httpError(409, "Corrections are only available for Kill & Earn tournaments.");
  }
  if (match.enabled || match.status === "cancelled" || !match.has_winner) {
    throw httpError(409, "Kill & Earn results can only be corrected after the tournament is completed.");
  }
  return match;
}

export async function listKillEarnCorrections(
  client: KillEarnCorrectionClient,
  matchId: string,
) {
  const match = await loadCompletedKillEarnMatch(client, matchId, false);
  const playersResult = await client.query<{
    registration_id: string;
    user_id: string;
    player_name: string;
    player_uid: string;
    current_kills: number;
    original_kills: number | null;
    reward_per_kill: number | null;
    original_reward_coins: number | null;
    reward_status: string | null;
    can_correct: boolean;
  }>(
    `SELECT award.registration_id, award.user_id,
            COALESCE(reward.player_name, registration.captain_game_name, registration.captain_name) AS player_name,
            COALESCE(reward.player_uid, registration.captain_game_uid) AS player_uid,
            award.kills AS current_kills,
            COALESCE(first_correction.previous_kills,
                     NULLIF(kill_credit.details->>'kills', '')::int,
                     reward.verified_kills, award.kills) AS original_kills,
            COALESCE(first_correction.reward_per_kill,
                     NULLIF(kill_credit.details->>'coinsPerKill', '')::int,
                     reward.reward_per_kill, match.kill_reward_coins) AS reward_per_kill,
            COALESCE(kill_credit.amount, reward.reward_coins) AS original_reward_coins,
            COALESCE(reward.status, CASE WHEN kill_credit.id IS NOT NULL THEN 'credited' END) AS reward_status,
            (
              kill_credit.id IS NOT NULL OR reward_credit.id IS NOT NULL
              OR (reward.status = 'approved' AND reward.reward_coins = 0)
              OR (reward.id IS NULL AND (award.kills = 0 OR match.kill_reward_coins = 0))
            ) AS can_correct
       FROM daily007_v2_result_awards award
       JOIN daily007_v2_registrations registration
         ON registration.id = award.registration_id
       JOIN daily007_v2_matches match ON match.id = award.match_id
       LEFT JOIN daily007_v2_kill_earn_rewards reward
         ON reward.match_id = award.match_id
        AND reward.registration_id = award.registration_id
        AND reward.user_id = award.user_id
       LEFT JOIN daily007_v2_wallet_ledger kill_credit
         ON kill_credit.match_id = award.match_id
        AND kill_credit.registration_id = award.registration_id
        AND kill_credit.user_id = award.user_id
        AND kill_credit.reason = 'kill_reward'
       LEFT JOIN daily007_v2_wallet_ledger reward_credit
         ON reward_credit.id = reward.wallet_ledger_id
       LEFT JOIN LATERAL (
         SELECT correction.previous_kills, correction.reward_per_kill
           FROM daily007_v2_kill_earn_corrections correction
          WHERE correction.match_id = award.match_id
            AND correction.registration_id = award.registration_id
          ORDER BY correction.created_at, correction.id
          LIMIT 1
       ) first_correction ON true
      WHERE award.match_id = $1
      ORDER BY award.rank, player_name, award.registration_id`,
    [matchId],
  );
  const correctionsResult = await client.query<CorrectionRow>(
    `SELECT correction.id, correction.request_id, correction.match_id,
            correction.registration_id, correction.user_id,
            correction.previous_kills, correction.corrected_kills,
            correction.reward_per_kill, correction.coin_delta, correction.reason,
            correction.admin_id, correction.ledger_id, correction.created_at,
            ledger.balance_after, admin.name AS admin_name
       FROM daily007_v2_kill_earn_corrections correction
       LEFT JOIN daily007_v2_wallet_ledger ledger ON ledger.id = correction.ledger_id
       LEFT JOIN daily007_v2_users admin ON admin.id = correction.admin_id
      WHERE correction.match_id = $1
      ORDER BY correction.created_at, correction.id`,
    [matchId],
  );
  const history = new Map<string, ReturnType<typeof serializeCorrection>[]>();
  for (const row of correctionsResult.rows) {
    const entries = history.get(row.registration_id) ?? [];
    entries.push(serializeCorrection(row));
    history.set(row.registration_id, entries);
  }
  return {
    matchId: match.id,
    tournamentName: match.title,
    players: playersResult.rows.map((row) => ({
      registrationId: row.registration_id,
      userId: row.user_id,
      playerName: row.player_name,
      playerUid: row.player_uid,
      currentKills: Number(row.current_kills),
      originalKills: row.original_kills === null ? null : Number(row.original_kills),
      rewardPerKill: row.reward_per_kill === null ? null : Number(row.reward_per_kill),
      originalRewardCoins: row.original_reward_coins === null ? null : Number(row.original_reward_coins),
      rewardStatus: row.reward_status,
      canCorrect: row.can_correct,
      corrections: history.get(row.registration_id) ?? [],
    })),
  };
}

export async function correctKillEarnResult(
  client: KillEarnCorrectionClient,
  input: {
    matchId: string;
    registrationId: string;
    correctedKills: number;
    reason: string;
    requestId: string;
    adminId: string;
  },
) {
  const reason = input.reason.trim();
  if (reason.length < 3 || reason.length > 500) {
    throw httpError(400, "Correction reason and evidence review notes must contain 3–500 characters.");
  }
  if (!Number.isSafeInteger(input.correctedKills) ||
      input.correctedKills < 0 || input.correctedKills > MAX_VERIFIED_KILLS) {
    throw httpError(400, `Corrected kills must be a whole number from 0 to ${MAX_VERIFIED_KILLS}.`);
  }

  await client.query(
    "SELECT pg_advisory_xact_lock(hashtextextended($1, 0))",
    [`daily007-kill-earn-correction:${input.requestId}`],
  );
  const priorResult = await client.query<CorrectionRow>(
    `SELECT correction.id, correction.request_id, correction.match_id,
            correction.registration_id, correction.user_id,
            correction.previous_kills, correction.corrected_kills,
            correction.reward_per_kill, correction.coin_delta, correction.reason,
            correction.admin_id, correction.ledger_id, correction.created_at,
            ledger.balance_after, admin.name AS admin_name
       FROM daily007_v2_kill_earn_corrections correction
       LEFT JOIN daily007_v2_wallet_ledger ledger ON ledger.id = correction.ledger_id
       LEFT JOIN daily007_v2_users admin ON admin.id = correction.admin_id
      WHERE correction.request_id = $1
      FOR UPDATE OF correction`,
    [input.requestId],
  );
  const prior = priorResult.rows[0];
  if (prior) {
    if (
      prior.match_id !== input.matchId ||
      prior.registration_id !== input.registrationId ||
      prior.admin_id !== input.adminId ||
      Number(prior.corrected_kills) !== input.correctedKills ||
      prior.reason !== reason
    ) {
      throw httpError(409, "This correction request ID was already used for a different correction.");
    }
    return serializeCorrection(prior, true);
  }

  const match = await loadCompletedKillEarnMatch(client, input.matchId, true);
  const awardResult = await client.query<{
    user_id: string;
    current_kills: number;
    match_reward_rate: number;
  }>(
    `SELECT award.user_id, award.kills AS current_kills,
            match.kill_reward_coins AS match_reward_rate
       FROM daily007_v2_result_awards award
       JOIN daily007_v2_matches match ON match.id = award.match_id
       JOIN daily007_v2_users player ON player.id = award.user_id
      WHERE award.match_id = $1 AND award.registration_id = $2
      FOR UPDATE OF award, player`,
    [input.matchId, input.registrationId],
  );
  const award = awardResult.rows[0];
  if (!award) throw httpError(404, "A published Kill & Earn result was not found for this player.");
  const previousKills = Number(award.current_kills);
  if (!Number.isSafeInteger(previousKills) || previousKills < 0 || previousKills > MAX_VERIFIED_KILLS) {
    throw httpError(409, "The published Kill & Earn result is invalid.");
  }
  if (input.correctedKills === previousKills) {
    throw httpError(409, "The corrected kill count must differ from the currently published count.");
  }
  const rewardResult = await client.query<{
    verified_kills: number;
    reward_per_kill: number;
    reward_coins: number;
    status: string;
    wallet_ledger_id: string | null;
  }>(
    `SELECT verified_kills, reward_per_kill, reward_coins, status, wallet_ledger_id
       FROM daily007_v2_kill_earn_rewards
      WHERE match_id = $1 AND registration_id = $2 AND user_id = $3
      FOR UPDATE`,
    [input.matchId, input.registrationId, award.user_id],
  );
  const reward = rewardResult.rows[0];
  const killCreditResult = await client.query<{
    id: string;
    user_id: string;
    match_id: string | null;
    registration_id: string | null;
    amount: number;
    details: Record<string, unknown> | null;
  }>(
    `SELECT id, user_id, match_id, registration_id, amount, details
       FROM daily007_v2_wallet_ledger
      WHERE match_id = $1 AND registration_id = $2 AND user_id = $3
        AND reason = 'kill_reward'
      FOR UPDATE`,
    [input.matchId, input.registrationId, award.user_id],
  );
  const killCredit = killCreditResult.rows[0] ?? null;
  let rewardCredit: {
    id: string;
    user_id: string;
    match_id: string | null;
    registration_id: string | null;
    amount: number;
  } | null = null;
  if (reward?.wallet_ledger_id) {
    const rewardCreditResult = await client.query<{
      id: string;
      user_id: string;
      match_id: string | null;
      registration_id: string | null;
      amount: number;
    }>(
      `SELECT id, user_id, match_id, registration_id, amount
         FROM daily007_v2_wallet_ledger
        WHERE id = $1
        FOR UPDATE`,
      [reward.wallet_ledger_id],
    );
    rewardCredit = rewardCreditResult.rows[0] ?? null;
  }
  const correctionHistory = await client.query<{
    previous_kills: number;
    corrected_kills: number;
    reward_per_kill: number;
  }>(
    `SELECT previous_kills, corrected_kills, reward_per_kill
       FROM daily007_v2_kill_earn_corrections
      WHERE match_id = $1 AND registration_id = $2
      ORDER BY created_at DESC, id DESC
      LIMIT 1`,
    [input.matchId, input.registrationId],
  );
  const latestCorrection = correctionHistory.rows[0] ?? null;
  if (latestCorrection && Number(latestCorrection.corrected_kills) !== previousKills) {
    throw httpError(409, "The current result does not match the latest correction audit record.");
  }
  let rewardPerKill: number;
  if (killCredit) {
    const details = killCredit.details ?? {};
    const originalKills = Number(details.kills);
    const originalRate = Number(details.coinsPerKill);
    if (
      killCredit.user_id !== award.user_id ||
      killCredit.match_id !== input.matchId ||
      killCredit.registration_id !== input.registrationId ||
      !Number.isSafeInteger(originalKills) || originalKills < 0 || originalKills > MAX_VERIFIED_KILLS ||
      !Number.isSafeInteger(originalRate) || originalRate < 0 || originalRate > MAX_REWARD_PER_KILL ||
      Number(killCredit.amount) !== originalKills * originalRate ||
      (!latestCorrection && originalKills !== previousKills) ||
      (latestCorrection && Number(latestCorrection.reward_per_kill) !== originalRate)
    ) {
      throw httpError(409, "The original Kill & Earn wallet credit could not be verified.");
    }
    rewardPerKill = latestCorrection
      ? Number(latestCorrection.reward_per_kill)
      : originalRate;
  } else if (reward?.status === "credited") {
    if (
      !rewardCredit ||
      rewardCredit.user_id !== award.user_id ||
      rewardCredit.match_id !== input.matchId ||
      rewardCredit.registration_id !== input.registrationId ||
      Number(rewardCredit.amount) !== Number(reward.reward_coins) ||
      (!latestCorrection && Number(reward.verified_kills) !== previousKills) ||
      (latestCorrection && Number(latestCorrection.reward_per_kill) !== Number(reward.reward_per_kill))
    ) {
      throw httpError(409, "The original Kill & Earn wallet credit does not match the saved reward. No correction was applied.");
    }
    rewardPerKill = latestCorrection
      ? Number(latestCorrection.reward_per_kill)
      : Number(reward.reward_per_kill);
  } else if (
    reward?.status === "approved" &&
    Number(reward.reward_coins) === 0 &&
    (!latestCorrection ? Number(reward.verified_kills) === previousKills : true) &&
    (!latestCorrection || Number(latestCorrection.reward_per_kill) === Number(reward.reward_per_kill))
  ) {
    rewardPerKill = latestCorrection
      ? Number(latestCorrection.reward_per_kill)
      : Number(reward.reward_per_kill);
  } else if (!reward && (previousKills === 0 || Number(award.match_reward_rate) === 0)) {
    rewardPerKill = latestCorrection
      ? Number(latestCorrection.reward_per_kill)
      : Number(award.match_reward_rate);
  } else {
    throw httpError(409, "The original Kill & Earn payout could not be verified. No correction was applied.");
  }
  if (!Number.isSafeInteger(rewardPerKill) || rewardPerKill < 0 || rewardPerKill > MAX_REWARD_PER_KILL) {
    throw httpError(409, "The saved per-kill reward rate is invalid.");
  }

  const coinDelta = (input.correctedKills - previousKills) * rewardPerKill;
  if (!Number.isSafeInteger(coinDelta) || Math.abs(coinDelta) > MAX_INT) {
    throw httpError(409, "The calculated wallet adjustment is outside the supported coin range.");
  }
  const userResult = await client.query<{ wallet_coins: number }>(
    "SELECT wallet_coins FROM daily007_v2_users WHERE id = $1 FOR UPDATE",
    [award.user_id],
  );
  const oldBalance = Number(userResult.rows[0]?.wallet_coins);
  const balanceAfter = oldBalance + coinDelta;
  if (!Number.isSafeInteger(balanceAfter) || balanceAfter < 0 || balanceAfter > MAX_INT) {
    throw httpError(409, balanceAfter < 0
      ? "This correction would make the player's wallet negative. No changes were made."
      : "This correction would exceed the player's supported wallet balance. No changes were made.");
  }
  const statsResult = await client.query<{ kills: number }>(
    "SELECT kills FROM daily007_v2_user_stats WHERE user_id = $1 FOR UPDATE",
    [award.user_id],
  );
  const currentLifetimeKills = Number(statsResult.rows[0]?.kills);
  const lifetimeKillsAfter = currentLifetimeKills + input.correctedKills - previousKills;
  if (
    !Number.isSafeInteger(currentLifetimeKills) ||
    !Number.isSafeInteger(lifetimeKillsAfter) ||
    lifetimeKillsAfter < 0 ||
    lifetimeKillsAfter > MAX_INT
  ) {
    throw httpError(409, "This correction would make the player's lifetime kill total inconsistent. No changes were made.");
  }

  const correctionId = randomUUID();
  const ledgerResult = await client.query<{ id: string }>(
    `INSERT INTO daily007_v2_wallet_ledger
       (user_id, amount, balance_after, reason, match_id, registration_id, idempotency_key, details)
     VALUES ($1, $2, $3, 'kill_earn_correction', $4, $5, $6, $7::jsonb)
     RETURNING id`,
    [
      award.user_id,
      coinDelta,
      balanceAfter,
      input.matchId,
      input.registrationId,
      `daily007-kill-earn-correction:${input.requestId}`,
      JSON.stringify({
        correctionId,
        description: `Kill & Earn correction — ${match.title}; verified kills ${previousKills} to ${input.correctedKills}. Reason: ${reason}`,
        tournamentTitle: match.title,
        previousKills,
        correctedKills: input.correctedKills,
        rewardPerKill,
        coinDelta,
        reason,
        adminId: input.adminId,
      }),
    ],
  );
  const ledgerId = ledgerResult.rows[0]?.id;
  if (!ledgerId) throw new Error("The wallet adjustment could not be recorded.");

  await client.query(
    "UPDATE daily007_v2_users SET wallet_coins = $2 WHERE id = $1",
    [award.user_id, balanceAfter],
  );
  await client.query(
    "UPDATE daily007_v2_result_awards SET kills = $3 WHERE match_id = $1 AND registration_id = $2",
    [input.matchId, input.registrationId, input.correctedKills],
  );
  await client.query(
    "UPDATE daily007_v2_user_stats SET kills = $2 WHERE user_id = $1",
    [award.user_id, lifetimeKillsAfter],
  );
  const inserted = await client.query<CorrectionRow>(
    `INSERT INTO daily007_v2_kill_earn_corrections
       (id, request_id, match_id, registration_id, user_id, previous_kills,
        corrected_kills, reward_per_kill, coin_delta, reason, admin_id, ledger_id)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
     RETURNING id, request_id, match_id, registration_id, user_id,
               previous_kills, corrected_kills, reward_per_kill, coin_delta,
               reason, admin_id, ledger_id, created_at`,
    [
      correctionId,
      input.requestId,
      input.matchId,
      input.registrationId,
      award.user_id,
      previousKills,
      input.correctedKills,
      rewardPerKill,
      coinDelta,
      reason,
      input.adminId,
      ledgerId,
    ],
  );
  const row = inserted.rows[0];
  if (!row) throw new Error("The correction audit record could not be saved.");
  row.balance_after = balanceAfter;
  return serializeCorrection(row);
}
