import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { registerHooks } from "node:module";
import test, { mock } from "node:test";
import { buildJoinFormPayload } from "../src/lib/joinFormPayload.ts";
import {
  getRegistrationServerFieldErrors,
  validateJoinForm,
} from "../src/lib/joinFormValidation.ts";

const requests = [];
const mockedHttp = {
  defaults: { headers: { common: {} } },
  interceptors: { response: { use() {} } },
  get() {
    assert.fail("JoinForm registration should not issue a GET request.");
  },
  post(path, body) {
    requests.push({ path, body });
    return Promise.resolve({
      data: { success: true, data: { registrationId: "test-registration" } },
    });
  },
  patch() {
    assert.fail("JoinForm registration should not issue a PATCH request.");
  },
};

mock.module("axios", {
  defaultExport: { create: () => mockedHttp },
});
mock.module("@react-native-async-storage/async-storage", {
  defaultExport: {
    async getItem() { return null; },
    async setItem() {},
    async removeItem() {},
  },
});
mock.module("@workspace/api-client-react", {
  namedExports: { setAuthExpiredHandler() {} },
});
mock.module("expo-constants", {
  defaultExport: { expoConfig: null },
});

registerHooks({
  resolve(specifier, context, nextResolve) {
    try {
      return nextResolve(specifier, context);
    } catch (error) {
      if (
        error?.code === "ERR_MODULE_NOT_FOUND" &&
        (specifier.startsWith("./") || specifier.startsWith("../")) &&
        !/\.[a-z\d]+$/i.test(specifier)
      ) {
        return nextResolve(`${specifier}.ts`, context);
      }
      throw error;
    }
  },
});

const { Api } = await import("../src/lib/api.ts");
const joinFormSource = await readFile(
  new URL("../src/screens/JoinForm.tsx", import.meta.url),
  "utf8",
);
const uiSource = await readFile(
  new URL("../src/components/ui.tsx", import.meta.url),
  "utf8",
);

function validJoinForm(overrides = {}) {
  return {
    captainProfileName: "Daily007 Captain",
    captainGameName: "Free Fire Captain",
    captainGameUid: "captain-uid-101",
    teamName: "Separate Team",
    members: [{ name: "First Teammate", uid: "" }],
    isTeam: true,
    ...overrides,
  };
}

function inputWithPlaceholder(placeholder) {
  const escaped = placeholder.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const input = [...joinFormSource.matchAll(/<Input\b([\s\S]*?)\/>/g)].find(
    ([, props]) => new RegExp(`placeholder="${escaped}"`).test(props),
  );
  assert.ok(input, `Expected a separate input for "${placeholder}".`);
  return input[1];
}

