import assert from "node:assert/strict";
import test from "node:test";
import { parsePasswordChangeInput, passwordHashesMatch } from "../src/lib/daily007-password-change.ts";

test("password change input requires the current password and a valid new password", () => {
  assert.deepEqual(
    parsePasswordChangeInput({ currentPassword: "current password", newPassword: "new-pass-8" }),
    { currentPassword: "current password", newPassword: "new-pass-8" },
  );
  assert.equal(parsePasswordChangeInput({ currentPassword: "", newPassword: "new-pass-8" }), null);
  assert.equal(parsePasswordChangeInput({ currentPassword: "old", newPassword: "short" }), null);
  assert.equal(parsePasswordChangeInput({ currentPassword: "old", newPassword: "x".repeat(201) }), null);
  assert.equal(parsePasswordChangeInput({ currentPassword: "old", newPassword: "new-pass-8", extra: true }), null);
  assert.equal(parsePasswordChangeInput(null), null);
});

test("stored password hashes are compared only when lengths match", () => {
  assert.equal(passwordHashesMatch(Buffer.from("same"), Buffer.from("same")), true);
  assert.equal(passwordHashesMatch(Buffer.from("same"), Buffer.from("nope")), false);
  assert.equal(passwordHashesMatch(Buffer.from("short"), Buffer.from("longer")), false);
});