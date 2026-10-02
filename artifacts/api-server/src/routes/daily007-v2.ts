import { createHmac, randomBytes, scrypt as scryptCallback, timingSafeEqual } from "node:crypto";
import { promisify } from "node:util";
import { Router, type IRouter, type Request, type Response, type NextFunction } from "express";
import { pool } from "@workspace/db";
import { csvCell, parseFutureTimestamp, parseTeamMembers } from "../lib/daily007-v2-validation";
import { awardDaily007SignupBonus, ensureDaily007ReferralCode } from "../lib/daily007-referrals";
import { legacyTournamentMode, resolveTournamentMode } from "../lib/daily007-mode-rules";
import { hasTournamentAdminAccess, isFullAdminRole, type Daily007Role } from "../lib/daily007-roles";

const scrypt = promisify(scryptCallback);
const router: IRouter = Router();
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const PASSWORD_BYTES = 64;
const TOKEN_LIFETIME_SECONDS = 60 * 60 * 24 * 14;

export type Account = {
  id: string; name: string; email: string; role: Daily007Role; wallet_coins: number;
  phone?: string | null; game_uid?: string | null; status?: "active" | "blocked";
};
type SqlClient = {
  query<T = unknown>(text: string, values?: unknown[]): Promise<{ rows: T[] }>;
  release(): void;
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

function fail(res: Response, status: number, error: string): void {
  res.status(status).json({ error });
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

function tokenSecret(): string | null {
  // Reuse the workspace-managed signing secret until a dedicated v2 key is configured.
  const secret = process.env.DAILY007_AUTH_SECRET || process.env.SESSION_SECRET;
  return secret && secret.length >= 32 ? secret : null;
}

export function makeToken(userId: string): string | null {
  const secret = tokenSecret();
  if (!secret) return null;
  const payload = Buffer.from(JSON.stringify({
    sub: userId,
    exp: Math.floor(Date.now() / 1000) + TOKEN_LIFETIME_SECONDS,
  })).toString("base64url");
  const signature = createHmac("sha256", secret).update(payload).digest("base64url");
  return `${payload}.${signature}`;
}

export function readToken(token: string): string | null {
  const secret = tokenSecret();
  if (!secret) return null;
  const parts = token.split(".");
  if (parts.length !== 2) return null;
  const expected = createHmac("sha256", secret).update(parts[0]).digest();
  let supplied: Buffer;
  try {
    supplied = Buffer.from(parts[1], "base64url");
  } catch {
    return null;
  }
  if (expected.length !== supplied.length || !timingSafeEqual(expected, supplied)) return null;
  try {
    const payload: unknown = JSON.parse(Buffer.from(parts[0], "base64url").toString("utf8"));
    if (!isRecord(payload) || typeof payload.sub !== "string" ||
        typeof payload.exp !== "number" || payload.exp <= Math.floor(Date.now() / 1000) ||
        !UUID_PATTERN.test(payload.sub)) return null;
    return payload.sub;
  } catch {
    return null;
  }
}

export async function authenticate(req: Request, res: Response, next: NextFunction): Promise<void> {
  if (!tokenSecret()) {
    fail(res, 503, "Daily007 v2 authentication needs DAILY007_AUTH_SECRET or SESSION_SECRET (at least 32 characters).");
    return;
  }
  const authorization = req.get("authorization") ?? "";
  const match = /^Bearer\s+(.+)$/i.exec(authorization);
  const userId = match ? readToken(match[1]) : null;
  if (!userId) {
    fail(res, 401, "A valid Daily007 v2 bearer token is required.");
    return;
  }
  const result = await pool.query<Account>(
    "SELECT id, name, email, role, wallet_coins, phone, game_uid, status FROM daily007_v2_users WHERE id = $1",
    [userId],
  );
  if (!result.rows[0]) {
    fail(res, 401, "Account not found.");
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

function cleanName(value: unknown, label: string): string | null {
  return typeof value === "string" && value.trim().length > 0 && value.trim().length <= 100
    ? value.trim()
    : null;
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
  if (!tokenSecret()) {
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
    const token = makeToken(account.id);
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
  if (!tokenSecret()) {
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
  if (!user || body.password.length > 200) {
    fail(res, 401, "Email or password is incorrect.");
    return;
  }
  if (user.status === "blocked") {
    fail(res, 403, "This account is blocked.");
    return;
  }
  const candidate = await hashPassword(body.password, Buffer.from(user.password_salt, "hex"));
  const expected = Buffer.from(user.password_hash, "hex");
  const actual = Buffer.from(candidate.hash, "hex");
  if (expected.length !== actual.length || !timingSafeEqual(expected, actual)) {
    fail(res, 401, "Email or password is incorrect.");
    return;
  }
  const token = makeToken(user.id);
  res.json({
    token,
    account: {
      id: user.id, name: user.name, email: user.email, role: user.role, wallet_coins: user.wallet_coins,
      phone: user.phone, game_uid: user.game_uid, status: user.status,
    },
  });
});

router.get("/daily007/v2/auth/me", authenticate, (req, res): void => {
  const account = req.daily007Account;
  if (!account) {
    fail(res, 401, "A valid Daily007 v2 bearer token is required.");
    return;
  }
  res.json({
    id: account.id, name: account.name, email: account.email, phone: account.phone,
    gameUid: account.game_uid, role: account.role, status: account.status,
    coins: account.wallet_coins, walletCoins: account.wallet_coins,
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
  res.json({ matches: result.rows });
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
  const startsAt = parseFutureTimestamp(body.startsAt);
  const entryCoins = body.entryCoins === undefined ? 0 : body.entryCoins;
  if (!title || !configuredMode ||
      !startsAt || !Number.isInteger(entryCoins) ||
      typeof entryCoins !== "number" || entryCoins < 0 || entryCoins > 2_147_483_647) {
    fail(res, 400, "Provide a title, supported game mode and team type, future startsAt timestamp, and nonnegative 32-bit integer entryCoins.");
    return;
  }
  const result = await pool.query(
    `INSERT INTO daily007_v2_matches (title, mode, game_mode, team_type, capacity, starts_at, entry_coins)
     SELECT $1, $2, $3, $4, $5, $6, $7
      WHERE $6::timestamptz > clock_timestamp()
     RETURNING id, title, mode, game_mode AS "gameMode", team_type AS "teamType",
               capacity, entry_coins AS "entryCoins", starts_at AS "startsAt", status, is_full AS "isFull"`,
    [title, configuredMode.storageMode, configuredMode.gameMode, configuredMode.teamType,
      configuredMode.capacity, startsAt, entryCoins],
  );
  if (!result.rows[0]) {
    fail(res, 400, "startsAt must be in the future when the match is created.");
    return;
  }
  res.status(201).json({ match: result.rows[0] });
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
  const startsAt = hasStartsAt ? parseFutureTimestamp(body.startsAt) : null;
  if ((!hasEntryCoins && !hasStartsAt) ||
      (hasEntryCoins && (typeof body.entryCoins !== "number" ||
        !Number.isInteger(body.entryCoins) || body.entryCoins < 0 ||
        body.entryCoins > 2_147_483_647)) ||
      (hasStartsAt && !startsAt)) {
    fail(res, 400, "Provide entryCoins as a nonnegative 32-bit integer and/or startsAt as a valid future ISO timestamp.");
    return;
  }
  const result = await pool.query(
    `UPDATE daily007_v2_matches
        SET entry_coins = COALESCE($2, entry_coins),
            starts_at = COALESCE($3, starts_at)
      WHERE id = $1 AND COALESCE($3::timestamptz, starts_at) > clock_timestamp()
     RETURNING id, title, mode, capacity, entry_coins AS "entryCoins", starts_at AS "startsAt", status, is_full AS "isFull"`,
    [id, hasEntryCoins ? body.entryCoins : null, startsAt],
  );
  if (!result.rows[0]) {
    const exists = await pool.query("SELECT 1 FROM daily007_v2_matches WHERE id = $1", [id]);
    fail(res, exists.rows[0] ? 400 : 404,
      exists.rows[0] ? "startsAt must be in the future when the match is updated." : "Match not found.");
    return;
  }
  res.json({ match: result.rows[0] });
});

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
  const captainName = cleanName(legacy ? body.playerName : body.captainName, "captainName");
  if (!captainName) {
    fail(res, 400, "captainName must be 1–100 characters.");
    return;
  }
  const captainGameName = cleanName(body.captainGameName, "captainGameName");
  if (!captainGameName) {
    fail(res, 400, "captainGameName must be 1–100 characters.");
    return;
  }
  const captainGameUid = typeof (legacy ? body.gameUid : body.captainGameUid) === "string"
    ? String(legacy ? body.gameUid : body.captainGameUid).trim()
    : "";
  if (!captainGameUid || captainGameUid.length > 128) {
    fail(res, 400, "captainGameUid is required and must contain 1–128 characters.");
    return;
  }
  try {
    const registered = await withTransaction(async (client) => {
      const matchResult = await client.query<{
        id: string; mode: string; game_mode: string | null; team_type: string | null;
        capacity: number; status: string; entry_coins: number; starts_at: Date; enabled: boolean;
      }>(
        "SELECT id, mode, game_mode, team_type, capacity, status, entry_coins, starts_at, enabled FROM daily007_v2_matches WHERE id = $1 FOR UPDATE",
        [matchId],
      );
      const match = matchResult.rows[0];
      if (!match) throw Object.assign(new Error("Match not found."), { status: 404 });
      const modeConfig = legacyTournamentMode(match.mode, match.game_mode, match.team_type);

      // Match row serialization makes this lookup race-safe for simultaneous retries.
      const existing = await client.query<{
        id: string; captain_game_name: string; captain_game_uid: string; entry_coins_paid: number;
        balance_after: number; capacity: number; status: string; is_full: boolean; registration_status: string;
      }>(
        `SELECT r.id, r.captain_game_name, r.captain_game_uid, r.entry_coins_paid, l.balance_after,
                m.capacity, m.status, m.is_full, r.status AS registration_status
           FROM daily007_v2_registrations r
           JOIN daily007_v2_wallet_ledger l ON l.registration_id = r.id
           JOIN daily007_v2_matches m ON m.id = r.match_id
          WHERE r.match_id = $1 AND r.captain_user_id = $2`,
        [matchId, account.id],
      );
      if (existing.rows[0]) {
        if (existing.rows[0].registration_status === "rejected") {
          throw Object.assign(new Error("This registration was rejected and refunded; contact an administrator before trying again."), { status: 409 });
        }
        const countResult = await client.query<{ count: string }>(
          "SELECT count(*)::text AS count FROM daily007_v2_registrations WHERE match_id = $1 AND status IN ('approved', 'pending')",
          [matchId],
        );
        const prior = existing.rows[0];
        return {
          registrationId: prior.id,
          captainGameName: prior.captain_game_name,
          captainGameUid: prior.captain_game_uid,
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
        "SELECT starts_at > clock_timestamp() AS upcoming FROM daily007_v2_matches WHERE id = $1",
        [matchId],
      );
      if (!upcoming.rows[0]?.upcoming) {
        throw Object.assign(new Error("Registration is closed because the match has started."), { status: 409 });
      }
      if (!match.enabled) {
        throw Object.assign(new Error("This tournament is disabled and is not accepting registrations."), { status: 409 });
      }
      if (match.status !== "open") {
        throw Object.assign(new Error("This match is already full and is not accepting registrations."), { status: 409 });
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
        throw Object.assign(new Error("Team registrations require a team name between 1 and 100 characters."), { status: 400 });
      }
      if (submittedTeamName.length > 100) {
        throw Object.assign(new Error("Team name must not exceed 100 characters."), { status: 400 });
      }
      const parsedTeammates = parseTeamMembers(teammateInput, teammateCount);
      if (!parsedTeammates) {
        throw Object.assign(new Error(`${modeConfig.teamTypeLabel} registrations require exactly ${teammateCount} teammate name${teammateCount === 1 ? "" : "s"}; teammate UIDs are optional and must be unique.`), { status: 400 });
      }
      const submittedUids = [captainGameUid, ...parsedTeammates.flatMap((member) => member.uid ? [member.uid] : [])]
        .map((uid) => uid.toLocaleLowerCase());
      if (new Set(submittedUids).size !== submittedUids.length) {
        throw Object.assign(new Error("Each player in the registration must have a different game UID."), { status: 400 });
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
        throw Object.assign(new Error("A player game UID is already registered for this tournament."), { status: 409 });
      }
      const countResult = await client.query<{ count: string }>(
        "SELECT count(*)::text AS count FROM daily007_v2_registrations WHERE match_id = $1 AND status IN ('approved', 'pending')",
        [matchId],
      );
      const currentCount = Number(countResult.rows[0].count);
      if (currentCount >= match.capacity) throw Object.assign(new Error("This match is full."), { status: 409 });
      const userResult = await client.query<{ wallet_coins: number }>(
        "SELECT wallet_coins FROM daily007_v2_users WHERE id = $1 FOR UPDATE",
        [account.id],
      );
      const balance = userResult.rows[0]?.wallet_coins;
      if (balance === undefined) throw Object.assign(new Error("Account not found."), { status: 401 });
      if (balance < match.entry_coins) throw Object.assign(new Error(`Insufficient wallet balance: this entry costs ${match.entry_coins} coins.`), { status: 409 });
      const registrationResult = await client.query<{ id: string }>(
        `INSERT INTO daily007_v2_registrations
           (match_id, captain_user_id, captain_name, captain_game_name, captain_game_uid, team_name, entry_coins_paid, status)
         VALUES ($1, $2, $3, $4, $5, $6, $7, 'pending') RETURNING id`,
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
        entryCoinsPaid: match.entry_coins,
        walletCoins: newBalance,
        registeredCount: newCount,
        capacity: match.capacity,
        isFull: full,
        status: "pending",
        matchStatus,
        alreadyRegistered: false,
      };
    });
    res.status(registered.alreadyRegistered ? 200 : 201).json(registered);
  } catch (error) {
    const status = (error as { status?: number }).status;
    if (status) {
      fail(res, status, (error as Error).message);
      return;
    }
    if ((error as { code?: string }).code === "23505") {
      fail(res, 409, "This account is already registered for the match.");
      return;
    }
    throw error;
  }
});

router.post("/daily007/v2/admin/users/:id/wallet", authenticate, async (req, res): Promise<void> => {
  if (!requireAdmin(req, res)) return;
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
    result = await withTransaction(async (client) => {
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
      !body.roomPassword.trim() || body.roomPassword.length > 200 ||
      typeof body.published !== "boolean") {
    fail(res, 400, "roomId and roomPassword must each contain 1–200 characters, and published must be a boolean.");
    return;
  }
  const result = await pool.query(
    `UPDATE daily007_v2_matches
        SET room_id = $2, room_password = $3, room_published = $4
      WHERE id = $1
      RETURNING id, room_published AS published`,
    [id, body.roomId.trim(), body.roomPassword.trim(), body.published],
  );
  if (!result.rows[0]) {
    fail(res, 404, "Match not found.");
    return;
  }
  res.json({ match: result.rows[0] });
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
    room_id: string | null; room_password: string | null; room_published: boolean;
    starts_at: Date; registered: boolean;
  }>(
    `SELECT m.room_id, m.room_password, m.room_published, m.starts_at,
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
  if (!match.room_published || !match.room_id || !match.room_password) {
    fail(res, 404, "Room credentials have not been published.");
    return;
  }
  if (Date.now() < new Date(match.starts_at).getTime() - 15 * 60 * 1000) {
    fail(res, 403, "Room credentials become available 15 minutes before the match starts.");
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
    email: string; created_at: Date; position: number | null;
    member_name: string | null; member_uid: string | null;
  }>(
    `SELECT r.id AS registration_id, r.captain_name, r.captain_game_name, r.captain_game_uid, u.email, r.created_at,
            ro.position, ro.member_name, ro.member_uid
       FROM daily007_v2_registrations r
       JOIN daily007_v2_users u ON u.id = r.captain_user_id
       LEFT JOIN daily007_v2_roster ro ON ro.registration_id = r.id
       WHERE r.match_id = $1 AND r.status = 'approved'
      ORDER BY r.created_at, r.id, ro.position`,
    [id],
  );
  const rosterRows: {
    captainName: string; captainGameName: string; captainGameUid: string; email: string; registeredAt: string;
    teammates: ({ name: string; uid: string | null } | null)[];
  }[] = [];
  let currentRegistrationId: string | null = null;
  for (const row of registrations.rows) {
    if (row.registration_id !== currentRegistrationId) {
      rosterRows.push({
        captainName: row.captain_name,
        captainGameName: row.captain_game_name,
        captainGameUid: row.captain_game_uid,
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
      "captain_real_name", "captain_game_name", "captain_game_uid", "captain_email",
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
      ...row.teammates.flatMap((teammate) => [teammate?.name ?? "", teammate?.uid ?? ""]),
      row.registeredAt,
    ].map(csvCell).join(",")),
  ];
  res.setHeader("Content-Type", "text/csv; charset=utf-8");
  res.setHeader("Content-Disposition", `attachment; filename="daily007-${id}-registrations.csv"`);
  res.send(`${lines.join("\r\n")}\r\n`);
});

export default router;