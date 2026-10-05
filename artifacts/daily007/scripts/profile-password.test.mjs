import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { PROFILE_PASSWORD_MAX_LENGTH, submitProfilePasswordChange } from "../src/lib/profilePassword.ts";

const profileSource = await readFile(
  new URL("../src/screens/Profile.tsx", import.meta.url),
  "utf8",
);
const uiSource = await readFile(
  new URL("../src/components/ui.tsx", import.meta.url),
  "utf8",
);

function makePassword(length) {
  return "p".repeat(length);
}

async function runSubmission(newPassword) {
  const requests = [];
  const changePassword = async (request) => {
    requests.push(request);
  };
  const currentPassword = "current-test-value";

  const result = await submitProfilePasswordChange({
    currentPassword,
    newPassword,
    confirmNewPassword: newPassword,
    changePassword,
  });

  return { result, requests, currentPassword, newPassword };
}

for (const length of [8, 200]) {
  test(`submits a ${length}-character password exactly once`, async () => {
    const { result, requests, currentPassword, newPassword } =
      await runSubmission(makePassword(length));

    assert.equal(result, null);
    assert.equal(requests.length, 1);
    assert.equal(
      requests[0]?.data?.currentPassword === currentPassword &&
        requests[0]?.data?.newPassword === newPassword,
      true,
      "The mutation should receive the current/new password payload unchanged.",
    );
    assert.deepEqual(Object.keys(requests[0].data).sort(), [
      "currentPassword",
      "newPassword",
    ]);
  });
}

for (const length of [7, 201]) {
  test(`rejects a ${length}-character password without submitting`, async () => {
    const { result, requests } = await runSubmission(makePassword(length));

    assert.equal(result, "Your new password must be 8–200 characters.");
    assert.equal(requests.length, 0);
  });
}

test("Profile wires its password inputs to the shared 200-character limit", () => {
  assert.equal(
    (profileSource.match(/maxLength=\{PROFILE_PASSWORD_MAX_LENGTH\}/g) ?? []).length,
    3,
    "Current, new, and confirmation inputs should share the same input cap.",
  );
  assert.match(profileSource, /submitProfilePasswordChange\(\{[\s\S]*?changePassword,/);
  assert.equal(PROFILE_PASSWORD_MAX_LENGTH, 200);
});

test("the shared Input component forwards maxLength to the native text input", () => {
  const inputComponent = uiSource.match(
    /export const Input = React\.forwardRef[\s\S]*?placeholderTextColor=\{props\.placeholderTextColor \|\| C\.dim\}/,
  )?.[0];

  assert.ok(inputComponent, "Expected the shared Input component.");
  assert.match(inputComponent, /<TextInput[\s\S]*?\{\.\.\.props\}/);
});
