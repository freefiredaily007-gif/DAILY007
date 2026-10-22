export type Daily007UserDeletionClient = {
  query<T = unknown>(sql: string, values?: unknown[]): Promise<{ rows: T[] }>;
};

export type Daily007UserDeletionCounts = {
  payments: number;
  paymentProofFiles: number;
  withdrawals: number;
  registrations: number;
  rosterMembers: number;
  resultAwards: number;
  walletLedgerEntries: number;
  notifications: number;
  referralRelations: number;
  referralCodes: number;
  shortCodes: number;
  userStats: number;
  videoWatchSessions: number;
  youtubeSubscribeClaims: number;
  instagramFollowClaims: number;
  googleRecoveryRequests: number;
  adminAccessRequests: number;
  leaderboardSnapshots: number;
  auditAttributionsCleared: number;
};

export type Daily007DeletionCandidate = {
  actorId: string;
  targetId: string;
  targetEmail: string;
  targetRole: string;
  confirmationEmail: string;
};

export function daily007UserDeletionCandidateError(
  candidate: Daily007DeletionCandidate,
): { status: number; message: string } | null {
  if (candidate.actorId === candidate.targetId) {
    return { status: 409, message: "You cannot delete your own account." };
  }
  if (candidate.targetRole !== "user") {
    return {
      status: 409,
      message: "Only regular player accounts can be deleted. Remove administrator access first.",
    };
  }
  if (candidate.confirmationEmail.trim().toLowerCase() !== candidate.targetEmail.trim().toLowerCase()) {
    return { status: 400, message: "The confirmation email does not match this account." };
  }
  return null;
}

async function deletedRows(
  client: Daily007UserDeletionClient,
  sql: string,
  values: unknown[],
): Promise<number> {
  const result = await client.query<{ id?: string; user_id?: string; cycle_type?: string }>(sql, values);
  return result.rows.length;
}

export async function deleteDaily007UserData(
  client: Daily007UserDeletionClient,
  userId: string,
  clerkUserId: string | null,
  paymentProofFiles: number,
): Promise<Daily007UserDeletionCounts> {
  const videoWatchSessions = await deletedRows(
    client,
    "DELETE FROM daily007_v2_video_watch_sessions WHERE user_id = $1 RETURNING id",
    [userId],
  );
  const youtubeSubscribeClaims = await deletedRows(
    client,
    "DELETE FROM daily007_v2_youtube_subscribe_claims WHERE user_id = $1 RETURNING id",
    [userId],
  );
  const instagramFollowClaims = await deletedRows(
    client,
    "DELETE FROM daily007_v2_instagram_follow_claims WHERE user_id = $1 RETURNING id",
    [userId],
  );
  const googleRecoveryRequests = await deletedRows(
    client,
    `DELETE FROM daily007_v2_google_recovery_requests
      WHERE user_id = $1 OR ($2::text IS NOT NULL AND google_clerk_user_id = $2)
      RETURNING id`,
    [userId, clerkUserId],
  );
  const adminAccessRequests = await deletedRows(
    client,
    "DELETE FROM daily007_v2_admin_access_requests WHERE user_id = $1 RETURNING id",
    [userId],
  );
  const notifications = await deletedRows(
    client,
    "DELETE FROM daily007_v2_notifications WHERE user_id = $1 RETURNING id",
    [userId],
  );
  const referralRelations = await deletedRows(
    client,
    `DELETE FROM daily007_v2_referrals
      WHERE referrer_user_id = $1 OR referred_user_id = $1
      RETURNING id`,
    [userId],
  );
  const referralCodes = await deletedRows(
    client,
    "DELETE FROM daily007_v2_referral_codes WHERE user_id = $1 RETURNING user_id AS id",
    [userId],
  );
  const shortCodes = await deletedRows(
    client,
    "DELETE FROM daily007_v2_referral_short_codes WHERE user_id = $1 RETURNING user_id AS id",
    [userId],
  );
  const userStats = await deletedRows(
    client,
    "DELETE FROM daily007_v2_user_stats WHERE user_id = $1 RETURNING user_id AS id",
    [userId],
  );
  const resultAwards = await deletedRows(
    client,
    `DELETE FROM daily007_v2_result_awards
      WHERE user_id = $1
         OR registration_id IN (
           SELECT id FROM daily007_v2_registrations WHERE captain_user_id = $1
         )
      RETURNING id`,
    [userId],
  );
  const walletLedgerEntries = await deletedRows(
    client,
    `DELETE FROM daily007_v2_wallet_ledger
      WHERE user_id = $1
         OR registration_id IN (
           SELECT id FROM daily007_v2_registrations WHERE captain_user_id = $1
         )
      RETURNING id`,
    [userId],
  );
  const payments = await deletedRows(
    client,
    "DELETE FROM daily007_v2_payments WHERE user_id = $1 RETURNING id",
    [userId],
  );
  const withdrawals = await deletedRows(
    client,
    "DELETE FROM daily007_v2_withdrawals WHERE user_id = $1 RETURNING id",
    [userId],
  );
  const rosterMembers = await deletedRows(
    client,
    `DELETE FROM daily007_v2_roster
      WHERE registration_id IN (
        SELECT id FROM daily007_v2_registrations WHERE captain_user_id = $1
      )
      RETURNING id`,
    [userId],
  );
  const leaderboardSnapshots = await deletedRows(
    client,
    `UPDATE daily007_v2_leaderboard_periods
        SET final_standings = COALESCE(
          (
            SELECT jsonb_agg(entry)
              FROM jsonb_array_elements(final_standings) AS entries(entry)
             WHERE COALESCE(entry ->> 'userId', '') <> $1::text
          ),
          '[]'::jsonb
        )
      WHERE final_standings @> jsonb_build_array(jsonb_build_object('userId', $1::text))
      RETURNING id`,
    [userId],
  );
  const approvedByAttributions = await deletedRows(
    client,
    "UPDATE daily007_v2_leaderboard_periods SET approved_by = NULL WHERE approved_by = $1 RETURNING id",
    [userId],
  );
  const rewardSettingAttributions = await deletedRows(
    client,
    "UPDATE daily007_v2_leaderboard_reward_settings SET updated_by = NULL WHERE updated_by = $1 RETURNING cycle_type AS id",
    [userId],
  );
  const settingAttributions = await deletedRows(
    client,
    "UPDATE daily007_v2_settings SET updated_by = NULL WHERE updated_by = $1 RETURNING id",
    [userId],
  );
  const videoAttributions = await deletedRows(
    client,
    "UPDATE daily007_v2_videos SET created_by = NULL WHERE created_by = $1 RETURNING id",
    [userId],
  );
  const registrations = await deletedRows(
    client,
    "DELETE FROM daily007_v2_registrations WHERE captain_user_id = $1 RETURNING id",
    [userId],
  );
  await deletedRows(
    client,
    "DELETE FROM daily007_v2_users WHERE id = $1 RETURNING id",
    [userId],
  );

  return {
    payments,
    paymentProofFiles,
    withdrawals,
    registrations,
    rosterMembers,
    resultAwards,
    walletLedgerEntries,
    notifications,
    referralRelations,
    referralCodes,
    shortCodes,
    userStats,
    videoWatchSessions,
    youtubeSubscribeClaims,
    instagramFollowClaims,
    googleRecoveryRequests,
    adminAccessRequests,
    leaderboardSnapshots,
    auditAttributionsCleared:
      approvedByAttributions +
      rewardSettingAttributions +
      settingAttributions +
      videoAttributions,
  };
}
