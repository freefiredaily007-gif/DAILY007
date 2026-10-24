export type KillEarnRewardClient = {
  query<T = unknown>(sql: string, values?: unknown[]): Promise<{ rows: T[] }>;
};

type CompletedMatch = {
  id: string;
  title: string;
  game_mode: string | null;
  team_type: string | null;
  kill_reward_coins: number;
  enabled: boolean;
  status: string;
  starts_at: Date | string;
  has_winner: boolean;
};

type RewardRow = {
  id: string;
  match_id: string;
  registration_id: string;
  user_id: string;
  tournament_name: string;
  submode: "solo" | "duo" | "squad";
  player_name: string;
  player_uid: string;
  verified_kills: number;
  reward_per_kill: number;
  reward_coins: number;
  status: "pending" | "approved" | "rejected" | "credited";
  reviewed_by: string | null;
  reviewed_at: Date | string | null;
  credited_at: Date | string | null;
  wallet_ledger_id: string | null;
  rejection_reason: string | null;
  created_at: Date | string;
};

function httpError(status: number, message: string): Error & { status: number } {
  return Object.assign(new Error(message), { status });
}

function integer(value: unknown): number | null {
  if (value === null || value === undefined || typeof value === "boolean") return null;
  if (typeof value === "string" && value.trim() === "") return null;
  const parsed = typeof value === "number" ? value : Number(value);
  return Number.isSafeInteger(parsed) && parsed >= 0 && parsed <= 2_147_483_647
    ? parsed
    : null;
}

