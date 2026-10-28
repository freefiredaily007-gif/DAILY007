import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { registerHooks } from "node:module";
import test, { mock } from "node:test";
import {
  buildIndividualPlayerJoinPayload,
  buildJoinFormPayload,
} from "../src/lib/joinFormPayload.ts";
import {
  getJoinFormSubmissionErrorMessage,
  getRegistrationServerFieldErrors,
  validateJoinForm,
} from "../src/lib/joinFormValidation.ts";
import { requestTeamEditCancel } from "../src/lib/teamEditCancel.ts";

const requests = [];
const teamEditRequests = [];
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
  patch(path, body) {
    teamEditRequests.push({ path, body });
    return Promise.resolve({
      data: {
        success: true,
        data: { registrationId: "test-registration", status: "approved", updated: true },
      },
    });
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
const nativeLabelFixtureSource = await readFile(
  new URL("../src/screens/JoinFormAccessibilityNativeTest.tsx", import.meta.url),
  "utf8",
);
const nativeLabelFlowSource = await readFile(
  new URL("../maestro/join-form-accessibility/labels-solo-duo-squad.yaml", import.meta.url),
  "utf8",
);
const nativeLabelRouteSource = await readFile(
  new URL("../app/join-form-accessibility-test.tsx", import.meta.url),
  "utf8",
);
const rootLayoutSource = await readFile(
  new URL("../app/_layout.tsx", import.meta.url),
  "utf8",
);
const androidWorkflowSource = await readFile(
  new URL("../../../.github/workflows/android-release-verification.yml", import.meta.url),
  "utf8",
);
const androidEmulatorScriptSource = await readFile(
  new URL("../../../.github/scripts/android-emulator-verification.sh", import.meta.url),
  "utf8",
);
const androidJoinFormRunnerSource = await readFile(
  new URL("./run-android-join-form-accessibility.mjs", import.meta.url),
  "utf8",
);
const packageJson = JSON.parse(await readFile(
  new URL("../package.json", import.meta.url),
  "utf8",
));

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

test("new registrations collect only the selected player's Free Fire name and UID", () => {
  const profileInput = joinFormSource.match(
    /<Input\s+accessibilityLabel="Captain Daily007 profile name, read-only"([\s\S]*?)\/>/,
  )?.[1];
  assert.ok(profileInput, "The captain's Daily007 profile name must remain available for legacy team edits.");
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

  const editBranchStart = joinFormSource.indexOf("{editing ? (\n          <>");
  const createBranchBoundary = joinFormSource.indexOf(") : (\n          <>", editBranchStart);
  const createBranchStart = createBranchBoundary + ") : (\n          <>".length;
  const createBranchEnd = joinFormSource.indexOf("\n        )}", createBranchStart);
  const createBranch = joinFormSource.slice(createBranchStart, createBranchEnd);
  assert.match(createBranch, /testID="join-form-player-game-name"/);
  assert.match(createBranch, /testID="join-form-player-game-uid"/);
  assert.match(createBranch, /value=\{captainGameName\}/);
  assert.match(createBranch, /value=\{captainGameUid\}/);
  assert.equal((createBranch.match(/<Input\b/g) ?? []).length, 2);
  assert.doesNotMatch(createBranch, /TEAM NAME|Team name|TEAMMATE|Teammate/);
  assert.doesNotMatch(createBranch, /Captain Daily007 profile name/);

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

  assert.match(joinFormSource, /buildIndividualPlayerJoinPayload\(\{\s*captainProfileName,\s*captainGameName,\s*captainGameUid,\s*\}\)/);
  assert.match(joinFormSource, /seatGroupNumber \? \{ seatGroupNumber \} : \{\}[\s\S]*?seatSlotNumber \? \{ seatSlotNumber \} : \{\}/);
  assert.match(joinFormSource, /Choose your individual open player slot from the tournament page first\./);
});

test("new-registration accessibility labels identify the selected player for every format", () => {
  assert.match(uiSource, /<TextInput\s+ref=\{ref\}\s+\{\.\.\.props\}/);
  assert.match(joinFormSource, /accessibilityLabel=\{`\$\{selectedPlayerLabel\} Free Fire in-game name`\}/);
  assert.match(joinFormSource, /accessibilityLabel=\{`\$\{selectedPlayerLabel\} Free Fire UID`\}/);
  assert.match(joinFormSource, /const selectedPlayerLabel = isTeam[\s\S]*?seatSlotNumber === 1 \? 'CAPTAIN'/);
  assert.match(joinFormSource, /seatGroupNumber \? `PLAYER \$\{seatGroupNumber\}` : 'PLAYER'/);
  assert.match(joinFormSource, /Each player joins and pays for their own slot\./);
});

test("Android release verification opens native Solo, Duo, Trio, and Squad label flows", () => {
  assert.match(nativeLabelRouteSource, /JoinFormAccessibilityNativeTest/);
  assert.match(rootLayoutSource, /<Stack\.Screen name="join-form-accessibility-test" \/>/);
  assert.match(nativeLabelFixtureSource, /if \(!__DEV__\) return <Redirect href="\/" \/>/);
  assert.match(nativeLabelFixtureSource, /onSubmit=\{async \(\) => \{\}\}/);
  assert.equal(
    packageJson.scripts["test:android-join-form-accessibility"],
    "node scripts/run-android-join-form-accessibility.mjs",
  );
  assert.match(
    androidJoinFormRunnerSource,
    /Android API level \$\{apiLevel\} JoinForm accessibility label flow failed/,
  );
  assert.match(
    androidEmulatorScriptSource,
    /run_maestro_suite join-form-accessibility test:android-join-form-accessibility/,
  );
  assert.match(androidWorkflowSource, /Run JoinForm accessibility label regression tests/);
  assert.match(androidWorkflowSource, /api-level: 35/);
  assert.match(androidWorkflowSource, /Run JoinForm accessibility labels on Android 16 \(API 36\)/);
  assert.match(androidWorkflowSource, /api-level: 36/);
  assert.match(
    androidEmulatorScriptSource,
    /if \[ "\$ANDROID_API_LEVEL" = 36 \]; then\s+run_maestro_suite join-form-accessibility test:android-join-form-accessibility/,
  );

  const formats = [
    {
      name: "Solo",
      labels: [
        "PLAYER 1 Free Fire in-game name",
        "PLAYER 1 Free Fire UID",
      ],
    },
    {
      name: "Duo",
      labels: [
        "PLAYER 2 Free Fire in-game name",
        "PLAYER 2 Free Fire UID",
      ],
    },
    {
      name: "Trio",
      labels: [
        "PLAYER 2 Free Fire in-game name",
        "PLAYER 2 Free Fire UID",
      ],
    },
    {
      name: "Squad",
      labels: [
        "PLAYER 2 Free Fire in-game name",
        "PLAYER 2 Free Fire UID",
      ],
    },
  ];
  let previousFormatOffset = -1;
  for (const format of formats) {
    const formatOffset = nativeLabelFlowSource.indexOf(`Current format: ${format.name}`);
    assert.ok(formatOffset > previousFormatOffset, `${format.name} flow must follow the preceding format.`);
    previousFormatOffset = formatOffset;
    const nextFormatOffset = nativeLabelFlowSource.indexOf("Current format:", formatOffset + 1);
    const formatFlow = nativeLabelFlowSource.slice(
      formatOffset,
      nextFormatOffset < 0 ? undefined : nextFormatOffset,
    );
    let previousLabelOffset = formatOffset;
    for (const label of format.labels) {
      const labelOffset = nativeLabelFlowSource.indexOf(`text: "${label}"`, previousLabelOffset);
      assert.ok(labelOffset > previousLabelOffset, `${format.name} must expose and visit ${label} in order.`);
      previousLabelOffset = labelOffset;
    }
    let previousTapOffset = -1;
    for (const label of format.labels) {
      const tapOffset = formatFlow.indexOf(`- tapOn:\n    text: "${label}"`, previousTapOffset + 1);
      assert.ok(tapOffset > previousTapOffset, `${format.name} native input ${label} must be reachable in order.`);
      previousTapOffset = tapOffset;
    }
  }
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

test("Android JoinForm accessibility flow recovers from a cold Expo Go launch", () => {
  assert.match(nativeLabelFlowSource, /times: 12[\s\S]*?id: join-form-accessibility-fixture/);
  assert.match(nativeLabelFlowSource, /id: join-form-accessibility-fixture\n\s+timeout: 60000/);
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

test("a failed team edit explains that saved details are unchanged and attempted edits can be retried", () => {
  assert.equal(
    getJoinFormSubmissionErrorMessage("Database write failed.", { editing: true }),
    "Your saved team is unchanged. Database write failed. Your attempted edits are still here; correct them or try saving again.",
  );
  assert.equal(
    getJoinFormSubmissionErrorMessage("Network request failed.", {
      editing: true,
      outcomeUnknown: true,
    }),
    "Network request failed. We couldn't confirm whether your saved team changed. Your attempted edits are still here; check the saved team before retrying.",
  );
  assert.equal(
    getJoinFormSubmissionErrorMessage("Registration could not be confirmed.", { editing: false }),
    "Registration could not be confirmed.",
  );

  const failedEditCatch = joinFormSource.match(
    /\} catch \(e: any\) \{([\s\S]*?)\} finally \{ setBusy\(false\); \}/,
  )?.[1];
  assert.ok(failedEditCatch, "A failed submission must be handled and release the save button.");
  assert.match(failedEditCatch, /getJoinFormSubmissionErrorMessage\(message,\s*\{\s*editing,\s*outcomeUnknown: e\?\.isAxiosError === true && !e\?\.response/);
  assert.doesNotMatch(failedEditCatch, /set(?:CaptainGameName|CaptainGameUid|TeamName|Members)\(/);
  assert.match(joinFormSource, /value=\{teamName\}/);
  assert.match(joinFormSource, /value=\{captainGameName\}/);
  assert.match(joinFormSource, /onPress=\{submit\}[\s\S]*?loading=\{busy\}[\s\S]*?disabled=\{isUnavailable\}/);
  assert.match(joinFormSource, /<Text onPress=\{cancel\} style=\{st\.back\}>← BACK<\/Text>/);
  assert.match(joinFormSource, /onPress=\{cancel\}[\s\S]*?testID="join-form-cancel"/);
});

test("team edit cancellation exits immediately when unchanged and keeps or discards edited values by choice", () => {
  let cancelCount = 0;
  let confirmationActions;
  const onCancel = () => { cancelCount += 1; };
  const showConfirmation = (actions) => { confirmationActions = actions; };

  requestTeamEditCancel(false, onCancel, showConfirmation);
  assert.equal(cancelCount, 1, "An unchanged team edit should close immediately.");
  assert.equal(confirmationActions, undefined, "An unchanged team edit should not show a prompt.");

  requestTeamEditCancel(true, onCancel, showConfirmation);
  assert.equal(cancelCount, 1, "Edited values should remain open until the player chooses.");
  assert.equal(typeof confirmationActions.keepEditing, "function");
  assert.equal(typeof confirmationActions.discard, "function");

  confirmationActions.keepEditing();
  assert.equal(cancelCount, 1, "Keep editing must retain the form instead of leaving.");
  confirmationActions.discard();
  assert.equal(cancelCount, 2, "Discard must return to the previous screen.");

  assert.match(joinFormSource, /const hasUnsavedTeamChanges = editing && JSON\.stringify\(\{[\s\S]*?captainGameName,[\s\S]*?captainGameUid,[\s\S]*?teamName,[\s\S]*?teammates: members,[\s\S]*?\}\) !== JSON\.stringify\(originalTeam\)/);
  assert.match(joinFormSource, /'Discard team changes\?'/);
  assert.match(joinFormSource, /Platform\.OS === 'web'[\s\S]*?globalThis\.confirm\([\s\S]*?discard\(\)[\s\S]*?keepEditing\(\)/);
  assert.match(joinFormSource, /text: 'Keep editing', style: 'cancel', onPress: keepEditing/);
  assert.match(joinFormSource, /text: 'Discard', style: 'destructive', onPress: discard/);
});

test("a stale team edit shows the latest saved team and keeps the current form values for an explicit retry", () => {
  assert.match(joinFormSource, /responseData\?\.code === 'STALE_TEAM_EDIT'/);
  assert.match(joinFormSource, /setStaleTeam\(responseData\.latestTeam\)/);
  assert.match(joinFormSource, /Your form values are still here/);
  assert.match(joinFormSource, /testID="join-form-stale-team"/);
  assert.match(joinFormSource, /LATEST SAVED TEAM/);
  assert.match(joinFormSource, /title="KEEP MY EDITS AND CONTINUE"/);
  assert.match(joinFormSource, /setExpectedTeam\(staleTeam\);[\s\S]*?setStaleTeam\(null\);[\s\S]*?Save again to replace the latest saved team/);
  assert.match(joinFormSource, /value=\{captainGameName\}/);
  assert.match(joinFormSource, /value=\{captainGameUid\}/);
  assert.match(joinFormSource, /value=\{teamName\}/);
  assert.match(joinFormSource, /value=\{member\.name\}/);
  assert.match(joinFormSource, /await onSubmit\(editing[\s\S]*?seatGroupNumber \? \{ seatGroupNumber \} : \{\}[\s\S]*?seatSlotNumber \? \{ seatSlotNumber \} : \{\}/);
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
  const submitted = buildIndividualPlayerJoinPayload({
    captainProfileName: "Daily007 Player",
    captainGameName: "Free Fire Player",
    captainGameUid: "player-uid-101",
  });

  assert.deepEqual(submitted, {
    playerName: "Daily007 Player",
    captainGameName: "Free Fire Player",
    gameUid: "player-uid-101",
  });

  await Api.join("tournament-test", submitted);

  assert.deepEqual(requests, [{
    path: "/daily007/v2/matches/tournament-test/register",
    body: {
      captainName: "Daily007 Player",
      captainGameName: "Free Fire Player",
      captainGameUid: "player-uid-101",
    },
  }]);
  assert.doesNotMatch(JSON.stringify(requests[0].body), /teamName|teammate|teamMembers/i);
});

test("team-edit requests include the saved snapshot used for stale-edit detection", async () => {
  teamEditRequests.length = 0;
  const expectedTeam = {
    captainGameName: "Saved Captain",
    captainGameUid: "captain-uid-101",
    teamName: "Saved Squad",
    teammates: [{ name: "Saved Teammate", uid: "teammate-uid-202" }],
  };
  await Api.updateRegistrationTeam("registration-test", {
    captainGameName: "Edited Captain",
    gameUid: "captain-uid-303",
    teamName: "Edited Squad",
    teamMembers: JSON.stringify([
      { name: "Edited Captain", uid: "captain-uid-303" },
      { name: "Edited Teammate", uid: "teammate-uid-404" },
    ]),
    expectedTeam,
  });

  assert.deepEqual(teamEditRequests, [{
    path: "/my/registrations/registration-test/team",
    body: {
      captainGameName: "Edited Captain",
      captainGameUid: "captain-uid-303",
      teamName: "Edited Squad",
      teammates: [{ name: "Edited Teammate", uid: "teammate-uid-404" }],
      expectedTeam,
    },
  }]);
});
