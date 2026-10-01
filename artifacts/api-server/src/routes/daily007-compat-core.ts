import { timingSafeEqual } from "node:crypto";
import { Router, type IRouter, type Request, type Response } from "express";
import { pool } from "@workspace/db";
import { ensureDaily007ReferralCode, recordReferralSignup } from "../lib/daily007-referrals";
import { authenticate, hashPassword, makeToken, requireAdmin } from "./daily007-v2";

const router: IRouter = Router();
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const CAPACITY: Record<string, number> = { solo: 48, squad: 12, clash: 2 };
const MODES: Record<string, { mode: string; teamType: string; legacyMode: string }> = {
  solo: { mode: "solo", teamType: "Solo", legacyMode: "Battle Royale" },
  squad: { mode: "squad", teamType: "Squad", legacyMode: "Battle Royale" },
  clash: { mode: "clash", teamType: "Squad", legacyMode: "Clash Squad" },
};
type MatchRow = {
  id: string; title: string; mode: string; capacity: number; entry_coins: number;
  prize_pool: number; starts_at: Date | string; status: string; is_full: boolean;
  rules: string; banner: string; prize_distribution: string; enabled: boolean;
  room_id: string | null; room_password: string | null; room_time: string; room_published: boolean;
  registered_count: number;
};
type RegistrationRow = {
  id: string; match_id: string; captain_user_id: string; captain_name: string; captain_game_uid: string;
  team_name: string; entry_coins_paid: number; status: string; created_at: Date | string;
  name?: string; email?: string; mode?: string; capacity?: number; starts_at?: Date | string;
  match_entry_coins?: number;
  match_status?: string;
  title?: string; prize_pool?: number; rules?: string; banner?: string; prize_distribution?: string;
  enabled?: boolean; is_full?: boolean; room_id?: string | null; room_password?: string | null;
  room_time?: string; room_published?: boolean; registered_count?: number;
  result_rank?: number | null; result_kills?: number | null; result_prize_coins?: number | null;
};
type SqlClient = {
  query<T = unknown>(text: string, values?: unknown[]): Promise<{ rows: T[] }>;
  release(): void;
};

