import assert from "node:assert/strict";
import test from "node:test";
import {
  cleanRecoveryReviewNote,
  isEligibleForGoogleRecoveryApproval,
  isEligibleForGoogleOwnerRecovery,
  isEligibleForGoogleRecoveryRequest,
} from "../src/lib/daily007-account-recovery-policy.ts";
import {
  isOwnerRecoveryCodeConfigured,
  ownerRecoveryCodeMatches,
} from "../src/lib/daily007-owner-recovery-code.ts";

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

test("owner recovery requires the matching active sole Full Admin account and verified Google identity", () => {
  const adminAccount = { ...account, role: "admin" };
  const eligible = {
    account: adminAccount,
    soleAdminUserIds: ["account-1"],
    identity: { ...identity, email: "player@example.com" },
  };
  assert.equal(isEligibleForGoogleOwnerRecovery(eligible), true);
  assert.equal(isEligibleForGoogleOwnerRecovery({ ...eligible, soleAdminUserIds: ["account-1", "admin-2"] }), false);
  assert.equal(isEligibleForGoogleOwnerRecovery({ ...eligible, soleAdminUserIds: ["admin-2"] }), false);
  assert.equal(isEligibleForGoogleOwnerRecovery({ ...eligible, account: { ...adminAccount, role: "user" } }), false);
  assert.equal(isEligibleForGoogleOwnerRecovery({ ...eligible, account: { ...adminAccount, status: "blocked" } }), false);
  assert.equal(isEligibleForGoogleOwnerRecovery({ ...eligible, account: { ...adminAccount, clerkUserId: "linked-elsewhere" } }), false);
  assert.equal(isEligibleForGoogleOwnerRecovery({ ...eligible, identity: null }), false);
  assert.equal(isEligibleForGoogleOwnerRecovery({
    ...eligible,
    identity: { clerkUserId: "clerk-google-1", email: "different@example.com" },
  }), false);
});

test("owner recovery code must be configured strongly and is compared without timing leaks", () => {
  const code = "a".repeat(64);
  assert.equal(isOwnerRecoveryCodeConfigured(code), true);
  assert.equal(isOwnerRecoveryCodeConfigured("short"), false);
  assert.equal(ownerRecoveryCodeMatches(code, code), true);
  assert.equal(ownerRecoveryCodeMatches("b".repeat(64), code), false);
  assert.equal(ownerRecoveryCodeMatches("short", code), false);
  assert.equal(ownerRecoveryCodeMatches(code, undefined), false);
});

test("review notes are trimmed and must be 10–500 characters", () => {
  assert.equal(cleanRecoveryReviewNote("  verified by prior support history  "), "verified by prior support history");
  assert.equal(cleanRecoveryReviewNote("too short"), null);
  assert.equal(cleanRecoveryReviewNote("x".repeat(501)), null);
  assert.equal(cleanRecoveryReviewNote(null), null);
});