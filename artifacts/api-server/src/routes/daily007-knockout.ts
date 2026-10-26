import { Router, type IRouter, type Request, type Response } from "express";
import { pool } from "@workspace/db";
import { isTournamentStartInFuture, storedTournamentTimeFromInstant, tournamentInstantFromStored } from "../lib/daily007-schedule-time";
import { DEFAULT_KNOCKOUT_SETTINGS, knockoutStages, parseKnockoutSettings } from "../lib/daily007-knockout";
import { authenticate, requireTournamentAdmin, withDaily007RoleTransaction } from "./daily007-v2";

const router: IRouter = Router();
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

type KnockoutRow = {
  matchId: string;
  title: string;
  startsAt: Date | string;
  status: string;
  enabled: boolean;
  isFull: boolean;
  squadCount: number;
  entryCoins: number;
  prizePool: number;
  pointsPerKill: number;
  round1Eliminated: number;
  round2Eliminated: number;
  registeredSquads: number;
  registeredPlayers: number;
};

function fail(res: Response, status: number, error: string): void {
  res.status(status).json({ error });
}

function publicStatus(row: KnockoutRow, now = Date.now()): string {
  if (row.status === "cancelled" || row.status === "completed") return row.status;
  if (!row.enabled) return "draft";
  if (row.isFull || Number(row.registeredPlayers) >= Number(row.squadCount) * 4) return "full";
  return isTournamentStartInFuture(row.startsAt, now) ? "upcoming" : "ongoing";
}

function serializeEvent(row: KnockoutRow) {
  const status = publicStatus(row);
  const stages = knockoutStages(
    Number(row.squadCount),
    Number(row.round1Eliminated),
    Number(row.round2Eliminated),
  );
  return {
    matchId: row.matchId,
    title: row.title,
    startsAt: tournamentInstantFromStored(row.startsAt).toISOString(),
    entryCoins: Number(row.entryCoins),
    squadEntryCoins: Number(row.entryCoins) * 4,
    prizePool: Number(row.prizePool),
    squadCount: Number(row.squadCount),
    playersPerSquad: 4,
    totalPlayers: Number(row.squadCount) * 4,
    stageCount: 3,
    pointsPerKill: Number(row.pointsPerKill),
    round1Eliminated: Number(row.round1Eliminated),
    round2Eliminated: Number(row.round2Eliminated),
    stages,
    registeredSquads: Number(row.registeredSquads),
    registeredPlayers: Number(row.registeredPlayers),
    status,
    published: Boolean(row.enabled) || row.status === "completed" || row.status === "cancelled",
    registrationOpen: status === "upcoming",
  };
}

async function listKnockoutEvents(includeDrafts: boolean): Promise<ReturnType<typeof serializeEvent>[]> {
  const result = await pool.query<KnockoutRow>(
    `SELECT m.id AS "matchId", m.title, m.starts_at AS "startsAt", m.status,
            m.enabled, m.is_full AS "isFull", m.capacity AS "squadCount",
            m.entry_coins AS "entryCoins", m.prize_pool AS "prizePool",
            settings.points_per_kill AS "pointsPerKill",
            settings.round1_eliminated AS "round1Eliminated",
            settings.round2_eliminated AS "round2Eliminated",
            COUNT(DISTINCT team.id) FILTER (
              WHERE member.id IS NOT NULL AND
                (member.registration_id IS NULL OR registration.id IS NOT NULL)
            )::integer AS "registeredSquads",
            COUNT(DISTINCT member.id) FILTER (
              WHERE member.id IS NOT NULL AND
                (member.registration_id IS NULL OR registration.id IS NOT NULL)
            )::integer AS "registeredPlayers"
       FROM daily007_knockout_events settings
       JOIN daily007_v2_matches m ON m.id = settings.match_id
       LEFT JOIN daily007_v2_squad_teams team ON team.match_id = m.id
       LEFT JOIN daily007_v2_squad_team_members member
         ON member.team_id = team.id AND member.is_active = true
       LEFT JOIN daily007_v2_registrations registration
         ON registration.id = member.registration_id
        AND registration.status IN ('approved', 'pending')
      WHERE $1::boolean = true
         OR m.enabled = true
         OR m.status IN ('completed', 'cancelled')
      GROUP BY m.id, settings.match_id, settings.points_per_kill,
               settings.round1_eliminated, settings.round2_eliminated
      ORDER BY CASE WHEN m.starts_at > clock_timestamp() + interval '5 hours 30 minutes'
                    THEN 0 ELSE 1 END,
               m.starts_at ASC, m.id ASC`,
    [includeDrafts],
  );
  return result.rows.map(serializeEvent);
}

