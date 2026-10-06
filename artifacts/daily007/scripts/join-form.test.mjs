import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { registerHooks } from "node:module";
import test, { mock } from "node:test";
import { buildJoinFormPayload } from "../src/lib/joinFormPayload.ts";

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
  assert.match(captainGameName, /onChangeText=\{setCaptainGameName\}/);

  const captainGameUid = inputWithPlaceholder("Captain Free Fire UID");
  assert.match(captainGameUid, /value=\{captainGameUid\}/);
  assert.match(captainGameUid, /onChangeText=\{setCaptainGameUid\}/);

  assert.match(joinFormSource, /<Text style=\{st\.pLabel\}>TEAM NAME<\/Text>/);
  const teamName = inputWithPlaceholder("Team name");
  assert.match(teamName, /accessibilityLabel="Team name"/);
  assert.match(teamName, /value=\{teamName\}/);
  assert.match(teamName, /onChangeText=\{setTeamName\}/);

  assert.match(joinFormSource, /<Text style=\{st\.pLabel\}>TEAMMATE \{i \+ 1\}<\/Text>/);
  assert.match(
    joinFormSource,
    /accessibilityLabel=\{`Teammate \$\{i \+ 1\} Free Fire in-game name`\}/,
  );
  assert.match(
    joinFormSource,
    /placeholder=\{`Teammate \$\{i \+ 1\} Free Fire in-game name`\}[\s\S]*?value=\{member\.name\}[\s\S]*?onChangeText=\{\(v\) => setMember\(i, 'name', v\)\}/,
  );
  assert.match(
    joinFormSource,
    /accessibilityLabel=\{`Teammate \$\{i \+ 1\} Free Fire UID, optional`\}/,
  );
  assert.match(
    joinFormSource,
    /placeholder=\{`Teammate \$\{i \+ 1\} Free Fire UID \(optional\)`\}[\s\S]*?value=\{member\.uid\}[\s\S]*?onChangeText=\{\(v\) => setMember\(i, 'uid', v\)\}/,
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