function iso(value: Date | string | null): string | null {
  if (value === null) return null;
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

export function serializeKillEarnReward(row: RewardRow) {
  return {
    id: row.id,
    matchId: row.match_id,
    registrationId: row.registration_id,
    userId: row.user_id,
    tournamentName: row.tournament_name,
    submode: row.submode,
    playerName: row.player_name,
    playerUid: row.player_uid,
    verifiedKills: Number(row.verified_kills),
    rewardPerKill: Number(row.reward_per_kill),
    rewardCoins: Number(row.reward_coins),
    status: row.status,
    reviewedBy: row.reviewed_by,
    reviewedAt: iso(row.reviewed_at),
    creditedAt: iso(row.credited_at),
    walletTransactionId: row.wallet_ledger_id,
    rejectionReason: row.rejection_reason,
    createdAt: iso(row.created_at),
  };
}

async function loadCompletedMatch(
  client: KillEarnRewardClient,
  matchId: string,
  lock: boolean,
): Promise<CompletedMatch> {
  const result = await client.query<CompletedMatch>(
    `SELECT match.id, match.title, match.game_mode, match.team_type,
            match.kill_reward_coins, match.enabled, match.status, match.starts_at,
            EXISTS (
              SELECT 1 FROM daily007_v2_result_awards winner
               WHERE winner.match_id = match.id AND winner.rank = 1
            ) AS has_winner
       FROM daily007_v2_matches match
      WHERE match.id = $1
      ${lock ? "FOR UPDATE" : ""}`,
    [matchId],
  );
  const match = result.rows[0];
  if (!match) throw httpError(404, "Tournament not found.");
  if (match.game_mode !== "battle_royale_kill_earn") {
    throw httpError(409, "Kill & Earn rewards are only available for Kill & Earn tournaments.");
  }
  if (match.enabled || match.status === "cancelled" || !match.has_winner) {
    throw httpError(409, "Kill & Earn rewards can only be managed after the tournament is completed.");
  }
  return match;
}

const REWARD_SELECT = `
  SELECT id, match_id, registration_id, user_id, tournament_name, submode,
         player_name, player_uid, verified_kills, reward_per_kill, reward_coins,
         status, reviewed_by, reviewed_at, credited_at, wallet_ledger_id,
         rejection_reason, created_at
    FROM daily007_v2_kill_earn_rewards`;

async function loadRewardById(
  client: KillEarnRewardClient,
  rewardId: string,
  lock = false,
): Promise<RewardRow> {
  const result = await client.query<RewardRow>(
    `${REWARD_SELECT} WHERE id = $1 ${lock ? "FOR UPDATE" : ""}`,
    [rewardId],
  );
  const reward = result.rows[0];
  if (!reward) throw httpError(404, "Kill & Earn reward was not found.");
  return reward;
}

export async function listCompletedKillEarnMatches(client: KillEarnRewardClient) {
  const result = await client.query<{
    id: string;
    title: string;
    team_type: "solo" | "duo" | "squad";
    starts_at: Date | string;
    kill_reward_coins: number;
    approved_players: number;
  }>(
    `SELECT match.id, match.title, match.team_type,
            match.starts_at, match.kill_reward_coins,
            count(registration.id) FILTER (WHERE registration.status = 'approved')::integer
              AS approved_players
       FROM daily007_v2_matches match
       LEFT JOIN daily007_v2_registrations registration ON registration.match_id = match.id
      WHERE match.game_mode = 'battle_royale_kill_earn'
        AND match.enabled = false
        AND match.status <> 'cancelled'
        AND EXISTS (
          SELECT 1 FROM daily007_v2_result_awards winner
           WHERE winner.match_id = match.id AND winner.rank = 1
        )
      GROUP BY match.id
      ORDER BY match.starts_at DESC, match.id`,
  );
  return result.rows.map((row) => ({
    id: row.id,
    title: row.title,
    submode: row.team_type,
    startsAt: iso(row.starts_at),
    killRewardCoins: Number(row.kill_reward_coins),
    approvedPlayers: Number(row.approved_players),
  }));
}

export type KillEarnRewardHistoryFilters = {
  matchId?: string;
  tournament?: string;
  player?: string;
  fromDate?: string;
  toDate?: string;
  status?: "pending" | "approved" | "rejected" | "credited";
};

export async function listKillEarnRewardHistory(
  client: KillEarnRewardClient,
  filters: KillEarnRewardHistoryFilters,
) {
  const conditions: string[] = [];
  const values: unknown[] = [];
  const add = (condition: (parameter: string) => string, value: unknown) => {
    values.push(value);
    conditions.push(condition(`$${values.length}`));
  };
  if (filters.matchId) add((parameter) => `match_id = ${parameter}::uuid`, filters.matchId);
  if (filters.tournament) {
    const pattern = `%${filters.tournament.replace(/[%_]/g, "\\$&")}%`;
    add((parameter) => `(
      tournament_name ILIKE ${parameter} ESCAPE '\\'
      OR match_id::text ILIKE ${parameter} ESCAPE '\\'
    )`, pattern);
  }
  if (filters.player) {
    const pattern = `%${filters.player.replace(/[%_]/g, "\\$&")}%`;
    add((parameter) => `(
      player_name ILIKE ${parameter} ESCAPE '\\'
      OR player_uid ILIKE ${parameter} ESCAPE '\\'
      OR user_id::text = ${parameter}
      OR tournament_name ILIKE ${parameter} ESCAPE '\\'
    )`, pattern);
  }
  if (filters.fromDate) {
    add((parameter) => `(created_at AT TIME ZONE 'Asia/Kolkata')::date >= ${parameter}::date`, filters.fromDate);
  }
  if (filters.toDate) {
    add((parameter) => `(created_at AT TIME ZONE 'Asia/Kolkata')::date <= ${parameter}::date`, filters.toDate);
  }
  if (filters.status) add((parameter) => `status = ${parameter}`, filters.status);
  const result = await client.query<RewardRow>(
    `${REWARD_SELECT}
      ${conditions.length ? `WHERE ${conditions.join(" AND ")}` : ""}
      ORDER BY created_at DESC, id DESC
      LIMIT 500`,
    values,
  );
  return result.rows.map(serializeKillEarnReward);
}

export async function listKillEarnParticipants(
  client: KillEarnRewardClient,
  matchId: string,
) {
  await loadCompletedKillEarnMatch(client, matchId);
  const result = await client.query<{
    registration_id: string;
    user_id: string;
    player_name: string;
    player_uid: string;
    team_number: number | null;
    match_reward_per_kill: number;
    reward_id: string | null;
    verified_kills: number | null;
    reward_per_kill: number | null;
    reward_coins: number | null;
    status: RewardRow["status"] | null;
    reviewed_by: string | null;
    reviewed_at: Date | string | null;
    credited_at: Date | string | null;
    wallet_ledger_id: string | null;
    rejection_reason: string | null;
  }>(
    `SELECT registration.id AS registration_id,
            registration.captain_user_id AS user_id,
            COALESCE(NULLIF(BTRIM(registration.captain_game_name), ''), registration.captain_name)
              AS player_name,
            registration.captain_game_uid AS player_uid,
            COALESCE(team.team_number, registration.assigned_group_number) AS team_number,
            match.kill_reward_coins AS match_reward_per_kill,
            reward.id AS reward_id,
            reward.verified_kills,
            reward.reward_per_kill,
            reward.reward_coins,
            reward.status,
            reward.reviewed_by,
            reward.reviewed_at,
            reward.credited_at,
            reward.wallet_ledger_id,
            reward.rejection_reason
       FROM daily007_v2_registrations registration
       JOIN daily007_v2_matches match ON match.id = registration.match_id
       LEFT JOIN daily007_v2_squad_team_members member
         ON member.registration_id = registration.id AND member.is_active = true
       LEFT JOIN daily007_v2_squad_teams team ON team.id = member.team_id
       LEFT JOIN daily007_v2_kill_earn_rewards reward
         ON reward.match_id = registration.match_id AND reward.user_id = registration.captain_user_id
      WHERE registration.match_id = $1 AND registration.status = 'approved'
      ORDER BY team_number NULLS LAST, player_name, registration.id`,
    [matchId],
  );
  return result.rows.map((row) => ({
    registrationId: row.registration_id,
    userId: row.user_id,
    playerName: row.player_name,
    playerUid: row.player_uid,
    teamNumber: row.team_number === null ? null : Number(row.team_number),
    verifiedKills: row.verified_kills === null ? null : Number(row.verified_kills),
    rewardPerKill: Number(row.reward_per_kill ?? row.match_reward_per_kill),
    rewardCoins: row.reward_coins === null ? null : Number(row.reward_coins),
    rewardId: row.reward_id,
    status: row.status,
    reviewedBy: row.reviewed_by,
    reviewedAt: iso(row.reviewed_at),
    creditedAt: iso(row.credited_at),
    walletTransactionId: row.wallet_ledger_id,
    rejectionReason: row.rejection_reason,
  }));
}

async function loadCompletedKillEarnMatch(
  client: KillEarnRewardClient,
  matchId: string,
): Promise<CompletedMatch> {
  return loadCompletedMatch(client, matchId, false);
}

export async function saveKillEarnKills(
  client: KillEarnRewardClient,
  matchId: string,
  registrationId: string,
  verifiedKillsInput: unknown,
) {
  const verifiedKills = integer(verifiedKillsInput);
  if (verifiedKills === null) throw httpError(400, "Verified kills must be a non-negative whole number.");

  const match = await loadCompletedMatch(client, matchId, true);
  const registrationResult = await client.query<{
    id: string;
    match_id: string;
    user_id: string;
    player_name: string;
    player_uid: string;
    submode: "solo" | "duo" | "squad";
  }>(
    `SELECT registration.id, registration.match_id,
            registration.captain_user_id AS user_id,
            COALESCE(NULLIF(BTRIM(registration.captain_game_name), ''), registration.captain_name)
              AS player_name,
            registration.captain_game_uid AS player_uid,
            match.team_type AS submode
       FROM daily007_v2_registrations registration
       JOIN daily007_v2_matches match ON match.id = registration.match_id
      WHERE registration.id = $1 AND registration.match_id = $2 AND registration.status = 'approved'
      FOR UPDATE OF registration`,
    [registrationId, matchId],
  );
  const registration = registrationResult.rows[0];
  if (!registration) throw httpError(404, "Approved player registration was not found for this tournament.");
  if (!["solo", "duo", "squad"].includes(registration.submode)) {
    throw httpError(409, "The tournament does not have a valid Kill & Earn submode.");
  }

  const existingResult = await client.query<{
    id: string;
    registration_id: string;
    reward_per_kill: number;
    status: RewardRow["status"];
  }>(
    `SELECT id, registration_id, reward_per_kill, status
       FROM daily007_v2_kill_earn_rewards
      WHERE match_id = $1 AND user_id = $2
      FOR UPDATE`,
    [matchId, registration.user_id],
  );
  const existing = existingResult.rows[0];
  if (existing && existing.registration_id !== registrationId) {
    throw httpError(409, "This player already has a Kill & Earn reward record for this tournament.");
  }
  if (existing && existing.status !== "pending") {
    throw httpError(409, "Reviewed Kill & Earn rewards cannot be edited.");
  }
  const rewardPerKill = existing ? Number(existing.reward_per_kill) : Number(match.kill_reward_coins);
  const rewardCoins = verifiedKills * rewardPerKill;
  if (!Number.isSafeInteger(rewardCoins) || rewardCoins > 2_147_483_647) {
    throw httpError(409, "The calculated reward exceeds the supported coin range.");
  }

  let rewardId = existing?.id;
  if (existing) {
    await client.query(
      `UPDATE daily007_v2_kill_earn_rewards
          SET verified_kills = $2, reward_coins = $3, updated_at = now()
        WHERE id = $1 AND status = 'pending'`,
      [existing.id, verifiedKills, rewardCoins],
    );
  } else {
    const inserted = await client.query<{ id: string }>(
      `INSERT INTO daily007_v2_kill_earn_rewards
         (match_id, registration_id, user_id, tournament_name, submode, player_name,
          player_uid, verified_kills, reward_per_kill, reward_coins)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
       RETURNING id`,
      [
        matchId,
        registrationId,
        registration.user_id,
        match.title,
        registration.submode,
        registration.player_name,
        registration.player_uid,
        verifiedKills,
        rewardPerKill,
        rewardCoins,
      ],
    );
    rewardId = inserted.rows[0]?.id;
  }
  if (!rewardId) throw new Error("The Kill & Earn reward record could not be saved.");
  return serializeKillEarnReward(await loadRewardById(client, rewardId));
}

export async function approveKillEarnReward(
  client: KillEarnRewardClient,
  rewardId: string,
  adminId: string,
) {
  const reference = await client.query<{ match_id: string }>(
    "SELECT match_id FROM daily007_v2_kill_earn_rewards WHERE id = $1",
    [rewardId],
  );
  const matchId = reference.rows[0]?.match_id;
  if (!matchId) throw httpError(404, "Kill & Earn reward was not found.");

  await loadCompletedMatch(client, matchId, true);
  const reward = await loadRewardById(client, rewardId, true);
  if (reward.status === "credited") {
    return { kind: "already_credited" as const, reward: serializeKillEarnReward(reward) };
  }
  if (reward.status === "approved") {
    return { kind: "already_approved" as const, reward: serializeKillEarnReward(reward) };
  }
  if (reward.status === "rejected") throw httpError(409, "A rejected Kill & Earn reward cannot be approved.");

  const verifiedKills = integer(reward.verified_kills);
  const rewardPerKill = integer(reward.reward_per_kill);
  if (verifiedKills === null || rewardPerKill === null) {
    throw httpError(409, "The saved Kill & Earn reward is invalid and cannot be approved.");
  }
  const rewardCoins = verifiedKills * rewardPerKill;
  if (!Number.isSafeInteger(rewardCoins) || rewardCoins > 2_147_483_647 ||
      rewardCoins !== Number(reward.reward_coins)) {
    throw httpError(409, "The saved reward total is invalid and cannot be approved.");
  }

  const idempotencyKey = `daily007-kill-earn:${reward.match_id}:${reward.user_id}`;
  const priorLedger = await client.query<{
    id: string;
    user_id: string;
    amount: number;
    created_at: Date | string;
  }>(
    `SELECT id, user_id, amount, created_at
       FROM daily007_v2_wallet_ledger
      WHERE idempotency_key = $1
      FOR UPDATE`,
    [idempotencyKey],
  );
  if (priorLedger.rows[0]) {
    const prior = priorLedger.rows[0];
    if (prior.user_id !== reward.user_id || Number(prior.amount) !== rewardCoins) {
      throw httpError(409, "A conflicting wallet transaction already exists for this reward.");
    }
    const reconciled = await client.query<RewardRow>(
      `UPDATE daily007_v2_kill_earn_rewards
          SET status = 'credited', reviewed_by = COALESCE(reviewed_by, $2),
              reviewed_at = COALESCE(reviewed_at, $3), credited_at = $3,
              wallet_ledger_id = $4, updated_at = now()
        WHERE id = $1
        RETURNING id, match_id, registration_id, user_id, tournament_name, submode,
                  player_name, player_uid, verified_kills, reward_per_kill, reward_coins,
                  status, reviewed_by, reviewed_at, credited_at, wallet_ledger_id,
                  rejection_reason, created_at`,
      [rewardId, adminId, prior.created_at, prior.id],
    );
    return { kind: "already_credited" as const, reward: serializeKillEarnReward(reconciled.rows[0]) };
  }

  const reviewedAtResult = await client.query<{ reviewed_at: Date | string }>(
    "SELECT clock_timestamp() AS reviewed_at",
  );
  const reviewedAt = reviewedAtResult.rows[0]?.reviewed_at;
  if (!reviewedAt) throw new Error("Could not create an approval timestamp.");

  if (rewardCoins === 0) {
    const approved = await client.query<RewardRow>(
      `UPDATE daily007_v2_kill_earn_rewards
          SET status = 'approved', reviewed_by = $2, reviewed_at = $3, updated_at = now()
        WHERE id = $1 AND status = 'pending'
        RETURNING id, match_id, registration_id, user_id, tournament_name, submode,
                  player_name, player_uid, verified_kills, reward_per_kill, reward_coins,
                  status, reviewed_by, reviewed_at, credited_at, wallet_ledger_id,
                  rejection_reason, created_at`,
      [rewardId, adminId, reviewedAt],
    );
    if (!approved.rows[0]) throw httpError(409, "The reward was reviewed before this approval completed.");
    return { kind: "approved" as const, reward: serializeKillEarnReward(approved.rows[0]) };
  }

  const accountResult = await client.query<{ wallet_coins: number; status: string }>(
    "SELECT wallet_coins, status FROM daily007_v2_users WHERE id = $1 FOR UPDATE",
    [reward.user_id],
  );
  const account = accountResult.rows[0];
  if (!account) throw httpError(404, "The player's Daily007 account could not be found.");
  if (account.status !== "active") throw httpError(409, "The player's account is not active; no reward was credited.");
  const currentBalance = integer(account.wallet_coins);
  if (currentBalance === null || currentBalance + rewardCoins > 2_147_483_647) {
    throw httpError(409, "The reward would exceed the supported wallet balance.");
  }
  const nextBalance = currentBalance + rewardCoins;
  await client.query(
    "UPDATE daily007_v2_users SET wallet_coins = $2 WHERE id = $1",
    [reward.user_id, nextBalance],
  );
  const ledger = await client.query<{ id: string }>(
    `INSERT INTO daily007_v2_wallet_ledger
       (user_id, amount, balance_after, reason, match_id, registration_id, idempotency_key, details)
     VALUES ($1, $2, $3, 'battle_royale_kill_earn_reward', $4, $5, $6, $7)
     RETURNING id`,
    [
      reward.user_id,
      rewardCoins,
      nextBalance,
      reward.match_id,
      reward.registration_id,
      idempotencyKey,
      {
        description: "Battle Royale Kill & Earn Reward",
        tournamentName: reward.tournament_name,
        tournamentId: reward.match_id,
        playerId: reward.user_id,
        verifiedKills,
        rewardPerKill,
        creditedAmount: rewardCoins,
        approvalTime: iso(reviewedAt),
        adminId,
      },
    ],
  );
  const ledgerId = ledger.rows[0]?.id;
  if (!ledgerId) throw new Error("The reward transaction could not be recorded.");
  const credited = await client.query<RewardRow>(
    `UPDATE daily007_v2_kill_earn_rewards
        SET status = 'credited', reviewed_by = $2, reviewed_at = $3,
            credited_at = $3, wallet_ledger_id = $4, updated_at = now()
      WHERE id = $1 AND status = 'pending'
      RETURNING id, match_id, registration_id, user_id, tournament_name, submode,
                player_name, player_uid, verified_kills, reward_per_kill, reward_coins,
                status, reviewed_by, reviewed_at, credited_at, wallet_ledger_id,
                rejection_reason, created_at`,
    [rewardId, adminId, reviewedAt, ledgerId],
  );
  if (!credited.rows[0]) throw httpError(409, "The reward was reviewed before this approval completed.");
  return { kind: "credited" as const, reward: serializeKillEarnReward(credited.rows[0]) };
}

export async function rejectKillEarnReward(
  client: KillEarnRewardClient,
  rewardId: string,
  adminId: string,
  reasonInput: unknown,
) {
  const reason = typeof reasonInput === "string" ? reasonInput.trim() : "";
  if (reason.length < 3 || reason.length > 500) {
    throw httpError(400, "Enter a rejection reason between 3 and 500 characters.");
  }
  const reference = await client.query<{ match_id: string }>(
    "SELECT match_id FROM daily007_v2_kill_earn_rewards WHERE id = $1",
    [rewardId],
  );
  const matchId = reference.rows[0]?.match_id;
  if (!matchId) throw httpError(404, "Kill & Earn reward was not found.");
  await loadCompletedMatch(client, matchId, true);
  const reward = await loadRewardById(client, rewardId, true);
  if (reward.status !== "pending") {
    throw httpError(409, reward.status === "credited"
      ? "Reward Already Credited."
      : "This Kill & Earn reward has already been reviewed.");
  }
  const reviewedAtResult = await client.query<{ reviewed_at: Date | string }>(
    "SELECT clock_timestamp() AS reviewed_at",
  );
  const reviewedAt = reviewedAtResult.rows[0]?.reviewed_at;
  if (!reviewedAt) throw new Error("Could not create a rejection timestamp.");
  const rejected = await client.query<RewardRow>(
    `UPDATE daily007_v2_kill_earn_rewards
        SET status = 'rejected', reviewed_by = $2, reviewed_at = $3,
            rejection_reason = $4, updated_at = now()
      WHERE id = $1 AND status = 'pending'
      RETURNING id, match_id, registration_id, user_id, tournament_name, submode,
                player_name, player_uid, verified_kills, reward_per_kill, reward_coins,
                status, reviewed_by, reviewed_at, credited_at, wallet_ledger_id,
                rejection_reason, created_at`,
    [rewardId, adminId, reviewedAt, reason],
  );
  if (!rejected.rows[0]) throw httpError(409, "The reward was reviewed before this rejection completed.");
  return serializeKillEarnReward(rejected.rows[0]);
}