router.get("/daily007/v2/knockout/events", async (_req, res): Promise<void> => {
  try {
    const events = await listKnockoutEvents(false);
    res.setHeader("Cache-Control", "no-store");
    res.json({
      defaults: {
        ...DEFAULT_KNOCKOUT_SETTINGS,
        totalPlayers: DEFAULT_KNOCKOUT_SETTINGS.squadCount * DEFAULT_KNOCKOUT_SETTINGS.playersPerSquad,
        squadEntryCoins: DEFAULT_KNOCKOUT_SETTINGS.entryCoins * DEFAULT_KNOCKOUT_SETTINGS.playersPerSquad,
        stages: knockoutStages(12, 2, 2),
      },
      events,
    });
  } catch (error) {
    console.error("[daily007] public knockout events failed", error);
    fail(res, 500, "Could not load Knockout tournament information.");
  }
});

router.get("/daily007/v2/knockout/events/:id/leaderboard", async (req, res): Promise<void> => {
  const matchId = String(req.params.id ?? "");
  if (!UUID_PATTERN.test(matchId)) return fail(res, 400, "Tournament id must be a UUID.");
  try {
    const event = await pool.query(
      `SELECT m.id
         FROM daily007_knockout_events settings
         JOIN daily007_v2_matches m ON m.id = settings.match_id
        WHERE m.id = $1 AND (m.enabled = true OR m.status IN ('completed', 'cancelled'))`,
      [matchId],
    );
    if (!event.rows[0]) return fail(res, 404, "Knockout tournament not found.");
    const result = await pool.query(
      `SELECT team.team_number AS "teamNumber",
              ('Team ' || lpad(team.team_number::text, 2, '0')) AS "teamName",
              COUNT(member.id)::integer AS "registeredPlayers",
              COALESCE(
                jsonb_agg(
                  jsonb_build_object(
                    'playerName', COALESCE(NULLIF(registration.captain_game_name, ''), NULLIF(member.legacy_game_name, ''), 'Player'),
                    'slotNumber', member.slot_number
                  ) ORDER BY member.slot_number
                ) FILTER (WHERE member.id IS NOT NULL),
                '[]'::jsonb
              ) AS players
         FROM daily007_v2_squad_teams team
         LEFT JOIN daily007_v2_squad_team_members member
           ON member.team_id = team.id AND member.is_active = true
         LEFT JOIN daily007_v2_registrations registration
           ON registration.id = member.registration_id
          AND registration.status IN ('approved', 'pending')
        WHERE team.match_id = $1
          AND (member.id IS NULL OR member.registration_id IS NULL OR registration.id IS NOT NULL)
        GROUP BY team.team_number
       HAVING COUNT(member.id) > 0
        ORDER BY team.team_number`,
      [matchId],
    );
    res.setHeader("Cache-Control", "no-store");
    res.json({
      matchId,
      stage: "Round 1",
      standings: result.rows.map((row) => ({ ...row, resultStatus: "Awaiting stage results" })),
      message: "Stage points will be shown after tournament results are entered.",
    });
  } catch (error) {
    console.error("[daily007] knockout leaderboard failed", error);
    fail(res, 500, "Could not load the Knockout leaderboard.");
  }
});

router.get("/daily007/v2/admin/knockout/events", authenticate, async (req, res): Promise<void> => {
  if (!requireTournamentAdmin(req, res)) return;
  try {
    res.setHeader("Cache-Control", "no-store");
    res.json({ events: await listKnockoutEvents(true) });
  } catch (error) {
    console.error("[daily007] admin knockout events failed", error);
    fail(res, 500, "Could not load Knockout tournaments.");
  }
});

router.post("/daily007/v2/admin/knockout/events", authenticate, async (req, res): Promise<void> => {
  if (!requireTournamentAdmin(req, res)) return;
  let settings;
  try {
    settings = parseKnockoutSettings(req.body);
  } catch (error) {
    return fail(res, 400, error instanceof Error ? error.message : "Invalid Knockout settings.");
  }
  try {
    const result = await withDaily007RoleTransaction(
      req.daily007Account!.id,
      "tournament_admin",
      async (client) => {
        const match = await client.query<{ id: string }>(
          `INSERT INTO daily007_v2_matches
             (title, mode, game_mode, team_type, capacity, starts_at, entry_coins,
              prize_pool, enabled, status, is_full, rules, banner)
           VALUES ($1, 'squad', 'knockout_squad', 'squad', $2, $3, $4,
                   $5, $6, 'open', false, $7, 'br')
           RETURNING id`,
          [
            settings.title,
            settings.squadCount,
            storedTournamentTimeFromInstant(new Date(settings.startsAt)),
            settings.entryCoins,
            settings.prizePool,
            settings.published,
            `Knockout format: 3 stages. ${settings.pointsPerKill} point(s) per verified kill.`,
          ],
        );
        const matchId = match.rows[0].id;
        await client.query(
          `INSERT INTO daily007_knockout_events
             (match_id, points_per_kill, round1_eliminated, round2_eliminated, created_by_user_id)
           VALUES ($1, $2, $3, $4, $5)`,
          [
            matchId,
            settings.pointsPerKill,
            settings.round1Eliminated,
            settings.round2Eliminated,
            req.daily007Account!.id,
          ],
        );
        return matchId;
      },
    );
    const event = (await listKnockoutEvents(true)).find((item) => item.matchId === result);
    res.status(201).json({ event });
  } catch (error) {
    const status = (error as { status?: number }).status;
    if (status) return fail(res, status, error instanceof Error ? error.message : "Knockout creation was rejected.");
    console.error("[daily007] create knockout failed", error);
    fail(res, 500, "Could not create the Knockout tournament.");
  }
});

