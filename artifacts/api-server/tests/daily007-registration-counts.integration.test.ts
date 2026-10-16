import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import type { Server } from "node:http";
import express from "express";
import test, { after } from "node:test";
import { pool } from "@workspace/db";
import daily007CompatCoreRouter from "../src/routes/daily007-compat-core";

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

after(async () => {
  await pool.end();
});

async function withServer(run: (origin: string) => Promise<void>): Promise<void> {
  const app = express();
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

test("PostgreSQL counts a rosterless approved team once and excludes rejected teams", async () => {
  const matchId = randomUUID();
  await pool.query(
    `INSERT INTO daily007_v2_matches
       (id, title, mode, game_mode, team_type, capacity, entry_coins, prize_pool, starts_at, status)
     VALUES ($1, 'Rosterless Registration Count', 'squad', 'battle_royale', 'squad',
             12, 5, 100, clock_timestamp() + interval '20 hours', 'open')`,
    [matchId],
  );

  const registrations = [
    {
      label: "Rosterless Approved",
      status: "approved",
      teamName: "Rosterless Approved Team",
      captainGameName: "RosterlessCaptain",
      roster: [] as { position: number; name: string; uid: string }[],
    },
    {
      label: "Pending With Roster",
      status: "pending",
      teamName: "Pending Roster Team",
      captainGameName: "PendingCaptain",
      roster: [{ position: 1, name: "PendingTeammate", uid: "pending-teammate-uid" }],
    },
    {
      label: "Rejected",
      status: "rejected",
      teamName: "Rejected Team",
      captainGameName: "RejectedCaptain",
      roster: [{ position: 1, name: "RejectedTeammate", uid: "rejected-teammate-uid" }],
    },
  ] as const;

  for (const [index, entry] of registrations.entries()) {
    const userId = randomUUID();
    await pool.query(
      `INSERT INTO daily007_v2_users (id, name, email, password_salt, password_hash)
       VALUES ($1, $2, $3, 'salt', 'hash')`,
      [userId, `${entry.label} Captain`, `${userId}@example.test`],
    );
    const registration = await pool.query<{ id: string }>(
      `INSERT INTO daily007_v2_registrations
         (match_id, captain_user_id, captain_name, captain_game_name, captain_game_uid,
          team_name, entry_coins_paid, status, created_at)
       VALUES ($1, $2, $3, $4, $5, $6, 5, $7, clock_timestamp() + ($8 * interval '1 millisecond'))
       RETURNING id`,
      [
        matchId,
        userId,
        `${entry.label} Captain`,
        entry.captainGameName,
        `${entry.label.toLowerCase().replaceAll(" ", "-")}-captain-uid`,
        entry.teamName,
        entry.status,
        index,
      ],
    );

    for (const member of entry.roster) {
      await pool.query(
        `INSERT INTO daily007_v2_roster (registration_id, position, member_uid, member_name)
         VALUES ($1, $2, $3, $4)`,
        [registration.rows[0].id, member.position, member.uid, member.name],
      );
    }
  }

  await withServer(async (origin) => {
    const beforeParticipantsResponse = await fetch(`${origin}/tournaments/${matchId}`);
    assert.equal(beforeParticipantsResponse.status, 200);
    const beforeParticipantsSummary = await beforeParticipantsResponse.json() as {
      filledSlots: number;
      availableSlots: number;
    };

    const participantsResponse = await fetch(`${origin}/tournaments/${matchId}/participants`);
    assert.equal(participantsResponse.status, 200);
    const participantPayload = await participantsResponse.json() as {
      tournamentId: string;
      participants: { teamName: string; status: string; players: string[] }[];
    };
    const participants = participantPayload.participants;
    assert.equal(participantPayload.tournamentId, matchId);
    assert.equal(participants.length, 2);
    assert.deepEqual(
      participants
        .map(({ teamName, status, players }) => ({ teamName, status, players }))
        .sort((left, right) => left.teamName.localeCompare(right.teamName)),
      [
        {
          teamName: "Pending Roster Team",
          status: "pending",
          players: ["PendingCaptain", "PendingTeammate"],
        },
        {
          teamName: "Rosterless Approved Team",
          status: "approved",
          players: ["RosterlessCaptain"],
        },
      ],
    );
    assert.equal(
      participants.filter(({ teamName }) => teamName === "Rosterless Approved Team").length,
      1,
      "The approved rosterless team must appear exactly once.",
    );
    assert.equal(
      participants.some(({ teamName }) => teamName === "Rejected Team"),
      false,
      "Rejected registrations must not appear in the public participant count.",
    );

    const afterParticipantsResponse = await fetch(`${origin}/tournaments/${matchId}`);
    assert.equal(afterParticipantsResponse.status, 200);
    const afterParticipantsSummary = await afterParticipantsResponse.json() as {
      filledSlots: number;
      availableSlots: number;
    };

    for (const summary of [beforeParticipantsSummary, afterParticipantsSummary]) {
      assert.equal(summary.filledSlots, participants.length);
      assert.equal(summary.filledSlots, 2);
      assert.equal(summary.availableSlots, 10);
    }
    const legacyTeamCount = await pool.query<{ count: number }>(
      "SELECT count(*)::integer AS count FROM daily007_v2_squad_teams WHERE match_id = $1",
      [matchId],
    );
    assert.equal(legacyTeamCount.rows[0].count, 2);
  });
});
