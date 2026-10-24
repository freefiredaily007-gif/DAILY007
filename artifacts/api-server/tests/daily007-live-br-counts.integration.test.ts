import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import type { Server } from "node:http";
import express from "express";
import test, { after } from "node:test";
import { pool } from "@workspace/db";
import {
  countOpenHomeTournamentsByFormat,
  type HomeRegistrationTournament,
} from "../../daily007/src/lib/tournamentFilters";
import { makeToken } from "../src/lib/daily007-session-token";
import { storedTournamentTimeFromInstant } from "../src/lib/daily007-schedule-time";
import daily007CompatCoreRouter from "../src/routes/daily007-compat-core";

const TEST_AUTH_SECRET = "daily007-live-br-counts-integration-test-secret";
const previousAuthSecret = process.env.DAILY007_AUTH_SECRET;
process.env.DAILY007_AUTH_SECRET = TEST_AUTH_SECRET;
const testDatabaseUrl = process.env.DATABASE_URL ? new URL(process.env.DATABASE_URL) : null;
const testDatabasePort = process.env.DAILY007_TEST_POSTGRES_PORT;

if (
  process.env.DAILY007_ISOLATED_POSTGRES_TEST !== "1" ||
  !testDatabaseUrl ||
  testDatabaseUrl.hostname !== "127.0.0.1" ||
  testDatabaseUrl.pathname !== "/postgres" ||
  testDatabaseUrl.port !== testDatabasePort
) {
  throw new Error("This integration test must run through the isolated PostgreSQL test runner.");
}

type GameMode = "battle_royale" | "battle_royale_kill_earn" | "clash_squad" | "lone_wolf";
type TournamentFormat = "solo" | "duo" | "trio" | "squad";
type LiveCountsByMode = Record<GameMode, Record<TournamentFormat, number>>;
type ListedTournament = HomeRegistrationTournament & {
  id: string;
  title: string;
  gameMode: string;
  teamType: string;
  killRewardCoins?: number;
  filledPlayerSlots: number;
  totalPlayerSlots: number;
};

const createdMatchIds: string[] = [];
const createdUserIds: string[] = [];

after(async () => {
  await pool.end();
  if (previousAuthSecret === undefined) delete process.env.DAILY007_AUTH_SECRET;
  else process.env.DAILY007_AUTH_SECRET = previousAuthSecret;
});

async function withServer(run: (origin: string) => Promise<void>): Promise<void> {
  const app = express();
  app.use(express.json());
  app.use(daily007CompatCoreRouter);
  app.use((
    error: unknown,
    _request: express.Request,
    response: express.Response,
    _next: express.NextFunction,
  ) => {
    response.status(500).json({
      error: "Test server encountered an unexpected error.",
      detail: error instanceof Error ? error.message : String(error),
    });
  });
  const server = await new Promise<Server>((resolve, reject) => {
    const listeningServer = app.listen(0, "127.0.0.1", () => resolve(listeningServer));
    listeningServer.once("error", reject);
  });
  const address = server.address();
  assert.ok(address && typeof address !== "string");
  try {
    await run(`http://127.0.0.1:${address.port}`);
  } finally {
    await new Promise<void>((resolve, reject) => {
      server.close((error) => error ? reject(error) : resolve());
    });
  }
}

function authHeaders(token: string): Record<string, string> {
  return { authorization: `Bearer ${token}`, "content-type": "application/json" };
}

async function createUser(role = "user"): Promise<{ id: string; token: string }> {
  const id = randomUUID();
  createdUserIds.push(id);
  await pool.query(
    `INSERT INTO daily007_v2_users
       (id, name, email, password_salt, password_hash, role, wallet_coins)
     VALUES ($1, $2, $3, 'salt', 'hash', $4, 0)`,
    [id, `Live Count ${id.slice(0, 8)}`, `live-count-${id}@example.test`, role],
  );
  const token = makeToken(id, 0);
  assert.ok(token);
  return { id, token };
}

