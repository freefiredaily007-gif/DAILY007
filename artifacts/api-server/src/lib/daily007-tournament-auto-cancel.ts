import { pool } from "@workspace/db";
import { logger } from "./logger";
import { cancelUnderfilledTournamentAndRefund } from "./daily007-tournament-cancellation";

const AUTO_CANCEL_INTERVAL_MS = 15_000;
const AUTO_CANCEL_BATCH_SIZE = 100;

let schedulerTimer: NodeJS.Timeout | undefined;
let sweepRunning = false;

async function sweepUnderfilledTournaments(): Promise<void> {
  if (sweepRunning) return;
  sweepRunning = true;
  try {
    const candidates = await pool.query<{ id: string }>(
      `SELECT m.id
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
        ORDER BY m.starts_at ASC
        LIMIT $1`,
      [AUTO_CANCEL_BATCH_SIZE],
    );

    for (const candidate of candidates.rows) {
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
  void sweepUnderfilledTournaments();
  schedulerTimer = setInterval(() => void sweepUnderfilledTournaments(), AUTO_CANCEL_INTERVAL_MS);
  schedulerTimer.unref();
  logger.info({ intervalMs: AUTO_CANCEL_INTERVAL_MS }, "Daily007 underfilled tournament cancellation scheduler started");
}