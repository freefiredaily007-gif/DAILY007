import { pool } from "@workspace/db";
import { logger } from "./logger";

const CLEANUP_RETENTION_MS = 72 * 60 * 60 * 1000;
const CLEANUP_INTERVAL_MS = 60 * 60 * 1000;
const CLEANUP_BATCH_SIZE = 100;

type CleanupPreviewRow = {
  generated_at: Date | string;
  cleanup_cutoff: Date | string;
  id: string;
  title: string;
  status: string;
  starts_at: Date | string;
  registration_count: number;
  roster_count: number;
  squad_team_count: number;
  squad_member_count: number;
  result_award_count: number;
  wallet_ledger_count: number;
};

export type Daily007TournamentCleanupPreview = {
  generatedAt: string;
  cutoffAt: string;
  retentionHours: 72;
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
  candidates: Array<{
    id: string;
    title: string;
    status: string;
    startsAt: string;
    registrations: number;
    rosterRows: number;
    squadTeams: number;
    squadMembers: number;
    resultAwards: number;
    walletLedgerRowsPreserved: number;
  }>;
};

export async function getDaily007TournamentCleanupPreview(): Promise<Daily007TournamentCleanupPreview> {
  const result = await pool.query<CleanupPreviewRow>(
    `WITH bounds AS (
       SELECT clock_timestamp() AS generated_at
     )
     SELECT bounds.generated_at,
            bounds.generated_at - interval '72 hours' AS cleanup_cutoff,
             m.id, m.title, m.status, m.starts_at,
            (SELECT count(*)::integer
               FROM daily007_v2_registrations r
              WHERE r.match_id = m.id) AS registration_count,
            (SELECT count(*)::integer
               FROM daily007_v2_roster roster
               JOIN daily007_v2_registrations r ON r.id = roster.registration_id
              WHERE r.match_id = m.id) AS roster_count,
            (SELECT count(*)::integer
               FROM daily007_v2_squad_teams team
              WHERE team.match_id = m.id) AS squad_team_count,
            (SELECT count(*)::integer
               FROM daily007_v2_squad_team_members member
               JOIN daily007_v2_squad_teams team ON team.id = member.team_id
              WHERE team.match_id = m.id) AS squad_member_count,
            (SELECT count(*)::integer
               FROM daily007_v2_result_awards award
              WHERE award.match_id = m.id) AS result_award_count,
            (SELECT count(*)::integer
               FROM daily007_v2_wallet_ledger ledger
              WHERE ledger.match_id = m.id
                 OR ledger.registration_id IN (
                   SELECT r.id FROM daily007_v2_registrations r WHERE r.match_id = m.id
                 )) AS wallet_ledger_count
       FROM daily007_v2_matches m
       CROSS JOIN bounds
      WHERE m.starts_at <= bounds.generated_at - interval '72 hours'
      ORDER BY m.starts_at, m.id`,
  );
  const statsResult = await pool.query<{ count: number }>(
    "SELECT count(*)::integer AS count FROM daily007_v2_user_stats",
  );

  const rows = result.rows;
  const candidates = rows;
  const sum = (items: CleanupPreviewRow[], key: keyof CleanupPreviewRow) =>
    items.reduce((total, row) => total + Number(row[key] ?? 0), 0);
  const asIso = (value: Date | string) => new Date(value).toISOString();
  const firstRow = rows[0];
  const generatedAt = firstRow ? asIso(firstRow.generated_at) : new Date().toISOString();

  return {
    generatedAt,
    cutoffAt: firstRow
      ? asIso(firstRow.cleanup_cutoff)
      : new Date(new Date(generatedAt).getTime() - CLEANUP_RETENTION_MS).toISOString(),
    retentionHours: 72,
    scannedMatches: rows.length,
    eligibleMatches: candidates.length,
    matchDataToDelete: {
      registrations: sum(candidates, "registration_count"),
      rosterRows: sum(candidates, "roster_count"),
      squadTeams: sum(candidates, "squad_team_count"),
      squadMembers: sum(candidates, "squad_member_count"),
      resultAwards: sum(candidates, "result_award_count"),
    },
    protectedHistory: {
      matchesWithWalletHistory: rows.filter((row) => Number(row.wallet_ledger_count) > 0).length,
      walletLedgerRows: sum(rows, "wallet_ledger_count"),
      playerStatsRowsPreserved: Number(statsResult.rows[0]?.count ?? 0),
    },
    candidates: candidates.map((row) => ({
      id: row.id,
      title: row.title,
      status: row.status,
      startsAt: asIso(row.starts_at),
      registrations: Number(row.registration_count),
      rosterRows: Number(row.roster_count),
      squadTeams: Number(row.squad_team_count),
      squadMembers: Number(row.squad_member_count),
      resultAwards: Number(row.result_award_count),
      walletLedgerRowsPreserved: Number(row.wallet_ledger_count),
    })),
  };
}

