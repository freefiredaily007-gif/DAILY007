import { pool } from "@workspace/db";

export type CancellationSqlClient = {
  query<T = unknown>(text: string, values?: unknown[]): Promise<{ rows: T[] }>;
  release(): void;
};

type CancellationState = {
  gameMode: unknown;
  storageMode: unknown;
  status: string;
  hasStarted: boolean;
  hasWinner: boolean;
  filledSlots: number;
  capacity: number;
};

export type TournamentCancellationResult = {
  id: string;
  status: "cancelled";
  registrationsRefunded: number;
  accountsRefunded: number;
  coinsRefunded: number;
};

export class TournamentCancellationError extends Error {
  constructor(message: string, readonly status: number) {
    super(message);
    this.name = "TournamentCancellationError";
  }
}

export function isAutomaticTournamentCancellationMode(gameMode: unknown, storageMode: unknown): boolean {
  const game = typeof gameMode === "string" ? gameMode.trim().toLowerCase() : "";
  const mode = typeof storageMode === "string" ? storageMode.trim().toLowerCase() : "";
  return game === "clash_squad" || game === "lone_wolf" || (!game && mode === "clash");
}

export function tournamentCancellationError(state: {
  status: string;
  hasStarted: boolean;
  hasWinner: boolean;
  filledSlots: number;
  capacity: number;
}): string | null {
  if (state.status === "cancelled") return "Tournament is already cancelled.";
  if (state.hasWinner) return "A tournament with a declared winner cannot be cancelled.";
  if (!state.hasStarted) return "A tournament can only be cancelled after its scheduled start time.";
  if (!Number.isInteger(state.filledSlots) || state.filledSlots < 0 ||
      !Number.isInteger(state.capacity) || state.capacity < 1) {
    return "Tournament slot data is invalid.";
  }
  if (state.filledSlots >= state.capacity) {
    return "Only an ongoing tournament with at least one vacant slot can be cancelled.";
  }
  return null;
}

export function shouldAutomaticallyCancelTournament(state: CancellationState): boolean {
  return isAutomaticTournamentCancellationMode(state.gameMode, state.storageMode) &&
    tournamentCancellationError(state) === null;
}

