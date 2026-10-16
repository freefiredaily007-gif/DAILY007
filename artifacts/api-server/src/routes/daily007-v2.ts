import { randomBytes, scrypt as scryptCallback, timingSafeEqual } from "node:crypto";
import { promisify } from "node:util";
import { Router, type IRouter, type Request, type Response, type NextFunction } from "express";
import { pool } from "@workspace/db";
import { csvCell, parseFutureTimestamp, parseTeamMembers } from "../lib/daily007-v2-validation";
import { awardDaily007SignupBonus, ensureDaily007ReferralCode } from "../lib/daily007-referrals";
import { legacyTournamentMode, resolveTournamentMode } from "../lib/daily007-mode-rules";
import { storedTournamentTimeFromInstant, tournamentInstantFromStored } from "../lib/daily007-schedule-time";
import { canRevealRoomCredentials, isRoomCredentialReleaseOpen } from "../lib/daily007-room-access";
import { hasTournamentAdminAccess, isFullAdminRole, type Daily007Role } from "../lib/daily007-roles";
import {
  DAILY007_LOGIN_FAILURE_MESSAGE,
  verifyDaily007LoginPassword,
} from "../lib/daily007-login-password";
import { checkDaily007LoginThrottle } from "../lib/daily007-login-throttle";
import {
  ensureLegacySquadTeams,
  getSquadOccupancy,
} from "../lib/daily007-squad-slots";
import {
  daily007TokenConfigured,
  isSessionVersionCurrent,
  makeToken,
  readSessionToken,
  readToken,
} from "../lib/daily007-session-token";

export { makeToken, readToken };

const scrypt = promisify(scryptCallback);
const router: IRouter = Router();
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const PASSWORD_BYTES = 64;
const REGISTRATION_CONFLICT_CODES = {
  alreadyRegistered: "ALREADY_REGISTERED",
  gameUidAlreadyRegistered: "GAME_UID_ALREADY_REGISTERED",
  insufficientBalance: "INSUFFICIENT_BALANCE",
  matchClosed: "MATCH_CLOSED",
  matchFull: "MATCH_FULL",
  registrationRejected: "REGISTRATION_REJECTED",
  tournamentDisabled: "TOURNAMENT_DISABLED",
} as const;
type RegistrationConflictCode = typeof REGISTRATION_CONFLICT_CODES[keyof typeof REGISTRATION_CONFLICT_CODES];
const registrationConflictCodeSet = new Set<string>(Object.values(REGISTRATION_CONFLICT_CODES));

function isRegistrationConflictCode(code: unknown): code is RegistrationConflictCode {
  return typeof code === "string" && registrationConflictCodeSet.has(code);
}

export type Account = {
  id: string; name: string; email: string; role: Daily007Role; wallet_coins: number;
  phone?: string | null; game_uid?: string | null; status?: "active" | "blocked"; auth_version?: number;
};

export async function getDaily007GoogleLinkStatus(accountId: string): Promise<boolean> {
  const result = await pool.query<{ google_linked: boolean }>(
    `SELECT clerk_user_id IS NOT NULL AS google_linked
       FROM daily007_v2_users
      WHERE id = $1`,
    [accountId],
  );
  return result.rows[0]?.google_linked === true;
}

