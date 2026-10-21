import { Router, type IRouter, type Request, type Response } from "express";
import { randomUUID } from "node:crypto";
import { pool } from "@workspace/db";
import { awardDaily007SignupBonus, ensureDaily007ReferralCode } from "../lib/daily007-referrals";
import { parseOptionalHttpsImageUrl } from "../lib/tournament-image-url";
import { legacyTournamentMode, resolveTournamentMode, tournamentModeCapacityLabel } from "../lib/daily007-mode-rules";
import { isTournamentStartInFuture, tournamentInstantFromStored } from "../lib/daily007-schedule-time";
import { canRevealRoomCredentials } from "../lib/daily007-room-access";
import {
  DAILY007_LOGIN_FAILURE_MESSAGE,
  verifyDaily007LoginPassword,
} from "../lib/daily007-login-password";
import { checkDaily007LoginThrottle } from "../lib/daily007-login-throttle";
import {
  createPasswordChangeRequestFingerprint,
  parsePasswordChangeInput,
  passwordChangeRequestFingerprintsMatch,
  passwordHashesMatch,
} from "../lib/daily007-password-change";
import {
  cancelUnderfilledTournamentAndRefund,
  tournamentCancellationError,
} from "../lib/daily007-tournament-cancellation";
import {
  deactivateSquadRegistration,
  ensureLegacySquadTeams,
  getSquadOccupancy,
} from "../lib/daily007-squad-slots";
import {
  authenticate,
  getDaily007GoogleLinkStatus,
  hashPassword,
  makeToken,
  requireTournamentAdmin,
} from "./daily007-v2";

const router: IRouter = Router();
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

// Allow at most five incorrect current-password checks per account in a
// 15-minute window. Reservations are persisted atomically so every API process
// shares the same budget; verifying the correct password clears failed checks.
const PASSWORD_CHANGE_ATTEMPT_LIMIT = 5;
const PASSWORD_CHANGE_ATTEMPT_WINDOW_MS = 15 * 60 * 1000;
type PasswordChangeAttemptReservation =
  | { allowed: true; windowId: string }
  | { allowed: false; retryAfterSeconds: number };

async function reservePasswordChangeAttempt(userId: string): Promise<PasswordChangeAttemptReservation> {
  for (;;) {
    const reservation = await pool.query<{ window_id: string }>(
      `INSERT INTO daily007_password_change_attempts
         (user_id, window_id, failures, in_flight, expires_at)
       VALUES ($1, $2, 0, 1, now() + ($3::integer * interval '1 millisecond'))
       ON CONFLICT (user_id) DO UPDATE
         SET window_id = CASE
               WHEN daily007_password_change_attempts.expires_at <= now() THEN EXCLUDED.window_id
               ELSE daily007_password_change_attempts.window_id
             END,
             failures = CASE
               WHEN daily007_password_change_attempts.expires_at <= now() THEN 0
               ELSE daily007_password_change_attempts.failures
             END,
             in_flight = CASE
               WHEN daily007_password_change_attempts.expires_at <= now() THEN 1
               ELSE daily007_password_change_attempts.in_flight + 1
             END,
             expires_at = CASE
               WHEN daily007_password_change_attempts.expires_at <= now() THEN EXCLUDED.expires_at
               ELSE daily007_password_change_attempts.expires_at
             END
       WHERE daily007_password_change_attempts.expires_at <= now()
          OR daily007_password_change_attempts.failures
             + daily007_password_change_attempts.in_flight < $4
       RETURNING window_id`,
      [userId, randomUUID(), PASSWORD_CHANGE_ATTEMPT_WINDOW_MS, PASSWORD_CHANGE_ATTEMPT_LIMIT],
    );
    if (reservation.rows[0]) {
      return { allowed: true, windowId: reservation.rows[0].window_id };
    }

    const currentWindow = await pool.query<{ retry_after_seconds: number }>(
      `SELECT GREATEST(1, CEIL(EXTRACT(EPOCH FROM (expires_at - now()))))::integer AS retry_after_seconds
         FROM daily007_password_change_attempts
        WHERE user_id = $1 AND expires_at > now()`,
      [userId],
    );
    if (currentWindow.rows[0]) {
      return { allowed: false, retryAfterSeconds: currentWindow.rows[0].retry_after_seconds };
    }
    // The account/window may have been removed or expired between the upsert
    // and lookup; retry the atomic reservation instead of denying stale state.
  }
}

async function finishPasswordChangeAttempt(
  userId: string,
  windowId: string,
  outcome: "incorrect" | "correct" | "replayed" | "abandoned",
): Promise<void> {
  await pool.query(
    `UPDATE daily007_password_change_attempts
        SET failures = CASE
              WHEN $3 = 'incorrect' THEN failures + 1
              WHEN $3 = 'correct' THEN 0
              ELSE failures
            END,
            in_flight = GREATEST(0, in_flight - 1),
            expires_at = CASE
              WHEN $3 = 'correct' THEN now() + ($4::integer * interval '1 millisecond')
              ELSE expires_at
            END
      WHERE user_id = $1 AND window_id = $2 AND expires_at > now()`,
    [userId, windowId, outcome, PASSWORD_CHANGE_ATTEMPT_WINDOW_MS],
  );
}

type MatchRow = {
  id: string; title: string; mode: string; game_mode?: string | null; team_type?: string | null;
  capacity: number; entry_coins: number;
  prize_pool: number; starts_at: Date | string; status: string; is_full: boolean;
  rules: string; banner: string; image_url: string | null; prize_distribution: string; enabled: boolean;
  has_winner?: boolean; has_started?: boolean;
  completed_at?: Date | string | null;
  room_id: string | null; room_password: string | null; room_time: string; room_published: boolean;
  registered_count: number;
  registered_player_count?: number;
};
type RegistrationRow = {
  id: string; match_id: string; captain_user_id: string; captain_name: string;
  captain_game_name: string; captain_game_uid: string;
  team_name: string; entry_coins_paid: number; status: string; created_at: Date | string;
  name?: string; email?: string; mode?: string; game_mode?: string | null; team_type?: string | null;
  capacity?: number; starts_at?: Date | string;
  match_entry_coins?: number;
  match_status?: string;
  title?: string; prize_pool?: number; rules?: string; banner?: string; image_url?: string | null; prize_distribution?: string;
  enabled?: boolean; is_full?: boolean; room_id?: string | null; room_password?: string | null;
  room_time?: string; room_published?: boolean; registered_count?: number;
  registered_player_count?: number;
  match_has_winner?: boolean; match_has_started?: boolean;
  squad_team_number?: number | null; squad_slot_number?: number | null;
  squad_is_captain?: boolean | null;
  result_rank?: number | null; result_kills?: number | null; result_prize_coins?: number | null;
  match_results?: {
    rank: number; kills: number; prizeCoins: number; playerName: string; gameName: string; teamName: string;
  }[] | null;
};
export { tournamentCancellationError };

type SqlClient = {
  query<T = unknown>(text: string, values?: unknown[]): Promise<{ rows: T[] }>;
  release(): void;
};