function futureSchedule(hours = 48): { date: string; time: string } {
  const startsAt = new Date(Date.now() + hours * 60 * 60 * 1000);
  return {
    date: startsAt.toISOString().slice(0, 10),
    time: startsAt.toISOString().slice(11, 16),
  };
}

async function createTournament(
  origin: string,
  token: string,
  gameMode: GameMode,
  teamType: TournamentFormat,
  enabled = true,
): Promise<ListedTournament> {
  const schedule = futureSchedule();
  const response = await fetch(`${origin}/tournaments`, {
    method: "POST",
    headers: authHeaders(token),
    body: JSON.stringify({
      name: `Synthetic ${gameMode} ${teamType} ${randomUUID().slice(0, 8)}`,
      mode: gameMode,
      teamType,
      entryCoins: 0,
      prizePool: 100,
      killRewardCoins: gameMode === "battle_royale_kill_earn" ? 7 : 0,
      date: schedule.date,
      time: schedule.time,
      rules: "Isolated live-count fixture",
      banner: "test-banner",
      prizeDist: "",
      enabled,
    }),
  });
  const body = await response.json() as ListedTournament & { error?: string };
  assert.equal(response.status, 201, JSON.stringify(body));
  assert.ok(body.id);
  createdMatchIds.push(body.id);
  return body;
}

async function setPublished(
  origin: string,
  token: string,
  matchId: string,
  enabled: boolean,
): Promise<void> {
  const response = await fetch(`${origin}/tournaments/${matchId}`, {
    method: "PATCH",
    headers: authHeaders(token),
    body: JSON.stringify({ enabled }),
  });
  const body = await response.json() as { enabled?: boolean; error?: string };
  assert.equal(response.status, 200, JSON.stringify(body));
  assert.equal(body.enabled, enabled);
}

async function liveCountSnapshot(origin: string, now = Date.now()): Promise<{
  rows: ListedTournament[];
  counts: ReturnType<typeof countOpenHomeTournamentsByFormat>;
  aggregateCounts: LiveCountsByMode;
}> {
  const [tournamentResponse, countsResponse] = await Promise.all([
    fetch(`${origin}/tournaments?enabled=true`),
    fetch(`${origin}/tournaments/live-counts`),
  ]);
  assert.equal(tournamentResponse.status, 200);
  assert.equal(countsResponse.status, 200);
  const rows = await tournamentResponse.json() as ListedTournament[];
  const aggregateCounts = await countsResponse.json() as LiveCountsByMode;
  const uiCounts = {
    battle_royale: countOpenHomeTournamentsByFormat(rows, "battle_royale", now),
    battle_royale_kill_earn: countOpenHomeTournamentsByFormat(rows, "battle_royale_kill_earn", now),
    clash_squad: countOpenHomeTournamentsByFormat(rows, "clash_squad", now),
    lone_wolf: countOpenHomeTournamentsByFormat(rows, "lone_wolf", now),
  };
  assert.deepEqual(
    aggregateCounts,
    uiCounts,
    "The compact API counts must match the existing UI registration eligibility rules for every mode and format.",
  );
  return {
    rows,
    counts: countOpenHomeTournamentsByFormat(rows, "battle_royale", now),
    aggregateCounts,
  };
}

async function databaseNow(): Promise<Date> {
  const result = await pool.query<{ now: Date }>("SELECT clock_timestamp() AS now");
  assert.ok(result.rows[0]?.now);
  return new Date(result.rows[0].now);
}

async function withDatabaseClock<T>(now: Date, run: () => Promise<T>): Promise<T> {
  type MutableQuery = (queryText: string, values?: unknown[]) => Promise<unknown>;
  const mutablePool = pool as unknown as { query: MutableQuery };
  const originalQuery = pool.query.bind(pool) as MutableQuery;
  mutablePool.query = (queryText, values) => {
    if (!queryText.includes("clock_timestamp()")) return originalQuery(queryText, values);
    const clockParameter = (values?.length ?? 0) + 1;
    const fixedClockQuery = queryText.replaceAll(
      "clock_timestamp()",
      `$${clockParameter}::timestamptz`,
    );
    return originalQuery(fixedClockQuery, [...(values ?? []), now]);
  };
  try {
    return await run();
  } finally {
    mutablePool.query = originalQuery;
  }
}

