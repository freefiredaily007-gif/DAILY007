import assert from "node:assert/strict";
import type { Server } from "node:http";
import express from "express";
import test from "node:test";
import daily007CompatCoreRouter from "../src/routes/daily007-compat-core";
import daily007V2Router from "../src/routes/daily007-v2";
import { makeToken } from "../src/lib/daily007-session-token";
import {
  registrationProfileTestDb,
  PUBLIC_PARTICIPANT_PRIVATE_EMAIL,
  PUBLIC_PARTICIPANT_PRIVATE_PHONE,
  PUBLIC_PARTICIPANT_PRIVATE_WALLET,
  TEST_MATCH_ID,
  TEST_PLAYER_ID,
  TEST_TOURNAMENT_ADMIN_ID,
} from "./support/daily007-registration-profile-name-test-db";

const TEST_AUTH_SECRET = "captain-profile-name-registration-test-secret";
const PROFILE_NAME = "Daily007 Profile Name";
const CAPTAIN_GAME_NAME = "FireCaptain";
const CAPTAIN_GAME_UID = "FF-CAPTAIN-017";
const TEAM_NAME = "Blue Fire";
const TEAMMATE_NAME = "FireMate";
const TEAMMATE_UID = "FF-MATE-029";
const TEAMMATE_TWO_NAME = "FireMateTwo";
const TEAMMATE_TWO_UID = "FF-MATE-030";
const TEAMMATE_THREE_NAME = "FireMateThree";
const TEAMMATE_THREE_UID = "FF-MATE-031";
const CSV_PROFILE_NAME = 'Daily007, "Captain"';
const CSV_CAPTAIN_GAME_NAME = 'Fire, "Storm"';
const CSV_TEAM_NAME = 'Squad, "Wildfire"';
const CSV_TEAMMATE_NAMES = [
  'Mate, "North"',
  'Mate, "East"',
  'Mate, "West"',
] as const;
const FORMULA_PROFILE_NAME = '=HYPERLINK("https://example.test", "captain")';
const FORMULA_CAPTAIN_GAME_NAME = "+SUM(1,2)";
const FORMULA_TEAM_NAME = "-1+2";
const FORMULA_TEAMMATE_NAMES = [
  "@SUM(3,4)",
  "=HYPERLINK(\"https://example.test\", \"mate\")",
  "+5+6",
] as const;
const FULLWIDTH_FORMULA_PROFILE_NAME = "＝HYPERLINK(\"https://example.test\", \"captain\")";
const FULLWIDTH_FORMULA_CAPTAIN_GAME_NAME = "＋SUM(1,2)";
const FULLWIDTH_FORMULA_TEAM_NAME = "－1+2";
const FULLWIDTH_FORMULA_TEAMMATE_NAMES = [
  "＠SUM(3,4)",
  "＝HYPERLINK(\"https://example.test\", \"mate\")",
  "＋5+6",
] as const;
const FORMULA_CAPTAIN_GAME_UID = "=CAPTAIN-UID";
const FORMULA_CAPTAIN_EMAIL = "+captain@example.test";
const FORMULA_TEAMMATE_GAME_UIDS = [
  "+TEAMMATE-UID-1",
  "-TEAMMATE-UID-2",
  "@TEAMMATE-UID-3",
] as const;
const HIDDEN_PREFIX_PROFILE_NAME = ' =HYPERLINK("https://example.test", "captain")';
const HIDDEN_PREFIX_CAPTAIN_GAME_NAME = "\t\u00A0+SUM(1,2)";
const HIDDEN_PREFIX_CAPTAIN_GAME_UID = "\uFEFF=CAPTAIN-UID";
const HIDDEN_PREFIX_CAPTAIN_EMAIL = "\u00A0+captain-formula@example.test";
const HIDDEN_PREFIX_TEAMMATE_GAME_UIDS = [
  "\t@TEAMMATE-UID-1",
  "\u200B-TEAMMATE-UID-2",
  " \uFEFF=TEAMMATE-UID-3",
] as const;
const HIDDEN_PREFIX_TEAM_NAME = "\uFEFF\u200B-1+2";
const HIDDEN_PREFIX_TEAMMATE_NAMES = [
  " @SUM(3,4)",
  "\u200B=HYPERLINK(\"https://example.test\", \"mate\")",
  "\uFEFF\u3000+5+6",
] as const;
const MULTILINE_PROFILE_NAME = "Daily007\r\nCaptain";
const MULTILINE_CAPTAIN_GAME_NAME = "Fire\r\nStorm";
const MULTILINE_TEAM_NAME = "Blue\r\nFire";
const MULTILINE_TEAMMATE_NAMES = [
  "North\r\nEast",
  "South\r\nWest",
  "West\r\nNorth",
] as const;
const previousAuthSecret = process.env.DAILY007_AUTH_SECRET;
process.env.DAILY007_AUTH_SECRET = TEST_AUTH_SECRET;

test.after(() => {
  if (previousAuthSecret === undefined) delete process.env.DAILY007_AUTH_SECRET;
  else process.env.DAILY007_AUTH_SECRET = previousAuthSecret;
});

test("my registration results contain Free Fire and team names but no other players' profile names", async () => {
  registrationProfileTestDb.reset(PROFILE_NAME);
  try {
    await withServer(async (origin) => {
      const registered = await sendRegistration(
        origin,
        registrationRequests[0].path,
        registrationRequests[0].body,
      );
      assert.equal(registered.status, 201);
      const ownRegistration = registrationProfileTestDb.registrations[0];
      const other = registrationProfileTestDb.addOtherRegistration();
      registrationProfileTestDb.resultAwards = [
        {
          match_id: TEST_MATCH_ID,
          registration_id: other.registration.id,
          rank: 1,
          kills: 8,
          prize_coins: 100,
        },
        {
          match_id: TEST_MATCH_ID,
          registration_id: ownRegistration.id,
          rank: 2,
          kills: 5,
          prize_coins: 50,
        },
      ];

      const token = makeToken(TEST_PLAYER_ID, 0);
      assert.ok(token);
      const response = await getWithToken(origin, "/my/registrations", token);
      assert.equal(response.status, 200);
      const registrations = await response.json() as {
        playerName: string;
        tournament: {
          results: {
            rank: number;
            kills: number;
            prizeCoins: number;
            gameName: string;
            teamName: string;
            playerName?: string;
          }[];
        };
      }[];

      assert.equal(registrations[0].playerName, PROFILE_NAME);
      const results = registrations[0].tournament.results;
      assert.deepEqual(results, [
        {
          rank: 1,
          kills: 8,
          prizeCoins: 100,
          gameName: "OtherFireCaptain",
          teamName: "Other Fire",
        },
        {
          rank: 2,
          kills: 5,
          prizeCoins: 50,
          gameName: CAPTAIN_GAME_NAME,
          teamName: TEAM_NAME,
        },
      ]);
      assert.equal(JSON.stringify(results).includes(PROFILE_NAME), false);
      assert.equal(JSON.stringify(results).includes("Other Daily007 Player"), false);
    });
  } finally {
    registrationProfileTestDb.reset();
  }
});

test("public tournament participants include approved and pending teams but omit rejected teams", async () => {
  registrationProfileTestDb.reset();
  try {
    const approved = registrationProfileTestDb.addOtherRegistration(
      "approved",
      TEST_MATCH_ID,
      "Approved",
    );
    const pending = registrationProfileTestDb.addOtherRegistration(
      "pending",
      TEST_MATCH_ID,
      "Pending",
    );
    const rejected = registrationProfileTestDb.addOtherRegistration(
      "rejected",
      TEST_MATCH_ID,
      "Rejected",
    );

    assert.deepEqual(
      registrationProfileTestDb.registrations.map((registration) => registration.status),
      ["approved", "pending", "rejected"],
      "The isolated tournament fixture should contain all registration statuses.",
    );

    await withServer(async (origin) => {
      const response = await fetch(`${origin}/tournaments/${TEST_MATCH_ID}/participants`);
      assert.equal(response.status, 200);
      const payload = await response.json() as {
        tournamentId: string;
        participants: { teamName: string; players: string[]; status: string }[];
      };

      assert.equal(payload.tournamentId, TEST_MATCH_ID);
      assert.deepEqual(payload.participants, [
        {
          teamName: approved.registration.team_name,
          players: [
            approved.registration.captain_game_name,
            ...approved.roster.map((member) => member.member_name),
          ],
          status: "approved",
        },
        {
          teamName: pending.registration.team_name,
          players: [
            pending.registration.captain_game_name,
            ...pending.roster.map((member) => member.member_name),
          ],
          status: "pending",
        },
      ]);
      assert.equal(
        JSON.stringify(payload).includes(rejected.registration.captain_game_name),
        false,
        "Rejected captains must not be exposed by the unauthenticated participant endpoint.",
      );
      assert.equal(
        JSON.stringify(payload).includes(rejected.registration.team_name),
        false,
        "Rejected teams must not be exposed by the unauthenticated participant endpoint.",
      );
    });
  } finally {
    registrationProfileTestDb.reset();
  }
});

