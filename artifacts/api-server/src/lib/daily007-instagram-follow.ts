export type InstagramClaimStatus = "pending" | "approved" | "rejected";
export type InstagramClaimAction = "approve" | "reject";

export interface InstagramClaimClient {
  query<T = unknown>(sql: string, values?: unknown[]): Promise<{ rows: T[] }>;
}

interface InstagramClaimRow {
  id: string;
  user_id: string;
  instagram_username: string | null;
  proof_text: string | null;
  reward_coins: number;
  status: InstagramClaimStatus;
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

export function instagramClaimResponse(row: InstagramClaimRow, walletCoins: number | null = null) {
  return {
    id: row.id,
    status: row.status,
    instagramUsername: row.instagram_username,
    proofText: row.proof_text,
    rewardCoins: Number(row.reward_coins),
    createdAt: isoDate(row.created_at),
    reviewedAt: row.reviewed_at ? isoDate(row.reviewed_at) : null,
    reviewReason: row.review_reason,
    transactionId: row.reward_ledger_id,
    walletCoins,
  };
}

export async function submitInstagramFollowClaim(
  client: InstagramClaimClient,
  userId: string,
  instagramUsername: string | null,
  proofText: string | null,
  rewardCoins: number,
): Promise<{ claim: ReturnType<typeof instagramClaimResponse>; created: boolean }> {
  const completed = await client.query<InstagramClaimRow>(
    `SELECT * FROM daily007_v2_instagram_follow_claims
      WHERE user_id = $1 AND status = 'approved'
      ORDER BY created_at DESC LIMIT 1`,
    [userId],
  );
  if (completed.rows[0]) return { claim: instagramClaimResponse(completed.rows[0]), created: false };

  const pending = await client.query<InstagramClaimRow>(
    `SELECT * FROM daily007_v2_instagram_follow_claims
      WHERE user_id = $1 AND status = 'pending'
      ORDER BY created_at DESC LIMIT 1`,
    [userId],
  );
  if (pending.rows[0]) return { claim: instagramClaimResponse(pending.rows[0]), created: false };

  const inserted = await client.query<InstagramClaimRow>(
    `INSERT INTO daily007_v2_instagram_follow_claims
       (user_id, instagram_username, proof_text, reward_coins, status)
     VALUES ($1, $2, $3, $4, 'pending')
     ON CONFLICT (user_id) WHERE status = 'pending' DO NOTHING
     RETURNING *`,
    [userId, instagramUsername, proofText, rewardCoins],
  );
  if (inserted.rows[0]) return { claim: instagramClaimResponse(inserted.rows[0]), created: true };

  const concurrentPending = await client.query<InstagramClaimRow>(
    `SELECT * FROM daily007_v2_instagram_follow_claims
      WHERE user_id = $1 AND status = 'pending'
      ORDER BY created_at DESC LIMIT 1`,
    [userId],
  );
  if (concurrentPending.rows[0]) {
    return { claim: instagramClaimResponse(concurrentPending.rows[0]), created: false };
  }
  throw httpError(409, "The Instagram task has already been completed.");
}

export async function reviewInstagramFollowClaim(
  client: InstagramClaimClient,
  claimId: string,
  adminId: string,
  action: InstagramClaimAction,
  reason: string | null,
): Promise<ReturnType<typeof instagramClaimResponse>> {
  const locked = await client.query<InstagramClaimRow>(
    "SELECT * FROM daily007_v2_instagram_follow_claims WHERE id = $1 FOR UPDATE",
    [claimId],
  );
  const claim = locked.rows[0];
  if (!claim) throw httpError(404, "Instagram task claim not found.");

  if (claim.status !== "pending") {
    if ((action === "approve" && claim.status === "approved") ||
        (action === "reject" && claim.status === "rejected")) {
      return instagramClaimResponse(claim);
    }
    throw httpError(409, "This claim has already been reviewed with a different outcome.");
  }

  if (action === "reject") {
    const reviewReason = reason || "The Instagram follow could not be verified. Please follow the account and submit a new claim.";
    const saved = await client.query<InstagramClaimRow>(
      `UPDATE daily007_v2_instagram_follow_claims
          SET status = 'rejected', reviewed_by = $2, reviewed_at = now(), review_reason = $3
        WHERE id = $1 RETURNING *`,
      [claimId, adminId, reviewReason],
    );
    await client.query(
      `INSERT INTO daily007_v2_notifications (user_id, title, body, type)
       VALUES ($1, 'Instagram task not approved', $2, 'reward')`,
      [claim.user_id, `Your Instagram follow claim was not approved. Reason: ${reviewReason}`],
    );
    return instagramClaimResponse(saved.rows[0]);
  }

  const alreadyCompleted = await client.query<{ id: string }>(
    `SELECT id FROM daily007_v2_instagram_follow_claims
      WHERE user_id = $1 AND status = 'approved' AND id <> $2
      LIMIT 1`,
    [claim.user_id, claimId],
  );
  if (alreadyCompleted.rows[0]) {
    throw httpError(409, "This user already received the Instagram task reward.");
  }

  const accountResult = await client.query<{ wallet_coins: number }>(
    "SELECT wallet_coins FROM daily007_v2_users WHERE id = $1 FOR UPDATE",
    [claim.user_id],
  );
  const balance = accountResult.rows[0]?.wallet_coins;
  if (!Number.isSafeInteger(balance) || balance! < 0) {
    throw httpError(404, "Daily007 account not found or wallet balance is invalid.");
  }

  const idempotencyKey = `daily007-instagram-follow:${claim.user_id}`;
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
       VALUES ($1, $2, $3, 'instagram_follow_reward', $4, $5)
       RETURNING id`,
      [
        claim.user_id,
        claim.reward_coins,
        walletCoins,
        idempotencyKey,
        { taskKey: "instagram_follow", claimId, verification: "admin_approved" },
      ],
    );
    ledgerId = ledger.rows[0]?.id ?? null;
    if (!ledgerId) throw new Error("Wallet ledger did not return the reward transaction id.");
  }

  const saved = await client.query<InstagramClaimRow>(
    `UPDATE daily007_v2_instagram_follow_claims
        SET status = 'approved', reviewed_by = $2, reviewed_at = now(),
            review_reason = NULL, reward_ledger_id = $3
      WHERE id = $1 RETURNING *`,
    [claimId, adminId, ledgerId],
  );
  await client.query(
    `INSERT INTO daily007_v2_notifications (user_id, title, body, type)
     VALUES ($1, 'Instagram task approved', $2, 'reward')`,
    [claim.user_id, `Your Instagram follow task was approved. ${claim.reward_coins} coins were added to your wallet.`],
  );
  return instagramClaimResponse(saved.rows[0], walletCoins);
}
