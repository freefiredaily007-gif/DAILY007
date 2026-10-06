import { pool } from "@workspace/db";
import { logger } from "./logger";
import { cancelUnderfilledTournamentAndRefund } from "./daily007-tournament-cancellation";

const AUTO_CANCEL_INTERVAL_MS = 15_000;
const AUTO_CANCEL_BATCH_SIZE = 100;

let schedulerTimer: NodeJS.Timeout | undefined;
let sweepRunning = false;
let lastCandidateCursor: { id: string; startsAt: Date | string } | null = null;

function selectCandidates(after: typeof lastCandidateCursor) {
  return pool.query<{ id: string; startsAt: Date | string }>(
    `SELECT m.id, m.starts_at AS "startsAt"
       FROM daily007_v2_matches m
      WHERE m.starts_at <= clock_timestamp() + interval '5 hours 30 minutes'
        AND m.status <> 'cancelled'
        AND (
          m.game_mode IN ('clash_squad', 'lone_wolf')
          OR (m.game_mode IS NULL AND m.mode = 'clash')
        )
        AND (
          SELECT count(*)
            FROM daily007_v2_registrations r
           WHERE r.match_id = m.id AND r.status IN ('approved', 'pending')
        ) < m.capacity
        AND NOT EXISTS (
          SELECT 1
            FROM daily007_v2_result_awards award
           WHERE award.match_id = m.id AND award.rank = 1
        )
        AND (
          $2 IS NULL
          OR m.starts_at > $2
          OR (m.starts_at = $2 AND m.id > $3)
        )
      ORDER BY m.starts_at ASC, m.id ASC
      LIMIT $1`,
    [AUTO_CANCEL_BATCH_SIZE, after?.startsAt ?? null, after?.id ?? null],
  );
}

export async function runDaily007AutoCancellationSweep(): Promise<void> {
  if (sweepRunning) return;
  sweepRunning = true;
  try {
    let candidates = await selectCandidates(lastCandidateCursor);
    if (candidates.rows.length === 0 && lastCandidateCursor !== null) {
      lastCandidateCursor = null;
      candidates = await selectCandidates(null);
    }

    for (const candidate of candidates.rows) {
      lastCandidateCursor = { id: candidate.id, startsAt: candidate.startsAt };
      try {
        const result = await cancelUnderfilledTournamentAndRefund(candidate.id, true);
        if (result) {
          logger.info({
            tournamentId: result.id,
            registrationsRefunded: result.registrationsRefunded,
            accountsRefunded: result.accountsRefunded,
            coinsRefunded: result.coinsRefunded,
          }, "Automatically cancelled an underfilled tournament and refunded its entry fees");
        }
      } catch (err) {
        logger.error({ err, tournamentId: candidate.id }, "Automatic tournament cancellation failed");
      }
    }
  } catch (err) {
    logger.error({ err }, "Automatic tournament cancellation sweep failed");
  } finally {
    sweepRunning = false;
  }
}

export function startDaily007AutoCancellationScheduler(): void {
  if (schedulerTimer) return;
  void runDaily007AutoCancellationSweep();
  schedulerTimer = setInterval(() => void runDaily007AutoCancellationSweep(), AUTO_CANCEL_INTERVAL_MS);
  schedulerTimer.unref();
  logger.info({ intervalMs: AUTO_CANCEL_INTERVAL_MS }, "Daily007 underfilled tournament cancellation scheduler started");
}