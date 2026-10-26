import { Router, type IRouter, type Request, type Response } from "express";
import { pool } from "@workspace/db";
import { isTournamentStartInFuture, storedTournamentTimeFromInstant, tournamentInstantFromStored } from "../lib/daily007-schedule-time";
import { DEFAULT_KNOCKOUT_SETTINGS, knockoutStages, parseKnockoutSettings } from "../lib/daily007-knockout";
import {
  calculateKnockoutRoundPoints,
  isKnockoutSquadConfirmed,
  knockoutPaymentStatus,
  knockoutPlacementPoints,
  knockoutRoundLabel,
  parseKnockoutRound,
  parseKnockoutRoundResult,
  type KnockoutRound,
} from "../lib/daily007-knockout-results";
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
  incompleteSquads: number;
  registeredPlayers: number;
};

type KnockoutQueryClient = {
  query<T = unknown>(text: string, values?: unknown[]): Promise<{ rows: T[] }>;
};

type KnockoutSlotRow = {
  teamNumber: number;
  slotNumber: number;
  memberId: string | null;
  registrationId: string | null;
  registrationStatus: string | null;
  playerName: string | null;
  entryCoinsPaid: number | null;
  addedByCaptain: boolean | null;
};

type KnockoutSquad = {
  teamNumber: number;
  teamName: string;
  registeredPlayers: number;
  confirmed: boolean;
  players: Array<{
    playerName: string;
    slotNumber: number;
    paymentStatus: "paid" | "pending" | "unpaid" | "open";
    paidByCaptain: boolean;
    entryCoinsPaid: number;
  }>;
};

function fail(res: Response, status: number, error: string): void {
  res.status(status).json({ error });
}

async function listKnockoutSquads(
  client: KnockoutQueryClient,
  matchId: string,
  entryCoins: number,
): Promise<KnockoutSquad[]> {
  const result = await client.query<KnockoutSlotRow>(
    `SELECT team.team_number AS "teamNumber", seat.slot_number AS "slotNumber",
            member.id AS "memberId", registration.id AS "registrationId",
            registration.status AS "registrationStatus",
            COALESCE(NULLIF(registration.captain_game_name, ''),
                     NULLIF(member.legacy_game_name, '')) AS "playerName",
            registration.entry_coins_paid AS "entryCoinsPaid",
            registration.added_by_captain AS "addedByCaptain"
       FROM daily007_v2_squad_teams team
       CROSS JOIN generate_series(1, 4) AS seat(slot_number)
       LEFT JOIN daily007_v2_squad_team_members member
         ON member.team_id = team.id AND member.slot_number = seat.slot_number
        AND member.is_active = true
       LEFT JOIN daily007_v2_registrations registration
         ON registration.id = member.registration_id
      WHERE team.match_id = $1
      ORDER BY team.team_number, seat.slot_number`,
    [matchId],
  );
  const grouped = new Map<number, KnockoutSquad>();
  const confirmationSlots = new Map<number, Array<{
    slotNumber: number;
    registrationStatus: string | null;
    entryCoinsPaid: number;
  }>>();
  for (const row of result.rows) {
    const activeMember = Boolean(
      row.memberId &&
      (!row.registrationId || ["approved", "pending"].includes(row.registrationStatus ?? "")),
    );
    let squad = grouped.get(Number(row.teamNumber));
    if (!squad) {
      squad = {
        teamNumber: Number(row.teamNumber),
        teamName: `Team ${String(row.teamNumber).padStart(2, "0")}`,
        registeredPlayers: 0,
        confirmed: false,
        players: [],
      };
      grouped.set(squad.teamNumber, squad);
      confirmationSlots.set(squad.teamNumber, []);
    }
    const entryCoinsPaid = Number(row.entryCoinsPaid ?? 0);
    const registrationStatus = activeMember ? row.registrationStatus : null;
    const hasMember = activeMember;
    const paymentStatus = knockoutPaymentStatus({
      slotNumber: Number(row.slotNumber),
      registrationStatus,
      entryCoinsPaid,
      hasMember,
    }, entryCoins);
    squad.players.push({
      playerName: hasMember ? row.playerName?.trim() || "Player" : "OPEN SLOT",
      slotNumber: Number(row.slotNumber),
      paymentStatus,
      paidByCaptain: hasMember && Boolean(row.addedByCaptain),
      entryCoinsPaid,
    });
    if (paymentStatus !== "open") squad.registeredPlayers++;
    confirmationSlots.get(squad.teamNumber)!.push({
      slotNumber: Number(row.slotNumber),
      registrationStatus,
      entryCoinsPaid,
    });
  }
  return [...grouped.values()]
    .filter((squad) => squad.registeredPlayers > 0)
    .map((squad) => ({
      ...squad,
      confirmed: isKnockoutSquadConfirmed(
        confirmationSlots.get(squad.teamNumber) ?? [],
        entryCoins,
      ),
    }));
}

