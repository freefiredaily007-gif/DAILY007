import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import type { Server } from "node:http";
import express from "express";
import test, { after } from "node:test";
import { pool } from "@workspace/db";
import { makeToken } from "../src/lib/daily007-session-token";
import daily007CompatCoreRouter from "../src/routes/daily007-compat-core";
import daily007CompatExtraRouter from "../src/routes/daily007-compat-extra";
import daily007V2Router from "../src/routes/daily007-v2";

const TEST_AUTH_SECRET = "daily007-squad-slots-integration-test-secret";
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

type ApiResponse = { status: number; body: Record<string, any> };

after(async () => {
  if (previousAuthSecret === undefined) delete process.env.DAILY007_AUTH_SECRET;
  else process.env.DAILY007_AUTH_SECRET = previousAuthSecret;
  await pool.end();
});

async function withServer(run: (origin: string) => Promise<void>): Promise<void> {
  const app = express();
  app.use(express.json());
  app.use(daily007CompatCoreRouter);
  app.use(daily007CompatExtraRouter);
  app.use(daily007V2Router);
  app.use((
    error: unknown,
    _request: express.Request,
    response: express.Response,
    _next: express.NextFunction,
  ) => {
    response.status(500).json({ error: error instanceof Error ? error.message : String(error) });
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

function headers(userId: string): Record<string, string> {
  const token = makeToken(userId, 0);
  assert.ok(token);
  return { authorization: `Bearer ${token}`, "content-type": "application/json" };
}

async function createUser(role = "user", walletCoins = 100): Promise<string> {
  const id = randomUUID();
  await pool.query(
    `INSERT INTO daily007_v2_users
       (id, name, email, password_salt, password_hash, role, wallet_coins)
     VALUES ($1, $2, $3, 'salt', 'hash', $4, $5)`,
    [id, `Squad Player ${id.slice(0, 6)}`, `squad-${id}@example.test`, role, walletCoins],
  );
  return id;
}

async function createMatch(
  entryCoins = 10,
  format: Partial<{ title: string; mode: string; gameMode: string; teamType: string; capacity: number }> = {},
): Promise<string> {
  const id = randomUUID();
  const match = {
    title: format.title ?? "Squad Slot Integration",
    mode: format.mode ?? "squad",
    gameMode: format.gameMode ?? "battle_royale",
    teamType: format.teamType ?? "squad",
    capacity: format.capacity ?? 12,
  };
  await pool.query(
    `INSERT INTO daily007_v2_matches
       (id, title, mode, game_mode, team_type, capacity, entry_coins, starts_at, status)
     VALUES ($1, $2, $3, $4, $5, $6, $7, clock_timestamp() + interval '20 hours', 'open')`,
    [id, match.title, match.mode, match.gameMode, match.teamType, match.capacity, entryCoins],
  );
  return id;
}

async function joinSlot(
  origin: string,
  matchId: string,
  userId: string,
  teamNumber: number,
  slotNumber: number,
): Promise<ApiResponse> {
  const response = await fetch(`${origin}/daily007/v2/matches/${matchId}/squad-join`, {
    method: "POST",
    headers: headers(userId),
    body: JSON.stringify({
      teamNumber,
      slotNumber,
      gameName: `Player-${userId.slice(0, 6)}`,
      gameUid: `uid-${userId}`,
    }),
  });
  return { status: response.status, body: await response.json() as Record<string, any> };
}

async function joinSoloSeat(
  origin: string,
  matchId: string,
  userId: string,
  seatGroupNumber: number,
): Promise<ApiResponse> {
  const response = await fetch(`${origin}/daily007/v2/matches/${matchId}/register`, {
    method: "POST",
    headers: headers(userId),
    body: JSON.stringify({
      captainGameName: `Player-${userId.slice(0, 6)}`,
      captainGameUid: `uid-${userId}`,
      seatGroupNumber,
    }),
  });
  return { status: response.status, body: await response.json() as Record<string, any> };
}

async function slotsFor(origin: string, matchId: string, userId: string): Promise<ApiResponse> {
  const response = await fetch(`${origin}/daily007/v2/matches/${matchId}/squad-slots`, {
    headers: headers(userId),
  });
  return { status: response.status, body: await response.json() as Record<string, any> };
}

test("Squad slots charge each player atomically, preserve captain control, and transfer captaincy", async (t) => {
  await withServer(async (origin) => {
    await t.test("only one concurrent player can take the same slot and charge", async () => {
      const matchId = await createMatch();
      const [firstUser, secondUser] = await Promise.all([createUser(), createUser()]);
      const results = await Promise.all([
        joinSlot(origin, matchId, firstUser, 1, 1),
        joinSlot(origin, matchId, secondUser, 1, 1),
      ]);
      assert.equal(results.filter((result) => result.status === 201).length, 1);
      assert.equal(results.filter((result) => result.status === 409).length, 1);
      const rows = await pool.query<{
        registrations: number; active_members: number; entry_ledgers: number; paid_balance: number;
      }>(
        `SELECT
           (SELECT count(*)::integer FROM daily007_v2_registrations WHERE match_id = $1) AS registrations,
           (SELECT count(*)::integer FROM daily007_v2_squad_team_members member
              JOIN daily007_v2_squad_teams team ON team.id = member.team_id
             WHERE team.match_id = $1 AND member.is_active) AS active_members,
           (SELECT count(*)::integer FROM daily007_v2_wallet_ledger WHERE match_id = $1) AS entry_ledgers,
           (SELECT count(*)::integer FROM daily007_v2_users WHERE id = ANY($2::uuid[]) AND wallet_coins = 90) AS paid_balance`,
        [matchId, [firstUser, secondUser]],
      );
      assert.deepEqual(rows.rows[0], { registrations: 1, active_members: 1, entry_ledgers: 1, paid_balance: 1 });
    });

    await t.test("captain removal keeps the paid fee, reopens the slot, and admin rejection transfers captaincy", async () => {
      const matchId = await createMatch();
      const captain = await createUser();
      const removedPlayer = await createUser();
      const replacement = await createUser();
      const teammate = await createUser();
      const admin = await createUser("tournament_admin");
      const captainJoin = await joinSlot(origin, matchId, captain, 3, 1);
      const removedJoin = await joinSlot(origin, matchId, removedPlayer, 3, 2);
      assert.equal(captainJoin.status, 201);
      assert.equal(captainJoin.body.isCaptain, true);
      assert.equal(removedJoin.status, 201);
      const removedRegistrationId = removedJoin.body.registrationId as string;

      const removed = await fetch(`${origin}/daily007/v2/matches/${matchId}/squad-slots/3/2`, {
        method: "DELETE",
        headers: headers(captain),
      });
      assert.equal(removed.status, 200);
      assert.equal((await removed.json() as Record<string, unknown>).refunded, false);
      const afterRemoval = await pool.query<{ wallet_coins: number; ledger_count: number; status: string }>(
        `SELECT u.wallet_coins,
                (SELECT count(*)::integer FROM daily007_v2_wallet_ledger WHERE registration_id = $2) AS ledger_count,
                r.status
           FROM daily007_v2_users u JOIN daily007_v2_registrations r ON r.captain_user_id = u.id
          WHERE u.id = $1 AND r.id = $2`,
        [removedPlayer, removedRegistrationId],
      );
      assert.deepEqual(afterRemoval.rows[0], { wallet_coins: 90, ledger_count: 1, status: "removed" });

      assert.equal((await joinSlot(origin, matchId, replacement, 3, 2)).status, 201);
      assert.equal((await joinSlot(origin, matchId, teammate, 3, 3)).status, 201);
      const selfRemoval = await fetch(`${origin}/daily007/v2/matches/${matchId}/squad-slots/3/1`, {
        method: "DELETE",
        headers: headers(captain),
      });
      assert.equal(selfRemoval.status, 409, "a captain cannot remove themself");
      const unauthorizedRemoval = await fetch(`${origin}/daily007/v2/matches/${matchId}/squad-slots/3/2`, {
        method: "DELETE",
        headers: headers(teammate),
      });
      assert.equal(unauthorizedRemoval.status, 403, "a non-captain cannot manage another player's slot");
      const reject = await fetch(`${origin}/admin/registrations/${captainJoin.body.registrationId}/reject`, {
        method: "POST",
        headers: headers(admin),
        body: JSON.stringify({}),
      });
      assert.equal(reject.status, 200);
      const state = await slotsFor(origin, matchId, replacement);
      assert.equal(state.status, 200);
      const team = state.body.teams.find((candidate: any) => candidate.teamNumber === 3);
      assert.equal(team.slots[1].isCaptain, true);
      assert.equal(team.slots[2].canRemove, true);

      const balances = await pool.query<{ id: string; wallet_coins: number }>(
        "SELECT id, wallet_coins FROM daily007_v2_users WHERE id = ANY($1::uuid[]) ORDER BY id",
        [[captain, removedPlayer, replacement, teammate]],
      );
      const balanceById = Object.fromEntries(balances.rows.map((row) => [row.id, row.wallet_coins]));
      assert.equal(balanceById[captain], 100, "admin rejection refunds the captain's entry fee");
      assert.equal(balanceById[removedPlayer], 90, "captain removal does not refund the teammate");
      assert.equal(balanceById[replacement], 90);
      assert.equal(balanceById[teammate], 90);
    });

    await t.test("only the captain's registration can publish a Squad result", async () => {
      const matchId = await createMatch();
      const captain = await createUser();
      const teammate = await createUser();
      const admin = await createUser("tournament_admin");
      const captainJoin = await joinSlot(origin, matchId, captain, 2, 1);
      const teammateJoin = await joinSlot(origin, matchId, teammate, 2, 2);
      await pool.query(
        "UPDATE daily007_v2_matches SET starts_at = clock_timestamp() - interval '1 hour' WHERE id = $1",
        [matchId],
      );
      const response = await fetch(`${origin}/admin/results`, {
        method: "POST",
        headers: headers(admin),
        body: JSON.stringify({
          tournamentId: matchId,
          registrationId: teammateJoin.body.registrationId,
          rank: 1,
          kills: 0,
        }),
      });
      assert.equal(response.status, 409);
      assert.match(String((await response.json() as Record<string, unknown>).error), /team captain/i);
      const noAwards = await pool.query<{ count: number }>(
        "SELECT count(*)::integer AS count FROM daily007_v2_result_awards WHERE match_id = $1",
        [matchId],
      );
      assert.equal(noAwards.rows[0].count, 0);
      assert.equal(captainJoin.status, 201);
    });

    await t.test("legacy whole-team records stay intact and public rosters expose names only", async () => {
      const matchId = await createMatch();
      const captain = await createUser();
      const registration = await pool.query<{ id: string }>(
        `INSERT INTO daily007_v2_registrations
           (match_id, captain_user_id, captain_name, captain_game_name, captain_game_uid,
            team_name, entry_coins_paid, status)
         VALUES ($1, $2, 'Legacy Captain', 'LegacyLead', 'legacy-captain-uid',
                 'Legacy Team', 10, 'approved')
         RETURNING id`,
        [matchId, captain],
      );
      for (const [position, name, uid] of [
        [1, "Legacy Mate One", "legacy-mate-uid-1"],
        [2, "Legacy Mate Two", "legacy-mate-uid-2"],
        [3, "Legacy Mate Three", "legacy-mate-uid-3"],
      ] as const) {
        await pool.query(
          "INSERT INTO daily007_v2_roster (registration_id, position, member_name, member_uid) VALUES ($1, $2, $3, $4)",
          [registration.rows[0].id, position, name, uid],
        );
      }
      const response = await slotsFor(origin, matchId, captain);
      assert.equal(response.status, 200);
      const team = response.body.teams[0];
      assert.equal(team.legacy, true);
      assert.deepEqual(team.slots.map((slot: any) => slot.gameName), [
        "LegacyLead", "Legacy Mate One", "Legacy Mate Two", "Legacy Mate Three",
      ]);
      assert.equal(team.slots[0].isCaptain, true);
      assert.equal(team.slots[1].canRemove, false);

      const publicResponse = await fetch(`${origin}/tournaments/${matchId}/participants`);
      assert.equal(publicResponse.status, 200);
      const publicBody = await publicResponse.json() as Record<string, any>;
      assert.deepEqual(publicBody.participants[0].players, [
        "LegacyLead", "Legacy Mate One", "Legacy Mate Two", "Legacy Mate Three",
      ]);
      const serialized = JSON.stringify(publicBody);
      assert.equal(serialized.includes("legacy-captain-uid"), false);
      assert.equal(serialized.includes(captain), false);
      const preserved = await pool.query<{ team_name: string; status: string; roster_count: number }>(
        `SELECT registration.team_name, registration.status,
                (SELECT count(*)::integer FROM daily007_v2_roster roster
                  WHERE roster.registration_id = registration.id) AS roster_count
           FROM daily007_v2_registrations registration WHERE registration.id = $1`,
        [registration.rows[0].id],
      );
      assert.deepEqual(preserved.rows[0], { team_name: "Legacy Team", status: "approved", roster_count: 3 });
    });

    await t.test("zero-fee matches do not change the wallet or create a payment ledger entry", async () => {
      const matchId = await createMatch(0);
      const player = await createUser("user", 37);
      const joined = await joinSlot(origin, matchId, player, 1, 4);
      assert.equal(joined.status, 201);
      assert.equal(joined.body.entryCoinsPaid, 0);
      const result = await pool.query<{ wallet_coins: number; ledger_count: number }>(
        `SELECT wallet_coins,
                (SELECT count(*)::integer FROM daily007_v2_wallet_ledger WHERE match_id = $2) AS ledger_count
           FROM daily007_v2_users WHERE id = $1`,
        [player, matchId],
      );
      assert.deepEqual(result.rows[0], { wallet_coins: 37, ledger_count: 0 });
    });

    await t.test("individual seats work for BR Duo, Clash Squad, and Lone Wolf formats", async () => {
      const formats = [
        { title: "BR Duo", mode: "squad", gameMode: "battle_royale", teamType: "duo", capacity: 24, teamNumber: 24 },
        { title: "Clash Squad Duo", mode: "clash", gameMode: "clash_squad", teamType: "duo", capacity: 2, teamNumber: 2 },
        { title: "Clash Squad Squad", mode: "clash", gameMode: "clash_squad", teamType: "squad", capacity: 2, teamNumber: 2 },
        { title: "Lone Wolf Duo", mode: "clash", gameMode: "lone_wolf", teamType: "duo", capacity: 2, teamNumber: 2 },
        { title: "Lone Wolf Squad", mode: "clash", gameMode: "lone_wolf", teamType: "squad", capacity: 2, teamNumber: 2 },
      ] as const;

      for (const format of formats) {
        const matchId = await createMatch(10, format);
        const firstPlayer = await createUser();
        const secondPlayer = await createUser();
        const firstJoin = await joinSlot(origin, matchId, firstPlayer, format.teamNumber, 2);
        const secondJoin = await joinSlot(origin, matchId, secondPlayer, format.teamNumber, 1);

        assert.equal(firstJoin.status, 201, `${format.title}: the first selected seat should be accepted.`);
        assert.equal(secondJoin.status, 201, `${format.title}: another player should be able to join a different seat in the same team.`);
        assert.equal(firstJoin.body.isCaptain, false, `${format.title}: slot 2 is not the team captain slot.`);
        assert.equal(secondJoin.body.isCaptain, true, `${format.title}: slot 1 is the team captain slot.`);
        assert.equal(
          (await joinSlot(origin, matchId, await createUser(), format.teamNumber, 2)).status,
          409,
          `${format.title}: an occupied seat must not be reused.`,
        );

        const slots = await slotsFor(origin, matchId, firstPlayer);
        assert.equal(slots.status, 200);
        const team = slots.body.teams.find((candidate: any) => candidate.teamNumber === format.teamNumber);
        assert.deepEqual(
          team.slots.slice(0, 2).map((slot: any) => slot.gameName),
          [`Player-${secondPlayer.slice(0, 6)}`, `Player-${firstPlayer.slice(0, 6)}`],
          `${format.title}: slot labels should reflect the actual saved seat numbers.`,
        );
        assert.equal(slots.body.filledPlayers, 2);

        const publicResponse = await fetch(`${origin}/tournaments/${matchId}/participants`);
        const publicBody = await publicResponse.json() as Record<string, any>;
        assert.deepEqual(publicBody.participants[0].players, [
          `Player-${secondPlayer.slice(0, 6)}`,
          `Player-${firstPlayer.slice(0, 6)}`,
        ]);

        const rejected = await fetch(`${origin}/admin/registrations/${secondJoin.body.registrationId}/reject`, {
          method: "POST",
          headers: headers(await createUser("tournament_admin")),
          body: JSON.stringify({}),
        });
        assert.equal(rejected.status, 200, `${format.title}: admin rejection should release that player's seat.`);
        const afterReject = await slotsFor(origin, matchId, await createUser());
        assert.equal(afterReject.body.filledPlayers, 1);
        assert.equal(
          afterReject.body.teams.find((candidate: any) => candidate.teamNumber === format.teamNumber).slots[0].canJoin,
          true,
        );
      }
    });

    await t.test("the last player seat remains joinable when all team cards are already occupied", async () => {
      const matchId = await createMatch(10, {
        title: "BR Duo Partial Final Team",
        mode: "squad",
        gameMode: "battle_royale",
        teamType: "duo",
        capacity: 2,
      });
      const [teamOneCaptain, teamTwoCaptain, teamOnePlayer, lastPlayer] = await Promise.all([
        createUser(), createUser(), createUser(), createUser(),
      ]);

      assert.equal((await joinSlot(origin, matchId, teamOneCaptain, 1, 1)).status, 201);
      assert.equal((await joinSlot(origin, matchId, teamTwoCaptain, 2, 1)).status, 201);
      assert.equal((await joinSlot(origin, matchId, teamOnePlayer, 1, 2)).status, 201);

      // Reproduce the stale state that incorrectly treated 2/2 occupied teams
      // as full even though only 3 of 4 player seats had been claimed.
      await pool.query(
        "UPDATE daily007_v2_matches SET status = 'setup_needed', is_full = true WHERE id = $1",
        [matchId],
      );

      const availableSlots = await slotsFor(origin, matchId, lastPlayer);
      assert.equal(availableSlots.status, 200);
      assert.equal(availableSlots.body.filledTeams, 2);
      assert.equal(availableSlots.body.filledPlayers, 3);
      assert.equal(availableSlots.body.registrationClosed, false);
      assert.equal(availableSlots.body.teams[1].slots[1].occupied, false);
      assert.equal(availableSlots.body.teams[1].slots[1].canJoin, true);

      const lastJoin = await joinSlot(origin, matchId, lastPlayer, 2, 2);
      assert.equal(lastJoin.status, 201);
      assert.equal(lastJoin.body.filledPlayers, 4);
      const lastPlayerWallet = await pool.query<{ wallet_coins: number; entry_count: number }>(
        `SELECT wallet_coins,
                (SELECT count(*)::integer FROM daily007_v2_wallet_ledger
                  WHERE user_id = $1 AND match_id = $2 AND reason = 'match_entry') AS entry_count
           FROM daily007_v2_users WHERE id = $1`,
        [lastPlayer, matchId],
      );
      assert.deepEqual(lastPlayerWallet.rows[0], { wallet_coins: 90, entry_count: 1 });
      const finalSlots = await slotsFor(origin, matchId, lastPlayer);
      assert.equal(finalSlots.body.registrationClosed, true);
      assert.equal(finalSlots.body.filledPlayers, 4);
      assert.equal(finalSlots.body.teams[1].slots[1].occupied, true);
      assert.equal(finalSlots.body.teams[1].slots[1].canJoin, false);
    });

    await t.test("selected player seats persist for Clash Solo and Lone Wolf Solo", async () => {
      const formats = [
        { title: "Clash Squad Solo", gameMode: "clash_squad" },
        { title: "Lone Wolf Solo", gameMode: "lone_wolf" },
      ] as const;
      for (const format of formats) {
        const matchId = await createMatch(10, {
          title: format.title,
          mode: "clash",
          gameMode: format.gameMode,
          teamType: "solo",
          capacity: 2,
        });
        const firstPlayer = await createUser();
        const secondPlayer = await createUser();
        const duplicatePlayer = await createUser();
        const first = await joinSoloSeat(origin, matchId, firstPlayer, 1);
        const second = await joinSoloSeat(origin, matchId, secondPlayer, 2);
        const duplicate = await joinSoloSeat(origin, matchId, duplicatePlayer, 1);

        assert.equal(first.status, 201, `${format.title}: PLAYER 1 should be joinable.`);
        assert.equal(second.status, 201, `${format.title}: PLAYER 2 should be joinable.`);
        assert.equal(first.body.seatGroupNumber, 1);
        assert.equal(second.body.seatGroupNumber, 2);
        assert.equal(duplicate.status, 409, `${format.title}: an occupied player seat must stay unavailable.`);
        const duplicateBalance = await pool.query<{ wallet_coins: number }>(
          "SELECT wallet_coins FROM daily007_v2_users WHERE id = $1",
          [duplicatePlayer],
        );
        assert.equal(duplicateBalance.rows[0].wallet_coins, 100);
        const participants = await fetch(`${origin}/tournaments/${matchId}/participants`);
        const body = await participants.json() as Record<string, any>;
        assert.deepEqual(
          body.participants.map((participant: any) => participant.groupNumber).sort(),
          [1, 2],
          `${format.title}: each player should retain their selected seat.`,
        );
      }
    });

    await t.test("team-mode results remain limited to the captain slot", async () => {
      const matchId = await createMatch(10, {
        title: "Clash Squad Duo Results",
        mode: "clash",
        gameMode: "clash_squad",
        teamType: "duo",
        capacity: 2,
      });
      const firstSeat = await createUser();
      const captain = await createUser();
      const admin = await createUser("tournament_admin");
      const firstJoin = await joinSlot(origin, matchId, firstSeat, 1, 2);
      const captainJoin = await joinSlot(origin, matchId, captain, 1, 1);
      assert.equal(firstJoin.status, 201);
      assert.equal(captainJoin.status, 201);
      await pool.query(
        "UPDATE daily007_v2_matches SET starts_at = clock_timestamp() - interval '1 hour' WHERE id = $1",
        [matchId],
      );
      const response = await fetch(`${origin}/admin/results`, {
        method: "POST",
        headers: headers(admin),
        body: JSON.stringify({
          tournamentId: matchId,
          registrationId: firstJoin.body.registrationId,
          rank: 1,
          kills: 0,
        }),
      });
      assert.equal(response.status, 409);
      assert.match(String((await response.json() as Record<string, unknown>).error), /team captain/i);
    });
  });
});