async function setFixtureStart(matchId: string, startsAt: Date): Promise<void> {
  await pool.query(
    "UPDATE daily007_v2_matches SET starts_at = $2 WHERE id = $1",
    [matchId, storedTournamentTimeFromInstant(startsAt)],
  );
}

async function insertStateFixture(
  title: string,
  status: string,
  startsAt: Date,
  enabled = true,
): Promise<string> {
  const id = randomUUID();
  await pool.query(
    `INSERT INTO daily007_v2_matches
       (id, title, mode, game_mode, team_type, capacity, starts_at, status, enabled)
     VALUES ($1, $2, 'solo', 'battle_royale', 'solo', 48, $3, $4, $5)`,
    [id, title, startsAt, status, enabled],
  );
  createdMatchIds.push(id);
  return id;
}

async function seed48SoloSeats(matchId: string): Promise<void> {
  const userIds = Array.from({ length: 48 }, () => randomUUID());
  createdUserIds.push(...userIds);
  await pool.query(
    `INSERT INTO daily007_v2_users (id, name, email, password_salt, password_hash)
     SELECT seed.id, 'Synthetic Full Seat ' || seed.seat,
            'synthetic-full-seat-' || seed.id || '@example.test', 'salt', 'hash'
       FROM unnest($1::uuid[]) WITH ORDINALITY AS seed(id, seat)`,
    [userIds],
  );
  await pool.query(
    `INSERT INTO daily007_v2_registrations
       (match_id, captain_user_id, captain_name, captain_game_name, captain_game_uid,
        team_name, assigned_group_number, entry_coins_paid, status)
     SELECT $1, seed.id, 'Synthetic Full Seat ' || seed.seat,
            'Synthetic Full Seat ' || seed.seat,
            'synthetic-full-uid-' || seed.seat, '',
            seed.seat::integer, 0, 'approved'
       FROM unnest($2::uuid[]) WITH ORDINALITY AS seed(id, seat)`,
    [matchId, userIds],
  );
  await pool.query(
    "UPDATE daily007_v2_matches SET status = 'full', is_full = true WHERE id = $1",
    [matchId],
  );
}