test("public tournament participants stop showing a pending team after admin rejection", async () => {
  registrationProfileTestDb.reset(PROFILE_NAME);
  try {
    await withServer(async (origin) => {
      const registered = await sendRegistration(
        origin,
        registrationRequests[0].path,
        registrationRequests[0].body,
      );
      assert.equal(registered.status, 201);
      const pending = registrationProfileTestDb.registrations.find(
        (registration) => registration.captain_user_id === TEST_PLAYER_ID,
      );
      assert.ok(pending, "The pending team should be seeded through the registration route.");
      pending.status = "pending";
      const approved = registrationProfileTestDb.addOtherRegistration(
        "approved",
        TEST_MATCH_ID,
        "Approved",
      );
      assert.equal(pending.entry_coins_paid, 7);
      assert.equal(registrationProfileTestDb.user.wallet_coins, 93);
      assert.equal(registrationProfileTestDb.ledger.length, 1);

      const beforeResponse = await fetch(
        `${origin}/tournaments/${TEST_MATCH_ID}/participants`,
      );
      assert.equal(beforeResponse.status, 200);
      const before = await beforeResponse.json() as {
        tournamentId: string;
        participants: { teamName: string; players: string[]; status: string }[];
      };
      assert.equal(before.tournamentId, TEST_MATCH_ID);
      assert.deepEqual(
        before.participants.map(({ teamName, status }) => ({ teamName, status })),
        [
          { teamName: pending.team_name, status: "pending" },
          { teamName: approved.registration.team_name, status: "approved" },
        ],
      );

      const rejection = await sendAdminRegistrationAction(origin, pending.id, "reject");
      assert.equal(rejection.status, 200);
      assert.deepEqual(rejection.body.data, {
        id: pending.id,
        status: "rejected",
        refunded: true,
      });

      const afterResponse = await fetch(
        `${origin}/tournaments/${TEST_MATCH_ID}/participants`,
      );
      assert.equal(afterResponse.status, 200);
      const after = await afterResponse.json() as {
        tournamentId: string;
        participants: { teamName: string; players: string[]; status: string }[];
      };
      assert.equal(after.tournamentId, TEST_MATCH_ID);
      assert.deepEqual(after.participants, [{
        teamName: approved.registration.team_name,
        players: [
          approved.registration.captain_game_name,
          ...approved.roster.map((member) => member.member_name),
        ],
        status: "approved",
      }]);

      assert.equal(pending.status, "rejected");
      assert.equal(registrationProfileTestDb.user.wallet_coins, 100);
      assert.equal(registrationProfileTestDb.ledger.length, 2);
      assert.deepEqual(registrationProfileTestDb.ledger.at(-1), {
        user_id: TEST_PLAYER_ID,
        amount: 7,
        balance_after: 100,
        reason: "registration_refund",
        match_id: TEST_MATCH_ID,
        registration_id: pending.id,
      });
    });
  } finally {
    registrationProfileTestDb.reset();
  }
});

test("public participant with no saved teammates still contains its captain once", async () => {
  registrationProfileTestDb.reset();
  try {
    const captainOnly = registrationProfileTestDb.addOtherRegistration(
      "approved",
      TEST_MATCH_ID,
      "Rosterless",
      false,
    );

    assert.deepEqual(captainOnly.roster, []);
    assert.equal(
      registrationProfileTestDb.roster.some(
        (member) => member.registration_id === captainOnly.registration.id,
      ),
      false,
      "The isolated fixture must not save teammate rows for this registration.",
    );

    await withServer(async (origin) => {
      const response = await fetch(`${origin}/tournaments/${TEST_MATCH_ID}/participants`);
      assert.equal(response.status, 200);
      const payload = await response.json() as {
        tournamentId: string;
        participants: { teamName: string | null; players: unknown[]; status: string }[];
      };

      assert.equal(payload.tournamentId, TEST_MATCH_ID);
      assert.deepEqual(payload.participants, [
        {
          teamName: captainOnly.registration.team_name,
          players: [captainOnly.registration.captain_game_name],
          status: "approved",
        },
      ]);

      const players = payload.participants[0].players;
      assert.equal(players.length, 1, "The captain should appear exactly once.");
      assert.equal(players[0], captainOnly.registration.captain_game_name);
      assert.equal(players.includes(captainOnly.registration.captain_game_uid), false);
      assert.equal(players.some((player) => player === null), false);
    });
  } finally {
    registrationProfileTestDb.reset();
  }
});

test("tournament slot counts include rosterless active teams once and exclude rejected teams", async () => {
  registrationProfileTestDb.reset();
  try {
    const rosterlessApproved = registrationProfileTestDb.addOtherRegistration(
      "approved",
      TEST_MATCH_ID,
      "Rosterless",
      false,
    );
    const pending = registrationProfileTestDb.addOtherRegistration(
      "pending",
      TEST_MATCH_ID,
      "Pending",
    );
    const rejected = registrationProfileTestDb.addOtherRegistration(
      "rejected",
      TEST_MATCH_ID,
      "Rejected",
    );

    assert.deepEqual(rosterlessApproved.roster, []);
    assert.ok(
      registrationProfileTestDb.roster.every(
        (member) => member.registration_id !== rosterlessApproved.registration.id,
      ),
      "The approved team must have no saved teammate rows.",
    );

    await withServer(async (origin) => {
      const [summaryResponse, participantsResponse] = await Promise.all([
        fetch(`${origin}/tournaments/${TEST_MATCH_ID}`),
        fetch(`${origin}/tournaments/${TEST_MATCH_ID}/participants`),
      ]);
      assert.equal(summaryResponse.status, 200);
      assert.equal(participantsResponse.status, 200);

      const summary = await summaryResponse.json() as {
        filledSlots: number;
        availableSlots: number;
      };
      const participantPayload = await participantsResponse.json() as {
        participants: { teamName: string; status: string }[];
      };
      const visibleTeams = participantPayload.participants;

      assert.equal(visibleTeams.length, 2);
      assert.equal(summary.filledSlots, visibleTeams.length);
      assert.equal(summary.filledSlots, 2);
      assert.equal(summary.availableSlots, registrationProfileTestDb.match.capacity - 2);
      assert.deepEqual(
        visibleTeams.map(({ teamName, status }) => ({ teamName, status })),
        [
          { teamName: rosterlessApproved.registration.team_name, status: "approved" },
          { teamName: pending.registration.team_name, status: "pending" },
        ],
      );
      assert.equal(
        visibleTeams.filter(({ teamName }) => teamName === rosterlessApproved.registration.team_name).length,
        1,
        "The rosterless approved team must count exactly once.",
      );
      assert.equal(
        visibleTeams.some(({ teamName }) => teamName === rejected.registration.team_name),
        false,
        "Rejected registrations must not appear in participant totals.",
      );
    });
  } finally {
    registrationProfileTestDb.reset();
  }
});

test("public participants show only saved teammates in roster order for a partial roster", async () => {
  registrationProfileTestDb.reset();
  try {
    const partial = registrationProfileTestDb.addOtherRegistration(
      "pending",
      TEST_MATCH_ID,
      "Partial",
    );
    const savedRosterRows = partial.roster.filter((member) => member.position !== 2);
    registrationProfileTestDb.roster = savedRosterRows.toReversed();

    assert.deepEqual(
      registrationProfileTestDb.roster.map(({ position }) => position),
      [3, 1],
      "The fixture should save only a subset of teammates, inserted out of roster order.",
    );

    await withServer(async (origin) => {
      const response = await fetch(`${origin}/tournaments/${TEST_MATCH_ID}/participants`);
      assert.equal(response.status, 200);
      const payload = await response.json() as {
        tournamentId: string;
        participants: { teamName: string | null; players: unknown[]; status: string }[];
      };

      assert.equal(payload.tournamentId, TEST_MATCH_ID);
      assert.deepEqual(payload.participants, [{
        teamName: partial.registration.team_name,
        players: [
          partial.registration.captain_game_name,
          partial.roster[0].member_name,
          partial.roster[2].member_name,
        ],
        status: "pending",
      }]);

      const players = payload.participants[0].players;
      assert.equal(players.filter((player) => player === partial.registration.captain_game_name).length, 1);
      assert.equal(players.includes(partial.registration.captain_game_uid), false);
      for (const member of partial.roster) {
        assert.equal(players.includes(member.member_uid), false, "Teammate UIDs must remain private.");
      }
      assert.equal(players.includes(partial.roster[1].member_name), false, "Unsaved teammate names must not be invented.");
      assert.equal(players.some((player) => player === null), false);
    });
  } finally {
    registrationProfileTestDb.reset();
  }
});

type RegistrationRequest = {
  label: string;
  path: string;
  body: Record<string, unknown>;
};

const registrationRequests: RegistrationRequest[] = [
  {
    label: "v2",
    path: `/daily007/v2/matches/${TEST_MATCH_ID}/register`,
    body: {
      captainName: "Forged Client Name",
      captainGameName: CAPTAIN_GAME_NAME,
      captainGameUid: CAPTAIN_GAME_UID,
      teamName: TEAM_NAME,
      teammates: [
        { name: TEAMMATE_NAME, uid: TEAMMATE_UID },
        { name: TEAMMATE_TWO_NAME, uid: TEAMMATE_TWO_UID },
        { name: TEAMMATE_THREE_NAME, uid: TEAMMATE_THREE_UID },
      ],
    },
  },
  {
    label: "legacy",
    path: `/tournaments/${TEST_MATCH_ID}/join`,
    body: {
      playerName: "Forged Legacy Name",
      captainGameName: CAPTAIN_GAME_NAME,
      gameUid: CAPTAIN_GAME_UID,
      teamName: TEAM_NAME,
      teamMembers: JSON.stringify([
        { name: CAPTAIN_GAME_NAME, uid: CAPTAIN_GAME_UID },
        { name: TEAMMATE_NAME, uid: TEAMMATE_UID },
        { name: TEAMMATE_TWO_NAME, uid: TEAMMATE_TWO_UID },
        { name: TEAMMATE_THREE_NAME, uid: TEAMMATE_THREE_UID },
      ]),
    },
  },
];