function serializeRoundResult(row: {
  id: string;
  round_name: KnockoutRound;
  team_number: number;
  placement: number;
  placement_points: number;
  squad_kills: number;
  points_per_kill: number;
  round_points: number;
  status: "draft" | "published";
  created_at: Date | string;
  updated_at: Date | string;
  published_at: Date | string | null;
}) {
  return {
    id: row.id,
    round: row.round_name,
    teamNumber: Number(row.team_number),
    placement: Number(row.placement),
    placementPoints: Number(row.placement_points),
    squadKills: Number(row.squad_kills),
    pointsPerKill: Number(row.points_per_kill),
    roundPoints: Number(row.round_points),
    status: row.status,
    createdAt: new Date(row.created_at).toISOString(),
    updatedAt: new Date(row.updated_at).toISOString(),
    publishedAt: row.published_at ? new Date(row.published_at).toISOString() : null,
  };
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
    incompleteSquads: Number(row.incompleteSquads),
    registeredPlayers: Number(row.registeredPlayers),
    status,
    published: Boolean(row.enabled) || row.status === "completed" || row.status === "cancelled",
    registrationOpen: status === "upcoming",
  };
}

async function listKnockoutEvents(includeDrafts: boolean): Promise<ReturnType<typeof serializeEvent>[]> {
  const result = await pool.query<KnockoutRow>(
    `WITH squad_stats AS (
       SELECT team.match_id, team.id AS team_id,
              COUNT(member.id) FILTER (
                WHERE member.registration_id IS NULL OR registration.status IN ('approved', 'pending')
              )::integer AS player_count,
              COUNT(member.id) FILTER (
                WHERE registration.status = 'approved'
                  AND registration.entry_coins_paid >= m.entry_coins
              )::integer AS paid_player_count
         FROM daily007_v2_squad_teams team
         JOIN daily007_v2_matches m ON m.id = team.match_id
         LEFT JOIN daily007_v2_squad_team_members member
           ON member.team_id = team.id AND member.is_active = true
         LEFT JOIN daily007_v2_registrations registration
           ON registration.id = member.registration_id
        GROUP BY team.match_id, team.id, m.entry_coins
     )
     SELECT m.id AS "matchId", m.title, m.starts_at AS "startsAt", m.status,
            m.enabled, m.is_full AS "isFull", m.capacity AS "squadCount",
            m.entry_coins AS "entryCoins", m.prize_pool AS "prizePool",
            settings.points_per_kill AS "pointsPerKill",
            settings.round1_eliminated AS "round1Eliminated",
            settings.round2_eliminated AS "round2Eliminated",
            COUNT(squad_stats.team_id) FILTER (
              WHERE squad_stats.player_count = 4 AND squad_stats.paid_player_count = 4
            )::integer AS "registeredSquads",
            COUNT(squad_stats.team_id) FILTER (
              WHERE squad_stats.player_count > 0
                AND NOT (squad_stats.player_count = 4 AND squad_stats.paid_player_count = 4)
            )::integer AS "incompleteSquads",
            COALESCE(SUM(squad_stats.player_count), 0)::integer AS "registeredPlayers"
       FROM daily007_knockout_events settings
       JOIN daily007_v2_matches m ON m.id = settings.match_id
       LEFT JOIN squad_stats ON squad_stats.match_id = m.id
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
  const round = parseKnockoutRound(req.query.round ?? "round_1");
  if (!round) return fail(res, 400, "Choose Round 1, Round 2, or Final.");
  try {
    const event = await pool.query<{ entry_coins: number }>(
      `SELECT m.entry_coins
         FROM daily007_knockout_events settings
         JOIN daily007_v2_matches m ON m.id = settings.match_id
        WHERE m.id = $1 AND (m.enabled = true OR m.status IN ('completed', 'cancelled'))`,
      [matchId],
    );
    if (!event.rows[0]) return fail(res, 404, "Knockout tournament not found.");
    const squads = await listKnockoutSquads(pool, matchId, Number(event.rows[0].entry_coins));
    const result = await pool.query<{
      id: string; team_number: number; placement: number; placement_points: number;
      squad_kills: number; points_per_kill: number; round_points: number;
    }>(
      `SELECT id, team_number, placement, placement_points, squad_kills,
              points_per_kill, round_points
         FROM daily007_knockout_round_results
        WHERE match_id = $1 AND round_name = $2 AND status = 'published'
        ORDER BY round_points DESC, placement ASC, team_number ASC`,
      [matchId, round],
    );
    const publishedByTeam = new Map(result.rows.map((row, index) => [
      Number(row.team_number),
      { row, officialRank: index + 1 },
    ]));
    const standings = squads
      .map((squad) => {
        const published = publishedByTeam.get(squad.teamNumber);
        const row = published?.row;
        return {
          teamNumber: squad.teamNumber,
          teamName: squad.teamName,
          registeredPlayers: squad.registeredPlayers,
          confirmed: squad.confirmed,
          players: squad.players.map(({ entryCoinsPaid: _entryCoinsPaid, ...player }) => player),
          officialRank: published?.officialRank ?? null,
          placement: row ? Number(row.placement) : null,
          squadKills: row ? Number(row.squad_kills) : null,
          placementPoints: row ? Number(row.placement_points) : null,
          pointsPerKill: row ? Number(row.points_per_kill) : null,
          roundPoints: row ? Number(row.round_points) : null,
          resultStatus: row ? "PUBLISHED" : "AWAITING RESULTS",
        };
      })
      .sort((left, right) => {
        if (left.officialRank && right.officialRank) return left.officialRank - right.officialRank;
        if (left.officialRank) return -1;
        if (right.officialRank) return 1;
        return left.teamNumber - right.teamNumber;
      });
    res.setHeader("Cache-Control", "no-store");
    res.json({
      matchId,
      round,
      stage: knockoutRoundLabel(round),
      standings,
      message: "Only published results appear in official rankings. Drafts are not included.",
    });
  } catch (error) {
    console.error("[daily007] knockout leaderboard failed", error);
    fail(res, 500, "Could not load the Knockout leaderboard.");
  }
});

router.get(
  "/daily007/v2/admin/knockout/events/:id/results",
  authenticate,
  async (req, res): Promise<void> => {
    if (!requireTournamentAdmin(req, res)) return;
    const matchId = String(req.params.id ?? "");
    const round = parseKnockoutRound(req.query.round);
    if (!UUID_PATTERN.test(matchId)) return fail(res, 400, "Tournament id must be a UUID.");
    if (!round) return fail(res, 400, "Choose Round 1, Round 2, or Final.");
    try {
      const data = await withDaily007RoleTransaction(
        req.daily007Account!.id,
        "tournament_admin",
        async (client) => {
          const eventResult = await client.query<{
            entry_coins: number;
            points_per_kill: number;
          }>(
            `SELECT m.entry_coins, settings.points_per_kill
               FROM daily007_knockout_events settings
               JOIN daily007_v2_matches m ON m.id = settings.match_id
              WHERE m.id = $1`,
            [matchId],
          );
          const event = eventResult.rows[0];
          if (!event) throw Object.assign(new Error("Knockout tournament not found."), { status: 404 });
          const [squads, results] = await Promise.all([
            listKnockoutSquads(client, matchId, Number(event.entry_coins)),
            client.query<{
              id: string;
              round_name: KnockoutRound;
              team_number: number;
              placement: number;
              placement_points: number;
              squad_kills: number;
              points_per_kill: number;
              round_points: number;
              status: "draft" | "published";
              created_at: Date | string;
              updated_at: Date | string;
              published_at: Date | string | null;
            }>(
              `SELECT id, round_name, team_number, placement, placement_points,
                      squad_kills, points_per_kill, round_points, status,
                      created_at, updated_at, published_at
                 FROM daily007_knockout_round_results
                WHERE match_id = $1 AND round_name = $2
                ORDER BY placement, team_number`,
              [matchId, round],
            ),
          ]);
          return {
            matchId,
            round,
            pointsPerKill: Number(event.points_per_kill),
            squads,
            results: results.rows.map(serializeRoundResult),
          };
        },
      );
      res.setHeader("Cache-Control", "no-store");
      res.json(data);
    } catch (error) {
      const status = (error as { status?: number }).status;
      if (status) return fail(res, status, error instanceof Error ? error.message : "Could not load round results.");
      console.error("[daily007] admin knockout round results failed", error);
      fail(res, 500, "Could not load Knockout round results.");
    }
  },
);

router.put(
  "/daily007/v2/admin/knockout/events/:id/results",
  authenticate,
  async (req, res): Promise<void> => {
    if (!requireTournamentAdmin(req, res)) return;
    const matchId = String(req.params.id ?? "");
    if (!UUID_PATTERN.test(matchId)) return fail(res, 400, "Tournament id must be a UUID.");
    const input = parseKnockoutRoundResult(req.body);
    if (!input) {
      return fail(res, 400, "Enter a valid round, squad, integer placement, and nonnegative total squad kills.");
    }
    try {
      const response = await withDaily007RoleTransaction(
        req.daily007Account!.id,
        "tournament_admin",
        async (client) => {
          const eventResult = await client.query<{
            entry_coins: number;
            points_per_kill: number;
            squad_count: number;
            status: string;
          }>(
            `SELECT m.entry_coins, m.capacity AS squad_count,
                    m.status, settings.points_per_kill
               FROM daily007_knockout_events settings
               JOIN daily007_v2_matches m ON m.id = settings.match_id
              WHERE m.id = $1
              FOR UPDATE OF m, settings`,
            [matchId],
          );
          const event = eventResult.rows[0];
          if (!event) throw Object.assign(new Error("Knockout tournament not found."), { status: 404 });
          if (event.status === "cancelled") {
            throw Object.assign(new Error("Cancelled tournaments cannot receive results."), { status: 409 });
          }
          if (input.teamNumber > Number(event.squad_count)) {
            throw Object.assign(new Error("The selected squad number is outside this tournament's capacity."), { status: 400 });
          }
          const squads = await listKnockoutSquads(client, matchId, Number(event.entry_coins));
          const confirmedSquads = squads.filter((squad) => squad.confirmed);
          const squad = confirmedSquads.find((item) => item.teamNumber === input.teamNumber);
          if (!squad) {
            throw Object.assign(new Error("A squad must have four approved, fully paid players before results can be entered."), { status: 409 });
          }
          if (input.placement > confirmedSquads.length) {
            throw Object.assign(new Error(`Placement must be between 1 and ${confirmedSquads.length} for confirmed squads.`), { status: 400 });
          }

          const duplicatePlacement = await client.query<{ id: string }>(
            `SELECT id FROM daily007_knockout_round_results
              WHERE match_id = $1 AND round_name = $2
                AND placement = $3 AND team_number <> $4
              LIMIT 1`,
            [matchId, input.round, input.placement, input.teamNumber],
          );
          if (duplicatePlacement.rows[0]) {
            throw Object.assign(new Error("That placement is already assigned to another squad in this round."), { status: 409 });
          }

          const placementPoints = knockoutPlacementPoints(input.placement);
          const pointsPerKill = Number(event.points_per_kill);
          const roundPoints = calculateKnockoutRoundPoints(
            input.placement,
            input.squadKills,
            pointsPerKill,
          );
          const saved = await client.query<{
            id: string;
            round_name: KnockoutRound;
            team_number: number;
            placement: number;
            placement_points: number;
            squad_kills: number;
            points_per_kill: number;
            round_points: number;
            status: "draft" | "published";
            created_at: Date | string;
            updated_at: Date | string;
            published_at: Date | string | null;
          }>(
            `INSERT INTO daily007_knockout_round_results
               (match_id, round_name, team_number, placement, placement_points,
                squad_kills, points_per_kill, round_points, status,
                created_by_user_id, updated_by_user_id)
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8, 'draft', $9, $9)
             ON CONFLICT (match_id, round_name, team_number)
             DO UPDATE SET placement = EXCLUDED.placement,
                           placement_points = EXCLUDED.placement_points,
                           squad_kills = EXCLUDED.squad_kills,
                           points_per_kill = EXCLUDED.points_per_kill,
                           round_points = EXCLUDED.round_points,
                           status = 'draft',
                           updated_by_user_id = EXCLUDED.updated_by_user_id,
                           published_by_user_id = NULL,
                           published_at = NULL,
                           updated_at = clock_timestamp()
             RETURNING id, round_name, team_number, placement, placement_points,
                       squad_kills, points_per_kill, round_points, status,
                       created_at, updated_at, published_at`,
            [
              matchId,
              input.round,
              input.teamNumber,
              input.placement,
              placementPoints,
              input.squadKills,
              pointsPerKill,
              roundPoints,
              req.daily007Account!.id,
            ],
          );
          const row = saved.rows[0];
          return {
            result: serializeRoundResult(row),
            alreadyPublished: false,
          };
        },
      );
      res.setHeader("Cache-Control", "no-store");
      res.json(response);
    } catch (error) {
      const status = (error as { status?: number }).status;
      if (status) return fail(res, status, error instanceof Error ? error.message : "Could not save the round result.");
      if ((error as { code?: string }).code === "23505") {
        return fail(res, 409, "That placement is already assigned to another squad in this round.");
      }
      console.error("[daily007] save knockout result failed", error);
      fail(res, 500, "Could not save the Knockout round result.");
    }
  },
);

router.post(
  "/daily007/v2/admin/knockout/events/:id/results/:resultId/publish",
  authenticate,
  async (req, res): Promise<void> => {
    if (!requireTournamentAdmin(req, res)) return;
    const matchId = String(req.params.id ?? "");
    const resultId = String(req.params.resultId ?? "");
    if (!UUID_PATTERN.test(matchId) || !UUID_PATTERN.test(resultId)) {
      return fail(res, 400, "Tournament and result ids must be UUIDs.");
    }
    try {
      const response = await withDaily007RoleTransaction(
        req.daily007Account!.id,
        "tournament_admin",
        async (client) => {
          const eventResult = await client.query<{ entry_coins: number; status: string }>(
            `SELECT m.entry_coins, m.status
               FROM daily007_knockout_events settings
               JOIN daily007_v2_matches m ON m.id = settings.match_id
              WHERE m.id = $1
              FOR UPDATE OF m, settings`,
            [matchId],
          );
          const event = eventResult.rows[0];
          if (!event) throw Object.assign(new Error("Knockout tournament not found."), { status: 404 });
          if (event.status === "cancelled") {
            throw Object.assign(new Error("Cancelled tournaments cannot publish results."), { status: 409 });
          }
          const resultQuery = await client.query<{
            id: string;
            round_name: KnockoutRound;
            team_number: number;
            placement: number;
            placement_points: number;
            squad_kills: number;
            points_per_kill: number;
            round_points: number;
            status: "draft" | "published";
            created_at: Date | string;
            updated_at: Date | string;
            published_at: Date | string | null;
          }>(
            `SELECT id, round_name, team_number, placement, placement_points,
                    squad_kills, points_per_kill, round_points, status,
                    created_at, updated_at, published_at
               FROM daily007_knockout_round_results
              WHERE id = $1 AND match_id = $2
              FOR UPDATE`,
            [resultId, matchId],
          );
          const current = resultQuery.rows[0];
          if (!current) throw Object.assign(new Error("Knockout round result not found."), { status: 404 });
          if (current.status === "published") {
            return { result: serializeRoundResult(current), alreadyPublished: true };
          }
          const squads = await listKnockoutSquads(client, matchId, Number(event.entry_coins));
          const confirmedSquads = squads.filter((squad) => squad.confirmed);
          if (!confirmedSquads.some((squad) => squad.teamNumber === Number(current.team_number))) {
            throw Object.assign(new Error("This squad no longer has four approved, fully paid players."), { status: 409 });
          }
          if (Number(current.placement) > confirmedSquads.length) {
            throw Object.assign(new Error("The placement is outside the current confirmed-squad count."), { status: 409 });
          }
          const published = await client.query<typeof current>(
            `UPDATE daily007_knockout_round_results
                SET status = 'published',
                    published_by_user_id = $2,
                    published_at = clock_timestamp(),
                    updated_by_user_id = $2,
                    updated_at = clock_timestamp()
              WHERE id = $1
              RETURNING id, round_name, team_number, placement, placement_points,
                        squad_kills, points_per_kill, round_points, status,
                        created_at, updated_at, published_at`,
            [resultId, req.daily007Account!.id],
          );
          return { result: serializeRoundResult(published.rows[0]), alreadyPublished: false };
        },
      );
      res.setHeader("Cache-Control", "no-store");
      res.json(response);
    } catch (error) {
      const status = (error as { status?: number }).status;
      if (status) return fail(res, status, error instanceof Error ? error.message : "Could not publish the result.");
      console.error("[daily007] publish knockout result failed", error);
      fail(res, 500, "Could not publish the Knockout round result.");
    }
  },
);

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