function record(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function fail(res: Response, status: number, error: string, code?: string): void {
  res.status(status).json(code ? { error, code } : { error });
}

function idFrom(req: Request): string | null {
  const id = req.params.id;
  return typeof id === "string" && UUID_PATTERN.test(id) ? id : null;
}

function nonempty(value: unknown, max: number): string | null {
  return typeof value === "string" && value.trim().length > 0 && value.trim().length <= max
    ? value.trim()
    : null;
}

function nonnegativeInt(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0 && value <= 2_147_483_647;
}

export function parseStart(date: unknown, time: unknown): Date | null {
  if (typeof date !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(date) || typeof time !== "string") return null;
  const trimmed = time.trim();
  const twelveHour = /^(\d{1,2}):([0-5]\d)\s*(AM|PM)$/i.exec(trimmed);
  const twentyFourHour = /^([01]\d|2[0-3]):([0-5]\d)$/.exec(trimmed);
  let hour: number;
  let minute: number;
  if (twelveHour) {
    hour = Number(twelveHour[1]) % 12 + (/PM/i.test(twelveHour[3]) ? 12 : 0);
    minute = Number(twelveHour[2]);
  } else if (twentyFourHour) {
    hour = Number(twentyFourHour[1]);
    minute = Number(twentyFourHour[2]);
  } else return null;
  const value = new Date(`${date}T${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}:00.000Z`);
  if (!Number.isFinite(value.getTime()) || value.toISOString().slice(0, 10) !== date ||
      !isTournamentStartInFuture(value)) return null;
  return value;
}

export function legacyMode(body: Record<string, unknown>): string | null {
  return resolveTournamentMode(body.mode, body.teamType)?.storageMode ?? null;
}

export function referralSignupStatus(referralCode: string | null): "pending" | "none" {
  return referralCode ? "pending" : "none";
}

export function parseOptionalReferralCode(value: unknown): { valid: boolean; code: string | null } {
  if (value === undefined || value === null) return { valid: true, code: null };
  if (typeof value !== "string") return { valid: false, code: null };
  if (!value.trim()) return { valid: true, code: null };
  const code = nonempty(value, 64);
  return { valid: Boolean(code), code };
}

export function canApproveWithinCapacity(activeCount: number, capacity: number): boolean {
  return Number.isInteger(activeCount) && Number.isInteger(capacity) &&
    activeCount >= 0 && capacity > 0 && activeCount <= capacity;
}

export function matchCapacityState(mode: string, activeCount: number, capacity: number): {
  isFull: boolean; status: "open" | "full" | "setup_needed";
} {
  const isFull = activeCount >= capacity;
  return {
    isFull,
    status: isFull ? (mode === "clash" ? "setup_needed" : "full") : "open",
  };
}

export function isTeamEditWindowOpen(startsAt: Date | string, now: Date | string | number): boolean {
  const startMs = startsAt instanceof Date ? startsAt.getTime() : Date.parse(String(startsAt));
  const nowMs = now instanceof Date ? now.getTime() : typeof now === "number" ? now : Date.parse(String(now));
  return Number.isFinite(startMs) && Number.isFinite(nowMs) && nowMs < startMs - 30 * 60 * 1000;
}

export function effectiveTournamentStatus(row: Pick<MatchRow, "has_winner" | "has_started" | "enabled" | "status">): string {
  if (row.status === "cancelled") return "cancelled";
  if (row.has_winner && !row.enabled) return "completed";
  if (row.has_started) return "ongoing";
  return row.enabled ? row.status : "closed";
}

function startsAsLegacy(value: Date | string): { date: string; time: string } {
  const date = new Date(value);
  return {
    date: date.toISOString().slice(0, 10),
    time: new Intl.DateTimeFormat("en-US", {
      timeZone: "UTC", hour: "2-digit", minute: "2-digit", hour12: true,
    }).format(date),
  };
}

function tournament(row: MatchRow, includeRoomCredentials = false) {
  const { date, time } = startsAsLegacy(row.starts_at);
  const mode = legacyTournamentMode(row.mode, row.game_mode, row.team_type);
  const filledSlots = Number(row.registered_count ?? 0);
  return {
    id: row.id,
    name: row.title,
    mode: mode.gameModeLabel,
    gameMode: mode.gameMode,
    teamType: mode.teamTypeLabel,
    teamSize: mode.teamSize,
    slotUnit: mode.slotUnit,
    date,
    time,
    startsAt: tournamentInstantFromStored(row.starts_at).toISOString(),
    completedAt: row.completed_at ? new Date(row.completed_at).toISOString() : null,
    entryCoins: row.entry_coins,
    prizePool: row.prize_pool,
    totalSlots: row.capacity,
    totalPlayerSlots: row.capacity * mode.teamSize,
    rules: row.rules,
    banner: row.banner,
    imageUrl: row.image_url ?? null,
    prizeDist: row.prize_distribution,
    enabled: row.enabled,
    status: effectiveTournamentStatus(row),
    filledSlots,
    filledPlayerSlots: Number(row.registered_player_count ?? filledSlots * mode.teamSize),
    availableSlots: Math.max(0, row.capacity - filledSlots),
    capacityLabel: tournamentModeCapacityLabel({ ...mode, capacity: row.capacity }),
    ...(includeRoomCredentials
      ? { roomId: row.room_id, roomPassword: row.room_password, roomTime: row.room_time }
      : {}),
    roomPublished: row.room_published,
  };
}

async function getMatches(id?: string, enabledOnly = false): Promise<MatchRow[]> {
  const clauses: string[] = [];
  const values: unknown[] = [];
  if (id) {
    values.push(id);
    clauses.push(`m.id = $${values.length}`);
  } else clauses.push("m.status <> 'cancelled'");
  if (enabledOnly) clauses.push("m.enabled = true");
  const result = await pool.query<MatchRow>(
    `SELECT m.id, m.title, m.mode, m.game_mode, m.team_type, m.capacity, m.entry_coins, m.prize_pool, m.starts_at,
            m.status, m.is_full, m.rules, m.banner, m.image_url, m.prize_distribution, m.enabled,
            m.room_id, m.room_password, m.room_time, m.room_published,
            m.starts_at <= clock_timestamp() + interval '5 hours 30 minutes' AS has_started,
            EXISTS (
              SELECT 1 FROM daily007_v2_result_awards award
               WHERE award.match_id = m.id AND award.rank = 1
            ) AS has_winner,
             (SELECT max(result_award.created_at)
                FROM daily007_v2_result_awards result_award
               WHERE result_award.match_id = m.id AND result_award.rank = 1) AS completed_at,
             CASE
              WHEN m.team_type IN ('duo', 'squad') OR
                   (m.game_mode IS NULL AND m.mode IN ('squad', 'clash')) THEN
                 (SELECT count(DISTINCT COALESCE(team.id::text, active.id::text))::integer
                    FROM daily007_v2_registrations active
                    LEFT JOIN daily007_v2_squad_team_members member
                      ON member.registration_id = active.id AND member.is_active = true
                    LEFT JOIN daily007_v2_squad_teams team ON team.id = member.team_id
                   WHERE active.match_id = m.id AND active.status IN ('approved', 'pending'))
               ELSE count(r.id) FILTER (WHERE r.status IN ('approved', 'pending'))::integer
             END AS registered_count,
             CASE
               WHEN m.mode = 'squad' AND (m.game_mode IS NULL OR
                    (m.game_mode = 'battle_royale' AND m.team_type = 'squad')) THEN
                 (SELECT COALESCE(sum(
                           CASE WHEN EXISTS (
                             SELECT 1 FROM daily007_v2_squad_team_members member
                              WHERE member.registration_id = active.id AND member.is_active = true
                            ) THEN (
                              SELECT count(*) FROM daily007_v2_squad_team_members member
                               WHERE member.registration_id = active.id AND member.is_active = true
                            ) ELSE 1 + (
                              SELECT count(*) FROM daily007_v2_roster roster
                               WHERE roster.registration_id = active.id
                            ) END
                         ), 0)::integer
                    FROM daily007_v2_registrations active
                   WHERE active.match_id = m.id AND active.status IN ('approved', 'pending'))
               ELSE count(r.id) FILTER (WHERE r.status IN ('approved', 'pending'))::integer *
                    CASE WHEN m.team_type = 'duo' THEN 2
                         WHEN m.team_type = 'squad' OR m.mode IN ('squad', 'clash') THEN 4
                         ELSE 1 END
             END AS registered_player_count
       FROM daily007_v2_matches m
       LEFT JOIN daily007_v2_registrations r ON r.match_id = m.id
      ${clauses.length ? `WHERE ${clauses.join(" AND ")}` : ""}
      GROUP BY m.id
      ORDER BY m.starts_at ASC`,
    values,
  );
  return result.rows;
}

router.post("/auth/register", async (req, res): Promise<void> => {
  const body = req.body as unknown;
  if (!record(body)) return fail(res, 400, "Expected name, email, and password.");
  const name = nonempty(body.name, 100);
  const email = typeof body.email === "string" ? body.email.trim().toLowerCase() : "";
  const phone = body.phone === undefined || body.phone === "" ? null : nonempty(body.phone, 40);
  const gameUid = body.gameUid === undefined || body.gameUid === "" ? null : nonempty(body.gameUid, 128);
  const referral = parseOptionalReferralCode(body.referralCode);
  const referralCode = referral.code;
  if (!name || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || email.length > 254) {
    return fail(res, 400, "Name and a valid email address are required.");
  }
  if (typeof body.password !== "string" || body.password.length < 8 || body.password.length > 200) {
    return fail(res, 400, "Password must contain 8–200 characters.");
  }
  if ((body.phone !== undefined && body.phone !== "" && !phone) ||
      (body.gameUid !== undefined && body.gameUid !== "" && !gameUid) ||
      !referral.valid) {
    return fail(res, 400, "Optional phone, gameUid, and referralCode fields are invalid.");
  }
  const configuredSecret = process.env.DAILY007_AUTH_SECRET || process.env.SESSION_SECRET;
  if (!configuredSecret || configuredSecret.length < 32) {
    return fail(res, 503, "Daily007 authentication needs DAILY007_AUTH_SECRET or SESSION_SECRET (at least 32 characters).");
  }
  const credentials = await hashPassword(body.password);
  try {
    const signup = await transaction(async (client) => {
      const result = await client.query<{
        id: string; name: string; email: string; phone: string | null; game_uid: string | null;
        role: string; status: string; wallet_coins: number;
      }>(
        `INSERT INTO daily007_v2_users (name, email, phone, game_uid, referral_code, password_salt, password_hash)
         VALUES ($1, $2, $3, $4, $5, $6, $7)
         RETURNING id, name, email, phone, game_uid, role, status, wallet_coins`,
        [name, email, phone, gameUid, referralCode, credentials.salt, credentials.hash],
      );
      const user = result.rows[0];
      await ensureDaily007ReferralCode(client, user.id);
      user.wallet_coins = await awardDaily007SignupBonus(client, referralCode, user.id);
      return { user, referralStatus: referralSignupStatus(referralCode) };
    });
    const { user, referralStatus } = signup;
    const token = makeToken(user.id, 0);
    if (!token) return fail(res, 503, "Daily007 authentication is not configured.");
    res.status(201).json({ ...asLegacyUser(user), token, referralStatus });
  } catch (error) {
    if ((error as { code?: string }).code === "23505") return fail(res, 409, "An account with this email already exists.");
    const status = (error as { status?: number }).status;
    if (status) return fail(res, status, (error as Error).message);
    throw error;
  }
});

function asLegacyUser(user: {
  id: string; name: string; email: string; phone?: string | null; game_uid?: string | null;
  role: string; status?: string; wallet_coins: number;
}) {
  return {
    id: user.id, name: user.name, email: user.email, phone: user.phone ?? "",
    gameUid: user.game_uid ?? "", role: user.role, status: user.status ?? "active",
    coins: user.wallet_coins, walletCoins: user.wallet_coins,
  };
}

router.post("/auth/login", async (req, res): Promise<void> => {
  const body = req.body as unknown;
  if (!record(body) || typeof body.email !== "string" || typeof body.password !== "string") {
    return fail(res, 400, "Email and password are required.");
  }
  if (!(await checkDaily007LoginThrottle(req, res))) return;
  const result = await pool.query<{
    id: string; name: string; email: string; phone: string | null; game_uid: string | null;
    role: string; status: string; wallet_coins: number; password_salt: string; password_hash: string;
  }>(
    `SELECT id, name, email, phone, game_uid, role, status, wallet_coins, password_salt, password_hash
       FROM daily007_v2_users WHERE email = $1`,
    [body.email.trim().toLowerCase()],
  );
  const user = result.rows[0];
  if (body.password.length > 200) return fail(res, 401, DAILY007_LOGIN_FAILURE_MESSAGE);
  const passwordMatches = await verifyDaily007LoginPassword(body.password, user ?? null, hashPassword);
  if (!passwordMatches || user?.status === "blocked") {
    return fail(res, 401, DAILY007_LOGIN_FAILURE_MESSAGE);
  }
  const rotated = await pool.query<{ auth_version: number }>(
    `UPDATE daily007_v2_users
        SET auth_version = auth_version + 1
      WHERE id = $1 AND status = 'active'
      RETURNING auth_version`,
    [user.id],
  );
  if (!rotated.rows[0]) {
    return fail(res, 401, DAILY007_LOGIN_FAILURE_MESSAGE);
  }
  const token = makeToken(user.id, rotated.rows[0].auth_version);
  if (!token) return fail(res, 503, "Daily007 authentication is not configured.");
  res.json({ ...asLegacyUser(user), token });
});

router.get("/auth/me", authenticate, async (req, res): Promise<void> => {
  const account = req.daily007Account;
  if (!account) {
    fail(res, 401, "Authentication is required.");
    return;
  }
  const googleLinked = await getDaily007GoogleLinkStatus(account.id);
  res.json({ ...asLegacyUser(account), googleLinked });
});

router.patch("/auth/me/password", authenticate, async (req, res): Promise<void> => {
  const account = req.daily007Account;
  const input = parsePasswordChangeInput(req.body as unknown);
  if (!account || !input) {
    fail(res, 400, "Enter your current password and a new password of 8–200 characters.");
    return;
  }
  const requestFingerprintSecret = process.env.DAILY007_AUTH_SECRET || process.env.SESSION_SECRET;
  if (input.requestId && (!requestFingerprintSecret || requestFingerprintSecret.length < 32)) {
    fail(res, 503, "Daily007 password-change recovery is temporarily unavailable.");
    return;
  }
  const requestFingerprint = input.requestId
    ? createPasswordChangeRequestFingerprint(account.id, input, requestFingerprintSecret!)
    : null;

  const attempt = await reservePasswordChangeAttempt(account.id);
  if (!attempt.allowed) {
    res.setHeader("Retry-After", String(attempt.retryAfterSeconds));
    fail(
      res,
      429,
      `Too many password-change attempts. Wait ${attempt.retryAfterSeconds} seconds before trying again.`,
    );
    return;
  }

  let outcome: "incorrect" | "correct" | "replayed" | "abandoned" = "abandoned";
  try {
    const credentials = await pool.query<{
      password_salt: string;
      password_hash: string;
      password_change_request_id: string | null;
      password_change_request_fingerprint: string | null;
    }>(
      "SELECT password_salt, password_hash, password_change_request_id, password_change_request_fingerprint FROM daily007_v2_users WHERE id = $1",
      [account.id],
    );
    const stored = credentials.rows[0];
    if (!stored) {
      fail(res, 404, "Account not found.");
      return;
    }

    const matchesStoredPassword = async (password: string, saltHex: string, hashHex: string) => {
      const candidatePassword = await hashPassword(password, Buffer.from(saltHex, "hex"));
      return passwordHashesMatch(
        Buffer.from(candidatePassword.hash, "hex"),
        Buffer.from(hashHex, "hex"),
      );
    };
    const candidate = await hashPassword(input.currentPassword, Buffer.from(stored.password_salt, "hex"));
    if (!passwordHashesMatch(Buffer.from(candidate.hash, "hex"), Buffer.from(stored.password_hash, "hex"))) {
      const isSameCompletedRequest =
        input.requestId != null &&
        stored.password_change_request_id === input.requestId &&
        passwordChangeRequestFingerprintsMatch(
          requestFingerprint,
          stored.password_change_request_fingerprint,
        );
      if (
        isSameCompletedRequest
        && await matchesStoredPassword(input.newPassword, stored.password_salt, stored.password_hash)
      ) {
      // A matching request ID and keyed payload fingerprint are recorded
      // atomically with the password update. Confirming that exact committed
      // operation does not consume another incorrect-password failure.
        outcome = "replayed";
        res.json({ message: "Password change already applied. Other signed-in sessions remain active." });
        return;
      }
      // Keep the pre-existing response behavior for older clients that do not
      // send a request ID; their replay still counts toward the attempt limit.
      if (
        input.requestId == null
        && await matchesStoredPassword(input.newPassword, stored.password_salt, stored.password_hash)
      ) {
        outcome = "incorrect";
        res.json({ message: "Password change already applied. Other signed-in sessions remain active." });
        return;
      }
      outcome = "incorrect";
      fail(res, 401, "Current password is incorrect.", "CURRENT_PASSWORD_INCORRECT");
      return;
    }

    outcome = "correct";
    const replacement = await hashPassword(input.newPassword);
    const updated = await pool.query<{ id: string }>(
      `UPDATE daily007_v2_users
          SET password_salt = $2, password_hash = $3,
              password_change_request_id = $6,
              password_change_request_fingerprint = $7
        WHERE id = $1 AND password_salt = $4 AND password_hash = $5
        RETURNING id`,
      [
        account.id,
        replacement.salt,
        replacement.hash,
        stored.password_salt,
        stored.password_hash,
        input.requestId ?? null,
        requestFingerprint,
      ],
    );
    if (!updated.rows[0]) {
      const latestCredentials = await pool.query<{
        password_salt: string;
        password_hash: string;
        password_change_request_id: string | null;
        password_change_request_fingerprint: string | null;
      }>(
        "SELECT password_salt, password_hash, password_change_request_id, password_change_request_fingerprint FROM daily007_v2_users WHERE id = $1",
        [account.id],
      );
      const latest = latestCredentials.rows[0];
      if (
        latest
        && (
          (
            input.requestId != null &&
            latest.password_change_request_id === input.requestId &&
            passwordChangeRequestFingerprintsMatch(
              requestFingerprint,
              latest.password_change_request_fingerprint,
            )
          )
          || input.requestId == null
        )
        && await matchesStoredPassword(input.newPassword, latest.password_salt, latest.password_hash)
      ) {
        res.json({ message: "Password change already applied. Other signed-in sessions remain active." });
        return;
      }
      fail(res, 409, "The password changed in another session. Sign in again and retry.");
      return;
    }

    res.json({ message: "Password changed. Other signed-in sessions remain active." });
  } finally {
    await finishPasswordChangeAttempt(account.id, attempt.windowId, outcome);
  }
});

router.patch("/auth/me", authenticate, async (req, res): Promise<void> => {
  const account = req.daily007Account;
  const body = req.body as unknown;
  if (!account || !record(body)) return fail(res, 400, "Expected profile fields.");
  const allowed = ["name", "phone", "gameUid"];
  if (!allowed.some((key) => Object.hasOwn(body, key))) return fail(res, 400, "Provide name, phone, or gameUid to update.");
  const name = body.name === undefined ? undefined : nonempty(body.name, 100);
  const phone = body.phone === undefined ? undefined : body.phone === "" ? null : nonempty(body.phone, 40);
  const gameUid = body.gameUid === undefined ? undefined : body.gameUid === "" ? null : nonempty(body.gameUid, 128);
  if ((body.name !== undefined && !name) ||
      (body.phone !== undefined && body.phone !== "" && !phone) ||
      (body.gameUid !== undefined && body.gameUid !== "" && !gameUid) ||
      Object.keys(body).some((key) => !allowed.includes(key))) {
    return fail(res, 400, "Profile fields are invalid; name is 1–100 characters, phone up to 40, and gameUid up to 128.");
  }
  const result = await pool.query<{
    id: string; name: string; email: string; phone: string | null; game_uid: string | null;
    role: string; status: string; wallet_coins: number;
  }>(
    `UPDATE daily007_v2_users
        SET name = COALESCE($2, name), phone = CASE WHEN $3 THEN $4 ELSE phone END,
            game_uid = CASE WHEN $5 THEN $6 ELSE game_uid END
      WHERE id = $1
      RETURNING id, name, email, phone, game_uid, role, status, wallet_coins`,
    [account.id, name ?? null, body.phone !== undefined, phone ?? null, body.gameUid !== undefined, gameUid ?? null],
  );
  if (!result.rows[0]) return fail(res, 404, "Account not found.");
  res.json(asLegacyUser(result.rows[0]));
});

router.get("/tournaments", async (req, res): Promise<void> => {
  const enabledOnly = req.query.enabled === "true";
  res.json((await getMatches(undefined, enabledOnly)).map((row) => tournament(row)));
});

router.get("/tournaments/:id/results", async (req, res): Promise<void> => {
  const id = idFrom(req);
  if (!id) return fail(res, 400, "Tournament id must be a UUID.");

  const match = await pool.query<{ enabled: boolean; status: string }>(
    "SELECT enabled, status FROM daily007_v2_matches WHERE id = $1",
    [id],
  );
  if (!match.rows[0]) return fail(res, 404, "Tournament not found.");

  const result = await pool.query<{
    registration_id: string;
    rank: number;
    kills: number;
    prize_coins: number;
    game_name: string;
    team_name: string | null;
    created_at: Date | string;
  }>(
    `SELECT award.registration_id, award.rank, award.kills, award.prize_coins,
            COALESCE(NULLIF(BTRIM(registration.captain_game_name), ''), 'Player') AS game_name,
            NULLIF(BTRIM(registration.team_name), '') AS team_name,
            award.created_at
       FROM daily007_v2_result_awards award
       JOIN daily007_v2_registrations registration ON registration.id = award.registration_id
      WHERE award.match_id = $1
      ORDER BY award.rank, award.created_at, award.registration_id`,
    [id],
  );

  const currentMatch = await pool.query<{ enabled: boolean; status: string }>(
    "SELECT enabled, status FROM daily007_v2_matches WHERE id = $1",
    [id],
  );
  const winner = result.rows.find((row) => Number(row.rank) === 1);
  const current = currentMatch.rows[0];
  const finalized = current?.enabled === false &&
    current.status !== "cancelled" &&
    Boolean(winner);
  res.json({
    tournamentId: id,
    status: finalized ? "finalized" : "draft",
    finalizedAt: finalized && winner ? new Date(winner.created_at).toISOString() : null,
    entries: finalized ? result.rows.map((row) => ({
      rank: row.rank,
      kills: row.kills,
      prizeCoins: row.prize_coins,
      gameName: row.game_name,
      teamName: row.team_name,
    })) : [],
  });
});

type PublicTournamentParticipant = {
  groupNumber: number | null;
  teamName: string | null;
  players: string[];
  status: "approved" | "pending";
};

async function getPublicTournamentParticipants(tournamentId: string): Promise<PublicTournamentParticipant[]> {
  const matchMode = await pool.query<{
    mode: string; game_mode: string | null; team_type: string | null; capacity: number;
  }>(
    "SELECT mode, game_mode, team_type, capacity FROM daily007_v2_matches WHERE id = $1",
    [tournamentId],
  );
  const currentMode = matchMode.rows[0];
  const resolvedMode = currentMode
    ? legacyTournamentMode(currentMode.mode, currentMode.game_mode, currentMode.team_type)
    : null;
  if (resolvedMode && resolvedMode.teamSize > 1 && currentMode) {
    await transaction(async (client) => {
      await client.query("SELECT id FROM daily007_v2_matches WHERE id = $1 FOR UPDATE", [tournamentId]);
      await ensureLegacySquadTeams(
        client,
        tournamentId,
        Number(currentMode.capacity),
        resolvedMode.teamSize,
      );
    });
    const squadRows = await pool.query<{
      team_number: number; status: "approved" | "pending"; team_name: string;
      slot_number: number; game_name: string | null;
    }>(
      `SELECT team.team_number, member.slot_number,
              COALESCE(registration.status, legacy.status) AS status,
              COALESCE(NULLIF(BTRIM(legacy.team_name), ''),
                       'Team ' || LPAD(team.team_number::text, 2, '0')) AS team_name,
              COALESCE(registration.captain_game_name, member.legacy_game_name) AS game_name
         FROM daily007_v2_squad_teams team
         JOIN daily007_v2_squad_team_members member
           ON member.team_id = team.id AND member.is_active = true
         LEFT JOIN daily007_v2_registrations registration
           ON registration.id = member.registration_id
         LEFT JOIN daily007_v2_registrations legacy
           ON legacy.id = team.legacy_registration_id
        WHERE team.match_id = $1
          AND (
            registration.status IN ('approved', 'pending')
            OR (member.registration_id IS NULL AND legacy.status IN ('approved', 'pending'))
          )
         ORDER BY team.team_number, member.slot_number`,
      [tournamentId],
    );
    const byTeam = new Map<number, PublicTournamentParticipant>();
    for (const row of squadRows.rows) {
      let team = byTeam.get(Number(row.team_number));
      if (!team) {
        team = {
          groupNumber: Number(row.team_number),
          teamName: row.team_name,
          players: Array.from({ length: resolvedMode.teamSize }, () => ""),
          status: row.status,
        };
        byTeam.set(Number(row.team_number), team);
      }
      const gameName = row.game_name?.trim();
      if (gameName) team.players[Number(row.slot_number) - 1] = gameName;
    }
    const participants = [...byTeam.values()];
    for (const participant of participants) {
      while (participant.players.at(-1) === "") participant.players.pop();
    }
    return participants;
  }
  const result = await pool.query<{
    registration_id: string;
    assigned_group_number: number | null;
    status: "approved" | "pending";
    team_name: string | null;
    captain_game_name: string;
    position: number | null;
    member_name: string | null;
  }>(
    `SELECT r.id AS registration_id, r.assigned_group_number, r.status,
            NULLIF(BTRIM(r.team_name), '') AS team_name,
            r.captain_game_name, roster.position, roster.member_name
       FROM daily007_v2_registrations r
       LEFT JOIN daily007_v2_roster roster ON roster.registration_id = r.id
      WHERE r.match_id = $1 AND r.status IN ('approved', 'pending')
      ORDER BY r.created_at, r.id, roster.position`,
    [tournamentId],
  );
  const byRegistration = new Map<string, PublicTournamentParticipant>();
  for (const row of result.rows) {
    let participant = byRegistration.get(row.registration_id);
    if (!participant) {
      participant = {
        groupNumber: row.assigned_group_number === null
          ? null
          : Number(row.assigned_group_number),
        teamName: row.team_name?.trim() || null,
        players: row.captain_game_name.trim() ? [row.captain_game_name.trim()] : [],
        status: row.status,
      };
      byRegistration.set(row.registration_id, participant);
    }
    const teammateName = row.member_name?.trim();
    if (row.position !== null && teammateName) participant.players.push(teammateName);
  }
  const participants = [...byRegistration.values()];
  const capacity = resolvedMode?.capacity ?? participants.length;
  const usedGroups = new Set(
    participants
      .map((participant) => participant.groupNumber)
      .filter((groupNumber): groupNumber is number =>
        groupNumber !== null && Number.isSafeInteger(groupNumber) &&
        groupNumber >= 1 && groupNumber <= capacity),
  );
  const availableGroups = Array.from({ length: capacity }, (_, index) => index + 1)
    .filter((groupNumber) => !usedGroups.has(groupNumber));
  for (const participant of participants) {
    if (participant.groupNumber !== null) continue;
    participant.groupNumber = availableGroups.shift() ?? null;
  }
  for (const participant of participants) {
    while (participant.players.at(-1) === "") participant.players.pop();
  }
  return participants;
}

router.get("/tournaments/:id/participants", async (req, res): Promise<void> => {
  const id = idFrom(req);
  if (!id) return fail(res, 400, "Tournament id must be a UUID.");
  const match = await pool.query<{ id: string }>(
    "SELECT id FROM daily007_v2_matches WHERE id = $1",
    [id],
  );
  if (!match.rows[0]) return fail(res, 404, "Tournament not found.");
  res.json({ tournamentId: id, participants: await getPublicTournamentParticipants(id) });
});

router.get("/tournaments/:id", async (req, res): Promise<void> => {
  const id = idFrom(req);
  if (!id) return fail(res, 400, "Tournament id must be a UUID.");
  const result = await getMatches(id);
  if (!result[0]) return fail(res, 404, "Tournament not found.");
  res.json(tournament(result[0]));
});

router.post("/admin/tournaments/:id/lifecycle", authenticate, async (req, res): Promise<void> => {
  if (!requireTournamentAdmin(req, res)) return;
  const id = idFrom(req);
  if (!id) return fail(res, 400, "Tournament id must be a UUID.");
  if (!record(req.body) || req.body.status !== "cancelled") {
    return fail(res, 400, "Only tournament cancellation is supported by this lifecycle action.");
  }

  try {
    const cancellation = await cancelUnderfilledTournamentAndRefund(id);
    if (!cancellation) return fail(res, 409, "Tournament is not eligible for cancellation.");
    res.json({ success: true, data: cancellation });
  } catch (error) {
    const status = Number((error as { status?: number })?.status);
    if (status === 400 || status === 404 || status === 409) {
      return fail(res, status, error instanceof Error ? error.message : "Tournament cancellation was rejected.");
    }
    console.error("[daily007] tournament cancellation failed", error);
    return fail(res, 500, "Could not cancel this tournament.");
  }
});

function tournamentValues(body: Record<string, unknown>, fallback?: MatchRow) {
  const previousMode = fallback
    ? legacyTournamentMode(fallback.mode, fallback.game_mode, fallback.team_type)
    : null;
  const configuredMode = resolveTournamentMode(
    body.mode === undefined ? previousMode?.gameMode : body.mode,
    body.teamType === undefined ? previousMode?.teamType : body.teamType,
  );
  const title = body.name === undefined && fallback ? fallback.title : nonempty(body.name, 100);
  const entryCoins = body.entryCoins === undefined && fallback ? fallback.entry_coins : body.entryCoins;
  const prizePool = body.prizePool === undefined && fallback ? fallback.prize_pool : body.prizePool;
  const rules = body.rules === undefined && fallback
    ? fallback.rules
    : typeof body.rules === "string" && body.rules.length <= 10_000 ? body.rules : null;
  const banner = body.banner === undefined && fallback ? fallback.banner : nonempty(body.banner, 100);
  const parsedImageUrl = body.imageUrl === undefined && fallback
    ? { ok: true as const, value: fallback.image_url ?? null }
    : parseOptionalHttpsImageUrl(body.imageUrl);
  const prizeDistribution = body.prizeDist === undefined && fallback
    ? fallback.prize_distribution
    : typeof body.prizeDist === "string" && body.prizeDist.length <= 10_000 ? body.prizeDist : null;
  let startsAt: Date | null = null;
  if (body.date !== undefined || body.time !== undefined) {
    const existing = fallback ? startsAsLegacy(fallback.starts_at) : null;
    startsAt = parseStart(body.date ?? existing?.date, body.time ?? existing?.time);
  } else if (fallback) startsAt = new Date(fallback.starts_at);
  if (body.enabled !== undefined && typeof body.enabled !== "boolean") return null;
  if (!configuredMode || !title || !nonnegativeInt(entryCoins) ||
      !nonnegativeInt(prizePool) || rules === null || !banner || !parsedImageUrl.ok || prizeDistribution === null ||
      !startsAt || !Number.isFinite(startsAt.getTime()) || !isTournamentStartInFuture(startsAt)) return null;
  return {
    mode: configuredMode.storageMode, gameMode: configuredMode.gameMode,
    teamType: configuredMode.teamType, title, capacity: configuredMode.capacity,
    entryCoins, prizePool, startsAt,
    rules, banner, imageUrl: parsedImageUrl.value, prizeDistribution,
    enabled: body.enabled === undefined ? fallback?.enabled ?? true : body.enabled,
  };
}

router.post("/tournaments", authenticate, async (req, res): Promise<void> => {
  if (!requireTournamentAdmin(req, res)) return;
  if (!record(req.body)) return fail(res, 400, "Expected tournament fields.");
  const values = tournamentValues(req.body);
  if (!values) return fail(res, 400, "Tournament fields are invalid; use a supported game mode, future date/time, nonnegative integer coin values, and an optional HTTPS image URL.");
  const result = await pool.query(
    `INSERT INTO daily007_v2_matches
       (title, mode, game_mode, team_type, capacity, entry_coins, prize_pool, starts_at, rules, banner, image_url, prize_distribution, enabled)
     SELECT $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13
       WHERE $8::timestamptz > clock_timestamp() + interval '5 hours 30 minutes'
     RETURNING id`,
    [values.title, values.mode, values.gameMode, values.teamType, values.capacity, values.entryCoins,
       values.prizePool, values.startsAt, values.rules, values.banner, values.imageUrl, values.prizeDistribution, values.enabled],
  );
  if (!result.rows[0]) return fail(res, 400, "Tournament start time must still be in the future.");
  const created = await getMatches(result.rows[0].id as string);
  res.status(201).json(tournament(created[0]));
});

router.patch("/tournaments/:id", authenticate, async (req, res): Promise<void> => {
  if (!requireTournamentAdmin(req, res)) return;
  const id = idFrom(req);
  if (!id) return fail(res, 400, "Tournament id must be a UUID.");
  if (!record(req.body)) return fail(res, 400, "Expected tournament fields.");
  try {
    const outcome = await transaction(async (client) => {
      const selected = await client.query<MatchRow>(
        `SELECT id, title, mode, game_mode, team_type, capacity, entry_coins, prize_pool, starts_at,
                status, is_full, rules, banner, image_url, prize_distribution, enabled,
                room_id, room_password, room_time, room_published, 0::integer AS registered_count
           FROM daily007_v2_matches WHERE id = $1 FOR UPDATE`,
        [id],
      );
      const current = selected.rows[0];
      if (!current) return "missing" as const;
      const values = tournamentValues(req.body as Record<string, unknown>, current);
      if (!values) return "invalid" as const;
      const currentMode = legacyTournamentMode(current.mode, current.game_mode, current.team_type);
      let activeCount: number;
      if (currentMode.teamSize > 1) {
        await ensureLegacySquadTeams(client, id, Number(current.capacity), currentMode.teamSize);
        activeCount = (await getSquadOccupancy(client, id)).filledPlayers;
      } else {
        const count = await client.query<{ count: string }>(
          "SELECT count(*)::text AS count FROM daily007_v2_registrations WHERE match_id = $1 AND status IN ('approved', 'pending')",
          [id],
        );
        activeCount = Number(count.rows[0].count);
      }
      const modeChanged = currentMode.gameMode !== values.gameMode || currentMode.teamType !== values.teamType;
      const nextMode = resolveTournamentMode(values.gameMode, values.teamType);
      if (!nextMode) return "invalid" as const;
      const nextPlayerCapacity = values.capacity * nextMode.teamSize;
      if (activeCount > nextPlayerCapacity || (modeChanged && activeCount > 0)) {
        return "capacity" as const;
      }
      const capacityState = matchCapacityState(values.mode, activeCount, nextPlayerCapacity);
      const updated = await client.query<{ id: string }>(
        `UPDATE daily007_v2_matches
            SET title = $2, mode = $3, game_mode = $4, team_type = $5, capacity = $6,
                 entry_coins = $7, prize_pool = $8, starts_at = $9, rules = $10, banner = $11,
                 image_url = $12, prize_distribution = $13, enabled = $14, is_full = $15, status = $16
          WHERE id = $1 AND $9::timestamptz > clock_timestamp() + interval '5 hours 30 minutes'
          RETURNING id`,
        [id, values.title, values.mode, values.gameMode, values.teamType, values.capacity,
           values.entryCoins, values.prizePool, values.startsAt, values.rules, values.banner,
           values.imageUrl, values.prizeDistribution, values.enabled,
          capacityState.isFull, capacityState.status],
      );
      // A time can pass while validation/locking is in progress.
      if (!updated.rows[0]) return "invalid" as const;
      return "updated" as const;
    });
    if (outcome === "missing") return fail(res, 404, "Tournament not found.");
     if (outcome === "invalid") return fail(res, 400, "Tournament fields are invalid; use a supported game mode, future date/time, nonnegative integer coin values, and an optional HTTPS image URL.");
    if (outcome === "capacity") return fail(res, 409, "Capacity or game mode cannot be reduced/changed below the current active registration count.");
  } catch (error) {
    throw error;
  }
  res.json(tournament((await getMatches(id))[0]));
});

router.delete("/tournaments/:id", authenticate, async (req, res): Promise<void> => {
  if (!requireTournamentAdmin(req, res)) return;
  const id = idFrom(req);
  if (!id) return fail(res, 400, "Tournament id must be a UUID.");
  const current = (await getMatches(id))[0];
  if (!current) return fail(res, 404, "Tournament not found.");
  const history = await pool.query<{ has_registrations: boolean; has_wallet_history: boolean; has_awards: boolean }>(
    `SELECT
       EXISTS (SELECT 1 FROM daily007_v2_registrations WHERE match_id = $1) AS has_registrations,
       EXISTS (SELECT 1 FROM daily007_v2_wallet_ledger WHERE match_id = $1) AS has_wallet_history,
       EXISTS (SELECT 1 FROM daily007_v2_result_awards WHERE match_id = $1) AS has_awards`,
    [id],
  );
  const hasHistory = history.rows[0]?.has_registrations ||
    history.rows[0]?.has_wallet_history || history.rows[0]?.has_awards;
  if (hasHistory) {
    await pool.query("UPDATE daily007_v2_matches SET enabled = false WHERE id = $1", [id]);
    res.json({ success: true, data: { id, enabled: false, deleted: false, closed: true } });
    return;
  }
  await pool.query("DELETE FROM daily007_v2_matches WHERE id = $1", [id]);
  res.json({ success: true, data: { id, deleted: true } });
});

async function getRoster(registrationId: string) {
  const result = await pool.query<{ position: number; member_name: string; member_uid: string | null }>(
    "SELECT position, member_name, member_uid FROM daily007_v2_roster WHERE registration_id = $1 ORDER BY position",
    [registrationId],
  );
  return result.rows;
}

function asTeamMembers(row: RegistrationRow, roster: { position: number; member_name: string; member_uid: string | null }[]) {
  return JSON.stringify([
    { name: row.captain_game_name, uid: row.captain_game_uid, ign: row.captain_game_name },
    ...roster.map((member) => ({ name: member.member_name, uid: member.member_uid ?? "", ign: "" })),
  ]);
}

function mayExposeRoom(row: RegistrationRow, nowMs = Date.now()): boolean {
  return canRevealRoomCredentials({
    registrationStatus: row.status,
    tournamentStatus: row.match_status ?? "",
    roomId: row.room_id ?? null,
    roomPassword: row.room_password ?? null,
    startsAt: row.starts_at ? tournamentInstantFromStored(row.starts_at) : null,
  }, nowMs);
}

router.get("/my/registrations", authenticate, async (req, res): Promise<void> => {
  res.setHeader("Cache-Control", "no-store");
  const account = req.daily007Account;
  if (!account) return fail(res, 401, "Authentication is required.");
  const result = await pool.query<RegistrationRow>(
    `SELECT r.id, r.match_id, r.captain_user_id, r.captain_name, r.captain_game_name, r.captain_game_uid, r.team_name,
            r.entry_coins_paid, r.status, r.created_at, m.title, m.mode, m.game_mode, m.team_type, m.capacity, m.starts_at,
            m.entry_coins AS match_entry_coins, m.status AS match_status,
            m.prize_pool, m.rules, m.banner, m.image_url, m.prize_distribution, m.enabled, m.is_full,
            m.room_id, m.room_password, m.room_time, m.room_published,
            m.starts_at <= clock_timestamp() + interval '5 hours 30 minutes' AS match_has_started,
            EXISTS (
              SELECT 1 FROM daily007_v2_result_awards match_award
               WHERE match_award.match_id = m.id AND match_award.rank = 1
            ) AS match_has_winner,
             (SELECT json_agg(json_build_object(
                       'rank', published.rank,
                       'kills', published.kills,
                       'prizeCoins', published.prize_coins,
                       'gameName', result_registration.captain_game_name,
                       'teamName', result_registration.team_name
                      ) ORDER BY published.rank, result_registration.captain_game_name)
                FROM daily007_v2_result_awards published
                JOIN daily007_v2_registrations result_registration
                  ON result_registration.id = published.registration_id
                WHERE published.match_id = m.id AND m.status <> 'cancelled') AS match_results,
            award.rank AS result_rank, award.kills AS result_kills, award.prize_coins AS result_prize_coins,
             CASE WHEN m.team_type IN ('duo', 'squad') OR
                         (m.game_mode IS NULL AND m.mode IN ('squad', 'clash')) THEN
               (SELECT count(DISTINCT COALESCE(team.id::text, active.id::text))::integer
                  FROM daily007_v2_registrations active
                  LEFT JOIN daily007_v2_squad_team_members member
                    ON member.registration_id = active.id AND member.is_active = true
                  LEFT JOIN daily007_v2_squad_teams team ON team.id = member.team_id
                 WHERE active.match_id = m.id AND active.status IN ('approved', 'pending'))
             ELSE (SELECT count(*)::integer FROM daily007_v2_registrations active
                    WHERE active.match_id = m.id AND active.status IN ('approved', 'pending'))
             END AS registered_count,
              CASE WHEN m.team_type IN ('duo', 'squad') OR
                        (m.game_mode IS NULL AND m.mode IN ('squad', 'clash')) THEN
               (SELECT COALESCE(sum(
                         CASE WHEN EXISTS (
                           SELECT 1 FROM daily007_v2_squad_team_members member
                            WHERE member.registration_id = active.id AND member.is_active = true
                           ) THEN (
                             SELECT count(*) FROM daily007_v2_squad_team_members member
                              WHERE member.registration_id = active.id AND member.is_active = true
                           ) ELSE 1 + (
                             SELECT count(*) FROM daily007_v2_roster roster
                              WHERE roster.registration_id = active.id
                           ) END
                       ), 0)::integer
                  FROM daily007_v2_registrations active
                 WHERE active.match_id = m.id AND active.status IN ('approved', 'pending'))
             ELSE (SELECT count(*)::integer FROM daily007_v2_registrations active
                    WHERE active.match_id = m.id AND active.status IN ('approved', 'pending')) *
                   CASE WHEN m.team_type = 'duo' THEN 2
                       WHEN m.team_type = 'squad' OR m.mode IN ('squad', 'clash') THEN 4
                       ELSE 1 END
             END AS registered_player_count
       FROM daily007_v2_registrations r JOIN daily007_v2_matches m ON m.id = r.match_id
        LEFT JOIN daily007_v2_result_awards award
          ON award.registration_id = r.id AND m.status <> 'cancelled'
        LEFT JOIN daily007_v2_squad_team_members squad_member
          ON squad_member.registration_id = r.id
        LEFT JOIN daily007_v2_squad_teams squad_team ON squad_team.id = squad_member.team_id
       WHERE r.captain_user_id = $1
      ORDER BY r.created_at DESC`,
    [account.id],
  );
  const serverNowMs = Date.now();
  const data = await Promise.all(result.rows.map(async (row) => {
    const expose = mayExposeRoom(row, serverNowMs);
    const roomPrepared = Boolean(
      row.status === "approved" &&
      row.match_status !== "cancelled" &&
      row.room_id &&
      row.room_password
    );
    const t = tournament({
      ...row, id: row.match_id, title: row.title!, entry_coins: row.match_entry_coins!,
      prize_pool: row.prize_pool!, capacity: row.capacity!, starts_at: row.starts_at!,
      status: row.match_status!,
       has_started: row.match_has_started, has_winner: row.match_has_winner,
       registered_count: row.registered_count!,
       registered_player_count: row.registered_player_count!,
       is_full: row.is_full!, rules: row.rules!,
       banner: row.banner!, image_url: row.image_url ?? null, prize_distribution: row.prize_distribution!, enabled: row.enabled!,
      room_id: row.room_id!, room_password: row.room_password!, room_time: row.room_time!,
      room_published: roomPrepared,
    } as MatchRow, expose);
    const roster = await getRoster(row.id);
    return {
       id: row.id, tournamentId: row.match_id, status: row.status,
      playerName: row.captain_name, captainGameName: row.captain_game_name,
      gameUid: row.captain_game_uid, teamName: row.team_name,
       teamNumber: row.squad_team_number ?? null,
       slotNumber: row.squad_slot_number ?? null,
       isSquadCaptain: legacyTournamentMode(row.mode ?? "solo", row.game_mode, row.team_type).gameMode === "battle_royale" &&
         legacyTournamentMode(row.mode ?? "solo", row.game_mode, row.team_type).teamType === "squad"
         ? row.squad_is_captain ?? false
         : true,
      teamMembers: roster.length ? asTeamMembers(row, roster) : "[]",
      entryCoins: row.entry_coins_paid, createdAt: new Date(row.created_at).toISOString(),
      result: row.result_rank === null || row.result_rank === undefined
        ? undefined
        : `Rank ${row.result_rank} · ${row.result_kills ?? 0} kills · ${row.result_prize_coins ?? 0} coins`,
      resultDetails: row.result_rank === null || row.result_rank === undefined
        ? undefined
        : {
          rank: row.result_rank,
          kills: row.result_kills ?? 0,
          prizeCoins: row.result_prize_coins ?? 0,
          gameName: row.captain_game_name,
          teamName: row.team_name,
        },
      serverNowMs,
      roomId: expose ? row.room_id : undefined,
      roomPassword: expose ? row.room_password : undefined,
      roomTime: expose ? row.room_time : undefined,
      roomPublished: roomPrepared,
       tournament: { ...t, results: row.match_results ?? [] },
    };
  }));
  res.json(data);
});

router.get("/admin/registrations", authenticate, async (req, res): Promise<void> => {
  res.setHeader("Cache-Control", "no-store");
  if (!requireTournamentAdmin(req, res)) return;
  const result = await pool.query<RegistrationRow>(
    `SELECT r.id, r.match_id, r.captain_user_id, r.captain_name, r.captain_game_name, r.captain_game_uid, r.team_name,
            r.entry_coins_paid, r.status, r.created_at, u.name, u.email, m.title, m.mode, m.game_mode, m.team_type,
            m.capacity, m.starts_at,
            squad_team.team_number AS squad_team_number, squad_member.slot_number AS squad_slot_number,
            (squad_team.captain_registration_id = r.id) AS squad_is_captain
       FROM daily007_v2_registrations r
       JOIN daily007_v2_users u ON u.id = r.captain_user_id
       JOIN daily007_v2_matches m ON m.id = r.match_id
       LEFT JOIN daily007_v2_squad_team_members squad_member ON squad_member.registration_id = r.id
       LEFT JOIN daily007_v2_squad_teams squad_team ON squad_team.id = squad_member.team_id
      ORDER BY r.created_at DESC`,
  );
  const data = await Promise.all(result.rows.map(async (row) => {
    const roster = await getRoster(row.id);
    const mode = legacyTournamentMode(row.mode ?? "solo", row.game_mode, row.team_type);
    return {
      id: row.id, tournamentId: row.match_id, tournamentName: row.title,
      mode: mode.gameModeLabel,
      gameMode: mode.gameMode,
      teamType: mode.teamTypeLabel,
       startsAt: row.starts_at ? tournamentInstantFromStored(row.starts_at).toISOString() : null,
       totalPlayerSlots: Number(row.capacity ?? mode.capacity) * mode.teamSize,
      status: row.status, playerName: row.captain_name, captainGameName: row.captain_game_name,
      gameUid: row.captain_game_uid,
      teamName: row.team_name, teamMembers: roster.length ? asTeamMembers(row, roster) : "[]",
       teamNumber: row.squad_team_number ?? null,
       slotNumber: row.squad_slot_number ?? null,
       isSquadCaptain: mode.gameMode === "battle_royale" && mode.teamType === "squad"
         ? row.squad_is_captain ?? false
         : true,
      entryCoins: row.entry_coins_paid, createdAt: new Date(row.created_at).toISOString(),
      userId: row.captain_user_id, userName: row.name, email: row.email,
    };
  }));
  res.json(data);
});

type EditableTeammate = { name: string; uid: string | null };
type TeamEditPayload = {
  captainGameName: string;
  captainGameUid: string;
  teamName: string;
  teammates: EditableTeammate[];
};
type TeamEditSnapshot = {
  captainGameName: string;
  captainGameUid: string;
  teamName: string;
  teammates: { name: string; uid: string }[];
};

export function parseTeamEditPayload(body: Record<string, unknown>, teamSize: number): {
  payload?: TeamEditPayload; error?: string;
} {
  const allowed = ["captainGameName", "captainGameUid", "teamName", "teammates", "expectedTeam"];
  if (Object.keys(body).some((key) => !allowed.includes(key))) {
    return { error: "Only game name, game UID, team name, and teammate details can be changed." };
  }
  const captainGameName = typeof body.captainGameName === "string" ? body.captainGameName.trim() : "";
  const captainGameUid = typeof body.captainGameUid === "string" ? body.captainGameUid.trim() : "";
  const teamName = typeof body.teamName === "string" ? body.teamName.trim() : "";
  if (!captainGameName || captainGameName.length > 100 || !captainGameUid || captainGameUid.length > 128) {
    return { error: "Captain game name and UID are required; names must be at most 100 characters and UIDs at most 128." };
  }
  if ((teamSize > 1 && (!teamName || teamName.length > 100)) || teamName.length > 100) {
    return { error: "Team name is required for team tournaments and must be at most 100 characters." };
  }

  const rawTeammates = body.teammates ?? [];
  if (!Array.isArray(rawTeammates) || rawTeammates.length !== teamSize - 1) {
    return { error: `This format requires exactly ${teamSize - 1} teammate${teamSize === 2 ? "" : "s"}.` };
  }
  const teammates: EditableTeammate[] = [];
  for (const raw of rawTeammates) {
    if (!record(raw)) return { error: "Teammate details are invalid." };
    const name = typeof raw.name === "string" ? raw.name.trim() : "";
    const uid = raw.uid == null || raw.uid === "" ? null : typeof raw.uid === "string" ? raw.uid.trim() : null;
    if (!name || name.length > 100 || (raw.uid != null && raw.uid !== "" && !uid) || (uid !== null && uid.length > 128)) {
      return { error: "Each teammate needs a game name of up to 100 characters and an optional UID of up to 128 characters." };
    }
    teammates.push({ name, uid });
  }
  const submittedUids = [captainGameUid, ...teammates.flatMap((member) => member.uid ? [member.uid] : [])]
    .map((uid) => uid.toLowerCase());
  if (new Set(submittedUids).size !== submittedUids.length) {
    return { error: "Each player in the registration must have a different game UID." };
  }
  return { payload: { captainGameName, captainGameUid, teamName, teammates } };
}

function parseExpectedTeamSnapshot(value: unknown, teamSize: number): TeamEditSnapshot | null {
  if (!record(value) ||
      typeof value.captainGameName !== "string" ||
      typeof value.captainGameUid !== "string" ||
      typeof value.teamName !== "string" ||
      !Array.isArray(value.teammates) ||
      value.teammates.length !== teamSize - 1) {
    return null;
  }
  const teammates: TeamEditSnapshot["teammates"] = [];
  for (const raw of value.teammates) {
    if (!record(raw) || typeof raw.name !== "string" || typeof raw.uid !== "string") return null;
    teammates.push({ name: raw.name, uid: raw.uid });
  }
  return {
    captainGameName: value.captainGameName,
    captainGameUid: value.captainGameUid,
    teamName: value.teamName,
    teammates,
  };
}

function sameTeamEditSnapshot(left: TeamEditSnapshot, right: TeamEditSnapshot): boolean {
  return left.captainGameName === right.captainGameName &&
    left.captainGameUid === right.captainGameUid &&
    left.teamName === right.teamName &&
    left.teammates.length === right.teammates.length &&
    left.teammates.every((member, index) =>
      member.name === right.teammates[index]?.name &&
      member.uid === right.teammates[index]?.uid);
}

router.patch("/my/registrations/:id/team", authenticate, async (req, res): Promise<void> => {
  const registrationId = idFrom(req);
  if (!registrationId) return fail(res, 400, "Registration id must be a UUID.");
  const account = req.daily007Account;
  if (!account) return fail(res, 401, "Authentication is required.");
  if (!record(req.body)) return fail(res, 400, "Expected updated game name, UID, team name, and teammate details.");

  const outcome = await transaction(async (client) => {
    const ref = await client.query<{ match_id: string }>(
      "SELECT match_id FROM daily007_v2_registrations WHERE id = $1 AND captain_user_id = $2",
      [registrationId, account.id],
    );
    if (!ref.rows[0]) return { kind: "missing" as const };

    const matchResult = await client.query<{
      id: string; starts_at: Date | string; status: string; enabled: boolean;
      mode: string; game_mode: string | null; team_type: string | null;
      database_now: Date | string; has_result: boolean;
    }>(
      `SELECT m.id, m.starts_at, m.status, m.enabled, m.mode, m.game_mode, m.team_type,
              clock_timestamp() AS database_now,
              EXISTS (SELECT 1 FROM daily007_v2_result_awards a WHERE a.match_id = m.id) AS has_result
         FROM daily007_v2_matches m
        WHERE m.id = $1
        FOR UPDATE`,
      [ref.rows[0].match_id],
    );
    const match = matchResult.rows[0];
    if (!match) return { kind: "missing" as const };

    const accountResult = await client.query<{ status: string }>(
      "SELECT status FROM daily007_v2_users WHERE id = $1 FOR SHARE",
      [account.id],
    );
    if (!accountResult.rows[0]) return { kind: "missing" as const };
    if (accountResult.rows[0].status === "blocked") return { kind: "blocked" as const };

    const registrationResult = await client.query<{
      id: string; status: string; captain_game_name: string; captain_game_uid: string; team_name: string;
    }>(
      `SELECT id, status, captain_game_name, captain_game_uid, team_name FROM daily007_v2_registrations
        WHERE id = $1 AND match_id = $2 AND captain_user_id = $3
        FOR UPDATE`,
      [registrationId, match.id, account.id],
    );
    const registration = registrationResult.rows[0];
    if (!registration) return { kind: "missing" as const };

    const accountState = await client.query<{ status: string }>(
      "SELECT status FROM daily007_v2_users WHERE id = $1 FOR SHARE",
      [account.id],
    );
    if (!accountState.rows[0]) return { kind: "missing" as const };
    if (accountState.rows[0].status === "blocked") return { kind: "blocked" as const };

    if (!["approved", "pending"].includes(registration.status) || !match.enabled ||
        ["live", "closed", "cancelled", "completed"].includes(match.status) || match.has_result ||
        !isTeamEditWindowOpen(tournamentInstantFromStored(match.starts_at), match.database_now)) {
      return { kind: "locked" as const };
    }

    const mode = legacyTournamentMode(match.mode, match.game_mode, match.team_type);
    if (mode.gameMode === "battle_royale" && mode.teamType === "squad") {
      return { kind: "individualSquad" as const };
    }
    const parsed = parseTeamEditPayload(req.body as Record<string, unknown>, mode.teamSize);
    if (!parsed.payload) return { kind: "invalid" as const, error: parsed.error || "Team details are invalid." };
    const expectedTeam = parseExpectedTeamSnapshot(req.body.expectedTeam, mode.teamSize);
    if (!expectedTeam) {
      return {
        kind: "invalid" as const,
        error: "This app cannot confirm the saved team version. Update Daily007 before editing this team.",
      };
    }
    const { captainGameName, captainGameUid, teamName, teammates } = parsed.payload;
    const currentRoster = await client.query<{ member_name: string; member_uid: string | null }>(
      `SELECT member_name, member_uid FROM daily007_v2_roster
        WHERE registration_id = $1 ORDER BY position`,
      [registrationId],
    );
    const latestTeam: TeamEditSnapshot = {
      captainGameName: registration.captain_game_name,
      captainGameUid: registration.captain_game_uid,
      teamName: registration.team_name,
      teammates: Array.from({ length: mode.teamSize - 1 }, (_, index) => {
        const member = currentRoster.rows[index];
        return { name: member?.member_name ?? "", uid: member?.member_uid ?? "" };
      }),
    };
    if (!sameTeamEditSnapshot(expectedTeam, latestTeam)) {
      return { kind: "stale" as const, latestTeam };
    }
    const submittedUids = [captainGameUid, ...teammates.flatMap((member) => member.uid ? [member.uid] : [])]
      .map((uid) => uid.toLowerCase());
    const duplicate = await client.query<{ id: string }>(
      `SELECT r.id
         FROM daily007_v2_registrations r
        WHERE r.match_id = $1 AND r.id <> $2 AND r.status IN ('approved', 'pending')
          AND (lower(r.captain_game_uid) = ANY($3::text[]) OR EXISTS (
            SELECT 1 FROM daily007_v2_roster roster
             WHERE roster.registration_id = r.id AND roster.member_uid IS NOT NULL
               AND lower(roster.member_uid) = ANY($3::text[])
          ))
        LIMIT 1`,
      [match.id, registrationId, submittedUids],
    );
    if (duplicate.rows[0]) return { kind: "duplicate" as const };

    const updated = await client.query<{ id: string }>(
      `UPDATE daily007_v2_registrations AS r
          SET captain_game_name = $3, captain_game_uid = $4, team_name = $5
        WHERE r.id = $1 AND r.match_id = $2 AND r.status IN ('approved', 'pending')
          AND EXISTS (
            SELECT 1 FROM daily007_v2_matches m
             WHERE m.id = r.match_id AND m.enabled = true
               AND m.status NOT IN ('live', 'closed', 'cancelled', 'completed')
                AND m.starts_at > clock_timestamp() + interval '6 hours'
               AND NOT EXISTS (
                 SELECT 1 FROM daily007_v2_result_awards a WHERE a.match_id = m.id
               )
          )
        RETURNING r.id`,
      [registrationId, match.id, captainGameName, captainGameUid, teamName],
    );
    if (!updated.rows[0]) return { kind: "locked" as const };

    await client.query("DELETE FROM daily007_v2_roster WHERE registration_id = $1", [registrationId]);
    for (let position = 0; position < teammates.length; position++) {
      const teammate = teammates[position];
      await client.query(
        "INSERT INTO daily007_v2_roster (registration_id, position, member_uid, member_name) VALUES ($1, $2, $3, $4)",
        [registrationId, position + 1, teammate.uid, teammate.name],
      );
    }
    return { kind: "updated" as const, status: registration.status };
  });

  if (outcome.kind === "missing") return fail(res, 404, "Registration not found.");
  if (outcome.kind === "blocked") return fail(res, 403, "This account is blocked.");
  if (outcome.kind === "locked") return fail(res, 409, "Team editing is locked 30 minutes before the tournament starts.");
  if (outcome.kind === "individualSquad") {
    return fail(res, 409, "Battle Royale Squad members manage their own slots. Captains can remove teammates from the Squad detail page.");
  }
  if (outcome.kind === "invalid") return fail(res, 400, outcome.error);
  if (outcome.kind === "duplicate") return fail(res, 409, "A player game UID is already registered for this tournament.");
  if (outcome.kind === "stale") {
    res.status(409).json({
      error: "This team was updated elsewhere. Review the latest saved team before choosing how to continue.",
      code: "STALE_TEAM_EDIT",
      latestTeam: outcome.latestTeam,
    });
    return;
  }
  res.json({ success: true, data: { registrationId, status: outcome.status, updated: true } });
});

async function transaction<T>(work: (client: SqlClient) => Promise<T>): Promise<T> {
  const client = await pool.connect() as unknown as SqlClient;
  try {
    await client.query("BEGIN");
    const value = await work(client);
    await client.query("COMMIT");
    return value;
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

async function rejectRegistration(registrationId: string): Promise<"done" | "missing" | "cancelled" | "removed"> {
  return transaction(async (client) => {
    const ref = await client.query<{ match_id: string }>(
      "SELECT match_id FROM daily007_v2_registrations WHERE id = $1", [registrationId],
    );
    if (!ref.rows[0]) return "missing";
    const match = await client.query<{
      capacity: number; mode: string; game_mode: string | null; team_type: string | null; status: string;
    }>(
      "SELECT capacity, mode, game_mode, team_type, status FROM daily007_v2_matches WHERE id = $1 FOR UPDATE",
      [ref.rows[0].match_id],
    );
    if (match.rows[0]?.status === "cancelled") return "cancelled";
    const mode = match.rows[0]
      ? legacyTournamentMode(match.rows[0].mode, match.rows[0].game_mode, match.rows[0].team_type)
      : null;
    const isIndividualTeam = (mode?.teamSize ?? 1) > 1;
    if (isIndividualTeam && mode) {
      await ensureLegacySquadTeams(
        client,
        ref.rows[0].match_id,
        Number(match.rows[0]?.capacity ?? mode.capacity),
        mode.teamSize,
      );
    }
    const result = await client.query<{
      id: string; match_id: string; captain_user_id: string; entry_coins_paid: number; status: string;
    }>(
      "SELECT id, match_id, captain_user_id, entry_coins_paid, status FROM daily007_v2_registrations WHERE id = $1 FOR UPDATE",
      [registrationId],
    );
    const registration = result.rows[0];
    if (!registration) return "missing";
    if (registration.status === "rejected") return "done";
    if (registration.status === "removed") return "removed";
    if (registration.entry_coins_paid > 0) {
      const user = await client.query<{ wallet_coins: number }>(
        "SELECT wallet_coins FROM daily007_v2_users WHERE id = $1 FOR UPDATE", [registration.captain_user_id],
      );
      if (!user.rows[0]) throw new Error("Registration account no longer exists.");
      const balance = user.rows[0].wallet_coins + registration.entry_coins_paid;
      if (!Number.isSafeInteger(balance) || balance > 2_147_483_647) throw new Error("Refund exceeds the supported wallet balance.");
      await client.query("UPDATE daily007_v2_users SET wallet_coins = $2 WHERE id = $1", [registration.captain_user_id, balance]);
      await client.query(
        `INSERT INTO daily007_v2_wallet_ledger (user_id, amount, balance_after, reason, match_id, registration_id)
         VALUES ($1, $2, $3, 'registration_refund', $4, $5)`,
        [registration.captain_user_id, registration.entry_coins_paid, balance, registration.match_id, registration.id],
      );
    }
    await client.query("UPDATE daily007_v2_registrations SET status = 'rejected' WHERE id = $1", [registration.id]);
    if (isIndividualTeam) {
      await deactivateSquadRegistration(client, registration.id);
    }
    if (match.rows[0]) {
      let capacityState: ReturnType<typeof matchCapacityState>;
      if (isIndividualTeam && mode) {
        const occupancy = await getSquadOccupancy(client, registration.match_id);
        capacityState = matchCapacityState(
          match.rows[0].mode,
          occupancy.filledPlayers,
          Number(match.rows[0].capacity) * mode.teamSize,
        );
      } else {
        const count = await client.query<{ count: string }>(
          "SELECT count(*)::text AS count FROM daily007_v2_registrations WHERE match_id = $1 AND status IN ('approved', 'pending')",
          [registration.match_id],
        );
        capacityState = matchCapacityState(match.rows[0].mode, Number(count.rows[0].count), match.rows[0].capacity);
      }
      await client.query(
        "UPDATE daily007_v2_matches SET is_full = $2, status = $3 WHERE id = $1",
        [registration.match_id, capacityState.isFull, capacityState.status],
      );
    }
    return "done";
  });
}

async function approveRegistration(registrationId: string): Promise<"approved" | "missing" | "rejected" | "full" | "cancelled"> {
  return transaction(async (client) => {
    const ref = await client.query<{ match_id: string }>(
      "SELECT match_id FROM daily007_v2_registrations WHERE id = $1", [registrationId],
    );
    if (!ref.rows[0]) return "missing";
    const matchResult = await client.query<{
      capacity: number; mode: string; game_mode: string | null; team_type: string | null; status: string;
    }>(
      "SELECT capacity, mode, game_mode, team_type, status FROM daily007_v2_matches WHERE id = $1 FOR UPDATE",
      [ref.rows[0].match_id],
    );
    const match = matchResult.rows[0];
    if (!match) return "missing";
    if (match.status === "cancelled") return "cancelled";
    const registrationResult = await client.query<{ status: string }>(
      "SELECT status FROM daily007_v2_registrations WHERE id = $1 FOR UPDATE", [registrationId],
    );
    const registration = registrationResult.rows[0];
    if (!registration) return "missing";
    if (registration.status === "rejected") return "rejected";
    const mode = legacyTournamentMode(match.mode, match.game_mode, match.team_type);
    const individualTeam = mode.teamSize > 1;
    let activeCount: number;
    let capacity: number;
    if (individualTeam) {
      await ensureLegacySquadTeams(
        client,
        ref.rows[0].match_id,
        Number(match.capacity),
        mode.teamSize,
      );
      const occupancy = await getSquadOccupancy(client, ref.rows[0].match_id);
      activeCount = occupancy.filledPlayers;
      capacity = Number(match.capacity) * mode.teamSize;
    } else {
      const count = await client.query<{ count: string }>(
        "SELECT count(*)::text AS count FROM daily007_v2_registrations WHERE match_id = $1 AND status IN ('approved', 'pending')",
        [ref.rows[0].match_id],
      );
      activeCount = Number(count.rows[0].count);
      capacity = Number(match.capacity);
    }
    const capacityState = matchCapacityState(match.mode, activeCount, capacity);
    if (registration.status === "approved") {
      await client.query(
        "UPDATE daily007_v2_matches SET is_full = $2, status = $3 WHERE id = $1",
        [ref.rows[0].match_id, capacityState.isFull, capacityState.status],
      );
      return "approved";
    }
    if (!canApproveWithinCapacity(activeCount, capacity)) return "full";
    await client.query(
      "UPDATE daily007_v2_registrations SET status = 'approved' WHERE id = $1", [registrationId],
    );
    await client.query(
      "UPDATE daily007_v2_matches SET is_full = $2, status = $3 WHERE id = $1",
      [ref.rows[0].match_id, capacityState.isFull, capacityState.status],
    );
    return "approved";
  });
}

router.post("/admin/registrations/:id/:action", authenticate, async (req, res): Promise<void> => {
  if (!requireTournamentAdmin(req, res)) return;
  const id = idFrom(req);
  const action = req.params.action;
  if (!id) return fail(res, 400, "Registration id must be a UUID.");
  if (action !== "approve" && action !== "reject") return fail(res, 404, "Registration action not found.");
  if (action === "approve") {
    const approved = await approveRegistration(id);
    if (approved === "missing") return fail(res, 404, "Registration not found.");
    if (approved === "rejected") return fail(res, 409, "A rejected and refunded registration cannot be approved again.");
    if (approved === "full") return fail(res, 409, "Registration capacity has been reached; this pending registration cannot be approved.");
    if (approved === "cancelled") return fail(res, 409, "Registrations cannot be approved after a tournament is cancelled.");
    res.json({ success: true, data: { id, status: "approved" } });
    return;
  }
  const rejected = await rejectRegistration(id);
  if (rejected === "missing") return fail(res, 404, "Registration not found.");
  if (rejected === "cancelled") return fail(res, 409, "Registrations cannot be changed after a tournament is cancelled.");
  if (rejected === "removed") return fail(res, 409, "This Squad player was already removed. No refund was issued.");
  res.json({ success: true, data: { id, status: "rejected", refunded: true } });
});

router.delete("/admin/registrations/:id", authenticate, async (req, res): Promise<void> => {
  if (!requireTournamentAdmin(req, res)) return;
  const id = idFrom(req);
  if (!id) return fail(res, 400, "Registration id must be a UUID.");
  const rejected = await rejectRegistration(id);
  if (rejected === "missing") return fail(res, 404, "Registration not found.");
  if (rejected === "cancelled") return fail(res, 409, "Registrations cannot be changed after a tournament is cancelled.");
  if (rejected === "removed") return fail(res, 409, "This Squad player was already removed. No refund was issued.");
  res.json({ success: true, data: { id, status: "rejected", deleted: false } });
});

router.get("/admin/tournaments/:id/room", authenticate, async (req, res): Promise<void> => {
  res.setHeader("Cache-Control", "no-store");
  if (!requireTournamentAdmin(req, res)) return;
  const id = idFrom(req);
  if (!id) return fail(res, 400, "Tournament id must be a UUID.");
  const result = await pool.query<{
    id: string; status: string; room_id: string | null; room_password: string | null; room_time: string; room_published: boolean;
  }>(
    "SELECT id, status, room_id, room_password, room_time, room_published FROM daily007_v2_matches WHERE id = $1", [id],
  );
  const row = result.rows[0];
  if (!row) return fail(res, 404, "Tournament not found.");
  if (row.status === "cancelled") return fail(res, 409, "A cancelled tournament has no room to manage.");
  res.json({
    id: row.id, roomId: row.room_id ?? "", roomPassword: row.room_password ?? "",
    roomTime: row.room_time, roomPublished: Boolean(row.room_id && row.room_password),
  });
});

router.put("/admin/tournaments/:id/room", authenticate, async (req, res): Promise<void> => {
  res.setHeader("Cache-Control", "no-store");
  if (!requireTournamentAdmin(req, res)) return;
  const id = idFrom(req);
  const body = req.body as unknown;
  if (!id) return fail(res, 400, "Tournament id must be a UUID.");
  if (!record(body)) return fail(res, 400, "Expected roomId and roomPassword.");
  const roomId = nonempty(body.roomId, 200);
  const roomPassword = nonempty(body.roomPassword, 200);
  if (!roomId || !roomPassword) {
    return fail(res, 400, "Room ID and password must each contain 1–200 characters.");
  }
  const result = await pool.query<{ id: string; roomPublished: boolean; roomTime: string }>(
    `UPDATE daily007_v2_matches
        SET room_id = $2, room_password = $3, room_published = true
      WHERE id = $1 AND status <> 'cancelled'
      RETURNING id, room_published AS "roomPublished", room_time AS "roomTime"`,
    [id, roomId, roomPassword],
  );
  if (!result.rows[0]) {
    const exists = await pool.query<{ status: string }>("SELECT status FROM daily007_v2_matches WHERE id = $1", [id]);
    if (exists.rows[0]?.status === "cancelled") return fail(res, 409, "A cancelled tournament has no room to manage.");
    return fail(res, 404, "Tournament not found.");
  }
  res.json({ ...result.rows[0], roomId, roomPassword });
});

router.delete("/admin/tournaments/:id/room", authenticate, async (req, res): Promise<void> => {
  if (!requireTournamentAdmin(req, res)) return;
  const id = idFrom(req);
  if (!id) return fail(res, 400, "Tournament id must be a UUID.");
  const result = await pool.query(
    `UPDATE daily007_v2_matches
        SET room_id = NULL, room_password = NULL, room_published = false
      WHERE id = $1
      RETURNING id`,
    [id],
  );
  if (!result.rows[0]) return fail(res, 404, "Tournament not found.");
  res.json({ success: true, roomPublished: false });
});

router.post("/admin/tournaments/:id/publish-room", authenticate, async (req, res): Promise<void> => {
  if (!requireTournamentAdmin(req, res)) return;
  const id = idFrom(req);
  if (!id) return fail(res, 400, "Tournament id must be a UUID.");
  const result = await pool.query(
    `UPDATE daily007_v2_matches
        SET room_published = true
      WHERE id = $1 AND status <> 'cancelled' AND room_id IS NOT NULL AND room_password IS NOT NULL
      RETURNING id, room_published AS "roomPublished"`,
    [id],
  );
  if (!result.rows[0]) {
    const exists = await pool.query<{ status: string }>("SELECT status FROM daily007_v2_matches WHERE id = $1", [id]);
    if (!exists.rows[0]) return fail(res, 404, "Tournament not found.");
    return fail(res, exists.rows[0].status === "cancelled" ? 409 : 400,
      exists.rows[0].status === "cancelled" ? "A cancelled tournament has no room to publish." : "Save room credentials before publishing.");
  }
  res.json(result.rows[0]);
});

export default router;