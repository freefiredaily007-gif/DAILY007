import { pool } from "@workspace/db";
import { logger } from "./logger";
import { cancelUnderfilledTournamentAndRefund } from "./daily007-tournament-cancellation";

const AUTO_CANCEL_INTERVAL_MS = 15_000;
const AUTO_CANCEL_BATCH_SIZE = 100;
const AUTO_CANCEL_FAILURE_ALERT_THRESHOLD = 3;
const AUTO_CANCEL_CURSOR_SETTING = "__daily007AutoCancelCursor";
const UUID_PATTERN = /^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/i;

let sweepRunning = false;
let consecutiveSweepFailures = 0;
let sweepFailureAlertActive = false;

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
    !UUID_PATTERN.test(value.id) ||
    typeof value.startsAt !== "string" ||
    !Number.isFinite(Date.parse(value.startsAt))
  ) {
    return null;
  }
  return { id: value.id, startsAt: new Date(value.startsAt).toISOString() };
}

async function saveCandidateCursor(
  cursor: CandidateCursor | null,
  expectedCursorOnReset: CandidateCursor | null = null,
): Promise<void> {
  await pool.query(
    `INSERT INTO daily007_v2_settings (id, settings)
     VALUES (1, jsonb_build_object('__daily007AutoCancelCursor', $1::jsonb))
     ON CONFLICT (id) DO UPDATE
       SET settings = jsonb_set(
         COALESCE(daily007_v2_settings.settings, '{}'::jsonb),
         '{__daily007AutoCancelCursor}',
          CASE
            WHEN $1::jsonb = 'null'::jsonb
            THEN CASE
              WHEN daily007_v2_settings.settings->'__daily007AutoCancelCursor' = $2::jsonb
              THEN $1::jsonb
              ELSE daily007_v2_settings.settings->'__daily007AutoCancelCursor'
            END
            WHEN jsonb_typeof(daily007_v2_settings.settings->'__daily007AutoCancelCursor') = 'object'
             AND daily007_v2_settings.settings->'__daily007AutoCancelCursor'->>'startsAt'
               ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}\\.[0-9]{3}Z$'
             AND daily007_v2_settings.settings->'__daily007AutoCancelCursor'->>'id'
               ~* '^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$'
             AND (
               daily007_v2_settings.settings->'__daily007AutoCancelCursor'->>'startsAt'
                 > $1::jsonb->>'startsAt'
               OR (
                 daily007_v2_settings.settings->'__daily007AutoCancelCursor'->>'startsAt'
                   = $1::jsonb->>'startsAt'
                 AND daily007_v2_settings.settings->'__daily007AutoCancelCursor'->>'id'
                   > $1::jsonb->>'id'
               )
             )
            THEN daily007_v2_settings.settings->'__daily007AutoCancelCursor'
            ELSE $1::jsonb
          END,
         true
       )`,
    [JSON.stringify(cursor), JSON.stringify(expectedCursorOnReset)],
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
           SELECT COALESCE(sum(
                    CASE WHEN EXISTS (
                      SELECT 1 FROM daily007_v2_squad_team_members linked
                       WHERE linked.registration_id = r.id
                    ) THEN (
                      SELECT count(*) FROM daily007_v2_squad_team_members active_member
                       WHERE active_member.registration_id = r.id AND active_member.is_active = true
                    ) ELSE 1 + (
                      SELECT count(*) FROM daily007_v2_roster roster
                       WHERE roster.registration_id = r.id
                    ) END
                  ), 0)
             FROM daily007_v2_registrations r
            WHERE r.match_id = m.id AND r.status IN ('approved', 'pending')
         ) < m.capacity * CASE
           WHEN m.team_type = 'duo' THEN 2
           WHEN m.team_type = 'squad' THEN 4
           WHEN m.team_type = 'solo' THEN 1
           WHEN m.mode IN ('clash', 'squad') THEN 4
           ELSE 1
         END
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
  let sweepFailed = false;
  try {
    let lastCandidateCursor = await loadCandidateCursor();
    let candidates = await selectCandidates(lastCandidateCursor);
    if (candidates.rows.length === 0 && lastCandidateCursor !== null) {
      const previousCursor = lastCandidateCursor;
      lastCandidateCursor = null;
      await saveCandidateCursor(null, previousCursor);
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
        sweepFailed = true;
        logger.error({ err, tournamentId: candidate.id }, "Automatic tournament cancellation failed");
      }
      lastCandidateCursor = { id: candidate.id, startsAt: candidate.startsAt };
      await saveCandidateCursor(lastCandidateCursor);
    }
  } catch (err) {
    sweepFailed = true;
    logger.error({ err }, "Automatic tournament cancellation sweep failed");
  } finally {
    if (sweepFailed) {
      consecutiveSweepFailures += 1;
      if (
        consecutiveSweepFailures >= AUTO_CANCEL_FAILURE_ALERT_THRESHOLD &&
        !sweepFailureAlertActive
      ) {
        sweepFailureAlertActive = true;
        logger.error({
          event: "daily007_auto_cancellation_sweep_stalled",
          consecutiveFailures: consecutiveSweepFailures,
          intervalMs: AUTO_CANCEL_INTERVAL_MS,
          action: "Check database connectivity and access to daily007_v2_settings; refunds will retry on the next sweep.",
        }, "Automatic tournament refund sweep has repeatedly failed");
      }
    } else {
      if (sweepFailureAlertActive) {
        logger.info({
          event: "daily007_auto_cancellation_sweep_recovered",
          previousConsecutiveFailures: consecutiveSweepFailures,
        }, "Automatic tournament refund sweep recovered");
      }
      consecutiveSweepFailures = 0;
      sweepFailureAlertActive = false;
    }
    sweepRunning = false;
  }
}

export function getDaily007AutoCancellationSweepStatus(): {
  consecutiveFailures: number;
  alertActive: boolean;
} {
  return {
    consecutiveFailures: consecutiveSweepFailures,
    alertActive: sweepFailureAlertActive,
  };
}

export function startDaily007AutoCancellationScheduler(): void {
  logger.info(
    "Automatic tournament cancellation and refunds are disabled; use the authorized admin action.",
  );
}