async function withServer(run: (origin: string) => Promise<void>): Promise<void> {
  const app = express();
  app.use(express.json());
  app.use(daily007V2Router);
  app.use(daily007CompatCoreRouter);
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
  path: string,
  body: Record<string, unknown>,
  providedToken?: string,
): Promise<{ status: number; body: Record<string, unknown> }> {
  const token = providedToken ?? makeToken(TEST_PLAYER_ID, 0);
  assert.ok(token, "test account should receive a Daily007 session token");
  const response = await fetch(`${origin}${path}`, {
    method: "POST",
    headers: {
      authorization: `Bearer ${token}`,
      "content-type": "application/json",
    },
    body: JSON.stringify(body),
  });
  return {
    status: response.status,
    body: await response.json() as Record<string, unknown>,
  };
}

async function sendTeamEdit(
  origin: string,
  registrationId: string,
  body: Record<string, unknown>,
  providedToken?: string,
): Promise<{ status: number; body: Record<string, unknown> }> {
  const token = providedToken ?? makeToken(TEST_PLAYER_ID, 0);
  assert.ok(token, "test account should receive a Daily007 session token");
  const response = await fetch(`${origin}/my/registrations/${registrationId}/team`, {
    method: "PATCH",
    headers: {
      authorization: `Bearer ${token}`,
      "content-type": "application/json",
    },
    body: JSON.stringify(body),
  });
  return {
    status: response.status,
    body: await response.json().catch(() => ({})) as Record<string, unknown>,
  };
}

async function sendAdminRegistrationAction(
  origin: string,
  registrationId: string,
  action: "approve" | "reject",
): Promise<{ status: number; body: Record<string, unknown> }> {
  const token = makeToken(TEST_TOURNAMENT_ADMIN_ID, 0);
  assert.ok(token, "test tournament admin should receive a Daily007 session token");
  const response = await fetch(`${origin}/admin/registrations/${registrationId}/${action}`, {
    method: "POST",
    headers: { authorization: `Bearer ${token}` },
  });
  return {
    status: response.status,
    body: await response.json().catch(() => ({})) as Record<string, unknown>,
  };
}

test("blocked player cannot register or edit an approved team with a previously valid session", async () => {
  registrationProfileTestDb.reset(PROFILE_NAME);
  try {
    const sessionToken = makeToken(TEST_PLAYER_ID, 0);
    assert.ok(sessionToken, "test account should receive a Daily007 session token");

    await withServer(async (origin) => {
      const initialRegistration = await sendRegistration(
        origin,
        registrationRequests[0].path,
        registrationRequests[0].body,
        sessionToken,
      );
      assert.equal(initialRegistration.status, 201);
      const approvedRegistration = registrationProfileTestDb.registrations.find(
        (registration) => registration.captain_user_id === TEST_PLAYER_ID,
      );
      assert.ok(approvedRegistration, "The player should have an approved registration before being blocked.");
      assert.equal(approvedRegistration.status, "approved");

      const captureRegistrationAndWalletState = () => ({
        registrations: structuredClone(registrationProfileTestDb.registrations),
        roster: structuredClone(registrationProfileTestDb.roster),
        ledger: structuredClone(registrationProfileTestDb.ledger),
        walletCoins: registrationProfileTestDb.user.wallet_coins,
        match: structuredClone(registrationProfileTestDb.match),
        connectCount: registrationProfileTestDb.connectCount,
      });
      const stateBeforeBlockedRequests = captureRegistrationAndWalletState();
      registrationProfileTestDb.user.status = "blocked";

      const teamEditBody = {
        captainGameName: "BlockedEditCaptain",
        captainGameUid: "FF-BLOCKED-EDIT-CAPTAIN",
        teamName: "Blocked Edit Squad",
        teammates: [
          { name: "BlockedEditMateOne", uid: "FF-BLOCKED-EDIT-ONE" },
          { name: "BlockedEditMateTwo", uid: "FF-BLOCKED-EDIT-TWO" },
          { name: "BlockedEditMateThree", uid: "FF-BLOCKED-EDIT-THREE" },
        ],
      };
      const blockedAttempts = [
        ...registrationRequests.map((request) => ({
          label: `${request.label} registration`,
          send: () => sendRegistration(origin, request.path, request.body, sessionToken),
        })),
        {
          label: "team edit",
          send: () => sendTeamEdit(
            origin,
            approvedRegistration.id,
            teamEditBody,
            sessionToken,
          ),
        },
      ];

      for (const attempt of blockedAttempts) {
        const response = await attempt.send();
        assert.equal(response.status, 403, `${attempt.label} should reject the blocked account.`);
        assert.deepEqual(response.body, { error: "This account is blocked." });
        assert.deepEqual(
          captureRegistrationAndWalletState(),
          stateBeforeBlockedRequests,
          `${attempt.label} must not change registration, roster, or wallet state.`,
        );
        assert.equal(registrationProfileTestDb.user.status, "blocked");
      }
    });
  } finally {
    registrationProfileTestDb.reset();
  }
});

async function getWithToken(origin: string, path: string, token: string): Promise<Response> {
  return fetch(`${origin}${path}`, {
    headers: { authorization: `Bearer ${token}` },
  });
}

function parseCsvRow(line: string): string[] {
  return [...line.matchAll(/"((?:[^"]|"")*)"(?:,|$)/g)]
    .map(([, value]) => value.replaceAll('""', '"'));
}

function parseCsvDocument(input: string): string[][] {
  const records: string[][] = [];
  let record: string[] = [];
  let value = "";
  let insideQuotes = false;

  for (let index = 0; index < input.length; index += 1) {
    const character = input[index];
    if (insideQuotes) {
      if (character === '"') {
        if (input[index + 1] === '"') {
          value += '"';
          index += 1;
        } else {
          insideQuotes = false;
        }
      } else {
        value += character;
      }
      continue;
    }

    if (character === '"') {
      insideQuotes = true;
    } else if (character === ",") {
      record.push(value);
      value = "";
    } else if (character === "\r" || character === "\n") {
      if (character === "\r" && input[index + 1] === "\n") index += 1;
      record.push(value);
      records.push(record);
      record = [];
      value = "";
    } else {
      value += character;
    }
  }

  if (insideQuotes) throw new Error("CSV ended inside a quoted cell.");
  if (record.length > 0 || value.length > 0) {
    record.push(value);
    records.push(record);
  }
  return records;
}

for (const request of registrationRequests) {
  test(`${request.label} registration views preserve separate profile, Free Fire, team, and roster details`, async () => {
    registrationProfileTestDb.reset(` ${PROFILE_NAME} `);
    try {
      await withServer(async (origin) => {
        const response = await sendRegistration(origin, request.path, request.body);
        assert.equal(response.status, 201);

      const registration = registrationProfileTestDb.registrations[0];
        assert.deepEqual(
          {
            captain_name: registration.captain_name,
            captain_game_name: registration.captain_game_name,
            captain_game_uid: registration.captain_game_uid,
            team_name: registration.team_name,
          },
          {
            captain_name: PROFILE_NAME,
            captain_game_name: CAPTAIN_GAME_NAME,
            captain_game_uid: CAPTAIN_GAME_UID,
            team_name: TEAM_NAME,
          },
        );
        assert.deepEqual(
          registrationProfileTestDb.roster.map((member) => ({
            registration_id: member.registration_id,
            position: member.position,
            member_uid: member.member_uid,
            member_name: member.member_name,
          })),
          [
            {
              registration_id: registration.id,
              position: 1,
              member_uid: TEAMMATE_UID,
              member_name: TEAMMATE_NAME,
            },
            {
              registration_id: registration.id,
              position: 2,
              member_uid: TEAMMATE_TWO_UID,
              member_name: TEAMMATE_TWO_NAME,
            },
            {
              registration_id: registration.id,
              position: 3,
              member_uid: TEAMMATE_THREE_UID,
              member_name: TEAMMATE_THREE_NAME,
            },
          ],
        );
        assert.equal(registrationProfileTestDb.user.wallet_coins, 93);
        assert.equal(registrationProfileTestDb.ledger.length, 1);
        assert.equal(registrationProfileTestDb.connectCount, 1);

        const playerToken = makeToken(TEST_PLAYER_ID, 0);
        assert.ok(playerToken);
        const playerRegistrationsResponse = await getWithToken(
          origin,
          "/my/registrations",
          playerToken,
        );
        assert.equal(playerRegistrationsResponse.status, 200);
        const playerRegistrations = await playerRegistrationsResponse.json() as {
          playerName: string;
          captainGameName: string;
          gameUid: string;
          teamName: string;
          teamMembers: string;
        }[];
        assert.equal(playerRegistrations.length, 1);
        assert.deepEqual(
          {
            playerName: playerRegistrations[0].playerName,
            captainGameName: playerRegistrations[0].captainGameName,
            gameUid: playerRegistrations[0].gameUid,
            teamName: playerRegistrations[0].teamName,
            teamMembers: JSON.parse(playerRegistrations[0].teamMembers).map(
              (member: { name: string; uid: string }) => ({
                name: member.name,
                uid: member.uid,
              }),
            ),
          },
          {
            playerName: PROFILE_NAME,
            captainGameName: CAPTAIN_GAME_NAME,
            gameUid: CAPTAIN_GAME_UID,
            teamName: TEAM_NAME,
            teamMembers: [
              { name: CAPTAIN_GAME_NAME, uid: CAPTAIN_GAME_UID },
              { name: TEAMMATE_NAME, uid: TEAMMATE_UID },
              { name: TEAMMATE_TWO_NAME, uid: TEAMMATE_TWO_UID },
              { name: TEAMMATE_THREE_NAME, uid: TEAMMATE_THREE_UID },
            ],
          },
        );

        const participantsResponse = await fetch(
          `${origin}/tournaments/${TEST_MATCH_ID}/participants`,
        );
        assert.equal(participantsResponse.status, 200);
        const participants = await participantsResponse.json() as {
          tournamentId: string;
          participants: { teamName: string; players: string[]; status: string }[];
        };

        assert.equal(participants.tournamentId, TEST_MATCH_ID);
        assert.deepEqual(participants.participants, [{
          teamName: TEAM_NAME,
          players: [
            CAPTAIN_GAME_NAME,
            TEAMMATE_NAME,
            TEAMMATE_TWO_NAME,
            TEAMMATE_THREE_NAME,
          ],
          status: "approved",
        }]);
        assert.equal(JSON.stringify(participants).includes(PROFILE_NAME), false);
        assert.equal(JSON.stringify(participants).includes(CAPTAIN_GAME_UID), false);
        assert.equal(JSON.stringify(participants).includes(TEAMMATE_UID), false);

      const adminToken = makeToken(TEST_TOURNAMENT_ADMIN_ID, 0);
      assert.ok(adminToken);
      const csvResponse = await getWithToken(
        origin,
        `/daily007/v2/admin/matches/${TEST_MATCH_ID}/registrations.csv`,
        adminToken,
      );
      assert.equal(csvResponse.status, 200);

      const csvLines = (await csvResponse.text()).trimEnd().split(/\r?\n/);

        assert.deepEqual(parseCsvRow(csvLines[0]), [
          "captain_profile_name",
          "captain_game_name",
          "captain_game_uid",
          "captain_email",
          "team_name",
          "teammate_1_name",
          "teammate_1_game_uid",
          "teammate_2_name",
          "teammate_2_game_uid",
          "teammate_3_name",
          "teammate_3_game_uid",
          "registered_at",
        ]);
        const csvRow = parseCsvRow(csvLines[1]);

        assert.deepEqual(csvRow.slice(0, -1), [
          PROFILE_NAME,
          CAPTAIN_GAME_NAME,
          CAPTAIN_GAME_UID,
          "captain-profile-test@example.test",
          TEAM_NAME,
          TEAMMATE_NAME,
          TEAMMATE_UID,
          TEAMMATE_TWO_NAME,
          TEAMMATE_TWO_UID,
          TEAMMATE_THREE_NAME,
          TEAMMATE_THREE_UID,
        ]);
        assert.ok(Number.isFinite(Date.parse(csvRow[11])));
      });
    } finally {
      registrationProfileTestDb.reset();
    }
  });
}

