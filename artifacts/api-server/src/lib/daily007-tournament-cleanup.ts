import { pool } from "@workspace/db";
import { logger } from "./logger";

const CLEANUP_BATCH_SIZE = 100;

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

export function startDaily007TournamentCleanupScheduler(): void {
  logger.info(
    "Automatic tournament deletion is disabled; only an authorized admin may delete a tournament.",
  );
}
