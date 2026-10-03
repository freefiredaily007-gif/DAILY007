import assert from "node:assert/strict";
import test from "node:test";
import {
  cleanRecoveryReviewNote,
  isEligibleForGoogleRecoveryApproval,
  isEligibleForGoogleRecoveryRequest,
} from "../src/lib/daily007-account-recovery-policy.ts";

const account = {
  id: "account-1",
  email: "player@example.com",
  status: "active",
  clerkUserId: null,
};

const identity = {
  clerkUserId: "clerk-google-1",
  email: "PLAYER@example.com",
};

test("recovery requests require the verified matching email and an active unlinked account", () => {
  assert.equal(isEligibleForGoogleRecoveryRequest(account, identity), true);
  assert.equal(isEligibleForGoogleRecoveryRequest(null, identity), false);
  assert.equal(isEligibleForGoogleRecoveryRequest({ ...account, status: "blocked" }, identity), false);
  assert.equal(isEligibleForGoogleRecoveryRequest({ ...account, clerkUserId: "other-clerk-user" }, identity), false);
  assert.equal(isEligibleForGoogleRecoveryRequest({ ...account, email: "other@example.com" }, identity), false);
});

test("approval requires a different Full Admin and the same currently verified identity and email", () => {
  const valid = {
    requestStatus: "pending",
    account,
    requestUserId: "account-1",
    reviewerUserId: "full-admin-1",
    requestedClerkUserId: "clerk-google-1",
    requestedEmail: "player@example.com",
    currentIdentity: { ...identity, email: "player@example.com" },
  };
  assert.equal(isEligibleForGoogleRecoveryApproval(valid), true);
  assert.equal(isEligibleForGoogleRecoveryApproval({ ...valid, reviewerUserId: "account-1" }), false);
  assert.equal(isEligibleForGoogleRecoveryApproval({ ...valid, requestStatus: "rejected" }), false);
  assert.equal(isEligibleForGoogleRecoveryApproval({ ...valid, currentIdentity: null }), false);
  assert.equal(isEligibleForGoogleRecoveryApproval({
    ...valid,
    currentIdentity: { clerkUserId: "different-clerk-user", email: "player@example.com" },
  }), false);
  assert.equal(isEligibleForGoogleRecoveryApproval({
    ...valid,
    account: { ...account, clerkUserId: "already-linked-elsewhere" },
  }), false);
});

test("review notes are trimmed and must be 10–500 characters", () => {
  assert.equal(cleanRecoveryReviewNote("  verified by prior support history  "), "verified by prior support history");
  assert.equal(cleanRecoveryReviewNote("too short"), null);
  assert.equal(cleanRecoveryReviewNote("x".repeat(501)), null);
  assert.equal(cleanRecoveryReviewNote(null), null);
});