test("only tournament admins can download registration CSV rows", async () => {
  registrationProfileTestDb.reset();
  const seeded = registrationProfileTestDb.addOtherRegistration(
    "approved",
    TEST_MATCH_ID,
    "ExportPrivacy",
  );
  const path = `/daily007/v2/admin/matches/${TEST_MATCH_ID}/registrations.csv`;
  const rowSentinels = [
    seeded.registration.captain_name,
    seeded.registration.captain_game_name,
    seeded.registration.captain_game_uid,
    seeded.registration.team_name,
    "exportprivacy-captain-profile-test@example.test",
    ...seeded.roster.flatMap((member) =>
      [member.member_name, member.member_uid].filter((value): value is string => Boolean(value))
    ),
  ];

  try {
    await withServer(async (origin) => {
      const tournamentAdminToken = makeToken(TEST_TOURNAMENT_ADMIN_ID, 0);
      const playerToken = makeToken(TEST_PLAYER_ID, 0);
      assert.ok(tournamentAdminToken);
      assert.ok(playerToken);

      const adminResponse = await getWithToken(origin, path, tournamentAdminToken);
      assert.equal(adminResponse.status, 200);
      assert.equal(adminResponse.headers.get("cache-control"), "no-store");
      assert.match(adminResponse.headers.get("content-type") ?? "", /^text\/csv\b/);
      assert.equal(
        adminResponse.headers.get("content-disposition"),
        `attachment; filename="daily007-${TEST_MATCH_ID}-registrations.csv"`,
      );
      const adminRows = parseCsvDocument(await adminResponse.text());
      assert.equal(adminRows.length, 2, "The authorized CSV should contain its header and registration row.");
      assert.equal(adminRows[1][2], seeded.registration.captain_game_uid);
      assert.equal(adminRows[1][3], "exportprivacy-captain-profile-test@example.test");

      const playerResponse = await getWithToken(origin, path, playerToken);
      const unauthenticatedResponse = await fetch(`${origin}${path}`);
      const deniedResponses = [
        {
          label: "ordinary player",
          response: playerResponse,
          status: 403,
          error: "Tournament administrator access is required.",
        },
        {
          label: "unauthenticated request",
          response: unauthenticatedResponse,
          status: 401,
          error: "A valid Daily007 v2 bearer token is required.",
        },
      ];

      for (const denied of deniedResponses) {
        const body = await denied.response.text();
        assert.equal(denied.response.status, denied.status, `${denied.label} must be denied.`);
        assert.match(
          denied.response.headers.get("content-type") ?? "",
          /^application\/json\b/,
          `${denied.label} must receive an authorization error, not a CSV response.`,
        );
        assert.deepEqual(JSON.parse(body), { error: denied.error });
        assert.equal(body.includes("captain_profile_name"), false);
        for (const sentinel of rowSentinels) {
          assert.equal(body.includes(sentinel), false, `${denied.label} must not receive registration data.`);
        }
      }
    });
  } finally {
    registrationProfileTestDb.reset();
  }
});

test("admin registration CSV exports every approved row and excludes pending signups", async () => {
  registrationProfileTestDb.reset();
  const approvedEntries = [
    registrationProfileTestDb.addOtherRegistration("approved", TEST_MATCH_ID, "ApprovedExport"),
    registrationProfileTestDb.addOtherRegistration("approved", TEST_MATCH_ID, "SecondApprovedExport"),
  ];
  const pendingEntry = registrationProfileTestDb.addOtherRegistration(
    "pending",
    TEST_MATCH_ID,
    "PendingExport",
  );
  const path = `/daily007/v2/admin/matches/${TEST_MATCH_ID}/registrations.csv`;
  const expectedApprovedRows = approvedEntries.map(({ registration, roster }) => {
    const emailPrefix = registration.captain_name.split(" ")[0].toLowerCase();
    return [
      registration.captain_name,
      registration.captain_game_name,
      registration.captain_game_uid,
      `${emailPrefix}-captain-profile-test@example.test`,
      registration.team_name,
      ...roster.flatMap((member) => [member.member_name, member.member_uid ?? ""]),
    ];
  }).sort((left, right) => String(left[2]).localeCompare(String(right[2])));
  const pendingSentinels = [
    pendingEntry.registration.captain_name,
    pendingEntry.registration.captain_game_name,
    pendingEntry.registration.captain_game_uid,
    pendingEntry.registration.team_name,
    "pendingexport-captain-profile-test@example.test",
    ...pendingEntry.roster.flatMap((member) =>
      [member.member_name, member.member_uid].filter((value): value is string => Boolean(value))
    ),
  ];

  try {
    await withServer(async (origin) => {
      const adminToken = makeToken(TEST_TOURNAMENT_ADMIN_ID, 0);
      assert.ok(adminToken);
      const response = await getWithToken(origin, path, adminToken);
      assert.equal(response.status, 200);

      const csv = await response.text();
      const rows = parseCsvDocument(csv);
      assert.equal(rows.length, approvedEntries.length + 1, "Only the header and approved rows should be exported.");
      assert.equal(rows[0][0], "captain_profile_name");
      assert.equal(rows[0][3], "captain_email");
      const exportedRegistrationDetails = rows
        .slice(1)
        .map((row) => row.slice(0, -1))
        .sort((left, right) => String(left[2]).localeCompare(String(right[2])));
      assert.deepEqual(exportedRegistrationDetails, expectedApprovedRows);
      for (const sentinel of pendingSentinels) {
        assert.equal(csv.includes(sentinel), false, "Pending registration details must not appear in the CSV.");
      }
    });
  } finally {
    registrationProfileTestDb.reset();
  }
});

const shortRosterFormats: {
  label: string;
  teamType: string;
  teamName: string;
  teammates: { name: string; uid: string }[];
}[] = [
  { label: "Solo", teamType: "solo", teamName: "", teammates: [] },
  {
    label: "Duo",
    teamType: "duo",
    teamName: TEAM_NAME,
    teammates: [{ name: TEAMMATE_NAME, uid: TEAMMATE_UID }],
  },
];

