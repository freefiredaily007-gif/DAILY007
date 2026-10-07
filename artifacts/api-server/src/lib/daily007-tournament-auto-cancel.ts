import { pool } from "@workspace/db";
import { logger } from "./logger";
import { cancelUnderfilledTournamentAndRefund } from "./daily007-tournament-cancellation";

const AUTO_CANCEL_INTERVAL_MS = 15_000;
const AUTO_CANCEL_BATCH_SIZE = 100;
const AUTO_CANCEL_CURSOR_SETTING = "__daily007AutoCancelCursor";

let schedulerTimer: NodeJS.Timeout | undefined;
let sweepRunning = false;

type CandidateCursor = { id: string; startsAt: Date | string };

async function loadCandidateCursor(): Promise<CandidateCursor | null> {
  const result = await pool.query<{ settings: Record<string, unknown> }>(
    "SELECT settings FROM daily007_v2_settings WHERE id = 1",
  );
  const cursor = result.rows[0]?.settings?.[AUTO_CANCEL_CURSOR_SETTING];
  if (!cursor || typeof cursor !== "object" || Array.isArray(cursor)) return null;
  const value = cursor as { id?: unknown; startsAt?: unknown };
  if (
    typeof value.id !== "string" ||
    !value.id ||
    typeof value.startsAt !== "string" ||
    !Number.isFinite(Date.parse(value.startsAt))
  ) {
    return null;
  }
  return { id: value.id, startsAt: new Date(value.startsAt).toISOString() };
}

async function saveCandidateCursor(cursor: CandidateCursor | null): Promise<void> {
  await pool.query(
    `INSERT INTO daily007_v2_settings (id, settings)
     VALUES (1, jsonb_build_object('__daily007AutoCancelCursor', $1::jsonb))
     ON CONFLICT (id) DO UPDATE
       SET settings = jsonb_set(
         COALESCE(daily007_v2_settings.settings, '{}'::jsonb),
         '{__daily007AutoCancelCursor}',
         $1::jsonb,
         true
       )`,
    [JSON.stringify(cursor)],
  );
}

function selectCandidates(after: CandidateCursor | null) {
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
          $2::timestamptz IS NULL
          OR m.starts_at > $2::timestamptz
          OR (m.starts_at = $2::timestamptz AND m.id > $3::uuid)
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
    let lastCandidateCursor = await loadCandidateCursor();
    let candidates = await selectCandidates(lastCandidateCursor);
    if (candidates.rows.length === 0 && lastCandidateCursor !== null) {
      lastCandidateCursor = null;
      await saveCandidateCursor(null);
      candidates = await selectCandidates(null);
    }

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
      lastCandidateCursor = { id: candidate.id, startsAt: candidate.startsAt };
      await saveCandidateCursor(lastCandidateCursor);
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