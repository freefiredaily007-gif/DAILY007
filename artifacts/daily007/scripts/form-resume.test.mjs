import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const profileSource = await readFile(
  new URL("../src/screens/EditProfile.tsx", import.meta.url),
  "utf8",
);
const joinSource = await readFile(
  new URL("../src/screens/JoinForm.tsx", import.meta.url),
  "utf8",
);
const fixtureSource = await readFile(
  new URL("../src/screens/FormResumeNativeTest.tsx", import.meta.url),
  "utf8",
);
const flowSource = await readFile(
  new URL("../maestro/form-resume/forms-retain-values-after-background.yaml", import.meta.url),
  "utf8",
);
const routeSource = await readFile(
  new URL("../app/form-resume-test.tsx", import.meta.url),
  "utf8",
);
const runnerSource = await readFile(
  new URL("./run-android-form-resume.mjs", import.meta.url),
  "utf8",
);
const packageJson = JSON.parse(await readFile(
  new URL("../package.json", import.meta.url),
  "utf8",
));

test("the fixture mounts the production forms and captures their real action payloads", () => {
  assert.match(fixtureSource, /<EditProfile\s+updateProfile=\{/);
  assert.match(fixtureSource, /<JoinForm\s+/);
  assert.match(fixtureSource, /setSavedProfile\(`\$\{profile\.name\} \| \$\{profile\.phone\} \| \$\{profile\.gameUid\}`\)/);
  assert.match(fixtureSource, /setJoinedTeam\(`\$\{payload\.captainGameName\} \| \$\{payload\.captainGameUid\}`\)/);
  assert.match(fixtureSource, /if \(!__DEV__\) return <Redirect href="\/" \/>/);
  assert.match(routeSource, /FormResumeNativeTest/);
  assert.match(profileSource, /updateProfile\(\{ name: name\.trim\(\), phone: phone\.trim\(\), gameUid: gameUid\.trim\(\) \}\)/);
  assert.match(joinSource, /await onSubmit\(editing \? \{ \.\.\.payload, expectedTeam \} : payload\)/);
});

test("the Android flow backgrounds and resumes each filled form before saving or joining", () => {
  assert.equal((flowSource.match(/pressKey: HOME/g) ?? []).length, 2);
  assert.equal((flowSource.match(/launchApp/g) ?? []).length, 2);
  assert.match(flowSource, /id: edit-profile-save/);
  assert.match(flowSource, /Saved profile: Background Profile Name \| 5550104321 \| profile-uid-4321/);
  assert.match(flowSource, /id: join-form-submit/);
  assert.match(flowSource, /Joined with: Background Captain \| 987654321/);
  assert.match(runnerSource, /Expected exactly one authorized Android device or emulator/);
  assert.equal(packageJson.scripts["test:android-form-resume"], "node scripts/run-android-form-resume.mjs");
});