router.patch("/daily007/v2/admin/knockout/events/:id", authenticate, async (req, res): Promise<void> => {
  if (!requireTournamentAdmin(req, res)) return;
  const matchId = String(req.params.id ?? "");
  if (!UUID_PATTERN.test(matchId)) return fail(res, 400, "Tournament id must be a UUID.");
  let settings;
  try {
    settings = parseKnockoutSettings(req.body, { requireFutureStart: false });
  } catch (error) {
    return fail(res, 400, error instanceof Error ? error.message : "Invalid Knockout settings.");
  }
  try {
    await withDaily007RoleTransaction(
      req.daily007Account!.id,
      "tournament_admin",
      async (client) => {
        const existing = await client.query<{
          title: string; starts_at: Date | string; capacity: number; entry_coins: number;
          prize_pool: number; enabled: boolean; status: string; points_per_kill: number;
          round1_eliminated: number; round2_eliminated: number;
        }>(
          `SELECT m.title, m.starts_at, m.capacity, m.entry_coins, m.prize_pool,
                  m.enabled, m.status, settings.points_per_kill,
                  settings.round1_eliminated, settings.round2_eliminated
             FROM daily007_v2_matches m
             JOIN daily007_knockout_events settings ON settings.match_id = m.id
            WHERE m.id = $1
            FOR UPDATE OF m, settings`,
          [matchId],
        );
        const row = existing.rows[0];
        if (!row) throw Object.assign(new Error("Knockout tournament not found."), { status: 404 });
        if (row.status === "cancelled" || row.status === "completed") {
          throw Object.assign(new Error("Completed or cancelled Knockout tournaments cannot be changed."), { status: 409 });
        }

        const activePlayers = await client.query<{ count: number }>(
          `SELECT COUNT(*)::integer AS count
             FROM daily007_v2_squad_team_members member
             JOIN daily007_v2_squad_teams team ON team.id = member.team_id
             LEFT JOIN daily007_v2_registrations registration
               ON registration.id = member.registration_id
            WHERE team.match_id = $1 AND member.is_active = true
              AND (member.registration_id IS NULL OR registration.status IN ('approved', 'pending'))`,
          [matchId],
        );
        const existingStartsAt = tournamentInstantFromStored(row.starts_at).getTime();
        if (new Date(settings.startsAt).getTime() !== existingStartsAt &&
            new Date(settings.startsAt).getTime() <= Date.now()) {
          throw Object.assign(new Error("A changed tournament start time must be in the future."), { status: 400 });
        }
        const hasRegistrations = Number(activePlayers.rows[0]?.count ?? 0) > 0;
        const configChanged =
          settings.title !== row.title ||
          settings.squadCount !== Number(row.capacity) ||
          settings.entryCoins !== Number(row.entry_coins) ||
          settings.prizePool !== Number(row.prize_pool) ||
          settings.pointsPerKill !== Number(row.points_per_kill) ||
          settings.round1Eliminated !== Number(row.round1_eliminated) ||
          settings.round2Eliminated !== Number(row.round2_eliminated) ||
          new Date(settings.startsAt).getTime() !== existingStartsAt;
        if (hasRegistrations && configChanged) {
          throw Object.assign(new Error("Tournament settings are locked after players register. Only publishing can be changed."), { status: 409 });
        }

        await client.query(
          `UPDATE daily007_v2_matches
              SET title = $2, capacity = $3, starts_at = $4, entry_coins = $5,
                  prize_pool = $6, enabled = $7,
                  is_full = CASE WHEN $8 THEN is_full ELSE false END,
                  status = CASE WHEN $8 THEN status ELSE 'open' END
            WHERE id = $1`,
          [
            matchId,
            settings.title,
            settings.squadCount,
            storedTournamentTimeFromInstant(new Date(settings.startsAt)),
            settings.entryCoins,
            settings.prizePool,
            settings.published,
            hasRegistrations,
          ],
        );
        await client.query(
          `UPDATE daily007_knockout_events
              SET points_per_kill = $2, round1_eliminated = $3,
                  round2_eliminated = $4, updated_at = clock_timestamp()
            WHERE match_id = $1`,
          [matchId, settings.pointsPerKill, settings.round1Eliminated, settings.round2Eliminated],
        );
      },
    );
    const event = (await listKnockoutEvents(true)).find((item) => item.matchId === matchId);
    res.json({ event });
  } catch (error) {
    const status = (error as { status?: number }).status;
    if (status) return fail(res, status, error instanceof Error ? error.message : "Knockout settings update was rejected.");
    console.error("[daily007] update knockout failed", error);
    fail(res, 500, "Could not update Knockout tournament settings.");
  }
});

export default router;