test("live format counts stay aligned with the isolated PostgreSQL tournament-list API", async () => {
  const admin = await createUser("admin");
  try {
    await withServer(async (origin) => {
      const baseMatches = new Map<string, ListedTournament>();
      for (const gameMode of ["battle_royale", "battle_royale_kill_earn", "clash_squad", "lone_wolf"] as const) {
        const formats = gameMode === "battle_royale" || gameMode === "battle_royale_kill_earn"
          ? ["solo", "duo", "squad"] as const
          : ["solo", "duo", "trio", "squad"] as const;
        for (const format of formats) {
          baseMatches.set(
            `${gameMode}:${format}`,
            await createTournament(origin, admin.token, gameMode, format),
          );
        }
      }

      const initial = await liveCountSnapshot(origin);
      assert.deepEqual(initial.counts, { solo: 1, duo: 1, trio: 0, squad: 1 });
      assert.deepEqual(initial.aggregateCounts, {
        battle_royale: { solo: 1, duo: 1, trio: 0, squad: 1 },
        battle_royale_kill_earn: { solo: 1, duo: 1, trio: 0, squad: 1 },
        clash_squad: { solo: 1, duo: 1, trio: 1, squad: 1 },
        lone_wolf: { solo: 1, duo: 1, trio: 1, squad: 1 },
      });
      for (const [key, tournament] of baseMatches) {
        const [gameMode, format] = key.split(":") as [GameMode, TournamentFormat];
        const apiRow = initial.rows.find((row) => row.id === tournament.id);
        assert.ok(apiRow, `${format} should be returned by the enabled tournament-list API.`);
        assert.equal(apiRow.gameMode, gameMode);
        assert.equal(apiRow.teamType.toLowerCase(), format);
        assert.equal(apiRow.enabled, true);
        assert.equal(apiRow.registrationOpen, true);
        assert.equal(apiRow.killRewardCoins, gameMode === "battle_royale_kill_earn" ? 7 : 0);
      }

      const killEarnDuo = baseMatches.get("battle_royale_kill_earn:duo");
      assert.ok(killEarnDuo);
      const rewardUpdateResponse = await fetch(`${origin}/tournaments/${killEarnDuo.id}`, {
        method: "PATCH",
        headers: authHeaders(admin.token),
        body: JSON.stringify({ killRewardCoins: 9 }),
      });
      const rewardUpdate = await rewardUpdateResponse.json() as ListedTournament & { error?: string };
      assert.equal(rewardUpdateResponse.status, 200, JSON.stringify(rewardUpdate));
      assert.equal(rewardUpdate.killRewardCoins, 9);

      const unpublishedDuo = await createTournament(origin, admin.token, "battle_royale", "duo", false);
      let snapshot = await liveCountSnapshot(origin);
      assert.equal(snapshot.rows.some((row) => row.id === unpublishedDuo.id), false);
      assert.equal(snapshot.counts.duo, 1, "an unpublished Duo must not increase the live count.");

      await setPublished(origin, admin.token, unpublishedDuo.id, true);
      snapshot = await liveCountSnapshot(origin);
      assert.equal(snapshot.rows.some((row) => row.id === unpublishedDuo.id), true);
      assert.equal(snapshot.counts.duo, 2, "publishing a Duo must add it to the next live-count read.");

      await setPublished(origin, admin.token, unpublishedDuo.id, false);
      snapshot = await liveCountSnapshot(origin);
      assert.equal(snapshot.rows.some((row) => row.id === unpublishedDuo.id), false);
      assert.equal(snapshot.counts.duo, 1, "closing a Duo must remove it from the next live-count read.");

      const fullSolo = await createTournament(origin, admin.token, "battle_royale", "solo");
      await seed48SoloSeats(fullSolo.id);

      const fullSnapshot = await liveCountSnapshot(origin);
      const fullRow = fullSnapshot.rows.find((row) => row.id === fullSolo.id);
      assert.ok(fullRow, "The full match remains in the enabled API response for list rendering.");
      assert.equal(fullRow.filledPlayerSlots, 48);
      assert.equal(fullRow.totalPlayerSlots, 48);
      assert.deepEqual(fullSnapshot.counts, { solo: 1, duo: 1, trio: 0, squad: 1 });

      const future = new Date(Date.now() + 48 * 60 * 60 * 1000);
      const exclusions = {
        completed: await insertStateFixture("Synthetic Completed BR", "completed", future),
        closed: await insertStateFixture("Synthetic Closed BR", "closed", future),
        registrationClosed: await insertStateFixture("Synthetic Registration-Closed BR", "registration_closed", future),
        expiredStatus: await insertStateFixture("Synthetic Expired Status BR", "expired", future),
        expiredTime: await insertStateFixture(
          "Synthetic Started BR",
          "open",
          new Date(Date.now() - 60 * 60 * 1000),
        ),
        registrationWindowEnded: await insertStateFixture(
          "Synthetic Registration Window Ended BR",
          "open",
          new Date(Date.now() + 4 * 60 * 60 * 1000),
        ),
        cancelled: await insertStateFixture("Synthetic Cancelled BR", "cancelled", future),
      };

      const finalSnapshot = await liveCountSnapshot(origin);
      const rowById = new Map(finalSnapshot.rows.map((row) => [row.id, row]));
      for (const id of [
        exclusions.completed,
        exclusions.closed,
        exclusions.registrationClosed,
        exclusions.expiredStatus,
      ]) {
        assert.ok(rowById.has(id), `The API should expose enabled state rows for client-side eligibility filtering: ${id}.`);
      }
      assert.equal(rowById.has(exclusions.cancelled), false, "Cancelled matches must be absent from the public list.");
      assert.equal(rowById.has(unpublishedDuo.id), false, "Unpublished matches must be absent from the enabled list.");
      const expiredRow = rowById.get(exclusions.expiredTime);
      assert.ok(expiredRow, "The enabled list returns past matches so the client can exclude them by start time.");
      assert.ok(Date.parse(String(expiredRow.startsAt)) <= Date.now());
      assert.equal(expiredRow.registrationOpen, false);
      assert.equal(rowById.get(exclusions.expiredTime)?.registrationOpen, false);
      assert.equal(rowById.get(exclusions.registrationWindowEnded)?.registrationOpen, false);
      assert.equal(rowById.get(exclusions.completed)?.registrationOpen, true);
      assert.equal(rowById.get(exclusions.closed)?.registrationOpen, true);
      assert.equal(rowById.get(exclusions.registrationClosed)?.registrationOpen, true);
      assert.deepEqual(finalSnapshot.counts, { solo: 1, duo: 1, trio: 0, squad: 1 });

      const cutoffMatchId = await insertStateFixture(
        "Synthetic BR IST Registration Cutoff",
        "open",
        storedTournamentTimeFromInstant(new Date(Date.now() + 60_000)),
      );

      const beforeNow = await databaseNow();
      const beforeCutoffStart = new Date(beforeNow.getTime() + 1);
      await setFixtureStart(cutoffMatchId, beforeCutoffStart);
      const beforeCutoff = await withDatabaseClock(
        beforeNow,
        () => liveCountSnapshot(origin, beforeNow.getTime()),
      );
      const beforeRow = beforeCutoff.rows.find((row) => row.id === cutoffMatchId);
      assert.ok(beforeRow, "The enabled match remains listed just before the cutoff.");
      assert.equal(Date.parse(beforeRow.startsAt), beforeCutoffStart.getTime());
      assert.equal(beforeRow.registrationOpen, true);
      assert.equal(beforeCutoff.counts.solo, finalSnapshot.counts.solo + 1);

      const exactCutoffStart = await databaseNow();
      await setFixtureStart(cutoffMatchId, exactCutoffStart);
      const atCutoff = await withDatabaseClock(
        exactCutoffStart,
        () => liveCountSnapshot(origin, exactCutoffStart.getTime()),
      );
      const atRow = atCutoff.rows.find((row) => row.id === cutoffMatchId);
      assert.ok(atRow, "The match remains listed at the registration cutoff.");
      assert.equal(Date.parse(atRow.startsAt), exactCutoffStart.getTime());
      assert.equal(atRow.registrationOpen, false, "Registration closes at the exact IST cutoff.");
      assert.equal(atCutoff.counts.solo, finalSnapshot.counts.solo);

      const afterNow = await databaseNow();
      const afterCutoffStart = new Date(afterNow.getTime() - 1);
      await setFixtureStart(cutoffMatchId, afterCutoffStart);
      const afterCutoff = await withDatabaseClock(
        afterNow,
        () => liveCountSnapshot(origin, afterNow.getTime()),
      );
      const afterRow = afterCutoff.rows.find((row) => row.id === cutoffMatchId);
      assert.ok(afterRow, "The match remains listed after registration closes.");
      assert.equal(Date.parse(afterRow.startsAt), afterCutoffStart.getTime());
      assert.equal(afterRow.registrationOpen, false);
      assert.equal(afterCutoff.counts.solo, finalSnapshot.counts.solo);
    });
  } finally {
    if (createdMatchIds.length) {
      await pool.query(
        "DELETE FROM daily007_v2_wallet_ledger WHERE match_id = ANY($1::uuid[])",
        [createdMatchIds],
      );
      await pool.query(
        "DELETE FROM daily007_v2_result_awards WHERE match_id = ANY($1::uuid[])",
        [createdMatchIds],
      );
      await pool.query(
        "DELETE FROM daily007_v2_matches WHERE id = ANY($1::uuid[])",
        [createdMatchIds],
      );
    }
    if (createdUserIds.length) {
      await pool.query(
        "DELETE FROM daily007_v2_users WHERE id = ANY($1::uuid[])",
        [createdUserIds],
      );
    }
  }
});
