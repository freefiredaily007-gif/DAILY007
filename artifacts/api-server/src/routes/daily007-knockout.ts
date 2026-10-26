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
  knockoutStageSpec,
  assessKnockoutProgression,
  parseKnockoutRound,
  parseKnockoutRoundResult,
  type KnockoutStageConfig,
  type KnockoutStageResult,
  type KnockoutTieDecision,
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
  captainName: string | null;
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
  captainName: string;
  registeredPlayers: number;
  confirmed: boolean;
  eligible: boolean;
  stageStatus: string;
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
            COALESCE(NULLIF(captain_registration.captain_game_name, ''),
                     NULLIF(captain_registration.captain_name, '')) AS "captainName",
            member.id AS "memberId", registration.id AS "registrationId",
            registration.status AS "registrationStatus",
            COALESCE(NULLIF(registration.captain_game_name, ''),
                     NULLIF(member.legacy_game_name, '')) AS "playerName",
            registration.entry_coins_paid AS "entryCoinsPaid",
            registration.added_by_captain AS "addedByCaptain"
       FROM daily007_v2_squad_teams team
       CROSS JOIN generate_series(1, 4) AS seat(slot_number)
       LEFT JOIN daily007_v2_registrations captain_registration
         ON captain_registration.id = team.captain_registration_id
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
        captainName: row.captainName?.trim() || "—",
        registeredPlayers: 0,
        confirmed: false,
        eligible: false,
        stageStatus: "AWAITING RESULTS",
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

type KnockoutProgressRow = {
  round_name: KnockoutRound;
  team_number: number;
  status: "qualified" | "eliminated" | "winner" | "finalist";
  stage_rank: number;
  placement: number;
  placement_points: number;
  squad_kills: number;
  round_points: number;
  decision_reason: string | null;
  decided_at: Date | string;
};

type KnockoutStageContext = {
  spec: ReturnType<typeof knockoutStageSpec>;
  eligibleTeamNumbers: number[];
  priorStageConfirmed: boolean;
  previousProgress: Map<number, KnockoutProgressRow>;
  currentProgress: Map<number, KnockoutProgressRow>;
};

async function loadKnockoutProgress(
  client: KnockoutQueryClient,
  matchId: string,
): Promise<KnockoutProgressRow[]> {
  const { rows } = await client.query<KnockoutProgressRow>(
    `SELECT round_name, team_number, status, stage_rank, placement,
            placement_points, squad_kills, round_points, decision_reason, decided_at
       FROM daily007_knockout_stage_progress
      WHERE match_id = $1
      ORDER BY round_name, stage_rank, team_number`,
    [matchId],
  );
  return rows;
}

function stageContext(
  round: KnockoutRound,
  config: KnockoutStageConfig,
  squads: KnockoutSquad[],
  progressRows: KnockoutProgressRow[],
): KnockoutStageContext {
  const spec = knockoutStageSpec(round, config);
  const previousRound: KnockoutRound | null =
    round === "round_1" ? null : round === "round_2" ? "round_1" : "round_2";
  const previousRows = previousRound
    ? progressRows.filter((row) => row.round_name === previousRound)
    : [];
  const previousMap = new Map(previousRows.map((row) => [Number(row.team_number), row]));
  const previousSpec = previousRound
    ? knockoutStageSpec(previousRound, config)
    : null;
  const priorStageConfirmed = previousRound === null ||
    (previousRows.length === previousSpec!.expectedSquads &&
      previousRows.filter((row) => row.status === "qualified").length === spec.expectedSquads);
  const qualifiedNumbers = round === "round_1"
    ? squads.filter((squad) => squad.confirmed).map((squad) => squad.teamNumber)
    : priorStageConfirmed
      ? previousRows.filter((row) => row.status === "qualified").map((row) => Number(row.team_number))
      : [];
  const eligibleTeamNumbers = qualifiedNumbers
    .filter((teamNumber) => squads.some((squad) => squad.teamNumber === teamNumber && squad.confirmed))
    .sort((a, b) => a - b);
  return {
    spec,
    eligibleTeamNumbers,
    priorStageConfirmed,
    previousProgress: previousMap,
    currentProgress: new Map(
      progressRows
        .filter((row) => row.round_name === round)
        .map((row) => [Number(row.team_number), row]),
    ),
  };
}