async function deleteIfStillEligible(matchId: string): Promise<boolean> {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const locked = await client.query<{ id: string }>(
      `SELECT id
         FROM daily007_v2_matches
        WHERE id = $1
          AND starts_at <= clock_timestamp() - interval '72 hours'
        FOR UPDATE SKIP LOCKED`,
      [matchId],
    );
    if (!locked.rows[0]) {
      await client.query("ROLLBACK");
      return false;
    }

    // Result awards are direct match data and do not cascade from the match.
    // Wallet ledger rows and all user/profile/stat rows are deliberately untouched.
    await client.query("DELETE FROM daily007_v2_result_awards WHERE match_id = $1", [matchId]);

    const deleted = await client.query<{ id: string }>(
      "DELETE FROM daily007_v2_matches WHERE id = $1 RETURNING id",
      [matchId],
    );
    await client.query("COMMIT");
    return Boolean(deleted.rows[0]);
  } catch (error) {
    await client.query("ROLLBACK").catch(() => undefined);
    throw error;
  } finally {
    client.release();
  }
}

export async function runDaily007TournamentCleanupSweep(): Promise<{ deletedMatchIds: string[] }> {
  const candidateResult = await pool.query<{ id: string }>(
    `SELECT m.id
       FROM daily007_v2_matches m
      WHERE m.starts_at <= clock_timestamp() - interval '72 hours'
      ORDER BY m.starts_at, m.id
      LIMIT $1`,
    [CLEANUP_BATCH_SIZE],
  );
  const deletedMatchIds: string[] = [];
  for (const candidate of candidateResult.rows) {
    try {
      if (await deleteIfStillEligible(candidate.id)) deletedMatchIds.push(candidate.id);
    } catch (error) {
      logger.error({ err: error, tournamentId: candidate.id }, "Tournament cleanup failed for a candidate");
    }
  }
  if (deletedMatchIds.length > 0) {
    logger.info({
      deletedMatches: deletedMatchIds.length,
      retentionHours: 72,
    }, "Removed expired tournament records and direct match data; wallet history preserved");
  }
  return { deletedMatchIds };
}

let cleanupTimer: NodeJS.Timeout | undefined;

export function startDaily007TournamentCleanupScheduler(): void {
  if (cleanupTimer) return;
  void runDaily007TournamentCleanupSweep().catch((error) => {
    logger.error({ err: error }, "Tournament cleanup sweep failed");
  });
  cleanupTimer = setInterval(() => {
    void runDaily007TournamentCleanupSweep().catch((error) => {
      logger.error({ err: error }, "Tournament cleanup sweep failed");
    });
  }, CLEANUP_INTERVAL_MS);
  cleanupTimer.unref();
  logger.info(
    { intervalMs: CLEANUP_INTERVAL_MS, retentionHours: 72 },
    "Daily007 tournament cleanup scheduler started",
  );
}
