import assert from "node:assert/strict";
import type { Server } from "node:http";
import express from "express";
import test from "node:test";
import daily007V2Router from "../src/routes/daily007-v2";
import { makeToken } from "../src/lib/daily007-session-token";
import {
  FIRST_PLAYER_ID,
  registrationCapacityTestDb,
  TEST_MATCH_ID,
} from "./support/daily007-registration-capacity-test-db";

const TEST_AUTH_SECRET = "rejected-tournament-join-test-secret-32-chars";
const previousAuthSecret = process.env.DAILY007_AUTH_SECRET;
process.env.DAILY007_AUTH_SECRET = TEST_AUTH_SECRET;

test.after(() => {
  if (previousAuthSecret === undefined) delete process.env.DAILY007_AUTH_SECRET;
  else process.env.DAILY007_AUTH_SECRET = previousAuthSecret;
});

type JoinCase = {
  name: string;
  expectedStatus: number;
  expectedError?: string;
  expectedCode?: string;
  expectedFieldErrors?: Record<string, string>;
  expectedRosterRowsAtLedgerFailure?: number;
  prepare: () => void;
  body?: Record<string, unknown>;
};

async function withServer(run: (origin: string) => Promise<void>): Promise<void> {
  const app = express();
  app.use(express.json());
  app.use(daily007V2Router);
  app.use((
    _error: unknown,
    _request: express.Request,
    response: express.Response,
    _next: express.NextFunction,
  ) => {
    response.status(500).json({ error: "Internal server error." });
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

async function sendRegistration(
  origin: string,
  body: Record<string, unknown> = {
    captainGameName: "First Captain",
    captainGameUid: "FF-FIRST-PLAYER",
    teammates: [],
  },
): Promise<{ status: number; body: Record<string, unknown> }> {
  const token = makeToken(FIRST_PLAYER_ID, 0);
  assert.ok(token, "test account should receive a Daily007 session token");
  const response = await fetch(`${origin}/daily007/v2/matches/${TEST_MATCH_ID}/register`, {
    method: "POST",
    headers: {
      authorization: `Bearer ${token}`,
      "content-type": "application/json",
    },
    body: JSON.stringify(body),
  });
  const responseText = await response.text();
  let parsedBody: unknown;
  try {
    parsedBody = JSON.parse(responseText);
  } catch {
    parsedBody = {};
  }
  return {
    status: response.status,
    body: parsedBody && typeof parsedBody === "object"
      ? parsedBody as Record<string, unknown>
      : {},
  };
}

const rejectedJoins: JoinCase[] = [
  {
    name: "insufficient balance",
    expectedStatus: 409,
    expectedError: "Insufficient wallet balance: this entry costs 7 coins.",
    expectedCode: "INSUFFICIENT_BALANCE",
    prepare: () => {
      registrationCapacityTestDb.users.get(FIRST_PLAYER_ID)!.wallet_coins = 6;
    },
  },
  {
    name: "registration rejected and refunded",
    expectedStatus: 409,
    expectedError: "This registration was rejected and refunded; contact an administrator before trying again.",
    expectedCode: "REGISTRATION_REJECTED",
    prepare: () => {
      registrationCapacityTestDb.registrations[0].captain_user_id = FIRST_PLAYER_ID;
      registrationCapacityTestDb.registrations[0].status = "rejected";
    },
  },
  {
    name: "match has started",
    expectedStatus: 409,
    expectedError: "Registration is closed because the match has started.",
    expectedCode: "MATCH_CLOSED",
    prepare: () => {
      registrationCapacityTestDb.match.starts_at = new Date(Date.now() - 1);
    },
  },
  {
    name: "tournament is disabled",
    expectedStatus: 409,
    expectedError: "This tournament is disabled and is not accepting registrations.",
    expectedCode: "TOURNAMENT_DISABLED",
    prepare: () => {
      registrationCapacityTestDb.match.enabled = false;
    },
  },
  {
    name: "full capacity",
    expectedStatus: 409,
    expectedError: "This match is already full and is not accepting registrations.",
    expectedCode: "MATCH_FULL",
    prepare: () => {
      registrationCapacityTestDb.match.capacity = 1;
      registrationCapacityTestDb.match.status = "full";
      registrationCapacityTestDb.match.is_full = true;
    },
  },
  {
    name: "capacity count recheck while the match still appears open",
    expectedStatus: 409,
    expectedError: "This match is full.",
    expectedCode: "MATCH_FULL",
    prepare: () => {
      registrationCapacityTestDb.match.capacity = 1;
      registrationCapacityTestDb.match.status = "open";
      registrationCapacityTestDb.match.is_full = false;
    },
  },
  {
    name: "player game UID already registered",
    expectedStatus: 409,
    expectedError: "A player game UID is already registered for this tournament.",
    expectedCode: "GAME_UID_ALREADY_REGISTERED",
    prepare: () => {},
    body: {
      captainGameName: "First Captain",
      captainGameUid: "FF-EXISTING-001",
      teammates: [],
    },
  },
  {
    name: "database rejects a duplicate account registration",
    expectedStatus: 409,
    expectedError: "This account is already registered for the match.",
    expectedCode: "ALREADY_REGISTERED",
    prepare: () => {
      registrationCapacityTestDb.failOnNextRegistrationInsertAsDuplicate();
    },
  },
  {
    name: "invalid team details",
    expectedStatus: 400,
    expectedError: "Team registrations require a team name between 1 and 100 characters.",
    expectedFieldErrors: {
      teamName: "Team registrations require a team name between 1 and 100 characters.",
    },
    prepare: () => {
      registrationCapacityTestDb.match.mode = "squad";
      registrationCapacityTestDb.match.team_type = "duo";
    },
  },
  {
    name: "captain game name exceeds the API limit",
    expectedStatus: 400,
    expectedError: "captainGameName must be 1–100 characters.",
    expectedFieldErrors: {
      captainGameName: "captainGameName must be 1–100 characters.",
    },
    prepare: () => {},
    body: {
      captainGameName: "x".repeat(101),
      captainGameUid: "FF-FIRST-PLAYER",
      teammates: [],
    },
  },
  {
    name: "captain game UID exceeds the API limit",
    expectedStatus: 400,
    expectedError: "captainGameUid is required and must contain 1–128 characters.",
    expectedFieldErrors: {
      captainGameUid: "captainGameUid is required and must contain 1–128 characters.",
    },
    prepare: () => {},
    body: {
      captainGameName: "First Captain",
      captainGameUid: "x".repeat(129),
      teammates: [],
    },
  },
  {
    name: "invalid teammate name identifies its matching input",
    expectedStatus: 400,
    expectedError: "Duo registrations require exactly 1 teammate name; teammate UIDs are optional and must be unique.",
    expectedFieldErrors: {
      "memberName:0": "Check the teammate name or UID that needs correction.",
    },
    prepare: () => {
      registrationCapacityTestDb.match.mode = "squad";
      registrationCapacityTestDb.match.team_type = "duo";
    },
    body: {
      captainGameName: "First Captain",
      captainGameUid: "FF-FIRST-PLAYER",
      teamName: "Test Duo",
      teammates: [{ name: "x".repeat(101), uid: "FF-TEAMMATE-002" }],
    },
  },
  {
    name: "invalid teammate UID identifies its matching input",
    expectedStatus: 400,
    expectedError: "Duo registrations require exactly 1 teammate name; teammate UIDs are optional and must be unique.",
    expectedFieldErrors: {
      "memberUid:0": "Check the teammate name or UID that needs correction.",
    },
    prepare: () => {
      registrationCapacityTestDb.match.mode = "squad";
      registrationCapacityTestDb.match.team_type = "duo";
    },
    body: {
      captainGameName: "First Captain",
      captainGameUid: "FF-FIRST-PLAYER",
      teamName: "Test Duo",
      teammates: [{ name: "Second Player", uid: "x".repeat(129) }],
    },
  },
  {
    name: "ledger write failure after registration and wallet updates",
    expectedStatus: 500,
    expectedError: "Internal server error.",
    prepare: () => {
      registrationCapacityTestDb.failOnNextLedgerInsert();
    },
  },
  {
    name: "team ledger write failure after registration, roster, and wallet updates",
    expectedStatus: 500,
    expectedError: "Internal server error.",
    expectedRosterRowsAtLedgerFailure: 1,
    prepare: () => {
      registrationCapacityTestDb.match.mode = "squad";
      registrationCapacityTestDb.match.team_type = "duo";
      registrationCapacityTestDb.failOnNextLedgerInsert();
    },
    body: {
      captainGameName: "First Captain",
      captainGameUid: "FF-FIRST-PLAYER",
      teamName: "Test Duo",
      teammates: [{ name: "Second Player", uid: "FF-TEAMMATE-002" }],
    },
  },
];

test("rejected tournament joins leave registrations, roster, wallet, match, and ledger unchanged", async (t) => {
  await withServer(async (origin) => {
    for (const scenario of rejectedJoins) {
      await t.test(scenario.name, async () => {
        registrationCapacityTestDb.reset();
        scenario.prepare();
        const before = {
          user: structuredClone(registrationCapacityTestDb.users.get(FIRST_PLAYER_ID)!),
          match: structuredClone(registrationCapacityTestDb.match),
          registrations: structuredClone(registrationCapacityTestDb.registrations),
          roster: structuredClone(registrationCapacityTestDb.roster),
          ledger: structuredClone(registrationCapacityTestDb.ledger),
        };

        const response = await sendRegistration(origin, scenario.body);

        assert.equal(response.status, scenario.expectedStatus);
        if (scenario.expectedError) assert.equal(response.body.error, scenario.expectedError);
        assert.equal(response.body.code, scenario.expectedCode);
        assert.deepEqual(response.body.fieldErrors, scenario.expectedFieldErrors);
        if (scenario.expectedRosterRowsAtLedgerFailure !== undefined) {
          assert.equal(
            registrationCapacityTestDb.rosterRowsAtLedgerFailure,
            scenario.expectedRosterRowsAtLedgerFailure,
            "the injected ledger failure should occur after writing the team roster",
          );
        }
        assert.deepEqual(registrationCapacityTestDb.users.get(FIRST_PLAYER_ID), before.user);
        assert.deepEqual(registrationCapacityTestDb.match, before.match);
        assert.deepEqual(registrationCapacityTestDb.registrations, before.registrations);
        assert.deepEqual(registrationCapacityTestDb.roster, before.roster);
        assert.deepEqual(registrationCapacityTestDb.ledger, before.ledger);
      });
    }
  });
});