for (const format of shortRosterFormats) {
  test(`admin registration CSV keeps ${format.label} columns aligned`, async () => {
    registrationProfileTestDb.reset(PROFILE_NAME);
    registrationProfileTestDb.match.team_type = format.teamType;
    try {
      await withServer(async (origin) => {
        const response = await sendRegistration(origin, registrationRequests[0].path, {
          ...registrationRequests[0].body,
          teamName: format.teamName,
          teammates: format.teammates,
        });
        assert.equal(response.status, 201);

        const registration = registrationProfileTestDb.registrations[0];
        assert.ok(registration);
        assert.equal(registrationProfileTestDb.roster.length, format.teammates.length);

        const adminToken = makeToken(TEST_TOURNAMENT_ADMIN_ID, 0);
        assert.ok(adminToken);
        const csvResponse = await getWithToken(
          origin,
          `/daily007/v2/admin/matches/${TEST_MATCH_ID}/registrations.csv`,
          adminToken,
        );
        assert.equal(csvResponse.status, 200);

        const records = parseCsvDocument(await csvResponse.text());
        assert.equal(records.length, 2);
        const [headers, values] = records;
        assert.ok(headers);
        assert.ok(values);
        assert.deepEqual(headers, [
          "captain_profile_name",
          "captain_game_name",
          "captain_game_uid",
          "captain_email",
          "team_name",
          "teammate_1_name",
          "teammate_1_game_uid",
          "teammate_2_name",
          "teammate_2_game_uid",
          "teammate_3_name",
          "teammate_3_game_uid",
          "registered_at",
        ]);
        assert.equal(values.length, headers.length);

        const teammateCells = Array.from({ length: 3 }, (_, index) => {
          const teammate = format.teammates[index];
          return [teammate?.name ?? "", teammate?.uid ?? ""];
        }).flat();
        assert.deepEqual(values, [
          registration.captain_name,
          registration.captain_game_name,
          registration.captain_game_uid,
          registrationProfileTestDb.user.email,
          registration.team_name,
          ...teammateCells,
          registration.created_at.toISOString(),
        ]);
        assert.equal(
          values[headers.indexOf("registered_at")],
          registration.created_at.toISOString(),
          "registration time should remain in the final CSV column",
        );
      });
    } finally {
      registrationProfileTestDb.reset();
    }
  });
}

test("admin registration CSV preserves commas and quotes in name columns", async () => {
  registrationProfileTestDb.reset(CSV_PROFILE_NAME);
  const csvRegistrationRequest: RegistrationRequest = {
    ...registrationRequests[0],
    body: {
      ...registrationRequests[0].body,
      captainGameName: CSV_CAPTAIN_GAME_NAME,
      teamName: CSV_TEAM_NAME,
      teammates: CSV_TEAMMATE_NAMES.map((name, index) => ({
        name,
        uid: [TEAMMATE_UID, TEAMMATE_TWO_UID, TEAMMATE_THREE_UID][index],
      })),
    },
  };

  try {
    await withServer(async (origin) => {
      const response = await sendRegistration(
        origin,
        csvRegistrationRequest.path,
        csvRegistrationRequest.body,
      );
      assert.equal(response.status, 201);

      const registration = registrationProfileTestDb.registrations[0];
      const savedRoster = registrationProfileTestDb.roster
        .filter((member) => member.registration_id === registration.id)
        .sort((left, right) => left.position - right.position);

      const adminToken = makeToken(TEST_TOURNAMENT_ADMIN_ID, 0);
      assert.ok(adminToken);
      const csvResponse = await getWithToken(
        origin,
        `/daily007/v2/admin/matches/${TEST_MATCH_ID}/registrations.csv`,
        adminToken,
      );
      assert.equal(csvResponse.status, 200);

      const csvLines = (await csvResponse.text()).trimEnd().split(/\r?\n/);

      assert.equal(csvLines.length, 2);

      const headers = parseCsvRow(csvLines[0]);
      const values = parseCsvRow(csvLines[1]);
      assert.equal(values.length, headers.length);
      const expectedColumns: Record<string, string> = {
        captain_profile_name: registration.captain_name,
        captain_game_name: registration.captain_game_name,
        captain_game_uid: registration.captain_game_uid,
        captain_email: registrationProfileTestDb.user.email,
        team_name: registration.team_name,
        teammate_1_name: savedRoster[0].member_name,
        teammate_1_game_uid: savedRoster[0].member_uid ?? "",
        teammate_2_name: savedRoster[1].member_name,
        teammate_2_game_uid: savedRoster[1].member_uid ?? "",
        teammate_3_name: savedRoster[2].member_name,
        teammate_3_game_uid: savedRoster[2].member_uid ?? "",
      };
      for (const [column, expectedValue] of Object.entries(expectedColumns)) {
        const index = headers.indexOf(column);
        assert.notEqual(index, -1, `CSV header should include ${column}`);
        assert.equal(values[index], expectedValue, `${column} should remain in its own column`);
      }
      const registeredAtIndex = headers.indexOf("registered_at");
      assert.notEqual(registeredAtIndex, -1);
      assert.ok(Number.isFinite(Date.parse(values[registeredAtIndex])));
    });
  } finally {
    registrationProfileTestDb.reset();
  }
});

test("admin registration CSV apostrophe-guards formula-like captain, team, and teammate names", async () => {
  registrationProfileTestDb.reset(FORMULA_PROFILE_NAME);
  const csvRegistrationRequest: RegistrationRequest = {
    ...registrationRequests[0],
    body: {
      ...registrationRequests[0].body,
      captainGameName: FORMULA_CAPTAIN_GAME_NAME,
      teamName: FORMULA_TEAM_NAME,
      teammates: FORMULA_TEAMMATE_NAMES.map((name, index) => ({
        name,
        uid: [TEAMMATE_UID, TEAMMATE_TWO_UID, TEAMMATE_THREE_UID][index],
      })),
    },
  };

  try {
    await withServer(async (origin) => {
      const response = await sendRegistration(
        origin,
        csvRegistrationRequest.path,
        csvRegistrationRequest.body,
      );
      assert.equal(response.status, 201);

      const adminToken = makeToken(TEST_TOURNAMENT_ADMIN_ID, 0);
      assert.ok(adminToken);
      const csvResponse = await getWithToken(
        origin,
        `/daily007/v2/admin/matches/${TEST_MATCH_ID}/registrations.csv`,
        adminToken,
      );
      assert.equal(csvResponse.status, 200);

      const csvLines = (await csvResponse.text()).trimEnd().split(/\r?\n/);
      assert.equal(csvLines.length, 2);
      const headers = parseCsvRow(csvLines[0]);
      const values = parseCsvRow(csvLines[1]);
      assert.equal(values.length, headers.length);

      const expectedFormulaCells: Record<string, string> = {
        captain_profile_name: FORMULA_PROFILE_NAME,
        captain_game_name: FORMULA_CAPTAIN_GAME_NAME,
        team_name: FORMULA_TEAM_NAME,
        teammate_1_name: FORMULA_TEAMMATE_NAMES[0],
        teammate_2_name: FORMULA_TEAMMATE_NAMES[1],
        teammate_3_name: FORMULA_TEAMMATE_NAMES[2],
      };
      for (const [column, formulaValue] of Object.entries(expectedFormulaCells)) {
        const index = headers.indexOf(column);
        assert.notEqual(index, -1, `CSV header should include ${column}`);
        assert.equal(
          values[index],
          `'${formulaValue}`,
          `${column} should retain the apostrophe guard before its formula marker`,
        );
      }
    });
  } finally {
    registrationProfileTestDb.reset();
  }
});

test("admin registration CSV apostrophe-guards full-width formula starters in names", async () => {
  registrationProfileTestDb.reset();
  try {
    registrationProfileTestDb.addOtherRegistration("approved");
    const registration = registrationProfileTestDb.registrations[0];
    assert.ok(registration);
    registration.captain_name = FULLWIDTH_FORMULA_PROFILE_NAME;
    registration.captain_game_name = FULLWIDTH_FORMULA_CAPTAIN_GAME_NAME;
    registration.team_name = FULLWIDTH_FORMULA_TEAM_NAME;
    registrationProfileTestDb.roster.forEach((member, index) => {
      member.member_name = FULLWIDTH_FORMULA_TEAMMATE_NAMES[index];
    });

    await withServer(async (origin) => {
      const adminToken = makeToken(TEST_TOURNAMENT_ADMIN_ID, 0);
      assert.ok(adminToken);
      const csvResponse = await getWithToken(
        origin,
        `/daily007/v2/admin/matches/${TEST_MATCH_ID}/registrations.csv`,
        adminToken,
      );
      assert.equal(csvResponse.status, 200);

      const records = parseCsvDocument(await csvResponse.text());
      assert.equal(records.length, 2);
      const [headers, values] = records;
      assert.ok(headers);
      assert.ok(values);
      assert.equal(values.length, headers.length);

      const expectedFormulaCells: Record<string, string> = {
        captain_profile_name: FULLWIDTH_FORMULA_PROFILE_NAME,
        captain_game_name: FULLWIDTH_FORMULA_CAPTAIN_GAME_NAME,
        team_name: FULLWIDTH_FORMULA_TEAM_NAME,
        teammate_1_name: FULLWIDTH_FORMULA_TEAMMATE_NAMES[0],
        teammate_2_name: FULLWIDTH_FORMULA_TEAMMATE_NAMES[1],
        teammate_3_name: FULLWIDTH_FORMULA_TEAMMATE_NAMES[2],
      };
      for (const [column, formulaValue] of Object.entries(expectedFormulaCells)) {
        const index = headers.indexOf(column);
        assert.notEqual(index, -1, `CSV header should include ${column}`);
        assert.equal(
          values[index],
          `'${formulaValue}`,
          `${column} should preserve the exact full-width formula prefix after the apostrophe`,
        );
      }
    });
  } finally {
    registrationProfileTestDb.reset();
  }
});

