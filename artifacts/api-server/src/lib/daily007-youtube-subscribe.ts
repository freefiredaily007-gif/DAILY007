export type YoutubeClaimStatus = "pending" | "approved" | "rejected";
export type YoutubeClaimAction = "approve" | "reject";

export interface YoutubeClaimClient {
  query<T = unknown>(sql: string, values?: unknown[]): Promise<{ rows: T[] }>;
}

interface ClaimRow {
  id: string;
  user_id: string;
  task_key: string;
  reward_coins: number;
  status: YoutubeClaimStatus;
  review_reason: string | null;
  reviewed_by: string | null;
  reward_ledger_id: string | null;
  created_at: Date | string;
  reviewed_at: Date | string | null;
}

function httpError(status: number, message: string): Error & { status: number } {
  return Object.assign(new Error(message), { status });
}

function isoDate(value: Date | string): string {
  if (value instanceof Date) return value.toISOString();
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) throw new Error("Database returned an invalid claim timestamp.");
  return date.toISOString();
}

export function youtubeClaimResponse(row: ClaimRow, walletCoins: number | null = null) {
  return {
    id: row.id,
    status: row.status,
    rewardCoins: Number(row.reward_coins),
    createdAt: isoDate(row.created_at),
    reviewedAt: row.reviewed_at ? isoDate(row.reviewed_at) : null,
    reviewReason: row.review_reason,
    transactionId: row.reward_ledger_id,
    walletCoins,
  };
}

export async function submitYoutubeSubscribeClaim(
  client: YoutubeClaimClient,
  userId: string,
  rewardCoins: number,
): Promise<{ claim: ReturnType<typeof youtubeClaimResponse>; created: boolean }> {
  const completed = await client.query<ClaimRow>(
    `SELECT * FROM daily007_v2_youtube_subscribe_claims
      WHERE user_id = $1 AND task_key = 'youtube_subscribe' AND status = 'approved'
      ORDER BY created_at DESC LIMIT 1`,
    [userId],
  );
  if (completed.rows[0]) return { claim: youtubeClaimResponse(completed.rows[0]), created: false };

  const pending = await client.query<ClaimRow>(
    `SELECT * FROM daily007_v2_youtube_subscribe_claims
      WHERE user_id = $1 AND task_key = 'youtube_subscribe' AND status = 'pending'
      ORDER BY created_at DESC LIMIT 1`,
    [userId],
  );
  if (pending.rows[0]) return { claim: youtubeClaimResponse(pending.rows[0]), created: false };

  const inserted = await client.query<ClaimRow>(
    `INSERT INTO daily007_v2_youtube_subscribe_claims (user_id, task_key, reward_coins, status)
     VALUES ($1, 'youtube_subscribe', $2, 'pending')
     ON CONFLICT (user_id, task_key) WHERE status = 'pending' DO NOTHING
     RETURNING *`,
    [userId, rewardCoins],
  );
  if (inserted.rows[0]) return { claim: youtubeClaimResponse(inserted.rows[0]), created: true };

  // A concurrent submit may have won the partial unique index after the first lookup.
  const concurrentPending = await client.query<ClaimRow>(
    `SELECT * FROM daily007_v2_youtube_subscribe_claims
      WHERE user_id = $1 AND task_key = 'youtube_subscribe' AND status = 'pending'
      ORDER BY created_at DESC LIMIT 1`,
    [userId],
  );
  if (concurrentPending.rows[0]) {
    return { claim: youtubeClaimResponse(concurrentPending.rows[0]), created: false };
  }
  throw httpError(409, "This YouTube task has already been completed.");
}