function accessibilityInputLabels() {
  return [...joinFormSource.matchAll(/<Input\b([\s\S]*?)\/>/g)].map(
    ([, props]) => {
      const staticLabel = props.match(/accessibilityLabel="([^"]+)"/)?.[1];
      const dynamicLabel = props.match(/accessibilityLabel=\{`([^`]+)`\}/)?.[1];
      const label = staticLabel ?? dynamicLabel;
      assert.ok(label, "Every registration input must have an explicit accessible name.");
      return label;
    },
  );
}

test("the profile name is read-only and game, team, and teammate details have separate inputs", () => {
  const profileInput = joinFormSource.match(
    /<Input\s+accessibilityLabel="Captain Daily007 profile name, read-only"([\s\S]*?)\/>/,
  )?.[1];
  assert.ok(profileInput, "The captain's Daily007 profile name must be displayed.");
  assert.match(profileInput, /value=\{captainProfileName\}/);
  assert.match(profileInput, /editable=\{false\}/);
  assert.match(profileInput, /selectTextOnFocus=\{false\}/);

  const captainGameName = inputWithPlaceholder("Captain Free Fire in-game name");
  assert.match(captainGameName, /value=\{captainGameName\}/);
  assert.match(
    captainGameName,
    /onChangeText=\{\(value\) => \{\s*setCaptainGameName\(value\);\s*clearFieldValidation\('captainGameName'\);/,
  );

  const captainGameUid = inputWithPlaceholder("Captain Free Fire UID");
  assert.match(captainGameUid, /value=\{captainGameUid\}/);
  assert.match(
    captainGameUid,
    /onChangeText=\{\(value\) => \{\s*setCaptainGameUid\(value\);\s*clearFieldValidation\('captainGameUid'\);/,
  );

  assert.match(joinFormSource, /<Text style=\{st\.pLabel\}>TEAM NAME<\/Text>/);
  const teamName = inputWithPlaceholder("Team name");
  assert.match(teamName, /accessibilityLabel="Team name"/);
  assert.match(teamName, /value=\{teamName\}/);
  assert.match(
    teamName,
    /onChangeText=\{\(value\) => \{\s*setTeamName\(value\);\s*clearFieldValidation\('teamName'\);/,
  );

  assert.match(joinFormSource, /<Text style=\{st\.pLabel\}>TEAMMATE \{i \+ 1\}<\/Text>/);
  assert.match(
    joinFormSource,
    /accessibilityLabel=\{`Teammate \$\{i \+ 1\} Free Fire in-game name`\}/,
  );
  assert.match(
    joinFormSource,
    /placeholder=\{`Teammate \$\{i \+ 1\} Free Fire in-game name`\}[\s\S]*?value=\{member\.name\}[\s\S]*?onChangeText=\{\(v\) => \{\s*setMember\(i, 'name', v\);\s*clearFieldValidation\(`memberName:\$\{i\}`\);/,
  );
  assert.match(
    joinFormSource,
    /accessibilityLabel=\{`Teammate \$\{i \+ 1\} Free Fire UID, optional`\}/,
  );
  assert.match(
    joinFormSource,
    /placeholder=\{`Teammate \$\{i \+ 1\} Free Fire UID \(optional\)`\}[\s\S]*?value=\{member\.uid\}[\s\S]*?onChangeText=\{\(v\) => \{\s*setMember\(i, 'uid', v\);\s*clearFieldValidation\(`memberUid:\$\{i\}`\);/,
  );

  assert.match(
    joinFormSource,
    /await onSubmit\(buildJoinFormPayload\(\{\s*captainProfileName,\s*captainGameName:\s*captainGameName\.trim\(\),\s*captainGameUid:\s*captainGameUid\.trim\(\),\s*teamName,\s*members,\s*\}\)\)/,
  );
});

test("TalkBack field labels follow the registration order for Solo, Duo, and Squad", () => {
  assert.match(uiSource, /<TextInput\s+ref=\{ref\}\s+\{\.\.\.props\}/);
  const labels = accessibilityInputLabels();
  assert.deepEqual(labels, [
    "Captain Daily007 profile name, read-only",
    "Captain Free Fire in-game name",
    "Captain Free Fire UID",
    "Team name",
    "Teammate ${i + 1} Free Fire in-game name",
    "Teammate ${i + 1} Free Fire UID, optional",
  ]);

  const forTeamSize = (teamSize) => [
    ...labels.slice(0, 3),
    ...(teamSize > 1 ? [labels[3]] : []),
    ...Array.from({ length: teamSize - 1 }, (_, index) => [
      labels[4].replace("${i + 1}", String(index + 1)),
      labels[5].replace("${i + 1}", String(index + 1)),
    ]).flat(),
  ];
  assert.deepEqual(forTeamSize(1), [
    "Captain Daily007 profile name, read-only",
    "Captain Free Fire in-game name",
    "Captain Free Fire UID",
  ]);
  assert.deepEqual(forTeamSize(2), [
    "Captain Daily007 profile name, read-only",
    "Captain Free Fire in-game name",
    "Captain Free Fire UID",
    "Team name",
    "Teammate 1 Free Fire in-game name",
    "Teammate 1 Free Fire UID, optional",
  ]);
  assert.deepEqual(forTeamSize(4), [
    "Captain Daily007 profile name, read-only",
    "Captain Free Fire in-game name",
    "Captain Free Fire UID",
    "Team name",
    "Teammate 1 Free Fire in-game name",
    "Teammate 1 Free Fire UID, optional",
    "Teammate 2 Free Fire in-game name",
    "Teammate 2 Free Fire UID, optional",
    "Teammate 3 Free Fire in-game name",
    "Teammate 3 Free Fire UID, optional",
  ]);
});

test("required captain and teammate names identify the exact field that needs attention", () => {
  const missingProfileName = validateJoinForm(validJoinForm({ captainProfileName: " " }));
  assert.deepEqual(missingProfileName, {
    message: "Complete the highlighted required fields.",
    fieldErrors: {
      captainProfileName: "Captain Daily007 profile name is required. Add one in Profile before joining.",
    },
  });

  const missingCaptainName = validateJoinForm(validJoinForm({ captainGameName: " " }));
  assert.deepEqual(missingCaptainName, {
    message: "Complete the highlighted required fields.",
    fieldErrors: { captainGameName: "Captain Free Fire in-game name is required." },
  });

  const missingTeammateName = validateJoinForm(validJoinForm({
    members: [{ name: "First Teammate", uid: "" }, { name: " ", uid: "" }],
  }));
  assert.deepEqual(missingTeammateName, {
    message: "Complete the highlighted required fields.",
    fieldErrors: {
      "memberName:1": "Teammate 2 Free Fire in-game name is required.",
    },
  });
});

test("missing captain UID and team name identify the corresponding fields", () => {
  assert.deepEqual(
    validateJoinForm(validJoinForm({ captainGameUid: " " })),
    {
      message: "Complete the highlighted required fields.",
      fieldErrors: { captainGameUid: "Captain Free Fire UID is required." },
    },
  );
  assert.deepEqual(
    validateJoinForm(validJoinForm({ teamName: " " })),
    {
      message: "Complete the highlighted required fields.",
      fieldErrors: { teamName: "Team name is required." },
    },
  );
});

test("server validation metadata identifies captain, team, and teammate fields only", () => {
  assert.deepEqual(
    getRegistrationServerFieldErrors({
      error: "captainGameName must be 1–100 characters.",
      fieldErrors: { captainGameName: "captainGameName must be 1–100 characters." },
    }, { isTeam: true, teammateCount: 2 }),
    { captainGameName: "captainGameName must be 1–100 characters." },
  );
  assert.deepEqual(
    getRegistrationServerFieldErrors({
      error: "Team registrations require a team name between 1 and 100 characters.",
      fieldErrors: { teamName: "Team registrations require a team name between 1 and 100 characters." },
    }, { isTeam: true, teammateCount: 2 }),
    { teamName: "Team registrations require a team name between 1 and 100 characters." },
  );
  assert.deepEqual(
    getRegistrationServerFieldErrors({
      error: "Duo registrations require exactly 1 teammate name.",
      fieldErrors: {
        "memberName:0": "Check the teammate name or UID that needs correction.",
        "memberUid:0": "Check the teammate name or UID that needs correction.",
        "memberName:3": "Not a visible teammate field.",
        "unknown": "Not a registration field.",
      },
    }, { isTeam: true, teammateCount: 1 }),
    {
      "memberName:0": "Check the teammate name or UID that needs correction.",
      "memberUid:0": "Check the teammate name or UID that needs correction.",
    },
  );
});

test("capacity, network, and database errors remain form-level", () => {
  assert.deepEqual(
    getRegistrationServerFieldErrors({
      error: "This match is full.",
      code: "MATCH_FULL",
    }, { isTeam: true, teammateCount: 2 }),
    {},
  );
  assert.deepEqual(
    getRegistrationServerFieldErrors(new Error("Network request failed"), {
      isTeam: true,
      teammateCount: 2,
    }),
    {},
  );
  assert.deepEqual(
    getRegistrationServerFieldErrors({
      error: "Internal server error.",
      fieldErrors: { wallet: "Database write failed." },
    }, { isTeam: true, teammateCount: 2 }),
    {},
  );
  assert.deepEqual(
    getRegistrationServerFieldErrors({
      fieldErrors: { teamName: "Team name is invalid." },
    }, { isTeam: false, teammateCount: 0 }),
    {},
  );
});

test("optional teammate UIDs may be blank, while duplicate UIDs identify both conflicting fields", () => {
  assert.equal(validateJoinForm(validJoinForm({
    members: [
      { name: "First Teammate", uid: "" },
      { name: "Second Teammate", uid: "  " },
    ],
  })), null);

  assert.deepEqual(
    validateJoinForm(validJoinForm({
      members: [
        { name: "First Teammate", uid: "CAPTAIN-UID-101" },
      ],
    })),
    {
      message: "Use a different UID for each player.",
      fieldErrors: {
        captainGameUid: "Captain Free Fire UID is also entered for Teammate 1 Free Fire UID. Enter a different UID.",
        "memberUid:0": "Teammate 1 Free Fire UID is also entered for Captain Free Fire UID. Enter a different UID or leave this optional field blank.",
      },
    },
  );

  assert.deepEqual(
    validateJoinForm(validJoinForm({
      members: [
        { name: "First Teammate", uid: "shared-uid" },
        { name: "Second Teammate", uid: " SHARED-UID " },
      ],
    })),
    {
      message: "Use a different UID for each player.",
      fieldErrors: {
        "memberUid:0": "Teammate 1 Free Fire UID is also entered for Teammate 2 Free Fire UID. Enter a different UID or leave this optional field blank.",
        "memberUid:1": "Teammate 2 Free Fire UID is also entered for Teammate 1 Free Fire UID. Enter a different UID or leave this optional field blank.",
      },
    },
  );
});

test("one submit returns every missing required field and every field in a duplicate UID group", () => {
  assert.deepEqual(
    validateJoinForm(validJoinForm({
      captainProfileName: " ",
      captainGameName: " ",
      captainGameUid: "shared-uid",
      teamName: " ",
      members: [
        { name: " ", uid: " SHARED-UID " },
        { name: "", uid: "shared-uid" },
        { name: " ", uid: "" },
      ],
    })),
    {
      message: "Complete the highlighted required fields and use a different UID for each player.",
      fieldErrors: {
        captainProfileName: "Captain Daily007 profile name is required. Add one in Profile before joining.",
        captainGameName: "Captain Free Fire in-game name is required.",
        teamName: "Team name is required.",
        "memberName:0": "Teammate 1 Free Fire in-game name is required.",
        "memberName:1": "Teammate 2 Free Fire in-game name is required.",
        "memberName:2": "Teammate 3 Free Fire in-game name is required.",
        captainGameUid: "Captain Free Fire UID is also entered for Teammate 1 Free Fire UID and Teammate 2 Free Fire UID. Enter a different UID.",
        "memberUid:0": "Teammate 1 Free Fire UID is also entered for Captain Free Fire UID and Teammate 2 Free Fire UID. Enter a different UID or leave this optional field blank.",
        "memberUid:1": "Teammate 2 Free Fire UID is also entered for Captain Free Fire UID and Teammate 1 Free Fire UID. Enter a different UID or leave this optional field blank.",
      },
    },
  );
});

test("one submit reports multiple separate duplicate UID groups", () => {
  assert.deepEqual(
    validateJoinForm(validJoinForm({
      members: [
        { name: "First Teammate", uid: "captain-uid-101" },
        { name: "Second Teammate", uid: "team-uid-303" },
        { name: "Third Teammate", uid: " TEAM-UID-303 " },
      ],
    })),
    {
      message: "Use a different UID for each player.",
      fieldErrors: {
        captainGameUid: "Captain Free Fire UID is also entered for Teammate 1 Free Fire UID. Enter a different UID.",
        "memberUid:0": "Teammate 1 Free Fire UID is also entered for Captain Free Fire UID. Enter a different UID or leave this optional field blank.",
        "memberUid:1": "Teammate 2 Free Fire UID is also entered for Teammate 3 Free Fire UID. Enter a different UID or leave this optional field blank.",
        "memberUid:2": "Teammate 3 Free Fire UID is also entered for Teammate 2 Free Fire UID. Enter a different UID or leave this optional field blank.",
      },
    },
  );
});

test("registration text limits match the API validation limits", () => {
  assert.match(inputWithPlaceholder("Captain Free Fire in-game name"), /maxLength=\{100\}/);
  assert.match(inputWithPlaceholder("Captain Free Fire UID"), /maxLength=\{128\}/);
  assert.match(joinFormSource, /placeholder="Team name"[\s\S]*?maxLength=\{100\}/);
  assert.match(joinFormSource, /accessibilityLabel=\{`Teammate \$\{i \+ 1\} Free Fire in-game name`\}[\s\S]*?maxLength=\{100\}/);
  assert.match(joinFormSource, /accessibilityLabel=\{`Teammate \$\{i \+ 1\} Free Fire UID, optional`\}[\s\S]*?maxLength=\{128\}/);
});

test("field errors are reachable from their inputs and use one polite announcement without moving focus", () => {
  const fieldInputs = [
    ["Captain Free Fire in-game name", "captainGameName"],
    ["Captain Free Fire UID", "captainGameUid"],
    ["Team name", "teamName"],
  ];
  for (const [placeholder, field] of fieldInputs) {
    const input = inputWithPlaceholder(placeholder);
    assert.match(input, new RegExp(`accessibilityHint=\\{fieldErrors\\.${field}\\}`));
    assert.match(joinFormSource, new RegExp(`fieldErrorText\\('${field}'`));
  }

  const profileInput = joinFormSource.match(
    /<Input\s+accessibilityLabel="Captain Daily007 profile name, read-only"([\s\S]*?)\/>/,
  )?.[1];
  assert.match(profileInput ?? "", /accessibilityHint=\{fieldErrors\.captainProfileName\}/);
  assert.match(joinFormSource, /fieldErrorText\('captainProfileName'/);
  assert.match(
    joinFormSource,
    /accessibilityHint=\{fieldErrors\[`memberName:\$\{i\}`\]\}[\s\S]*?fieldErrorText\(`memberName:\$\{i\}`/,
  );
  assert.match(
    joinFormSource,
    /accessibilityHint=\{fieldErrors\[`memberUid:\$\{i\}`\]\}[\s\S]*?fieldErrorText\(`memberUid:\$\{i\}`/,
  );
  assert.match(joinFormSource, /<Text accessible=\{false\} style=\{st\.fieldError\}/);
  assert.equal((joinFormSource.match(/accessibilityLiveRegion=/g) ?? []).length, 1);
  assert.match(joinFormSource, /accessibilityLiveRegion=\{err \? 'polite' : undefined\}/);
  assert.match(uiSource, /accessibilityLiveRegion=\{accessibilityLiveRegion\}/);
  assert.doesNotMatch(
    joinFormSource,
    /AccessibilityInfo\.announceForAccessibility|setAccessibilityFocus|\.focus\(/,
  );
  assert.match(
    joinFormSource,
    /if \(validation\) \{\s*setFieldErrors\(validation\.fieldErrors\);\s*return announceError\(validation\.message\);/,
    "All field hints must be set before the one combined live-region message is announced.",
  );
  assert.match(joinFormSource, /key=\{errorAnnouncementId\}/);
});

test("correcting one field keeps unrelated validation hints and clears stale UID-conflict hints", () => {
  const clearValidation = joinFormSource.match(
    /const clearFieldValidation = \(field: JoinFormField\) => \{[\s\S]*?\n  \};/,
  )?.[0];
  assert.ok(clearValidation, "Changed fields must clear their own stale validation.");
  assert.match(clearValidation, /delete next\[field\]/);
  assert.match(clearValidation, /message\?\.includes\('is also entered'\)/);
  assert.doesNotMatch(clearValidation, /setFieldErrors\(\{\}\)/);
});

test("JoinForm values remain distinct in the submitted form and registration API payload", async () => {
  requests.length = 0;
  const submitted = buildJoinFormPayload({
    captainProfileName: "Daily007 Captain",
    captainGameName: "Free Fire Captain",
    captainGameUid: "captain-uid-101",
    teamName: "Separate Team",
    members: [
      { name: "First Teammate", uid: "teammate-uid-202" },
      { name: "Second Teammate", uid: "" },
    ],
  });

  assert.deepEqual(submitted, {
    teamMembers: JSON.stringify([
      { name: "Free Fire Captain", uid: "captain-uid-101" },
      { name: "First Teammate", uid: "teammate-uid-202" },
      { name: "Second Teammate", uid: "" },
    ]),
    teamName: "Separate Team",
    playerName: "Daily007 Captain",
    captainGameName: "Free Fire Captain",
    gameUid: "captain-uid-101",
  });

  await Api.join("tournament-test", submitted);

  assert.deepEqual(requests, [{
    path: "/daily007/v2/matches/tournament-test/register",
    body: {
      captainName: "Daily007 Captain",
      captainGameName: "Free Fire Captain",
      captainGameUid: "captain-uid-101",
      teamName: "Separate Team",
      teammates: [
        { name: "First Teammate", uid: "teammate-uid-202" },
        { name: "Second Teammate" },
      ],
    },
  }]);
});