test("admin registration CSV apostrophe-guards captain and teammate UIDs and captain email", async () => {
  registrationProfileTestDb.reset();
  registrationProfileTestDb.user.email = FORMULA_CAPTAIN_EMAIL;
  const csvRegistrationRequest: RegistrationRequest = {
    ...registrationRequests[0],
    body: {
      ...registrationRequests[0].body,
      captainGameUid: FORMULA_CAPTAIN_GAME_UID,
      teammates: FORMULA_TEAMMATE_NAMES.map((name, index) => ({
        name,
        uid: FORMULA_TEAMMATE_GAME_UIDS[index],
      })),
    },
  };

  try {
    await withServer(async (origin) => {
      const response = await sendRegistration(
        origin,
        csvRegistrationRequest.path,
        csvRegistrationRequest.body,
      );
      assert.equal(response.status, 201);

      const adminToken = makeToken(TEST_TOURNAMENT_ADMIN_ID, 0);
      assert.ok(adminToken);
      const csvResponse = await getWithToken(
        origin,
        `/daily007/v2/admin/matches/${TEST_MATCH_ID}/registrations.csv`,
        adminToken,
      );
      assert.equal(csvResponse.status, 200);

      const records = parseCsvDocument(await csvResponse.text());
      assert.equal(records.length, 2);
      const [headers, values] = records;
      assert.ok(headers);
      assert.ok(values);
      assert.equal(values.length, headers.length);

      const expectedFormulaCells: Record<string, string> = {
        captain_game_uid: FORMULA_CAPTAIN_GAME_UID,
        captain_email: FORMULA_CAPTAIN_EMAIL,
        teammate_1_game_uid: FORMULA_TEAMMATE_GAME_UIDS[0],
        teammate_2_game_uid: FORMULA_TEAMMATE_GAME_UIDS[1],
        teammate_3_game_uid: FORMULA_TEAMMATE_GAME_UIDS[2],
      };
      for (const [column, formulaValue] of Object.entries(expectedFormulaCells)) {
        const index = headers.indexOf(column);
        assert.notEqual(index, -1, `CSV header should include ${column}`);
        assert.equal(
          values[index],
          `'${formulaValue}`,
          `${column} should retain the apostrophe guard before its formula marker`,
        );
      }
    });
  } finally {
    registrationProfileTestDb.reset();
  }
});

test("admin registration CSV apostrophe-guards formulas after Unicode whitespace and invisible characters", async () => {
  registrationProfileTestDb.reset();
  try {
    await withServer(async (origin) => {
      const response = await sendRegistration(
        origin,
        registrationRequests[0].path,
        registrationRequests[0].body,
      );
      assert.equal(response.status, 201);

      const registration = registrationProfileTestDb.registrations[0];
      assert.ok(registration);
      registrationProfileTestDb.user.email = HIDDEN_PREFIX_CAPTAIN_EMAIL;
      registrationProfileTestDb.user.name = HIDDEN_PREFIX_PROFILE_NAME;
      registration.captain_name = HIDDEN_PREFIX_PROFILE_NAME;
      registration.captain_game_name = HIDDEN_PREFIX_CAPTAIN_GAME_NAME;
      registration.captain_game_uid = HIDDEN_PREFIX_CAPTAIN_GAME_UID;
      registration.team_name = HIDDEN_PREFIX_TEAM_NAME;
      const savedRoster = registrationProfileTestDb.roster
        .filter((member) => member.registration_id === registration.id)
        .sort((left, right) => left.position - right.position);
      assert.equal(savedRoster.length, HIDDEN_PREFIX_TEAMMATE_NAMES.length);
      savedRoster.forEach((member, index) => {
        member.member_name = HIDDEN_PREFIX_TEAMMATE_NAMES[index];
        member.member_uid = HIDDEN_PREFIX_TEAMMATE_GAME_UIDS[index];
      });

      const adminToken = makeToken(TEST_TOURNAMENT_ADMIN_ID, 0);
      assert.ok(adminToken);
      const csvResponse = await getWithToken(
        origin,
        `/daily007/v2/admin/matches/${TEST_MATCH_ID}/registrations.csv`,
        adminToken,
      );
      assert.equal(csvResponse.status, 200);

      const csvText = await csvResponse.text();
      const records = parseCsvDocument(csvText);
      const csvLines = csvText.trimEnd().split(/\r?\n/);
      assert.equal(csvLines.length, 2);
      assert.equal(records.length, 2);
      const [headers, values] = records;
      assert.ok(headers);
      assert.ok(values);
      assert.equal(values.length, headers.length);
      const dataLine = csvLines[1];
      assert.ok(dataLine);

      const expectedFormulaCells: Record<string, string> = {
        captain_profile_name: HIDDEN_PREFIX_PROFILE_NAME,
        captain_game_name: HIDDEN_PREFIX_CAPTAIN_GAME_NAME,
        captain_game_uid: HIDDEN_PREFIX_CAPTAIN_GAME_UID,
        captain_email: HIDDEN_PREFIX_CAPTAIN_EMAIL,
        team_name: HIDDEN_PREFIX_TEAM_NAME,
        teammate_1_name: HIDDEN_PREFIX_TEAMMATE_NAMES[0],
        teammate_1_game_uid: HIDDEN_PREFIX_TEAMMATE_GAME_UIDS[0],
        teammate_2_name: HIDDEN_PREFIX_TEAMMATE_NAMES[1],
        teammate_2_game_uid: HIDDEN_PREFIX_TEAMMATE_GAME_UIDS[1],
        teammate_3_name: HIDDEN_PREFIX_TEAMMATE_NAMES[2],
        teammate_3_game_uid: HIDDEN_PREFIX_TEAMMATE_GAME_UIDS[2],
      };
      for (const [column, formulaValue] of Object.entries(expectedFormulaCells)) {
        const index = headers.indexOf(column);
        assert.notEqual(index, -1, `CSV header should include ${column}`);
        assert.equal(
          values[index],
          `'${formulaValue}`,
          `${column} should retain the apostrophe before its original prefix and formula marker`,
        );
        assert.ok(
          dataLine.includes(`"'${formulaValue.replaceAll('"', '""')}"`),
          `${column} should remain a correctly quoted CSV cell`,
        );
      }
    });
  } finally {
    registrationProfileTestDb.reset();
  }
});

test("admin registration CSV keeps embedded CR/LF in saved names within one record", async () => {
  registrationProfileTestDb.reset(MULTILINE_PROFILE_NAME);
  const teammates = MULTILINE_TEAMMATE_NAMES.map((name, index) => ({
    name,
    uid: [TEAMMATE_UID, TEAMMATE_TWO_UID, TEAMMATE_THREE_UID][index],
  }));
  const csvRegistrationRequest: RegistrationRequest = {
    ...registrationRequests[0],
    body: {
      ...registrationRequests[0].body,
      captainGameName: MULTILINE_CAPTAIN_GAME_NAME,
      teamName: MULTILINE_TEAM_NAME,
      teammates,
    },
  };

  try {
    await withServer(async (origin) => {
      const response = await sendRegistration(
        origin,
        csvRegistrationRequest.path,
        csvRegistrationRequest.body,
      );
      assert.equal(response.status, 201);

      const registration = registrationProfileTestDb.registrations[0];
      assert.ok(registration);
      const savedRoster = registrationProfileTestDb.roster
        .filter((member) => member.registration_id === registration.id)
        .sort((left, right) => left.position - right.position);
      const laterRegistration = registrationProfileTestDb.addOtherRegistration(
        "approved",
        TEST_MATCH_ID,
        "Later",
      );

      const adminToken = makeToken(TEST_TOURNAMENT_ADMIN_ID, 0);
      assert.ok(adminToken);
      const csvResponse = await getWithToken(
        origin,
        `/daily007/v2/admin/matches/${TEST_MATCH_ID}/registrations.csv`,
        adminToken,
      );
      assert.equal(csvResponse.status, 200);

      const records = parseCsvDocument(await csvResponse.text());
      assert.equal(records.length, 3, "Header and two registrations should form exactly three CSV records.");
      const [headers, multilineValues, laterValues] = records;
      assert.ok(headers);
      assert.ok(multilineValues);
      assert.ok(laterValues);
      assert.equal(multilineValues.length, headers.length);
      assert.equal(laterValues.length, headers.length);

      const registrationRows = [
        {
          label: "multiline registration",
          values: multilineValues,
          names: {
            captain_profile_name: registration.captain_name,
            captain_game_name: registration.captain_game_name,
            team_name: registration.team_name,
            teammate_1_name: savedRoster[0].member_name,
            teammate_2_name: savedRoster[1].member_name,
            teammate_3_name: savedRoster[2].member_name,
          },
        },
        {
          label: "later registration",
          values: laterValues,
          names: {
            captain_profile_name: laterRegistration.registration.captain_name,
            captain_game_name: laterRegistration.registration.captain_game_name,
            team_name: laterRegistration.registration.team_name,
            teammate_1_name: laterRegistration.roster[0].member_name,
            teammate_2_name: laterRegistration.roster[1].member_name,
            teammate_3_name: laterRegistration.roster[2].member_name,
          },
        },
      ];
      for (const row of registrationRows) {
        for (const [column, expectedName] of Object.entries(row.names)) {
          const index = headers.indexOf(column);
          assert.notEqual(index, -1, `CSV header should include ${column}`);
          assert.equal(
            row.values[index],
            expectedName,
            `${row.label} ${column} should remain exact and under its expected header.`,
          );
          if (row.label === "multiline registration") {
            assert.ok(
              expectedName.includes("\r\n"),
              `${column} fixture value should contain embedded CR/LF.`,
            );
          }
        }
      }
    });
  } finally {
    registrationProfileTestDb.reset();
  }
});