async function withTransaction<T>(work: (client: CancellationSqlClient) => Promise<T>): Promise<T> {
  const client = await pool.connect() as unknown as CancellationSqlClient;
  try {
    await client.query("BEGIN");
    const result = await work(client);
    await client.query("COMMIT");
    return result;
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

/**
 * Cancel an underfilled tournament and refund each active registration's
 * original paying account in the same transaction as the status change.
 * Automatic runs are restricted to Clash Squad and Lone Wolf (plus legacy
 * Clash rows that predate the explicit game_mode column).
 */
export async function cancelUnderfilledTournamentTransaction(
  client: CancellationSqlClient,
  matchId: string,
  automaticOnly = false,
): Promise<TournamentCancellationResult | null> {
    const matchResult = await client.query<{
      id: string;
      title: string;
      mode: string;
      game_mode: string | null;
      status: string;
      capacity: number;
      has_started: boolean;
      has_winner: boolean;
    }>(
      `SELECT m.id, m.title, m.mode, m.game_mode, m.status, m.capacity,
              m.starts_at <= clock_timestamp() + interval '5 hours 30 minutes' AS has_started,
              EXISTS (
                SELECT 1 FROM daily007_v2_result_awards award
                 WHERE award.match_id = m.id AND award.rank = 1
              ) AS has_winner
         FROM daily007_v2_matches m
        WHERE m.id = $1
        FOR UPDATE OF m`,
      [matchId],
    );
    const match = matchResult.rows[0];
    if (!match) {
      if (automaticOnly) return null;
      throw new TournamentCancellationError("Tournament not found.", 404);
    }

    const countResult = await client.query<{ filled_slots: number }>(
      `SELECT count(*)::integer AS filled_slots
         FROM daily007_v2_registrations
        WHERE match_id = $1 AND status IN ('approved', 'pending')`,
      [matchId],
    );
    const filledSlots = Number(countResult.rows[0]?.filled_slots ?? 0);
    const state: CancellationState = {
      gameMode: match.game_mode,
      storageMode: match.mode,
      status: match.status,
      hasStarted: match.has_started,
      hasWinner: match.has_winner,
      filledSlots,
      capacity: Number(match.capacity),
    };

    if (automaticOnly && !shouldAutomaticallyCancelTournament(state)) return null;
    const refusal = tournamentCancellationError(state);
    if (refusal) throw new TournamentCancellationError(refusal, 409);

    const registrations = await client.query<{
      id: string;
      captain_user_id: string;
      entry_coins_paid: number;
    }>(
      `SELECT id, captain_user_id, entry_coins_paid
         FROM daily007_v2_registrations
        WHERE match_id = $1 AND status IN ('approved', 'pending')
        ORDER BY captain_user_id, id
        FOR UPDATE`,
      [matchId],
    );

    let registrationsRefunded = 0;
    let coinsRefunded = 0;
    const refundedUsers = new Set<string>();
    for (const registration of registrations.rows) {
      const priorRefund = await client.query<{ id: string }>(
        `SELECT id
           FROM daily007_v2_wallet_ledger
          WHERE registration_id = $1
            AND reason IN ('registration_refund', 'tournament_cancel_refund')
          LIMIT 1`,
        [registration.id],
      );
      if (priorRefund.rows[0]) {
        throw new TournamentCancellationError(
          "A registration already has a refund record; cancellation was not applied.",
          409,
        );
      }

      const amount = Number(registration.entry_coins_paid);
      if (!Number.isSafeInteger(amount) || amount < 0 || amount > 2_147_483_647) {
        throw new TournamentCancellationError("A recorded entry fee is outside the supported refund range.", 409);
      }
      if (amount === 0) continue;

      const account = await client.query<{ wallet_coins: number }>(
        "SELECT wallet_coins FROM daily007_v2_users WHERE id = $1 FOR UPDATE",
        [registration.captain_user_id],
      );
      const balance = Number(account.rows[0]?.wallet_coins);
      if (!Number.isSafeInteger(balance) || balance < 0) {
        throw new TournamentCancellationError("A paying account was not found or has an invalid wallet balance.", 409);
      }
      const nextBalance = balance + amount;
      if (!Number.isSafeInteger(nextBalance) || nextBalance > 2_147_483_647) {
        throw new TournamentCancellationError("A refund would exceed the supported wallet balance.", 409);
      }

      await client.query(
        "UPDATE daily007_v2_users SET wallet_coins = $2 WHERE id = $1",
        [registration.captain_user_id, nextBalance],
      );
      const description = `Entry fee refunded — ${match.title} (tournament cancelled)`;
      const ledger = await client.query<{ id: string }>(
        `INSERT INTO daily007_v2_wallet_ledger
           (user_id, amount, balance_after, reason, match_id, registration_id, idempotency_key, details)
         VALUES ($1, $2, $3, 'tournament_cancel_refund', $4, $5, $6, $7::jsonb)
         ON CONFLICT (idempotency_key) DO NOTHING
         RETURNING id`,
        [
          registration.captain_user_id,
          amount,
          nextBalance,
          matchId,
          registration.id,
          `daily007:tournament-cancel:${matchId}:${registration.id}`,
          JSON.stringify({ description, tournamentId: matchId, tournamentTitle: match.title }),
        ],
      );
      if (!ledger.rows[0]) {
        throw new TournamentCancellationError(
          "This registration's refund was already recorded; cancellation was not applied.",
          409,
        );
      }
      registrationsRefunded += 1;
      coinsRefunded += amount;
      refundedUsers.add(registration.captain_user_id);
    }

    await client.query(
      `UPDATE daily007_v2_matches
          SET enabled = false, is_full = false, status = 'cancelled',
              room_id = NULL, room_password = NULL, room_published = false
        WHERE id = $1`,
      [matchId],
    );
    return {
      id: matchId,
      status: "cancelled",
      registrationsRefunded,
      accountsRefunded: refundedUsers.size,
      coinsRefunded,
    };
}

export async function cancelUnderfilledTournamentAndRefund(
  matchId: string,
  automaticOnly = false,
): Promise<TournamentCancellationResult | null> {
  return withTransaction((client) =>
    cancelUnderfilledTournamentTransaction(client, matchId, automaticOnly),
  );
}