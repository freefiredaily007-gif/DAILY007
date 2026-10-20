import assert from "node:assert/strict";
import test from "node:test";
import {
  createPasswordChangeRequestFingerprint,
  parsePasswordChangeInput,
  passwordChangeRequestFingerprintsMatch,
  passwordHashesMatch,
} from "../src/lib/daily007-password-change.ts";

test("password change input requires the current password and a valid new password", () => {
  assert.deepEqual(
    parsePasswordChangeInput({ currentPassword: "current password", newPassword: "new-pass-8" }),
    { currentPassword: "current password", newPassword: "new-pass-8" },
  );
  assert.equal(parsePasswordChangeInput({ currentPassword: "", newPassword: "new-pass-8" }), null);
  assert.equal(parsePasswordChangeInput({ currentPassword: "old", newPassword: "new-pass-8", extra: true }), null);
  assert.equal(parsePasswordChangeInput(null), null);
});

test("password change accepts a UUID request ID and rejects malformed IDs", () => {
  const requestId = "6bb2f24a-1b03-4ea0-a05e-b73f47e68936";
  assert.deepEqual(
    parsePasswordChangeInput({
      currentPassword: "current password",
      newPassword: "new-pass-8",
      requestId,
    }),
    { currentPassword: "current password", newPassword: "new-pass-8", requestId },
  );
  assert.equal(
    parsePasswordChangeInput({
      currentPassword: "current password",
      newPassword: "new-pass-8",
      requestId: "not-a-uuid",
    }),
    null,
  );
});

test("password-change recovery fingerprints bind the authenticated account, request ID, and both password values", () => {
  const input = {
    currentPassword: "current-password-value",
    newPassword: "new-password-value",
    requestId: "6bb2f24a-1b03-4ea0-a05e-b73f47e68936",
  };
  const secret = "password-change-test-fingerprint-secret-at-least-32-characters";
  const fingerprint = createPasswordChangeRequestFingerprint("user-123", input, secret);

  assert.equal(
    passwordChangeRequestFingerprintsMatch(fingerprint, fingerprint),
    true,
    "the exact signed request fingerprint should compare successfully",
  );
  assert.equal(
    passwordChangeRequestFingerprintsMatch(
      createPasswordChangeRequestFingerprint(
        "user-123",
        { ...input, currentPassword: "different-current-password" },
        secret,
      ),
      fingerprint,
    ),
    false,
    "changing the current password must not be treated as the same request",
  );
  assert.equal(
    passwordChangeRequestFingerprintsMatch(
      createPasswordChangeRequestFingerprint(
        "another-user",
        input,
        secret,
      ),
      fingerprint,
    ),
    false,
    "a completed request cannot be replayed across accounts",
  );
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

test("password change accepts a 200-character current password and rejects 201 characters", () => {
  const newPassword = "replacement-password";

  assert.ok(parsePasswordChangeInput({
    currentPassword: "x".repeat(200),
    newPassword,
  }));
  assert.equal(parsePasswordChangeInput({
    currentPassword: "x".repeat(201),
    newPassword,
  }), null);
});

test("stored password hashes are compared only when lengths match", () => {
  assert.equal(passwordHashesMatch(Buffer.from("same"), Buffer.from("same")), true);
  assert.equal(passwordHashesMatch(Buffer.from("same"), Buffer.from("nope")), false);
  assert.equal(passwordHashesMatch(Buffer.from("short"), Buffer.from("longer")), false);
});