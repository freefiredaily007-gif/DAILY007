import assert from "node:assert/strict";
import test from "node:test";
import { parsePasswordChangeInput, passwordHashesMatch } from "../src/lib/daily007-password-change.ts";

test("password change input requires the current password and a valid new password", () => {
  assert.deepEqual(
    parsePasswordChangeInput({ currentPassword: "current password", newPassword: "new-pass-8" }),
    { currentPassword: "current password", newPassword: "new-pass-8" },
  );
  assert.equal(parsePasswordChangeInput({ currentPassword: "", newPassword: "new-pass-8" }), null);
  assert.equal(parsePasswordChangeInput({ currentPassword: "old", newPassword: "new-pass-8", extra: true }), null);
  assert.equal(parsePasswordChangeInput(null), null);
});

test("password change accepts new passwords at 8 and 200 characters only", () => {
  for (const length of [8, 200]) {
    const input = { currentPassword: "current password", newPassword: "x".repeat(length) };
    assert.deepEqual(parsePasswordChangeInput(input), input);
  }

  for (const length of [7, 201]) {
    assert.equal(
      parsePasswordChangeInput({
        currentPassword: "current password",
        newPassword: "x".repeat(length),
      }),
      null,
    );
  }
});

test("stored password hashes are compared only when lengths match", () => {
  assert.equal(passwordHashesMatch(Buffer.from("same"), Buffer.from("same")), true);
  assert.equal(passwordHashesMatch(Buffer.from("same"), Buffer.from("nope")), false);
  assert.equal(passwordHashesMatch(Buffer.from("short"), Buffer.from("longer")), false);
});