test("team edits change only Free Fire and roster details, not the captain profile or entry charge", async () => {
  registrationProfileTestDb.reset(` ${PROFILE_NAME} `);
  try {
    await withServer(async (origin) => {
      const registered = await sendRegistration(
        origin,
        registrationRequests[0].path,
        registrationRequests[0].body,
      );
      assert.equal(registered.status, 201);
      assert.equal(registrationProfileTestDb.registrations.length, 1);

      const registration = registrationProfileTestDb.registrations[0];
      const originalRegistration = structuredClone(registration);
      const originalWallet = registrationProfileTestDb.user.wallet_coins;
      const originalLedger = structuredClone(registrationProfileTestDb.ledger);
      const originalRoster = structuredClone(registrationProfileTestDb.roster);
      assert.equal(originalRegistration.entry_coins_paid, 7);
      assert.equal(originalWallet, 93);
      assert.equal(originalLedger.length, 1);

      const updatedTeam = {
        captainGameName: "UpdatedFireCaptain",
        captainGameUid: "FF-CAPTAIN-UPDATED",
        teamName: "Red Dragon",
        teammates: [
          { name: "UpdatedMateOne", uid: "FF-MATE-UPDATED-1" },
          { name: "UpdatedMateTwo", uid: "FF-MATE-UPDATED-2" },
          { name: "UpdatedMateThree", uid: "FF-MATE-UPDATED-3" },
        ],
      };
      const attemptedProtectedEdit = await sendTeamEdit(origin, registration.id, {
        ...updatedTeam,
        captainName: "Forged Daily007 Profile",
        entryCoinsPaid: 999,
      });

      assert.equal(attemptedProtectedEdit.status, 400);
      assert.deepEqual(registrationProfileTestDb.registrations[0], originalRegistration);
      assert.deepEqual(registrationProfileTestDb.roster, originalRoster);
      assert.equal(registrationProfileTestDb.user.wallet_coins, originalWallet);
      assert.deepEqual(registrationProfileTestDb.ledger, originalLedger);

      const validEdit = await sendTeamEdit(origin, registration.id, updatedTeam);
      assert.equal(validEdit.status, 200);
      assert.deepEqual(
        {
          captain_name: registration.captain_name,
          captain_game_name: registration.captain_game_name,
          captain_game_uid: registration.captain_game_uid,
          team_name: registration.team_name,
          entry_coins_paid: registration.entry_coins_paid,
        },
        {
          captain_name: PROFILE_NAME,
          captain_game_name: updatedTeam.captainGameName,
          captain_game_uid: updatedTeam.captainGameUid,
          team_name: updatedTeam.teamName,
          entry_coins_paid: originalRegistration.entry_coins_paid,
        },
      );
      assert.deepEqual(
        registrationProfileTestDb.roster
          .filter((member) => member.registration_id === registration.id)
          .map(({ position, member_uid, member_name }) => ({ position, member_uid, member_name })),
        updatedTeam.teammates.map((member, index) => ({
          position: index + 1,
          member_uid: member.uid,
          member_name: member.name,
        })),
      );
      assert.equal(registrationProfileTestDb.user.wallet_coins, originalWallet);
      assert.deepEqual(registrationProfileTestDb.ledger, originalLedger);
    });
  } finally {
    registrationProfileTestDb.reset();
  }
});

test("team edits reject captain and teammate UIDs differing only by capitalization without changing the roster", async () => {
  registrationProfileTestDb.reset(` ${PROFILE_NAME} `);
  try {
    await withServer(async (origin) => {
      const registered = await sendRegistration(
        origin,
        registrationRequests[0].path,
        registrationRequests[0].body,
      );
      assert.equal(registered.status, 201);
      const registration = registrationProfileTestDb.registrations[0];
      assert.ok(registration);
      const originalRegistrations = structuredClone(registrationProfileTestDb.registrations);
      const originalRoster = structuredClone(registrationProfileTestDb.roster);

      const attemptedEdit = await sendTeamEdit(origin, registration.id, {
        captainGameName: "UpdatedFireCaptain",
        captainGameUid: "FF-Duplicate-Captain-UID",
        teamName: "Attempted Red Dragon",
        teammates: [
          { name: "UpdatedMateOne", uid: "ff-duplicate-captain-uid" },
          { name: "UpdatedMateTwo", uid: "FF-MATE-UPDATED-2" },
          { name: "UpdatedMateThree", uid: "FF-MATE-UPDATED-3" },
        ],
      });

      assert.equal(attemptedEdit.status, 400);
      assert.match(String(attemptedEdit.body.error), /different game UID/i);
      assert.deepEqual(registrationProfileTestDb.registrations, originalRegistrations);
      assert.deepEqual(registrationProfileTestDb.roster, originalRoster);
    });
  } finally {
    registrationProfileTestDb.reset();
  }
});

test("team edits reject UIDs from another active registration in the same tournament", async () => {
  const duplicateUidCases = [
    { status: "approved" as const, useTeammateUid: false },
    { status: "pending" as const, useTeammateUid: true },
  ];

  for (const duplicateUidCase of duplicateUidCases) {
    registrationProfileTestDb.reset(` ${PROFILE_NAME} `);
    try {
      await withServer(async (origin) => {
      const registered = await sendRegistration(
        origin,
        registrationRequests[0].path,
        registrationRequests[0].body,
      );
        assert.equal(registered.status, 201);
        const editedRegistration = registrationProfileTestDb.registrations[0];

        const otherRegistration = registrationProfileTestDb.addOtherRegistration(duplicateUidCase.status);
        const otherUid = duplicateUidCase.useTeammateUid
          ? otherRegistration.roster[0].member_uid
          : otherRegistration.registration.captain_game_uid;
        assert.ok(otherUid);
        const differentCapitalization = otherUid.toLowerCase();
        assert.notEqual(differentCapitalization, otherUid);

        const originalRegistrations = structuredClone(registrationProfileTestDb.registrations);
        const originalRoster = structuredClone(registrationProfileTestDb.roster);
        const attemptedEdit = await sendTeamEdit(origin, editedRegistration.id, {
          captainGameName: "UpdatedFireCaptain",
          captainGameUid: "FF-CAPTAIN-UPDATED",
          teamName: "Attempted Red Dragon",
          teammates: [
            { name: "UpdatedMateOne", uid: "FF-MATE-UPDATED-1" },
            { name: "UpdatedMateTwo", uid: differentCapitalization },
            { name: "UpdatedMateThree", uid: "FF-MATE-UPDATED-3" },
          ],
        });

        assert.equal(attemptedEdit.status, 409);
        assert.match(String(attemptedEdit.body.error), /already registered/i);
        assert.deepEqual(registrationProfileTestDb.registrations, originalRegistrations);
        assert.deepEqual(registrationProfileTestDb.roster, originalRoster);
      });
    } finally {
      registrationProfileTestDb.reset();
    }
  }
});

test("team edits allow UIDs from another tournament and leave that tournament's team unchanged", async () => {
  const crossTournamentUidCases = [
    { status: "approved" as const, useTeammateUid: false },
    { status: "pending" as const, useTeammateUid: true },
  ];
  const otherMatchId = "74000000-0000-4000-8000-000000000099";

  for (const crossTournamentUidCase of crossTournamentUidCases) {
    registrationProfileTestDb.reset(` ${PROFILE_NAME} `);
    try {
      await withServer(async (origin) => {
        const registered = await sendRegistration(
          origin,
          registrationRequests[0].path,
          registrationRequests[0].body,
        );
        assert.equal(registered.status, 201);
        const editedRegistration = registrationProfileTestDb.registrations[0];

        const otherTournament = registrationProfileTestDb.addOtherRegistration(
          crossTournamentUidCase.status,
          otherMatchId,
        );
        assert.ok(registrationProfileTestDb.additionalMatches.some((match) => match.id === otherMatchId));
        assert.notEqual(otherTournament.registration.match_id, editedRegistration.match_id);
        const reusedUid = crossTournamentUidCase.useTeammateUid
          ? otherTournament.roster[0].member_uid
          : otherTournament.registration.captain_game_uid;
        assert.ok(reusedUid);

        const currentWallet = registrationProfileTestDb.user.wallet_coins;
        const currentLedger = structuredClone(registrationProfileTestDb.ledger);
        const attemptedEdit = await sendTeamEdit(origin, editedRegistration.id, {
          captainGameName: "UpdatedFireCaptain",
          captainGameUid: "FF-CAPTAIN-CROSS-TOURNAMENT",
          teamName: "Current Tournament Squad",
          teammates: [
            { name: "UpdatedMateOne", uid: "FF-MATE-CROSS-TOURNAMENT-1" },
            { name: "UpdatedMateTwo", uid: reusedUid },
            { name: "UpdatedMateThree", uid: "FF-MATE-CROSS-TOURNAMENT-3" },
          ],
        });

        assert.equal(attemptedEdit.status, 200);
        assert.deepEqual(
          {
            captain_name: editedRegistration.captain_name,
            captain_game_name: editedRegistration.captain_game_name,
            captain_game_uid: editedRegistration.captain_game_uid,
            team_name: editedRegistration.team_name,
            entry_coins_paid: editedRegistration.entry_coins_paid,
          },
          {
            captain_name: PROFILE_NAME,
            captain_game_name: "UpdatedFireCaptain",
            captain_game_uid: "FF-CAPTAIN-CROSS-TOURNAMENT",
            team_name: "Current Tournament Squad",
            entry_coins_paid: 7,
          },
        );
        assert.deepEqual(
          registrationProfileTestDb.roster
            .filter((member) => member.registration_id === editedRegistration.id)
            .map((member) => member.member_uid),
          ["FF-MATE-CROSS-TOURNAMENT-1", reusedUid, "FF-MATE-CROSS-TOURNAMENT-3"],
        );
        assert.deepEqual(
          registrationProfileTestDb.registrations.find(
            (registration) => registration.id === otherTournament.registration.id,
          ),
          otherTournament.registration,
        );
        assert.deepEqual(
          registrationProfileTestDb.roster.filter(
            (member) => member.registration_id === otherTournament.registration.id,
          ),
          otherTournament.roster,
        );
        assert.equal(registrationProfileTestDb.user.wallet_coins, currentWallet);
        assert.deepEqual(registrationProfileTestDb.ledger, currentLedger);
      });
    } finally {
      registrationProfileTestDb.reset();
    }
  }
});