function record(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function fail(res: Response, status: number, error: string): void {
  res.status(status).json({ error });
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
  if (!Number.isFinite(value.getTime()) || value.toISOString().slice(0, 10) !== date || value.getTime() <= Date.now()) return null;
  return value;
}

export function legacyMode(body: Record<string, unknown>): string | null {
  const mode = typeof body.mode === "string" ? body.mode.trim().toLowerCase() : "";
  const teamType = typeof body.teamType === "string" ? body.teamType.trim().toLowerCase() : "";
  if (mode === "clash squad" || mode === "clash" || mode === "clashsquad") return teamType === "squad" ? "clash" : null;
  if (mode === "battle royale" || mode === "battleroyale" || mode === "battle-royale") {
    if (teamType === "solo") return "solo";
    if (teamType === "squad") return "squad";
  }
  // Clients that submit normalized v2 modes are also accepted.
  if (mode in CAPACITY && (mode !== "clash" || teamType === "squad")) return mode;
  return null;
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
  const mode = MODES[row.mode] ?? MODES.solo;
  const filledSlots = Number(row.registered_count ?? 0);
  return {
    id: row.id,
    name: row.title,
    mode: mode.legacyMode,
    teamType: mode.teamType,
    date,
    time,
    startsAt: new Date(row.starts_at).toISOString(),
    entryCoins: row.entry_coins,
    prizePool: row.prize_pool,
    totalSlots: row.capacity,
    rules: row.rules,
    banner: row.banner,
    prizeDist: row.prize_distribution,
    enabled: row.enabled,
    status: row.enabled ? row.status : "closed",
    filledSlots,
    availableSlots: Math.max(0, row.capacity - filledSlots),
    ...(includeRoomCredentials ? { roomId: row.room_id, roomPassword: row.room_password } : {}),
    roomTime: row.room_time,
    roomPublished: row.room_published,
  };
}

async function getMatches(id?: string, enabledOnly = false): Promise<MatchRow[]> {
  const clauses: string[] = [];
  const values: unknown[] = [];
  if (id) {
    values.push(id);
    clauses.push(`m.id = $${values.length}`);
  }
  if (enabledOnly) clauses.push("m.enabled = true");
  const result = await pool.query<MatchRow>(
    `SELECT m.id, m.title, m.mode, m.capacity, m.entry_coins, m.prize_pool, m.starts_at,
            m.status, m.is_full, m.rules, m.banner, m.prize_distribution, m.enabled,
            m.room_id, m.room_password, m.room_time, m.room_published,
            count(r.id) FILTER (WHERE r.status IN ('approved', 'pending'))::integer AS registered_count
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
      const referralReward = await recordReferralSignup(client, referralCode, user.id);
      if (referralReward) user.wallet_coins = referralReward.walletCoins;
      return { user, referralStatus: referralSignupStatus(referralCode) };
    });
    const { user, referralStatus } = signup;
    const token = makeToken(user.id);
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
  const result = await pool.query<{
    id: string; name: string; email: string; phone: string | null; game_uid: string | null;
    role: string; status: string; wallet_coins: number; password_salt: string; password_hash: string;
  }>(
    `SELECT id, name, email, phone, game_uid, role, status, wallet_coins, password_salt, password_hash
       FROM daily007_v2_users WHERE email = $1`,
    [body.email.trim().toLowerCase()],
  );
  const user = result.rows[0];
  if (!user || body.password.length > 200) return fail(res, 401, "Email or password is incorrect.");
  if (user.status === "blocked") return fail(res, 403, "This account is blocked.");
  const candidate = await hashPassword(body.password, Buffer.from(user.password_salt, "hex"));
  const expected = Buffer.from(user.password_hash, "hex");
  const actual = Buffer.from(candidate.hash, "hex");
  if (expected.length !== actual.length || !timingSafeEqual(expected, actual)) {
    return fail(res, 401, "Email or password is incorrect.");
  }
  const token = makeToken(user.id);
  if (!token) return fail(res, 503, "Daily007 authentication is not configured.");
  res.json({ ...asLegacyUser(user), token });
});

router.get("/auth/me", authenticate, (req, res): void => {
  const account = req.daily007Account;
  if (!account) return fail(res, 401, "Authentication is required.");
  res.json(asLegacyUser(account));
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

router.get("/tournaments/:id", async (req, res): Promise<void> => {
  const id = idFrom(req);
  if (!id) return fail(res, 400, "Tournament id must be a UUID.");
  const result = await getMatches(id);
  if (!result[0]) return fail(res, 404, "Tournament not found.");
  res.json(tournament(result[0]));
});

function tournamentValues(body: Record<string, unknown>, fallback?: MatchRow) {
  const mode = body.mode === undefined && fallback ? fallback.mode : legacyMode(body);
  const title = body.name === undefined && fallback ? fallback.title : nonempty(body.name, 100);
  const entryCoins = body.entryCoins === undefined && fallback ? fallback.entry_coins : body.entryCoins;
  const prizePool = body.prizePool === undefined && fallback ? fallback.prize_pool : body.prizePool;
  const rules = body.rules === undefined && fallback
    ? fallback.rules
    : typeof body.rules === "string" && body.rules.length <= 10_000 ? body.rules : null;
  const banner = body.banner === undefined && fallback ? fallback.banner : nonempty(body.banner, 100);
  const prizeDistribution = body.prizeDist === undefined && fallback
    ? fallback.prize_distribution
    : typeof body.prizeDist === "string" && body.prizeDist.length <= 10_000 ? body.prizeDist : null;
  let startsAt: Date | null = null;
  if (body.date !== undefined || body.time !== undefined) {
    const existing = fallback ? startsAsLegacy(fallback.starts_at) : null;
    startsAt = parseStart(body.date ?? existing?.date, body.time ?? existing?.time);
  } else if (fallback) startsAt = new Date(fallback.starts_at);
  if (body.enabled !== undefined && typeof body.enabled !== "boolean") return null;
  if (!mode || !Object.hasOwn(CAPACITY, mode) || !title || !nonnegativeInt(entryCoins) ||
      !nonnegativeInt(prizePool) || rules === null || !banner || prizeDistribution === null ||
      !startsAt || !Number.isFinite(startsAt.getTime()) || startsAt.getTime() <= Date.now()) return null;
  return {
    mode, title, capacity: CAPACITY[mode], entryCoins, prizePool, startsAt,
    rules, banner, prizeDistribution,
    enabled: body.enabled === undefined ? fallback?.enabled ?? true : body.enabled,
  };
}

router.post("/tournaments", authenticate, async (req, res): Promise<void> => {
  if (!requireAdmin(req, res)) return;
  if (!record(req.body)) return fail(res, 400, "Expected tournament fields.");
  const values = tournamentValues(req.body);
  if (!values) return fail(res, 400, "Tournament fields are invalid; use a supported game mode, future date/time, and nonnegative integer coin values.");
  const result = await pool.query(
    `INSERT INTO daily007_v2_matches
       (title, mode, capacity, entry_coins, prize_pool, starts_at, rules, banner, prize_distribution, enabled)
     SELECT $1, $2, $3, $4, $5, $6, $7, $8, $9, $10
      WHERE $6::timestamptz > clock_timestamp()
     RETURNING id`,
    [values.title, values.mode, values.capacity, values.entryCoins, values.prizePool, values.startsAt,
      values.rules, values.banner, values.prizeDistribution, values.enabled],
  );
  if (!result.rows[0]) return fail(res, 400, "Tournament start time must still be in the future.");
  const created = await getMatches(result.rows[0].id as string);
  res.status(201).json(tournament(created[0]));
});

router.patch("/tournaments/:id", authenticate, async (req, res): Promise<void> => {
  if (!requireAdmin(req, res)) return;
  const id = idFrom(req);
  if (!id) return fail(res, 400, "Tournament id must be a UUID.");
  if (!record(req.body)) return fail(res, 400, "Expected tournament fields.");
  try {
    const outcome = await transaction(async (client) => {
      const selected = await client.query<MatchRow>(
        `SELECT id, title, mode, capacity, entry_coins, prize_pool, starts_at,
                status, is_full, rules, banner, prize_distribution, enabled,
                room_id, room_password, room_time, room_published, 0::integer AS registered_count
           FROM daily007_v2_matches WHERE id = $1 FOR UPDATE`,
        [id],
      );
      const current = selected.rows[0];
      if (!current) return "missing" as const;
      const values = tournamentValues(req.body as Record<string, unknown>, current);
      if (!values) return "invalid" as const;
      const count = await client.query<{ count: string }>(
        "SELECT count(*)::text AS count FROM daily007_v2_registrations WHERE match_id = $1 AND status IN ('approved', 'pending')",
        [id],
      );
      const activeCount = Number(count.rows[0].count);
      if (activeCount > values.capacity || (current.mode !== values.mode && activeCount > 0)) {
        return "capacity" as const;
      }
      const capacityState = matchCapacityState(values.mode, activeCount, values.capacity);
      const updated = await client.query<{ id: string }>(
        `UPDATE daily007_v2_matches
            SET title = $2, mode = $3, capacity = $4, entry_coins = $5, prize_pool = $6,
                starts_at = $7, rules = $8, banner = $9, prize_distribution = $10, enabled = $11,
                is_full = $12, status = $13
          WHERE id = $1 AND $7::timestamptz > clock_timestamp()
          RETURNING id`,
        [id, values.title, values.mode, values.capacity, values.entryCoins, values.prizePool,
          values.startsAt, values.rules, values.banner, values.prizeDistribution, values.enabled,
          capacityState.isFull, capacityState.status],
      );
      // A time can pass while validation/locking is in progress.
      if (!updated.rows[0]) return "invalid" as const;
      return "updated" as const;
    });
    if (outcome === "missing") return fail(res, 404, "Tournament not found.");
    if (outcome === "invalid") return fail(res, 400, "Tournament fields are invalid; use a supported game mode, future date/time, and nonnegative integer coin values.");
    if (outcome === "capacity") return fail(res, 409, "Capacity or game mode cannot be reduced/changed below the current active registration count.");
  } catch (error) {
    throw error;
  }
  res.json(tournament((await getMatches(id))[0]));
});

router.delete("/tournaments/:id", authenticate, async (req, res): Promise<void> => {
  if (!requireAdmin(req, res)) return;
  const id = idFrom(req);
  if (!id) return fail(res, 400, "Tournament id must be a UUID.");
  const current = (await getMatches(id))[0];
  if (!current) return fail(res, 404, "Tournament not found.");
  if (current.entry_coins > 0) return fail(res, 409, "Paid tournaments cannot be deleted; disable the tournament instead.");
  const registrations = await pool.query<{ count: string }>(
    "SELECT count(*)::text AS count FROM daily007_v2_registrations WHERE match_id = $1", [id],
  );
  if (Number(registrations.rows[0].count) > 0) {
    await pool.query("UPDATE daily007_v2_matches SET enabled = false WHERE id = $1", [id]);
    res.json({ success: true, data: { id, enabled: false, deleted: false } });
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
    { name: row.captain_name, uid: row.captain_game_uid, ign: "" },
    ...roster.map((member) => ({ name: member.member_name, uid: member.member_uid ?? "", ign: "" })),
  ]);
}

function mayExposeRoom(row: RegistrationRow): boolean {
  return Boolean(row.room_published && row.room_id && row.room_password && row.starts_at &&
    Date.now() >= new Date(row.starts_at).getTime() - 15 * 60 * 1000);
}

router.get("/my/registrations", authenticate, async (req, res): Promise<void> => {
  const account = req.daily007Account;
  if (!account) return fail(res, 401, "Authentication is required.");
  const result = await pool.query<RegistrationRow>(
    `SELECT r.id, r.match_id, r.captain_user_id, r.captain_name, r.captain_game_uid, r.team_name,
            r.entry_coins_paid, r.status, r.created_at, m.title, m.mode, m.capacity, m.starts_at,
            m.entry_coins AS match_entry_coins, m.status AS match_status,
            m.prize_pool, m.rules, m.banner, m.prize_distribution, m.enabled, m.is_full,
            m.room_id, m.room_password, m.room_time, m.room_published,
            award.rank AS result_rank, award.kills AS result_kills, award.prize_coins AS result_prize_coins,
            (SELECT count(*)::integer FROM daily007_v2_registrations active
              WHERE active.match_id = m.id AND active.status IN ('approved', 'pending')) AS registered_count
       FROM daily007_v2_registrations r JOIN daily007_v2_matches m ON m.id = r.match_id
       LEFT JOIN daily007_v2_result_awards award ON award.registration_id = r.id
      WHERE r.captain_user_id = $1 AND r.status = 'approved'
      ORDER BY r.created_at DESC`,
    [account.id],
  );
  const data = await Promise.all(result.rows.map(async (row) => {
    const expose = mayExposeRoom(row);
    const t = tournament({
      ...row, id: row.match_id, title: row.title!, entry_coins: row.match_entry_coins!,
      prize_pool: row.prize_pool!, capacity: row.capacity!, starts_at: row.starts_at!,
      status: row.match_status!,
      registered_count: row.registered_count!, is_full: row.is_full!, rules: row.rules!,
      banner: row.banner!, prize_distribution: row.prize_distribution!, enabled: row.enabled!,
      room_id: row.room_id!, room_password: row.room_password!, room_time: row.room_time!,
      room_published: row.room_published!,
    } as MatchRow, expose);
    const roster = await getRoster(row.id);
    return {
      id: row.id, tournamentId: row.match_id, status: "approved",
      playerName: row.captain_name, gameUid: row.captain_game_uid, teamName: row.team_name,
      teamMembers: roster.length ? asTeamMembers(row, roster) : "[]",
      entryCoins: row.entry_coins_paid, createdAt: new Date(row.created_at).toISOString(),
      result: row.result_rank === null || row.result_rank === undefined
        ? undefined
        : `Rank ${row.result_rank} · ${row.result_kills ?? 0} kills · ${row.result_prize_coins ?? 0} coins`,
      roomId: expose ? row.room_id : undefined,
      roomPassword: expose ? row.room_password : undefined,
      roomTime: expose ? row.room_time : undefined,
      roomPublished: expose,
      tournament: t,
    };
  }));
  res.json(data);
});

router.get("/admin/registrations", authenticate, async (req, res): Promise<void> => {
  if (!requireAdmin(req, res)) return;
  const result = await pool.query<RegistrationRow>(
    `SELECT r.id, r.match_id, r.captain_user_id, r.captain_name, r.captain_game_uid, r.team_name,
            r.entry_coins_paid, r.status, r.created_at, u.name, u.email, m.title, m.mode
       FROM daily007_v2_registrations r
       JOIN daily007_v2_users u ON u.id = r.captain_user_id
       JOIN daily007_v2_matches m ON m.id = r.match_id
      ORDER BY r.created_at DESC`,
  );
  const data = await Promise.all(result.rows.map(async (row) => {
    const roster = await getRoster(row.id);
    return {
      id: row.id, tournamentId: row.match_id, tournamentName: row.title,
      mode: MODES[row.mode ?? "solo"]?.legacyMode ?? row.mode,
      teamType: MODES[row.mode ?? "solo"]?.teamType,
      status: row.status, playerName: row.captain_name, gameUid: row.captain_game_uid,
      teamName: row.team_name, teamMembers: roster.length ? asTeamMembers(row, roster) : "[]",
      entryCoins: row.entry_coins_paid, createdAt: new Date(row.created_at).toISOString(),
      userId: row.captain_user_id, userName: row.name, email: row.email,
    };
  }));
  res.json(data);
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

async function rejectRegistration(registrationId: string): Promise<"done" | "missing"> {
  return transaction(async (client) => {
    const ref = await client.query<{ match_id: string }>(
      "SELECT match_id FROM daily007_v2_registrations WHERE id = $1", [registrationId],
    );
    if (!ref.rows[0]) return "missing";
    const match = await client.query<{ capacity: number; mode: string }>(
      "SELECT capacity, mode FROM daily007_v2_matches WHERE id = $1 FOR UPDATE", [ref.rows[0].match_id],
    );
    const result = await client.query<{
      id: string; match_id: string; captain_user_id: string; entry_coins_paid: number; status: string;
    }>(
      "SELECT id, match_id, captain_user_id, entry_coins_paid, status FROM daily007_v2_registrations WHERE id = $1 FOR UPDATE",
      [registrationId],
    );
    const registration = result.rows[0];
    if (!registration) return "missing";
    if (registration.status === "rejected") return "done";
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
    if (match.rows[0]) {
      const count = await client.query<{ count: string }>(
        "SELECT count(*)::text AS count FROM daily007_v2_registrations WHERE match_id = $1 AND status IN ('approved', 'pending')",
        [registration.match_id],
      );
      const capacityState = matchCapacityState(match.rows[0].mode, Number(count.rows[0].count), match.rows[0].capacity);
      await client.query(
        "UPDATE daily007_v2_matches SET is_full = $2, status = $3 WHERE id = $1",
        [registration.match_id, capacityState.isFull, capacityState.status],
      );
    }
    return "done";
  });
}

async function approveRegistration(registrationId: string): Promise<"approved" | "missing" | "rejected" | "full"> {
  return transaction(async (client) => {
    const ref = await client.query<{ match_id: string }>(
      "SELECT match_id FROM daily007_v2_registrations WHERE id = $1", [registrationId],
    );
    if (!ref.rows[0]) return "missing";
    const matchResult = await client.query<{ capacity: number; mode: string }>(
      "SELECT capacity, mode FROM daily007_v2_matches WHERE id = $1 FOR UPDATE", [ref.rows[0].match_id],
    );
    const match = matchResult.rows[0];
    if (!match) return "missing";
    const registrationResult = await client.query<{ status: string }>(
      "SELECT status FROM daily007_v2_registrations WHERE id = $1 FOR UPDATE", [registrationId],
    );
    const registration = registrationResult.rows[0];
    if (!registration) return "missing";
    if (registration.status === "rejected") return "rejected";
    const count = await client.query<{ count: string }>(
      "SELECT count(*)::text AS count FROM daily007_v2_registrations WHERE match_id = $1 AND status IN ('approved', 'pending')",
      [ref.rows[0].match_id],
    );
    const activeCount = Number(count.rows[0].count);
    const capacityState = matchCapacityState(match.mode, activeCount, match.capacity);
    if (registration.status === "approved") {
      await client.query(
        "UPDATE daily007_v2_matches SET is_full = $2, status = $3 WHERE id = $1",
        [ref.rows[0].match_id, capacityState.isFull, capacityState.status],
      );
      return "approved";
    }
    if (!canApproveWithinCapacity(activeCount, match.capacity)) return "full";
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
  if (!requireAdmin(req, res)) return;
  const id = idFrom(req);
  const action = req.params.action;
  if (!id) return fail(res, 400, "Registration id must be a UUID.");
  if (action !== "approve" && action !== "reject") return fail(res, 404, "Registration action not found.");
  if (action === "approve") {
    const approved = await approveRegistration(id);
    if (approved === "missing") return fail(res, 404, "Registration not found.");
    if (approved === "rejected") return fail(res, 409, "A rejected and refunded registration cannot be approved again.");
    if (approved === "full") return fail(res, 409, "Registration capacity has been reached; this pending registration cannot be approved.");
    res.json({ success: true, data: { id, status: "approved" } });
    return;
  }
  if (await rejectRegistration(id) === "missing") return fail(res, 404, "Registration not found.");
  res.json({ success: true, data: { id, status: "rejected", refunded: true } });
});

router.delete("/admin/registrations/:id", authenticate, async (req, res): Promise<void> => {
  if (!requireAdmin(req, res)) return;
  const id = idFrom(req);
  if (!id) return fail(res, 400, "Registration id must be a UUID.");
  if (await rejectRegistration(id) === "missing") return fail(res, 404, "Registration not found.");
  res.json({ success: true, data: { id, status: "rejected", deleted: false } });
});

router.get("/admin/tournaments/:id/room", authenticate, async (req, res): Promise<void> => {
  if (!requireAdmin(req, res)) return;
  const id = idFrom(req);
  if (!id) return fail(res, 400, "Tournament id must be a UUID.");
  const result = await pool.query<{
    id: string; room_id: string | null; room_password: string | null; room_time: string; room_published: boolean;
  }>(
    "SELECT id, room_id, room_password, room_time, room_published FROM daily007_v2_matches WHERE id = $1", [id],
  );
  const row = result.rows[0];
  if (!row) return fail(res, 404, "Tournament not found.");
  res.json({
    id: row.id, roomId: row.room_id ?? "", roomPassword: row.room_password ?? "",
    roomTime: row.room_time, roomPublished: row.room_published,
  });
});

router.put("/admin/tournaments/:id/room", authenticate, async (req, res): Promise<void> => {
  if (!requireAdmin(req, res)) return;
  const id = idFrom(req);
  const body = req.body as unknown;
  if (!id) return fail(res, 400, "Tournament id must be a UUID.");
  if (!record(body) || typeof body.publish !== "boolean") {
    return fail(res, 400, "Expected roomId, roomPassword, roomTime, and boolean publish.");
  }
  const roomId = body.roomId === "" ? "" : nonempty(body.roomId, 200);
  const roomPassword = body.roomPassword === "" ? "" : nonempty(body.roomPassword, 200);
  const roomTime = body.roomTime === undefined ? "08:00 PM" : nonempty(body.roomTime, 32);
  if (roomId === null || roomPassword === null || !roomTime || (body.publish && (!roomId || !roomPassword))) {
    return fail(res, 400, "Room credentials must be 1–200 characters when provided; publish requires both credentials.");
  }
  const result = await pool.query(
    `UPDATE daily007_v2_matches
        SET room_id = NULLIF($2, ''), room_password = NULLIF($3, ''),
            room_time = $4, room_published = $5
      WHERE id = $1 RETURNING id, room_published AS "roomPublished"`,
    [id, roomId, roomPassword, roomTime, body.publish],
  );
  if (!result.rows[0]) return fail(res, 404, "Tournament not found.");
  res.json({ ...result.rows[0], roomId, roomPassword, roomTime });
});

router.post("/admin/tournaments/:id/publish-room", authenticate, async (req, res): Promise<void> => {
  if (!requireAdmin(req, res)) return;
  const id = idFrom(req);
  if (!id) return fail(res, 400, "Tournament id must be a UUID.");
  const result = await pool.query(
    `UPDATE daily007_v2_matches
        SET room_published = true
      WHERE id = $1 AND room_id IS NOT NULL AND room_password IS NOT NULL
      RETURNING id, room_published AS "roomPublished"`,
    [id],
  );
  if (!result.rows[0]) {
    const exists = await pool.query("SELECT 1 FROM daily007_v2_matches WHERE id = $1", [id]);
    return fail(res, exists.rows[0] ? 400 : 404, exists.rows[0] ? "Save room credentials before publishing." : "Tournament not found.");
  }
  res.json(result.rows[0]);
});

export default router;