export async function reviewYoutubeSubscribeClaim(
  client: YoutubeClaimClient,
  claimId: string,
  adminId: string,
  action: YoutubeClaimAction,
  reason: string | null,
): Promise<ReturnType<typeof youtubeClaimResponse>> {
  const locked = await client.query<ClaimRow>(
    "SELECT * FROM daily007_v2_youtube_subscribe_claims WHERE id = $1 FOR UPDATE",
    [claimId],
  );
  const claim = locked.rows[0];
  if (!claim) throw httpError(404, "YouTube task claim not found.");

  if (claim.status !== "pending") {
    if ((action === "approve" && claim.status === "approved") ||
        (action === "reject" && claim.status === "rejected")) {
      return youtubeClaimResponse(claim);
    }
    throw httpError(409, "This claim has already been reviewed with a different outcome.");
  }

  if (action === "reject") {
    const reviewReason = reason || "The subscription could not be verified. Please subscribe and submit a new claim.";
    const saved = await client.query<ClaimRow>(
      `UPDATE daily007_v2_youtube_subscribe_claims
          SET status = 'rejected', reviewed_by = $2, reviewed_at = now(), review_reason = $3
        WHERE id = $1 RETURNING *`,
      [claimId, adminId, reviewReason],
    );
    await client.query(
      `INSERT INTO daily007_v2_notifications (user_id, title, body, type)
       VALUES ($1, 'YouTube task not approved', $2, 'reward')`,
      [claim.user_id, `Your YouTube subscription claim was not approved. Reason: ${reviewReason}`],
    );
    return youtubeClaimResponse(saved.rows[0]);
  }

  const alreadyCompleted = await client.query<{ id: string }>(
    `SELECT id FROM daily007_v2_youtube_subscribe_claims
      WHERE user_id = $1 AND task_key = 'youtube_subscribe' AND status = 'approved' AND id <> $2
      LIMIT 1`,
    [claim.user_id, claimId],
  );
  if (alreadyCompleted.rows[0]) {
    throw httpError(409, "This user already received the YouTube task reward.");
  }

  const accountResult = await client.query<{ wallet_coins: number }>(
    "SELECT wallet_coins FROM daily007_v2_users WHERE id = $1 FOR UPDATE",
    [claim.user_id],
  );
  const balance = accountResult.rows[0]?.wallet_coins;
  if (!Number.isSafeInteger(balance) || balance! < 0) {
    throw httpError(404, "Daily007 account not found or wallet balance is invalid.");
  }

  const idempotencyKey = `daily007-youtube-subscribe:${claim.user_id}`;
  const priorLedger = await client.query<{ id: string }>(
    "SELECT id FROM daily007_v2_wallet_ledger WHERE idempotency_key = $1",
    [idempotencyKey],
  );
  let ledgerId = priorLedger.rows[0]?.id ?? null;
  let walletCoins = balance!;
  if (!ledgerId) {
    walletCoins += Number(claim.reward_coins);
    if (!Number.isSafeInteger(walletCoins) || walletCoins > 2_147_483_647) {
      throw httpError(409, "Wallet balance would exceed the supported range.");
    }
    await client.query(
      "UPDATE daily007_v2_users SET wallet_coins = $2 WHERE id = $1",
      [claim.user_id, walletCoins],
    );
    const ledger = await client.query<{ id: string }>(
      `INSERT INTO daily007_v2_wallet_ledger
         (user_id, amount, balance_after, reason, idempotency_key, details)
       VALUES ($1, $2, $3, 'youtube_subscribe_reward', $4, $5)
       RETURNING id`,
      [
        claim.user_id,
        claim.reward_coins,
        walletCoins,
        idempotencyKey,
        { taskKey: claim.task_key, claimId, verification: "admin_approved" },
      ],
    );
    ledgerId = ledger.rows[0]?.id ?? null;
    if (!ledgerId) throw new Error("Wallet ledger did not return the reward transaction id.");
  }

  const saved = await client.query<ClaimRow>(
    `UPDATE daily007_v2_youtube_subscribe_claims
        SET status = 'approved', reviewed_by = $2, reviewed_at = now(),
            review_reason = NULL, reward_ledger_id = $3
      WHERE id = $1 RETURNING *`,
    [claimId, adminId, ledgerId],
  );
  await client.query(
    `INSERT INTO daily007_v2_notifications (user_id, title, body, type)
     VALUES ($1, 'YouTube task approved', $2, 'reward')`,
    [claim.user_id, `Your YouTube subscription task was approved. ${claim.reward_coins} coins were added to your wallet.`],
  );
  return youtubeClaimResponse(saved.rows[0], walletCoins);
}