test("team edits allow UIDs from rejected entries and leave the rejected team unchanged", async () => {
  for (const useTeammateUid of [false, true]) {
    registrationProfileTestDb.reset(` ${PROFILE_NAME} `);
    try {
      await withServer(async (origin) => {
        const registered = await sendRegistration(
          origin,
          registrationRequests[0].path,
          registrationRequests[0].body,
        );
        assert.equal(registered.status, 201);
        const editedRegistration = registrationProfileTestDb.registrations[0];

        const cancelledEntry = registrationProfileTestDb.addOtherRegistration("rejected");
        assert.equal(cancelledEntry.registration.status, "rejected");
        assert.equal(cancelledEntry.registration.match_id, editedRegistration.match_id);
        const reusedUid = useTeammateUid
          ? cancelledEntry.roster[0].member_uid
          : cancelledEntry.registration.captain_game_uid;
        assert.ok(reusedUid);

        const originalCancelledRegistration = structuredClone(cancelledEntry.registration);
        const originalCancelledRoster = structuredClone(cancelledEntry.roster);
        const originalWallet = registrationProfileTestDb.user.wallet_coins;
        const originalLedger = structuredClone(registrationProfileTestDb.ledger);
        const attemptedEdit = await sendTeamEdit(origin, editedRegistration.id, {
          captainGameName: "UpdatedFireCaptain",
          captainGameUid: "FF-CAPTAIN-AFTER-CANCELLED-ENTRY",
          teamName: "Current Tournament Squad",
          teammates: [
            { name: "UpdatedMateOne", uid: "FF-MATE-AFTER-CANCELLED-1" },
            { name: "UpdatedMateTwo", uid: reusedUid },
            { name: "UpdatedMateThree", uid: "FF-MATE-AFTER-CANCELLED-3" },
          ],
        });

        assert.equal(attemptedEdit.status, 200);
        assert.deepEqual(
          registrationProfileTestDb.roster
            .filter((member) => member.registration_id === editedRegistration.id)
            .map((member) => member.member_uid),
          ["FF-MATE-AFTER-CANCELLED-1", reusedUid, "FF-MATE-AFTER-CANCELLED-3"],
        );
        assert.deepEqual(
          registrationProfileTestDb.registrations.find(
            (registration) => registration.id === cancelledEntry.registration.id,
          ),
          originalCancelledRegistration,
        );
        assert.deepEqual(
          registrationProfileTestDb.roster.filter(
            (member) => member.registration_id === cancelledEntry.registration.id,
          ),
          originalCancelledRoster,
        );
        assert.equal(registrationProfileTestDb.user.wallet_coins, originalWallet);
        assert.deepEqual(registrationProfileTestDb.ledger, originalLedger);
      });
    } finally {
      registrationProfileTestDb.reset();
    }
  }
});

test("team edits roll back captain details and the saved roster when a teammate insert fails", async () => {
  registrationProfileTestDb.reset(` ${PROFILE_NAME} `);
  try {
    await withServer(async (origin) => {
      const registered = await sendRegistration(
        origin,
        registrationRequests[0].path,
        registrationRequests[0].body,
      );
      assert.equal(registered.status, 201);
      assert.equal(registrationProfileTestDb.registrations.length, 1);

      const registration = registrationProfileTestDb.registrations[0];
      const originalRegistration = structuredClone(registration);
      const originalRoster = structuredClone(registrationProfileTestDb.roster);
      const originalWallet = registrationProfileTestDb.user.wallet_coins;
      const originalLedger = structuredClone(registrationProfileTestDb.ledger);
      assert.equal(originalRegistration.captain_name, PROFILE_NAME);
      assert.equal(originalRegistration.entry_coins_paid, 7);
      assert.equal(originalWallet, 93);
      assert.equal(originalLedger.length, 1);

      registrationProfileTestDb.failRosterInsertAtPosition = 2;
      const failedEdit = await sendTeamEdit(origin, registration.id, {
        captainGameName: "UpdatedFireCaptain",
        captainGameUid: "FF-CAPTAIN-UPDATED",
        teamName: "Red Dragon",
        teammates: [
          { name: "UpdatedMateOne", uid: "FF-MATE-UPDATED-1" },
          { name: "UpdatedMateTwo", uid: "FF-MATE-UPDATED-2" },
          { name: "UpdatedMateThree", uid: "FF-MATE-UPDATED-3" },
        ],
      });

      assert.equal(failedEdit.status, 500);
      assert.deepEqual(registrationProfileTestDb.registrations[0], originalRegistration);
      assert.deepEqual(registrationProfileTestDb.roster, originalRoster);
      assert.equal(registrationProfileTestDb.user.wallet_coins, originalWallet);
      assert.deepEqual(registrationProfileTestDb.ledger, originalLedger);
    });
  } finally {
    registrationProfileTestDb.reset();
  }
});

test("v2 and legacy registration reject an empty profile name before charging the wallet", async () => {
  try {
    for (const request of registrationRequests) {
      registrationProfileTestDb.reset("   ");
      await withServer(async (origin) => {
        const response = await sendRegistration(origin, request.path, request.body);
        assert.equal(response.status, 400);
        assert.match(String(response.body.error), /Daily007 profile name/i);
        assert.equal(registrationProfileTestDb.connectCount, 0);
        assert.equal(registrationProfileTestDb.registrations.length, 0);
        assert.equal(registrationProfileTestDb.ledger.length, 0);
        assert.equal(registrationProfileTestDb.user.wallet_coins, 100);
      });
    }
  } finally {
    registrationProfileTestDb.reset();
  }
});

test("rejecting approved or pending registrations refunds once and prevents later approval", async () => {
  for (const initialStatus of ["approved", "pending"] as const) {
    registrationProfileTestDb.reset(` ${PROFILE_NAME} `);
    try {
      await withServer(async (origin) => {
        const registered = await sendRegistration(
          origin,
          registrationRequests[0].path,
          registrationRequests[0].body,
        );
        assert.equal(registered.status, 201);
        const registration = registrationProfileTestDb.registrations[0];
        assert.ok(registration);
        registration.status = initialStatus;
        const originalRoster = structuredClone(registrationProfileTestDb.roster);
        const walletBeforeRejection = registrationProfileTestDb.user.wallet_coins;
        const ledgerBeforeRejection = structuredClone(registrationProfileTestDb.ledger);
        assert.equal(walletBeforeRejection, 93);
        assert.equal(ledgerBeforeRejection.length, 1);
        assert.equal(registration.entry_coins_paid, 7);

        const firstRejection = await sendAdminRegistrationAction(origin, registration.id, "reject");
        assert.equal(firstRejection.status, 200);
        assert.deepEqual(firstRejection.body.data, {
          id: registration.id,
          status: "rejected",
          refunded: true,
        });
        assert.equal(registration.status, "rejected");
        assert.equal(registrationProfileTestDb.user.wallet_coins, 100);
        assert.deepEqual(registrationProfileTestDb.roster, originalRoster);
        assert.equal(registrationProfileTestDb.ledger.length, ledgerBeforeRejection.length + 1);
        assert.deepEqual(registrationProfileTestDb.ledger.at(-1), {
          user_id: TEST_PLAYER_ID,
          amount: 7,
          balance_after: 100,
          reason: "registration_refund",
          match_id: TEST_MATCH_ID,
          registration_id: registration.id,
        });
        const registrationsAfterRefund = structuredClone(registrationProfileTestDb.registrations);
        const ledgerAfterRefund = structuredClone(registrationProfileTestDb.ledger);

        const repeatedRejection = await sendAdminRegistrationAction(origin, registration.id, "reject");
        assert.equal(repeatedRejection.status, 200);
        assert.equal(registrationProfileTestDb.user.wallet_coins, 100);
        assert.deepEqual(registrationProfileTestDb.registrations, registrationsAfterRefund);
        assert.deepEqual(registrationProfileTestDb.roster, originalRoster);
        assert.deepEqual(registrationProfileTestDb.ledger, ledgerAfterRefund);

        const approvalAfterRefund = await sendAdminRegistrationAction(origin, registration.id, "approve");
        assert.equal(approvalAfterRefund.status, 409);
        assert.match(String(approvalAfterRefund.body.error), /rejected and refunded/i);
        assert.equal(registrationProfileTestDb.user.wallet_coins, 100);
        assert.deepEqual(registrationProfileTestDb.registrations, registrationsAfterRefund);
        assert.deepEqual(registrationProfileTestDb.roster, originalRoster);
        assert.deepEqual(registrationProfileTestDb.ledger, ledgerAfterRefund);
      });
    } finally {
      registrationProfileTestDb.reset();
    }
  }
});

      const secondRegistrationId = "74000000-0000-4000-8000-000000000011";

      const secondCaptain = {
        id: "74000000-0000-4000-8000-000000000004",
        name: "Second Captain Profile",
        email: "second-captain@example.test",
        role: "user" as const,
        wallet_coins: 100,
        phone: null,
        game_uid: null,
        status: "active" as const,
        auth_version: 0,
      };
