import assert from "node:assert/strict";
import type { Server } from "node:http";
import express from "express";
import test from "node:test";
import daily007CompatCoreRouter from "../src/routes/daily007-compat-core";
import daily007V2Router from "../src/routes/daily007-v2";
import { makeToken } from "../src/lib/daily007-session-token";
import {
  registrationProfileTestDb,
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
): Promise<{ status: number; body: Record<string, unknown> }> {
  const token = makeToken(TEST_PLAYER_ID, 0);
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
): Promise<{ status: number; body: Record<string, unknown> }> {
  const token = makeToken(TEST_PLAYER_ID, 0);
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

async function getWithToken(origin: string, path: string, token: string): Promise<Response> {
  return fetch(`${origin}${path}`, {
    headers: { authorization: `Bearer ${token}` },
  });
}

function parseCsvRow(line: string): string[] {
  return [...line.matchAll(/"((?:[^"]|"")*)"(?:,|$)/g)]
    .map(([, value]) => value.replaceAll('""', '"'));
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

      const csvRows = csvLines.slice(1).map(parseCsvRow);
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

      const firstRegistration = await sendRegistration(
        origin,
        registrationRequests[0].path,
        registrationRequests[0].body,
      );
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

test("admin registration CSV preserves commas and quotes in name columns", async () => {
  registrationProfileTestDb.reset(CSV_PROFILE_NAME);
  const teammates = CSV_TEAMMATE_NAMES.map((name, index) => ({
    name,
    uid: [TEAMMATE_UID, TEAMMATE_TWO_UID, TEAMMATE_THREE_UID][index],
  }));
  const csvRegistrationRequest: RegistrationRequest = {
    ...registrationRequests[0],
    body: {
      ...registrationRequests[0].body,
      captainGameName: CSV_CAPTAIN_GAME_NAME,
      teamName: CSV_TEAM_NAME,
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
      const savedRoster = registrationProfileTestDb.roster
        .filter((member) => member.registration_id === registration.id)
        .sort((left, right) => left.position - right.position);
      assert.deepEqual(
        {
          profileName: registration.captain_name,
          captainGameName: registration.captain_game_name,
          teamName: registration.team_name,
          teammateNames: savedRoster.map((member) => member.member_name),
        },
        {
          profileName: CSV_PROFILE_NAME,
          captainGameName: CSV_CAPTAIN_GAME_NAME,
          teamName: CSV_TEAM_NAME,
          teammateNames: CSV_TEAMMATE_NAMES,
        },
      );

      const adminToken = makeToken(TEST_TOURNAMENT_ADMIN_ID, 0);
      assert.ok(adminToken);
      const csvResponse = await getWithToken(
        origin,
        `/daily007/v2/admin/matches/${TEST_MATCH_ID}/registrations.csv`,
        adminToken,
      );
      assert.equal(csvResponse.status, 200);
      const csvLines = (await csvResponse.text()).trimEnd().split(/\r?\n/);

      const csvRows = csvLines.slice(1).map(parseCsvRow);
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
  const teammates = FORMULA_TEAMMATE_NAMES.map((name, index) => ({
    name,
    uid: [TEAMMATE_UID, TEAMMATE_TWO_UID, TEAMMATE_THREE_UID][index],
  }));
  const csvRegistrationRequest: RegistrationRequest = {
    ...registrationRequests[0],
    body: {
      ...registrationRequests[0].body,
      captainGameName: FORMULA_CAPTAIN_GAME_NAME,
      teamName: FORMULA_TEAM_NAME,
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

test("team edits reject UIDs from another active registration without changing either team", async () => {
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

        const originalRegistrations = structuredClone(registrationProfileTestDb.registrations);
        const originalRoster = structuredClone(registrationProfileTestDb.roster);
        const attemptedEdit = await sendTeamEdit(origin, editedRegistration.id, {
          captainGameName: "UpdatedFireCaptain",
          captainGameUid: "FF-CAPTAIN-UPDATED",
          teamName: "Attempted Red Dragon",
          teammates: [
            { name: "UpdatedMateOne", uid: "FF-MATE-UPDATED-1" },
            { name: "UpdatedMateTwo", uid: otherUid },
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