function stageStatusForSquad(
  round: KnockoutRound,
  squad: KnockoutSquad,
  context: KnockoutStageContext,
): string {
  const current = context.currentProgress.get(squad.teamNumber);
  if (current) return current.status.toUpperCase();
  if (round === "round_1") return squad.confirmed ? "ELIGIBLE" : "INCOMPLETE";
  if (!context.priorStageConfirmed) return "AWAITING PRIOR ROUND";
  const previous = context.previousProgress.get(squad.teamNumber);
  if (previous?.status === "eliminated") return "ELIMINATED";
  if (previous?.status === "qualified") return squad.confirmed ? "ELIGIBLE" : "QUALIFIED · INCOMPLETE";
  return "NOT QUALIFIED";
}

function isTeamEligible(squad: KnockoutSquad, context: KnockoutStageContext): boolean {
  return context.eligibleTeamNumbers.includes(squad.teamNumber) && squad.confirmed;
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
    const event = await pool.query<{
      entry_coins: number;
      capacity: number;
      round1_eliminated: number;
      round2_eliminated: number;
    }>(
      `SELECT m.entry_coins, m.capacity,
              settings.round1_eliminated, settings.round2_eliminated
         FROM daily007_knockout_events settings
         JOIN daily007_v2_matches m ON m.id = settings.match_id
        WHERE m.id = $1 AND (m.enabled = true OR m.status IN ('completed', 'cancelled'))`,
      [matchId],
    );
    if (!event.rows[0]) return fail(res, 404, "Knockout tournament not found.");
    const config: KnockoutStageConfig = {
      squadCount: Number(event.rows[0].capacity),
      round1Eliminated: Number(event.rows[0].round1_eliminated),
      round2Eliminated: Number(event.rows[0].round2_eliminated),
    };
    const [squads, progressRows, result] = await Promise.all([
      listKnockoutSquads(pool, matchId, Number(event.rows[0].entry_coins)),
      loadKnockoutProgress(pool, matchId),
      pool.query<KnockoutStageResult>(
        `SELECT team_number AS "teamNumber", placement,
                placement_points AS "placementPoints", squad_kills AS "squadKills",
                points_per_kill AS "pointsPerKill", round_points AS "roundPoints", status
           FROM daily007_knockout_round_results
          WHERE match_id = $1 AND round_name = $2`,
        [matchId, round],
      ),
    ]);
    const context = stageContext(round, config, squads, progressRows);
    const assessment = assessKnockoutProgression(round, config, context.eligibleTeamNumbers, result.rows);
    const currentProgress = progressRows.filter((row) => row.round_name === round);
    const officialStage = currentProgress.length === assessment.expectedSquads;
    const finalProgress = progressRows.filter((row) => row.round_name === "final");
    const finalConfirmed = finalProgress.length === 8;
    const resultByTeam = new Map(result.rows.map((row) => [row.teamNumber, row]));
    const previewRankByTeam = new Map(assessment.rankedResults.map((row) => [row.teamNumber, row.rank]));
    const currentProgressByTeam = new Map(currentProgress.map((row) => [Number(row.team_number), row]));
    const finalRankByTeam = new Map(finalProgress.map((row) => [Number(row.team_number), Number(row.stage_rank)]));
    const standings = squads
      .map((squad) => {
        const row = resultByTeam.get(squad.teamNumber);
        const current = currentProgressByTeam.get(squad.teamNumber);
        const previous = context.previousProgress.get(squad.teamNumber);
        const resultStatus = !row
          ? "AWAITING RESULTS"
          : officialStage
            ? "OFFICIAL"
            : row.status === "draft"
              ? "PROVISIONAL"
              : "PUBLISHED · AWAITING CONFIRMATION";
        const qualificationStatus = current?.status.toUpperCase() ??
          (round === "round_1"
            ? squad.confirmed ? "AWAITING ROUND CONFIRMATION" : "INCOMPLETE"
            : previous?.status.toUpperCase() ?? "AWAITING PRIOR ROUND");
        return {
          teamNumber: squad.teamNumber,
          teamName: squad.teamName,
          captainName: squad.captainName,
          registeredPlayers: squad.registeredPlayers,
          confirmed: squad.confirmed,
          players: squad.players.map(({ entryCoinsPaid: _entryCoinsPaid, ...player }) => player),
          provisionalRank: officialStage ? null : previewRankByTeam.get(squad.teamNumber) ?? null,
          officialRank: officialStage ? current?.stage_rank ?? null : null,
          finalRank: finalConfirmed ? finalRankByTeam.get(squad.teamNumber) ?? null : null,
          placement: row ? Number(row.placement) : null,
          squadKills: row?.squadKills ?? null,
          placementPoints: row?.placementPoints ?? null,
          pointsPerKill: row?.pointsPerKill ?? null,
          roundPoints: row?.roundPoints ?? null,
          resultStatus,
          roundStatus: current?.status.toUpperCase() ?? resultStatus,
          qualificationStatus,
        };
      })
      .sort((left, right) => {
        const leftRank = left.officialRank ?? left.provisionalRank;
        const rightRank = right.officialRank ?? right.provisionalRank;
        if (leftRank !== null && rightRank !== null && leftRank !== rightRank) return leftRank - rightRank;
        if (leftRank !== null && rightRank === null) return -1;
        if (rightRank !== null && leftRank === null) return 1;
        return left.teamNumber - right.teamNumber;
      });
    const progressionStatus = officialStage
      ? "OFFICIAL"
      : assessment.boundaryTieTeamNumbers.length
        ? "ADMIN TIE DECISION REQUIRED"
        : assessment.allResultsPublished
          ? "AWAITING ADMIN CONFIRMATION"
          : "PROVISIONAL RESULTS";
    res.setHeader("Cache-Control", "no-store");
    res.json({
      matchId,
      round,
      stage: knockoutRoundLabel(round),
      standings,
      progressionStatus,
      message: officialStage
        ? "Official round rankings have been confirmed."
        : "Scores remain provisional until every result is published and an admin confirms the round.",
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
            capacity: number;
            round1_eliminated: number;
            round2_eliminated: number;
          }>(
            `SELECT m.entry_coins, m.capacity, settings.points_per_kill,
                    settings.round1_eliminated, settings.round2_eliminated
               FROM daily007_knockout_events settings
               JOIN daily007_v2_matches m ON m.id = settings.match_id
              WHERE m.id = $1`,
            [matchId],
          );
          const event = eventResult.rows[0];
          if (!event) throw Object.assign(new Error("Knockout tournament not found."), { status: 404 });
          const config: KnockoutStageConfig = {
            squadCount: Number(event.capacity),
            round1Eliminated: Number(event.round1_eliminated),
            round2Eliminated: Number(event.round2_eliminated),
          };
          const [squads, progressRows, results] = await Promise.all([
            listKnockoutSquads(client, matchId, Number(event.entry_coins)),
            loadKnockoutProgress(client, matchId),
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
          const context = stageContext(round, config, squads, progressRows);
          const assessment = assessKnockoutProgression(
            round,
            config,
            context.eligibleTeamNumbers,
            results.rows.map((row) => ({
              teamNumber: Number(row.team_number),
              placement: Number(row.placement),
              placementPoints: Number(row.placement_points),
              squadKills: Number(row.squad_kills),
              pointsPerKill: Number(row.points_per_kill),
              roundPoints: Number(row.round_points),
              status: row.status,
            })),
          );
          const transitionConfirmed = context.currentProgress.size === context.spec.expectedSquads;
          const progression = {
            round,
            expectedSquads: context.spec.expectedSquads,
            eligibleSquadCount: context.eligibleTeamNumbers.length,
            publishedResultCount: assessment.publishedResultCount,
            advanceCount: context.spec.advanceCount,
            eliminatedCount: context.spec.eliminatedCount,
            finalistCount: context.spec.finalistCount,
            transitionConfirmed,
            priorStageConfirmed: context.priorStageConfirmed,
            canConfirm: assessment.canConfirm && context.currentProgress.size === 0 && context.priorStageConfirmed,
            boundaryTieTeamNumbers: assessment.boundaryTieTeamNumbers,
            rankedResults: assessment.rankedResults,
          };
          return {
            matchId,
            round,
            pointsPerKill: Number(event.points_per_kill),
            squads: squads.map((squad) => ({
              ...squad,
              eligible: isTeamEligible(squad, context),
              stageStatus: stageStatusForSquad(round, squad, context),
            })),
            progression,
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
            round1_eliminated: number;
            round2_eliminated: number;
            status: string;
          }>(
            `SELECT m.entry_coins, m.capacity AS squad_count, m.status,
                    settings.points_per_kill, settings.round1_eliminated,
                    settings.round2_eliminated
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
          const config: KnockoutStageConfig = {
            squadCount: Number(event.squad_count),
            round1Eliminated: Number(event.round1_eliminated),
            round2Eliminated: Number(event.round2_eliminated),
          };
          const [squads, progressRows] = await Promise.all([
            listKnockoutSquads(client, matchId, Number(event.entry_coins)),
            loadKnockoutProgress(client, matchId),
          ]);
          const context = stageContext(input.round, config, squads, progressRows);
          if (context.currentProgress.size > 0) {
            throw Object.assign(new Error("This round has already been confirmed and cannot be edited."), { status: 409 });
          }
          if (!context.priorStageConfirmed || context.eligibleTeamNumbers.length !== context.spec.expectedSquads) {
            throw Object.assign(new Error(`This round is locked until exactly ${context.spec.expectedSquads} squads qualify.`), { status: 409 });
          }
          const eligibleSquads = squads.filter((item) => isTeamEligible(item, context));
          const squad = eligibleSquads.find((item) => item.teamNumber === input.teamNumber);
          if (!squad) {
            throw Object.assign(new Error("Only four-player, fully paid squads qualified for this round can receive results."), { status: 409 });
          }
          if (input.placement > eligibleSquads.length) {
            throw Object.assign(new Error(`Placement must be between 1 and ${eligibleSquads.length} for this round.`), { status: 400 });
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
          const eventResult = await client.query<{
            entry_coins: number;
            status: string;
            capacity: number;
            round1_eliminated: number;
            round2_eliminated: number;
          }>(
            `SELECT m.entry_coins, m.status, m.capacity,
                    settings.round1_eliminated, settings.round2_eliminated
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
          const config: KnockoutStageConfig = {
            squadCount: Number(event.capacity),
            round1Eliminated: Number(event.round1_eliminated),
            round2Eliminated: Number(event.round2_eliminated),
          };
          const [squads, progressRows] = await Promise.all([
            listKnockoutSquads(client, matchId, Number(event.entry_coins)),
            loadKnockoutProgress(client, matchId),
          ]);
          const context = stageContext(current.round_name, config, squads, progressRows);
          if (context.currentProgress.size > 0) {
            throw Object.assign(new Error("This round has already been confirmed and cannot be changed."), { status: 409 });
          }
          if (!context.priorStageConfirmed || context.eligibleTeamNumbers.length !== context.spec.expectedSquads) {
            throw Object.assign(new Error(`This round is locked until exactly ${context.spec.expectedSquads} squads qualify.`), { status: 409 });
          }
          const eligibleSquads = squads.filter((squad) => isTeamEligible(squad, context));
          if (!eligibleSquads.some((squad) => squad.teamNumber === Number(current.team_number))) {
            throw Object.assign(new Error("This squad has not qualified for this round."), { status: 409 });
          }
          if (Number(current.placement) > eligibleSquads.length) {
            throw Object.assign(new Error("The placement is outside the current round's qualified squad count."), { status: 409 });
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

router.post(
  "/daily007/v2/admin/knockout/events/:id/progression",
  authenticate,
  async (req, res): Promise<void> => {
    if (!requireTournamentAdmin(req, res)) return;
    const matchId = String(req.params.id ?? "");
    const body = req.body && typeof req.body === "object" && !Array.isArray(req.body)
      ? req.body as Record<string, unknown>
      : {};
    const round = parseKnockoutRound(body.round);
    if (!UUID_PATTERN.test(matchId)) return fail(res, 400, "Tournament id must be a UUID.");
    if (!round || body.confirmed !== true) {
      return fail(res, 400, "Select a round and explicitly confirm its progression.");
    }
    const hasTieDecision = body.tieBreakOrder !== undefined || body.decisionReason !== undefined;
    const tieBreakOrder = body.tieBreakOrder;
    const decisionReason = body.decisionReason;
    if (
      hasTieDecision &&
      (!Array.isArray(tieBreakOrder) ||
        tieBreakOrder.length < 2 ||
        tieBreakOrder.length > 12 ||
        tieBreakOrder.some((teamNumber) => typeof teamNumber !== "number" || !Number.isSafeInteger(teamNumber) || teamNumber < 1 || teamNumber > 12) ||
        new Set(tieBreakOrder).size !== tieBreakOrder.length ||
        typeof decisionReason !== "string" ||
        decisionReason.trim().length < 5 ||
        decisionReason.trim().length > 500)
    ) {
      return fail(res, 400, "Provide the complete tied-team order and a reason for the admin decision.");
    }
    const tieDecision: KnockoutTieDecision | undefined = hasTieDecision
      ? { order: tieBreakOrder as number[], reason: decisionReason as string }
      : undefined;
    try {
      const response = await withDaily007RoleTransaction(
        req.daily007Account!.id,
        "tournament_admin",
        async (client) => {
          const eventResult = await client.query<{
            entry_coins: number;
            capacity: number;
            round1_eliminated: number;
            round2_eliminated: number;
            status: string;
          }>(
            `SELECT m.entry_coins, m.capacity, m.status,
                    settings.round1_eliminated, settings.round2_eliminated
               FROM daily007_knockout_events settings
               JOIN daily007_v2_matches m ON m.id = settings.match_id
              WHERE m.id = $1
              FOR UPDATE OF m, settings`,
            [matchId],
          );
          const event = eventResult.rows[0];
          if (!event) throw Object.assign(new Error("Knockout tournament not found."), { status: 404 });
          if (event.status === "cancelled") {
            throw Object.assign(new Error("Cancelled tournaments cannot advance."), { status: 409 });
          }
          const config: KnockoutStageConfig = {
            squadCount: Number(event.capacity),
            round1Eliminated: Number(event.round1_eliminated),
            round2Eliminated: Number(event.round2_eliminated),
          };
          const [squads, progressRows, results] = await Promise.all([
            listKnockoutSquads(client, matchId, Number(event.entry_coins)),
            loadKnockoutProgress(client, matchId),
            client.query<KnockoutStageResult>(
              `SELECT team_number AS "teamNumber", placement,
                      placement_points AS "placementPoints", squad_kills AS "squadKills",
                      points_per_kill AS "pointsPerKill", round_points AS "roundPoints", status
                 FROM daily007_knockout_round_results
                WHERE match_id = $1 AND round_name = $2
                ORDER BY team_number`,
              [matchId, round],
            ),
          ]);
          const context = stageContext(round, config, squads, progressRows);
          const existingProgress = [...context.currentProgress.values()];
          if (existingProgress.length === context.spec.expectedSquads) {
            const already = existingProgress.slice().sort((left, right) => left.stage_rank - right.stage_rank);
            return {
              matchId,
              round,
              alreadyConfirmed: true,
              advancedTeamNumbers: already.filter((row) => row.status === "qualified").map((row) => Number(row.team_number)),
              eliminatedTeamNumbers: already.filter((row) => row.status === "eliminated").map((row) => Number(row.team_number)),
              winnerTeamNumbers: already.filter((row) => row.status === "winner").map((row) => Number(row.team_number)),
              finalistTeamNumbers: already.filter((row) => row.status === "finalist").map((row) => Number(row.team_number)),
            };
          }
          if (existingProgress.length) {
            throw Object.assign(new Error("Stage progression records are incomplete; no new progression was applied."), { status: 409 });
          }
          if (!context.priorStageConfirmed || context.eligibleTeamNumbers.length !== context.spec.expectedSquads) {
            throw Object.assign(new Error(`This stage requires exactly ${context.spec.expectedSquads} qualified squads.`), { status: 409 });
          }
          const preview = assessKnockoutProgression(
            round,
            config,
            context.eligibleTeamNumbers,
            results.rows,
          );
          if (!preview.allResultsPublished) {
            throw Object.assign(new Error("Publish results for every qualified squad before confirming this stage."), { status: 409 });
          }
          if (preview.boundaryTieTeamNumbers.length && !tieDecision) {
            throw Object.assign(new Error("A tied elimination boundary must be ordered by an admin with a recorded reason before continuing."), { status: 409 });
          }
          if (!preview.boundaryTieTeamNumbers.length && tieDecision) {
            throw Object.assign(new Error("A tie-break decision was supplied, but no elimination boundary is tied."), { status: 400 });
          }
          let assessment = preview;
          if (tieDecision) {
            try {
              assessment = assessKnockoutProgression(
                round,
                config,
                context.eligibleTeamNumbers,
                results.rows,
                tieDecision,
              );
            } catch (cause) {
              throw Object.assign(
                new Error(cause instanceof Error ? cause.message : "Invalid tie-break decision."),
                { status: 400 },
              );
            }
          }
          if (!assessment.canConfirm) {
            throw Object.assign(new Error("A tied elimination boundary must be ordered by an admin with a recorded reason before continuing."), { status: 409 });
          }
          for (const ranked of assessment.rankedResults) {
            await client.query(
              `INSERT INTO daily007_knockout_stage_progress
                 (match_id, round_name, team_number, status, stage_rank, placement,
                  placement_points, squad_kills, round_points, decision_reason, decided_by_user_id)
               VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)`,
              [
                matchId,
                round,
                ranked.teamNumber,
                ranked.status,
                ranked.rank,
                ranked.placement,
                ranked.placementPoints,
                ranked.squadKills,
                ranked.roundPoints,
                ranked.decisionReason,
                req.daily007Account!.id,
              ],
            );
          }
          if (round === "final") {
            await client.query(
              `UPDATE daily007_v2_matches
                  SET status = 'completed', enabled = false
                WHERE id = $1`,
              [matchId],
            );
          }
          return {
            matchId,
            round,
            alreadyConfirmed: false,
            advancedTeamNumbers: assessment.rankedResults.filter((row) => row.status === "qualified").map((row) => row.teamNumber),
            eliminatedTeamNumbers: assessment.rankedResults.filter((row) => row.status === "eliminated").map((row) => row.teamNumber),
            winnerTeamNumbers: assessment.rankedResults.filter((row) => row.status === "winner").map((row) => row.teamNumber),
            finalistTeamNumbers: assessment.rankedResults.filter((row) => row.status === "finalist").map((row) => row.teamNumber),
          };
        },
      );
      res.setHeader("Cache-Control", "no-store");
      res.json(response);
    } catch (error) {
      const status = (error as { status?: number }).status;
      if (status) return fail(res, status, error instanceof Error ? error.message : "Could not confirm Knockout progression.");
      if ((error as { code?: string }).code === "23505") {
        return fail(res, 409, "This stage has already been advanced.");
      }
      console.error("[daily007] confirm knockout progression failed", error);
      fail(res, 500, "Could not confirm Knockout progression.");
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