type SqlClient = {
  query<T = unknown>(text: string, values?: unknown[]): Promise<{ rows: T[] }>;
  release(): void;
};
export type Daily007RoleRequirement = "admin" | "tournament_admin";
export type Daily007MutationClient = {
  query<T = unknown>(
    text: string,
    values?: unknown[],
  ): Promise<{ rows: T[]; rowCount?: number | null }>;
};
declare global {
  namespace Express {
    interface Request {
      daily007Account?: Account;
    }
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function fail(
  res: Response,
  status: number,
  error: string,
  code?: string,
  fieldErrors?: Record<string, string>,
): void {
  res.status(status).json({
    error,
    ...(code ? { code } : {}),
    ...(fieldErrors ? { fieldErrors } : {}),
  });
}

function registrationFieldError(
  message: string,
  fieldErrors?: Record<string, string>,
): Error & { status: number; fieldErrors?: Record<string, string> } {
  return Object.assign(new Error(message), {
    status: 400,
    ...(fieldErrors ? { fieldErrors } : {}),
  });
}

function teammateRosterFieldErrors(value: unknown, expectedCount: number): Record<string, string> | undefined {
  const message = "Check the teammate name or UID that needs correction.";
  const errors: Record<string, string> = {};
  if (!Array.isArray(value)) {
    if (expectedCount > 0) errors["memberName:0"] = message;
    return Object.keys(errors).length ? errors : undefined;
  }

  if (value.length < expectedCount) {
    errors[`memberName:${value.length}`] = message;
  }

  const seenUids = new Map<string, number>();
  for (let index = 0; index < Math.min(value.length, expectedCount); index++) {
    const member = value[index];
    if (!isRecord(member) || typeof member.name !== "string" ||
        member.name.trim().length === 0 || member.name.trim().length > 100) {
      errors[`memberName:${index}`] = message;
    }
    if (isRecord(member) && member.uid !== undefined && member.uid !== null) {
      if (typeof member.uid !== "string" || member.uid.trim().length > 128) {
        errors[`memberUid:${index}`] = message;
      } else if (member.uid.trim()) {
        const normalizedUid = member.uid.trim().toLocaleLowerCase();
        const previousIndex = seenUids.get(normalizedUid);
        if (previousIndex !== undefined) {
          errors[`memberUid:${previousIndex}`] = message;
          errors[`memberUid:${index}`] = message;
        } else {
          seenUids.set(normalizedUid, index);
        }
      }
    }
  }
  return Object.keys(errors).length ? errors : undefined;
}

function constantTimeEqual(left: string, right: string): boolean {
  const leftBytes = Buffer.from(left);
  const rightBytes = Buffer.from(right);
  return leftBytes.length === rightBytes.length && timingSafeEqual(leftBytes, rightBytes);
}

function requestId(req: Request): string | null {
  const value = req.params.id;
  return typeof value === "string" && UUID_PATTERN.test(value) ? value : null;
}

export async function authenticate(req: Request, res: Response, next: NextFunction): Promise<void> {
  if (!daily007TokenConfigured()) {
    fail(res, 503, "Daily007 v2 authentication needs DAILY007_AUTH_SECRET or SESSION_SECRET (at least 32 characters).");
    return;
  }
  const authorization = req.get("authorization") ?? "";
  const match = /^Bearer\s+(.+)$/i.exec(authorization);
  const claims = match ? readSessionToken(match[1]) : null;
  if (!claims) {
    fail(res, 401, "A valid Daily007 v2 bearer token is required.");
    return;
  }
  const result = await pool.query<Account & { auth_version: number }>(
    "SELECT id, name, email, role, wallet_coins, phone, game_uid, status, auth_version FROM daily007_v2_users WHERE id = $1",
    [claims.userId],
  );
  if (!result.rows[0]) {
    fail(res, 401, "Account not found.");
    return;
  }
  if (!isSessionVersionCurrent(claims.sessionVersion, result.rows[0].auth_version)) {
    fail(res, 401, "This Daily007 session was replaced by a newer sign-in. Sign in again.");
    return;
  }
  if (result.rows[0].status === "blocked") {
    fail(res, 403, "This account is blocked.");
    return;
  }
  req.daily007Account = result.rows[0];
  next();
}

export function requireAdmin(req: Request, res: Response): boolean {
  if (!isFullAdminRole(req.daily007Account?.role)) {
    fail(res, 403, "Administrator access is required.");
    return false;
  }
  return true;
}

export function requireTournamentAdmin(req: Request, res: Response): boolean {
  if (!hasTournamentAdminAccess(req.daily007Account?.role)) {
    fail(res, 403, "Tournament administrator access is required.");
    return false;
  }
  return true;
}

export async function hashPassword(password: string, salt?: Buffer): Promise<{ salt: string; hash: string }> {
  const actualSalt = salt ?? randomBytes(16);
  const hash = await scrypt(password, actualSalt, PASSWORD_BYTES) as Buffer;
  return { salt: actualSalt.toString("hex"), hash: hash.toString("hex") };
}

async function withTransaction<T>(
  work: (client: SqlClient) => Promise<T>,
): Promise<T> {
  const client = await pool.connect() as unknown as SqlClient;
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

export async function assertDaily007RoleLocked(
  client: Daily007MutationClient,
  accountId: string,
  requiredRole: Daily007RoleRequirement,
): Promise<void> {
  const result = await client.query<{ role: Daily007Role; status: string }>(
    "SELECT role, status FROM daily007_v2_users WHERE id = $1 FOR SHARE",
    [accountId],
  );
  const account = result.rows[0];
  const permitted = requiredRole === "admin"
    ? isFullAdminRole(account?.role)
    : hasTournamentAdminAccess(account?.role);
  if (!account || account.status === "blocked" || !permitted) {
    throw Object.assign(
      new Error(requiredRole === "admin"
        ? "Administrator access is required."
        : "Tournament administrator access is required."),
      { status: 403 },
    );
  }
}

export async function withDaily007RoleTransaction<T>(
  accountId: string,
  requiredRole: Daily007RoleRequirement,
  work: (client: Daily007MutationClient) => Promise<T>,
  lockMode: "shared" | "exclusive" = "shared",
): Promise<T> {
  return withTransaction(async (client) => {
    // Status and role changes take the exclusive variant before locking actor and
    // target rows. Sharing the same gate first prevents lock-order deadlocks with
    // mutations touching another administrator's row.
    await client.query(
      lockMode === "exclusive"
        ? "SELECT pg_advisory_xact_lock(740073)"
        : "SELECT pg_advisory_xact_lock_shared(740073)",
    );
    await assertDaily007RoleLocked(client, accountId, requiredRole);
    return work(client);
  });
}

function cleanName(value: unknown, label: string): string | null {
  return typeof value === "string" && value.trim().length > 0 && value.trim().length <= 100
    ? value.trim()
    : null;
}

function isBattleRoyaleSquad(match: {
  mode: string; game_mode: string | null; team_type: string | null;
}): boolean {
  const mode = legacyTournamentMode(match.mode, match.game_mode, match.team_type);
  return mode.gameMode === "battle_royale" && mode.teamType === "squad";
}

router.post("/daily007/v2/auth/register", async (req, res): Promise<void> => {
  const body = req.body as unknown;
  if (!isRecord(body)) {
    fail(res, 400, "Expected a JSON object with name, email, and password.");
    return;
  }
  const name = cleanName(body.name, "name");
  const email = typeof body.email === "string" ? body.email.trim().toLowerCase() : "";
  const password = body.password;
  const phone = body.phone === undefined ? null : cleanName(body.phone, "phone");
  const gameUid = body.gameUid === undefined ? null : cleanName(body.gameUid, "gameUid");
  const referralCode = body.referralCode === undefined
    ? null
    : cleanName(body.referralCode, "referralCode")?.toUpperCase() ?? null;
  if (!name || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || email.length > 254) {
    fail(res, 400, "Name must be 1–100 characters and email must be valid.");
    return;
  }
  if (typeof password !== "string" || password.length < 8 || password.length > 200) {
    fail(res, 400, "Password must contain 8–200 characters.");
    return;
  }
  if ((body.phone !== undefined && (!phone || phone.length > 40)) ||
      (body.gameUid !== undefined && (!gameUid || gameUid.length > 128)) ||
      (body.referralCode !== undefined && (!referralCode || referralCode.length > 64))) {
    fail(res, 400, "Optional phone, gameUid, and referralCode must be valid strings within supported lengths.");
    return;
  }
  if (!daily007TokenConfigured()) {
    fail(res, 503, "Daily007 v2 authentication needs DAILY007_AUTH_SECRET or SESSION_SECRET (at least 32 characters).");
    return;
  }
  const credentials = await hashPassword(password);
  try {
    const account = await withTransaction(async (client) => {
      const result = await client.query<Account>(
        `INSERT INTO daily007_v2_users (name, email, password_salt, password_hash, phone, game_uid, referral_code)
         VALUES ($1, $2, $3, $4, $5, $6, $7)
         RETURNING id, name, email, role, wallet_coins, phone, game_uid, status`,
        [name, email, credentials.salt, credentials.hash, phone, gameUid, referralCode],
      );
      const created = result.rows[0];
      await ensureDaily007ReferralCode(client, created.id);
      created.wallet_coins = await awardDaily007SignupBonus(client, referralCode, created.id);
      return created;
    });
    const token = makeToken(account.id, 0);
    if (!token) {
      fail(res, 503, "Daily007 authentication is not configured.");
      return;
    }
    res.status(201).json({ token, account });
  } catch (error) {
    const status = (error as { status?: number }).status;
    if (status) {
      fail(res, status, error instanceof Error ? error.message : "Signup could not be completed.");
      return;
    }
    if ((error as { code?: string }).code === "23505") {
      fail(res, 409, "An account with this email already exists.");
      return;
    }
    throw error;
  }
});

router.post("/daily007/v2/auth/login", async (req, res): Promise<void> => {
  const body = req.body as unknown;
  if (!isRecord(body) || typeof body.email !== "string" || typeof body.password !== "string") {
    fail(res, 400, "Email and password are required.");
    return;
  }
  if (!(await checkDaily007LoginThrottle(req, res))) return;
  if (!daily007TokenConfigured()) {
    fail(res, 503, "Daily007 v2 authentication needs DAILY007_AUTH_SECRET or SESSION_SECRET (at least 32 characters).");
    return;
  }
  const email = body.email.trim().toLowerCase();
  const result = await pool.query<Account & { password_salt: string; password_hash: string }>(
    `SELECT id, name, email, role, wallet_coins, phone, game_uid, status, password_salt, password_hash
     FROM daily007_v2_users WHERE email = $1`,
    [email],
  );
  const user = result.rows[0];
  if (body.password.length > 200) {
    fail(res, 401, DAILY007_LOGIN_FAILURE_MESSAGE);
    return;
  }
  const passwordMatches = await verifyDaily007LoginPassword(body.password, user ?? null, hashPassword);
  if (!passwordMatches || user?.status === "blocked") {
    fail(res, 401, DAILY007_LOGIN_FAILURE_MESSAGE);
    return;
  }
  const rotated = await pool.query<{ auth_version: number }>(
    `UPDATE daily007_v2_users
        SET auth_version = auth_version + 1
      WHERE id = $1 AND status = 'active'
      RETURNING auth_version`,
    [user.id],
  );
  if (!rotated.rows[0]) {
    fail(res, 401, DAILY007_LOGIN_FAILURE_MESSAGE);
    return;
  }
  const token = makeToken(user.id, rotated.rows[0].auth_version);
  if (!token) {
    fail(res, 503, "Daily007 authentication is not configured.");
    return;
  }
  res.json({
    token,
    account: {
      id: user.id, name: user.name, email: user.email, role: user.role, wallet_coins: user.wallet_coins,
      phone: user.phone, game_uid: user.game_uid, status: user.status,
    },
  });
});

router.get("/daily007/v2/auth/me", authenticate, async (req, res): Promise<void> => {
  const account = req.daily007Account;
  if (!account) {
    fail(res, 401, "A valid Daily007 v2 bearer token is required.");
    return;
  }
  const googleLinked = await getDaily007GoogleLinkStatus(account.id);
  res.json({
    id: account.id, name: account.name, email: account.email, phone: account.phone,
    gameUid: account.game_uid, role: account.role, status: account.status,
    coins: account.wallet_coins, walletCoins: account.wallet_coins, googleLinked,
  });
});

router.get("/daily007/v2/admin/bootstrap-status", authenticate, async (_req, res): Promise<void> => {
  const admins = await pool.query<{ count: string }>(
    "SELECT count(*)::text AS count FROM daily007_v2_users WHERE role = 'admin'",
  );
  res.json({ available: Number(admins.rows[0]?.count ?? 0) === 0 });
});

router.post("/daily007/v2/admin/bootstrap", authenticate, async (req, res): Promise<void> => {
  const configuredToken = process.env.DAILY007_ADMIN_BOOTSTRAP_TOKEN;
  const suppliedToken = isRecord(req.body) ? req.body.bootstrapToken : null;
  if (!configuredToken || configuredToken.length < 32) {
    fail(res, 503, "Admin onboarding is not configured: set DAILY007_ADMIN_BOOTSTRAP_TOKEN to a random secret of at least 32 characters.");
    return;
  }
  if (typeof suppliedToken !== "string" || !constantTimeEqual(suppliedToken, configuredToken)) {
    fail(res, 403, "The configured admin bootstrap token is invalid.");
    return;
  }
  const account = req.daily007Account;
  if (!account) {
    fail(res, 401, "A valid Daily007 v2 bearer token is required.");
    return;
  }
  const promoted = await withTransaction(async (client) => {
    await client.query("SELECT pg_advisory_xact_lock(740072)");
    const admins = await client.query<{ count: string }>(
      "SELECT count(*)::text AS count FROM daily007_v2_users WHERE role = 'admin'",
    );
    if (Number(admins.rows[0].count) > 0) return false;
    await client.query("UPDATE daily007_v2_users SET role = 'admin' WHERE id = $1", [account.id]);
    return true;
  });
  if (!promoted) {
    fail(res, 409, "Admin bootstrap has already been completed.");
    return;
  }
  res.json({ message: "This account is now the first Daily007 v2 administrator. Remove DAILY007_ADMIN_BOOTSTRAP_TOKEN from the server environment." });
});

router.get("/daily007/v2/matches", async (_req, res): Promise<void> => {
  const result = await pool.query(
    `SELECT m.id, m.title, m.mode, m.game_mode AS "gameMode", m.team_type AS "teamType",
            m.capacity, m.entry_coins AS "entryCoins",
            m.starts_at AS "startsAt", m.status, m.is_full AS "isFull",
            count(r.id) FILTER (WHERE r.status IN ('approved', 'pending'))::integer AS "registeredCount"
       FROM daily007_v2_matches m
       LEFT JOIN daily007_v2_registrations r ON r.match_id = m.id
      GROUP BY m.id
      ORDER BY m.starts_at ASC`,
  );
  res.json({
    matches: result.rows.map((row: any) => ({
      ...row,
      startsAt: tournamentInstantFromStored(row.startsAt).toISOString(),
    })),
  });
});

router.post("/daily007/v2/admin/matches", authenticate, async (req, res): Promise<void> => {
  if (!requireTournamentAdmin(req, res)) return;
  const body = req.body as unknown;
  if (!isRecord(body)) {
    fail(res, 400, "Expected title, mode, startsAt, and optional nonnegative integer entryCoins.");
    return;
  }
  const title = cleanName(body.title, "title");
  const configuredMode = resolveTournamentMode(
    body.gameMode ?? body.mode,
    body.teamType ?? (body.mode === "clash" ? "squad" : undefined),
  );
  const parsedStart = parseFutureTimestamp(body.startsAt);
  const startsAt = parsedStart ? storedTournamentTimeFromInstant(parsedStart) : null;
  const entryCoins = body.entryCoins === undefined ? 0 : body.entryCoins;
  if (!title || !configuredMode ||
      !startsAt || !Number.isInteger(entryCoins) ||
      typeof entryCoins !== "number" || entryCoins < 0 || entryCoins > 2_147_483_647) {
    fail(res, 400, "Provide a title, supported game mode and team type, future startsAt timestamp, and nonnegative 32-bit integer entryCoins.");
    return;
  }
  let result;
  try {
    result = await withDaily007RoleTransaction(
      req.daily007Account!.id,
      "tournament_admin",
      (client) => client.query(
        `INSERT INTO daily007_v2_matches (title, mode, game_mode, team_type, capacity, starts_at, entry_coins)
         SELECT $1, $2, $3, $4, $5, $6, $7
           WHERE $6::timestamptz > clock_timestamp() + interval '5 hours 30 minutes'
         RETURNING id, title, mode, game_mode AS "gameMode", team_type AS "teamType",
                   capacity, entry_coins AS "entryCoins", starts_at AS "startsAt", status, is_full AS "isFull"`,
        [title, configuredMode.storageMode, configuredMode.gameMode, configuredMode.teamType,
          configuredMode.capacity, startsAt, entryCoins],
      ),
    );
  } catch (error) {
    const status = (error as { status?: number }).status;
    if (status) {
      fail(res, status, (error as Error).message);
      return;
    }
    throw error;
  }
  if (!result.rows[0]) {
    fail(res, 400, "startsAt must be in the future when the match is created.");
    return;
  }
   const match = result.rows[0] as Record<string, unknown>;
   res.status(201).json({
     match: {
       ...match,
       startsAt: tournamentInstantFromStored(match.startsAt as Date | string).toISOString(),
     },
   });
});

router.patch("/daily007/v2/admin/matches/:id", authenticate, async (req, res): Promise<void> => {
  if (!requireTournamentAdmin(req, res)) return;
  const id = requestId(req);
  if (!id) {
    fail(res, 400, "Match id must be a UUID.");
    return;
  }
  const body = req.body as unknown;
  if (!isRecord(body)) {
    fail(res, 400, "Expected entryCoins and/or startsAt.");
    return;
  }
  const hasEntryCoins = Object.hasOwn(body, "entryCoins");
  const hasStartsAt = Object.hasOwn(body, "startsAt");
  const parsedStart = hasStartsAt ? parseFutureTimestamp(body.startsAt) : null;
  const startsAt = parsedStart ? storedTournamentTimeFromInstant(parsedStart) : null;
  if ((!hasEntryCoins && !hasStartsAt) ||
      (hasEntryCoins && (typeof body.entryCoins !== "number" ||
        !Number.isInteger(body.entryCoins) || body.entryCoins < 0 ||
        body.entryCoins > 2_147_483_647)) ||
      (hasStartsAt && !startsAt)) {
    fail(res, 400, "Provide entryCoins as a nonnegative 32-bit integer and/or startsAt as a valid future ISO timestamp.");
    return;
  }
  let result;
  try {
    result = await withDaily007RoleTransaction(
      req.daily007Account!.id,
      "tournament_admin",
      async (client) => {
        const updated = await client.query(
          `UPDATE daily007_v2_matches
              SET entry_coins = COALESCE($2, entry_coins),
                  starts_at = COALESCE($3, starts_at)
            WHERE id = $1 AND COALESCE($3::timestamptz, starts_at) > clock_timestamp() + interval '5 hours 30 minutes'
           RETURNING id, title, mode, capacity, entry_coins AS "entryCoins", starts_at AS "startsAt", status, is_full AS "isFull"`,
          [id, hasEntryCoins ? body.entryCoins : null, startsAt],
        );
        if (!updated.rows[0]) {
          const exists = await client.query("SELECT 1 FROM daily007_v2_matches WHERE id = $1", [id]);
          return { match: null, exists: Boolean(exists.rows[0]) };
        }
        return { match: updated.rows[0], exists: true };
      },
    );
  } catch (error) {
    const status = (error as { status?: number }).status;
    if (status) {
      fail(res, status, (error as Error).message);
      return;
    }
    throw error;
  }
  if (!result.match) {
    fail(res, result.exists ? 400 : 404,
      result.exists ? "startsAt must be in the future when the match is updated." : "Match not found.");
    return;
  }
  const match = result.match as Record<string, unknown>;
  res.json({
    match: {
      ...match,
      startsAt: tournamentInstantFromStored(match.startsAt as Date | string).toISOString(),
    },
  });
});

router.get("/daily007/v2/matches/:id/squad-slots", authenticate, async (req, res): Promise<void> => {
  const matchId = requestId(req);
  const account = req.daily007Account;
  if (!matchId) return fail(res, 400, "Match id must be a UUID.");
  if (!account) return fail(res, 401, "A valid Daily007 v2 bearer token is required.");
  try {
    const data = await withTransaction(async (client) => {
      const matchResult = await client.query<{
        mode: string; game_mode: string | null; team_type: string | null; status: string;
        enabled: boolean; registration_open: boolean; edit_open: boolean; has_result: boolean;
      }>(
        `SELECT m.mode, m.game_mode, m.team_type, m.status, m.enabled,
                m.starts_at > clock_timestamp() + interval '5 hours 30 minutes' AS registration_open,
                m.starts_at > clock_timestamp() + interval '6 hours' AS edit_open,
                EXISTS (SELECT 1 FROM daily007_v2_result_awards a WHERE a.match_id = m.id) AS has_result
           FROM daily007_v2_matches m WHERE m.id = $1 FOR UPDATE`,
        [matchId],
      );
      const match = matchResult.rows[0];
      if (!match) throw Object.assign(new Error("Match not found."), { status: 404 });
      if (!isBattleRoyaleSquad(match)) {
        throw Object.assign(new Error("This match does not use Battle Royale Squad slots."), { status: 409 });
      }
      await ensureLegacySquadTeams(client, matchId);
      const occupancy = await getSquadOccupancy(client, matchId);
      const priorResult = await client.query<{
        id: string; status: string; team_number: number | null; slot_number: number | null;
      }>(
        `SELECT r.id, r.status, team.team_number, member.slot_number
           FROM daily007_v2_registrations r
           LEFT JOIN daily007_v2_squad_team_members member
             ON member.registration_id = r.id AND member.is_active = true
           LEFT JOIN daily007_v2_squad_teams team ON team.id = member.team_id
          WHERE r.match_id = $1 AND r.captain_user_id = $2
          ORDER BY r.created_at DESC, r.id LIMIT 1`,
        [matchId, account.id],
      );
      const prior = priorResult.rows[0];
      const lifecycleClosed = ["cancelled", "live", "closed", "completed", "setup_needed"].includes(match.status);
      const closed = !match.enabled || lifecycleClosed || match.has_result ||
        !match.registration_open || occupancy.filledPlayers >= 48;
      const canEdit = match.enabled && !lifecycleClosed &&
        !match.has_result && match.edit_open;
      const rows = await client.query<{
        team_number: number; captain_registration_id: string | null; legacy_registration_id: string | null;
        captain_game_name: string | null; slot_number: number | null;
        registration_id: string | null; game_name: string | null;
      }>(
        `SELECT numbers.team_number, team.captain_registration_id, team.legacy_registration_id,
                captain.captain_game_name, member.slot_number, member.registration_id,
                COALESCE(registration.captain_game_name, member.legacy_game_name) AS game_name
           FROM generate_series(1, 12) AS numbers(team_number)
           LEFT JOIN daily007_v2_squad_teams team
             ON team.match_id = $1 AND team.team_number = numbers.team_number
           LEFT JOIN daily007_v2_registrations captain ON captain.id = team.captain_registration_id
           LEFT JOIN daily007_v2_squad_team_members member
             ON member.team_id = team.id AND member.is_active = true
           LEFT JOIN daily007_v2_registrations registration ON registration.id = member.registration_id
          ORDER BY numbers.team_number, member.slot_number`,
        [matchId],
      );
      const teams = Array.from({ length: 12 }, (_, teamIndex) => ({
        teamNumber: teamIndex + 1,
        legacy: false,
        captainGameName: null as string | null,
        slots: Array.from({ length: 4 }, (_, slotIndex) => ({
          slotNumber: slotIndex + 1,
          occupied: false,
          gameName: null as string | null,
          isCaptain: false,
          canJoin: false,
          canRemove: false,
          registrationId: null as string | null,
        })),
      }));
      for (const row of rows.rows) {
        const team = teams[Number(row.team_number) - 1];
        if (!team) continue;
        team.legacy = Boolean(row.legacy_registration_id);
        team.captainGameName = row.captain_game_name?.trim() || null;
        if (row.slot_number === null) continue;
        const slot = team.slots[Number(row.slot_number) - 1];
        if (!slot) continue;
        const isCaptain = Boolean(row.registration_id && row.registration_id === row.captain_registration_id);
        const callerIsCaptain = Boolean(prior?.id && prior.id === row.captain_registration_id);
        slot.occupied = true;
        slot.gameName = row.game_name?.trim() || null;
        slot.isCaptain = isCaptain;
        slot.canRemove = callerIsCaptain && !isCaptain && !team.legacy && canEdit && Boolean(row.registration_id);
        slot.registrationId = slot.canRemove ? row.registration_id : null;
      }
      const canJoin = !closed && !prior;
      for (const team of teams) for (const slot of team.slots) {
        slot.canJoin = canJoin && !team.legacy && !slot.occupied;
      }
      return {
        tournamentId: matchId, teamSize: 4, capacity: 12,
        filledTeams: occupancy.filledTeams, filledPlayers: occupancy.filledPlayers,
        registrationClosed: closed, alreadyRegistered: Boolean(prior),
        myTeamNumber: prior?.team_number ?? null, mySlotNumber: prior?.slot_number ?? null, teams,
      };
    });
    res.json(data);
  } catch (error) {
    const status = (error as { status?: number }).status;
    if (status) return fail(res, status, (error as Error).message);
    throw error;
  }
});

router.post("/daily007/v2/matches/:id/squad-join", authenticate, async (req, res): Promise<void> => {
  const matchId = requestId(req);
  const account = req.daily007Account;
  const body = req.body as unknown;
  if (!matchId) return fail(res, 400, "Match id must be a UUID.");
  if (!account) return fail(res, 401, "A valid Daily007 v2 bearer token is required.");
  if (!isRecord(body)) return fail(res, 400, "Expected the selected team and player slot with your Free Fire details.");
  const teamNumber = body.teamNumber;
  const slotNumber = body.slotNumber;
  const gameName = cleanName(body.gameName, "gameName");
  const gameUid = typeof body.gameUid === "string" ? body.gameUid.trim() : "";
  if (!Number.isInteger(teamNumber) || Number(teamNumber) < 1 || Number(teamNumber) > 12 ||
      !Number.isInteger(slotNumber) || Number(slotNumber) < 1 || Number(slotNumber) > 4 ||
      !gameName || !gameUid || gameUid.length > 128) {
    return fail(res, 400, "Choose a valid team and player slot, then enter a Free Fire name and UID.");
  }
  try {
    const result = await withTransaction(async (client) => {
      const matchResult = await client.query<{
        mode: string; game_mode: string | null; team_type: string | null;
        status: string; enabled: boolean; entry_coins: number; registration_open: boolean;
      }>(
        `SELECT m.mode, m.game_mode, m.team_type, m.status, m.enabled, m.entry_coins,
                m.starts_at > clock_timestamp() + interval '5 hours 30 minutes' AS registration_open
           FROM daily007_v2_matches m WHERE m.id = $1 FOR UPDATE`,
        [matchId],
      );
      const match = matchResult.rows[0];
      if (!match) throw Object.assign(new Error("Match not found."), { status: 404 });
      if (!isBattleRoyaleSquad(match)) {
        throw Object.assign(new Error("Individual slot signup is only available for Battle Royale Squad matches."), { status: 409 });
      }
      await ensureLegacySquadTeams(client, matchId);
      const userResult = await client.query<{ wallet_coins: number; status: string }>(
        "SELECT wallet_coins, status FROM daily007_v2_users WHERE id = $1 FOR UPDATE",
        [account.id],
      );
      const user = userResult.rows[0];
      if (!user) throw Object.assign(new Error("Account not found."), { status: 401 });
      if (user.status === "blocked") throw Object.assign(new Error("This account is blocked."), { status: 403 });
      const priorResult = await client.query<{
        id: string; status: string; team_number: number | null; slot_number: number | null;
        captain_registration_id: string | null; entry_coins_paid: number;
      }>(
        `SELECT r.id, r.status, team.team_number, member.slot_number,
                team.captain_registration_id, r.entry_coins_paid
           FROM daily007_v2_registrations r
           LEFT JOIN daily007_v2_squad_team_members member ON member.registration_id = r.id
           LEFT JOIN daily007_v2_squad_teams team ON team.id = member.team_id
          WHERE r.match_id = $1 AND r.captain_user_id = $2
          ORDER BY r.created_at DESC, r.id LIMIT 1`,
        [matchId, account.id],
      );
      const prior = priorResult.rows[0];
      if (prior) {
        if (prior.status === "removed") {
          throw Object.assign(new Error("You were removed from this Squad. Your entry fee was not refunded, and this account cannot join this match again."), {
            status: 409, code: REGISTRATION_CONFLICT_CODES.alreadyRegistered,
          });
        }
        if (prior.status === "rejected") {
          throw Object.assign(new Error("This registration was rejected and refunded; contact an administrator before trying again."), {
            status: 409, code: REGISTRATION_CONFLICT_CODES.registrationRejected,
          });
        }
        if (prior.team_number && prior.slot_number) {
          const occupancy = await getSquadOccupancy(client, matchId);
          return {
            registrationId: prior.id, teamNumber: Number(prior.team_number),
            slotNumber: Number(prior.slot_number),
            isCaptain: prior.captain_registration_id === prior.id,
            entryCoinsPaid: Number(prior.entry_coins_paid),
            walletCoins: Number(user.wallet_coins),
            filledTeams: occupancy.filledTeams, filledPlayers: occupancy.filledPlayers,
            alreadyRegistered: true,
          };
        }
        throw Object.assign(new Error("This account already has a registration for this match."), {
          status: 409, code: REGISTRATION_CONFLICT_CODES.alreadyRegistered,
        });
      }
      if (!match.enabled || ["cancelled", "live", "closed", "completed", "setup_needed"].includes(match.status)) {
        throw Object.assign(new Error("This tournament is not accepting registrations."), {
          status: 409, code: REGISTRATION_CONFLICT_CODES.tournamentDisabled,
        });
      }
      if (!match.registration_open) {
        throw Object.assign(new Error("Registration is closed because the match has started."), {
          status: 409, code: REGISTRATION_CONFLICT_CODES.matchClosed,
        });
      }
      const occupancy = await getSquadOccupancy(client, matchId);
      if (occupancy.filledPlayers >= 48) {
        throw Object.assign(new Error("All 48 player slots are full."), {
          status: 409, code: REGISTRATION_CONFLICT_CODES.matchFull,
        });
      }
      const duplicateUid = await client.query<{ id: string }>(
        `SELECT member.id
           FROM daily007_v2_squad_team_members member
           JOIN daily007_v2_squad_teams team ON team.id = member.team_id
           LEFT JOIN daily007_v2_registrations registration ON registration.id = member.registration_id
          WHERE team.match_id = $1 AND member.is_active = true
            AND lower(COALESCE(registration.captain_game_uid, member.legacy_game_uid, '')) = lower($2)
          LIMIT 1`,
        [matchId, gameUid],
      );
      if (duplicateUid.rows[0]) {
        throw Object.assign(new Error("This Free Fire UID is already registered for this tournament."), {
          status: 409, code: REGISTRATION_CONFLICT_CODES.gameUidAlreadyRegistered,
        });
      }
      let teamId: string;
      let captainRegistrationId: string | null;
      const existingTeam = await client.query<{
        id: string; captain_registration_id: string | null; legacy_registration_id: string | null;
      }>(
        `SELECT id, captain_registration_id, legacy_registration_id
           FROM daily007_v2_squad_teams
          WHERE match_id = $1 AND team_number = $2 FOR UPDATE`,
        [matchId, Number(teamNumber)],
      );
      if (existingTeam.rows[0]?.legacy_registration_id) {
        throw Object.assign(new Error("Existing whole-team registrations cannot accept individual slot joins."), {
          status: 409,
        });
      }
      if (existingTeam.rows[0]) {
        teamId = existingTeam.rows[0].id;
        captainRegistrationId = existingTeam.rows[0].captain_registration_id;
      } else {
        const created = await client.query<{ id: string; captain_registration_id: string | null }>(
          `INSERT INTO daily007_v2_squad_teams (match_id, team_number)
           VALUES ($1, $2) RETURNING id, captain_registration_id`,
          [matchId, Number(teamNumber)],
        );
        teamId = created.rows[0].id;
        captainRegistrationId = created.rows[0].captain_registration_id;
      }
      const slotResult = await client.query<{ id: string }>(
        `SELECT id FROM daily007_v2_squad_team_members
          WHERE team_id = $1 AND slot_number = $2 AND is_active = true
          FOR UPDATE`,
        [teamId, Number(slotNumber)],
      );
      if (slotResult.rows[0]) {
        throw Object.assign(new Error("That player slot was just taken. Refresh the team list and choose an open slot."), {
          status: 409,
        });
      }
      const captainName = cleanName(account.name, "captainName");
      if (!captainName) throw Object.assign(new Error("Add a Daily007 profile name before joining."), { status: 400 });
      if (Number(user.wallet_coins) < Number(match.entry_coins)) {
        throw Object.assign(new Error(`Insufficient wallet balance: this entry costs ${match.entry_coins} coins.`), {
          status: 409, code: REGISTRATION_CONFLICT_CODES.insufficientBalance,
        });
      }
      const registrationResult = await client.query<{ id: string }>(
        `INSERT INTO daily007_v2_registrations
           (match_id, captain_user_id, captain_name, captain_game_name, captain_game_uid,
            team_name, entry_coins_paid, status)
         VALUES ($1, $2, $3, $4, $5, $6, $7, 'approved')
         RETURNING id`,
        [
          matchId, account.id, captainName, gameName, gameUid,
          `Team ${String(teamNumber).padStart(2, "0")}`, match.entry_coins,
        ],
      );
      const registrationId = registrationResult.rows[0].id;
      await client.query(
        `INSERT INTO daily007_v2_squad_team_members (team_id, slot_number, registration_id)
         VALUES ($1, $2, $3)`,
        [teamId, Number(slotNumber), registrationId],
      );
      const isCaptain = captainRegistrationId === null;
      if (isCaptain) {
        await client.query(
          "UPDATE daily007_v2_squad_teams SET captain_registration_id = $2 WHERE id = $1",
          [teamId, registrationId],
        );
      }
      const newBalance = Number(user.wallet_coins) - Number(match.entry_coins);
      if (Number(match.entry_coins) > 0) {
        await client.query("UPDATE daily007_v2_users SET wallet_coins = $2 WHERE id = $1", [account.id, newBalance]);
        await client.query(
          `INSERT INTO daily007_v2_wallet_ledger (user_id, amount, balance_after, reason, match_id, registration_id)
           VALUES ($1, $2, $3, 'match_entry', $4, $5)`,
          [account.id, -Number(match.entry_coins), newBalance, matchId, registrationId],
        );
      }
      const updated = await getSquadOccupancy(client, matchId);
      const full = updated.filledPlayers >= 48;
      await client.query(
        "UPDATE daily007_v2_matches SET is_full = $2, status = $3 WHERE id = $1",
        [matchId, full, full ? "full" : "open"],
      );
      return {
        registrationId, teamNumber: Number(teamNumber), slotNumber: Number(slotNumber),
        isCaptain, entryCoinsPaid: Number(match.entry_coins), walletCoins: newBalance,
        filledTeams: updated.filledTeams, filledPlayers: updated.filledPlayers,
        alreadyRegistered: false,
      };
    });
    res.status(result.alreadyRegistered ? 200 : 201).json(result);
  } catch (error) {
    const status = (error as { status?: number }).status;
    if (status) {
      const code = (error as { code?: unknown }).code;
      fail(res, status, (error as Error).message, isRegistrationConflictCode(code) ? code : undefined);
      return;
    }
    if ((error as { code?: string }).code === "23505") {
      fail(res, 409, "This account or player slot is already registered.", REGISTRATION_CONFLICT_CODES.alreadyRegistered);
      return;
    }
    throw error;
  }
});

router.delete(
  "/daily007/v2/matches/:id/squad-slots/:teamNumber/:slotNumber",
  authenticate,
  async (req, res): Promise<void> => {
    const matchId = requestId(req);
    const account = req.daily007Account;
    const teamNumber = Number(req.params.teamNumber);
    const slotNumber = Number(req.params.slotNumber);
    if (!matchId || !Number.isInteger(teamNumber) || teamNumber < 1 || teamNumber > 12 ||
        !Number.isInteger(slotNumber) || slotNumber < 1 || slotNumber > 4) {
      return fail(res, 400, "Match, team, and slot identifiers are invalid.");
    }
    if (!account) return fail(res, 401, "A valid Daily007 v2 bearer token is required.");
    try {
      const result = await withTransaction(async (client) => {
        const matchResult = await client.query<{
          mode: string; game_mode: string | null; team_type: string | null;
          status: string; enabled: boolean; edit_open: boolean; has_result: boolean;
        }>(
          `SELECT m.mode, m.game_mode, m.team_type, m.status, m.enabled,
                  m.starts_at > clock_timestamp() + interval '6 hours' AS edit_open,
                  EXISTS (SELECT 1 FROM daily007_v2_result_awards a WHERE a.match_id = m.id) AS has_result
             FROM daily007_v2_matches m WHERE m.id = $1 FOR UPDATE`,
          [matchId],
        );
        const match = matchResult.rows[0];
        if (!match) throw Object.assign(new Error("Match not found."), { status: 404 });
        if (!isBattleRoyaleSquad(match)) {
          throw Object.assign(new Error("This match does not use Battle Royale Squad slots."), { status: 409 });
        }
        await ensureLegacySquadTeams(client, matchId);
        const teamResult = await client.query<{
          id: string; captain_registration_id: string | null; legacy_registration_id: string | null;
          captain_user_id: string | null;
        }>(
          `SELECT team.id, team.captain_registration_id, team.legacy_registration_id,
                  captain.captain_user_id
             FROM daily007_v2_squad_teams team
             LEFT JOIN daily007_v2_registrations captain ON captain.id = team.captain_registration_id
            WHERE team.match_id = $1 AND team.team_number = $2
            FOR UPDATE OF team`,
          [matchId, teamNumber],
        );
        const team = teamResult.rows[0];
        if (!team) throw Object.assign(new Error("Team not found."), { status: 404 });
        if (team.captain_user_id !== account.id) {
          throw Object.assign(new Error("Only this team's captain can remove a teammate."), { status: 403 });
        }
        if (team.legacy_registration_id) {
          throw Object.assign(new Error("Existing whole-team registrations cannot be edited through Squad slots."), { status: 409 });
        }
        if (!match.enabled || ["cancelled", "live", "closed", "completed", "setup_needed"].includes(match.status) ||
            match.has_result || !match.edit_open) {
          throw Object.assign(new Error("Teammates can only be removed before the registration cutoff, 30 minutes before the match."), { status: 409 });
        }
        const memberResult = await client.query<{ id: string; registration_id: string | null }>(
          `SELECT id, registration_id FROM daily007_v2_squad_team_members
            WHERE team_id = $1 AND slot_number = $2 AND is_active = true
            FOR UPDATE`,
          [team.id, slotNumber],
        );
        const member = memberResult.rows[0];
        if (!member?.registration_id) throw Object.assign(new Error("That player slot is empty."), { status: 404 });
        if (member.registration_id === team.captain_registration_id) {
          throw Object.assign(new Error("A captain cannot remove themself from the team."), { status: 409 });
        }
        await client.query(
          `UPDATE daily007_v2_squad_team_members
              SET is_active = false, removed_at = clock_timestamp(), removed_by_user_id = $2
            WHERE id = $1`,
          [member.id, account.id],
        );
        await client.query(
          "UPDATE daily007_v2_registrations SET status = 'removed' WHERE id = $1 AND status = 'approved'",
          [member.registration_id],
        );
        const occupancy = await getSquadOccupancy(client, matchId);
        const full = occupancy.filledPlayers >= 48;
        await client.query(
          "UPDATE daily007_v2_matches SET is_full = $2, status = $3 WHERE id = $1",
          [matchId, full, full ? "full" : "open"],
        );
        return {
          teamNumber, slotNumber, refunded: false,
          message: "Player removed. The entry fee was not refunded; the open slot can be filled by another player.",
        };
      });
      res.json(result);
    } catch (error) {
      const status = (error as { status?: number }).status;
      if (status) return fail(res, status, (error as Error).message);
      throw error;
    }
  },
);

router.post(["/daily007/v2/matches/:id/register", "/tournaments/:id/join"], authenticate, async (req, res): Promise<void> => {
  const matchId = requestId(req);
  if (!matchId) {
    fail(res, 400, "Match id must be a UUID.");
    return;
  }
  const body = req.body as unknown;
  if (!isRecord(body)) {
    fail(res, 400, "Expected captain details and, for team formats, the exact teammate roster for the selected format.");
    return;
  }
  const account = req.daily007Account;
  if (!account) {
    fail(res, 401, "A valid Daily007 v2 bearer token is required.");
    return;
  }
  const legacy = req.path.startsWith("/tournaments/");
  const captainName = cleanName(account.name, "captainName");
  if (!captainName) {
    const message = "Add a Daily007 profile name between 1 and 100 characters before registering.";
    fail(res, 400, message, undefined, { captainProfileName: message });
    return;
  }
  const captainGameName = cleanName(body.captainGameName, "captainGameName");
  if (!captainGameName) {
    const message = "captainGameName must be 1–100 characters.";
    fail(res, 400, message, undefined, { captainGameName: message });
    return;
  }
  const captainGameUid = typeof (legacy ? body.gameUid : body.captainGameUid) === "string"
    ? String(legacy ? body.gameUid : body.captainGameUid).trim()
    : "";
  if (!captainGameUid || captainGameUid.length > 128) {
    const message = "captainGameUid is required and must contain 1–128 characters.";
    fail(res, 400, message, undefined, { captainGameUid: message });
    return;
  }
  try {
    const registered = await withTransaction(async (client) => {
      const matchResult = await client.query<{
        id: string; mode: string; game_mode: string | null; team_type: string | null;
        capacity: number; status: string; entry_coins: number; starts_at: Date; enabled: boolean;
      }>(
        // Keep this locked fee as the single source for the response, registration, wallet, and ledger.
        "SELECT id, mode, game_mode, team_type, capacity, status, entry_coins, starts_at, enabled FROM daily007_v2_matches WHERE id = $1 FOR UPDATE",
        [matchId],
      );
      const match = matchResult.rows[0];
      if (!match) throw Object.assign(new Error("Match not found."), { status: 404 });
      const modeConfig = legacyTournamentMode(match.mode, match.game_mode, match.team_type);
      if (modeConfig.gameMode === "battle_royale" && modeConfig.teamType === "squad") {
        throw Object.assign(new Error("Battle Royale Squad uses individually selectable player slots. Choose a team and slot before joining."), {
          status: 409,
        });
      }

      const userResult = await client.query<{ wallet_coins: number; status: string }>(
        "SELECT wallet_coins, status FROM daily007_v2_users WHERE id = $1 FOR UPDATE",
        [account.id],
      );
      const lockedUser = userResult.rows[0];
      const balance = lockedUser?.wallet_coins;
      if (balance === undefined) throw Object.assign(new Error("Account not found."), { status: 401 });
      if (lockedUser.status === "blocked") {
        throw Object.assign(new Error("This account is blocked."), { status: 403 });
      }

      // Match row serialization makes this lookup race-safe for simultaneous retries.
      const existing = await client.query<{
        id: string; captain_game_name: string; captain_game_uid: string; team_name: string | null; entry_coins_paid: number;
        balance_after: number; capacity: number; status: string; is_full: boolean; registration_status: string;
      }>(
        `SELECT r.id, r.captain_game_name, r.captain_game_uid, r.team_name, r.entry_coins_paid, l.balance_after,
                m.capacity, m.status, m.is_full, r.status AS registration_status
           FROM daily007_v2_registrations r
           JOIN daily007_v2_wallet_ledger l ON l.registration_id = r.id
           JOIN daily007_v2_matches m ON m.id = r.match_id
          WHERE r.match_id = $1 AND r.captain_user_id = $2`,
        [matchId, account.id],
      );
      if (existing.rows[0]) {
        if (existing.rows[0].registration_status === "rejected") {
          throw Object.assign(new Error("This registration was rejected and refunded; contact an administrator before trying again."), {
            status: 409,
            code: REGISTRATION_CONFLICT_CODES.registrationRejected,
          });
        }
        const countResult = await client.query<{ count: string }>(
          "SELECT count(*)::text AS count FROM daily007_v2_registrations WHERE match_id = $1 AND status IN ('approved', 'pending')",
          [matchId],
        );
        const prior = existing.rows[0];
        const savedRoster = await client.query<{ name: string; uid: string | null }>(
          `SELECT member_name AS name, member_uid AS uid
             FROM daily007_v2_roster
            WHERE registration_id = $1
            ORDER BY position`,
          [prior.id],
        );
        return {
          registrationId: prior.id,
          captainGameName: prior.captain_game_name,
          captainGameUid: prior.captain_game_uid,
          teamName: prior.team_name ?? "",
          teammates: savedRoster.rows,
          entryCoinsPaid: prior.entry_coins_paid,
          walletCoins: prior.balance_after,
          registeredCount: Number(countResult.rows[0].count),
          capacity: prior.capacity,
          isFull: prior.is_full,
          status: prior.registration_status,
          matchStatus: prior.status,
          alreadyRegistered: true,
        };
      }

      const upcoming = await client.query<{ upcoming: boolean }>(
        "SELECT starts_at > clock_timestamp() + interval '5 hours 30 minutes' AS upcoming FROM daily007_v2_matches WHERE id = $1",
        [matchId],
      );
      if (!upcoming.rows[0]?.upcoming) {
        throw Object.assign(new Error("Registration is closed because the match has started."), {
          status: 409,
          code: REGISTRATION_CONFLICT_CODES.matchClosed,
        });
      }
      if (!match.enabled) {
        throw Object.assign(new Error("This tournament is disabled and is not accepting registrations."), {
          status: 409,
          code: REGISTRATION_CONFLICT_CODES.tournamentDisabled,
        });
      }
      if (match.status !== "open") {
        throw Object.assign(new Error("This match is already full and is not accepting registrations."), {
          status: 409,
          code: REGISTRATION_CONFLICT_CODES.matchFull,
        });
      }
      let teammates: { name: string; uid: string | null }[] = [];
      let submittedTeamName = "";
      const teammateCount = modeConfig.teamSize - 1;
      let teammateInput: unknown = legacy ? [] : (body.teammates ?? []);
      if (legacy) {
        let members: unknown = body.teamMembers;
        if (typeof members === "string") {
          try { members = JSON.parse(members) as unknown; } catch { members = null; }
        }
        submittedTeamName = typeof body.teamName === "string" ? body.teamName.trim() : "";
        if (!Array.isArray(members) || members.length !== modeConfig.teamSize ||
            !isRecord(members[0]) ||
            String(members[0].name ?? "").trim() !== captainGameName ||
            String(members[0].uid ?? "").trim() !== captainGameUid) {
          throw Object.assign(new Error(`${modeConfig.teamTypeLabel} registrations require exactly ${modeConfig.teamSize} player${modeConfig.teamSize === 1 ? "" : "s"}, with the captain listed first.`), { status: 400 });
        }
        teammateInput = members.slice(1).map((member) => isRecord(member)
          ? { name: member.name, uid: member.uid || null }
          : null);
      } else if (body.teamName !== undefined) {
        submittedTeamName = typeof body.teamName === "string" ? body.teamName.trim() : "";
      }
      if (modeConfig.teamSize > 1 && (!submittedTeamName || submittedTeamName.length > 100)) {
        const message = "Team registrations require a team name between 1 and 100 characters.";
        throw registrationFieldError(message, { teamName: message });
      }
      if (submittedTeamName.length > 100) {
        const message = "Team name must not exceed 100 characters.";
        throw registrationFieldError(message, modeConfig.teamSize > 1 ? { teamName: message } : undefined);
      }
      const parsedTeammates = parseTeamMembers(teammateInput, teammateCount);
      if (!parsedTeammates) {
        const message = `${modeConfig.teamTypeLabel} registrations require exactly ${teammateCount} teammate name${teammateCount === 1 ? "" : "s"}; teammate UIDs are optional and must be unique.`;
        throw registrationFieldError(message, teammateRosterFieldErrors(teammateInput, teammateCount));
      }
      const submittedUids = [captainGameUid, ...parsedTeammates.flatMap((member) => member.uid ? [member.uid] : [])];
      const submittedUidFields = [
        "captainGameUid",
        ...parsedTeammates.flatMap((member, index) => member.uid ? [`memberUid:${index}`] : []),
      ];
      const seenSubmittedUids = new Map<string, string>();
      const duplicateUidFields: Record<string, string> = {};
      for (let index = 0; index < submittedUids.length; index++) {
        const normalizedUid = submittedUids[index].toLocaleLowerCase();
        const previousField = seenSubmittedUids.get(normalizedUid);
        if (previousField) {
          const message = "Each player in the registration must have a different game UID.";
          duplicateUidFields[previousField] = message;
          duplicateUidFields[submittedUidFields[index]] = message;
        } else {
          seenSubmittedUids.set(normalizedUid, submittedUidFields[index]);
        }
      }
      if (Object.keys(duplicateUidFields).length > 0) {
        throw registrationFieldError("Each player in the registration must have a different game UID.", duplicateUidFields);
      }
      teammates = parsedTeammates;
      const duplicateUid = await client.query<{ id: string }>(
        `SELECT r.id
           FROM daily007_v2_registrations r
          WHERE r.match_id = $1 AND r.status IN ('approved', 'pending')
            AND (lower(r.captain_game_uid) = ANY($2::text[]) OR EXISTS (
              SELECT 1 FROM daily007_v2_roster roster
               WHERE roster.registration_id = r.id AND roster.member_uid IS NOT NULL
                 AND lower(roster.member_uid) = ANY($2::text[])
            ))
          LIMIT 1`,
        [matchId, submittedUids],
      );
      if (duplicateUid.rows[0]) {
        throw Object.assign(new Error("A player game UID is already registered for this tournament."), {
          status: 409,
          code: REGISTRATION_CONFLICT_CODES.gameUidAlreadyRegistered,
        });
      }
      const countResult = await client.query<{ count: string }>(
        "SELECT count(*)::text AS count FROM daily007_v2_registrations WHERE match_id = $1 AND status IN ('approved', 'pending')",
        [matchId],
      );
      const currentCount = Number(countResult.rows[0].count);
      if (currentCount >= match.capacity) {
        throw Object.assign(new Error("This match is full."), {
          status: 409,
          code: REGISTRATION_CONFLICT_CODES.matchFull,
        });
      }
      if (balance < match.entry_coins) {
        throw Object.assign(new Error(`Insufficient wallet balance: this entry costs ${match.entry_coins} coins.`), {
          status: 409,
          code: REGISTRATION_CONFLICT_CODES.insufficientBalance,
        });
      }
      const registrationResult = await client.query<{ id: string }>(
        `INSERT INTO daily007_v2_registrations
           (match_id, captain_user_id, captain_name, captain_game_name, captain_game_uid, team_name, entry_coins_paid, status)
         VALUES ($1, $2, $3, $4, $5, $6, $7, 'approved') RETURNING id`,
        [matchId, account.id, captainName, captainGameName, captainGameUid, submittedTeamName, match.entry_coins],
      );
      const registrationId = registrationResult.rows[0].id;
      if (teammates.length > 0) {
        for (let position = 0; position < teammates.length; position++) {
          const teammate = teammates[position];
          await client.query(
            "INSERT INTO daily007_v2_roster (registration_id, position, member_uid, member_name) VALUES ($1, $2, $3, $4)",
            [registrationId, position + 1, teammate.uid, teammate.name],
          );
        }
      }
      const newBalance = balance - match.entry_coins;
      if (match.entry_coins > 0) {
        await client.query("UPDATE daily007_v2_users SET wallet_coins = $2 WHERE id = $1", [account.id, newBalance]);
      }
      await client.query(
        `INSERT INTO daily007_v2_wallet_ledger (user_id, amount, balance_after, reason, match_id, registration_id)
         VALUES ($1, $2, $3, 'match_entry', $4, $5)`,
        [account.id, -match.entry_coins, newBalance, matchId, registrationId],
      );
      const newCount = currentCount + 1;
      const full = newCount >= match.capacity;
      const matchStatus = full && match.mode === "clash" ? "setup_needed" : full ? "full" : "open";
      if (full) {
        await client.query("UPDATE daily007_v2_matches SET status = $2, is_full = true WHERE id = $1", [matchId, matchStatus]);
      }
      return {
        registrationId,
        captainGameName,
        captainGameUid,
        teamName: submittedTeamName,
        teammates,
        entryCoinsPaid: match.entry_coins,
        walletCoins: newBalance,
        registeredCount: newCount,
        capacity: match.capacity,
        isFull: full,
        status: "approved",
        matchStatus,
        alreadyRegistered: false,
      };
    });
    res.status(registered.alreadyRegistered ? 200 : 201).json(registered);
  } catch (error) {
    const status = (error as { status?: number }).status;
    if (status) {
      const errorCode = (error as { code?: unknown }).code;
      const code = isRegistrationConflictCode(errorCode) ? errorCode : undefined;
      const fieldErrors = (error as { fieldErrors?: unknown }).fieldErrors;
      fail(res, status, (error as Error).message, code,
        isRecord(fieldErrors) ? fieldErrors as Record<string, string> : undefined);
      return;
    }
    if ((error as { code?: string }).code === "23505") {
      fail(res, 409, "This account is already registered for the match.", REGISTRATION_CONFLICT_CODES.alreadyRegistered);
      return;
    }
    throw error;
  }
});

router.post("/daily007/v2/admin/users/:id/wallet", authenticate, async (req, res): Promise<void> => {
  if (!requireAdmin(req, res)) return;
  const adminId = req.daily007Account?.id;
  if (!adminId) {
    fail(res, 401, "A valid Daily007 account is required.");
    return;
  }
  const id = requestId(req);
  const body = req.body as unknown;
  if (!id) {
    fail(res, 400, "User id must be a UUID.");
    return;
  }
  if (!isRecord(body) || typeof body.amount !== "number" || !Number.isSafeInteger(body.amount) ||
      body.amount <= 0 || body.amount > 2_147_483_647) {
    fail(res, 400, "amount must be a positive integer no greater than 2,147,483,647.");
    return;
  }
  const reason = cleanName(body.reason, "reason");
  if (!reason) {
    fail(res, 400, "reason must be 1–100 characters.");
    return;
  }
  let result: number | null;
  try {
    result = await withDaily007RoleTransaction(adminId, "admin", async (client) => {
      const user = await client.query<{ wallet_coins: number }>(
        "SELECT wallet_coins FROM daily007_v2_users WHERE id = $1 FOR UPDATE",
        [id],
      );
      if (!user.rows[0]) return null;
      const balance = user.rows[0].wallet_coins + (body.amount as number);
      if (!Number.isSafeInteger(balance) || balance > 2_147_483_647) {
        throw Object.assign(new Error("The resulting wallet balance exceeds the supported integer range."), { status: 400 });
      }
      await client.query("UPDATE daily007_v2_users SET wallet_coins = $2 WHERE id = $1", [id, balance]);
      await client.query(
        "INSERT INTO daily007_v2_wallet_ledger (user_id, amount, balance_after, reason) VALUES ($1, $2, $3, $4)",
        [id, body.amount, balance, `admin_credit:${reason}`],
      );
      return balance;
    });
  } catch (error) {
    const status = (error as { status?: number }).status;
    if (status) {
      fail(res, status, (error as Error).message);
      return;
    }
    throw error;
  }
  if (result === null) {
    fail(res, 404, "User not found.");
    return;
  }
  res.json({ userId: id, walletCoins: result });
});

router.put("/daily007/v2/admin/matches/:id/room", authenticate, async (req, res): Promise<void> => {
  if (!requireTournamentAdmin(req, res)) return;
  const id = requestId(req);
  const body = req.body as unknown;
  if (!id) {
    fail(res, 400, "Match id must be a UUID.");
    return;
  }
  if (!isRecord(body) || typeof body.roomId !== "string" || !body.roomId.trim() ||
      body.roomId.length > 200 || typeof body.roomPassword !== "string" ||
      !body.roomPassword.trim() || body.roomPassword.length > 200) {
    fail(res, 400, "roomId and roomPassword must each contain 1–200 characters.");
    return;
  }
  const roomId = body.roomId.trim();
  const roomPassword = body.roomPassword.trim();
  let result;
  try {
    result = await withDaily007RoleTransaction(
      req.daily007Account!.id,
      "tournament_admin",
      async (client) => {
        const updated = await client.query(
          `UPDATE daily007_v2_matches
              SET room_id = $2, room_password = $3, room_published = true
            WHERE id = $1 AND status <> 'cancelled'
            RETURNING id, room_published AS published`,
          [id, roomId, roomPassword],
        );
        if (updated.rows[0]) return { match: updated.rows[0], exists: true };
        const exists = await client.query("SELECT 1 FROM daily007_v2_matches WHERE id = $1", [id]);
        return { match: null, exists: Boolean(exists.rows[0]) };
      },
    );
  } catch (error) {
    const status = (error as { status?: number }).status;
    if (status) {
      fail(res, status, (error as Error).message);
      return;
    }
    throw error;
  }
  if (!result.match) {
    fail(res, 404, "Match not found or cancelled.");
    return;
  }
  res.json({ match: result.match });
});

router.get("/daily007/v2/matches/:id/room", authenticate, async (req, res): Promise<void> => {
  const matchId = requestId(req);
  if (!matchId) {
    fail(res, 400, "Match id must be a UUID.");
    return;
  }
  const account = req.daily007Account;
  if (!account) {
    fail(res, 401, "A valid Daily007 v2 bearer token is required.");
    return;
  }
  const result = await pool.query<{
    room_id: string | null; room_password: string | null;
    starts_at: Date; tournament_status: string; registered: boolean;
  }>(
    `SELECT m.room_id, m.room_password, m.starts_at, m.status AS tournament_status,
             EXISTS(SELECT 1 FROM daily007_v2_registrations r
                     WHERE r.match_id = m.id AND r.captain_user_id = $2 AND r.status = 'approved') AS registered
       FROM daily007_v2_matches m WHERE m.id = $1`,
    [matchId, account.id],
  );
  const match = result.rows[0];
  if (!match) {
    fail(res, 404, "Match not found.");
    return;
  }
  if (!match.registered) {
    fail(res, 403, "Room credentials are available only to registered users.");
    return;
  }
  const startsAt = tournamentInstantFromStored(match.starts_at);
  if (!isRoomCredentialReleaseOpen(startsAt)) {
    fail(res, 403, "Room credentials become available five minutes before the match starts.");
    return;
  }
  if (!canRevealRoomCredentials({
    registrationStatus: "approved",
    tournamentStatus: match.tournament_status,
    roomId: match.room_id,
    roomPassword: match.room_password,
    startsAt,
  })) {
    fail(res, 404, "Room credentials are not available for this match.");
    return;
  }
  res.json({ roomId: match.room_id, roomPassword: match.room_password });
});

router.get("/daily007/v2/admin/matches/:id/registrations.csv", authenticate, async (req, res): Promise<void> => {
  if (!requireTournamentAdmin(req, res)) return;
  const id = requestId(req);
  if (!id) {
    fail(res, 400, "Match id must be a UUID.");
    return;
  }
  const match = await pool.query<{ title: string }>("SELECT title FROM daily007_v2_matches WHERE id = $1", [id]);
  if (!match.rows[0]) {
    fail(res, 404, "Match not found.");
    return;
  }
  const registrations = await pool.query<{
    registration_id: string; captain_name: string; captain_game_name: string; captain_game_uid: string;
    team_name: string;
    email: string; created_at: Date; position: number | null;
    member_name: string | null; member_uid: string | null;
  }>(
    `SELECT r.id AS registration_id, r.captain_name, r.captain_game_name, r.captain_game_uid,
            r.team_name, u.email, r.created_at,
            ro.position, ro.member_name, ro.member_uid
       FROM daily007_v2_registrations r
       JOIN daily007_v2_users u ON u.id = r.captain_user_id
       LEFT JOIN daily007_v2_roster ro ON ro.registration_id = r.id
       WHERE r.match_id = $1 AND r.status = 'approved'
      ORDER BY r.created_at, r.id, ro.position`,
    [id],
  );
  const rosterRows: {
    captainName: string; captainGameName: string; captainGameUid: string; teamName: string;
    email: string; registeredAt: string;
    teammates: ({ name: string; uid: string | null } | null)[];
  }[] = [];
  let currentRegistrationId: string | null = null;
  for (const row of registrations.rows) {
    if (row.registration_id !== currentRegistrationId) {
      rosterRows.push({
        captainName: row.captain_name,
        captainGameName: row.captain_game_name,
        captainGameUid: row.captain_game_uid,
        teamName: row.team_name,
        email: row.email,
        registeredAt: row.created_at.toISOString(),
        teammates: [null, null, null],
      });
      currentRegistrationId = row.registration_id;
    }
    if (row.position !== null && row.member_name !== null) {
      const roster = rosterRows[rosterRows.length - 1];
      roster.teammates[row.position - 1] = { name: row.member_name, uid: row.member_uid };
    }
  }
  const lines = [
    [
      "captain_profile_name", "captain_game_name", "captain_game_uid", "captain_email",
      "team_name",
      "teammate_1_name", "teammate_1_game_uid",
      "teammate_2_name", "teammate_2_game_uid",
      "teammate_3_name", "teammate_3_game_uid",
      "registered_at",
    ].map(csvCell).join(","),
    ...rosterRows.map((row) => [
      row.captainName,
      row.captainGameName,
      row.captainGameUid,
      row.email,
      row.teamName,
      ...row.teammates.flatMap((teammate) => [teammate?.name ?? "", teammate?.uid ?? ""]),
      row.registeredAt,
    ].map(csvCell).join(",")),
  ];
  res.setHeader("Cache-Control", "no-store");
  res.setHeader("Content-Type", "text/csv; charset=utf-8");
  res.setHeader("Content-Disposition", `attachment; filename="daily007-${id}-registrations.csv"`);
  res.send(`${lines.join("\r\n")}\r\n`);
});

export default router;